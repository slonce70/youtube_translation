import pytest
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock

from sqlalchemy import select, text

from app.api.routes import streams as streams_routes
from app.core.database import async_session_maker
from app.core.security import encrypt_stream_key
from app.models.database import (
    Asset,
    CollectionItem,
    Destination,
    MediaCollection,
    Stream,
    StreamDestination,
    UserProfile,
)
from app.schemas.api import CollectionItemCreate, StreamLiveUpdateRequest


def _asset_meta(codec: str = "h264", audio_codec: str = "aac"):
    return {
        "video": {
            "codec": codec,
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "pix_fmt": "yuv420p",
        },
        "audio": {
            "codec": audio_codec,
        },
    }


@pytest.mark.asyncio
async def test_live_edit_updates_video_collection_and_restarts_stream(monkeypatch, tmp_path):
    user_id = uuid4()

    mock_restart = AsyncMock(return_value=True)
    monkeypatch.setattr(streams_routes.ffmpeg_manager, "restart_stream", mock_restart)

    mock_quality = AsyncMock(
        return_value={
            "ok": True,
            "violations": [],
            "limits": {},
            "tier": "free",
            "mode": "video",
            "audio_recommended": None,
        }
    )
    monkeypatch.setattr(
        streams_routes.QuotaEnforcer,
        "evaluate_stream_quality",
        mock_quality,
        raising=False,
    )

    monkeypatch.setattr(streams_routes.settings, "stream_dir", str(tmp_path))

    async with async_session_maker() as session:
        check = await session.execute(text("SELECT to_regclass('public.media_collections')"))
        if not check.scalar():
            pytest.skip("media_collections table not available in this test DB")
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@live-edit.test",
            subscription_tier="free",
        )
        session.add(profile)

        asset_a = Asset(
            user_id=user_id,
            filename="a.mp4",
            storage_path=str(Path(tmp_path) / "a.mp4"),
            size_bytes=1024,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )
        asset_b = Asset(
            user_id=user_id,
            filename="b.mp4",
            storage_path=str(Path(tmp_path) / "b.mp4"),
            size_bytes=2048,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )
        session.add_all([asset_a, asset_b])

        collection = MediaCollection(
            user_id=user_id,
            name="Video",
            collection_type="video_background",
            is_active=True,
        )
        session.add(collection)
        await session.flush()

        session.add_all(
            [
                CollectionItem(
                    collection_id=collection.id,
                    asset_id=asset_a.id,
                    position=0,
                    loop_mode="loop",
                ),
                CollectionItem(
                    collection_id=collection.id,
                    asset_id=asset_b.id,
                    position=1,
                    loop_mode="loop",
                ),
            ]
        )

        destination = Destination(
            user_id=user_id,
            name="YouTube",
            rtmps_url="rtmps://a.rtmp.youtube.com/live2",
            stream_key_encrypted=encrypt_stream_key("secret-key"),
            enabled=True,
        )
        session.add(destination)
        await session.flush()

        stream = Stream(
            user_id=user_id,
            name="Live",
            status="running",
            mix_mode="video_only",
            video_collection_id=collection.id,
        )
        session.add(stream)
        await session.flush()

        session.add(
            StreamDestination(
                stream_id=stream.id,
                destination_id=destination.id,
            )
        )
        await session.commit()

        payload = StreamLiveUpdateRequest(
            target="video",
            items=[
                CollectionItemCreate(asset_id=asset_b.id, position=0, loop_mode="loop"),
                CollectionItemCreate(asset_id=asset_a.id, position=1, loop_mode="loop"),
            ],
        )

        response = await streams_routes.live_update_stream(
            stream.id,
            payload,
            user_deps=(session, user_id),
        )

        assert response.id == stream.id
        mock_restart.assert_awaited_once()
        mock_quality.assert_awaited()

        result = await session.execute(
            select(CollectionItem)
            .where(CollectionItem.collection_id == collection.id)
            .order_by(CollectionItem.position)
        )
        items = result.scalars().all()
        assert [item.asset_id for item in items] == [asset_b.id, asset_a.id]


@pytest.mark.asyncio
async def test_live_edit_rejects_invalid_asset_type(monkeypatch, tmp_path):
    user_id = uuid4()
    monkeypatch.setattr(streams_routes.settings, "stream_dir", str(tmp_path))

    async with async_session_maker() as session:
        check = await session.execute(text("SELECT to_regclass('public.media_collections')"))
        if not check.scalar():
            pytest.skip("media_collections table not available in this test DB")
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@live-edit.test",
            subscription_tier="free",
        )
        session.add(profile)

        video_asset = Asset(
            user_id=user_id,
            filename="video.mp4",
            storage_path=str(Path(tmp_path) / "video.mp4"),
            size_bytes=1024,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )
        audio_asset = Asset(
            user_id=user_id,
            filename="song.mp3",
            storage_path=str(Path(tmp_path) / "song.mp3"),
            size_bytes=512,
            asset_type="audio",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )
        session.add_all([video_asset, audio_asset])

        collection = MediaCollection(
            user_id=user_id,
            name="Video",
            collection_type="video_background",
            is_active=True,
        )
        session.add(collection)
        await session.flush()

        session.add(
            CollectionItem(
                collection_id=collection.id,
                asset_id=video_asset.id,
                position=0,
                loop_mode="loop",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Static",
            status="running",
            mix_mode="video_only",
            video_collection_id=collection.id,
        )
        session.add(stream)
        await session.flush()

        payload = StreamLiveUpdateRequest(
            target="video",
            items=[
                CollectionItemCreate(asset_id=audio_asset.id, position=0, loop_mode="loop"),
            ],
        )

        with pytest.raises(streams_routes.HTTPException) as exc:
            await streams_routes.live_update_stream(
                stream.id,
                payload,
                user_deps=(session, user_id),
            )

        assert exc.value.status_code == 400

        result = await session.execute(
            select(CollectionItem)
            .where(CollectionItem.collection_id == collection.id)
            .order_by(CollectionItem.position)
        )
        items = result.scalars().all()
        assert [item.asset_id for item in items] == [video_asset.id]
