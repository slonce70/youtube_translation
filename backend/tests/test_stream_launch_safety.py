from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

import app.api.routes.destinations as destinations_routes
import app.services.streams.control as streams_control
import app.services.streams.helpers as streams_helpers
from app.core.config import settings
from app.core.database import async_session_maker
from app.core.security import encrypt_stream_key, mask_stream_key
from app.core.stream_runtime_heartbeat import write_runtime_heartbeat
from app.main import app
from app.models.database import (
    Asset,
    Destination,
    SubscriptionTierLimits,
    Stream,
    StreamAsset,
    StreamDestination,
    UserProfile,
)
from app.schemas.api import DestinationCreate
from app.services.streams.control import StreamControlService


def _asset_meta() -> dict:
    return {
        "video": {
            "codec": "h264",
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "pix_fmt": "yuv420p",
        },
        "audio": {
            "codec": "aac",
            "sample_rate": 48_000,
            "channels": 2,
        },
        "bitrate": 4_500_000,
    }


async def _create_stream_fixture(
    tmp_path: Path,
    *,
    destination_enabled: bool = True,
    asset_copy_ready: bool = True,
    validation_errors: list[str] | None = None,
    subscription_tier: str = "free",
    stream_status: str = "stopped",
) -> tuple:
    user_id = uuid4()

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@stream-safety.test",
                subscription_tier=subscription_tier,
                subscription_status="active",
            )
        )

        asset_dir = Path(settings.upload_dir) / str(user_id)
        asset_dir.mkdir(parents=True, exist_ok=True)
        asset_path = asset_dir / f"{user_id}.mp4"
        asset_path.touch()

        asset = Asset(
            user_id=user_id,
            filename="copy-ready.mp4",
            storage_path=str(asset_path),
            size_bytes=1024,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=asset_copy_ready,
            validation_errors=validation_errors or [],
        )
        stream = Stream(
            user_id=user_id,
            name="Safety stream",
            status=stream_status,
            source_type="assets",
            mix_mode="video_only",
        )
        destination = Destination(
            user_id=user_id,
            name="Primary",
            rtmps_url="rtmps://a.rtmp.youtube.com/live2",
            stream_key_encrypted=encrypt_stream_key("stream-key-placeholder"),
            enabled=destination_enabled,
        )
        session.add_all([asset, stream, destination])
        await session.flush()

        session.add_all(
            [
                StreamAsset(stream_id=stream.id, asset_id=asset.id, position=0),
                StreamDestination(stream_id=stream.id, destination_id=destination.id),
            ]
        )
        await session.commit()

        return user_id, stream.id


async def _remove_tier_limits(session, tier: str) -> None:
    limits = await session.get(SubscriptionTierLimits, tier)
    if limits is not None:
        await session.delete(limits)
        await session.commit()


@pytest.mark.asyncio
async def test_destination_responses_only_expose_masked_keys() -> None:
    user_id = uuid4()
    raw_stream_key = "abcd-1234-secret"

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@destinations.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        await session.commit()

        payload = DestinationCreate(
            name="Channel A",
            rtmps_url="rtmps://a.rtmp.youtube.com/live2",
            stream_key=raw_stream_key,
            enabled=True,
        )

        created = await destinations_routes.create_destination(
            payload, user_deps=(session, user_id)
        )
        listed = await destinations_routes.list_destinations(
            user_deps=(session, user_id)
        )
        fetched = await destinations_routes.get_destination(
            created["id"], user_deps=(session, user_id)
        )

        expected_mask = mask_stream_key(raw_stream_key)
        assert created["stream_key_masked"] == expected_mask
        assert listed[0]["stream_key_masked"] == expected_mask
        assert fetched["stream_key_masked"] == expected_mask
        assert "stream_key" not in created
        assert "stream_key" not in listed[0]
        assert "stream_key" not in fetched

        destination_row = await session.get(Destination, created["id"])
        assert destination_row is not None
        assert destination_row.stream_key_encrypted != raw_stream_key


@pytest.mark.asyncio
async def test_manager_start_fails_closed_when_all_destinations_disabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        destination_enabled=False,
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))

    class DummyManager:
        def is_running(self, _stream_id: str) -> bool:
            return False

        def get_stream_info(self, _stream_id: str) -> dict:
            return {}

        async def start_stream(self, *_args, **_kwargs) -> bool:
            raise AssertionError(
                "manager start should not be called for disabled destinations"
            )

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id, manager=DummyManager())

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream_id)

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "No enabled destinations found"

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "stopped"


@pytest.mark.asyncio
async def test_quality_and_manager_start_reject_incompatible_copy_first_media(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        asset_copy_ready=False,
        validation_errors=["Direct copy is not safe"],
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))

    class DummyManager:
        def is_running(self, _stream_id: str) -> bool:
            return False

        def get_stream_info(self, _stream_id: str) -> dict:
            return {}

        async def start_stream(self, *_args, **_kwargs) -> bool:
            raise AssertionError(
                "manager start should not be called for incompatible media"
            )

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id, manager=DummyManager())

        quality = await service.evaluate_quality(stream_id)
        assert quality.ok is False
        assert {violation.code for violation in quality.violations} == {
            "incompatible_codecs"
        }

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream_id)

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["error"] == "quality_rejected"
        assert {item["code"] for item in exc_info.value.detail["violations"]} == {
            "incompatible_codecs"
        }


@pytest.mark.asyncio
async def test_http_start_route_rejects_incompatible_media_for_dev_auth_user(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        asset_copy_ready=False,
        validation_errors=["Direct copy is not safe"],
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(streams_control.default_settings, "enable_dev_auth", True)
    monkeypatch.setattr(streams_control.default_settings, "dev_user_id", str(user_id))
    monkeypatch.setattr(
        streams_control.default_settings,
        "dev_user_email",
        f"{user_id}@stream-safety.test",
    )

    monkeypatch.setattr(
        streams_control.default_ffmpeg_manager, "is_running", lambda _stream_id: False
    )
    monkeypatch.setattr(
        streams_control.default_ffmpeg_manager, "get_stream_info", lambda _stream_id: {}
    )

    async def fake_manager_start(*_args, **_kwargs):
        raise AssertionError("manager start should not be called for incompatible media")

    monkeypatch.setattr(
        streams_control.default_ffmpeg_manager, "start_stream", fake_manager_start
    )

    async with AsyncClient(app=app, base_url="http://testserver") as client:
        response = await client.post(f"/api/streams/{stream_id}/start")

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "quality_rejected"
    assert {item["code"] for item in response.json()["detail"]["violations"]} == {
        "incompatible_codecs"
    }


@pytest.mark.asyncio
async def test_quality_reports_stale_copy_safe_asset_but_start_skips_fresh_revalidation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        asset_copy_ready=True,
        validation_errors=[],
    )

    validate_calls = 0

    async def fake_validate_file(self, _file_path: Path) -> dict:
        nonlocal validate_calls
        validate_calls += 1
        return {
            "compatible_for_copy": False,
            "meta": {},
            "validation_errors": ["Keyframe interval too long: 5.20s (max 4.00s)"],
            "keyframe_stats": {"max_interval_seconds": 5.2},
        }

    monkeypatch.setattr(
        streams_helpers.VideoValidator,
        "validate_file",
        fake_validate_file,
    )
    monkeypatch.setattr(
        streams_helpers.shutil, "which", lambda _value: "/usr/bin/ffprobe"
    )
    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))

    class DummyManager:
        def is_running(self, _stream_id: str) -> bool:
            return False

        def get_stream_info(self, _stream_id: str) -> dict:
            return {"pid": 321, "uptime_seconds": 0}

        async def start_stream(self, *_args, **_kwargs) -> bool:
            return True

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id, manager=DummyManager())

        quality = await service.evaluate_quality(stream_id)
        assert quality.ok is False
        assert {violation.code for violation in quality.violations} == {
            "copy_source_not_live_safe"
        }
        assert validate_calls == 1

        status_payload = await service.start_stream(stream_id)
        stream = await session.get(Stream, stream_id)
        assert stream is not None

        assert status_payload.status == "running"
        assert status_payload.is_running is True
        assert stream.status == "running"
        assert validate_calls == 1


@pytest.mark.asyncio
async def test_launch_prerequisites_fail_closed_when_slot_dir_is_unwritable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))
    user_id, stream_id = await _create_stream_fixture(tmp_path)
    stream_dir = tmp_path / str(stream_id)
    slot_dir = stream_dir / "slots" / "video"
    slot_dir.mkdir(parents=True, exist_ok=True)
    slot_probe = slot_dir / ".write_probe"

    original_write_text = Path.write_text

    def fail_slot_probe(self: Path, data: str, *args, **kwargs):
        if self == slot_probe:
            raise PermissionError(13, "Permission denied", str(slot_dir))
        return original_write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_slot_probe)
    slot_dir.chmod(0o555)

    class AllowAllQuota:
        async def evaluate_stream_quality(self, *_args, **_kwargs):
            return {
                "ok": True,
                "violations": [],
                "tier": "free",
                "limits": {},
            }

    async with async_session_maker() as session:
        stream = await streams_helpers.load_stream_with_relations(
            session, user_id, stream_id
        )
        assert stream is not None

        with pytest.raises(HTTPException) as exc_info:
            await streams_helpers.validate_stream_launch_prerequisites(
                session,
                user_id,
                stream,
                quota_evaluator=AllowAllQuota(),
                settings_obj=streams_control.default_settings,
            )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == {
        "error": "runtime_storage_unavailable",
        "path": str(stream_dir),
        "message": "Stream runtime directory is not writable by the backend service user.",
    }


@pytest.mark.asyncio
async def test_http_quality_route_fails_closed_when_tier_limits_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        subscription_tier="fhd_start",
    )

    monkeypatch.setattr(streams_control.default_settings, "enable_dev_auth", True)
    monkeypatch.setattr(streams_control.default_settings, "dev_user_id", str(user_id))
    monkeypatch.setattr(
        streams_control.default_settings,
        "dev_user_email",
        f"{user_id}@stream-safety.test",
    )

    async with async_session_maker() as session:
        await _remove_tier_limits(session, "fhd_start")

    async with AsyncClient(app=app, base_url="http://testserver") as client:
        response = await client.get(f"/api/streams/{stream_id}/quality")

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "tier_limits_unavailable",
        "tier": "fhd_start",
        "message": (
            "Subscription tier limits are unavailable for this account. "
            "Streaming quality and launch checks cannot proceed until tier metadata is restored."
        ),
    }


@pytest.mark.asyncio
async def test_start_returns_authoritative_running_status_before_prerequisite_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        destination_enabled=False,
        subscription_tier="fhd_start",
        stream_status="running",
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)

    async def fail_validation(*args, **kwargs):
        raise AssertionError("launch prerequisites should not run for repeated starts")

    monkeypatch.setattr(
        streams_control,
        "validate_stream_launch_prerequisites",
        fail_validation,
    )

    class RunningManager:
        def is_running(self, _stream_id: str) -> bool:
            return True

        def get_stream_info(self, _stream_id: str) -> dict:
            return {"uptime_seconds": 15}

    async with async_session_maker() as session:
        await _remove_tier_limits(session, "fhd_start")
        service = StreamControlService(session, user_id, manager=RunningManager())
        status_payload = await service.start_stream(stream_id)

    assert status_payload.is_running is True
    assert status_payload.status == "running"
    assert status_payload.id == stream_id


@pytest.mark.asyncio
async def test_systemd_start_keeps_stream_starting_until_runtime_confirms_launch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(tmp_path)
    log_file = tmp_path / "stream.log"

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_validate(*args, **kwargs):
        return None, None, log_file

    async def fake_systemd_is_active(_stream_id):
        return False

    async def fake_systemd_unit_status(_stream_id):
        return {}

    async def fake_systemd_start_unit(_stream_id):
        async with async_session_maker() as check_session:
            db_stream = await check_session.get(Stream, stream_id)
            assert db_stream is not None
            assert db_stream.status == "starting"
            assert db_stream.runtime_last_heartbeat_at is None
            assert db_stream.log_path == str(log_file)

    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(
        streams_control,
        "validate_stream_launch_prerequisites",
        fake_validate,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )
    monkeypatch.setattr(streams_control, "systemd_start_unit", fake_systemd_start_unit)

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id)
        status_payload = await service.start_stream(stream_id)

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "starting"
        assert stream.log_path == str(log_file)
        assert stream.started_at is None

    assert status_payload.is_running is False
    assert status_payload.status == "starting"


@pytest.mark.asyncio
async def test_systemd_start_does_not_depend_on_second_commit_to_clear_schedule(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        stream_status="scheduled",
    )
    log_file = tmp_path / "stream.log"
    scheduled_start = datetime.now(timezone.utc) + timedelta(minutes=15)

    async with async_session_maker() as seed_session:
        stream = await seed_session.get(Stream, stream_id)
        assert stream is not None
        stream.started_at = datetime.now(timezone.utc) - timedelta(hours=1)
        stream.scheduled_start_enabled = True
        stream.scheduled_start_time = scheduled_start
        await seed_session.commit()

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_validate(*args, **kwargs):
        return None, None, log_file

    async def fake_systemd_is_active(_stream_id):
        return False

    async def fake_systemd_unit_status(_stream_id):
        return {}

    async def fake_systemd_start_unit(_stream_id):
        return None

    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(
        streams_control,
        "validate_stream_launch_prerequisites",
        fake_validate,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )
    monkeypatch.setattr(streams_control, "systemd_start_unit", fake_systemd_start_unit)

    async with async_session_maker() as session:
        real_commit = session.commit
        commit_calls = 0

        async def fail_only_on_second_commit():
            nonlocal commit_calls
            commit_calls += 1
            if commit_calls == 2:
                raise RuntimeError("finalize commit failed")
            await real_commit()

        monkeypatch.setattr(session, "commit", fail_only_on_second_commit)

        service = StreamControlService(session, user_id)
        status_payload = await service.start_stream(stream_id)

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "starting"
        assert stream.log_path == str(log_file)
        assert stream.started_at is None
        assert stream.scheduled_start_enabled is False
        assert stream.scheduled_start_time is None

    assert status_payload.is_running is False
    assert status_payload.status == "starting"


@pytest.mark.asyncio
async def test_systemd_start_restores_stream_when_unit_launch_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(tmp_path)
    log_file = tmp_path / "stream.log"
    previous_started_at = datetime.now(timezone.utc) - timedelta(hours=2)
    previous_scheduled_start = datetime.now(timezone.utc) + timedelta(minutes=20)
    previous_scheduled_attempt = previous_scheduled_start - timedelta(minutes=5)

    async with async_session_maker() as seed_session:
        stream = await seed_session.get(Stream, stream_id)
        assert stream is not None
        stream.status = "scheduled"
        stream.started_at = previous_started_at
        stream.scheduled_start_enabled = True
        stream.scheduled_start_time = previous_scheduled_start
        stream.scheduled_start_attempted_at = previous_scheduled_attempt
        await seed_session.commit()

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_validate(*args, **kwargs):
        return None, None, log_file

    async def fake_systemd_is_active(_stream_id):
        return False

    async def fake_systemd_unit_status(_stream_id):
        return {}

    async def fake_systemd_start_unit(_stream_id):
        raise OSError("boom")

    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(
        streams_control,
        "validate_stream_launch_prerequisites",
        fake_validate,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )
    monkeypatch.setattr(streams_control, "systemd_start_unit", fake_systemd_start_unit)

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id)

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream_id)

        assert exc_info.value.status_code == 500
        assert exc_info.value.detail == "boom"

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "scheduled"
        assert stream.started_at == previous_started_at
        assert stream.log_path is None
        assert stream.scheduled_start_enabled is True
        assert stream.scheduled_start_time == previous_scheduled_start
        assert stream.scheduled_start_attempted_at == previous_scheduled_attempt


@pytest.mark.asyncio
async def test_systemd_start_returns_existing_starting_status_before_relaunch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path, stream_status="starting"
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_systemd_is_active(_stream_id):
        return False

    async def fake_systemd_unit_status(_stream_id):
        return {"ActiveState": "inactive"}

    async def fail_validate(*args, **kwargs):
        raise AssertionError(
            "launch prerequisites should not run for existing starting state"
        )

    async def fail_systemd_start(_stream_id):
        raise AssertionError("systemd start should not run for existing starting state")

    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )
    monkeypatch.setattr(
        streams_control,
        "validate_stream_launch_prerequisites",
        fail_validate,
    )
    monkeypatch.setattr(streams_control, "systemd_start_unit", fail_systemd_start)

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id)
        status_payload = await service.start_stream(stream_id)

    assert status_payload.is_running is False
    assert status_payload.status == "starting"
    assert status_payload.id == stream_id


@pytest.mark.asyncio
async def test_systemd_status_stays_starting_when_unit_is_active_without_runtime_confirmation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        stream_status="running",
    )

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_systemd_is_active(_stream_id):
        return True

    async def fake_systemd_unit_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)
    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )

    async with async_session_maker() as session:
        stream = await session.get(Stream, stream_id)
        assert stream is not None
        stream.started_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        await session.commit()

        service = StreamControlService(session, user_id)
        status_payload = await service.get_stream_status(stream_id)
        await session.refresh(stream)

        assert status_payload.status == "starting"
        assert status_payload.is_running is False
        assert status_payload.error_message is None
        assert stream.status == "starting"
        assert stream.started_at is None


@pytest.mark.asyncio
async def test_systemd_status_turns_running_after_fresh_runtime_heartbeat(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        stream_status="starting",
    )

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_systemd_is_active(_stream_id):
        return True

    async def fake_systemd_unit_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)
    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )

    async with async_session_maker() as session:
        stream = await session.get(Stream, stream_id)
        assert stream is not None

        write_runtime_heartbeat(
            stream_id,
            runner_pid=321,
            runtime_mode="systemd",
        )

        service = StreamControlService(session, user_id)
        status_payload = await service.get_stream_status(stream_id)
        await session.refresh(stream)

        assert status_payload.status == "running"
        assert status_payload.is_running is True
        assert stream.status == "running"
        assert stream.started_at is not None
        assert stream.runtime_last_heartbeat_at is not None


@pytest.mark.asyncio
async def test_systemd_status_fails_closed_when_heartbeat_is_stale(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        streams_control.default_settings, "upload_dir", str(tmp_path / "uploads")
    )
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(
        streams_control.default_settings,
        "stream_runtime_mode",
        "systemd",
    )
    monkeypatch.setattr(
        streams_control.default_settings,
        "stream_runtime_heartbeat_ttl_seconds",
        15,
    )
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        stream_status="starting",
    )

    async def fake_enrich_streams(self, streams):
        return None

    async def fake_attach_runtime_incident_summaries(_db, _streams, manager=None):
        return None

    async def fake_systemd_is_active(_stream_id):
        return True

    async def fake_systemd_unit_status(_stream_id):
        return {"ActiveState": "active", "SubState": "running"}

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)
    monkeypatch.setattr(
        streams_control.YoutubeProviderStatusService,
        "enrich_streams",
        fake_enrich_streams,
    )
    monkeypatch.setattr(
        streams_control,
        "attach_runtime_incident_summaries",
        fake_attach_runtime_incident_summaries,
    )
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(
        streams_control, "systemd_unit_status", fake_systemd_unit_status
    )

    async with async_session_maker() as session:
        stream = await session.get(Stream, stream_id)
        assert stream is not None

        write_runtime_heartbeat(
            stream_id,
            runner_pid=654,
            runtime_mode="systemd",
            now=datetime.now(timezone.utc) - timedelta(seconds=60),
            ttl_seconds=5,
        )

        service = StreamControlService(session, user_id)
        status_payload = await service.get_stream_status(stream_id)
        await session.refresh(stream)

        assert status_payload.status == "error"
        assert status_payload.is_running is False
        assert status_payload.error_message is not None
        assert "heartbeat expired" in status_payload.error_message
        assert status_payload.runtime_restart.enabled is False
        assert status_payload.runtime_restart.attempts == 0
        assert status_payload.runtime_restart.max_attempts == 0
        assert status_payload.runtime_restart.state == "disabled"
        assert stream.status == "error"


@pytest.mark.asyncio
async def test_stream_logs_support_empty_filtered_and_raw_modes(tmp_path: Path) -> None:
    user_id = uuid4()
    log_path = tmp_path / "stream.log"

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@logs.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        stream = Stream(
            user_id=user_id,
            name="Logs stream",
            status="stopped",
            source_type="assets",
            mix_mode="video_only",
            log_path=str(log_path),
        )
        session.add(stream)
        await session.commit()

        service = StreamControlService(session, user_id)

        empty = await service.get_stream_logs(stream.id, 50)
        assert empty.logs == []
        assert empty.total_lines == 0

        log_path.write_text(
            "\n".join(
                [
                    "frame=12 fps=30.0 q=28.0 size=1kB time=00:00:01.00 bitrate=8.0kbits/s",
                    "Connection reset by peer",
                    "Press [q] to stop, [?] for help",
                    "broken pipe",
                    "Playlist switched successfully",
                ]
            ),
            encoding="utf-8",
        )

        important = await service.get_stream_logs(stream.id, 50)
        raw = await service.get_stream_logs(stream.id, 50, mode="raw")

        assert raw.total_lines == 5
        assert raw.logs[0].startswith("frame=12")
        assert "Connection reset by peer" in raw.logs
        assert "broken pipe" in raw.logs

        assert important.logs == [
            "Connection reset by peer",
            "broken pipe",
        ]
