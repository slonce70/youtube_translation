"""
Tests for FFmpeg stream manager (process management, cleanup).
"""

from collections import deque
from datetime import datetime, timedelta, timezone
import signal
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.core.database import async_session_maker
from app.models.database import Stream, StreamEvent, SystemAlert, UserProfile
from app.streaming.ffmpeg_manager import FFmpegStreamManager
from app.streaming.hot_swap import hot_swap_manager
from app.streaming.playlist_builder import PlaylistFileSet


class _FakeStreamReader:
    def __init__(self, lines):
        self._lines = [line.encode("utf-8") + b"\n" for line in lines] + [b""]

    async def readline(self):
        return self._lines.pop(0)


class _FakeProcess:
    def __init__(self, lines):
        self.stderr = _FakeStreamReader(lines)


async def _create_owned_stream_record(*, user_id, stream_id, log_file, name, email_prefix):
    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{email_prefix}-{uuid4()}@example.com",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        session.add(
            Stream(
                id=stream_id,
                user_id=user_id,
                name=name,
                status="running",
                log_path=str(log_file),
            )
        )
        await session.commit()


class TestFFmpegStreamManager:
    """Test FFmpeg stream manager functionality"""

    @pytest.mark.asyncio
    async def test_cleanup_dead_streams(self):
        """Test cleanup of dead stream info to prevent memory leaks"""
        manager = FFmpegStreamManager()

        # Create mock processes
        dead_process = MagicMock()
        dead_process.returncode = 1  # Process has exited

        alive_process = MagicMock()
        alive_process.returncode = None  # Process still running

        # Add streams to manager
        manager.active_streams["dead-stream"] = dead_process
        manager.active_streams["alive-stream"] = alive_process

        manager.stream_info["dead-stream"] = {"started_at": "2024-01-01"}
        manager.stream_info["alive-stream"] = {"started_at": "2024-01-01"}

        # Run cleanup
        await manager.cleanup_dead_streams()

        # Verify dead stream was removed
        assert "dead-stream" not in manager.active_streams
        assert "dead-stream" not in manager.stream_info

        # Verify alive stream still exists
        assert "alive-stream" in manager.active_streams
        assert "alive-stream" in manager.stream_info

    @pytest.mark.asyncio
    async def test_cleanup_dead_streams_prunes_stale_error_history(self):
        """Stale stream info without active process should be pruned after cutoff."""
        manager = FFmpegStreamManager()

        stale_started_at = datetime.now(timezone.utc) - timedelta(hours=2)
        manager.stream_info["stale-stream"] = {
            "started_at": stale_started_at,
            "recent_errors": deque(["boom"], maxlen=20),
        }

        await manager.cleanup_dead_streams()

        assert "stale-stream" not in manager.stream_info

    @pytest.mark.asyncio
    async def test_stop_stream_cleans_up_orphaned_info(self):
        """Test that stop_stream cleans up orphaned stream info"""
        manager = FFmpegStreamManager()

        # Add orphaned stream info (no active process)
        manager.stream_info["orphaned-stream"] = {"started_at": "2024-01-01"}

        # Try to stop non-existent stream
        result = await manager.stop_stream("orphaned-stream")

        # Should return False (not running)
        assert result is False

        # But should cleanup the orphaned info
        assert "orphaned-stream" not in manager.stream_info

    @pytest.mark.asyncio
    async def test_stop_stream_preserves_manual_stop_until_monitor_cleanup(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """Managed stop metadata must survive until the monitor task observes exit."""

        manager = FFmpegStreamManager()
        stream_id = "manual-stop-cleanup"

        process = MagicMock()
        process.pid = 4242
        process.send_signal = MagicMock()

        manager.active_streams[stream_id] = process
        manager.stream_info[stream_id] = {"started_at": "2024-01-01"}

        wait_for_exit = AsyncMock(return_value=255)
        monkeypatch.setattr(manager, "_await_process_exit", wait_for_exit)

        observed: dict[str, bool] = {}

        async def fake_await_monitor_task(target_stream_id: str) -> None:
            observed["manual_stop"] = bool(
                manager.stream_info[target_stream_id]["manual_stop"]
            )

        monkeypatch.setattr(manager, "_await_monitor_task", fake_await_monitor_task)
        monkeypatch.setattr(hot_swap_manager, "unregister_stream", AsyncMock())

        result = await manager.stop_stream(stream_id)

        assert result is True
        process.send_signal.assert_called_once_with(signal.SIGINT)
        assert wait_for_exit.await_count == 1
        assert observed == {"manual_stop": True}
        assert stream_id not in manager.active_streams
        assert stream_id not in manager.stream_info

    def test_is_running_returns_false_for_nonexistent_stream(self):
        """Test is_running returns False for streams that don't exist"""
        manager = FFmpegStreamManager()

        assert manager.is_running("nonexistent-stream") is False

    def test_get_stream_info_returns_none_for_nonexistent_stream(self):
        """Test get_stream_info returns None for streams that don't exist"""
        manager = FFmpegStreamManager()

        info = manager.get_stream_info("nonexistent-stream")
        assert info is None

    def test_get_stream_info_calculates_uptime_for_aware_start(self):
        """Running streams with aware UTC timestamps should expose uptime seconds."""
        manager = FFmpegStreamManager()
        process = MagicMock()
        process.returncode = None

        stream_id = "aware-stream"
        manager.active_streams[stream_id] = process
        manager.stream_info[stream_id] = {
            "started_at": datetime.now(timezone.utc) - timedelta(seconds=5),
            "pid": 4321,
        }

        info = manager.get_stream_info(stream_id)

        assert info is not None
        assert info["is_running"] is True
        assert info["uptime_seconds"] >= 5

    @pytest.mark.asyncio
    async def test_stop_all_streams_cleanup(self):
        """Test that stop_all_streams properly cleans up all streams"""
        manager = FFmpegStreamManager()

        # Mock processes
        process1 = AsyncMock()
        process1.returncode = None
        process1.pid = 1234
        process1.send_signal = MagicMock()
        process1.wait = AsyncMock()

        process2 = AsyncMock()
        process2.returncode = None
        process2.pid = 5678
        process2.send_signal = MagicMock()
        process2.wait = AsyncMock()

        # Add streams
        manager.active_streams["stream1"] = process1
        manager.active_streams["stream2"] = process2
        manager.stream_info["stream1"] = {"pid": 1234}
        manager.stream_info["stream2"] = {"pid": 5678}

        # Stop all streams
        await manager.stop_all_streams()

        # Verify all streams were removed
        assert len(manager.active_streams) == 0
        assert len(manager.stream_info) == 0

    @pytest.mark.asyncio
    async def test_handle_stream_failure_triggers_restart(self, tmp_path, monkeypatch):
        """Ensure a failing stream triggers auto-restart and alert recording."""
        manager = FFmpegStreamManager()
        stream_id = "11111111-1111-1111-1111-111111111111"
        playlist_file = tmp_path / "playlist.txt"
        playlist_file.write_text("ffconcat version 1.0\n")
        log_file = tmp_path / "stream.log"

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=playlist_file,
            audio_playlist=None,
            mix_mode="video_only",
            video_loop=True,
            audio_loop=False,
            needs_video_placeholder=False,
            needs_audio_placeholder=True,
            video_copy_compatible=True,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
            "playlists": playlists,
            "destinations": [{"url": "rtmp://example.com/live", "key": "secret"}],
            "log_file": str(log_file),
            "restart_attempts": 0,
            "recent_errors": deque(["Initial failure"], maxlen=20),
        }
        manager.active_streams[stream_id] = AsyncMock()

        # Configure settings to allow restart without delay
        monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 2)
        monkeypatch.setattr(settings, "ffmpeg_restart_backoff_seconds", 0)
        monkeypatch.setattr("app.streaming.ffmpeg_manager.asyncio.sleep", AsyncMock())

        manager._create_restart_warning_alert = AsyncMock()

        restart_invocation = {}

        async def fake_restart(
            sid,
            playlists_snapshot,
            destinations,
            log_path,
            metadata=None,
            restart=False,
        ):
            restart_invocation["restart_flag"] = restart
            restart_invocation["metadata"] = metadata
            return True

        monkeypatch.setattr(manager, "start_stream", fake_restart)

        await manager._handle_stream_failure(stream_id, returncode=1)

        # Ensure restart attempted
        assert restart_invocation.get("restart_flag") is True
        assert (
            restart_invocation["metadata"]["user_id"]
            == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        )

        # Alert created at least once (warning for restart)
        assert manager._create_restart_warning_alert.await_count >= 1

        # restart attempts incremented
        assert manager.stream_info[stream_id]["restart_attempts"] == 1

    @pytest.mark.asyncio
    async def test_handle_stream_failure_exhausts_restarts(self, monkeypatch):
        """When no restarts remain, stream info is cleaned up and alert escalated."""
        manager = FFmpegStreamManager()
        stream_id = "22222222-2222-2222-2222-222222222222"

        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"},
            "restart_attempts": settings.ffmpeg_auto_restart_attempts,
            "recent_errors": deque(["fatal"], maxlen=20),
        }
        manager.active_streams[stream_id] = AsyncMock()

        monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 0)
        manager._create_restart_warning_alert = AsyncMock()
        manager.start_stream = AsyncMock()
        marker = AsyncMock()
        monkeypatch.setattr(manager, "_mark_stream_failed", marker)

        await manager._handle_stream_failure(stream_id, returncode=1)

        # start_stream should not be invoked when restart attempts exhausted
        manager.start_stream.assert_not_called()
        # Terminal alert persistence is delegated to the error-state writer.
        manager._create_restart_warning_alert.assert_not_called()
        marker.assert_awaited_once()

    def test_build_command_includes_bitrate_limits_for_transcoding(
        self, tmp_path, monkeypatch
    ):
        """Ensure explicit bitrate flags are present when source media is not copy-compatible."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        video_playlist = tmp_path / "video.txt"
        audio_playlist = tmp_path / "audio.txt"
        video_playlist.write_text("ffconcat version 1.0\n")
        audio_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=audio_playlist,
            mix_mode="mixed",
            video_loop=True,
            audio_loop=True,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        destinations = [
            {"url": "rtmp://a.youtube.com/live", "key": "primary"},
            {"url": "rtmp://b.youtube.com/live", "key": "backup"},
        ]

        monkeypatch.setattr(settings, "ffmpeg_video_bitrate_kbps", 4500)
        monkeypatch.setattr(settings, "ffmpeg_video_maxrate_kbps", 6000)
        monkeypatch.setattr(settings, "ffmpeg_video_bufsize_kbps", 9000)
        monkeypatch.setattr(settings, "ffmpeg_audio_bitrate_kbps", 192)
        monkeypatch.setattr(settings, "placeholder_audio_sample_rate", 44100)

        plan = manager._build_command(playlists, destinations)
        cmd = plan.command

        assert "-b:v" in cmd
        assert cmd[cmd.index("-b:v") + 1] == "4500k"
        assert "-maxrate" in cmd
        assert cmd[cmd.index("-maxrate") + 1] == "6000k"
        assert "-bufsize" in cmd
        assert cmd[cmd.index("-bufsize") + 1] == "9000k"
        assert "-tune" in cmd and cmd[cmd.index("-tune") + 1] == "zerolatency"

        assert "-keyint_min" in cmd
        assert "-sc_threshold" in cmd
        assert "-force_key_frames" in cmd
        force_key_idx = cmd.index("-force_key_frames")
        assert cmd[force_key_idx + 1].startswith("expr:gte(t,n_forced*")

        assert "-b:a" in cmd
        assert cmd[cmd.index("-b:a") + 1] == "192k"

        # Multicast should still use tee muxer
        assert "tee" in cmd
        tee_index = cmd.index("tee")
        assert tee_index > 0 and cmd[tee_index - 1] == "-f"
        assert any(
            "fifo_format=flv" in part for part in cmd if part.startswith("[select")
        )
        assert any(
            "onfail=ignore" in part for part in cmd if part.startswith("[select")
        )

        assert plan.copy_video is False
        assert plan.copy_audio is False
        assert plan.video_bitrate_kbps == 4500
        assert plan.video_maxrate_kbps == 6000
        assert plan.video_bufsize_kbps == 9000
        assert plan.audio_bitrate_kbps == 192
        assert plan.keyframe_interval_seconds is not None
        assert plan.keyframe_interval_seconds > 0
        assert plan.keyframe_interval_seconds <= 4
        assert plan.keyframe_gop_frames is not None
        assert plan.keyframe_gop_frames >= 1
        assert plan.multi_destination is True
        assert plan.tee_onfail_policy == "ignore"
        assert plan.destination_uris == [
            "rtmp://a.youtube.com/live/primary",
            "rtmp://b.youtube.com/live/backup",
        ]

    def test_build_command_keeps_copy_mode_for_multi_destination_when_compatible(
        self, tmp_path
    ):
        """Compatible assets should stay in copy mode even when tee muxer fans out to multiple outputs."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        video_playlist = tmp_path / "video.txt"
        audio_playlist = tmp_path / "audio.txt"
        video_playlist.write_text("ffconcat version 1.0\n")
        audio_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=audio_playlist,
            mix_mode="mixed",
            video_loop=True,
            audio_loop=True,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=True,
            audio_copy_compatible=True,
            video_assets=[],
            audio_assets=[],
        )

        destinations = [
            {"url": "rtmp://a.youtube.com/live", "key": "primary"},
            {"url": "rtmp://b.youtube.com/live", "key": "backup"},
        ]

        plan = manager._build_command(playlists, destinations)
        cmd = plan.command

        assert plan.copy_video is True
        assert plan.copy_audio is True
        assert plan.multi_destination is True
        assert "-c:v" in cmd and cmd[cmd.index("-c:v") + 1] == "copy"
        assert "-c:a" in cmd and cmd[cmd.index("-c:a") + 1] == "copy"
        assert "-f" in cmd and "tee" in cmd
        assert any(
            "onfail=ignore" in part for part in cmd if part.startswith("[select")
        )
        assert "-b:v" not in cmd
        assert "-b:a" not in cmd
        assert plan.video_bitrate_kbps is None
        assert plan.audio_bitrate_kbps is None
        assert plan.tee_onfail_policy == "ignore"

    def test_build_command_allows_overriding_tee_failure_policy(
        self, tmp_path, monkeypatch
    ):
        """Operators can switch tee behavior back to abort when they prefer fail-fast handling."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        video_playlist = tmp_path / "video.txt"
        audio_playlist = tmp_path / "audio.txt"
        video_playlist.write_text("ffconcat version 1.0\n")
        audio_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=audio_playlist,
            mix_mode="mixed",
            video_loop=True,
            audio_loop=True,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=True,
            audio_copy_compatible=True,
            video_assets=[],
            audio_assets=[],
        )

        monkeypatch.setattr(settings, "ffmpeg_tee_onfail_policy", "abort")
        plan = manager._build_command(
            playlists,
            [
                {"url": "rtmp://a.youtube.com/live", "key": "primary"},
                {"url": "rtmp://b.youtube.com/live", "key": "backup"},
            ],
        )

        assert any(
            "onfail=abort" in part
            for part in plan.command
            if part.startswith("[select")
        )
        assert plan.tee_onfail_policy == "abort"

    def test_init_defers_missing_configured_ffmpeg_path(self, monkeypatch):
        """Implicit env/config paths should not crash manager initialization."""
        monkeypatch.setattr(settings, "ffmpeg_bin", "/nonexistent/custom/ffmpeg")
        monkeypatch.setattr(
            "app.streaming.ffmpeg_manager.shutil.which", lambda _value: None
        )

        manager = FFmpegStreamManager()

        assert manager.ffmpeg_bin == "ffmpeg"

    def test_build_command_audio_only_injects_video_placeholder(
        self, tmp_path, monkeypatch
    ):
        """Audio-only streams should generate a color input for video while reusing audio playlist."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        audio_playlist = tmp_path / "audio.txt"
        audio_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=None,
            audio_playlist=audio_playlist,
            mix_mode="audio_only",
            video_loop=False,
            audio_loop=True,
            needs_video_placeholder=True,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=True,
            video_assets=[],
            audio_assets=[],
        )

        monkeypatch.setattr(settings, "placeholder_video_resolution", "640x360")
        plan = manager._build_command(
            playlists,
            [{"url": "rtmp://youtube.com/live", "key": "primary"}],
        )

        assert plan.copy_video is False
        assert plan.copy_audio is True
        assert plan.uses_video_placeholder is True
        assert plan.uses_audio_placeholder is False
        assert "-c:a" in plan.command
        audio_codec_idx = plan.command.index("-c:a")
        assert plan.command[audio_codec_idx + 1] == "copy"
        assert any("color=" in arg for arg in plan.command if isinstance(arg, str))

    def test_build_command_mixed_requires_audio_playlist(self, tmp_path):
        """Mixed mode cannot start without an audio playlist provided."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")
        video_playlist = tmp_path / "video.txt"
        video_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=None,
            mix_mode="mixed",
            video_loop=True,
            audio_loop=False,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=True,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        with pytest.raises(ValueError):
            manager._build_command(
                playlists,
                [{"url": "rtmp://youtube.com/live", "key": "primary"}],
            )

    def test_video_only_reuses_audio_from_video_playlist(self, tmp_path):
        """Video-only streams with embedded audio should not inject silent placeholders."""
        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        video_playlist = tmp_path / "video.txt"
        video_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=None,
            mix_mode="video_only",
            video_loop=True,
            audio_loop=False,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=True,
            audio_copy_compatible=False,
            video_assets=[
                {"path": str(video_playlist), "meta": {"audio": {"codec": "aac"}}}
            ],
            audio_assets=[],
            video_has_audio=True,
            video_audio_copy_compatible=True,
        )

        plan = manager._build_command(
            playlists,
            [{"url": "rtmp://youtube.com/live", "key": "primary"}],
        )

        command = " ".join(plan.command)
        assert "anullsrc" not in command
        # Audio should be copied from the video input
        assert plan.copy_audio is True

    @pytest.mark.asyncio
    async def test_handle_stream_failure_marks_stream_error(self, monkeypatch):
        """Final FFmpeg failure should persist error state for UUID streams."""
        manager = FFmpegStreamManager()
        stream_id = "22222222-2222-2222-2222-222222222222"

        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "cccccccc-cccc-cccc-cccc-cccccccccccc"},
            "restart_attempts": 0,
            "recent_errors": deque(["fatal"], maxlen=20),
        }
        manager.active_streams[stream_id] = AsyncMock()

        monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 0)
        manager._create_restart_warning_alert = AsyncMock()
        manager.start_stream = AsyncMock()

        marker = AsyncMock()
        monkeypatch.setattr(manager, "_mark_stream_failed", marker)

        await manager._handle_stream_failure(stream_id, returncode=234)

        marker.assert_awaited_once()


@pytest.mark.asyncio
async def test_handle_stream_failure_writes_one_terminal_critical_alert(monkeypatch):
    async with async_session_maker() as session:
        user_id = uuid4()
        stream_id = uuid4()
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"owner-{uuid4()}@example.com",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        session.add(
            Stream(
                id=stream_id,
                user_id=user_id,
                name="terminal",
                status="running",
                started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            )
        )
        await session.commit()

        await session.execute(
            text(
                """
                CREATE OR REPLACE FUNCTION alert_on_stream_error()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF NEW.status = 'error' AND (OLD.status IS NULL OR OLD.status <> 'error') THEN
                        INSERT INTO system_alerts (
                            id, alert_type, severity, user_id, stream_id, message, details
                        ) VALUES (
                            uuid_generate_v4(),
                            'stream_failure',
                            'critical',
                            NEW.user_id,
                            NEW.id,
                            COALESCE(NEW.error_message, 'Stream failed with unknown error'),
                            jsonb_build_object(
                                'stream_name', NEW.name,
                                'stream_id', NEW.id,
                                'error_message', NEW.error_message,
                                'pid', NEW.pid
                            )
                        );
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                """
            )
        )
        await session.execute(
            text("DROP TRIGGER IF EXISTS trigger_alert_on_stream_error ON streams")
        )
        await session.execute(
            text(
                """
                CREATE TRIGGER trigger_alert_on_stream_error
                    AFTER UPDATE OF status ON streams
                    FOR EACH ROW
                    EXECUTE FUNCTION alert_on_stream_error();
                """
            )
        )
        await session.commit()

    manager = FFmpegStreamManager()
    stream_id_str = str(stream_id)
    manager.stream_info[stream_id_str] = {
        "metadata": {"user_id": str(user_id)},
        "restart_attempts": 0,
        "recent_errors": deque(
            [
                "Connection reset by peer",
                "The specified session has been invalidated for some reason.",
                "Conversion failed!",
            ],
            maxlen=20,
        ),
    }
    manager.active_streams[stream_id_str] = AsyncMock()

    monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 0)
    monkeypatch.setattr(
        "app.streaming.ffmpeg_manager.hot_swap_manager.unregister_stream",
        AsyncMock(),
    )

    try:
        await manager._handle_stream_failure(stream_id_str, returncode=152)

        async with async_session_maker() as session:
            alerts = (
                (
                    await session.execute(
                        select(SystemAlert).where(SystemAlert.stream_id == stream_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(alerts) == 1
            assert alerts[0].severity == "critical"
            assert "Remote output disconnect evidence detected" in alerts[0].message
    finally:
        async with async_session_maker() as session:
            await session.execute(
                text("DROP TRIGGER IF EXISTS trigger_alert_on_stream_error ON streams")
            )
            await session.execute(
                text("DROP FUNCTION IF EXISTS alert_on_stream_error()")
            )
            await session.commit()


class TestFFmpegStreamManagerMonitor:
    @pytest.mark.asyncio
    async def test_monitor_process_manual_stop_skips_failure(self, monkeypatch):
        """Manual stop should not trigger failure handling or auto-restart."""
        manager = FFmpegStreamManager()
        stream_id = "manual-stop-stream"

        process = AsyncMock()
        process.wait = AsyncMock(return_value=-9)

        manager.active_streams[stream_id] = process
        manager.stream_info[stream_id] = {
            "manual_stop": True,
            "recent_errors": deque(maxlen=20),
        }

        handler = AsyncMock()
        monkeypatch.setattr(manager, "_handle_stream_failure", handler)

        await manager._monitor_process(stream_id, process, None)

        handler.assert_not_called()
        assert stream_id not in manager.active_streams
        assert stream_id not in manager.stream_info

    @pytest.mark.asyncio
    async def test_start_stream_records_plan_telemetry(self, tmp_path, monkeypatch):
        """Ensure start_stream stores FFmpeg plan telemetry alongside process info."""

        manager = FFmpegStreamManager(ffmpeg_bin="ffmpeg")

        video_playlist = tmp_path / "video.txt"
        video_playlist.write_text("ffconcat version 1.0\n")
        audio_playlist = tmp_path / "audio.txt"
        audio_playlist.write_text("ffconcat version 1.0\n")

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=video_playlist,
            audio_playlist=audio_playlist,
            mix_mode="mixed",
            video_loop=True,
            audio_loop=True,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        destinations = [{"url": "rtmp://youtube.com/live", "key": "stream"}]

        fake_process = AsyncMock()
        fake_process.pid = 4321
        fake_process.stdout = AsyncMock()
        fake_process.stderr = AsyncMock()
        captured_cmd = []
        monkeypatch.setattr(settings, "ffmpeg_output_recovery_max_attempts", 9)

        # _monitor_process is scheduled asynchronously – replace with noop to avoid background execution
        monitor_stub = AsyncMock()
        monkeypatch.setattr(manager, "_monitor_process", monitor_stub)

        async def fake_exec(*args, **kwargs):
            captured_cmd[:] = list(args)
            return fake_process

        monkeypatch.setattr(
            "app.streaming.ffmpeg_manager.asyncio.create_subprocess_exec",
            fake_exec,
        )

        scheduled = []

        def fake_create_task(coro):
            scheduled.append(coro)
            return AsyncMock()

        monkeypatch.setattr(
            "app.streaming.ffmpeg_manager.asyncio.create_task", fake_create_task
        )

        started = await manager.start_stream(
            stream_id="99999999-9999-9999-9999-999999999999",
            playlists=playlists,
            destinations=destinations,
            log_file=None,
            metadata={"user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
        )

        assert started is True
        info = manager.get_stream_info("99999999-9999-9999-9999-999999999999")
        assert info is not None
        plan = info.get("ffmpeg_plan")
        assert plan is not None
        assert plan["copy_video"] is False
        assert plan["copy_audio"] is False
        assert plan["destination_uris"] == ["rtmp://youtube.com/live/<redacted>"]
        assert plan["multi_destination"] is False
        assert plan["tee_onfail_policy"] is None
        assert plan["uses_video_placeholder"] is False
        assert plan["uses_audio_placeholder"] is False
        assert "fifo" in captured_cmd
        assert "-fifo_format" in captured_cmd and captured_cmd[captured_cmd.index("-fifo_format") + 1] == "flv"
        assert "-attempt_recovery" in captured_cmd and captured_cmd[captured_cmd.index("-attempt_recovery") + 1] == "1"
        assert "-recover_any_error" in captured_cmd and captured_cmd[captured_cmd.index("-recover_any_error") + 1] == "1"
        assert "-restart_with_keyframe" in captured_cmd and captured_cmd[captured_cmd.index("-restart_with_keyframe") + 1] == "1"
        assert "-max_recovery_attempts" in captured_cmd and captured_cmd[captured_cmd.index("-max_recovery_attempts") + 1] == "9"

        # ensure telemetry persisted even after retrieving info
        assert (
            manager.stream_info["99999999-9999-9999-9999-999999999999"]["ffmpeg_plan"][
                "copy_video"
            ]
            is False
        )

    @pytest.mark.asyncio
    async def test_restart_stream_stops_then_starts_with_hot_swap(
        self, tmp_path, monkeypatch
    ):
        """restart_stream should reuse metadata, stop existing process, and call start_stream with restart flag."""

        manager = FFmpegStreamManager()
        stream_id = "88888888-8888-8888-8888-888888888888"

        process = AsyncMock()
        process.pid = 123
        manager.active_streams[stream_id] = process
        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "dddddddd-dddd-dddd-dddd-dddddddddddd"},
            "destinations": [{"url": "rtmp://a.youtube.com/live", "key": "one"}],
            "log_file": str(tmp_path / "log.txt"),
        }

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=None,
            audio_playlist=None,
            mix_mode="audio_only",
            video_loop=False,
            audio_loop=True,
            needs_video_placeholder=True,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        stop_mock = AsyncMock(return_value=True)
        monkeypatch.setattr(manager, "stop_stream", stop_mock)

        start_mock = AsyncMock(return_value=True)
        monkeypatch.setattr(manager, "start_stream", start_mock)

        await manager.restart_stream(stream_id, playlists, metadata={"reason": "hot"})

        stop_mock.assert_awaited_once_with(stream_id)
        start_mock.assert_awaited_once()
        start_kwargs = start_mock.call_args.kwargs
        assert start_kwargs["restart"] is True
        assert start_kwargs["metadata"]["hot_swap"] is True
        assert start_kwargs["metadata"]["reason"] == "hot"
        assert (
            start_kwargs["metadata"]["user_id"]
            == "dddddddd-dddd-dddd-dddd-dddddddddddd"
        )
        assert start_kwargs["destinations"] == [
            {"url": "rtmp://a.youtube.com/live", "key": "one"}
        ]

    @pytest.mark.asyncio
    async def test_restart_stream_raises_without_destinations(self, tmp_path):
        manager = FFmpegStreamManager()
        stream_id = "77777777-7777-7777-7777-777777777777"

        playlists = PlaylistFileSet(
            stream_dir=tmp_path,
            video_playlist=None,
            audio_playlist=None,
            mix_mode="audio_only",
            video_loop=False,
            audio_loop=True,
            needs_video_placeholder=True,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

        with pytest.raises(ValueError):
            await manager.restart_stream(stream_id, playlists)


@pytest.mark.asyncio
async def test_write_logs_persists_degraded_remote_reset_alert_once(tmp_path):
    user_id = uuid4()
    stream_id = uuid4()
    log_file = tmp_path / "remote-reset.log"

    await _create_owned_stream_record(
        user_id=user_id,
        stream_id=stream_id,
        log_file=log_file,
        name="remote reset stream",
        email_prefix="reset",
    )

    manager = FFmpegStreamManager()
    manager.stream_info[str(stream_id)] = {
        "metadata": {"user_id": str(user_id)},
        "log_file": str(log_file),
        "recent_errors": deque(maxlen=20),
        "runtime_signal_state": {},
    }

    process = _FakeProcess(
        [
            "Connection reset by peer",
            "Error writing trailer",
            "Broken pipe",
            "Connection reset by peer",
        ]
    )

    await manager._write_logs_to_file(str(stream_id), process, log_file)

    async with async_session_maker() as session:
        alerts = (
            (
                await session.execute(
                    select(SystemAlert)
                    .where(SystemAlert.stream_id == stream_id)
                    .order_by(SystemAlert.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        events = (
            (
                await session.execute(
                    select(StreamEvent)
                    .where(StreamEvent.stream_id == stream_id)
                    .order_by(StreamEvent.created_at.asc())
                )
            )
            .scalars()
            .all()
        )

    assert len(alerts) == 1
    assert len(events) == 1
    assert alerts[0].alert_type == "ffmpeg_error"
    assert alerts[0].details["signal"] == "remote_output_reset"
    assert alerts[0].details["status"] == "degraded_running"
    assert alerts[0].details["occurrence_count"] >= 3
    assert events[0].event_metadata["signal"] == "remote_output_reset"
    assert events[0].event_metadata["threshold"] == 3


@pytest.mark.asyncio
async def test_write_logs_persists_recovery_storm_alert(tmp_path):
    user_id = uuid4()
    stream_id = uuid4()
    log_file = tmp_path / "recovery-storm.log"

    await _create_owned_stream_record(
        user_id=user_id,
        stream_id=stream_id,
        log_file=log_file,
        name="recovery storm stream",
        email_prefix="storm",
    )

    manager = FFmpegStreamManager()
    manager.stream_info[str(stream_id)] = {
        "metadata": {"user_id": str(user_id)},
        "log_file": str(log_file),
        "recent_errors": deque(maxlen=20),
        "runtime_signal_state": {},
    }

    process = _FakeProcess(
        [
            "Connection reset by peer",
            "Recovery successful",
            "Broken pipe",
            "Recovery successful",
            "Error writing trailer",
            "Recovery successful",
        ]
    )

    await manager._write_logs_to_file(str(stream_id), process, log_file)

    async with async_session_maker() as session:
        alerts = (
            (
                await session.execute(
                    select(SystemAlert)
                    .where(SystemAlert.stream_id == stream_id)
                    .order_by(SystemAlert.created_at.asc())
                )
            )
            .scalars()
            .all()
        )

    signals = [alert.details["signal"] for alert in alerts]
    assert all(alert.alert_type == "ffmpeg_error" for alert in alerts)
    assert "remote_output_reset" in signals
    assert "recovery_storm" in signals

    storm_alert = next(alert for alert in alerts if alert.details["signal"] == "recovery_storm")
    assert storm_alert.details["remote_output_reset_count"] >= 3
    assert storm_alert.details["recovery_success_count"] >= 3


@pytest.mark.asyncio
async def test_write_logs_persists_non_monotonic_dts_alert(tmp_path):
    user_id = uuid4()
    stream_id = uuid4()
    log_file = tmp_path / "non-monotonic.log"

    await _create_owned_stream_record(
        user_id=user_id,
        stream_id=stream_id,
        log_file=log_file,
        name="dts stream",
        email_prefix="dts",
    )

    manager = FFmpegStreamManager()
    manager.stream_info[str(stream_id)] = {
        "metadata": {"user_id": str(user_id)},
        "log_file": str(log_file),
        "recent_errors": deque(maxlen=20),
        "runtime_signal_state": {},
    }

    process = _FakeProcess(
        [
            "Non-monotonic DTS; previous: 1000, current: 999; changing to 1001.",
            "Non-monotonic DTS; previous: 1001, current: 1000; changing to 1002.",
            "Non-monotonic DTS; previous: 1002, current: 1001; changing to 1003.",
            "Non-monotonic DTS; previous: 1003, current: 1002; changing to 1004.",
            "Non-monotonic DTS; previous: 1004, current: 1003; changing to 1005.",
        ]
    )

    await manager._write_logs_to_file(str(stream_id), process, log_file)

    async with async_session_maker() as session:
        alert = (
            (
                await session.execute(
                    select(SystemAlert).where(
                        SystemAlert.stream_id == stream_id,
                        SystemAlert.alert_type == "ffmpeg_error",
                    )
                )
            )
            .scalars()
            .one()
        )
        event = (
            (
                await session.execute(
                    select(StreamEvent).where(StreamEvent.stream_id == stream_id)
                )
            )
            .scalars()
            .one()
        )

    assert alert.details["signal"] == "non_monotonic_dts"
    assert alert.alert_type == "ffmpeg_error"
    assert alert.details["occurrence_count"] == 5
    assert event.event_metadata["signal"] == "non_monotonic_dts"
