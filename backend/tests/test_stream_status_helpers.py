from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.core.config import settings
from app.models.database import Stream
from app.services.streams.status_helpers import (
    aggregate_provider_health_status,
    filter_important_ffmpeg_logs,
    provider_summary_for_stream,
    runtime_restart_payload,
)


def _stream() -> Stream:
    return Stream(
        id=uuid4(),
        user_id=uuid4(),
        name="status-helper-stream",
        status="running",
        mix_mode="video_only",
    )


def test_filter_important_ffmpeg_logs_strips_noise_and_keeps_audit() -> None:
    lines = [
        "",
        "frame=  234 fps=30 q=-1.0 size=1024kB time=00:00:12.00 bitrate=699.0kbits/s",
        "Press [q] to stop, [?] for help",
        "Failed to update header with correct duration",
        "2026-04-11T10:00:00Z [audit] INFO Stop requested",
        "2026-04-11T10:00:01Z Connection reset by peer",
        "2026-04-11T10:00:02Z all good",
    ]

    assert filter_important_ffmpeg_logs(lines) == [
        "2026-04-11T10:00:00Z [audit] INFO Stop requested",
        "2026-04-11T10:00:01Z Connection reset by peer",
    ]


def test_aggregate_provider_health_status_prefers_more_severe_value() -> None:
    assert aggregate_provider_health_status(["good", "ok"]) == "ok"
    assert aggregate_provider_health_status(["good", "bad", "ok"]) == "bad"
    assert aggregate_provider_health_status([]) is None


def test_provider_summary_for_stream_aggregates_connected_destinations() -> None:
    stream = _stream()
    now = datetime.now(timezone.utc)
    destination_a = SimpleNamespace(
        provider_connection_id="conn-a",
        _provider_status="live",
        _provider_viewers=12,
        _provider_last_checked_at=now,
        _provider_video_id="video-1",
        _provider_stream_status="active",
        _provider_health_status="ok",
        _provider_health_issues=["gopSizeOver"],
    )
    destination_b = SimpleNamespace(
        provider_connection_id="conn-b",
        _provider_status="live",
        _provider_viewers=8,
        _provider_last_checked_at=now + timedelta(seconds=5),
        _provider_video_id="video-1",
        _provider_stream_status="active",
        _provider_health_status="bad",
        _provider_health_issues=["noAudioStream"],
    )
    stream.__dict__["stream_destinations"] = [
        SimpleNamespace(destination=destination_a),
        SimpleNamespace(destination=destination_b),
    ]

    summary = provider_summary_for_stream(stream)

    assert summary["provider_status"] == "live"
    assert summary["provider_viewers"] == 20
    assert summary["provider_video_id"] == "video-1"
    assert summary["provider_stream_status"] == "active"
    assert summary["provider_health_status"] == "bad"
    assert summary["provider_health_issues"] == ["gopSizeOver", "noAudioStream"]


def test_runtime_restart_payload_reflects_attempt_state(monkeypatch) -> None:
    stream = _stream()
    stream.status = "starting"
    monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 3)

    payload = runtime_restart_payload(
        stream,
        status_value="starting",
        manager_info={
            "restart_attempts": 1,
            "last_failure_at": datetime.now(timezone.utc) - timedelta(seconds=3),
            "last_restart_at": datetime.now(timezone.utc) - timedelta(seconds=1),
        },
    )

    assert payload.enabled is True
    assert payload.state == "retrying"
    assert payload.attempts == 1
    assert payload.max_attempts == 3
    assert payload.next_restart_at is None
    assert payload.last_restart_at is not None
    assert payload.last_failure_at is not None


def test_runtime_restart_payload_zeroes_legacy_state_when_disabled(monkeypatch) -> None:
    stream = _stream()
    stream.status = "error"
    monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 0)

    payload = runtime_restart_payload(
        stream,
        status_value="error",
        manager_info={
            "restart_attempts": 4,
            "next_restart_at": datetime.now(timezone.utc) + timedelta(seconds=15),
            "last_restart_at": datetime.now(timezone.utc) - timedelta(seconds=10),
            "last_failure_at": datetime.now(timezone.utc) - timedelta(seconds=20),
        },
    )

    assert payload.enabled is False
    assert payload.state == "disabled"
    assert payload.attempts == 0
    assert payload.max_attempts == 0
    assert payload.next_restart_at is None
    assert payload.last_restart_at is None
    assert payload.last_failure_at is None


def test_runtime_restart_payload_reports_scheduled_recovery(monkeypatch) -> None:
    stream = _stream()
    stream.status = "error"
    monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 2)

    payload = runtime_restart_payload(
        stream,
        status_value="error",
        manager_info={
            "restart_attempts": 1,
            "next_restart_at": datetime.now(timezone.utc) + timedelta(seconds=30),
        },
    )

    assert payload.enabled is True
    assert payload.state == "scheduled"
    assert payload.attempts == 1
    assert payload.max_attempts == 2
    assert payload.next_restart_at is not None
