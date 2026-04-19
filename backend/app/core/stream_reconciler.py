"""Stream reconciliation after backend restart.

This module ensures that stream statuses in the database match the actual state
of systemd-managed processes after backend restarts or crashes.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.stream_runtime_heartbeat import (
    clear_runtime_heartbeat,
    get_runtime_heartbeat_datetime,
    get_runtime_heartbeat_dir,
    read_runtime_heartbeat,
    stale_runtime_heartbeat_reason,
    runtime_heartbeat_is_stale,
)
from app.core.systemd_control import (
    systemd_enabled,
    unit_status as systemd_unit_status,
)
from app.models.database import Stream

logger = logging.getLogger(__name__)


_SYSTEMD_STATE_TO_STATUS: dict[str, Optional[str]] = {
    "active": "running",
    "activating": "starting",
    "deactivating": "stopping",
    "inactive": "stopped",
    "dead": "stopped",
    "failed": "error",
    "unknown": None,
}


def _normalize_runtime_state(state: str | None) -> Optional[str]:
    raw = (state or "").strip().lower()
    if not raw:
        return None

    if systemd_enabled():
        return _SYSTEMD_STATE_TO_STATUS.get(raw)

    return None


def _stale_runtime_heartbeat_reason(stream_id: UUID) -> Optional[str]:
    return stale_runtime_heartbeat_reason(read_runtime_heartbeat(stream_id))


def _resolve_systemd_running_state(stream: Stream) -> tuple[str, Optional[str]]:
    heartbeat_reason = _stale_runtime_heartbeat_reason(stream.id)
    if heartbeat_reason:
        return "error", heartbeat_reason

    heartbeat_payload = read_runtime_heartbeat(stream.id)
    if heartbeat_payload and not runtime_heartbeat_is_stale(heartbeat_payload):
        return "running", None

    return "starting", None


def _sync_runtime_heartbeat_diagnostics(stream: Stream) -> None:
    payload = read_runtime_heartbeat(stream.id)
    if not payload or runtime_heartbeat_is_stale(payload):
        return

    updated_at = get_runtime_heartbeat_datetime(payload, "updated_at")
    if updated_at is None:
        return

    stream.runtime_last_heartbeat_at = updated_at


def _unexpected_runtime_failure_reason(*, state: str, detail: Optional[str]) -> str:
    if detail:
        compact_detail = " ".join(str(detail).split())
        return f"Runtime state {state}: {compact_detail}"
    return f"Runtime state {state}"


def _mark_runtime_error_without_restart(
    stream: Stream,
    *,
    reason: str,
    now: Optional[datetime] = None,
) -> None:
    effective_now = now or datetime.now(timezone.utc)
    stream.status = "error"
    stream.pid = None
    if stream.stopped_at is None:
        stream.stopped_at = effective_now
    stream.error_message = reason[:500]


async def reconcile_streams(db: AsyncSession) -> dict:
    """
    Sync database stream status with actual systemd state.

    This function is called on backend startup to ensure that streams marked
    as "running" in the database are actually running in systemd.

    Returns:
        dict: Summary of reconciliation (confirmed_running, stopped, errors)
    """
    if not systemd_enabled():
        logger.info("Reconciliation skipped - running in manager mode")
        return {
            "mode": "manager",
            "reconciled": False,
            "reason": "Manager mode does not require reconciliation",
        }

    # Clean up runtime artifacts for streams that no longer exist
    await _cleanup_runtime_artifacts(db)

    # Get all streams marked as running/starting/stopping in DB
    result = await db.execute(
        select(Stream).where(Stream.status.in_(["running", "starting", "stopping"]))
    )
    streams = result.scalars().all()

    logger.info(
        "Starting stream reconciliation: %s streams to check (mode: systemd)",
        len(streams),
    )

    stats = {
        "confirmed_running": 0,
        "stopped": 0,
        "errors": 0,
        "streams_checked": [],
    }

    for stream in streams:
        try:
            stream_id = stream.id
            runtime = await _check_stream_status(stream_id)
            state = runtime.get("state", "UNKNOWN")
            normalized = _normalize_runtime_state(state)

            if normalized is None:
                logger.info(
                    "Stream %s reconciliation skipped; runtime state=%s",
                    stream_id,
                    state,
                )
                stats["streams_checked"].append(
                    {
                        "id": str(stream_id),
                        "status": stream.status,
                        "action": "skipped",
                        "reason": state,
                    }
                )
                continue

            if normalized == "starting":
                logger.info(
                    "Stream %s still starting; leaving status=%s",
                    stream_id,
                    stream.status,
                )
                if stream.error_message:
                    stream.error_message = None
                stats["streams_checked"].append(
                    {
                        "id": str(stream_id),
                        "status": stream.status,
                        "action": "pending",
                        "reason": state,
                    }
                )
                continue

            if normalized == "running":
                normalized, heartbeat_reason = _resolve_systemd_running_state(stream)
                if normalized == "starting":
                    logger.info(
                        "Stream %s is active in systemd but not yet runtime-confirmed; "
                        "leaving status=starting",
                        stream_id,
                    )
                    stream.status = "starting"
                    stream.started_at = None
                    stream.stopped_at = None
                    stats["streams_checked"].append(
                        {
                            "id": str(stream_id),
                            "status": "starting",
                            "action": "pending",
                            "reason": "awaiting_runtime_confirmation",
                        }
                    )
                    continue
                if heartbeat_reason:
                    logger.warning(
                        "✗ Stream %s runner heartbeat is stale: %s",
                        stream_id,
                        heartbeat_reason,
                    )
                    _mark_runtime_error_without_restart(stream, reason=heartbeat_reason)
                    action = "marked_error"
                    stats["errors"] += 1
                    stats["streams_checked"].append(
                        {
                            "id": str(stream_id),
                            "status": "error",
                            "action": action,
                            "reason": heartbeat_reason,
                        }
                    )
                    continue

                logger.info("✓ Stream %s confirmed running", stream_id)
                stream.status = "running"
                if stream.started_at is None:
                    stream.started_at = datetime.now(timezone.utc)
                if stream.error_message:
                    stream.error_message = None
                stream.stopped_at = None
                _sync_runtime_heartbeat_diagnostics(stream)
                stats["confirmed_running"] += 1
                stats["streams_checked"].append(
                    {
                        "id": str(stream_id),
                        "status": "running",
                        "action": "confirmed",
                    }
                )
                continue

            reason_detail = runtime.get("error") or runtime.get("details")
            if reason_detail and not isinstance(reason_detail, str):
                reason_detail = str(reason_detail)
            if isinstance(reason_detail, str):
                reason_detail = " ".join(reason_detail.split())
            reason = state if not reason_detail else f"{state}:{reason_detail}"

            if normalized == "stopping":
                logger.info("Stream %s is stopping (state=%s)", stream_id, state)
                stream.status = "stopping"
                stream.pid = None
                stats["streams_checked"].append(
                    {
                        "id": str(stream_id),
                        "status": "stopping",
                        "action": "pending",
                        "reason": reason,
                    }
                )
                continue

            # stopped/error
            logger.warning("✗ Stream %s not running (state=%s)", stream_id, state)
            if stream.status in {"running", "starting"}:
                if normalized == "error":
                    _mark_runtime_error_without_restart(
                        stream,
                        reason=_unexpected_runtime_failure_reason(
                            state=state, detail=reason_detail
                        ),
                    )
                    stats["errors"] += 1
                    stats["streams_checked"].append(
                        {
                            "id": str(stream_id),
                            "status": "error",
                            "action": "marked_error",
                            "reason": reason,
                        }
                    )
                else:
                    stream.status = normalized
                    stream.pid = None
                    if stream.stopped_at is None:
                        stream.stopped_at = datetime.now(timezone.utc)
                    if (
                        stream.error_message
                        and "auto-restart" in stream.error_message.lower()
                    ):
                        stream.error_message = None
                    stats["stopped"] += 1
                    stats["streams_checked"].append(
                        {
                            "id": str(stream_id),
                            "status": normalized,
                            "action": f"marked_{normalized}",
                            "reason": reason,
                        }
                    )
                continue

            stream.status = normalized
            stream.pid = None
            if stream.stopped_at is None:
                stream.stopped_at = datetime.now(timezone.utc)
            if normalized == "error" and reason_detail:
                stream.error_message = str(reason_detail)[:500]
            elif not stream.error_message:
                stream.error_message = (
                    "Stream stopped unexpectedly (detected on reconciliation). "
                    f"State: {reason}"
                )[:500]

            if normalized == "stopped":
                stats["stopped"] += 1
            else:
                stats["errors"] += 1

            stats["streams_checked"].append(
                {
                    "id": str(stream_id),
                    "status": normalized,
                    "action": f"marked_{normalized}",
                    "reason": reason,
                }
            )

        except Exception as e:
            logger.exception(f"Error reconciling stream {stream.id}: {e}")
            stats["errors"] += 1
            stats["streams_checked"].append(
                {
                    "id": str(stream.id),
                    "status": "error",
                    "error": str(e),
                }
            )

    await db.commit()

    logger.info(
        f"Stream reconciliation completed: "
        f"{stats['confirmed_running']} running, "
        f"{stats['stopped']} stopped, "
        f"{stats['errors']} errors"
    )

    return {
        "mode": "systemd",
        "reconciled": True,
        "stats": stats,
    }


async def _check_stream_status(stream_id: UUID) -> dict:
    """
    Check actual stream status in systemd.

    Returns:
        dict: Status info with 'is_running' boolean and 'state' string
    """
    if systemd_enabled():
        try:
            status_info = await systemd_unit_status(stream_id)
            active_state = status_info.get("ActiveState", "unknown")
            return {
                "is_running": active_state == "active",
                "state": active_state,
                "details": status_info,
            }
        except Exception as e:
            logger.error(f"Failed to check systemd status for {stream_id}: {e}")
            return {
                "is_running": False,
                "state": "ERROR",
                "error": str(e),
            }

    return {
        "is_running": False,
        "state": "UNKNOWN",
        "error": "Systemd runtime is not enabled",
    }


async def periodic_reconciliation(db: AsyncSession) -> None:
    """
    Lightweight periodic check to sync stream statuses.

    This is less aggressive than full reconciliation and only updates
    statuses that have drifted from reality.
    """
    if not systemd_enabled():
        return

    result = await db.execute(
        select(Stream).where(Stream.status.in_(["running", "starting", "stopping"]))
    )
    streams = result.scalars().all()

    for stream in streams:
        try:
            runtime = await _check_stream_status(stream.id)
            state = runtime.get("state", "UNKNOWN")
            normalized = _normalize_runtime_state(state)
            previous_status = stream.status

            if normalized is None:
                continue

            heartbeat_reason = None
            if normalized == "running":
                normalized, heartbeat_reason = _resolve_systemd_running_state(stream)
                if normalized == "starting":
                    if previous_status != "starting":
                        stream.status = "starting"
                        stream.started_at = None
                        stream.stopped_at = None
                    continue
                if heartbeat_reason:
                    _mark_runtime_error_without_restart(stream, reason=heartbeat_reason)
                    continue

            if normalized == "starting":
                if stream.error_message:
                    stream.error_message = None
                continue

            if normalized == previous_status and normalized == "running":
                _sync_runtime_heartbeat_diagnostics(stream)
                if stream.error_message:
                    stream.error_message = None

            if normalized == previous_status:
                continue

            logger.warning(
                "Periodic check: Stream %s status drifted: db=%s runtime=%s → %s",
                stream.id,
                previous_status,
                state,
                normalized,
            )

            if normalized == "running":
                stream.status = "running"
                if previous_status == "starting" or not stream.started_at:
                    stream.started_at = datetime.now(timezone.utc)
                stream.stopped_at = None
                _sync_runtime_heartbeat_diagnostics(stream)
                if stream.error_message:
                    stream.error_message = None
                continue

            if normalized in {"stopped", "error"} and previous_status in {
                "running",
                "starting",
            }:
                if normalized == "error":
                    _mark_runtime_error_without_restart(
                        stream,
                        reason=_unexpected_runtime_failure_reason(
                            state=state,
                            detail=runtime.get("error") or runtime.get("details"),
                        ),
                    )
                else:
                    stream.status = normalized
                    stream.pid = None
                    if stream.stopped_at is None:
                        stream.stopped_at = datetime.now(timezone.utc)
                    if (
                        stream.error_message
                        and "auto-restart" in stream.error_message.lower()
                    ):
                        stream.error_message = None
                continue

            stream.status = normalized
            stream.pid = None
            if normalized in {"stopped", "error"} and stream.stopped_at is None:
                stream.stopped_at = datetime.now(timezone.utc)

            if normalized == "error":
                error_payload = runtime.get("error") or runtime.get("details")
                if error_payload:
                    stream.error_message = str(error_payload)[:500]

        except Exception as e:
            logger.error(f"Error in periodic reconciliation for {stream.id}: {e}")

    await db.commit()


async def restart_due_streams(db: AsyncSession, *, batch_size: int = 10) -> int:
    """Systemd mode has no app-level restart dispatcher."""
    return 0


async def _cleanup_runtime_artifacts(db: AsyncSession) -> None:
    if not systemd_enabled():
        return

    result = await db.execute(select(Stream.id))
    valid_stream_ids = {str(stream_id) for (stream_id,) in result}

    heartbeat_dir = get_runtime_heartbeat_dir()
    if heartbeat_dir.exists():
        for heartbeat_path in heartbeat_dir.glob("*.json"):
            if heartbeat_path.stem in valid_stream_ids:
                continue
            clear_runtime_heartbeat(heartbeat_path.stem)
