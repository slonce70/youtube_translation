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
from app.models.database import Stream
from .control import StreamControlService
from .service import load_stream_with_relations_options

logger = logging.getLogger(__name__)


async def launch_due_streams(db: AsyncSession, *, batch_size: int = 10) -> int:
    """Start streams whose scheduled time has arrived."""
    now = datetime.now(timezone.utc)
    retry_threshold = now - timedelta(seconds=settings.stream_schedule_retry_interval_seconds)

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
        try:
            stream.scheduled_start_attempted_at = now
            await db.flush()
            control = StreamControlService(db, stream.user_id)
            await control.start_stream(stream.id)
            launched += 1
            logger.info("Scheduled stream %s launched", stream.id)
        except HTTPException as exc:
            logger.warning(
                "Scheduled start failed for %s: %s",
                stream.id,
                exc.detail,
            )
        except Exception as exc:
            logger.exception("Unexpected error launching scheduled stream %s: %s", stream.id, exc)
        finally:
            await db.commit()

    return launched


async def stop_due_streams(db: AsyncSession, *, batch_size: int = 10) -> int:
    """Stop streams whose scheduled stop time has arrived."""
    now = datetime.now(timezone.utc)
    retry_threshold = now - timedelta(seconds=settings.stream_schedule_retry_interval_seconds)

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
            stopped += 1
            logger.info("Scheduled stream %s stopped", stream.id)
        except HTTPException as exc:
            logger.warning(
                "Scheduled stop failed for %s: %s",
                stream.id,
                exc.detail,
            )
        except Exception as exc:
            logger.exception("Unexpected error stopping scheduled stream %s: %s", stream.id, exc)
        finally:
            await db.commit()

    return stopped


async def scheduled_stream_launcher() -> None:
    """Background loop that periodically triggers scheduled streams."""
    from app.core.database import async_session_maker

    interval = max(settings.stream_schedule_poll_interval_seconds, 5)
    await asyncio.sleep(interval)

    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session_maker() as session:
                await launch_due_streams(session)
                await stop_due_streams(session)
        except Exception as exc:
            logger.error("Scheduled stream launcher error: %s", exc)
