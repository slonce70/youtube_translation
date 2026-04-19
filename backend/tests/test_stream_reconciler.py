from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_maker
from app.core.stream_reconciler import periodic_reconciliation, restart_due_streams
from app.core.stream_runtime_heartbeat import write_runtime_heartbeat
from app.models.database import Stream, UserProfile


@pytest.mark.asyncio
async def test_periodic_reconciliation_keeps_systemd_stream_starting_until_runtime_confirmation(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")

    async def _active_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr("app.core.stream_reconciler.systemd_unit_status", _active_status)

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@systemd-starting.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="systemd-starting",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "starting"
        assert stream.started_at is None


@pytest.mark.asyncio
async def test_periodic_reconciliation_confirms_systemd_running_from_fresh_heartbeat(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 15)

    async def _active_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr("app.core.stream_reconciler.systemd_unit_status", _active_status)

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@systemd-running.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="systemd-running",
            status="starting",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        write_runtime_heartbeat(
            stream.id,
            runner_pid=888,
            runtime_mode="systemd",
        )

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "running"
        assert stream.started_at is not None
        assert stream.runtime_last_heartbeat_at is not None


@pytest.mark.asyncio
async def test_periodic_reconciliation_marks_systemd_stream_error_without_restart_queue(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 15)

    async def _active_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr("app.core.stream_reconciler.systemd_unit_status", _active_status)

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@systemd-stale.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="systemd-stale",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        write_runtime_heartbeat(
            stream.id,
            runner_pid=999,
            runtime_mode="systemd",
            now=datetime.now(timezone.utc) - timedelta(seconds=60),
            ttl_seconds=5,
        )

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "error"
        assert stream.error_message is not None
        assert "heartbeat expired" in stream.error_message


@pytest.mark.asyncio
async def test_periodic_reconciliation_marks_systemd_stream_stopped_when_unit_is_inactive(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")

    async def _inactive_status(_stream_id):
        return {"ActiveState": "inactive", "SubState": "dead"}

    monkeypatch.setattr(
        "app.core.stream_reconciler.systemd_unit_status", _inactive_status
    )

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@systemd-inactive.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="systemd-inactive",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "stopped"
        assert stream.stopped_at is not None


@pytest.mark.asyncio
async def test_restart_due_streams_skips_systemd_mode(monkeypatch):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")

    async with async_session_maker() as session:
        streams_table = await session.execute(
            text("SELECT to_regclass('public.streams')")
        )
        if not streams_table.scalar():
            pytest.skip("streams table not available in this test DB")

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@restart-due-systemd.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Needs no restart dispatch",
            status="error",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        count = await restart_due_streams(session, batch_size=100)

        assert count == 0
