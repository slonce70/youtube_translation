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
from app.core.systemd_control import (
    systemd_enabled,
    unit_status as systemd_unit_status,
)
from app.models.database import Stream

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

    # Clean up supervisor configs/logs for streams that no longer exist
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
                logger.info("Stream %s still starting; leaving status=%s", stream_id, stream.status)
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
                logger.info("✓ Stream %s confirmed running", stream_id)
                stream.status = "running"
                stream.stopped_at = None
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
                )

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
            stats["streams_checked"].append({
                "id": str(stream.id),
                "status": "error",
                "error": str(e),
            })

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

    result = await db.execute(select(Stream).where(Stream.status.in_(["running", "starting", "stopping"])))
    streams = result.scalars().all()

    for stream in streams:
        try:
            runtime = await _check_stream_status(stream.id)
            state = runtime.get("state", "UNKNOWN")
            normalized = _normalize_runtime_state(state)

            if normalized is None or normalized == "starting":
                continue

            if normalized == stream.status:
                continue

            logger.warning(
                "Periodic check: Stream %s status drifted: db=%s runtime=%s → %s",
                stream.id,
                stream.status,
                state,
                normalized,
            )

            stream.status = normalized

            if normalized == "running":
                if not stream.started_at:
                    stream.started_at = datetime.now(timezone.utc)
                stream.stopped_at = None
                continue

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


async def _cleanup_supervisor_artifacts(db: AsyncSession) -> None:
    if not supervisor_enabled():
        return

    result = await db.execute(select(Stream.id))
    valid_stream_ids = {str(stream_id) for (stream_id,) in result}

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
            logger.warning("Failed to remove supervisor program %s: %s", program_name, exc)
            ini_path.unlink(missing_ok=True)
        else:
            if log_dir.exists():
                for suffix in (".log", ".err"):
                    log_path = log_dir / f"{program_name}{suffix}"
                    log_path.unlink(missing_ok=True)

    if removed:
        logger.info("Cleaned up %s orphaned supervisor programs", removed)
