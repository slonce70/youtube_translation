"""Shared runtime heartbeat files for managed stream runners.

The heartbeat lives under the shared stream directory so both the API process and
the external runner can observe liveness across restarts.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from app.core.config import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_runtime_heartbeat_dir() -> Path:
    return Path(settings.stream_dir) / ".runtime-heartbeats"


def get_runtime_heartbeat_path(stream_id: UUID | str) -> Path:
    return get_runtime_heartbeat_dir() / f"{stream_id}.json"


def _serialize_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def get_runtime_heartbeat_datetime(
    payload: Optional[Dict[str, Any]], field: str
) -> Optional[datetime]:
    if not payload:
        return None
    return _parse_datetime(payload.get(field))


def write_runtime_heartbeat(
    stream_id: UUID | str,
    *,
    runner_pid: int,
    ffmpeg_pid: Optional[int] = None,
    launcher: str = "cli",
    runtime_mode: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    heartbeat_dir = get_runtime_heartbeat_dir()
    heartbeat_dir.mkdir(parents=True, exist_ok=True)

    effective_now = (now or _utcnow()).astimezone(timezone.utc)
    ttl = max(int(ttl_seconds or settings.stream_runtime_heartbeat_ttl_seconds), 1)
    payload: Dict[str, Any] = {
        "stream_id": str(stream_id),
        "node_id": settings.stream_runtime_node_id,
        "lease_owner_id": settings.stream_runtime_node_id,
        "runner_pid": runner_pid,
        "ffmpeg_pid": ffmpeg_pid,
        "launcher": launcher,
        "runtime_mode": runtime_mode or settings.stream_runtime_mode,
        "updated_at": _serialize_datetime(effective_now),
        "expires_at": _serialize_datetime(effective_now + timedelta(seconds=ttl)),
        "metadata": metadata or {},
    }

    target = get_runtime_heartbeat_path(stream_id)
    temp_path = target.with_suffix(".tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=True, sort_keys=True), encoding="utf-8"
    )
    temp_path.replace(target)
    return payload


def read_runtime_heartbeat(stream_id: UUID | str) -> Optional[Dict[str, Any]]:
    target = get_runtime_heartbeat_path(stream_id)
    if not target.exists():
        return None

    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def runtime_heartbeat_is_stale(
    payload: Optional[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> bool:
    if not payload:
        return False

    effective_now = (now or _utcnow()).astimezone(timezone.utc)
    expires_at = get_runtime_heartbeat_datetime(payload, "expires_at")
    if expires_at is not None:
        return expires_at < effective_now

    updated_at = get_runtime_heartbeat_datetime(payload, "updated_at")
    if updated_at is None:
        return True

    ttl = max(int(ttl_seconds or settings.stream_runtime_heartbeat_ttl_seconds), 1)
    return updated_at + timedelta(seconds=ttl) < effective_now


def stale_runtime_heartbeat_reason(payload: Optional[Dict[str, Any]]) -> Optional[str]:
    if not payload or not runtime_heartbeat_is_stale(payload):
        return None

    expires_at = payload.get("expires_at") or payload.get("updated_at") or "unknown"
    runner_pid = payload.get("runner_pid")
    runtime_mode = payload.get("runtime_mode") or "managed"
    details = f"{runtime_mode} runner heartbeat expired at {expires_at}"
    if runner_pid:
        details += f" (runner_pid={runner_pid})"
    return details


def clear_runtime_heartbeat(stream_id: UUID | str) -> None:
    get_runtime_heartbeat_path(stream_id).unlink(missing_ok=True)
