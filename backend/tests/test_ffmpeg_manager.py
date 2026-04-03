"""
Tests for FFmpeg stream manager (process management, cleanup).
"""

from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.streaming.ffmpeg_manager import FFmpegStreamManager
from app.streaming.playlist_builder import PlaylistFileSet


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

    def test_is_running_returns_false_for_nonexistent_stream(self):
        """Test is_running returns False for streams that don't exist"""
        manager = FFmpegStreamManager()

        assert manager.is_running("nonexistent-stream") is False

    def test_get_stream_info_returns_none_for_nonexistent_stream(self):
        """Test get_stream_info returns None for streams that don't exist"""
        manager = FFmpegStreamManager()

        info = manager.get_stream_info("nonexistent-stream")
        assert info is None

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

        manager._create_system_alert = AsyncMock()

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
        assert manager._create_system_alert.await_count >= 1

        # restart attempts incremented
        assert manager.stream_info[stream_id]["restart_attempts"] == 1

    @pytest.mark.asyncio
    async def test_handle_stream_failure_exhausts_restarts(self, monkeypatch):
        """When no restarts remain, stream info is cleaned up and alert escalated."""
        manager = FFmpegStreamManager()
        stream_id = "stream-no-restart"

        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"},
            "restart_attempts": settings.ffmpeg_auto_restart_attempts,
            "recent_errors": deque(["fatal"], maxlen=20),
        }
        manager.active_streams[stream_id] = AsyncMock()

        monkeypatch.setattr(settings, "ffmpeg_auto_restart_attempts", 0)
        manager._create_system_alert = AsyncMock()
        manager.start_stream = AsyncMock()

        await manager._handle_stream_failure(stream_id, returncode=1)

        # start_stream should not be invoked when restart attempts exhausted
        manager.start_stream.assert_not_called()
        # Alert recorded
        assert manager._create_system_alert.await_count == 1

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
        manager._create_system_alert = AsyncMock()
        manager.start_stream = AsyncMock()

        marker = AsyncMock()
        monkeypatch.setattr(manager, "_mark_stream_failed", marker)

        await manager._handle_stream_failure(stream_id, returncode=234)

        marker.assert_awaited_once()

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

        # _monitor_process is scheduled asynchronously – replace with noop to avoid background execution
        monitor_stub = AsyncMock()
        monkeypatch.setattr(manager, "_monitor_process", monitor_stub)

        async def fake_exec(*args, **kwargs):
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
