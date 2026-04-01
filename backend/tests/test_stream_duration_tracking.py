import signal
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import UUID, uuid4

import pytest

import app.cli.run_stream as run_stream_cli
import app.services.streams.control as streams_control
from app.core.config import settings
from app.core.database import async_session_maker
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
        assert usage["remaining_seconds"] == pytest.approx((8 * 3600) - expected_used, abs=3.0)
        assert usage["limit_reached"] is False


@pytest.mark.asyncio
async def test_stream_status_reports_live_and_total_duration(monkeypatch: pytest.MonkeyPatch) -> None:
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
async def test_enforce_runtime_limit_stops_stream(monkeypatch: pytest.MonkeyPatch) -> None:
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
        )
        session.add_all([profile, stream])
        await session.commit()

        quota_message = "Daily streaming limit reached (8h). Stream stopped automatically."
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
