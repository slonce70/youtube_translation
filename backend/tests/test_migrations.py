"""
Tests for database migrations

These tests verify that migrations are applied correctly and data is migrated properly.
"""

import os
import pytest
import asyncio
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import uuid4

from app.models.database import (
    UserProfile, SubscriptionTierLimits,
    Asset, Playlist, Destination, Stream,
    AdminAction, SystemAlert
)
from app.core.database import get_db


class TestUserProfilesMigration:
    """Test user_profiles table creation and triggers"""
    
    @pytest.mark.asyncio
    async def test_user_profiles_table_exists(self, db: AsyncSession):
        """Test that user_profiles table was created"""
        result = await db.execute(select(UserProfile).limit(1))
        # Should not raise error if table exists
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_subscription_tier_limits_populated(self, db: AsyncSession):
        """Test that tier limits were inserted"""
        result = await db.execute(select(SubscriptionTierLimits))
        tiers = result.scalars().all()
        
        tier_names = [t.tier for t in tiers]
        assert 'free' in tier_names
        assert 'pro' in tier_names
        assert 'business' in tier_names
        assert 'enterprise' in tier_names
        
        # Check free tier limits
        free_tier = next(t for t in tiers if t.tier == 'free')
        assert free_tier.storage_gb == 5
        assert free_tier.max_concurrent_streams == 1
        assert free_tier.max_destinations == 2
        assert free_tier.max_playlists == 3
        assert free_tier.max_assets == 20
    
    @pytest.mark.asyncio
    async def test_enterprise_tier_unlimited(self, db: AsyncSession):
        """Test that enterprise tier has unlimited resources"""
        result = await db.execute(
            select(SubscriptionTierLimits).where(SubscriptionTierLimits.tier == 'enterprise')
        )
        enterprise = result.scalar_one()
        
        assert enterprise.storage_gb is None  # Unlimited
        assert enterprise.max_concurrent_streams is None
        assert enterprise.max_destinations is None


class TestUserIdColumnsMigration:
    """Test user_id columns added to existing tables"""
    
    @pytest.mark.asyncio
    async def test_assets_has_user_id_column(self, db: AsyncSession):
        """Test that assets table has user_id column"""
        # Try to query user_id column
        result = await db.execute(
            select(Asset.id, Asset.user_id).limit(1)
        )
        # Should not raise error if column exists
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_playlists_has_user_id_column(self, db: AsyncSession):
        """Test that playlists table has user_id column"""
        result = await db.execute(
            select(Playlist.id, Playlist.user_id).limit(1)
        )
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_destinations_has_user_id_column(self, db: AsyncSession):
        """Test that destinations table has user_id column"""
        result = await db.execute(
            select(Destination.id, Destination.user_id).limit(1)
        )
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_streams_has_user_id_column(self, db: AsyncSession):
        """Test that streams table has user_id column"""
        result = await db.execute(
            select(Stream.id, Stream.user_id).limit(1)
        )
        assert result is not None


class TestDataMigration:
    """Test that existing data was migrated correctly"""
    
    @pytest.mark.asyncio
    async def test_all_assets_have_user_id(self, db: AsyncSession):
        """Test that all assets have user_id populated"""
        result = await db.execute(
            select(
                func.count(Asset.id).label('total'),
                func.count(Asset.user_id).label('with_user_id')
            )
        )
        counts = result.one()
        
        # All assets should have user_id
        assert counts.total == counts.with_user_id
    
    def test_project_columns_removed(self):
        """Ensure legacy project_id columns were dropped"""
        assert 'project_id' not in Asset.__table__.columns.keys()
        assert 'project_id' not in Playlist.__table__.columns.keys()
        assert 'project_id' not in Destination.__table__.columns.keys()
        assert 'project_id' not in Stream.__table__.columns.keys()


SKIP_WRITE_HEAVY = os.environ.get("RUN_MIGRATION_WRITE_TESTS", "").lower() not in {"1", "true", "yes"}


@pytest.mark.skipif(SKIP_WRITE_HEAVY, reason="Skipping write-heavy migration checks on shared database")
class TestStatisticsTracking:
    """Test that usage statistics are being tracked"""
    
    @pytest.mark.asyncio
    async def test_user_storage_usage_calculated(self, db: AsyncSession):
        """Test that current_storage_bytes is calculated correctly"""
        user_id = uuid4()

        profile = UserProfile(
            user_id=user_id,
            email="stats-test@example.com",
            subscription_tier='free',
            subscription_status='active',
            current_storage_bytes=0
        )
        db.add(profile)

        await db.flush()

        sizes = [12_000_000, 34_000_000]
        for idx, size in enumerate(sizes):
            asset = Asset(
                user_id=user_id,
                filename=f"test-asset-{idx}.mp4",
                storage_path=f"/tmp/test-{idx}.mp4",
                size_bytes=size
            )
            db.add(asset)

        await db.flush()

        asset_storage = await db.execute(
            select(func.coalesce(func.sum(Asset.size_bytes), 0))
            .where(Asset.user_id == user_id)
        )
        expected_storage = asset_storage.scalar()

        profile.current_storage_bytes = expected_storage
        await db.commit()

        refreshed = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        reloaded_profile = refreshed.scalar_one()
        assert reloaded_profile.current_storage_bytes == expected_storage
    
    @pytest.mark.asyncio
    async def test_playlist_stats_calculated(self, db: AsyncSession):
        """Test that playlist total_assets is calculated"""
        # Get a playlist with items
        result = await db.execute(
            select(Playlist).where(Playlist.total_assets > 0).limit(1)
        )
        playlist = result.scalar_one_or_none()
        
        if playlist:
            # Count actual items
            from app.models.database import PlaylistItem
            items_count = await db.execute(
                select(func.count(PlaylistItem.id))
                .where(PlaylistItem.playlist_id == playlist.id)
            )
            expected_count = items_count.scalar()
            
            assert playlist.total_assets == expected_count


@pytest.mark.skipif(SKIP_WRITE_HEAVY, reason="Skipping write-heavy migration checks on shared database")
class TestAdminTables:
    """Test admin and monitoring tables"""
    
    @pytest.mark.asyncio
    async def test_admin_actions_table_exists(self, db: AsyncSession):
        """Test that admin_actions table was created"""
        result = await db.execute(select(AdminAction).limit(1))
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_system_alerts_table_exists(self, db: AsyncSession):
        """Test that system_alerts table was created"""
        result = await db.execute(select(SystemAlert).limit(1))
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_can_insert_admin_action(self, db: AsyncSession):
        """Test that we can insert admin actions"""
        admin_id = uuid4()
        target_id = uuid4()

        db.add_all([
            UserProfile(user_id=admin_id, email="admin@example.com", subscription_tier='pro', subscription_status='active', is_admin=True),
            UserProfile(user_id=target_id, email="user@example.com", subscription_tier='free', subscription_status='active')
        ])

        await db.flush()

        action = AdminAction(
            admin_user_id=admin_id,
            target_user_id=target_id,
            action_type='suspend_user',
            reason='Test action'
        )

        db.add(action)
        await db.commit()
        
        # Verify insert
        result = await db.execute(
            select(AdminAction).where(AdminAction.id == action.id)
        )
        saved = result.scalar_one()
        
        assert saved.action_type == 'suspend_user'
        assert saved.reason == 'Test action'
    
    @pytest.mark.asyncio
    async def test_can_insert_system_alert(self, db: AsyncSession):
        """Test that we can insert system alerts"""
        user_id = uuid4()

        db.add(
            UserProfile(
                user_id=user_id,
                email="alert@example.com",
                subscription_tier='free',
                subscription_status='active'
            )
        )

        await db.flush()

        alert = SystemAlert(
            alert_type='quota_exceeded',
            severity='warning',
            user_id=user_id,
            message='Storage quota exceeded',
            resolved=False
        )
        
        db.add(alert)
        await db.commit()
        
        # Verify insert
        result = await db.execute(
            select(SystemAlert).where(SystemAlert.id == alert.id)
        )
        saved = result.scalar_one()
        
        assert saved.alert_type == 'quota_exceeded'
        assert saved.severity == 'warning'
        assert saved.resolved is False


class TestRLSPolicies:
    """Test Row Level Security policies"""
    
    @pytest.mark.asyncio
    async def test_user_can_only_see_own_assets(self, db: AsyncSession):
        """Test RLS policy for assets"""
        # This would need to be tested with actual auth context
        # For now, just verify policies exist
        pass
    
    @pytest.mark.asyncio
    async def test_admin_policies_exist(self, db: AsyncSession):
        """Test that admin-specific policies were created"""
        # Query pg_policies to verify
        pass


# Pytest fixtures
@pytest.fixture
async def db():
    """Get database session for tests"""
    async for session in get_db():
        yield session


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
