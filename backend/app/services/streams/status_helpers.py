"""Shared status/runtime helper functions for stream control surfaces."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.models.database import Stream
from app.schemas.api import StreamRuntimeRestartInfo, build_stream_runtime_restart_info

_PROVIDER_HEALTH_PRIORITY = {"bad": 3, "ok": 2, "good": 1, "noData": 0}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aggregate_provider_health_status(statuses: list[str]) -> Optional[str]:
    if not statuses:
        return None
    return max(
        statuses, key=lambda status: (_PROVIDER_HEALTH_PRIORITY.get(status, 2), status)
    )


def filter_important_ffmpeg_logs(lines: list[str]) -> list[str]:
    """Keep only the most important FFmpeg log lines for UI display."""
    keywords = (
        "error",
        "failed",
        "forbidden",
        "invalid",
        "denied",
        "fatal",
        "unable",
        "timeout",
        "timed out",
        "exiting",
        "signal",
        "connection",
        "disconnect",
        "broken pipe",
        "reset",
    )

    filtered: list[str] = []

    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue

        if "Failed to update header with correct duration" in line:
            continue
        if "Failed to update header with correct filesize" in line:
            continue

        if (
            line.startswith("frame=")
            or line.startswith("size=")
            or line.startswith("fps=")
        ):
            continue
        if line.startswith("Press [q]"):
            continue

        lowered = line.lower()
        if "[audit]" in lowered:
            filtered.append(line)
            continue

        if any(token in lowered for token in keywords):
            filtered.append(line)

    return filtered


def runtime_lease_conflict_detail(
    owner_id: Optional[str], expires_at: Optional[datetime]
) -> str:
    detail = "Stream is currently managed by another runtime node"
    if owner_id:
        detail += f" ({owner_id})"
    if expires_at:
        expiry = (
            expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        )
        detail += f" until {expiry.astimezone(timezone.utc).isoformat()}"
    return detail + "."


def aware_datetime(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def uptime_seconds(stream: Stream) -> int:
    start = aware_datetime(stream.started_at)
    if not start:
        return 0
    return max(0, int((_utcnow() - start).total_seconds()))


def has_pending_runtime_restart(stream: Stream) -> bool:
    return aware_datetime(stream.runtime_next_restart_at) is not None


def provider_summary_for_stream(stream: Stream) -> dict[str, object]:
    loaded_destinations = getattr(stream, "__dict__", {}).get("stream_destinations")
    if loaded_destinations is None:
        return {
            "provider_status": "unknown",
            "provider_viewers": None,
            "provider_last_checked_at": None,
            "provider_video_id": None,
            "provider_stream_status": None,
            "provider_health_status": None,
            "provider_health_issues": [],
        }

    connected_destinations = []
    for link in loaded_destinations or []:
        destination = link.destination
        if destination is not None and getattr(
            destination, "provider_connection_id", None
        ):
            connected_destinations.append(destination)

    if not connected_destinations:
        return {
            "provider_status": "unknown",
            "provider_viewers": None,
            "provider_last_checked_at": None,
            "provider_video_id": None,
            "provider_stream_status": None,
            "provider_health_status": None,
            "provider_health_issues": [],
        }

    statuses = {
        getattr(destination, "_provider_status", "unknown")
        for destination in connected_destinations
    }
    if "live" in statuses:
        provider_status = "live"
    elif "stale" in statuses:
        provider_status = "stale"
    elif statuses == {"offline"}:
        provider_status = "offline"
    else:
        provider_status = "unknown"

    viewer_pairs = {
        (
            str(getattr(destination, "provider_connection_id", "")),
            getattr(destination, "_provider_viewers", None),
        )
        for destination in connected_destinations
        if getattr(destination, "_provider_viewers", None) is not None
    }
    last_checked = [
        getattr(destination, "_provider_last_checked_at", None)
        for destination in connected_destinations
        if getattr(destination, "_provider_last_checked_at", None) is not None
    ]
    video_ids = {
        getattr(destination, "_provider_video_id", None)
        for destination in connected_destinations
        if getattr(destination, "_provider_video_id", None)
    }
    stream_statuses = {
        getattr(destination, "_provider_stream_status", None)
        for destination in connected_destinations
        if getattr(destination, "_provider_stream_status", None)
    }
    health_statuses = [
        getattr(destination, "_provider_health_status", None)
        for destination in connected_destinations
        if getattr(destination, "_provider_health_status", None)
    ]
    health_issues = {
        issue
        for destination in connected_destinations
        for issue in (getattr(destination, "_provider_health_issues", None) or [])
        if issue
    }
    return {
        "provider_status": provider_status,
        "provider_viewers": (
            sum(viewer for _, viewer in viewer_pairs) if viewer_pairs else None
        ),
        "provider_last_checked_at": max(last_checked) if last_checked else None,
        "provider_video_id": next(iter(video_ids)) if len(video_ids) == 1 else None,
        "provider_stream_status": (
            next(iter(stream_statuses)) if len(stream_statuses) == 1 else None
        ),
        "provider_health_status": aggregate_provider_health_status(health_statuses),
        "provider_health_issues": sorted(health_issues),
    }


def runtime_restart_payload(
    stream: Stream,
    *,
    status_value: Optional[str] = None,
) -> StreamRuntimeRestartInfo:
    effective_status = status_value or stream.status
    next_restart_at = aware_datetime(stream.runtime_next_restart_at)
    return build_stream_runtime_restart_info(
        status=effective_status,
        attempts=int(stream.runtime_restart_attempts or 0),
        next_restart_at=next_restart_at,
        last_restart_at=aware_datetime(stream.runtime_last_restart_at),
        last_failure_at=aware_datetime(stream.runtime_last_failure_at),
    )
