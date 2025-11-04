"""
Integration tests for Quota Enforcement

Tests that subscription tier limits are properly enforced across all resources.
"""

import os
import pytest

if os.environ.get("RUN_QUOTA_TESTS", "").lower() not in {"1", "true", "yes"}:
    pytest.skip("Skipping quota enforcement tests in shared database", allow_module_level=True)

from uuid import uuid4
from sqlalchemy import select

from app.models.database import (
    UserProfile, SubscriptionTierLimits,
    Asset, Playlist, Destination, Stream, SystemAlert
)
from app.core.quota import QuotaEnforcer, QuotaExceededError


@pytest.mark.asyncio
class TestQuotaEnforcement:
    """Test quota enforcement for different subscription tiers"""
    
    async def test_free_tier_storage_limit(self, db_session):
        """Test that FREE tier storage limit is enforced"""
        # Create FREE tier user
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active',
            current_storage_bytes=4 * 1024**3  # 4 GB used
        )
        db_session.add(profile)
        await db_session.commit()
        
        # Try to add 2 GB more (should fail, limit is 5 GB)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_storage_limit(additional_bytes=2 * 1024**3)
        
        assert exc_info.value.status_code == 402
        assert "storage" in str(exc_info.value.detail).lower()
        
    async def test_free_tier_concurrent_streams_limit(self, db_session):
        """Test that FREE tier concurrent streams limit is enforced"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 1 running stream (FREE tier limit is 1)
        stream = Stream(
            user_id=user_id,
            name="Test Stream",
            status='running'
        )
        db_session.add(stream)
        await db_session.commit()
        
        # Try to start another stream (should fail)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_concurrent_streams()
        
        assert exc_info.value.status_code == 402
        assert "concurrent streams" in str(exc_info.value.detail).lower()
        
        # Check that alert was created
        result = await db_session.execute(
            select(SystemAlert).where(
                SystemAlert.user_id == user_id,
                SystemAlert.alert_type == 'quota_exceeded'
            )
        )
        alert = result.scalar_one_or_none()
        assert alert is not None
        assert alert.severity == 'warning'
    
    async def test_free_tier_assets_limit(self, db_session):
        """Test that FREE tier assets limit is enforced"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 20 assets (FREE tier limit is 20)
        for i in range(20):
            asset = Asset(
                user_id=user_id,
                filename=f"video{i}.mp4",
                storage_path=f"/uploads/{user_id}/video{i}.mp4",
                size_bytes=1000000
            )
            db_session.add(asset)
        await db_session.commit()
        
        # Try to create 21st asset (should fail)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_assets_limit()
        
        assert exc_info.value.status_code == 402
        assert "assets" in str(exc_info.value.detail).lower()
    
    async def test_pro_tier_higher_limits(self, db_session):
        """Test that PRO tier has higher limits than FREE"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="pro@example.com",
            subscription_tier='pro',
            subscription_status='active',
            current_storage_bytes=40 * 1024**3  # 40 GB used
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 3 running streams (PRO limit is 5)
        for i in range(3):
            stream = Stream(
                user_id=user_id,
                name=f"Stream {i}",
                status='running'
            )
            db_session.add(stream)
        await db_session.commit()
        
        # Should be able to add more storage (limit is 50 GB)
        enforcer = QuotaEnforcer(db_session, user_id)
        can_upload = await enforcer.check_storage_limit(additional_bytes=5 * 1024**3)
        assert can_upload is True
        
        # Should be able to start more streams
        can_stream = await enforcer.check_concurrent_streams()
        assert can_stream is True
    
    async def test_enterprise_tier_unlimited(self, db_session):
        """Test that ENTERPRISE tier has no limits"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="enterprise@example.com",
            subscription_tier='enterprise',
            subscription_status='active',
            current_storage_bytes=500 * 1024**3  # 500 GB used
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 50 running streams
        for i in range(50):
            stream = Stream(
                user_id=user_id,
                name=f"Stream {i}",
                status='running'
            )
            db_session.add(stream)
        
        # Create 500 assets
        for i in range(500):
            asset = Asset(
                user_id=user_id,
                filename=f"video{i}.mp4",
                storage_path=f"/uploads/{user_id}/video{i}.mp4",
                size_bytes=1000000
            )
            db_session.add(asset)
        await db_session.commit()
        
        # Should still be able to do everything (unlimited)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        can_upload = await enforcer.check_storage_limit(additional_bytes=100 * 1024**3)
        assert can_upload is True
        
        can_stream = await enforcer.check_concurrent_streams()
        assert can_stream is True
        
        can_create_asset = await enforcer.check_assets_limit()
        assert can_create_asset is True
    
    async def test_suspended_user_blocked(self, db_session):
        """Test that suspended users cannot perform any actions"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="suspended@example.com",
            subscription_tier='pro',
            subscription_status='active',
            is_suspended=True,
            suspension_reason="Payment failed"
        )
        db_session.add(profile)
        await db_session.commit()
        
        enforcer = QuotaEnforcer(db_session, user_id)
        
        # Should be blocked from all actions
        with pytest.raises(Exception) as exc_info:
            await enforcer.check_concurrent_streams()
        assert exc_info.value.status_code == 403
        assert "suspended" in str(exc_info.value.detail).lower()
    
    async def test_playlists_quota_enforcement(self, db_session):
        """Test playlists quota enforcement"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 3 playlists (FREE limit is 3)
        for i in range(3):
            playlist = Playlist(
                user_id=user_id,
                name=f"Playlist {i}"
            )
            db_session.add(playlist)
        await db_session.commit()
        
        # Try to create 4th playlist (should fail)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_playlists_limit()
        
        assert exc_info.value.status_code == 402
        assert "playlists" in str(exc_info.value.detail).lower()
    
    async def test_destinations_quota_enforcement(self, db_session):
        """Test destinations quota enforcement"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 2 destinations (FREE limit is 2)
        for i in range(2):
            dest = Destination(
                user_id=user_id,
                name=f"Channel {i}",
                rtmps_url=f"rtmps://example.com/live/{i}",
                stream_key_encrypted="encrypted_key"
            )
            db_session.add(dest)
        await db_session.commit()
        
        # Try to create 3rd destination (should fail)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_destinations_limit()
        
        assert exc_info.value.status_code == 402
        assert "destinations" in str(exc_info.value.detail).lower()
    
    async def test_stopped_streams_dont_count_toward_limit(self, db_session):
        """Test that only running/starting streams count toward concurrent limit"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 5 stopped streams
        for i in range(5):
            stream = Stream(
                user_id=user_id,
                name=f"Stream {i}",
                status='stopped'
            )
            db_session.add(stream)
        await db_session.commit()
        
        # Should still be able to start a stream (stopped ones don't count)
        enforcer = QuotaEnforcer(db_session, user_id)
        can_stream = await enforcer.check_concurrent_streams()
        assert can_stream is True
    
    async def test_quota_check_creates_alert(self, db_session):
        """Test that quota exceeded creates system alert"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="free@example.com",
            subscription_tier='free',
            subscription_status='active',
            current_storage_bytes=5 * 1024**3  # At limit
        )
        db_session.add(profile)
        await db_session.commit()
        
        enforcer = QuotaEnforcer(db_session, user_id)
        
        try:
            await enforcer.check_storage_limit(additional_bytes=1024**3)
        except QuotaExceededError:
            pass
        
        # Check that alert was created
        result = await db_session.execute(
            select(SystemAlert).where(
                SystemAlert.user_id == user_id,
                SystemAlert.alert_type == 'quota_exceeded'
            )
        )
        alerts = result.scalars().all()
        assert len(alerts) > 0
        
        alert = alerts[0]
        assert alert.severity == 'warning'
        assert 'storage' in alert.message.lower()
        assert alert.resolved is False


@pytest.fixture
async def db_session():
    """Create a test database session"""
    from app.core.database import async_engine, async_session_maker
    from app.models.database import Base
    
    # Create tables
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Create session
    async with async_session_maker() as session:
        # Insert tier limits
        tiers_data = [
            {
                'tier': 'free',
                'storage_gb': 5,
                'max_concurrent_streams': 1,
                'max_destinations': 2,
                'max_playlists': 3,
                'max_assets': 20
            },
            {
                'tier': 'pro',
                'storage_gb': 50,
                'max_concurrent_streams': 5,
                'max_destinations': 10,
                'max_playlists': 20,
                'max_assets': 200
            },
            {
                'tier': 'business',
                'storage_gb': 200,
                'max_concurrent_streams': 20,
                'max_destinations': 50,
                'max_playlists': None,
                'max_assets': 1000
            },
            {
                'tier': 'enterprise',
                'storage_gb': None,  # unlimited
                'max_concurrent_streams': None,
                'max_destinations': None,
                'max_playlists': None,
                'max_assets': None
            }
        ]
        
        for tier_data in tiers_data:
            tier = SubscriptionTierLimits(**tier_data)
            session.add(tier)
        
        await session.commit()
        
        yield session
    
    # Cleanup
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
