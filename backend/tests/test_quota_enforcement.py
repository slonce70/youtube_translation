"""
Integration tests for Quota Enforcement

Tests that subscription tier limits are properly enforced across all resources.
"""

import os
import pytest
from datetime import datetime, timedelta, timezone

if os.environ.get("RUN_QUOTA_TESTS", "").lower() not in {"1", "true", "yes"}:
    pytest.skip("Skipping quota enforcement tests in shared database", allow_module_level=True)

from uuid import uuid4
from sqlalchemy import select, text

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
            current_storage_bytes=int(2.9 * 1024**3)  # 2.9 GB used
        )
        db_session.add(profile)
        await db_session.commit()
        
        # Try to add ~0.2 GB more (should fail, limit is 3 GB)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_storage_limit(additional_bytes=200 * 1024**2)
        
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
                size_bytes=1000000,
                asset_type="video",
            )
            db_session.add(asset)
        await db_session.commit()
        
        # Try to create 21st asset (should fail)
        enforcer = QuotaEnforcer(db_session, user_id)
        
        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_assets_limit()
        
        assert exc_info.value.status_code == 402
        assert "assets" in str(exc_info.value.detail).lower()
    
    async def test_fhd_boost_tier_higher_limits(self, db_session):
        """Test that FHD Boost tier has higher limits than Free"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="fhd-boost@example.com",
            subscription_tier='fhd_boost',
            subscription_status='active',
            current_storage_bytes=150 * 1024**3  # 150 GB used
        )
        db_session.add(profile)
        await db_session.flush()
        
        # Create 3 running streams (FHD Boost limit is 4)
        for i in range(3):
            stream = Stream(
                user_id=user_id,
                name=f"Stream {i}",
                status='running'
            )
            db_session.add(stream)
        await db_session.commit()
        
        # Should be able to add more storage (limit is 200 GB)
        enforcer = QuotaEnforcer(db_session, user_id)
        can_upload = await enforcer.check_storage_limit(additional_bytes=25 * 1024**3)
        assert can_upload is True
        
        # Should be able to start more streams
        can_stream = await enforcer.check_concurrent_streams()
        assert can_stream is True

    async def test_daily_streaming_limit_enforced(self, db_session):
        """Test that daily streaming limits are enforced for capped plans"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="limit@example.com",
            subscription_tier='free',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.flush()

        started_at = datetime.now(timezone.utc) - timedelta(hours=9)
        stream = Stream(
            user_id=user_id,
            name="Long stream",
            status='stopped',
            started_at=started_at,
            stopped_at=started_at + timedelta(hours=8),
            total_duration_seconds=8 * 3600
        )
        db_session.add(stream)
        await db_session.commit()

        enforcer = QuotaEnforcer(db_session, user_id)

        with pytest.raises(QuotaExceededError) as exc_info:
            await enforcer.check_concurrent_streams()

        assert exc_info.value.status_code == 402
        assert "daily streaming hours" in str(exc_info.value.detail).lower()

    async def test_suspended_user_blocked(self, db_session):
        """Test that suspended users cannot perform any actions"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="suspended@example.com",
            subscription_tier='fhd_flow',
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
        
        # Create 5 playlists (FREE limit is 5)
        for i in range(5):
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
        
        # Create 1 destination (FREE limit is 1)
        for i in range(1):
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
            current_storage_bytes=3 * 1024**3  # At limit
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

    async def test_uhd_boost_allows_hevc_codec(self, db_session):
        """UHD tiers should allow HEVC video streams."""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="uhd@example.com",
            subscription_tier='uhd_boost',
            subscription_status='active'
        )
        db_session.add(profile)
        await db_session.commit()

        enforcer = QuotaEnforcer(db_session, user_id)

        assets = [
            {
                "asset_id": uuid4(),
                "filename": "uhd_clip.mp4",
                "meta": {
                    "video": {
                        "codec_name": "hevc",
                        "height": 2160,
                        "fps": 60,
                        "bitrate": 25_000_000,
                    },
                    "bitrate": 25_000_000,
                },
            }
        ]

        result = await enforcer.evaluate_stream_quality(assets)
        assert result["violations"] == []
        assert result["ok"] is True


@pytest.fixture
async def db_session():
    """Create a test database session"""
    from app.core.database import async_engine, async_session_maker
    from app.models.database import Base
    
    # Create tables
    async with async_engine.begin() as conn:
        view_names = ['unresolved_critical_alerts', 'recent_admin_actions', 'recent_user_activity']
        for view in view_names:
            await conn.execute(text(f'DROP VIEW IF EXISTS {view}'))
        await conn.execute(text('DROP TABLE IF EXISTS subscription_tier_limits CASCADE'))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        alter_statements = [
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS daily_streaming_limit_hours INTEGER",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS branding_enabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS priority_support_level TEXT",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS dedicated_manager BOOLEAN DEFAULT FALSE",
            "ALTER TABLE subscription_tier_limits ADD COLUMN IF NOT EXISTS allowed_video_codecs TEXT[]"
        ]
        for statement in alter_statements:
            await conn.execute(text(statement))
    
    # Create session
    async with async_session_maker() as session:
        # Insert tier limits
        tiers_data = [
            {
                'tier': 'free',
                'storage_gb': 3,
                'max_concurrent_streams': 1,
                'max_destinations': 1,
                'max_playlists': 5,
                'max_assets': 20,
                'daily_streaming_limit_hours': 8,
                'allowed_video_codecs': ['h264'],
            },
            {
                'tier': 'fhd_flow',
                'storage_gb': 100,
                'max_concurrent_streams': 2,
                'max_destinations': 6,
                'max_playlists': 25,
                'max_assets': 200,
                'daily_streaming_limit_hours': None,
                'allowed_video_codecs': ['h264'],
            },
            {
                'tier': 'uhd_boost',
                'storage_gb': 800,
                'max_concurrent_streams': 4,
                'max_destinations': 12,
                'max_playlists': 80,
                'max_assets': 1200,
                'daily_streaming_limit_hours': None,
                'allowed_video_codecs': ['h264', 'hevc'],
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
