"""Persistent restart orchestration for managed runtimes.

This layer keeps restart counters and the next eligible retry time in the
database so supervisor/systemd recovery survives API restarts and multi-node
pollers can coordinate retries safely.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import settings
from app.models.database import Stream


@dataclass(slots=True)
class StreamRuntimeRestartPlan:
    attempt: int
    max_attempts: int
    delay_seconds: int
    next_restart_at: Optional[datetime]
    scheduled: bool

    @property
    def exhausted(self) -> bool:
        return not self.scheduled

    @property
    def next_attempt_at(self) -> Optional[datetime]:
        return self.next_restart_at


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def managed_runtime_restart_enabled() -> bool:
    return (
        bool(settings.stream_runtime_auto_restart_enabled)
        and max(int(settings.stream_runtime_restart_max_attempts or 0), 0) > 0
    )


def clear_stream_runtime_restart_state(stream: Stream) -> None:
    stream.runtime_restart_attempts = 0
    stream.runtime_next_restart_at = None
    stream.runtime_last_restart_at = None
    stream.runtime_last_failure_at = None


def mark_stream_runtime_restart_started(
    stream: Stream,
    *,
    now: Optional[datetime] = None,
) -> datetime:
    effective_now = (now or utcnow()).astimezone(timezone.utc)
    stream.runtime_last_restart_at = effective_now
    stream.runtime_next_restart_at = None
    return effective_now


def mark_stream_runtime_restart_dispatched(
    stream: Stream,
    *,
    now: Optional[datetime] = None,
) -> datetime:
    """Mark that a persisted restart job has been handed to the runtime."""
    return mark_stream_runtime_restart_started(stream, now=now)


def reset_stream_runtime_restart_state_if_healthy(
    stream: Stream,
    *,
    now: Optional[datetime] = None,
) -> bool:
    if int(stream.runtime_restart_attempts or 0) <= 0:
        return False

    reset_after = max(int(settings.stream_runtime_restart_reset_after_seconds or 0), 0)
    if reset_after <= 0:
        return False

    started_at = _aware(stream.started_at)
    if started_at is None:
        return False

    effective_now = (now or utcnow()).astimezone(timezone.utc)
    if (effective_now - started_at).total_seconds() < reset_after:
        return False

    clear_stream_runtime_restart_state(stream)
    return True


def _deterministic_jitter_seconds(stream: Stream, max_jitter_seconds: int) -> int:
    limit = max(int(max_jitter_seconds or 0), 0)
    if limit <= 0:
        return 0

    digest = hashlib.sha1(str(stream.id).encode("utf-8")).digest()
    seed = int.from_bytes(digest[:4], byteorder="big", signed=False)
    return seed % (limit + 1)


def _restart_delay_seconds(stream: Stream, attempt: int) -> int:
    base_backoff = max(int(settings.stream_runtime_restart_backoff_seconds or 0), 0)
    max_backoff = max(
        int(settings.stream_runtime_restart_backoff_max_seconds or 0), base_backoff
    )
    if base_backoff <= 0:
        base_delay = 0
    else:
        base_delay = min(base_backoff * (2 ** max(attempt - 1, 0)), max_backoff)
    return base_delay + _deterministic_jitter_seconds(
        stream,
        int(settings.stream_runtime_restart_jitter_seconds or 0),
    )


def runtime_restart_backoff_seconds(stream_id: str, *, attempt: int) -> int:
    """Compatibility helper used by tests and higher-level orchestration code."""
    probe = Stream(id=stream_id)
    return _restart_delay_seconds(probe, attempt)


def schedule_stream_runtime_restart(
    stream: Stream,
    *,
    now: Optional[datetime] = None,
) -> StreamRuntimeRestartPlan:
    effective_now = (now or utcnow()).astimezone(timezone.utc)

    if reset_stream_runtime_restart_state_if_healthy(stream, now=effective_now):
        attempt = 0
    else:
        attempt = max(int(stream.runtime_restart_attempts or 0), 0)

    max_attempts = max(int(settings.stream_runtime_restart_max_attempts or 0), 0)
    if not managed_runtime_restart_enabled() or max_attempts < 1:
        stream.runtime_next_restart_at = None
        return StreamRuntimeRestartPlan(
            attempt=attempt,
            max_attempts=max_attempts,
            delay_seconds=0,
            next_restart_at=None,
            scheduled=False,
        )

    if attempt >= max_attempts:
        stream.runtime_next_restart_at = None
        return StreamRuntimeRestartPlan(
            attempt=attempt,
            max_attempts=max_attempts,
            delay_seconds=0,
            next_restart_at=None,
            scheduled=False,
        )

    next_attempt = attempt + 1

    stream.runtime_restart_attempts = next_attempt
    stream.runtime_last_failure_at = effective_now

    delay_seconds = _restart_delay_seconds(stream, next_attempt)
    next_restart_at = effective_now + timedelta(seconds=delay_seconds)
    stream.runtime_next_restart_at = next_restart_at
    return StreamRuntimeRestartPlan(
        attempt=next_attempt,
        max_attempts=max_attempts,
        delay_seconds=delay_seconds,
        next_restart_at=next_restart_at,
        scheduled=True,
    )


def postpone_stream_runtime_restart(
    stream: Stream,
    *,
    delay_seconds: int,
    now: Optional[datetime] = None,
) -> Optional[datetime]:
    effective_now = (now or utcnow()).astimezone(timezone.utc)
    delay = max(int(delay_seconds), 1)
    next_restart_at = effective_now + timedelta(seconds=delay)
    stream.runtime_next_restart_at = next_restart_at
    return next_restart_at


def runtime_restart_is_due(
    stream: Stream,
    *,
    now: Optional[datetime] = None,
) -> bool:
    if not managed_runtime_restart_enabled():
        return False

    next_restart_at = _aware(stream.runtime_next_restart_at)
    if next_restart_at is None:
        return False

    effective_now = (now or utcnow()).astimezone(timezone.utc)
    return next_restart_at <= effective_now


__all__ = [
    "StreamRuntimeRestartPlan",
    "clear_stream_runtime_restart_state",
    "managed_runtime_restart_enabled",
    "mark_stream_runtime_restart_dispatched",
    "mark_stream_runtime_restart_started",
    "postpone_stream_runtime_restart",
    "reset_stream_runtime_restart_state_if_healthy",
    "runtime_restart_backoff_seconds",
    "runtime_restart_is_due",
    "schedule_stream_runtime_restart",
]
