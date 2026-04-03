from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.database import async_session_maker
from app.models.database import Asset, Playlist, PlaylistItem, UserProfile
from app.services.playlists.service import PlaylistService


def _asset_meta() -> dict:
    return {
        "video": {
            "codec": "h264",
            "width": 1920,
            "height": 1080,
            "fps": 30,
        },
        "audio": {
            "codec": "aac",
            "sample_rate": 48000,
        },
    }


@pytest.mark.asyncio
async def test_validate_playlist_rejects_remote_asset_without_local_cache(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    cache_path = user_dir / "remote.mp4"

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        async with async_session_maker() as session:
            session.add(
                UserProfile(
                    user_id=user_id,
                    email=f"{user_id}@playlist-storage.test",
                    subscription_tier="free",
                    subscription_status="active",
                )
            )
            playlist = Playlist(user_id=user_id, name="Remote assets")
            asset = Asset(
                user_id=user_id,
                filename="remote.mp4",
                storage_path=str(cache_path),
                storage_backend="object_storage",
                storage_key="assets/remote.mp4",
                size_bytes=1024,
                asset_type="video",
                meta=_asset_meta(),
            )
            session.add_all([playlist, asset])
            await session.flush()
            session.add(
                PlaylistItem(
                    playlist_id=playlist.id,
                    asset_id=asset.id,
                    position=0,
                )
            )
            await session.commit()

            service = PlaylistService(session, user_id)
            with pytest.raises(HTTPException) as exc_info:
                await service.validate_playlist(playlist.id)

            assert exc_info.value.status_code == 409
            assert exc_info.value.detail["error"] == "asset_local_file_unavailable"
    finally:
        settings.upload_dir = original_upload_dir
