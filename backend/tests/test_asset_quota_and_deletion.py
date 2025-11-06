from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from sqlalchemy import select

from app.api.routes import assets, streams
from app.models.database import (
    Asset,
    Destination,
    Playlist,
    PlaylistItem,
    SystemAlert,
    UserActivityLog,
    UserProfile,
)
from app.schemas.api import AssetCreate, StreamCreate


async def _create_profile(db_session, user_id, *, storage_bytes: int = 0) -> UserProfile:
    profile = UserProfile(
        user_id=user_id,
        email=f"{user_id}@example.test",
        subscription_tier="free",
        subscription_status="active",
        current_storage_bytes=storage_bytes,
    )
    db_session.add(profile)
    await db_session.commit()
    return profile


@pytest.mark.asyncio
async def test_create_asset_updates_storage_usage(tmp_path, db_session):
    user_id = uuid4()
    await _create_profile(db_session, user_id)

    asset_path = tmp_path / "video.mp4"
    asset_data = AssetCreate(
        filename="video.mp4",
        storage_path=str(asset_path),
        size_bytes=1024,
        duration_seconds=None,
        meta=None,
        compatible_for_copy=False,
        validation_errors=[],
    )

    created = await assets.create_asset(asset_data, background_tasks=None, user_deps=(db_session, user_id))

    assert created.size_bytes == 1024

    refreshed_profile = await db_session.get(UserProfile, user_id)
    assert refreshed_profile.current_storage_bytes == 1024


@pytest.mark.asyncio
async def test_create_asset_respects_storage_quota(tmp_path, db_session):
    user_id = uuid4()
    nearly_full = 3 * 1024**3 - 50 * 1024**2
    await _create_profile(db_session, user_id, storage_bytes=nearly_full)

    asset_path = tmp_path / "large.mp4"
    asset_data = AssetCreate(
        filename="large.mp4",
        storage_path=str(asset_path),
        size_bytes=100 * 1024**2,
        duration_seconds=None,
        meta=None,
        compatible_for_copy=False,
        validation_errors=[],
    )

    with pytest.raises(HTTPException) as exc:
        await assets.create_asset(asset_data, background_tasks=None, user_deps=(db_session, user_id))

    assert exc.value.status_code == status.HTTP_402_PAYMENT_REQUIRED

    refreshed_profile = await db_session.get(UserProfile, user_id)
    assert refreshed_profile.current_storage_bytes == nearly_full


@pytest.mark.asyncio
async def test_delete_asset_updates_storage_and_logs(tmp_path, db_session):
    user_id = uuid4()
    await _create_profile(db_session, user_id)

    asset_path = tmp_path / "delete-me.mp4"
    asset_path.write_bytes(b"data")

    asset_data = AssetCreate(
        filename="delete-me.mp4",
        storage_path=str(asset_path),
        size_bytes=len(b"data"),
        duration_seconds=None,
        meta=None,
        compatible_for_copy=False,
        validation_errors=[],
    )

    created = await assets.create_asset(asset_data, background_tasks=None, user_deps=(db_session, user_id))

    await assets.delete_asset(created.id, user_deps=(db_session, user_id))

    remaining_asset = await db_session.get(Asset, created.id)
    assert remaining_asset is None

    refreshed_profile = await db_session.get(UserProfile, user_id)
    assert refreshed_profile.current_storage_bytes == 0

    activity_result = await db_session.execute(
        select(UserActivityLog).where(UserActivityLog.user_id == user_id)
    )
    activity = activity_result.scalars().one()
    assert activity.activity_type == "asset_deleted"
    assert activity.details["asset_id"] == str(created.id)


@pytest.mark.asyncio
async def test_delete_asset_blocked_when_in_use(tmp_path, db_session):
    user_id = uuid4()
    await _create_profile(db_session, user_id)

    asset_path = tmp_path / "linked.mp4"
    asset_path.write_bytes(b"video")

    asset_data = AssetCreate(
        filename="linked.mp4",
        storage_path=str(asset_path),
        size_bytes=len(b"video"),
        duration_seconds=None,
        meta=None,
        compatible_for_copy=False,
        validation_errors=[],
    )

    created = await assets.create_asset(asset_data, background_tasks=None, user_deps=(db_session, user_id))

    playlist = Playlist(user_id=user_id, name="Test", description="")
    db_session.add(playlist)
    await db_session.flush()

    playlist_item = PlaylistItem(playlist_id=playlist.id, asset_id=created.id, position=0)
    db_session.add(playlist_item)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await assets.delete_asset(created.id, user_deps=(db_session, user_id))

    assert exc.value.status_code == status.HTTP_409_CONFLICT
    assert exc.value.detail["error"] == "asset_in_use"

    alert_result = await db_session.execute(
        select(SystemAlert).where(SystemAlert.asset_id == created.id, SystemAlert.alert_type == "asset_in_use")
    )
    alert = alert_result.scalar_one()
    assert alert.severity == "warning"

    still_there = await db_session.get(Asset, created.id)
    assert still_there is not None


@pytest.mark.asyncio
async def test_stream_creation_rejects_audio_only_assets(db_session):
    user_id = uuid4()
    await _create_profile(db_session, user_id)

    destination = Destination(
        user_id=user_id,
        name="YouTube",
        rtmps_url="rtmps://example.com/live",
        stream_key_encrypted="encrypted",
    )
    db_session.add(destination)

    audio_only_asset = Asset(
        user_id=user_id,
        filename="audio.m4a",
        storage_path=f"/uploads/{user_id}/audio.m4a",
        size_bytes=1234,
        meta={"audio": {"codec": "aac"}},
    )
    db_session.add(audio_only_asset)
    await db_session.commit()

    request = StreamCreate(
        asset_ids=[audio_only_asset.id],
        destination_ids=[destination.id],
    )

    with pytest.raises(HTTPException) as exc:
        await streams.create_stream(request, user_deps=(db_session, user_id))

    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc.value.detail["error"] == "invalid_asset_type"
