import signal
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

import app.cli.run_stream as run_stream_cli
import app.services.streams.control as streams_control
from app.core.database import async_session_maker
from app.core.stream_runtime_heartbeat import write_runtime_heartbeat
from app.core.quota import QuotaEnforcer
from app.models.database import Stream, StreamEvent, SystemAlert, UserProfile
from app.services.streams.audit import (
    persist_stream_alert_event,
    resolve_stream_runtime_alerts,
)
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
async def test_start_stream_refuses_terminal_state_and_records_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"terminal-refusal-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="terminal-refusal",
            status="error",
        )
        session.add_all([profile, stream])
        await session.commit()

    async def fake_load_stream_with_relations(_db, user_id_arg, stream_id_arg):
        assert user_id_arg == user_id
        assert stream_id_arg == stream_id
        async with async_session_maker() as session:
            return await session.get(Stream, stream_id)

    prepare_stream_launch = pytest.fail
    monkeypatch.setattr(
        run_stream_cli, "load_stream_with_relations", fake_load_stream_with_relations
    )
    monkeypatch.setattr(run_stream_cli, "prepare_stream_launch", prepare_stream_launch)

    with pytest.raises(run_stream_cli.TerminalStateRefusal):
        await run_stream_cli._start_stream(stream_id, wait=False)

    async with async_session_maker() as session:
        alerts = (
            (
                await session.execute(
                    select(SystemAlert).where(SystemAlert.stream_id == stream_id)
                )
            )
            .scalars()
            .all()
        )
        events = (
            (
                await session.execute(
                    select(StreamEvent).where(StreamEvent.stream_id == stream_id)
                )
            )
            .scalars()
            .all()
        )

    assert len(alerts) == 1
    assert alerts[0].alert_type == "stream_runtime_refused_terminal_state"
    assert alerts[0].details["status"] == "error"
    assert len(events) == 1
    assert events[0].event_metadata["phase"] == "startup_guard"


def test_main_returns_dedicated_exit_code_for_terminal_state_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(run_stream_cli, "setup_logging", lambda **_kwargs: None)
    monkeypatch.setattr(
        run_stream_cli,
        "_parse_args",
        lambda _argv=None: type("Args", (), {"stream_id": str(uuid4()), "wait": True})(),
    )

    async def fake_async_entry(_args):
        return None

    monkeypatch.setattr(run_stream_cli, "_async_entry", fake_async_entry)
    monkeypatch.setattr(
        run_stream_cli.asyncio,
        "run",
        lambda _coro: (_ for _ in ()).throw(
            run_stream_cli.TerminalStateRefusal("terminal state refusal")
        ),
    )

    assert run_stream_cli.main([]) == run_stream_cli.TERMINAL_STATE_EXIT_CODE


@pytest.mark.asyncio
async def test_start_stream_refusal_still_returns_terminal_state_when_alert_persist_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"refusal-fail-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="terminal",
            status="stopped",
        )
        session.add_all([profile, stream])
        await session.commit()

    async def fake_load_stream_with_relations(_db, user_id_arg, stream_id_arg):
        assert user_id_arg == user_id
        assert stream_id_arg == stream_id
        async with async_session_maker() as session:
            return await session.get(Stream, stream_id)

    async def failing_persist(*args, **kwargs):
        raise RuntimeError("alert persist failed")

    monkeypatch.setattr(
        run_stream_cli, "load_stream_with_relations", fake_load_stream_with_relations
    )
    monkeypatch.setattr(
        run_stream_cli, "persist_stream_alert_event", failing_persist
    )
    monkeypatch.setattr(run_stream_cli, "prepare_stream_launch", pytest.fail)

    with pytest.raises(run_stream_cli.TerminalStateRefusal):
        await run_stream_cli._start_stream(stream_id, wait=False)


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
        )

        session.add_all([completed_stream, running_stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

        class DummyManager:
            def __init__(self, info: Dict[str, Any]):
                self._info = info

            def is_running(self, stream_id: str) -> bool:
                return True

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return self._info

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {
                    "severity": "degraded",
                    "headline": "Runtime зафіксував повторні remote output resets",
                    "details": ["3 подій за останні 180с."],
                    "items": [
                        {
                            "code": "transport_connection_reset",
                            "severity": "degraded",
                            "label": "Runtime зафіксував повторні remote output resets",
                            "detail": "3 подій за останні 180с.",
                            "count": 3,
                        }
                    ],
                }

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
        assert status.runtime_restart.enabled is False
        assert status.runtime_restart.attempts == 0
        assert status.runtime_restart.max_attempts == 0
        assert status.runtime_restart.state == "disabled"
        assert status.runtime_restart.last_restart_at is None
        assert status.runtime_incident_summary.severity == "degraded"
        assert (
            status.runtime_incident_summary.headline
            == "Runtime зафіксував повторні remote output resets"
        )


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
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return False

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {}

        service = StreamControlService(session, user_id, manager=DummyManager())

        status = await service.get_stream_status(stream.id)

        assert status.runtime_restart.enabled is False
        assert status.runtime_restart.state == "disabled"
        assert status.runtime_restart.attempts == 0
        assert status.runtime_restart.max_attempts == 0
        assert status.runtime_restart.next_restart_at is None
        assert status.runtime_restart.last_restart_at is None
        assert status.runtime_restart.last_failure_at is None


@pytest.mark.asyncio
async def test_stream_status_reads_degraded_runtime_summary_from_managed_log(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid4()
    stream_id = uuid4()
    base_timestamp = datetime.now(timezone.utc) - timedelta(seconds=3)
    log_path = tmp_path / "managed-stream.log"
    log_path.write_text(
        "\n".join(
            [
                f"{base_timestamp.isoformat()} Connection reset by peer",
                f"{(base_timestamp + timedelta(seconds=1)).isoformat()} Broken pipe",
                f"{(base_timestamp + timedelta(seconds=2)).isoformat()} Recovery successful",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"managed-log-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="managed-live",
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            log_path=str(log_path),
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

        async def _systemd_unit_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"ActiveState": "active", "SubState": "running"}

        monkeypatch.setattr(
            streams_control,
            "systemd_unit_status",
            _systemd_unit_status,
        )
        write_runtime_heartbeat(stream_id, runner_pid=321, runtime_mode="systemd")

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return False

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {}

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {"severity": "healthy", "headline": None, "details": [], "items": []}

        service = StreamControlService(session, user_id, manager=DummyManager())
        status = await service.get_stream_status(stream_id)

        assert status.is_running is True
        assert status.runtime_incident_summary.severity == "degraded"
        assert (
            status.runtime_incident_summary.headline
            == "RTMPS ingest скинув з'єднання 1 раз(и)"
        )


@pytest.mark.asyncio
async def test_stream_status_ignores_stale_runtime_faults_from_managed_log(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid4()
    stream_id = uuid4()
    old_timestamp = datetime.now(timezone.utc) - timedelta(hours=1)
    log_path = tmp_path / "stale-managed-stream.log"
    log_path.write_text(
        "\n".join(
            [
                f"{old_timestamp.isoformat()} Connection reset by peer",
                f"{(old_timestamp + timedelta(seconds=1)).isoformat()} Broken pipe",
                f"{(old_timestamp + timedelta(seconds=2)).isoformat()} Recovery successful",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"stale-managed-log-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="managed-live-stale-log",
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            log_path=str(log_path),
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

        async def _systemd_unit_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"ActiveState": "active", "SubState": "running"}

        monkeypatch.setattr(
            streams_control,
            "systemd_unit_status",
            _systemd_unit_status,
        )
        write_runtime_heartbeat(stream_id, runner_pid=654, runtime_mode="systemd")

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return False

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {}

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {"severity": "healthy", "headline": None, "details": [], "items": []}

        service = StreamControlService(session, user_id, manager=DummyManager())
        status = await service.get_stream_status(stream_id)

        assert status.is_running is True
        assert status.runtime_incident_summary.severity == "healthy"
        assert status.runtime_incident_summary.items == []


@pytest.mark.asyncio
async def test_stream_status_ignores_untimestamped_runtime_faults_from_previous_session(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid4()
    stream_id = uuid4()
    old_timestamp = datetime.now(timezone.utc) - timedelta(hours=1)
    log_path = tmp_path / "legacy-managed-stream.log"
    log_path.write_text(
        "\n".join(
            [
                "[fifo @ 0x1] Non-monotonic DTS in output stream 0:1; previous: 1000, current: 999; changing to 1001.",
                "[fifo @ 0x1] Non-monotonic DTS in output stream 0:1; previous: 1001, current: 1000; changing to 1002.",
                f"{old_timestamp.isoformat()} [audit] INFO Stream stopped",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"legacy-managed-log-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="managed-live-legacy-log",
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            log_path=str(log_path),
        )
        session.add_all([profile, stream])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

        async def _systemd_unit_status(_stream_id: UUID) -> Dict[str, Any]:
            return {"ActiveState": "active", "SubState": "running"}

        monkeypatch.setattr(
            streams_control,
            "systemd_unit_status",
            _systemd_unit_status,
        )
        write_runtime_heartbeat(stream_id, runner_pid=777, runtime_mode="systemd")

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return False

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {}

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {
                    "severity": "healthy",
                    "headline": None,
                    "details": [],
                    "items": [],
                }

        service = StreamControlService(session, user_id, manager=DummyManager())
        status = await service.get_stream_status(stream_id)

        assert status.is_running is True
        assert status.runtime_incident_summary.severity == "healthy"
        assert status.runtime_incident_summary.items == []


@pytest.mark.asyncio
async def test_stream_status_falls_back_to_persisted_runtime_alert_when_log_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"persisted-alert-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="persisted-alert-live",
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=3),
            log_path=None,
        )
        alert = SystemAlert(
            user_id=user_id,
            stream_id=stream_id,
            alert_type="ffmpeg_error",
            severity="warning",
            message="Stream degraded while still running: repeated remote output resets detected in FFmpeg logs.",
            details={
                "category": "stream_runtime_health",
                "signal": "remote_output_reset",
                "status": "degraded_running",
                "occurrence_count": 3,
                "window_seconds": 180,
                "observed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        session.add_all([profile, stream, alert])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return True

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {"uptime_seconds": 180}

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {"severity": "healthy", "headline": None, "details": [], "items": []}

        service = StreamControlService(session, user_id, manager=DummyManager())
        status = await service.get_stream_status(stream_id)

        assert status.runtime_incident_summary.severity == "degraded"
        assert (
            status.runtime_incident_summary.headline
            == "Runtime зафіксував повторні remote output resets"
        )


@pytest.mark.asyncio
async def test_stream_status_ignores_persisted_runtime_alert_from_previous_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    stream_id = uuid4()
    session_started_at = datetime.now(timezone.utc) - timedelta(minutes=2)

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"stale-persisted-alert-{uuid4()}@example.com",
            subscription_tier="free",
            subscription_status="active",
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="persisted-alert-stale",
            status="running",
            started_at=session_started_at,
            log_path=None,
        )
        alert = SystemAlert(
            user_id=user_id,
            stream_id=stream_id,
            alert_type="ffmpeg_error",
            severity="warning",
            message="Stream degraded while still running: repeated remote output resets detected in FFmpeg logs.",
            created_at=session_started_at - timedelta(minutes=10),
            details={
                "category": "stream_runtime_health",
                "signal": "remote_output_reset",
                "status": "degraded_running",
                "occurrence_count": 3,
                "window_seconds": 180,
                "observed_at": (
                    session_started_at - timedelta(minutes=10)
                ).isoformat(),
            },
        )
        session.add_all([profile, stream, alert])
        await session.commit()

        monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

        class DummyManager:
            def is_running(self, stream_id: str) -> bool:
                return True

            def get_stream_info(self, stream_id: str) -> Dict[str, Any]:
                return {"uptime_seconds": 120}

            def get_runtime_incident_summary(self, stream_id: str) -> Dict[str, Any]:
                return {
                    "severity": "healthy",
                    "headline": None,
                    "details": [],
                    "items": [],
                }

        service = StreamControlService(session, user_id, manager=DummyManager())
        status = await service.get_stream_status(stream_id)

        assert status.runtime_incident_summary.severity == "healthy"
        assert status.runtime_incident_summary.items == []


@pytest.mark.asyncio
async def test_persist_stream_alert_event_deduplicates_ongoing_runtime_signal() -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"dedupe-alert-{uuid4()}@example.com",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        session.add(
            Stream(
                id=stream_id,
                user_id=user_id,
                name="dedupe-live",
                status="running",
                started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            )
        )
        await session.commit()

    await persist_stream_alert_event(
        stream_id,
        level="warning",
        message="Stream degraded while still running: repeated remote output resets detected in FFmpeg logs.",
        alert_type="ffmpeg_error",
        alert_severity="warning",
        metadata={
            "category": "stream_runtime_health",
            "signal": "remote_output_reset",
            "status": "degraded_running",
            "occurrence_count": 3,
            "window_seconds": 180,
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
        user_id=user_id,
    )
    await persist_stream_alert_event(
        stream_id,
        level="warning",
        message="Stream degraded while still running: repeated remote output resets detected in FFmpeg logs.",
        alert_type="ffmpeg_error",
        alert_severity="warning",
        metadata={
            "category": "stream_runtime_health",
            "signal": "remote_output_reset",
            "status": "degraded_running",
            "occurrence_count": 6,
            "window_seconds": 180,
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
        user_id=user_id,
    )

    async with async_session_maker() as session:
        result = await session.execute(
            select(SystemAlert).where(
                SystemAlert.stream_id == stream_id,
                SystemAlert.alert_type == "ffmpeg_error",
                SystemAlert.resolved.is_(False),
            )
        )
        alerts = result.scalars().all()

    assert len(alerts) == 1
    assert alerts[0].details["occurrence_count"] == 6


@pytest.mark.asyncio
async def test_resolve_stream_runtime_alerts_marks_only_runtime_health_alerts() -> None:
    user_id = uuid4()
    stream_id = uuid4()

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"resolve-alert-{uuid4()}@example.com",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        session.add(
            Stream(
                id=stream_id,
                user_id=user_id,
                name="resolve-live",
                status="running",
                started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            )
        )
        session.add_all(
            [
                SystemAlert(
                    user_id=user_id,
                    stream_id=stream_id,
                    alert_type="ffmpeg_error",
                    severity="warning",
                    message="degraded runtime",
                    details={
                        "category": "stream_runtime_health",
                        "signal": "remote_output_reset",
                        "status": "degraded_running",
                    },
                ),
                SystemAlert(
                    user_id=user_id,
                    stream_id=stream_id,
                    alert_type="ffmpeg_error",
                    severity="warning",
                    message="generic ffmpeg failure",
                    details={"category": "stream_failure"},
                ),
            ]
        )
        await session.commit()

    resolved = await resolve_stream_runtime_alerts(
        stream_id,
        resolution_note="Auto-resolved after clean stream shutdown.",
    )

    async with async_session_maker() as session:
        result = await session.execute(
            select(SystemAlert).where(SystemAlert.stream_id == stream_id)
        )
        alerts = sorted(result.scalars().all(), key=lambda alert: alert.message)

    assert resolved == 1
    assert alerts[0].message == "degraded runtime"
    assert alerts[0].resolved is True
    assert alerts[0].resolution_notes == "Auto-resolved after clean stream shutdown."
    assert alerts[1].message == "generic ffmpeg failure"
    assert alerts[1].resolved is False


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
            runtime_last_heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=5),
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
        assert refreshed.runtime_last_heartbeat_at is not None
