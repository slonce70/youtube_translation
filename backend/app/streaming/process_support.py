import asyncio
import logging
import signal
import re
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional
from uuid import UUID

import aiofiles

from app.core.config import settings
from app.core.database import get_db_context
from app.core.quota import QuotaEnforcer

logger = logging.getLogger(__name__)

_RUNTIME_LOG_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b"
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _format_runtime_log_line_for_persistence(
    line: bytes, *, observed_at: datetime | None = None
) -> bytes:
    decoded = line.decode("utf-8", errors="replace").rstrip("\r\n")
    if not decoded:
        return b"\n"

    if _RUNTIME_LOG_TIMESTAMP_PATTERN.match(decoded):
        rendered = decoded
    else:
        rendered = f"{(observed_at or _utcnow()).isoformat()} {decoded}"
    return f"{rendered}\n".encode("utf-8")


async def fetch_daily_usage(user_id: UUID) -> Optional[Dict[str, Any]]:
    try:
        async with get_db_context() as session:
            enforcer = QuotaEnforcer(session, user_id)
            return await enforcer.get_daily_streaming_usage()
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Failed to compute daily streaming usage for user %s: %s",
            user_id,
            exc,
        )
        return None


async def enforce_runtime_limit(
    *,
    stream_id: str,
    process: asyncio.subprocess.Process,
    stream_info: Dict[str, Dict[str, Any]],
    fetch_daily_usage: Callable[[UUID], Awaitable[Optional[Dict[str, Any]]]],
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
) -> None:
    info = stream_info.get(stream_id)
    if not info:
        return

    metadata = info.get("metadata") or {}
    raw_user_id = metadata.get("user_id")
    try:
        user_uuid = UUID(str(raw_user_id))
    except (TypeError, ValueError):
        return

    interval_setting = getattr(settings, "stream_quota_poll_seconds", 60)
    try:
        poll_interval = float(interval_setting)
    except (TypeError, ValueError):  # pragma: no cover - misconfig safeguard
        poll_interval = 60.0
    poll_interval = max(poll_interval, 15.0)

    had_error = False

    while process.returncode is None:
        usage = await fetch_daily_usage(user_uuid)
        if usage is None:
            if not had_error:
                logger.exception(
                    "Failed to evaluate quota usage for user %s; will retry",
                    user_uuid,
                )
                had_error = True
            await sleep(poll_interval)
            continue

        had_error = False

        limit_seconds = usage.get("limit_seconds")
        if not limit_seconds:
            return

        used_seconds = usage.get("used_seconds", 0.0)
        if used_seconds >= limit_seconds:
            limit_hours = usage.get("limit_hours")
            remaining_seconds = usage.get("remaining_seconds", 0.0)
            message = (
                f"Daily streaming limit reached ({limit_hours:.0f}h). Stream stopped automatically."
                if limit_hours
                else "Daily streaming limit reached. Stream stopped automatically."
            )

            payload = {
                "message": message,
                "limit_hours": limit_hours,
                "limit_seconds": limit_seconds,
                "used_seconds": used_seconds,
                "remaining_seconds": remaining_seconds,
                "tier": usage.get("tier"),
            }

            refreshed_info = stream_info.get(stream_id)
            if refreshed_info is not None:
                refreshed_info["quota_stop"] = payload
                refreshed_info["manual_stop"] = True

            logger.warning(
                "Stopping stream %s after exceeding daily limit (used=%s, limit=%s)",
                stream_id,
                used_seconds,
                limit_seconds,
            )

            try:
                process.send_signal(signal.SIGINT)
            except ProcessLookupError:
                logger.debug("Process for stream %s no longer exists", stream_id)
            return

        try:
            await sleep(poll_interval)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Quota monitor sleep failed for stream %s", stream_id)
            await sleep(poll_interval)


async def write_logs_to_file(
    *,
    stream_id: str,
    process: asyncio.subprocess.Process,
    log_file: Path,
    stream_info: Dict[str, Dict[str, Any]],
    record_runtime_log_health: Callable[[str, str], Awaitable[None]],
) -> None:
    """Write process output to log file safely using async file operations."""

    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)

        max_bytes = max(int(getattr(settings, "stream_log_max_bytes", 0) or 0), 0)
        max_backups = max(int(getattr(settings, "stream_log_max_backups", 0) or 0), 0)
        bytes_written = log_file.stat().st_size if log_file.exists() else 0

        async def _open_log():
            return await aiofiles.open(log_file, "ab")

        f = await _open_log()
        try:
            while True:
                line = await process.stderr.readline()
                if not line:
                    break

                observed_at = _utcnow()
                persisted_line = _format_runtime_log_line_for_persistence(
                    line, observed_at=observed_at
                )

                if max_bytes and bytes_written + len(persisted_line) > max_bytes:
                    await f.flush()
                    await f.close()
                    rotate_log_file(log_file, max_backups)
                    bytes_written = 0
                    f = await _open_log()

                await f.write(persisted_line)
                bytes_written += len(persisted_line)

                try:
                    decoded = line.decode(errors="ignore").strip()
                except Exception:
                    decoded = ""
                if decoded:
                    info = stream_info.get(stream_id)
                    if info:
                        recent_errors = info.get("recent_errors")
                        if isinstance(recent_errors, deque):
                            recent_errors.append(decoded)
                            info["last_error_at"] = _utcnow()
                        await record_runtime_log_health(stream_id, decoded)
                    # Track 5b/C #2: feed parsed bitrate/fps/drops into the
                    # in-memory metrics registry. The parser is cheap (regex
                    # over the line) and silently ignores non-progress lines.
                    try:
                        from app.streaming.ffmpeg_metrics import ffmpeg_metrics

                        ffmpeg_metrics.feed_line(stream_id, decoded)
                    except Exception:  # pragma: no cover - never block log writer
                        pass
        finally:
            await f.flush()
            await f.close()
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(f"Error writing logs for stream {stream_id}: {exc}")


def rotate_log_file(log_file: Path, max_backups: int) -> None:
    if max_backups <= 0:
        try:
            log_file.unlink(missing_ok=True)
        except Exception:
            return
        return

    for idx in range(max_backups, 0, -1):
        src = log_file.with_suffix(log_file.suffix + f".{idx}")
        dst = log_file.with_suffix(log_file.suffix + f".{idx + 1}")
        if src.exists():
            src.replace(dst)

    if log_file.exists():
        log_file.replace(log_file.with_suffix(log_file.suffix + ".1"))
