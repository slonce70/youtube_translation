import pytest
from datetime import datetime, timezone
from uuid import uuid4

import app.services.streams.control as streams_control
from app.core.database import async_session_maker
from sqlalchemy import select

from app.models.database import Stream, StreamEvent, UserProfile
from app.services.streams.control import StreamControlService


@pytest.mark.asyncio
async def test_stop_stream_removes_supervisor_program(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-user-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="auto-start stream",
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)

        async def fake_is_running(stream_id):
            return False

        async def fake_stop_program(stream_id):
            raise AssertionError("stop_program should not be called when stream is already stopped")

        removed = {"stream_id": None}

        async def fake_remove_program(stream_id):
            removed["stream_id"] = stream_id

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(streams_control, "supervisor_stop_program", fake_stop_program)
        monkeypatch.setattr(streams_control, "supervisor_remove_program", fake_remove_program)
        monkeypatch.setattr(StreamControlService, "_get_usage_snapshot", fake_usage_snapshot, raising=False)

        service = StreamControlService(session, user_id)
        status = await service.stop_stream(stream.id)

        assert status.status == "stopped"
        assert removed["stream_id"] == stream.id


@pytest.mark.asyncio
async def test_stop_stream_ignores_racy_removed_process_group_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-race-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="racy stop stream",
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)

        async def fake_is_running(stream_id):
            assert stream_id == stream.id
            return True

        async def fake_stop_program(stream_id):
            assert stream_id == stream.id
            raise RuntimeError(f"stream_{stream_id}: removed process group")

        removed = {"stream_id": None}

        async def fake_remove_program(stream_id):
            removed["stream_id"] = stream_id

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(streams_control, "supervisor_stop_program", fake_stop_program)
        monkeypatch.setattr(
            streams_control,
            "supervisor_remove_program",
            fake_remove_program,
        )
        monkeypatch.setattr(
            StreamControlService,
            "_get_usage_snapshot",
            fake_usage_snapshot,
            raising=False,
        )

        service = StreamControlService(session, user_id)
        status = await service.stop_stream(stream.id)

        assert status.status == "stopped"
        assert removed["stream_id"] == stream.id


@pytest.mark.asyncio
async def test_stop_stream_marks_supervisor_stream_stopping_while_stop_is_in_flight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-stopping-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="slow stop stream",
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)

        async def fake_is_running(stream_id):
            assert stream_id == stream.id
            return True

        observed = {"status": None}

        async def fake_stop_program(stream_id):
            assert stream_id == stream.id
            await session.refresh(stream)
            observed["status"] = stream.status

        removed = {"stream_id": None}

        async def fake_remove_program(stream_id):
            removed["stream_id"] = stream_id

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(streams_control, "supervisor_stop_program", fake_stop_program)
        monkeypatch.setattr(streams_control, "supervisor_remove_program", fake_remove_program)
        monkeypatch.setattr(StreamControlService, "_get_usage_snapshot", fake_usage_snapshot, raising=False)

        service = StreamControlService(session, user_id)
        status = await service.stop_stream(stream.id)

        assert observed["status"] == "stopping"
        assert status.status == "stopped"
        assert removed["stream_id"] == stream.id


@pytest.mark.asyncio
async def test_stop_stream_ignores_missing_supervisor_program_on_remove(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-missing-remove-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="missing remove program stream",
            status="stopped",
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)

        async def fake_is_running(stream_id):
            assert stream_id == stream.id
            return False

        async def fake_remove_program(stream_id):
            assert stream_id == stream.id
            raise RuntimeError(f"ERROR: no such process/group: stream_{stream_id}")

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(
            streams_control,
            "supervisor_remove_program",
            fake_remove_program,
        )
        monkeypatch.setattr(
            StreamControlService,
            "_get_usage_snapshot",
            fake_usage_snapshot,
            raising=False,
        )

        service = StreamControlService(session, user_id)
        status = await service.stop_stream(stream.id)

        assert status.status == "stopped"


@pytest.mark.asyncio
async def test_stop_stream_records_audit_events_and_log_lines(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    user_id = uuid4()
    log_path = tmp_path / "stream.log"

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-audit-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="audit stop stream",
            status="running",
            started_at=datetime.now(timezone.utc),
            log_path=str(log_path),
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)

        async def fake_is_running(stream_id):
            assert stream_id == stream.id
            return False

        async def fake_remove_program(stream_id):
            assert stream_id == stream.id

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(streams_control, "supervisor_remove_program", fake_remove_program)
        monkeypatch.setattr(
            StreamControlService,
            "_get_usage_snapshot",
            fake_usage_snapshot,
            raising=False,
        )

        service = StreamControlService(session, user_id)
        await service.stop_stream(
            stream.id,
            source="scheduler",
            reason="scheduled_stop_due",
        )

        result = await session.execute(
            select(StreamEvent)
            .where(StreamEvent.stream_id == stream.id)
            .order_by(StreamEvent.created_at)
        )
        events = result.scalars().all()

        assert len(events) == 2
        assert events[0].message == "Stop requested via scheduler (reason: scheduled_stop_due)."
        assert events[1].message == "Stream stopped via scheduler (reason: scheduled_stop_due)."

    log_text = log_path.read_text(encoding="utf-8")
    assert "Stop requested via scheduler (reason: scheduled_stop_due)." in log_text
    assert "Stream stopped via scheduler (reason: scheduled_stop_due)." in log_text
