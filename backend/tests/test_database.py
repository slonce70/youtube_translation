"""
Tests for database module (session handling, transactions).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from sqlalchemy.ext.asyncio import AsyncSession


class TestDatabaseSessionHandling:
    """Test database session and transaction handling"""
    
    @pytest.mark.asyncio
    async def test_database_session_lifecycle(self):
        """Test basic database session lifecycle"""
        from app.core.database import get_db
        
        # This is a simple integration-style test
        # In real scenario, we'd use a test database
        # For now, just verify the generator works
        gen = get_db()
        
        # The generator should be async
        assert hasattr(gen, '__anext__')
        assert hasattr(gen, 'aclose')
    
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
