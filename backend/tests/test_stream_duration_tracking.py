import signal
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import UUID, uuid4

import pytest

import app.cli.run_stream as run_stream_cli
import app.services.streams.control as streams_control
from app.core.database import async_session_maker
from app.core.stream_runtime_heartbeat import write_runtime_heartbeat
from app.core.quota import QuotaEnforcer
from app.models.database import Stream, UserProfile
from app.services.streams.control import StreamControlService
from app.streaming.ffmpeg_manager import FFmpegStreamManager


@pytest.mark.asyncio
async def test_daily_usage_snapshot_includes_running_stream() -> None:
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"quota-user-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        past_stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="archived",
            status="stopped",
            started_at=now - timedelta(hours=2),
            stopped_at=now - timedelta(hours=1, minutes=30),
            total_duration_seconds=1800,
        )

        running_stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="live",
            status="running",
            started_at=now - timedelta(minutes=10),
            total_duration_seconds=1200,
        )

        session.add_all([past_stream, running_stream])
        await session.commit()

        enforcer = QuotaEnforcer(session, user_id)
        usage = await enforcer.get_daily_streaming_usage()

        assert usage["limit_seconds"] == pytest.approx(8 * 3600)
        assert usage["limit_hours"] == pytest.approx(8.0)

        expected_used = 1800 + 600  # seconds (30 minutes + 10 minutes)
        assert usage["used_seconds"] == pytest.approx(expected_used, abs=3.0)
        assert usage["remaining_seconds"] == pytest.approx(
            (8 * 3600) - expected_used, abs=3.0
        )
        assert usage["limit_reached"] is False


@pytest.mark.asyncio
async def test_update_stream_status_after_exit_preserves_existing_error_without_manager_info(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"error-state-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="failed",
            status="error",
            error_message="Remote output disconnect evidence detected in FFmpeg logs.",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(
            run_stream_cli.ffmpeg_manager,
            "get_stream_info",
            lambda _stream_id: None,
        )

        await run_stream_cli._update_stream_status_after_exit(stream)

    async with async_session_maker() as session:
        refreshed = await session.get(Stream, stream_id)
        assert refreshed is not None
        assert refreshed.status == "error"
        assert (
            refreshed.error_message
            == "Remote output disconnect evidence detected in FFmpeg logs."
        )


@pytest.mark.asyncio
async def test_stream_status_reports_live_and_total_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"status-user-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)

        completed_stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="previous",
            status="stopped",
            started_at=now - timedelta(hours=3),
            stopped_at=now - timedelta(hours=2),
            total_duration_seconds=3600,
        )

        running_stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="live",
            status="running",
            started_at=now - timedelta(minutes=10),
            total_duration_seconds=1800,
            runtime_restart_attempts=2,
            runtime_last_restart_at=now - timedelta(minutes=2),
        )

        session.add_all([completed_stream, running_stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: False)

        class DummyManager:
            def __init__(self, info: Dict[str, Any]):
                self._info = info

            def is_running(self, stream_id: str) -> bool:
                return True

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return self._info

        manager = DummyManager({"uptime_seconds": 600})
        service = StreamControlService(session, user_id, manager=manager)

        status = await service.get_stream_status(running_stream.id)

        assert status.is_running is True
        assert status.live_duration_seconds is not None
        assert status.live_duration_seconds >= 590  # allow slight clock drift
        assert status.live_duration_seconds <= 610

        assert status.total_duration_seconds is not None
        expected_total = 1800 + status.live_duration_seconds
        assert status.total_duration_seconds == pytest.approx(expected_total, abs=3.0)

        assert status.daily_limit_seconds == 8 * 3600
        assert status.remaining_daily_seconds is not None
        assert status.remaining_daily_seconds < status.daily_limit_seconds
        assert status.quota_limit_reached is False
        assert status.runtime_restart.attempts == 2
        assert status.runtime_restart.state == "retrying"
        assert status.runtime_restart.last_restart_at is not None


@pytest.mark.asyncio
async def test_stream_status_disables_runtime_restart_when_attempt_budget_is_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"restart-disabled-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="restart-disabled",
            status="error",
            runtime_restart_attempts=1,
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: False)
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_auto_restart_enabled",
            True,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_max_attempts",
            0,
        )
        monkeypatch.setattr(
            "app.schemas.api.settings.stream_runtime_auto_restart_enabled",
            True,
        )
        monkeypatch.setattr(
            "app.schemas.api.settings.stream_runtime_restart_max_attempts",
            0,
        )

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return False

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {}

        service = StreamControlService(session, user_id, manager=DummyManager())

        status = await service.get_stream_status(stream.id)

        assert status.runtime_restart.enabled is False
        assert status.runtime_restart.state == "disabled"


@pytest.mark.asyncio
async def test_scheduled_stream_status_stays_scheduled_when_supervisor_has_not_started_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    start_at = datetime.now(timezone.utc) + timedelta(hours=1)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"scheduled-status-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="scheduled",
            status="scheduled",
            scheduled_start_enabled=True,
            scheduled_start_time=start_at,
        )
        session.add_all([profile, stream])
        await session.commit()

        async def fake_program_status(_stream_id: UUID) -> Dict[str, Any]:
            return {
                "state": "NOT_FOUND",
                "error": "supervisor socket missing",
            }

        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(
            streams_control, "supervisor_program_status", fake_program_status
        )

        service = StreamControlService(session, user_id)
        status = await service.get_stream_status(stream.id)

        assert status.status == "scheduled"
        assert status.is_running is False
        assert status.error_message is None


@pytest.mark.asyncio
async def test_supervisor_status_repairs_lease_and_clears_retry_metadata_from_fresh_heartbeat(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    user_id = uuid4()
    started_at = datetime.now(timezone.utc) - timedelta(hours=1)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"status-heartbeat-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="running-supervisor",
            status="running",
            started_at=started_at,
            runtime_restart_attempts=2,
            runtime_last_restart_at=started_at + timedelta(minutes=5),
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(
            streams_control.default_settings, "stream_dir", str(tmp_path)
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_reset_after_seconds",
            60,
        )

        async def fake_program_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"state": "RUNNING", "details": "pid 321"}

        monkeypatch.setattr(
            streams_control, "supervisor_program_status", fake_program_status
        )

        write_runtime_heartbeat(stream.id, runner_pid=321)

        service = StreamControlService(session, user_id)
        status = await service.get_stream_status(stream.id)
        await session.refresh(stream)

        assert status.status == "running"
        assert status.runtime_restart.attempts == 0
        assert status.runtime_restart.state == "idle"
        assert (
            stream.runtime_owner_id
            == streams_control.default_settings.stream_runtime_node_id
        )
        assert stream.runtime_lease_expires_at is not None
        assert stream.runtime_restart_attempts == 0


@pytest.mark.asyncio
async def test_supervisor_status_fails_closed_when_heartbeat_is_stale(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    user_id = uuid4()
    started_at = datetime.now(timezone.utc) - timedelta(minutes=5)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"stale-heartbeat-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="ghost-running-supervisor",
            status="running",
            started_at=started_at,
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        monkeypatch.setattr(
            streams_control.default_settings, "stream_dir", str(tmp_path)
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_auto_restart_enabled",
            True,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_heartbeat_ttl_seconds",
            15,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_backoff_seconds",
            0,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_backoff_max_seconds",
            0,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_jitter_seconds",
            0,
        )
        monkeypatch.setattr(
            streams_control.default_settings,
            "stream_runtime_restart_max_attempts",
            5,
        )

        async def fake_program_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"state": "RUNNING", "details": "pid 654"}

        monkeypatch.setattr(
            streams_control, "supervisor_program_status", fake_program_status
        )

        write_runtime_heartbeat(
            stream.id,
            runner_pid=654,
            now=datetime.now(timezone.utc) - timedelta(seconds=60),
            ttl_seconds=5,
        )

        service = StreamControlService(session, user_id)
        status = await service.get_stream_status(stream.id)
        await session.refresh(stream)

        assert status.status == "error"
        assert status.is_running is False
        assert status.error_message is not None
        assert "heartbeat expired" in status.error_message
        assert status.runtime_restart.attempts == 1
        assert status.runtime_restart.state == "scheduled"
        assert stream.status == "error"
        assert stream.runtime_restart_attempts == 1
        assert stream.runtime_next_restart_at is not None


@pytest.mark.asyncio
async def test_supervisor_status_preserves_queued_runtime_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    next_restart_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    queued_error = "Runtime state EXITED: process exited unexpectedly."

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"queued-restart-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="queued-restart",
            status="error",
            error_message=queued_error,
            runtime_restart_attempts=1,
            runtime_next_restart_at=next_restart_at,
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

        async def fake_program_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"state": "NOT_FOUND", "error": "supervisor reports no process"}

        monkeypatch.setattr(
            streams_control, "supervisor_program_status", fake_program_status
        )

        service = StreamControlService(session, user_id)
        status = await service.get_stream_status(stream.id)
        await session.refresh(stream)

        assert status.status == "error"
        assert status.is_running is False
        assert status.error_message == queued_error
        assert status.runtime_restart.state == "scheduled"
        assert stream.status == "error"
        assert stream.runtime_next_restart_at == next_restart_at


@pytest.mark.asyncio
async def test_supervisor_status_preserves_quota_stop_message_when_runtime_probe_degraded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    quota_message = "Daily streaming limit reached (8h). Stream stopped automatically."

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"quota-status-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="quota-terminal",
            status="stopped",
            started_at=datetime.now(timezone.utc) - timedelta(hours=8, minutes=5),
            stopped_at=datetime.now(timezone.utc),
            total_duration_seconds=8 * 3600,
            error_message=quota_message,
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

        async def fake_program_status(_stream_id: UUID) -> Dict[str, Any]:
            return {
                "state": "SUPERVISOR_UNAVAILABLE",
                "error": "unix:///tmp/supervisor.sock no such file",
            }

        monkeypatch.setattr(
            streams_control, "supervisor_program_status", fake_program_status
        )

        service = StreamControlService(session, user_id)
        status = await service.get_stream_status(stream.id)

        assert status.status == "stopped"
        assert status.is_running is False
        assert status.error_message == quota_message
        assert status.remaining_daily_seconds == 0
        assert status.quota_limit_reached is True


@pytest.mark.asyncio
async def test_enforce_runtime_limit_stops_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = FFmpegStreamManager("echo")
    stream_id = str(uuid4())
    user_id = uuid4()

    manager.stream_info[stream_id] = {
        "metadata": {"user_id": str(user_id)},
        "manual_stop": False,
    }

    async def fake_usage(_: UUID) -> Dict[str, Any]:
        return {
            "limit_seconds": 60.0,
            "limit_hours": 60.0 / 3600.0,
            "used_seconds": 60.0,
            "remaining_seconds": 0.0,
            "limit_reached": True,
            "tier": "free",
        }

    monkeypatch.setattr(manager, "_fetch_daily_usage", fake_usage)

    class DummyProcess:
        def __init__(self) -> None:
            self.returncode: Any = None
            self.signals: list[int] = []

        def send_signal(self, sig: int) -> None:
            self.signals.append(sig)

    process = DummyProcess()

    await manager._enforce_runtime_limit(stream_id, process)

    assert process.signals == [signal.SIGINT]
    info = manager.stream_info[stream_id]
    assert info["manual_stop"] is True
    quota_payload = info.get("quota_stop")
    assert quota_payload is not None
    assert "Daily streaming limit" in quota_payload["message"]


@pytest.mark.asyncio
async def test_runner_exit_preserves_quota_stop_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"runner-quota-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=uuid4(),
            user_id=user_id,
            name="quota-stopped",
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            runtime_owner_id="runner-node",
            runtime_last_heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=5),
            runtime_lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
            runtime_restart_attempts=2,
            runtime_next_restart_at=datetime.now(timezone.utc) + timedelta(minutes=1),
            runtime_last_failure_at=datetime.now(timezone.utc) - timedelta(seconds=30),
        )
        session.add_all([profile, stream])
        await session.commit()

        quota_message = (
            "Daily streaming limit reached (8h). Stream stopped automatically."
        )
        monkeypatch.setattr(
            run_stream_cli.ffmpeg_manager,
            "get_stream_info",
            lambda _stream_id: {
                "last_exit_code": -2,
                "manual_stop": True,
                "quota_stop": {"message": quota_message},
            },
        )

        await run_stream_cli._update_stream_status_after_exit(stream)

    async with async_session_maker() as session:
        refreshed = await session.get(Stream, stream.id)
        assert refreshed is not None
        assert refreshed.status == "stopped"
        assert refreshed.error_message == quota_message
        assert refreshed.runtime_owner_id is None
        assert refreshed.runtime_last_heartbeat_at is None
        assert refreshed.runtime_lease_expires_at is None
        assert refreshed.runtime_restart_attempts == 0
        assert refreshed.runtime_next_restart_at is None
        assert refreshed.runtime_last_failure_at is None
