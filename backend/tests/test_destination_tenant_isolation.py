"""Sprint 5 — Destination tenant-isolation contract tests.

The audit (2026-04-25) noted that all per-tenant DB queries should filter
by ``user_id`` consistently. These tests cover the critical surface where
a destination created by user A must not be readable, updatable, or
referenceable by user B's session.
"""
from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.database import async_engine, async_session_maker
from app.core.security import encrypt_stream_key
from app.models.database import Base, Destination, UserProfile
from app.services.destinations.service import DestinationService


pytestmark = pytest.mark.asyncio


_schema_lock = asyncio.Lock()


@pytest.fixture
async def db_session():
    """Isolated session for tenant-isolation tests.

    Local fixture (mirrors test_auth_multitenancy's pattern) so this file
    is self-contained. Truncates all tables on teardown.
    """
    async with _schema_lock:
        async with async_engine.begin() as conn:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS auth.users (
                        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                        email TEXT NOT NULL UNIQUE,
                        raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                        raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
                    )
                    """
                )
            )
            await conn.run_sync(Base.metadata.create_all)

    async with async_session_maker() as session:
        yield session
        await session.rollback()
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(
                text(f"TRUNCATE TABLE {table.fullname} RESTART IDENTITY CASCADE")
            )
        await session.commit()


async def _seed_user(session, user_id, email):
    await session.execute(
        text(
            """
            INSERT INTO auth.users (id, email)
            VALUES (:id, :email)
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {"id": str(user_id), "email": email},
    )
    profile = UserProfile(user_id=user_id, email=email, is_admin=False)
    session.add(profile)
    await session.flush()


async def _seed_destination(session, user_id, name="alice-dest"):
    dest = Destination(
        user_id=user_id,
        name=name,
        rtmps_url="rtmps://a.rtmp.youtube.com/live2",
        stream_key_encrypted=encrypt_stream_key("alice-secret-key"),
        enabled=True,
    )
    session.add(dest)
    await session.flush()
    return dest


async def test_user_b_cannot_list_user_a_destinations(db_session):
    user_a = uuid4()
    user_b = uuid4()

    await _seed_user(db_session, user_a, f"alice-{user_a}@example.com")
    await _seed_user(db_session, user_b, f"bob-{user_b}@example.com")
    await _seed_destination(db_session, user_a)
    await db_session.commit()

    list_a = await DestinationService(db_session, user_a).list_destinations()
    list_b = await DestinationService(db_session, user_b).list_destinations()

    assert len(list_a) == 1, "user_a must see their own destination"
    assert len(list_b) == 0, (
        "user_b must NOT see user_a's destination — list_destinations MUST "
        "filter by user_id"
    )


async def test_user_b_cannot_get_user_a_destination(db_session):
    user_a = uuid4()
    user_b = uuid4()

    await _seed_user(db_session, user_a, f"alice2-{user_a}@example.com")
    await _seed_user(db_session, user_b, f"bob2-{user_b}@example.com")
    dest = await _seed_destination(db_session, user_a)
    await db_session.commit()

    service_b = DestinationService(db_session, user_b)
    with pytest.raises(HTTPException) as exc_info:
        await service_b.get_destination(dest.id)
    assert exc_info.value.status_code == 404


async def test_user_b_cannot_delete_user_a_destination(db_session):
    user_a = uuid4()
    user_b = uuid4()

    await _seed_user(db_session, user_a, f"alice3-{user_a}@example.com")
    await _seed_user(db_session, user_b, f"bob3-{user_b}@example.com")
    dest = await _seed_destination(db_session, user_a)
    await db_session.commit()

    service_a = DestinationService(db_session, user_a)
    service_b = DestinationService(db_session, user_b)

    with pytest.raises(HTTPException) as exc_info:
        await service_b.delete_destination(dest.id)
    assert exc_info.value.status_code == 404

    list_a = await service_a.list_destinations()
    assert len(list_a) == 1
