"""Tests for authentication dependencies and multi-tenant scoping."""

import asyncio

import jwt
import pytest

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text

from app.api import deps
from app.api.routes import assets, destinations, playlists, quota, streams
from app.core.config import settings
from app.models.database import (
    Asset,
    Destination,
    Playlist,
    PlaylistItem,
    Stream,
    SubscriptionTierLimits,
    UserProfile,
)


_schema_reset_lock = asyncio.Lock()


@pytest.mark.asyncio
async def test_supabase_user_cache_reuses_fetch(monkeypatch):
    """Ensure Supabase lookups are cached between calls with the same token."""

    deps.clear_user_cache()

    fetch_calls = 0

    async def _fake_fetch(token: str):
        nonlocal fetch_calls
        fetch_calls += 1
        return SimpleNamespace(
            user=SimpleNamespace(
                id="user-123",
                email="user@example.com",
                user_metadata={"plan": "fhd_flow"},
            )
        )

    monkeypatch.setattr(deps, "_fetch_supabase_user", _fake_fetch)

    exp = datetime.now(timezone.utc) + timedelta(minutes=5)
    token_payload = {
        "sub": "user-123",
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(
        token_payload, settings.supabase_jwt_secret, algorithm=settings.algorithm
    )
    auth_header = f"Bearer {token}"

    first_user = await deps.get_current_user(authorization=auth_header)
    second_user = await deps.get_current_user(authorization=auth_header)

    assert first_user == second_user
    assert first_user["sub"] == "user-123"
    assert fetch_calls == 1, "Supabase fetch should be cached for identical tokens"


@pytest.mark.asyncio
async def test_supabase_user_cache_respects_exp(monkeypatch):
    """Cache should be skipped when token is near expiry."""

    deps.clear_user_cache()

    # Force cache TTL to be large but provide exp in the past to bypass storage
    monkeypatch.setattr(settings, "supabase_user_cache_ttl_seconds", 300)

    fetch_calls = 0

    async def _fake_fetch(token: str):
        nonlocal fetch_calls
        fetch_calls += 1
        return SimpleNamespace(
            user=SimpleNamespace(
                id="user-456",
                email="late@example.com",
                user_metadata={},
            )
        )

    monkeypatch.setattr(deps, "_fetch_supabase_user", _fake_fetch)

    # Token expiring within the leeway window should not be cached
    exp = datetime.now(timezone.utc) + timedelta(seconds=1)
    token_payload = {
        "sub": "user-456",
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(
        token_payload, settings.supabase_jwt_secret, algorithm=settings.algorithm
    )
    auth_header = f"Bearer {token}"

    await deps.get_current_user(authorization=auth_header)
    await deps.get_current_user(authorization=auth_header)

    assert fetch_calls == 2, "Expiring tokens should not be cached"


@pytest.mark.asyncio
async def test_ensure_user_profile_rejects_email_collision_for_new_subject(db_session):
    existing_user_id = uuid4()
    conflicting_user_id = uuid4()
    email = f"shared-{existing_user_id}@example.test"

    await _ensure_user_profile(
        db_session,
        existing_user_id,
        email,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await deps._ensure_user_profile(
            db_session,
            {
                "sub": str(conflicting_user_id),
                "email": email,
                "user_metadata": {"full_name": "Conflicting User"},
            },
        )

    assert exc.value.status_code == 409
    assert await db_session.get(UserProfile, conflicting_user_id) is None
    existing_profile = await db_session.get(UserProfile, existing_user_id)
    assert existing_profile is not None
    assert existing_profile.email == email


@pytest.mark.asyncio
async def test_ensure_user_profile_rejects_email_collision_for_existing_subject(
    db_session,
):
    user_a = uuid4()
    user_b = uuid4()
    email_a = f"user-a-{user_a}@example.test"
    email_b = f"user-b-{user_b}@example.test"

    await _ensure_user_profile(
        db_session,
        user_a,
        email_a,
        subscription_tier="free",
        subscription_status="active",
    )
    await _ensure_user_profile(
        db_session,
        user_b,
        email_b,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await deps._ensure_user_profile(
            db_session,
            {
                "sub": str(user_b),
                "email": email_a,
                "user_metadata": {"full_name": "User B"},
            },
        )

    assert exc.value.status_code == 409
    profile_a = await db_session.get(UserProfile, user_a)
    profile_b = await db_session.get(UserProfile, user_b)
    assert profile_a is not None
    assert profile_b is not None
    assert profile_a.email == email_a
    assert profile_b.email == email_b


@pytest.mark.asyncio
async def test_assets_are_scoped_per_user(db_session):
    """Assets endpoints should only expose data for the authenticated user."""

    user_a = uuid4()
    user_b = uuid4()

    email_a = f"{user_a}@example.test"
    email_b = f"{user_b}@example.test"

    await _ensure_user_profile(
        db_session,
        user_a,
        email_a,
        subscription_tier="free",
        subscription_status="active",
    )
    await _ensure_user_profile(
        db_session,
        user_b,
        email_b,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.flush()

    asset_a = Asset(
        user_id=user_a,
        filename="a.mp4",
        storage_path=f"/uploads/{user_a}/a.mp4",
        size_bytes=1024,
    )
    asset_b = Asset(
        user_id=user_b,
        filename="b.mp4",
        storage_path=f"/uploads/{user_b}/b.mp4",
        size_bytes=2048,
    )
    db_session.add_all([asset_a, asset_b])
    await db_session.commit()

    assets_for_a = await assets.list_assets(user_deps=(db_session, user_a))
    assert len(assets_for_a) == 1
    assert assets_for_a[0].user_id == user_a

    with pytest.raises(HTTPException) as exc:
        await assets.get_asset(asset_a.id, user_deps=(db_session, user_b))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_playlists_are_scoped_per_user(db_session):
    """Playlists endpoints must prevent cross-tenant access."""

    user_a = uuid4()
    user_b = uuid4()

    email_a = f"{user_a}@example.test"
    email_b = f"{user_b}@example.test"

    await _ensure_user_profile(
        db_session,
        user_a,
        email_a,
        subscription_tier="free",
        subscription_status="active",
    )
    await _ensure_user_profile(
        db_session,
        user_b,
        email_b,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.flush()

    asset_a = Asset(
        user_id=user_a,
        filename="a.mp4",
        storage_path=f"/uploads/{user_a}/a.mp4",
        size_bytes=1024,
    )
    db_session.add(asset_a)
    await db_session.flush()

    playlist = Playlist(user_id=user_a, name="A", description="")
    db_session.add(playlist)
    await db_session.flush()

    playlist_item = PlaylistItem(
        playlist_id=playlist.id,
        asset_id=asset_a.id,
        position=1,
    )
    db_session.add(playlist_item)
    await db_session.commit()

    playlists_for_a = await playlists.list_playlists(user_deps=(db_session, user_a))
    assert len(playlists_for_a) == 1
    assert playlists_for_a[0].user_id == user_a

    with pytest.raises(HTTPException) as exc:
        await playlists.get_playlist(playlist.id, user_deps=(db_session, user_b))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_destinations_are_scoped_per_user(db_session):
    """Destination endpoints should mask data and enforce ownership."""

    user_a = uuid4()
    user_b = uuid4()

    email_a = f"{user_a}@example.test"
    email_b = f"{user_b}@example.test"

    await _ensure_user_profile(
        db_session,
        user_a,
        email_a,
        subscription_tier="free",
        subscription_status="active",
    )
    await _ensure_user_profile(
        db_session,
        user_b,
        email_b,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.flush()

    dest_a = Destination(
        user_id=user_a,
        name="A",
        rtmps_url="rtmps://a.rtmp.youtube.com/live2",
        stream_key_encrypted="encrypted-a",
    )
    dest_b = Destination(
        user_id=user_b,
        name="B",
        rtmps_url="rtmps://b.rtmp.youtube.com/live2",
        stream_key_encrypted="encrypted-b",
    )
    db_session.add_all([dest_a, dest_b])
    await db_session.commit()

    destinations_for_a = await destinations.list_destinations(
        user_deps=(db_session, user_a)
    )
    assert len(destinations_for_a) == 1
    assert destinations_for_a[0]["name"] == "A"

    with pytest.raises(HTTPException) as exc:
        await destinations.get_destination(dest_b.id, user_deps=(db_session, user_a))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_streams_are_scoped_per_user(db_session):
    """Streams endpoints should not leak other users' streams."""

    user_a = uuid4()
    user_b = uuid4()

    email_a = f"{user_a}@example.test"
    email_b = f"{user_b}@example.test"

    await _ensure_user_profile(
        db_session,
        user_a,
        email_a,
        subscription_tier="free",
        subscription_status="active",
    )
    await _ensure_user_profile(
        db_session,
        user_b,
        email_b,
        subscription_tier="free",
        subscription_status="active",
    )
    await db_session.flush()

    playlist_a = Playlist(user_id=user_a, name="Playlist A")
    playlist_b = Playlist(user_id=user_b, name="Playlist B")
    db_session.add_all([playlist_a, playlist_b])
    await db_session.flush()

    stream_a = Stream(
        user_id=user_a, playlist_id=playlist_a.id, name="Stream A", status="stopped"
    )
    stream_b = Stream(
        user_id=user_b, playlist_id=playlist_b.id, name="Stream B", status="running"
    )
    db_session.add_all([stream_a, stream_b])
    await db_session.commit()

    streams_for_a = await streams.list_streams(user_deps=(db_session, user_a))
    assert len(streams_for_a) == 1
    assert streams_for_a[0].user_id == user_a

    streams_for_b = await streams.list_streams(user_deps=(db_session, user_b))
    assert len(streams_for_b) == 1
    assert streams_for_b[0].status == "running"


@pytest.mark.asyncio
async def test_quota_endpoint_uses_authenticated_user(db_session):
    """Quota usage should be calculated based on the authenticated user context."""

    user_id = uuid4()
    other_user_id = uuid4()

    email_owner = f"{user_id}@example.test"
    email_other = f"{other_user_id}@example.test"

    await _ensure_user_profile(
        db_session,
        user_id,
        email_owner,
        subscription_tier="free",
        subscription_status="active",
        current_storage_bytes=5 * 1024**2,
    )
    await _ensure_user_profile(
        db_session,
        other_user_id,
        email_other,
        subscription_tier="free",
        subscription_status="active",
        current_storage_bytes=0,
    )
    await db_session.flush()

    asset = Asset(
        user_id=user_id,
        filename="quota.mp4",
        storage_path=f"/uploads/{user_id}/quota.mp4",
        size_bytes=1024,
    )
    destination = Destination(
        user_id=user_id,
        name="QuotaDest",
        rtmps_url="rtmps://a.rtmp.youtube.com/live2",
        stream_key_encrypted="encrypted",
    )
    playlist = Playlist(user_id=user_id, name="Quota Playlist")
    db_session.add_all([asset, destination, playlist])
    await db_session.flush()

    stream = Stream(
        user_id=user_id,
        playlist_id=playlist.id,
        name="Quota Stream",
        status="running",
    )
    db_session.add_all([asset, destination, playlist, stream])

    await db_session.commit()

    response = await quota.get_user_quota(user_deps=(db_session, user_id))
    assert response.tier == "free"
    assert response.assets["count"] == 1
    assert response.destinations["count"] == 1
    assert response.streams["active"] == 1

    # Ensure other user has separate counts
    response_other = await quota.get_user_quota(user_deps=(db_session, other_user_id))
    assert response_other.assets["count"] == 0
    assert response_other.streams["active"] == 0


@pytest.fixture
async def db_session():
    """Create and tear down an isolated test database session."""

    from sqlalchemy import text

    from app.core.database import async_engine, async_session_maker
    from app.models.database import Base

    # Ensure schema exists (serialised to avoid concurrent DDL)
    async with _schema_reset_lock:
        async with async_engine.begin() as conn:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS public"))
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
            view_names = [
                "unresolved_critical_alerts",
                "recent_admin_actions",
                "recent_user_activity",
            ]
            for view in view_names:
                await conn.execute(text(f"DROP VIEW IF EXISTS {view}"))
            await conn.run_sync(Base.metadata.create_all)
            alter_statements = [
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS daily_streaming_limit_hours INTEGER",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN DEFAULT FALSE",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS branding_enabled BOOLEAN DEFAULT FALSE",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT FALSE",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS priority_support_level TEXT",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS dedicated_manager BOOLEAN DEFAULT FALSE",
                "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS allowed_video_codecs TEXT[]",
            ]
            for statement in alter_statements:
                await conn.execute(text(statement))

    async with async_session_maker() as session:
        # Seed tier limits if missing
        existing = await session.execute(select(SubscriptionTierLimits))
        if not existing.scalars().first():
            tiers = [
                {
                    "tier": "free",
                    "storage_gb": 3,
                    "max_concurrent_streams": 1,
                    "max_destinations": 1,
                    "max_playlists": 5,
                    "max_assets": 20,
                    "daily_streaming_limit_hours": 8,
                    "allowed_video_codecs": ["h264"],
                },
                {
                    "tier": "fhd_flow",
                    "storage_gb": 100,
                    "max_concurrent_streams": 2,
                    "max_destinations": 6,
                    "max_playlists": 25,
                    "max_assets": 200,
                    "daily_streaming_limit_hours": None,
                    "allowed_video_codecs": ["h264"],
                },
            ]
            for data in tiers:
                session.add(SubscriptionTierLimits(**data))
            await session.commit()

        yield session

        await session.rollback()
        # Truncate all mutable tables while keeping schema/views intact
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(
                text(f"TRUNCATE TABLE {table.fullname} RESTART IDENTITY CASCADE")
            )
        await session.commit()


async def _ensure_auth_user(session, user_id, email):
    await session.execute(
        text(
            """
            INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
            VALUES (:id, :email, '{}'::jsonb, '{}'::jsonb, timezone('utc', now()), timezone('utc', now()))
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {"id": str(user_id), "email": email},
    )


async def _ensure_user_profile(session, user_id, email, **kwargs):
    await _ensure_auth_user(session, user_id, email)
    profile = await session.get(UserProfile, user_id)
    if profile:
        for key, value in kwargs.items():
            setattr(profile, key, value)
        return profile

    profile = UserProfile(user_id=user_id, email=email, **kwargs)
    session.add(profile)
    return profile
