import signal
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import UUID, uuid4

import pytest

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
