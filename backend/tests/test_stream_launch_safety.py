from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

import app.api.routes.destinations as destinations_routes
import app.services.streams.control as streams_control
from app.core.database import async_session_maker
from app.core.security import mask_stream_key
from app.models.database import Asset, Destination, Stream, StreamAsset, StreamDestination, UserProfile
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
) -> tuple:
    user_id = uuid4()

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@stream-safety.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )

        asset_path = tmp_path / f"{user_id}.mp4"
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
            status="stopped",
            source_type="assets",
            mix_mode="video_only",
        )
        destination = Destination(
            user_id=user_id,
            name="Primary",
            rtmps_url="rtmps://a.rtmp.youtube.com/live2",
            stream_key_encrypted="encrypted-placeholder",
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

        created = await destinations_routes.create_destination(payload, user_deps=(session, user_id))
        listed = await destinations_routes.list_destinations(user_deps=(session, user_id))
        fetched = await destinations_routes.get_destination(created["id"], user_deps=(session, user_id))

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
async def test_supervisor_start_fails_closed_when_all_destinations_disabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        destination_enabled=False,
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))

    async def fake_supervisor_program_status(_stream_id):
        return {"state": "STOPPED"}

    async def fake_supervisor_start_program(_stream_id):
        raise AssertionError("supervisor start should not be called for disabled destinations")

    monkeypatch.setattr(streams_control, "supervisor_program_status", fake_supervisor_program_status)
    monkeypatch.setattr(streams_control, "supervisor_start_program", fake_supervisor_start_program)

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id)

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream_id)

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "No enabled destinations found"

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "stopped"


@pytest.mark.asyncio
async def test_quality_and_supervisor_start_reject_incompatible_copy_first_media(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user_id, stream_id = await _create_stream_fixture(
        tmp_path,
        asset_copy_ready=False,
        validation_errors=["Direct copy is not safe"],
    )

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: False)
    monkeypatch.setattr(streams_control, "supervisor_enabled", lambda: True)
    monkeypatch.setattr(streams_control.default_settings, "stream_dir", str(tmp_path))

    async def fake_supervisor_program_status(_stream_id):
        return {"state": "STOPPED"}

    async def fake_supervisor_start_program(_stream_id):
        raise AssertionError("supervisor start should not be called for incompatible media")

    monkeypatch.setattr(streams_control, "supervisor_program_status", fake_supervisor_program_status)
    monkeypatch.setattr(streams_control, "supervisor_start_program", fake_supervisor_start_program)

    async with async_session_maker() as session:
        service = StreamControlService(session, user_id)

        quality = await service.evaluate_quality(stream_id)
        assert quality.ok is False
        assert {violation.code for violation in quality.violations} == {"incompatible_codecs"}

        with pytest.raises(HTTPException) as exc_info:
            await service.start_stream(stream_id)

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["error"] == "quality_rejected"
        assert exc_info.value.detail["violations"][0]["code"] == "incompatible_codecs"


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
