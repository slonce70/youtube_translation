"""Standalone runner to launch and supervise a single FFmpeg stream."""

import argparse
import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from typing import Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_maker
from app.core.logging_config import setup_logging
from app.core.quota import QuotaEnforcer
from app.core.stream_runtime_heartbeat import (
    clear_runtime_heartbeat,
    write_runtime_heartbeat,
)
from app.core.stream_runtime_lease import (
    clear_stream_runtime_lease,
    release_stream_runtime_lease,
    renew_stream_runtime_lease,
)
from app.core.stream_runtime_restart import clear_stream_runtime_restart_state
from app.models.database import Stream
from app.streaming.ffmpeg_manager import ffmpeg_manager
from app.services.streams.helpers import (
    load_stream_with_relations,
    prepare_stream_launch,
)

LOGGER = logging.getLogger("app.cli.run_stream")
CURRENT_STREAM_ID: Optional[str] = None
CURRENT_HEARTBEAT_TASK: Optional[asyncio.Task] = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _load_stream_with_relations(db, stream_id: UUID) -> Tuple[Stream, UUID]:
    result = await db.execute(select(Stream).where(Stream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise RuntimeError(f"Stream {stream_id} not found")

    user_id = stream.user_id
    full_stream = await load_stream_with_relations(db, user_id, stream_id)
    if not full_stream:
        raise RuntimeError(f"Stream {stream_id} not found for user {user_id}")
    return full_stream, user_id


async def _update_stream_status_after_exit(stream: Stream) -> None:
    """Update DB status after stream exits to ensure consistency."""
    try:
        async with async_session_maker() as db:
            # Reload stream from DB to ensure we have latest state
            db_stream = await db.get(Stream, stream.id)
            if not db_stream:
                LOGGER.warning("Stream %s not found in DB after exit", stream.id)
                return

            # Check if manager has info about exit
            stream_info = ffmpeg_manager.get_stream_info(str(stream.id))

            if stream_info:
                exit_code = stream_info.get("last_exit_code")
                manual_stop = bool(stream_info.get("manual_stop"))
                quota_stop = stream_info.get("quota_stop") or {}
                quota_message = quota_stop.get("message")

                if manual_stop:
                    db_stream.status = "stopped"
                    db_stream.error_message = (
                        str(quota_message)[:500] if quota_message else None
                    )
                    LOGGER.info(
                        "Stream %s stopped cleanly after managed stop", stream.id
                    )
                elif exit_code is not None and exit_code != 0:
                    # Stream failed
                    db_stream.status = "error"
                    error_msg = f"FFmpeg exited with code {exit_code}"
                    if stream_info.get("recent_errors"):
                        last_errors = list(stream_info["recent_errors"])[-3:]
                        if last_errors:
                            error_msg += (
                                f". Last errors: {'; '.join(last_errors[:100])}"
                            )
                    db_stream.error_message = error_msg
                    LOGGER.error(
                        "Stream %s failed with exit code %s", stream.id, exit_code
                    )
                else:
                    # Stream exited normally
                    db_stream.status = "stopped"
                    db_stream.error_message = None
                    LOGGER.info("Stream %s stopped normally", stream.id)
            else:
                # No info from manager - assume stopped
                db_stream.status = "stopped"
                db_stream.error_message = None
                LOGGER.info("Stream %s stopped (no manager info)", stream.id)

            # Update timestamps
            db_stream.stopped_at = _utcnow()
            db_stream.pid = None
            clear_stream_runtime_lease(db_stream)
            clear_stream_runtime_restart_state(db_stream)

            await db.commit()
            LOGGER.info(
                "Updated stream %s status in DB to %s", stream.id, db_stream.status
            )

    except Exception as exc:
        LOGGER.exception(
            "Failed to update stream %s status after exit: %s", stream.id, exc
        )


async def _heartbeat_loop(stream_id: str) -> None:
    interval = max(
        int(getattr(settings, "stream_runtime_heartbeat_interval_seconds", 10)), 1
    )
    runner_pid = os.getpid()

    while True:
        stream_info = ffmpeg_manager.get_stream_info(stream_id) or {}
        write_runtime_heartbeat(
            stream_id,
            runner_pid=runner_pid,
            ffmpeg_pid=stream_info.get("pid"),
            launcher="cli",
            metadata=stream_info.get("metadata") or {},
        )
        try:
            async with async_session_maker() as db:
                renewed = await renew_stream_runtime_lease(
                    db,
                    stream_id,
                    owner_id=settings.stream_runtime_node_id,
                    ttl_seconds=settings.stream_runtime_lease_ttl_seconds,
                )
                await db.commit()
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.warning("Failed to renew runtime lease for %s: %s", stream_id, exc)
            renewed = True

        if not renewed:
            LOGGER.error(
                "Runtime lease for %s moved to another node. Stopping local FFmpeg runner.",
                stream_id,
            )
            await ffmpeg_manager.stop_stream(stream_id)
            return
        await asyncio.sleep(interval)


async def _stop_heartbeat_task(stream_id: str) -> None:
    global CURRENT_HEARTBEAT_TASK  # pylint: disable=global-statement

    task = CURRENT_HEARTBEAT_TASK
    CURRENT_HEARTBEAT_TASK = None
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    clear_runtime_heartbeat(stream_id)
    try:
        async with async_session_maker() as db:
            await release_stream_runtime_lease(
                db,
                stream_id,
                owner_id=settings.stream_runtime_node_id,
                force=True,
            )
            await db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.warning("Failed to release runtime lease for %s: %s", stream_id, exc)


async def _start_stream(stream_id: UUID, wait: bool = True) -> None:
    global CURRENT_STREAM_ID, CURRENT_HEARTBEAT_TASK  # pylint: disable=global-statement

    async with async_session_maker() as db:
        stream, user_id = await _load_stream_with_relations(db, stream_id)
        # Конкурентні ліміти вже перевіряються у FastAPI перед запуском supervisor
        # Повторна перевірка тут призводить до хибних спрацювань, бо цей самий
        # стрім уже має статус "starting". Тому просто передаємо Enforcer у
        # будівник плейлистів без другого check_concurrent_streams().
        enforcer = QuotaEnforcer(db, user_id)

        playlists, destinations, log_file = await prepare_stream_launch(
            db,
            user_id,
            stream,
            quota_evaluator=enforcer,
            settings_obj=settings,
        )

        CURRENT_STREAM_ID = str(stream.id)
        LOGGER.info(
            "Starting FFmpeg stream %s as standalone process", CURRENT_STREAM_ID
        )
        success = await ffmpeg_manager.start_stream(
            CURRENT_STREAM_ID,
            playlists,
            destinations,
            log_file,
            metadata={
                "user_id": str(user_id),
                "stream_id": CURRENT_STREAM_ID,
                "launcher": "cli",
            },
        )

        if not success:
            raise RuntimeError("Failed to start FFmpeg process")

        stream.status = "running"
        stream.started_at = _utcnow()
        stream.stopped_at = None
        stream.error_message = None
        info = ffmpeg_manager.get_stream_info(CURRENT_STREAM_ID) or {}
        stream.pid = info.get("pid")
        stream.log_path = str(log_file)
        await db.commit()

    if wait:
        CURRENT_HEARTBEAT_TASK = asyncio.create_task(_heartbeat_loop(CURRENT_STREAM_ID))
        LOGGER.info("Waiting for stream %s to finish", CURRENT_STREAM_ID)
        try:
            await ffmpeg_manager.wait_for_exit(CURRENT_STREAM_ID)
            LOGGER.info("Stream %s finished", CURRENT_STREAM_ID)
        finally:
            await _stop_heartbeat_task(CURRENT_STREAM_ID)

        # Update DB after stream exits to ensure consistency
        await _update_stream_status_after_exit(stream)


async def _handle_signal(sig: signal.Signals) -> None:
    if CURRENT_STREAM_ID:
        LOGGER.warning(
            "Signal %s received. Stopping stream %s", sig.name, CURRENT_STREAM_ID
        )
        try:
            await ffmpeg_manager.stop_stream(CURRENT_STREAM_ID)
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.error(
                "Failed to stop stream %s gracefully: %s", CURRENT_STREAM_ID, exc
            )


def _install_signal_handlers() -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(
                sig, lambda s=sig: asyncio.create_task(_handle_signal(s))
            )
        except NotImplementedError:  # pragma: no cover - Windows fallback
            signal.signal(
                sig, lambda *_args, s=sig: asyncio.create_task(_handle_signal(s))
            )


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch a stream outside FastAPI.")
    parser.add_argument("stream_id", help="UUID of the stream to start")
    parser.add_argument(
        "--no-wait",
        dest="wait",
        action="store_false",
        help="Start and exit without waiting for FFmpeg to finish",
    )
    return parser.parse_args(argv)


async def _async_entry(args: argparse.Namespace) -> None:
    try:
        stream_id = UUID(args.stream_id)
    except ValueError as exc:
        raise RuntimeError(f"Invalid stream_id: {args.stream_id}") from exc

    _install_signal_handlers()
    await _start_stream(stream_id, wait=args.wait)


def main(argv: Optional[list[str]] = None) -> int:
    setup_logging(level="INFO", json_output=False)
    args = _parse_args(argv)
    try:
        asyncio.run(_async_entry(args))
    except HTTPException as err:
        LOGGER.error("Stream launch rejected: %s", err.detail)
        return 1
    except RuntimeError as err:
        LOGGER.error("%s", err)
        return 2
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("Unexpected error: %s", exc)
        return 3

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
