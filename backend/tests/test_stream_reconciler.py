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
async def test_periodic_reconciliation_marks_running_stream_error_when_heartbeat_is_stale(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "supervisor")
    monkeypatch.setattr(settings, "stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 15)
    monkeypatch.setattr(settings, "stream_runtime_restart_backoff_seconds", 0)
    monkeypatch.setattr(settings, "stream_runtime_restart_backoff_max_seconds", 0)
    monkeypatch.setattr(settings, "stream_runtime_restart_jitter_seconds", 0)
    monkeypatch.setattr("app.core.stream_reconciler.supervisor_enabled", lambda: True)
    monkeypatch.setattr("app.core.stream_reconciler.systemd_enabled", lambda: False)

    async def _running_status(_stream_id):
        return {"state": "RUNNING", "details": "pid 123"}

    monkeypatch.setattr(
        "app.core.stream_reconciler.supervisor_program_status", _running_status
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
                email=f"{user_id}@reconciler.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Managed stream",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        stale_now = datetime.now(timezone.utc) - timedelta(seconds=60)
        write_runtime_heartbeat(
            stream.id,
            runner_pid=777,
            runtime_mode="supervisor",
            now=stale_now,
            ttl_seconds=5,
        )

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "error"
        assert stream.error_message is not None
        assert "heartbeat expired" in stream.error_message
        assert "Auto-restart scheduled" in stream.error_message
        assert stream.runtime_owner_id is None
        assert stream.runtime_lease_expires_at is None
        assert stream.runtime_restart_attempts == 1
        assert stream.runtime_next_restart_at is not None


@pytest.mark.asyncio
async def test_periodic_reconciliation_repairs_runtime_lease_from_fresh_heartbeat(
    monkeypatch,
    tmp_path,
):
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_mode", "supervisor")
    monkeypatch.setattr(settings, "stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 15)
    monkeypatch.setattr("app.core.stream_reconciler.supervisor_enabled", lambda: True)
    monkeypatch.setattr("app.core.stream_reconciler.systemd_enabled", lambda: False)

    async def _running_status(_stream_id):
        return {"state": "RUNNING", "details": "pid 123"}

    monkeypatch.setattr(
        "app.core.stream_reconciler.supervisor_program_status", _running_status
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
                email=f"{user_id}@reconciler.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Managed stream",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        write_runtime_heartbeat(
            stream.id,
            runner_pid=777,
            runtime_mode="supervisor",
        )

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "running"
        assert stream.runtime_owner_id == settings.stream_runtime_node_id
        assert stream.runtime_lease_expires_at is not None


@pytest.mark.asyncio
async def test_periodic_reconciliation_schedules_restart_when_runtime_exits(
    monkeypatch,
) -> None:
    user_id = uuid4()

    monkeypatch.setattr(settings, "stream_runtime_mode", "supervisor")
    monkeypatch.setattr(settings, "stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr(settings, "stream_runtime_restart_backoff_seconds", 0)
    monkeypatch.setattr(settings, "stream_runtime_restart_backoff_max_seconds", 0)
    monkeypatch.setattr(settings, "stream_runtime_restart_jitter_seconds", 0)
    monkeypatch.setattr("app.core.stream_reconciler.supervisor_enabled", lambda: True)
    monkeypatch.setattr("app.core.stream_reconciler.systemd_enabled", lambda: False)

    async def _exited_status(_stream_id):
        return {"state": "EXITED", "details": "process exited unexpectedly"}

    monkeypatch.setattr(
        "app.core.stream_reconciler.supervisor_program_status", _exited_status
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
                email=f"{user_id}@reconciler.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Managed stream",
            status="running",
            mix_mode="video_only",
        )
        session.add(stream)
        await session.commit()

        await periodic_reconciliation(session)
        await session.refresh(stream)

        assert stream.status == "error"
        assert stream.runtime_restart_attempts == 1
        assert stream.runtime_next_restart_at is not None
        assert stream.error_message is not None
        assert "Runtime state EXITED" in stream.error_message


@pytest.mark.asyncio
async def test_restart_due_streams_dispatches_orchestrated_restart(monkeypatch):
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    monkeypatch.setattr(settings, "stream_runtime_mode", "supervisor")
    monkeypatch.setattr(settings, "stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_reconciler.supervisor_enabled", lambda: True)
    monkeypatch.setattr("app.core.stream_reconciler.systemd_enabled", lambda: False)

    restarted = []

    async def _restart_stream(self, stream_id, live_target=None, *, orchestrated=False):
        restarted.append((stream_id, orchestrated))

    monkeypatch.setattr(
        "app.core.stream_reconciler.StreamControlService.restart_stream",
        _restart_stream,
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
                email=f"{user_id}@restart-due.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Needs restart",
            status="error",
            mix_mode="video_only",
            runtime_restart_attempts=1,
            runtime_next_restart_at=now - timedelta(seconds=1),
        )
        session.add(stream)
        await session.commit()

        count = await restart_due_streams(session, batch_size=100)

        assert count >= 1
        assert (stream.id, True) in restarted


@pytest.mark.asyncio
async def test_restart_due_streams_dispatches_queued_restart_even_if_status_was_downgraded(
    monkeypatch,
):
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    monkeypatch.setattr(settings, "stream_runtime_mode", "supervisor")
    monkeypatch.setattr(settings, "stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_reconciler.supervisor_enabled", lambda: True)
    monkeypatch.setattr("app.core.stream_reconciler.systemd_enabled", lambda: False)

    restarted = []

    async def _restart_stream(self, stream_id, live_target=None, *, orchestrated=False):
        restarted.append((stream_id, orchestrated))

    monkeypatch.setattr(
        "app.core.stream_reconciler.StreamControlService.restart_stream",
        _restart_stream,
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
                email=f"{user_id}@restart-due-downgraded.test",
                subscription_tier="free",
            )
        )

        stream = Stream(
            user_id=user_id,
            name="Downgraded queued restart",
            status="stopped",
            mix_mode="video_only",
            runtime_restart_attempts=1,
            runtime_next_restart_at=now - timedelta(seconds=1),
        )
        session.add(stream)
        await session.commit()

        count = await restart_due_streams(session, batch_size=100)

        assert count >= 1
        assert (stream.id, True) in restarted
