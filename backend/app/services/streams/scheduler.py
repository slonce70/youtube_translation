"""Background launcher for scheduled streams."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import HTTPException
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.stream_schedule import (
    compute_next_repeating_start,
    compute_schedule_stop_time,
    ensure_utc,
    has_recurring_schedule,
)
from app.models.database import Stream
from .control import StreamControlService
from .service import load_stream_with_relations_options

logger = logging.getLogger(__name__)


async def launch_due_streams(db: AsyncSession, *, batch_size: int = 10) -> int:
    """Start streams whose scheduled time has arrived."""
    now = datetime.now(timezone.utc)
    retry_threshold = now - timedelta(
        seconds=settings.stream_schedule_retry_interval_seconds
    )

    query = (
        select(Stream)
        .where(
            Stream.scheduled_start_enabled.is_(True),
            Stream.scheduled_start_time.isnot(None),
            Stream.scheduled_start_time <= now,
            Stream.status.in_(["scheduled", "stopped", "error"]),
            or_(
                Stream.scheduled_start_attempted_at.is_(None),
                Stream.scheduled_start_attempted_at <= retry_threshold,
            ),
        )
        .order_by(Stream.scheduled_start_time)
        .limit(batch_size)
        .options(*load_stream_with_relations_options())
        .with_for_update(skip_locked=True)
    )

    result = await db.execute(query)
    streams: List[Stream] = result.scalars().all()
    if not streams:
        return 0

    launched = 0
    for stream in streams:
        occurrence_start = ensure_utc(stream.scheduled_start_time)
        recurring_schedule = has_recurring_schedule(stream)
        try:
            if occurrence_start is None:
                stream.scheduled_start_enabled = False
                stream.scheduled_start_attempted_at = None
                await db.flush()
                continue

            if recurring_schedule:
                occurrence_stop = compute_schedule_stop_time(
                    occurrence_start,
                    explicit_stop_at=None,
                    schedule_timezone=stream.schedule_timezone,
                    repeat=stream.schedule_repeat,
                    window_end_time=stream.schedule_window_end_time,
                    stop_after_seconds=stream.schedule_stop_after_seconds,
                )
                if occurrence_stop is not None and occurrence_stop <= now:
                    _advance_repeating_schedule(stream, occurrence_start)
                    logger.info(
                        "Skipped expired recurring schedule window for stream %s",
                        stream.id,
                    )
                    continue

            stream.scheduled_start_attempted_at = now
            await db.flush()
            control = StreamControlService(db, stream.user_id)
            await control.start_stream(stream.id, preserve_schedule=recurring_schedule)
            if recurring_schedule:
                stream.scheduled_stop_time = compute_schedule_stop_time(
                    occurrence_start,
                    explicit_stop_at=None,
                    schedule_timezone=stream.schedule_timezone,
                    repeat=stream.schedule_repeat,
                    window_end_time=stream.schedule_window_end_time,
                    stop_after_seconds=stream.schedule_stop_after_seconds,
                )
                stream.scheduled_stop_attempted_at = None
                stream.scheduled_start_time = compute_next_repeating_start(
                    occurrence_start,
                    schedule_timezone=stream.schedule_timezone,
                    repeat=stream.schedule_repeat,
                    weekdays=stream.schedule_weekdays,
                )
                stream.scheduled_start_attempted_at = None
            launched += 1
            logger.info("Scheduled stream %s launched", stream.id)
        except HTTPException as exc:
            log_fn = logger.info if exc.status_code == 409 else logger.warning
            log_fn(
                "Scheduled start failed for %s: %s",
                stream.id,
                exc.detail,
            )
        except Exception as exc:
            logger.exception(
                "Unexpected error launching scheduled stream %s: %s", stream.id, exc
            )
        finally:
            await db.commit()

    return launched


async def stop_due_streams(db: AsyncSession, *, batch_size: int = 10) -> int:
    """Stop streams whose scheduled stop time has arrived."""
    now = datetime.now(timezone.utc)
    retry_threshold = now - timedelta(
        seconds=settings.stream_schedule_retry_interval_seconds
    )

    query = (
        select(Stream)
        .where(
            Stream.scheduled_stop_time.isnot(None),
            Stream.scheduled_stop_time <= now,
            Stream.status.in_(["running", "starting"]),
            or_(
                Stream.scheduled_stop_attempted_at.is_(None),
                Stream.scheduled_stop_attempted_at <= retry_threshold,
            ),
        )
        .order_by(Stream.scheduled_stop_time)
        .limit(batch_size)
        .options(*load_stream_with_relations_options())
        .with_for_update(skip_locked=True)
    )

    result = await db.execute(query)
    streams: List[Stream] = result.scalars().all()
    if not streams:
        return 0

    stopped = 0
    for stream in streams:
        try:
            stream.scheduled_stop_attempted_at = now
            await db.flush()
            control = StreamControlService(db, stream.user_id)
            await control.stop_stream(stream.id)
            stream.scheduled_stop_time = None
            stream.scheduled_stop_attempted_at = None
            stopped += 1
            logger.info("Scheduled stream %s stopped", stream.id)
        except HTTPException as exc:
            logger.warning(
                "Scheduled stop failed for %s: %s",
                stream.id,
                exc.detail,
            )
        except Exception as exc:
            logger.exception(
                "Unexpected error stopping scheduled stream %s: %s", stream.id, exc
            )
        finally:
            await db.commit()

    return stopped


async def scheduled_stream_launcher() -> None:
    """Background loop that periodically triggers scheduled streams."""
    from app.core.database import async_session_maker

    interval = max(settings.stream_schedule_poll_interval_seconds, 5)

    while True:
        try:
            async with async_session_maker() as session:
                await launch_due_streams(session)
                await stop_due_streams(session)
        except Exception as exc:
            logger.error("Scheduled stream launcher error: %s", exc)
        await asyncio.sleep(interval)


def _advance_repeating_schedule(stream: Stream, occurrence_start: datetime) -> None:
    stream.scheduled_start_time = compute_next_repeating_start(
        occurrence_start,
        schedule_timezone=stream.schedule_timezone,
        repeat=stream.schedule_repeat,
        weekdays=stream.schedule_weekdays,
    )
    stream.scheduled_start_attempted_at = None
    stream.scheduled_stop_time = None
    stream.scheduled_stop_attempted_at = None
    if stream.status in {"stopped", "error", "scheduled"}:
        stream.status = "scheduled"
