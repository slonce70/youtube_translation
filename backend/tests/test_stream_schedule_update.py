import pytest
from datetime import datetime, time, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.core.database import async_session_maker
from app.models.database import Asset, Destination, Stream, UserProfile
from app.schemas.api import StreamCreate, StreamScheduleUpdate
from app.services.streams.service import StreamService


@pytest.mark.asyncio
async def test_create_stream_persists_immediate_intent():
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-create-now.test",
            subscription_tier="free",
        )
        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{uuid4()}.mp4",
            size_bytes=1024,
            asset_type="video",
        )
        destination = Destination(
            user_id=user_id,
            name="YouTube",
            stream_key_encrypted="encrypted-key",
        )
        session.add_all([profile, asset, destination])
        await session.commit()

        service = StreamService(session, user_id)
        created = await service.create_stream(
            StreamCreate(asset_ids=[asset.id], destination_ids=[destination.id])
        )

        assert created.status == "stopped"
        assert created.scheduled_start_enabled is False
        assert created.scheduled_start_time is None
        assert created.scheduled_stop_time is None


@pytest.mark.asyncio
async def test_create_stream_persists_scheduled_intent():
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-create-later.test",
            subscription_tier="free",
        )
        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{uuid4()}.mp4",
            size_bytes=1024,
            asset_type="video",
        )
        destination = Destination(
            user_id=user_id,
            name="YouTube",
            stream_key_encrypted="encrypted-key",
        )
        session.add_all([profile, asset, destination])
        await session.commit()

        service = StreamService(session, user_id)
        start_at = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(
            microsecond=0
        )
        stop_at = (start_at + timedelta(hours=1)).replace(microsecond=0)
        created = await service.create_stream(
            StreamCreate(
                asset_ids=[asset.id],
                destination_ids=[destination.id],
                schedule_mode="schedule",
                schedule_start_at=start_at,
                schedule_stop_at=stop_at,
            )
        )

        assert created.status == "scheduled"
        assert created.scheduled_start_enabled is True
        assert created.scheduled_start_time == start_at
        assert created.scheduled_stop_time == stop_at


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
async def test_update_stream_schedule_sets_recurring_timezone_and_window_defaults():
    user_id = uuid4()
    zone = ZoneInfo("Europe/Kyiv")

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-recurring.test",
            subscription_tier="free",
            timezone="Europe/Kyiv",
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
        local_start = datetime(2026, 4, 6, 17, 30, tzinfo=zone)
        start_at = local_start.astimezone(timezone.utc).replace(microsecond=0)

        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=start_at,
            schedule_repeat="weekly",
            schedule_window_end_time=time(18, 0),
            schedule_stop_after_seconds=7200,
        )

        updated = await service.update_stream_schedule(stream.id, payload)

        assert updated.schedule_timezone == "Europe/Kyiv"
        assert updated.schedule_repeat == "weekly"
        assert updated.schedule_weekdays == [0]
        assert updated.schedule_window_end_time == time(18, 0)
        assert updated.schedule_stop_after_seconds == 7200
        assert updated.scheduled_stop_time == datetime(2026, 4, 6, 15, 0, tzinfo=timezone.utc)


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


@pytest.mark.asyncio
async def test_update_stream_schedule_blocks_real_live_reschedule_when_db_status_is_stale(
    monkeypatch,
):
    user_id = uuid4()

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-runtime-live.test",
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

        monkeypatch.setattr("app.services.streams.control.supervisor_enabled", lambda: True)
        monkeypatch.setattr("app.services.streams.control.systemd_enabled", lambda: False)

        async def fake_supervisor_program_status(_stream_id):
            assert _stream_id == stream.id
            return {"state": "RUNNING"}

        monkeypatch.setattr(
            "app.services.streams.control.supervisor_program_status",
            fake_supervisor_program_status,
        )

        service = StreamService(session, user_id)
        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=(datetime.now(timezone.utc) + timedelta(hours=1)).replace(
                microsecond=0
            ),
            schedule_stop_at=None,
        )

        with pytest.raises(HTTPException) as exc:
            await service.update_stream_schedule(stream.id, payload)

        assert exc.value.status_code == 400
        assert exc.value.detail == "Cannot schedule start while stream is running"


@pytest.mark.asyncio
async def test_update_stream_schedule_fails_closed_when_supervisor_liveness_is_unavailable(
    monkeypatch,
):
    user_id = uuid4()
    started_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(
        microsecond=0
    )

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-supervisor-unavailable.test",
            subscription_tier="free",
        )
        session.add(profile)

        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="stopped",
            started_at=started_at,
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr("app.services.streams.control.supervisor_enabled", lambda: True)
        monkeypatch.setattr("app.services.streams.control.systemd_enabled", lambda: False)

        async def fake_supervisor_program_status(_stream_id):
            assert _stream_id == stream.id
            return {
                "state": "SUPERVISOR_UNAVAILABLE",
                "error": "supervisorctl socket unavailable",
            }

        monkeypatch.setattr(
            "app.services.streams.control.supervisor_program_status",
            fake_supervisor_program_status,
        )

        service = StreamService(session, user_id)
        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=(datetime.now(timezone.utc) + timedelta(hours=1)).replace(
                microsecond=0
            ),
            schedule_stop_at=None,
        )

        with pytest.raises(HTTPException) as exc:
            await service.update_stream_schedule(stream.id, payload)

        assert exc.value.status_code == 400
        assert (
            exc.value.detail
            == "Cannot schedule start while runtime liveness cannot be verified"
        )


@pytest.mark.asyncio
async def test_update_stream_schedule_fails_closed_when_systemd_liveness_is_unavailable(
    monkeypatch,
):
    user_id = uuid4()
    started_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(
        microsecond=0
    )

    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@schedule-systemd-unavailable.test",
            subscription_tier="free",
        )
        session.add(profile)

        stream = Stream(
            user_id=user_id,
            source_type="playlist",
            mix_mode="video_only",
            status="stopped",
            started_at=started_at,
        )
        session.add(stream)
        await session.commit()

        monkeypatch.setattr("app.services.streams.control.supervisor_enabled", lambda: False)
        monkeypatch.setattr("app.services.streams.control.systemd_enabled", lambda: True)

        async def fake_systemd_unit_status(_stream_id):
            assert _stream_id == stream.id
            return {}

        monkeypatch.setattr(
            "app.services.streams.control.systemd_unit_status",
            fake_systemd_unit_status,
        )

        service = StreamService(session, user_id)
        payload = StreamScheduleUpdate(
            schedule_mode="schedule",
            schedule_start_at=(datetime.now(timezone.utc) + timedelta(hours=1)).replace(
                microsecond=0
            ),
            schedule_stop_at=None,
        )

        with pytest.raises(HTTPException) as exc:
            await service.update_stream_schedule(stream.id, payload)

        assert exc.value.status_code == 400
        assert (
            exc.value.detail
            == "Cannot schedule start while runtime liveness cannot be verified"
        )
