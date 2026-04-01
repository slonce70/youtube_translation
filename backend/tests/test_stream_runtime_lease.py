import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.stream_runtime_lease import (
    claim_stream_runtime_lease,
    release_stream_runtime_lease,
    renew_stream_runtime_lease,
)
from app.models.database import Stream, UserProfile
from app.services.streams.control import StreamControlService


@pytest.mark.asyncio
async def test_runtime_lease_claim_blocks_other_owner() -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@lease.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            name="Lease stream",
            status="stopped",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        acquired = await claim_stream_runtime_lease(
            session, stream.id, owner_id="node-a", ttl_seconds=60
        )
        await session.commit()
        assert acquired.acquired is True

        blocked = await claim_stream_runtime_lease(
            session, stream.id, owner_id="node-b", ttl_seconds=60
        )
        assert blocked.acquired is False
        assert blocked.owner_id == "node-a"


@pytest.mark.asyncio
async def test_runtime_lease_can_be_reclaimed_after_expiry() -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@lease-expiry.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            name="Lease stream",
            status="stopped",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await claim_stream_runtime_lease(
            session,
            stream.id,
            owner_id="node-a",
            now=datetime.now(timezone.utc) - timedelta(seconds=120),
            ttl_seconds=5,
        )
        await session.commit()

        renewed = await renew_stream_runtime_lease(
            session, stream.id, owner_id="node-b", ttl_seconds=30
        )
        await session.commit()
        await session.refresh(stream)

        assert renewed is True
        assert stream.runtime_owner_id == "node-b"


@pytest.mark.asyncio
async def test_release_stream_runtime_lease_respects_owner() -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@lease-release.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            name="Lease stream",
            status="stopped",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await claim_stream_runtime_lease(
            session, stream.id, owner_id="node-a", ttl_seconds=60
        )
        await session.commit()

        assert (
            await release_stream_runtime_lease(session, stream.id, owner_id="node-b")
            is False
        )
        assert (
            await release_stream_runtime_lease(session, stream.id, owner_id="node-a")
            is True
        )
        await session.commit()
        await session.refresh(stream)

        assert stream.runtime_owner_id is None


class _DummyManager:
    async def start_stream(self, *args, **kwargs):
        return True

    def get_stream_info(self, _stream_id):
        return {"pid": 4321, "uptime_seconds": 0}

    def is_running(self, _stream_id):
        return False


@pytest.mark.asyncio
async def test_control_start_stream_rejects_active_foreign_runtime_lease(
    monkeypatch, tmp_path
) -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@lease-control.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            name="Lease stream",
            status="stopped",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await claim_stream_runtime_lease(
            session, stream.id, owner_id="remote-node", ttl_seconds=60
        )
        await session.commit()

        async def _prepare_launch(*args, **kwargs):
            return [], [], Path(tmp_path / "lease.log")

        monkeypatch.setattr(
            "app.services.streams.control.prepare_stream_launch", _prepare_launch
        )

        service = StreamControlService(session, user_id, manager=_DummyManager())

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream.id)

        assert exc_info.value.status_code == 409
        assert "managed by another runtime node" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_control_start_stream_serializes_concurrent_starts_per_user(
    monkeypatch, tmp_path
) -> None:
    user_id = uuid4()

    class _SlowManager(_DummyManager):
        async def start_stream(self, *args, **kwargs):
            await asyncio.sleep(0.1)
            return True

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@quota-race.test",
                subscription_tier="free",
            )
        )
        stream_a = Stream(
            user_id=user_id, name="Stream A", status="stopped", mix_mode="video_only"
        )
        stream_b = Stream(
            user_id=user_id, name="Stream B", status="stopped", mix_mode="video_only"
        )
        session.add_all([stream_a, stream_b])
        await session.commit()
        stream_a_id = stream_a.id
        stream_b_id = stream_b.id

    async def _prepare_launch(*args, **kwargs):
        stream = args[2]
        return [], [], Path(tmp_path / f"{stream.id}.log")

    monkeypatch.setattr(
        "app.services.streams.control.prepare_stream_launch", _prepare_launch
    )

    async def _start(stream_id):
        async with async_session_maker() as session:
            service = StreamControlService(session, user_id, manager=_SlowManager())
            try:
                status = await service.start_stream(stream_id)
                return ("ok", status.status)
            except HTTPException as exc:
                return ("error", exc.status_code)

    results = await asyncio.gather(_start(stream_a_id), _start(stream_b_id))

    assert results.count(("ok", "running")) == 1
    assert results.count(("error", 402)) == 1
