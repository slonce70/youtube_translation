"""Stream reconciliation after backend restart.

This module ensures that stream statuses in the database match the actual state
of processes managed by supervisor/systemd after backend restarts or crashes.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.supervisor_control import (
    supervisor_enabled,
    program_status as supervisor_program_status,
    remove_program as supervisor_remove_program,
    get_supervisor_config_dir,
    get_supervisor_log_dir,
    decode_program_name,
)
from app.core.stream_runtime_heartbeat import (
    clear_runtime_heartbeat,
    get_runtime_heartbeat_datetime,
    get_runtime_heartbeat_dir,
    read_runtime_heartbeat,
    runtime_heartbeat_is_stale,
)
from app.core.stream_runtime_lease import (
    clear_stream_runtime_lease,
    runtime_lease_is_active,
    sync_stream_runtime_lease,
)
from app.core.stream_runtime_restart import (
    reset_stream_runtime_restart_state_if_healthy,
    runtime_restart_is_due,
    schedule_stream_runtime_restart,
)
from app.core.systemd_control import (
    systemd_enabled,
    unit_status as systemd_unit_status,
)
from app.models.database import Stream
from app.services.streams.control import StreamControlService

logger = logging.getLogger(__name__)


_SUPERVISOR_STATE_TO_STATUS: dict[str, Optional[str]] = {
    "running": "running",
    "starting": "starting",
    "stopping": "stopping",
    "stopped": "stopped",
    "exited": "stopped",
    "not_found": "stopped",
    "backoff": "error",
    "fatal": "error",
    "error": "error",
    # When supervisor is unavailable, do not mutate DB statuses based on that signal alone.
    "supervisor_unavailable": None,
    "permission_denied": None,
    "unknown": None,
}

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

    if supervisor_enabled():
        return _SUPERVISOR_STATE_TO_STATUS.get(raw)

    if systemd_enabled():
        return _SYSTEMD_STATE_TO_STATUS.get(raw)

    return None


def _stale_runtime_heartbeat_reason(stream_id: UUID) -> Optional[str]:
    payload = read_runtime_heartbeat(stream_id)
    if not payload or not runtime_heartbeat_is_stale(payload):
        return None

    expires_at = payload.get("expires_at") or payload.get("updated_at") or "unknown"
    runner_pid = payload.get("runner_pid")
    runtime_mode = payload.get("runtime_mode") or "managed"
    details = f"{runtime_mode} runner heartbeat expired at {expires_at}"
    if runner_pid:
        details += f" (runner_pid={runner_pid})"
    return details


def _sync_runtime_lease_from_heartbeat(stream: Stream) -> None:
    payload = read_runtime_heartbeat(stream.id)
    if not payload or runtime_heartbeat_is_stale(payload):
        return

    owner_id = (
        payload.get("lease_owner_id")
        or payload.get("node_id")
        or stream.runtime_owner_id
    )
    if not owner_id:
        return

    updated_at = get_runtime_heartbeat_datetime(payload, "updated_at")
    expires_at = get_runtime_heartbeat_datetime(payload, "expires_at")
    if updated_at is None or expires_at is None:
        return

    if stream.runtime_owner_id == owner_id and runtime_lease_is_active(
        stream, now=updated_at
    ):
        return

    sync_stream_runtime_lease(
        stream,
        owner_id=owner_id,
        now=updated_at,
        ttl_seconds=max(int((expires_at - updated_at).total_seconds()), 1),
    )


def _unexpected_runtime_failure_reason(*, state: str, detail: Optional[str]) -> str:
    if detail:
        compact_detail = " ".join(str(detail).split())
        return f"Runtime state {state}: {compact_detail}"
    return f"Runtime state {state}"


def _schedule_runtime_restart(
    stream: Stream,
    *,
    reason: str,
    now: Optional[datetime] = None,
) -> str:
    effective_now = now or datetime.now(timezone.utc)
    stream.status = "error"
    stream.pid = None
    clear_stream_runtime_lease(stream)
    if stream.stopped_at is None:
        stream.stopped_at = effective_now

    decision = schedule_stream_runtime_restart(stream, now=effective_now)
    if decision.scheduled and decision.next_restart_at is not None:
        next_attempt_iso = decision.next_restart_at.astimezone(timezone.utc).isoformat()
        stream.error_message = (
            f"{reason}. Auto-restart scheduled at {next_attempt_iso} "
            f"(attempt {decision.attempt}/{decision.max_attempts}, backoff {decision.delay_seconds}s)."
        )[:500]
        return "scheduled"

    stream.error_message = (
        f"{reason}. Auto-restart exhausted after "
        f"{decision.attempt}/{decision.max_attempts} attempts."
    )[:500]
    return "exhausted"


async def reconcile_streams(db: AsyncSession) -> dict:
    """
    Sync database stream status with actual supervisor/systemd state.

    This function is called on backend startup to ensure that streams marked
    as "running" in the database are actually running in supervisor/systemd.

    Returns:
        dict: Summary of reconciliation (confirmed_running, stopped, errors)
    """
    if not (supervisor_enabled() or systemd_enabled()):
        logger.info("Reconciliation skipped - running in manager mode")
        return {
            "mode": "manager",
            "reconciled": False,
            "reason": "Manager mode does not require reconciliation",
        }

    # Clean up runtime artifacts for streams that no longer exist
    await _cleanup_supervisor_artifacts(db)

    # Get all streams marked as running/starting/stopping in DB
    result = await db.execute(
        select(Stream).where(Stream.status.in_(["running", "starting", "stopping"]))
    )
    streams = result.scalars().all()

    logger.info(
        f"Starting stream reconciliation: {len(streams)} streams to check "
        f"(mode: {'supervisor' if supervisor_enabled() else 'systemd'})"
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
                heartbeat_reason = _stale_runtime_heartbeat_reason(stream_id)
                if heartbeat_reason:
                    logger.warning(
                        "✗ Stream %s runner heartbeat is stale: %s",
                        stream_id,
                        heartbeat_reason,
                    )
                    action = _schedule_runtime_restart(stream, reason=heartbeat_reason)
                    stats["errors"] += 1
                    stats["streams_checked"].append(
                        {
                            "id": str(stream_id),
                            "status": "error",
                            "action": f"restart_{action}",
                            "reason": heartbeat_reason,
                        }
                    )
                    continue

                logger.info("✓ Stream %s confirmed running", stream_id)
                stream.status = "running"
                stream.stopped_at = None
                _sync_runtime_lease_from_heartbeat(stream)
                reset_stream_runtime_restart_state_if_healthy(stream)
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
                action = _schedule_runtime_restart(
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
                        "action": f"restart_{action}",
                        "reason": reason,
                    }
                )
                continue

            stream.status = normalized
            stream.pid = None
            clear_stream_runtime_lease(stream)
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
        "mode": "supervisor" if supervisor_enabled() else "systemd",
        "reconciled": True,
        "stats": stats,
    }


async def _check_stream_status(stream_id: UUID) -> dict:
    """
    Check actual stream status in supervisor or systemd.

    Returns:
        dict: Status info with 'is_running' boolean and 'state' string
    """
    if supervisor_enabled():
        try:
            status_info = await supervisor_program_status(stream_id)
            state = status_info.get("state", "UNKNOWN")
            return {
                "is_running": state == "RUNNING",
                "state": state,
                "details": status_info.get("details", ""),
            }
        except Exception as e:
            logger.error(f"Failed to check supervisor status for {stream_id}: {e}")
            return {
                "is_running": False,
                "state": "ERROR",
                "error": str(e),
            }

    elif systemd_enabled():
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
        "error": "Neither supervisor nor systemd enabled",
    }


async def periodic_reconciliation(db: AsyncSession) -> None:
    """
    Lightweight periodic check to sync stream statuses.

    This is less aggressive than full reconciliation and only updates
    statuses that have drifted from reality.
    """
    if not (supervisor_enabled() or systemd_enabled()):
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

            if normalized is None or normalized == "starting":
                continue

            heartbeat_reason = None
            if normalized == "running":
                heartbeat_reason = _stale_runtime_heartbeat_reason(stream.id)
                if heartbeat_reason:
                    if stream.status in {"running", "starting"}:
                        _schedule_runtime_restart(stream, reason=heartbeat_reason)
                        continue
                    normalized = "error"
                    runtime["error"] = heartbeat_reason

            if normalized == previous_status and normalized == "running":
                _sync_runtime_lease_from_heartbeat(stream)
                reset_stream_runtime_restart_state_if_healthy(stream)

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
                if not stream.started_at:
                    stream.started_at = datetime.now(timezone.utc)
                stream.stopped_at = None
                _sync_runtime_lease_from_heartbeat(stream)
                reset_stream_runtime_restart_state_if_healthy(stream)
                continue

            if normalized in {"stopped", "error"} and previous_status in {
                "running",
                "starting",
            }:
                _schedule_runtime_restart(
                    stream,
                    reason=_unexpected_runtime_failure_reason(
                        state=state,
                        detail=runtime.get("error") or runtime.get("details"),
                    ),
                )
                continue

            stream.status = normalized
            stream.pid = None
            clear_stream_runtime_lease(stream)
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
    """Dispatch managed-runtime restarts whose backoff timer has elapsed."""
    if not (supervisor_enabled() or systemd_enabled()):
        return 0

    now = datetime.now(timezone.utc)
    query = (
        select(Stream)
        .where(
            Stream.status == "error",
            Stream.runtime_next_restart_at.isnot(None),
            Stream.runtime_next_restart_at <= now,
        )
        .order_by(Stream.runtime_next_restart_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(query)
    streams = result.scalars().all()
    if not streams:
        return 0

    restarted = 0
    for stream in streams:
        if not runtime_restart_is_due(stream, now=now):
            continue

        try:
            control = StreamControlService(db, stream.user_id)
            await control.restart_stream(stream.id, orchestrated=True)
            restarted += 1
            logger.info(
                "Dispatched managed auto-restart for stream %s (attempt=%s)",
                stream.id,
                stream.runtime_restart_attempts,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Auto-restart dispatch failed for %s: %s", stream.id, exc)
            _schedule_runtime_restart(
                stream,
                reason=f"Auto-restart dispatch failed: {exc}",
                now=now,
            )
            await db.commit()

    return restarted


async def _cleanup_supervisor_artifacts(db: AsyncSession) -> None:
    if not (supervisor_enabled() or systemd_enabled()):
        return

    result = await db.execute(select(Stream.id))
    valid_stream_ids = {str(stream_id) for (stream_id,) in result}

    heartbeat_dir = get_runtime_heartbeat_dir()
    if heartbeat_dir.exists():
        for heartbeat_path in heartbeat_dir.glob("*.json"):
            if heartbeat_path.stem in valid_stream_ids:
                continue
            clear_runtime_heartbeat(heartbeat_path.stem)

    if not supervisor_enabled():
        return

    config_dir = get_supervisor_config_dir()
    log_dir = get_supervisor_log_dir()

    if not config_dir.exists():
        return

    removed = 0
    for ini_path in config_dir.glob("*.ini"):
        program_name = ini_path.stem
        stream_id_str = decode_program_name(program_name)
        if not stream_id_str or stream_id_str in valid_stream_ids:
            continue
        try:
            stream_uuid = UUID(stream_id_str)
        except ValueError:
            logger.debug("Skipping unknown supervisor program %s", program_name)
            continue
        try:
            logger.info("Removing orphaned supervisor program %s", program_name)
            await supervisor_remove_program(stream_uuid)
            removed += 1
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Failed to remove supervisor program %s: %s", program_name, exc
            )
            ini_path.unlink(missing_ok=True)
        else:
            if log_dir.exists():
                for suffix in (".log", ".err"):
                    log_path = log_dir / f"{program_name}{suffix}"
                    log_path.unlink(missing_ok=True)

    if removed:
        logger.info("Cleaned up %s orphaned supervisor programs", removed)
