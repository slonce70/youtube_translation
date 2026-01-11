import pytest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException

from app.core.database import async_session_maker
from app.models.database import Stream, UserProfile
from app.schemas.api import StreamScheduleUpdate
from app.services.streams.service import StreamService


@pytest.mark.asyncio
async def test_update_stream_schedule_sets_start_and_stop():
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule.test",
            subscription_tier="free",
        )
        session.add(profile)

        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="stopped",
        )
        session.add(stream)
        await session.commit()

        service = StreamService(session, user_id)
        start_at = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(microsecond=0)
        stop_at = (start_at + timedelta(hours=12)).replace(microsecond=0)

        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=start_at,
            schedule_stop_at=stop_at,
        )

        updated = await service.update_stream_schedule(stream.id, payload)

        assert updated.scheduled_start_enabled is True
        assert updated.status == "scheduled"
        assert updated.scheduled_start_time == start_at
        assert updated.scheduled_stop_time == stop_at


@pytest.mark.asyncio
async def test_update_stream_schedule_clears_start_when_now():
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-clear.test",
            subscription_tier="free",
        )
        session.add(profile)

        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="scheduled",
            scheduled_start_enabled=True,
            scheduled_start_time=(datetime.now(timezone.utc) + timedelta(hours=5)).replace(microsecond=0),
        )
        session.add(stream)
        await session.commit()

        service = StreamService(session, user_id)
        payload = StreamScheduleUpdate(
            schedule_mode="now",
            schedule_start_at=None,
            schedule_stop_at=None,
        )

        updated = await service.update_stream_schedule(stream.id, payload)

        assert updated.scheduled_start_enabled is False
        assert updated.scheduled_start_time is None
        assert updated.status == "stopped"


@pytest.mark.asyncio
async def test_update_stream_schedule_blocks_running_start():
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-running.test",
            subscription_tier="free",
        )
        session.add(profile)

        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="running",
        )
        session.add(stream)
        await session.commit()

        service = StreamService(session, user_id)
        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=(datetime.now(timezone.utc) + timedelta(hours=1)).replace(microsecond=0),
            schedule_stop_at=None,
        )

        with pytest.raises(HTTPException) as exc:
            await service.update_stream_schedule(stream.id, payload)

        assert exc.value.status_code == 400
