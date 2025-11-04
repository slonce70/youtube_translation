"""
Tests for FFmpeg stream manager (process management, cleanup).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
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
