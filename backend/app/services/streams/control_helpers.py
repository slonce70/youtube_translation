"""Sync helpers extracted from ``control.py``.

Sprint 8.2 split: pulls the synchronous, self-independent (or
self-trivial) helper methods of ``StreamControlService`` out of the
god-module so ``control.py`` stays under the 800-LOC ceiling. Every
helper here is either pure (no DB, no I/O) or only does in-memory
mutation of a SQLAlchemy ``Stream`` instance — the class methods on
``StreamControlService`` become 1-line wrappers that delegate.

The split is intentionally conservative: only sync helpers move out;
all async coordination logic (start/stop/status orchestration) stays
on the class so the locking + transaction boundaries are immediately
visible at the call site.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Protocol
from uuid import UUID

from app.models.database import Stream
from app.schemas.api import StreamStatus

from .status_helpers import (
    aware_datetime,
    provider_summary_for_stream,
    runtime_restart_payload,
    uptime_seconds as compute_uptime_seconds,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class _SettingsProvider(Protocol):
    """Duck-type for the settings object the runtime payload needs."""


# --- Schedule mutations -----------------------------------------------------


def clear_start_schedule(stream: Stream) -> None:
    """Reset all scheduled-start tracking fields on the stream."""
    stream.scheduled_start_enabled = False
    stream.scheduled_start_time = None
    stream.scheduled_start_attempted_at = None


def clear_stop_schedule(stream: Stream) -> None:
    """Reset all scheduled-stop tracking fields on the stream."""
    stream.scheduled_stop_time = None
    stream.scheduled_stop_attempted_at = None


def clear_schedule(stream: Stream) -> None:
    """Reset both start and stop schedule fields."""
    clear_start_schedule(stream)
    clear_stop_schedule(stream)


def finalize_stopped(stream: Stream) -> None:
    """Mark the stream as fully stopped (status, pid cleared, stopped_at set)."""
    stream.status = "stopped"
    stream.pid = None
    stream.stopped_at = _utcnow()


def mark_restart_success(stream: Stream, *, orchestrated: bool) -> None:
    """Reset failure-state fields when a restart succeeds.

    The ``orchestrated`` flag is currently informational only — kept in the
    signature for parity with the call site so future restart-source
    distinctions don't require a signature change.
    """
    del orchestrated  # reserved for future use
    stream.status = "starting"
    stream.stopped_at = None
    stream.error_message = None


# --- Liveness check ---------------------------------------------------------


def stream_may_still_be_live(stream: Stream) -> bool:
    """Heuristic: should we treat this stream as possibly still running?

    Used by ``_ensure_systemd_schedule_update_allowed`` to refuse a
    schedule mutation if the runtime status cannot be definitively
    confirmed as stopped. Reads the on-disk heartbeat first; falls back
    to the started/stopped timestamps and the recorded PID.
    """
    # Lazy import to avoid pulling heartbeat infra into modules that don't
    # need it (e.g. tests that monkey-patch this helper).
    from app.core.stream_runtime_heartbeat import read_runtime_heartbeat

    heartbeat_payload = read_runtime_heartbeat(stream.id)
    if heartbeat_payload is not None:
        return True

    started_at = aware_datetime(stream.started_at)
    stopped_at = aware_datetime(stream.stopped_at)
    started_without_newer_stop = started_at is not None and (
        stopped_at is None or started_at > stopped_at
    )

    return bool(started_without_newer_stop or stream.pid is not None)


# --- Stop-event audit + activity payload ------------------------------------


def build_stop_audit_metadata(
    stream: Stream,
    *,
    source: str,
    actor_user_id: UUID | None,
    reason: str | None,
    metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build the metadata payload persisted with a stop audit event."""
    payload: Dict[str, Any] = {
        "category": "stream_stop",
        "source": source,
        "stream_status": stream.status,
    }
    if actor_user_id is not None:
        payload["actor_user_id"] = str(actor_user_id)
    if reason:
        payload["reason"] = reason
    if metadata:
        payload.update(metadata)
    return payload


def build_stop_activity_payload(
    stream: Stream, *, metadata: Dict[str, Any]
) -> Dict[str, Any] | None:
    """Build the user-activity-log payload for a stop request, or None.

    Returns None when the metadata lacks an ``actor_user_id`` (e.g.
    runtime-initiated stops where there is no human actor to attribute).
    """
    actor_user_id = metadata.get("actor_user_id")
    if not actor_user_id:
        return None

    details: Dict[str, Any] = {
        "stream_id": str(stream.id),
        "stream_name": stream.name,
        "source": metadata.get("source"),
        "reason": metadata.get("reason"),
        "request_id": metadata.get("request_id"),
        "session_id": metadata.get("session_id"),
        "jwt_jti": metadata.get("jwt_jti"),
        "route_path": metadata.get("route_path"),
        "origin": metadata.get("origin"),
        "referer": metadata.get("referer"),
        "sec_fetch_site": metadata.get("sec_fetch_site"),
    }

    return {
        "user_id": str(actor_user_id),
        "activity_type": "stream_stop_requested",
        "ip_address": metadata.get("client_ip"),
        "user_agent": metadata.get("user_agent"),
        "details": {key: value for key, value in details.items() if value is not None},
    }


# --- StreamStatus payload ---------------------------------------------------


def build_status_payload(
    stream: Stream,
    is_running: bool,
    uptime_seconds: Optional[int] = None,
    *,
    settings_provider: Any,
    status_override: Optional[str] = None,
    error_message: Optional[str] = None,
    usage: Optional[Dict[str, Any]] = None,
    manager_info: Optional[Dict[str, Any]] = None,
) -> StreamStatus:
    """Pure synchronous projection of (stream, runtime info) → StreamStatus.

    Behavior mirrors the prior ``StreamControlService._status_payload``
    instance method exactly. Lifted to module level so the class shrinks
    and the projection is independently unit-testable without a
    ``StreamControlService`` instance.
    """
    uptime = (
        uptime_seconds
        if uptime_seconds is not None
        else (compute_uptime_seconds(stream) if is_running else 0)
    )

    base_total = max(float(stream.total_duration_seconds or 0.0), 0.0)
    started_at = aware_datetime(stream.started_at) if is_running else None
    live_duration = None
    if started_at:
        live_duration = max(0, int((_utcnow() - started_at).total_seconds()))

    total_duration = (
        int(base_total + (live_duration or 0))
        if live_duration is not None
        else int(base_total)
    )
    if not is_running:
        total_duration = int(base_total)

    daily_limit_seconds: Optional[int] = None
    remaining_daily_seconds: Optional[int] = None
    quota_limit_reached: Optional[bool] = None
    if usage:
        limit_seconds = usage.get("limit_seconds")
        if limit_seconds is not None:
            daily_limit_seconds = max(int(limit_seconds), 0)
            remaining_val = usage.get("remaining_seconds")
            if remaining_val is not None:
                remaining_daily_seconds = max(int(remaining_val), 0)
            if "limit_reached" in usage:
                quota_limit_reached = bool(usage["limit_reached"])
            elif remaining_daily_seconds is not None:
                quota_limit_reached = remaining_daily_seconds <= 0

    status_value = status_override or stream.status
    error_value = stream.error_message if error_message is None else error_message
    provider_summary = provider_summary_for_stream(stream)
    runtime_incident_summary = getattr(stream, "_runtime_incident_summary", None)

    return StreamStatus(
        id=stream.id,
        status=status_value,
        uptime_seconds=uptime,
        is_running=is_running,
        error_message=error_value,
        live_duration_seconds=live_duration,
        total_duration_seconds=total_duration,
        daily_limit_seconds=daily_limit_seconds,
        remaining_daily_seconds=remaining_daily_seconds,
        quota_limit_reached=quota_limit_reached,
        provider_status=provider_summary["provider_status"],
        provider_viewers=provider_summary["provider_viewers"],
        provider_last_checked_at=provider_summary["provider_last_checked_at"],
        provider_video_id=provider_summary["provider_video_id"],
        provider_stream_status=provider_summary["provider_stream_status"],
        provider_health_status=provider_summary["provider_health_status"],
        provider_health_issues=provider_summary["provider_health_issues"],
        provider_mismatch=(
            provider_summary["provider_status"] != "unknown"
            and (is_running != (provider_summary["provider_status"] == "live"))
        ),
        runtime_restart=runtime_restart_payload(
            stream,
            status_value=status_value,
            manager_info=manager_info,
            settings_provider=settings_provider,
        ),
        runtime_incident_summary=runtime_incident_summary or {},
    )
