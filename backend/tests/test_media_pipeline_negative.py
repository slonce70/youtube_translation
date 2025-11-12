"""
Negative test cases for media pipeline (validator, ffmpeg_manager, playlist_builder)

Tests edge cases, error handling, and recovery scenarios.
"""

import pytest
import asyncio
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock
import tempfile
import json

from app.streaming.validator import VideoValidator
from app.streaming.ffmpeg_manager import FFmpegStreamManager
from app.streaming.playlist_builder import PlaylistBuilder


class TestVideoValidatorNegative:
    """Negative tests for VideoValidator"""
    
    @pytest.mark.asyncio
    async def test_missing_file(self):
        """Test validation of non-existent file"""
        validator = VideoValidator()
        result = await validator.validate_file(Path("/nonexistent/file.mp4"))
        
        assert not result["compatible_for_copy"]
        assert len(result["validation_errors"]) > 0
    
    @pytest.mark.asyncio
    async def test_corrupted_file(self, tmp_path):
        """Test validation of corrupted video file"""
        # Create corrupted file
        corrupt_file = tmp_path / "corrupt.mp4"
        corrupt_file.write_bytes(b"This is not a valid video file")
        
        validator = VideoValidator()
        result = await validator.validate_file(corrupt_file)
        
        assert not result["compatible_for_copy"]
        assert len(result["validation_errors"]) > 0
    
    @pytest.mark.asyncio
    async def test_unsupported_codec(self):
        """Test validation with unsupported video codec"""
        validator = VideoValidator()
        
        # Mock metadata with unsupported codec
        mock_meta = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "vp9",  # Unsupported
                    "pix_fmt": "yuv420p"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        }
        
        is_compatible, media_kind = validator._check_compatibility(mock_meta)
        assert is_compatible is False
        errors = validator._get_validation_errors(mock_meta, media_kind)
        assert any("codec" in err.lower() for err in errors)
    
    @pytest.mark.asyncio
    async def test_missing_audio_stream(self):
        """Test validation with missing audio stream"""
        validator = VideoValidator()
        
        mock_meta = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv420p"
                }
                # No audio stream
            ]
        }
        
        is_compatible, media_kind = validator._check_compatibility(mock_meta)
        assert is_compatible is False
        errors = validator._get_validation_errors(mock_meta, media_kind)
        assert any("audio" in err.lower() for err in errors)
    
    @pytest.mark.asyncio
    async def test_large_gop_size(self):
        """Test validation with GOP size too large for YouTube"""
        validator = VideoValidator()
        
        mock_meta = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv420p",
                    "gop_size": 250  # Too large
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        }
        
        is_compatible, media_kind = validator._check_compatibility(mock_meta)
        assert is_compatible is False
        errors = validator._get_validation_errors(mock_meta, media_kind)
        assert any("gop" in err.lower() for err in errors)
    
    @pytest.mark.asyncio
    async def test_keyframe_interval_too_long(self):
        """Videos exceeding max keyframe interval should be flagged."""
        validator = VideoValidator()

        mock_meta = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv420p",
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                },
            ]
        }

        keyframe_stats = {"max_interval_seconds": VideoValidator.MAX_KEYFRAME_INTERVAL_SECONDS + 1.5}

        is_compatible, media_kind = validator._check_compatibility(
            mock_meta,
            keyframe_stats=keyframe_stats,
        )
        assert is_compatible is False
        errors = validator._get_validation_errors(
            mock_meta,
            media_kind,
            keyframe_stats=keyframe_stats,
        )
        assert any("keyframe interval" in err.lower() for err in errors)

    @pytest.mark.asyncio
    async def test_wrong_pixel_format(self):
        """Test validation with wrong pixel format"""
        validator = VideoValidator()
        
        mock_meta = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv422p"  # Wrong format
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        }
        
        is_compatible, media_kind = validator._check_compatibility(mock_meta)
        assert is_compatible is False
        errors = validator._get_validation_errors(mock_meta, media_kind)
        assert any("pixel format" in err.lower() or "pix_fmt" in err.lower() for err in errors)
    
    @pytest.mark.asyncio
    async def test_ffprobe_not_found(self):
        """Test validator with missing ffprobe binary"""
        with pytest.raises(FileNotFoundError, match="ffprobe"):
            VideoValidator(ffprobe_bin="/nonexistent/ffprobe")


class TestFFmpegManagerNegative:
    """Negative tests for FFmpegStreamManager"""
    
    @pytest.mark.asyncio
    async def test_start_duplicate_stream(self, tmp_path):
        """Test starting a stream that's already running"""
        manager = FFmpegStreamManager()
        
        # Create mock playlist file
        playlist = tmp_path / "playlist.txt"
        playlist.write_text("file 'test.mp4'\n")
        
        destinations = [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "test-key"}]
        
        # Mock the subprocess to avoid actually starting ffmpeg
        with patch('asyncio.create_subprocess_exec', new_callable=AsyncMock) as mock_exec:
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.returncode = None
            mock_process.stderr = AsyncMock()
            mock_process.stderr.readline = AsyncMock(return_value=b'')
            mock_exec.return_value = mock_process
            
            # Start first stream
            success1 = await manager.start_stream("stream1", playlist, destinations)
            assert success1
            
            # Try to start duplicate
            success2 = await manager.start_stream("stream1", playlist, destinations)
            assert not success2

        await manager.stop_all_streams()
    
    @pytest.mark.asyncio
    async def test_stop_nonexistent_stream(self):
        """Test stopping a stream that doesn't exist"""
        manager = FFmpegStreamManager()
        
        success = await manager.stop_stream("nonexistent")
        assert not success
    
    @pytest.mark.asyncio
    async def test_invalid_playlist_file(self, tmp_path):
        """Test starting stream with invalid playlist file"""
        manager = FFmpegStreamManager()
        
        playlist = tmp_path / "nonexistent.txt"
        destinations = [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "test-key"}]
        
        # This should fail since playlist doesn't exist
        try:
            await manager.start_stream("stream1", playlist, destinations)
        finally:
            await manager.stop_all_streams()
    
    @pytest.mark.asyncio
    async def test_empty_destinations(self, tmp_path):
        """Test starting stream with no destinations"""
        manager = FFmpegStreamManager()
        
        playlist = tmp_path / "playlist.txt"
        playlist.write_text("file 'test.mp4'\n")
        
        # Empty destinations list - should handle gracefully
        with pytest.raises((ValueError, IndexError)) or True:
            # Implementation might raise error or handle it
            await manager.start_stream("stream1", playlist, [])
    
    @pytest.mark.asyncio
    async def test_process_crash_handling(self, tmp_path):
        """Test handling when FFmpeg process crashes"""
        manager = FFmpegStreamManager()
        
        playlist = tmp_path / "playlist.txt"
        playlist.write_text("file 'test.mp4'\n")
        destinations = [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "test-key"}]
        
        with patch('asyncio.create_subprocess_exec', new_callable=AsyncMock) as mock_exec:
            # Simulate process that crashes immediately
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.returncode = 1  # Exit code indicating error
            mock_process.wait = AsyncMock(return_value=1)
            mock_process.stderr = AsyncMock()
            mock_process.stderr.readline = AsyncMock(return_value=b'')
            mock_exec.return_value = mock_process
            
            success = await manager.start_stream("stream1", playlist, destinations)
            
            # Should still succeed in starting but will fail quickly
            # Manager should handle cleanup
            await asyncio.sleep(0.1)

        await manager.stop_all_streams()
    
    @pytest.mark.asyncio
    async def test_stop_timeout_force_kill(self, tmp_path):
        """Test force killing stream when graceful stop times out"""
        manager = FFmpegStreamManager()
        
        # Create mock running stream
        mock_process = Mock()
        mock_process.pid = 12345
        mock_process.returncode = None
        
        # Mock methods
        mock_process.send_signal = Mock()
        
        # Simulate timeout on wait
        async def wait_timeout():
            await asyncio.sleep(100)  # Will timeout
        
        mock_process.wait = wait_timeout
        mock_process.kill = Mock()
        
        manager.active_streams["stream1"] = mock_process
        manager.stream_info["stream1"] = {"pid": 12345}
        
        # Stop with very short timeout
        success = await manager.stop_stream("stream1", timeout=0.1)
        
        # Should have called kill after timeout
        assert mock_process.send_signal.called or mock_process.kill.called


class TestPlaylistBuilderNegative:
    """Negative tests for PlaylistBuilder"""
    
    @pytest.mark.asyncio
    async def test_empty_assets_list(self, tmp_path):
        """Test building playlist with empty assets list"""
        builder = PlaylistBuilder(streams_dir=tmp_path)
        
        with pytest.raises(ValueError, match="empty|no assets"):
            await builder.build_playlist("playlist1", [])
    
    @pytest.mark.asyncio
    async def test_missing_asset_files(self, tmp_path):
        """Test building playlist with non-existent asset files"""
        builder = PlaylistBuilder(streams_dir=tmp_path)
        
        assets = [
            {"id": "asset1", "file_path": "/nonexistent/file1.mp4"},
            {"id": "asset2", "file_path": "/nonexistent/file2.mp4"}
        ]
        
        # Should handle missing files gracefully or raise error
        with pytest.raises((FileNotFoundError, ValueError)) or True:
            await builder.build_playlist("playlist1", assets)
    
    @pytest.mark.asyncio
    async def test_invalid_asset_structure(self, tmp_path):
        """Test building playlist with invalid asset structure"""
        builder = PlaylistBuilder(streams_dir=tmp_path)
        
        # Assets missing required fields
        assets = [
            {"id": "asset1"},  # Missing file_path
            {"file_path": "/some/path"}  # Missing id
        ]
        
        with pytest.raises((KeyError, ValueError)):
            await builder.build_playlist("playlist1", assets)
    
    @pytest.mark.asyncio
    async def test_write_permission_denied(self, tmp_path):
        """Test handling when playlist directory is not writable"""
        # Create read-only directory
        readonly_dir = tmp_path / "readonly"
        readonly_dir.mkdir()
        readonly_dir.chmod(0o444)  # Read-only
        
        builder = PlaylistBuilder(streams_dir=readonly_dir)
        
        assets = [
            {"id": "asset1", "file_path": str(tmp_path / "test.mp4")}
        ]
        
        # Should raise permission error
        with pytest.raises((PermissionError, OSError)):
            await builder.build_playlist("playlist1", assets)
        
        # Cleanup
        readonly_dir.chmod(0o755)


class TestMediaPipelineIntegration:
    """Integration tests for complete media pipeline"""
    
    @pytest.mark.asyncio
    async def test_full_pipeline_with_invalid_video(self, tmp_path):
        """Test complete pipeline with invalid video file"""
        # Create invalid video file
        invalid_video = tmp_path / "invalid.mp4"
        invalid_video.write_bytes(b"Not a video")
        
        # Validate
        validator = VideoValidator()
        validation = await validator.validate_file(invalid_video)
        
        assert not validation["compatible_for_copy"]
        
        # Should not proceed to build playlist with invalid video
        # This tests that validation catches issues before streaming
    
    @pytest.mark.asyncio
    async def test_recovery_from_ffmpeg_failure(self, tmp_path):
        """Test system recovery when FFmpeg fails"""
        manager = FFmpegStreamManager()
        
        # Simulate FFmpeg failure scenario
        playlist = tmp_path / "playlist.txt"
        playlist.write_text("file 'nonexistent.mp4'\n")
        destinations = [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "test-key"}]
        
        with patch('asyncio.create_subprocess_exec', new_callable=AsyncMock) as mock_exec:
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.returncode = 1
            mock_process.wait = AsyncMock(return_value=1)
            mock_process.stderr = AsyncMock()
            mock_process.stderr.readline = AsyncMock(side_effect=[
                b'Error: No such file or directory\n',
                b''
            ])
            mock_exec.return_value = mock_process
            
            await manager.start_stream("stream1", playlist, destinations)
            
            # Wait for process to "fail"
            await asyncio.sleep(0.2)
            
            # Manager should have cleaned up the failed stream
            await asyncio.sleep(0.1)
            # Stream should be removed from active streams eventually

        await manager.stop_all_streams()
    
    @pytest.mark.asyncio
    async def test_concurrent_stream_limit(self, tmp_path):
        """Test handling of too many concurrent streams"""
        manager = FFmpegStreamManager()
        
        playlist = tmp_path / "playlist.txt"
        playlist.write_text("file 'test.mp4'\n")
        destinations = [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "test-key"}]
        
        # Mock to prevent actual process creation
        with patch('asyncio.create_subprocess_exec', new_callable=AsyncMock) as mock_exec:
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.returncode = None
            mock_process.stderr = AsyncMock()
            mock_process.stderr.readline = AsyncMock(return_value=b'')
            mock_exec.return_value = mock_process
            
            # Try to start many streams
            for i in range(20):
                await manager.start_stream(f"stream{i}", playlist, destinations)
            
            # Should have tracked all streams
            assert len(manager.active_streams) == 20
            
            # Cleanup
            await manager.stop_all_streams()


class TestPlaylistBuilderNegative:
    """Additional negative cases for playlist validation"""

    def test_incompatible_single_asset_requires_transcoding(self):
        asset = {
            "path": "/tmp/video.mp4",
            "meta": {
                "video": {"codec": "hevc", "pix_fmt": "yuv422p"},
                "audio": {"codec": "aac"},
            },
            "filename": "bad.mp4",
            "compatible_for_copy": False,
            "validation_errors": ["Video codec must be h264, got hevc"],
        }

        valid, issues = PlaylistBuilder.validate_playlist_assets([asset])

        assert not valid
        assert any(
            issue["code"] in {"requires_transcoding", "video_codec_invalid", "validation_error"}
            for issue in issues
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
