import pytest
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.routes import assets as assets_routes
from app.core.database import async_session_maker
from app.models.database import (
    Asset,
    Playlist,
    PlaylistItem,
    UserActivityLog,
    UserProfile,
)


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

        results = await assets_routes.list_assets(asset_type="video", user_deps=(session, user_id))
        assert len(results) == 1
        assert results[0].filename == "video.mp4"

        results_audio = await assets_routes.list_assets(asset_type="audio", user_deps=(session, user_id))
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
            await assets_routes.list_assets(asset_type="document", user_deps=(session, user_id))
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

        results = await assets_routes.list_assets(folder_id=uuid4(), user_deps=(session, user_id))
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

        await assets_routes.delete_asset(asset.id, user_deps=(session, user_id), force=True)

        remaining = await session.get(Asset, asset.id)
        assert remaining is None

        log_row = (
            await session.execute(
                select(UserActivityLog)
                .where(UserActivityLog.user_id == user_id)
                .order_by(UserActivityLog.created_at.desc())
            )
        ).scalars().first()

        assert log_row is not None
        assert log_row.details["force"] is True
        assert log_row.details["usage"]["playlists"]

async def _ensure_asset_columns(session):
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'video'")
    )
    await session.execute(
        text("ALTER TABLE assets ALTER COLUMN asset_type SET NOT NULL")
    )
    await session.execute(
        text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS codec_info JSONB")
    )


async def _ensure_table(session, table_name: str):
    check = await session.execute(
        text(f"SELECT to_regclass('public.{table_name}')")
    )
    if not check.scalar():
        pytest.skip(f"{table_name} table not available in this test DB")
