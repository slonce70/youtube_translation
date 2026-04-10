from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.stream_runtime_restart import (
    clear_stream_runtime_restart_state,
    managed_runtime_restart_enabled,
    mark_stream_runtime_restart_dispatched,
    runtime_restart_backoff_seconds,
    runtime_restart_is_due,
    schedule_stream_runtime_restart,
)
from app.models.database import Stream


def _stream() -> Stream:
    return Stream(user_id=uuid4(), name="restartable", status="running", mix_mode="video_only")


def test_schedule_stream_runtime_restart_increments_attempts(monkeypatch) -> None:
    stream = _stream()
    now = datetime(2026, 3, 30, 10, 0, tzinfo=timezone.utc)

    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_mode", "supervisor")
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_max_attempts", 5)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_backoff_seconds", 5)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_backoff_max_seconds", 300)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_jitter_seconds", 0)

    decision = schedule_stream_runtime_restart(stream, now=now)

    assert decision.scheduled is True
    assert decision.attempt == 1
    assert decision.delay_seconds == 5
    assert stream.runtime_restart_attempts == 1
    assert stream.runtime_next_restart_at == now + timedelta(seconds=5)
    assert stream.runtime_last_failure_at == now


def test_schedule_stream_runtime_restart_exhausts_attempts(monkeypatch) -> None:
    stream = _stream()
    stream.runtime_restart_attempts = 2
    now = datetime(2026, 3, 30, 10, 0, tzinfo=timezone.utc)

    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_mode", "supervisor")
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_max_attempts", 2)

    decision = schedule_stream_runtime_restart(stream, now=now)

    assert decision.scheduled is False
    assert decision.exhausted is True
    assert stream.runtime_next_restart_at is None
    assert stream.runtime_restart_attempts == 2


def test_runtime_restart_backoff_seconds_uses_exponential_policy(monkeypatch) -> None:
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_mode", "supervisor")
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_backoff_seconds", 5)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_backoff_max_seconds", 60)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_jitter_seconds", 0)

    assert runtime_restart_backoff_seconds("stream-1", attempt=1) == 5
    assert runtime_restart_backoff_seconds("stream-1", attempt=2) == 10
    assert runtime_restart_backoff_seconds("stream-1", attempt=3) == 20


def test_runtime_restart_is_due_and_dispatch_marks_state(monkeypatch) -> None:
    stream = _stream()
    now = datetime(2026, 3, 30, 10, 0, tzinfo=timezone.utc)
    stream.status = "error"
    stream.runtime_restart_attempts = 2
    stream.runtime_next_restart_at = now

    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_mode", "supervisor")
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_auto_restart_enabled", True)
    assert runtime_restart_is_due(stream, now=now) is True

    dispatched_at = mark_stream_runtime_restart_dispatched(stream, now=now)
    assert dispatched_at == now
    assert stream.runtime_last_restart_at == now
    assert stream.runtime_next_restart_at is None

    clear_stream_runtime_restart_state(stream)
    assert stream.runtime_restart_attempts == 0
    assert stream.runtime_last_restart_at is None
    assert stream.runtime_last_failure_at is None


def test_managed_runtime_restart_disabled_when_attempt_budget_is_zero(monkeypatch) -> None:
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_auto_restart_enabled", True)
    monkeypatch.setattr("app.core.stream_runtime_restart.settings.stream_runtime_restart_max_attempts", 0)

    assert managed_runtime_restart_enabled() is False
