from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.models.database import Stream
from app.services.streams.status_helpers import (
    aggregate_provider_health_status,
    filter_important_ffmpeg_logs,
    provider_summary_for_stream,
    runtime_lease_conflict_detail,
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


def test_runtime_lease_conflict_detail_includes_owner_and_expiry() -> None:
    expires_at = datetime(2026, 4, 11, 20, 0, tzinfo=timezone.utc)

    detail = runtime_lease_conflict_detail("node-a", expires_at)

    assert "node-a" in detail
    assert expires_at.isoformat() in detail
    assert detail.endswith(".")


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
    now = datetime(2026, 4, 11, 21, 0, tzinfo=timezone.utc)
    stream.status = "error"
    stream.runtime_restart_attempts = 2
    stream.runtime_next_restart_at = now
    stream.runtime_last_restart_at = now - timedelta(minutes=3)
    stream.runtime_last_failure_at = now - timedelta(minutes=1)

    monkeypatch.setattr(
        "app.schemas.api.settings.stream_runtime_auto_restart_enabled",
        True,
    )
    monkeypatch.setattr(
        "app.schemas.api.settings.stream_runtime_restart_max_attempts",
        5,
    )

    payload = runtime_restart_payload(stream, status_value="error")

    assert payload.enabled is True
    assert payload.attempts == 2
    assert payload.max_attempts == 5
    assert payload.next_restart_at == now
    assert payload.last_restart_at == now - timedelta(minutes=3)
    assert payload.last_failure_at == now - timedelta(minutes=1)
