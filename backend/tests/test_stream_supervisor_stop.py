import pytest
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
import app.services.streams.control as streams_control
from app.core.database import async_session_maker
from sqlalchemy import select

from app.models.database import Stream, StreamEvent, UserActivityLog, UserProfile
from app.services.streams.control import StreamControlService


@pytest.mark.asyncio
async def test_stop_stream_removes_supervisor_program(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
            raise AssertionError(
                "stop_program should not be called when stream is already stopped"
            )

        removed = {"stream_id": None}

        async def fake_remove_program(stream_id):
            removed["stream_id"] = stream_id

        async def fake_usage_snapshot(self, enforcer=None):
            return {}

        monkeypatch.setattr(streams_control, "supervisor_is_running", fake_is_running)
        monkeypatch.setattr(
            streams_control, "supervisor_stop_program", fake_stop_program
        )
        monkeypatch.setattr(
            streams_control, "supervisor_remove_program", fake_remove_program
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
        monkeypatch.setattr(
            streams_control, "supervisor_stop_program", fake_stop_program
        )
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
        monkeypatch.setattr(
            streams_control, "supervisor_stop_program", fake_stop_program
        )
        monkeypatch.setattr(
            streams_control, "supervisor_remove_program", fake_remove_program
        )
        monkeypatch.setattr(
            StreamControlService,
            "_get_usage_snapshot",
            fake_usage_snapshot,
            raising=False,
        )

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
        monkeypatch.setattr(
            streams_control, "supervisor_remove_program", fake_remove_program
        )
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
        assert (
            events[0].message
            == "Stop requested via scheduler (reason: scheduled_stop_due)."
        )
        assert (
            events[1].message
            == "Stream stopped via scheduler (reason: scheduled_stop_due)."
        )

    log_text = log_path.read_text(encoding="utf-8")
    assert "Stop requested via scheduler (reason: scheduled_stop_due)." in log_text
    assert "Stream stopped via scheduler (reason: scheduled_stop_due)." in log_text


@pytest.mark.asyncio
async def test_stop_stream_records_user_activity_with_request_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    user_id = uuid4()
    log_path = tmp_path / "stream.log"

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-activity-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="activity stop stream",
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
        monkeypatch.setattr(
            streams_control, "supervisor_remove_program", fake_remove_program
        )
        monkeypatch.setattr(
            StreamControlService,
            "_get_usage_snapshot",
            fake_usage_snapshot,
            raising=False,
        )

        service = StreamControlService(session, user_id)
        await service.stop_stream(
            stream.id,
            source="user_api",
            actor_user_id=user_id,
            reason="user_requested_stop",
            metadata={
                "request_id": "req-stop-123",
                "session_id": "session-abc",
                "jwt_jti": "jti-789",
                "route_path": f"/api/streams/{stream.id}/stop",
                "client_ip": "198.51.100.77",
                "user_agent": "pytest-agent",
                "origin": "https://app.example.com",
                "referer": "https://app.example.com/dashboard/streaming",
            },
        )

        events = (
            (
                await session.execute(
                    select(StreamEvent)
                    .where(StreamEvent.stream_id == stream.id)
                    .order_by(StreamEvent.created_at)
                )
            )
            .scalars()
            .all()
        )
        activity_logs = (
            (
                await session.execute(
                    select(UserActivityLog).where(UserActivityLog.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )

        assert len(events) == 2
        assert events[0].event_metadata["request_id"] == "req-stop-123"
        assert events[0].event_metadata["session_id"] == "session-abc"
        assert events[0].event_metadata["client_ip"] == "198.51.100.77"

        assert len(activity_logs) == 1
        activity = activity_logs[0]
        assert activity.activity_type == "stream_stop_requested"
        assert str(activity.ip_address) == "198.51.100.77"
        assert activity.user_agent == "pytest-agent"
        assert activity.details["stream_id"] == str(stream.id)
        assert activity.details["request_id"] == "req-stop-123"
        assert activity.details["session_id"] == "session-abc"


@pytest.mark.asyncio
async def test_scheduler_stop_does_not_create_user_activity_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-no-activity-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="scheduler stop stream",
            status="running",
            started_at=datetime.now(timezone.utc),
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
        monkeypatch.setattr(
            streams_control, "supervisor_remove_program", fake_remove_program
        )
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

        activity_logs = (
            (
                await session.execute(
                    select(UserActivityLog).where(UserActivityLog.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )

        assert activity_logs == []


@pytest.mark.asyncio
async def test_failed_user_stop_persists_requested_and_failed_audit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()
    log_path = tmp_path / "stream.log"

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"supervisor-failed-stop-{user_id}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="failed stop stream",
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
            raise RuntimeError("supervisor remove failed")

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

        with pytest.raises(HTTPException):
            await service.stop_stream(
                stream_id,
                source="user_api",
                actor_user_id=user_id,
                reason="user_requested_stop",
                metadata={
                    "request_id": "req-failed-stop",
                    "client_ip": "198.51.100.77",
                    "user_agent": "pytest-agent",
                },
            )

    async with async_session_maker() as session:
        events = (
            (
                await session.execute(
                    select(StreamEvent)
                    .where(StreamEvent.stream_id == stream_id)
                    .order_by(StreamEvent.created_at)
                )
            )
            .scalars()
            .all()
        )

        assert [event.event_metadata["phase"] for event in events] == [
            "requested",
            "failed",
        ]
        assert events[1].level == "error"
        assert "supervisor remove failed" in events[1].event_metadata["error"]
