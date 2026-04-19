"""
Tests for database module (session handling, transactions).
"""
import pytest
from unittest.mock import AsyncMock


class TestDatabaseSessionHandling:
    """Test database session and transaction handling"""

    @pytest.mark.asyncio
    async def test_get_db_does_not_commit_on_clean_exit(self, monkeypatch):
        from app.core import database

        events = []
        session = AsyncMock()
        session.commit = AsyncMock(side_effect=lambda: events.append("commit"))
        session.rollback = AsyncMock(side_effect=lambda: events.append("rollback"))
        session.close = AsyncMock(side_effect=lambda: events.append("close"))

        class _FakeSessionContext:
            async def __aenter__(self):
                events.append("session_factory_enter")
                return session

            async def __aexit__(self, exc_type, exc, tb):
                events.append("session_factory_exit")
                return False

        monkeypatch.setattr(
            database, "async_session_maker", lambda: _FakeSessionContext()
        )

        generator = database.get_db()
        yielded_session = await generator.__anext__()
        events.append("body")
        assert yielded_session is session

        await generator.aclose()

        assert events == [
            "session_factory_enter",
            "body",
            "close",
            "session_factory_exit",
        ]
        session.commit.assert_not_awaited()
        session.rollback.assert_not_awaited()
        session.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_encryption_works_end_to_end(self):
        """End-to-end test to verify encryption setup is correct"""
        from app.core.security import StreamKeyEncryption
        from app.core.config import settings
        
        # Verify we can create encryption instance with settings
        enc = StreamKeyEncryption(settings.encryption_key)
        
        # Test encryption roundtrip
        test_key = "test-stream-key-12345"
        encrypted = enc.encrypt(test_key)
        decrypted = enc.decrypt(encrypted)
        
        assert decrypted == test_key
        assert encrypted != test_key
    
    @pytest.mark.asyncio
    async def test_ffmpeg_manager_initialization(self):
        """Test FFmpeg manager initializes correctly"""
        from app.streaming.ffmpeg_manager import FFmpegStreamManager
        
        manager = FFmpegStreamManager()
        
        # Verify initial state
        assert len(manager.active_streams) == 0
        assert len(manager.stream_info) == 0
        assert hasattr(manager, '_cleanup_lock')
        
        # Verify methods exist
        assert hasattr(manager, 'start_stream')
        assert hasattr(manager, 'stop_stream')
        assert hasattr(manager, 'cleanup_dead_streams')
