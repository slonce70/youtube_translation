import pytest
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.routes import assets as assets_routes
from app.core.config import settings
from app.core.database import async_session_maker
from app.models.database import (
    Asset,
    Playlist,
    PlaylistItem,
    UserActivityLog,
    UserProfile,
)
from app.services.assets.service import AssetService


@pytest.mark.asyncio
async def test_list_assets_filters_by_type():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_asset_columns(session)
        await _ensure_table(session, "media_folders")
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
        )
        session.add(profile)

        session.add_all(
            [
                Asset(
                    user_id=user_id,
                    filename="video.mp4",
                    storage_path=f"/tmp/{uuid4()}-video.mp4",
                    size_bytes=1024,
                    asset_type="video",
                ),
                Asset(
                    user_id=user_id,
                    filename="track.aac",
                    storage_path=f"/tmp/{uuid4()}-track.aac",
                    size_bytes=2048,
                    asset_type="audio",
                ),
            ]
        )
        await session.commit()

        results = await assets_routes.list_assets(
            asset_type="video", user_deps=(session, user_id)
        )
        assert len(results) == 1
        assert results[0].filename == "video.mp4"

        results_audio = await assets_routes.list_assets(
            asset_type="audio", user_deps=(session, user_id)
        )
        assert len(results_audio) == 1
        assert results_audio[0].filename == "track.aac"


@pytest.mark.asyncio
async def test_list_assets_rejects_invalid_type():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_asset_columns(session)
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
        )
        session.add(profile)
        await session.commit()

        with pytest.raises(HTTPException) as exc:
            await assets_routes.list_assets(
                asset_type="document", user_deps=(session, user_id)
            )
        assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_list_assets_unknown_folder_returns_empty_list():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_asset_columns(session)
        await _ensure_table(session, "media_folders")
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
        )
        session.add(profile)
        await session.commit()

        results = await assets_routes.list_assets(
            folder_id=uuid4(), user_deps=(session, user_id)
        )
        assert results == []


@pytest.mark.asyncio
async def test_delete_asset_requires_force_when_in_use():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_asset_columns(session)
        await _ensure_table(session, "media_collections")
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
        )
        session.add(profile)
        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{uuid4()}-clip.mp4",
            size_bytes=512,
            asset_type="video",
        )
        playlist = Playlist(user_id=user_id, name="BG")
        session.add_all([asset, playlist])
        await session.flush()
        session.add(
            PlaylistItem(
                playlist_id=playlist.id,
                asset_id=asset.id,
                position=0,
            )
        )
        await session.commit()

        with pytest.raises(HTTPException) as exc:
            await assets_routes.delete_asset(asset.id, user_deps=(session, user_id))

        assert exc.value.status_code == 409
        detail = exc.value.detail
        assert detail["error"] == "asset_in_use"
        assert detail["usage"]["playlists"]


@pytest.mark.asyncio
async def test_delete_asset_force_records_activity():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_asset_columns(session)
        await _ensure_table(session, "media_collections")
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
        )
        session.add(profile)
        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{uuid4()}-clip.mp4",
            size_bytes=512,
            asset_type="video",
        )
        playlist = Playlist(user_id=user_id, name="BG")
        session.add_all([asset, playlist])
        await session.flush()
        session.add(
            PlaylistItem(
                playlist_id=playlist.id,
                asset_id=asset.id,
                position=0,
            )
        )
        await session.commit()

        await assets_routes.delete_asset(
            asset.id, user_deps=(session, user_id), force=True
        )

        remaining = await session.get(Asset, asset.id)
        assert remaining is None

        log_row = (
            (
                await session.execute(
                    select(UserActivityLog)
                    .where(UserActivityLog.user_id == user_id)
                    .order_by(UserActivityLog.created_at.desc())
                )
            )
            .scalars()
            .first()
        )

        assert log_row is not None
        assert log_row.details["force"] is True
        assert log_row.details["usage"]["playlists"]


@pytest.mark.asyncio
async def test_delete_asset_failed_transaction_keeps_file_on_disk(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    asset_path = user_dir / "clip.mp4"
    asset_path.write_text("video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        async with async_session_maker() as session:
            await _ensure_asset_columns(session)
            await _ensure_table(session, "media_collections")
            profile = UserProfile(
                user_id=user_id,
                email=f"{uuid4()}@example.com",
                subscription_tier="free",
            )
            asset = Asset(
                user_id=user_id,
                filename="clip.mp4",
                storage_path=str(asset_path),
                size_bytes=512,
                asset_type="video",
            )
            session.add_all([profile, asset])
            await session.commit()
            asset_id = asset.id

            async def fail_storage_delta(*_args, **_kwargs):
                raise RuntimeError("simulated storage update failure")

            monkeypatch.setattr(
                "app.services.assets.service.apply_storage_delta", fail_storage_delta
            )

            service = AssetService(session, user_id)
            with pytest.raises(RuntimeError, match="simulated storage update failure"):
                await service.delete_asset(asset_id, force=True)

            await session.rollback()

            assert asset_path.exists()
            remaining = await session.get(Asset, asset_id)
            assert remaining is not None
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_optimize_asset_marks_copy_ready_asset_as_ready(tmp_path):
    user_id = uuid4()
    upload_dir = tmp_path / "uploads" / str(user_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(tmp_path / "uploads")
    file_path = upload_dir / "ready.mp4"
    file_path.write_text("video")

    try:
        async with async_session_maker() as session:
            await _ensure_asset_columns(session)
            profile = UserProfile(
                user_id=user_id,
                email=f"{uuid4()}@example.com",
                subscription_tier="free",
            )
            asset = Asset(
                user_id=user_id,
                filename="ready.mp4",
                storage_path=str(file_path),
                size_bytes=file_path.stat().st_size,
                asset_type="video",
                compatible_for_copy=True,
            )
            session.add_all([profile, asset])
            await session.commit()

            response = await assets_routes.optimize_asset(
                asset.id, user_deps=(session, user_id)
            )

            assert response.optimization.status == "ready"
            assert response.optimization.strategy == "copy"
            assert response.optimization.optimized_storage_path == str(file_path)
            assert response.optimization.recommended_strategy == "copy"
            assert response.optimization.can_stream_from_source is True
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_optimize_asset_queues_transcode_for_incompatible_asset(tmp_path):
    user_id = uuid4()
    upload_dir = tmp_path / "uploads" / str(user_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(tmp_path / "uploads")
    file_path = upload_dir / "needs-transcode.mov"
    file_path.write_text("video")

    try:
        async with async_session_maker() as session:
            await _ensure_asset_columns(session)
            profile = UserProfile(
                user_id=user_id,
                email=f"{uuid4()}@example.com",
                subscription_tier="free",
            )
            asset = Asset(
                user_id=user_id,
                filename="needs-transcode.mov",
                storage_path=str(file_path),
                size_bytes=file_path.stat().st_size,
                asset_type="video",
                compatible_for_copy=False,
            )
            session.add_all([profile, asset])
            await session.commit()

            response = await assets_routes.optimize_asset(
                asset.id, user_deps=(session, user_id)
            )

            assert response.optimization.status == "queued"
            assert response.optimization.strategy == "transcode"
            assert response.optimization.optimized_storage_path is None
            assert response.optimization.recommended_strategy == "transcode"
            assert response.optimization.can_stream_from_source is False
    finally:
        settings.upload_dir = original_upload_dir


async def _ensure_asset_columns(session):
    await session.execute(
        text(
            "ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'video'"
        )
    )
    await session.execute(
        text("ALTER TABLE assets ALTER COLUMN asset_type SET NOT NULL")
    )
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS codec_info JSONB")
    )
    await session.execute(
        text(
            "ALTER TABLE assets ADD COLUMN IF NOT EXISTS optimization_status TEXT DEFAULT 'not_requested'"
        )
    )
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS optimization_strategy TEXT")
    )
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS optimized_storage_path TEXT")
    )
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS optimization_error TEXT")
    )
    await session.execute(
        text(
            "ALTER TABLE assets ADD COLUMN IF NOT EXISTS optimization_updated_at TIMESTAMPTZ"
        )
    )


async def _ensure_table(session, table_name: str):
    check = await session.execute(text(f"SELECT to_regclass('public.{table_name}')"))
    if not check.scalar():
        pytest.skip(f"{table_name} table not available in this test DB")
