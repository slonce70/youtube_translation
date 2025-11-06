"""
Tests for FFmpeg stream manager (process management, cleanup).
"""
from collections import deque
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.streaming.ffmpeg_manager import FFmpegStreamManager


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

        manager.stream_info[stream_id] = {
            "metadata": {"user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
            "playlist_file": str(playlist_file),
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
            playlist_path,
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
        assert restart_invocation["metadata"]["user_id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

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
        # Cleanup executed
        assert stream_id not in manager.stream_info
        assert stream_id not in manager.active_streams

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
