from datetime import datetime, time, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.core.database import async_session_maker
from app.core.stream_schedule import (
    compute_next_repeating_start,
    compute_schedule_stop_time,
)
from app.models.database import Stream, UserProfile
from app.services.streams.scheduler import launch_due_streams


@pytest.mark.asyncio
async def test_launch_due_streams_advances_recurring_schedule_after_start(monkeypatch):
    user_id = uuid4()
    original_start = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(microsecond=0)

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@scheduler-start.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="scheduled",
            scheduled_start_enabled=True,
            scheduled_start_time=original_start,
            schedule_repeat="daily",
            schedule_timezone="UTC",
            schedule_stop_after_seconds=3600,
        )
        session.add(stream)
        await session.commit()

        async def fake_start(self, stream_id, *, preserve_schedule=False):
            assert preserve_schedule is True
            scheduled_stream = await self._get_stream_basic(stream_id)
            scheduled_stream.status = "running"
            scheduled_stream.started_at = datetime.now(timezone.utc).replace(microsecond=0)
            scheduled_stream.stopped_at = None
            scheduled_stream.error_message = None
            return None

        monkeypatch.setattr("app.services.streams.scheduler.StreamControlService.start_stream", fake_start)

        launched = await launch_due_streams(session)
        await session.refresh(stream)

        assert launched == 1
        assert stream.status == "running"
        assert stream.scheduled_stop_time == original_start + timedelta(hours=1)
        assert stream.scheduled_start_time == original_start + timedelta(days=1)
        assert stream.scheduled_start_attempted_at is None


@pytest.mark.asyncio
async def test_launch_due_streams_skips_expired_recurring_window(monkeypatch):
    user_id = uuid4()
    original_start = (datetime.now(timezone.utc) - timedelta(hours=3)).replace(microsecond=0)

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@scheduler-window.test",
                subscription_tier="free",
            )
        )
        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="scheduled",
            scheduled_start_enabled=True,
            scheduled_start_time=original_start,
            schedule_repeat="daily",
            schedule_timezone="UTC",
            schedule_window_end_time=(original_start + timedelta(hours=1)).timetz().replace(tzinfo=None),
        )
        session.add(stream)
        await session.commit()

        async def fake_start(self, stream_id, *, preserve_schedule=False):  # pragma: no cover - should not run
            raise AssertionError("expired recurring window should not trigger start_stream")

        monkeypatch.setattr("app.services.streams.scheduler.StreamControlService.start_stream", fake_start)

        launched = await launch_due_streams(session)
        await session.refresh(stream)

        assert launched == 0
        assert stream.status == "scheduled"
        assert stream.scheduled_start_time == original_start + timedelta(days=1)
        assert stream.scheduled_stop_time is None


def test_compute_next_repeating_start_preserves_local_time_across_dst():
    start_at = datetime(2026, 3, 7, 15, 30, tzinfo=timezone.utc)

    next_start = compute_next_repeating_start(
        start_at,
        schedule_timezone="America/New_York",
        repeat="daily",
    )

    local = next_start.astimezone(ZoneInfo("America/New_York"))
    assert next_start == datetime(2026, 3, 8, 14, 30, tzinfo=timezone.utc)
    assert (local.hour, local.minute) == (10, 30)


def test_compute_next_repeating_start_uses_next_matching_weekday():
    start_at = datetime(2026, 3, 6, 9, 0, tzinfo=timezone.utc)  # Friday

    next_start = compute_next_repeating_start(
        start_at,
        schedule_timezone="UTC",
        repeat="weekly",
        weekdays=[0, 2],
    )

    assert next_start == datetime(2026, 3, 9, 9, 0, tzinfo=timezone.utc)


def test_compute_schedule_stop_time_prefers_earliest_constraint():
    start_at = datetime(2026, 4, 6, 14, 30, tzinfo=timezone.utc)

    stop_at = compute_schedule_stop_time(
        start_at,
        explicit_stop_at=None,
        schedule_timezone="Europe/Kyiv",
        repeat="weekly",
        window_end_time=time(18, 0),
        stop_after_seconds=7200,
    )

    assert stop_at == datetime(2026, 4, 6, 15, 0, tzinfo=timezone.utc)
