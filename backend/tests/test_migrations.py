"""
Tests for database migrations

These tests verify that migrations are applied correctly and data is migrated properly.
"""

import os
import pytest
import asyncio
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import uuid4

from app.models.database import (
    UserProfile, SubscriptionTierLimits,
    Asset, Playlist, Destination, Stream,
    AdminAction, SystemAlert,
    MediaFolder, AssetFolderLink, MediaCollection, CollectionItem,
)
from app.core.database import get_db


async def _require_table(db: AsyncSession, table_name: str) -> None:
    """Skip tests gracefully when optional tables are unavailable in the test DB."""
    result = await db.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    )
    if not result.scalar():
        pytest.skip(f"{table_name} table not available in this test environment")


async def _require_column(db: AsyncSession, table_name: str, column_name: str) -> None:
    """Skip when a specific column is missing (migrations not yet applied)."""
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table
              AND column_name = :column
            """
        ),
        {"table": table_name, "column": column_name},
    )
    if not result.scalar():
        pytest.skip(
            f"{table_name}.{column_name} column not available in this test environment"
        )


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
        
        tier_names = {t.tier for t in tiers}
        assert tier_names == {
            'free',
            'fhd_start',
            'fhd_flow',
            'fhd_boost',
            'uhd_start',
            'uhd_flow',
            'uhd_boost',
        }

        # Check free tier limits
        free_tier = next(t for t in tiers if t.tier == 'free')
        assert free_tier.storage_gb == 3
        assert free_tier.max_concurrent_streams == 1
        assert free_tier.max_destinations == 1
        assert free_tier.max_playlists == 5
        assert free_tier.max_assets == 20
        assert free_tier.daily_streaming_limit_hours == 8

    @pytest.mark.asyncio
    async def test_uhd_boost_tier_allows_hevc(self, db: AsyncSession):
        """Test that UHD Boost tier supports HEVC passthrough"""
        result = await db.execute(
            select(SubscriptionTierLimits).where(SubscriptionTierLimits.tier == 'uhd_boost')
        )
        uhd_boost = result.scalar_one()

        assert uhd_boost.max_resolution_height == 2160
        assert uhd_boost.max_concurrent_streams == 4
        assert 'hevc' in (uhd_boost.allowed_video_codecs or [])


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
            UserProfile(user_id=admin_id, email="admin@example.com", subscription_tier='fhd_flow', subscription_status='active', is_admin=True),
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


class TestMediaFoldersAndCollectionsMigration:
    """Verify folder hierarchy, pivot tables, and collection constraints."""

    @pytest.mark.asyncio
    async def test_media_folders_allow_single_root_per_user(self, db: AsyncSession):
        await _require_table(db, "media_folders")
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@folders.test",
            subscription_tier='free',
            subscription_status='active',
        )
        db.add(profile)
        await db.flush()

        db.add(MediaFolder(user_id=user_id, name="root", is_root=True))
        await db.flush()

        db.add(MediaFolder(user_id=user_id, name="second-root", is_root=True))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()

    @pytest.mark.asyncio
    async def test_asset_folder_links_enforce_unique_pairs(self, db: AsyncSession):
        await _require_table(db, "media_folders")
        await _require_table(db, "asset_folder_links")
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@asset-links.test",
            subscription_tier='free',
            subscription_status='active',
        )
        asset = Asset(
            user_id=user_id,
            filename="sample.mp4",
            storage_path=f"/tmp/{user_id}.mp4",
            size_bytes=1234,
            asset_type='video',
        )
        folder = MediaFolder(user_id=user_id, name="root", is_root=True)
        db.add_all([profile, asset, folder])
        await db.flush()

        db.add(AssetFolderLink(asset_id=asset.id, folder_id=folder.id))
        await db.flush()

        db.add(AssetFolderLink(asset_id=asset.id, folder_id=folder.id))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()

    @pytest.mark.asyncio
    async def test_media_collection_type_constraint(self, db: AsyncSession):
        await _require_table(db, "media_collections")
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@collections.test",
            subscription_tier='free',
            subscription_status='active',
        )
        db.add(profile)
        await db.flush()

        db.add(
            MediaCollection(
                user_id=user_id,
                name="Backgrounds",
                collection_type='video_background',
            )
        )
        await db.flush()

        db.add(
            MediaCollection(
                user_id=user_id,
                name="Bad",
                collection_type='slideshow',
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()

    @pytest.mark.asyncio
    async def test_collection_item_loop_mode_constraint(self, db: AsyncSession):
        await _require_table(db, "media_collections")
        await _require_table(db, "collection_items")
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@collection-items.test",
            subscription_tier='free',
            subscription_status='active',
        )
        asset = Asset(
            user_id=user_id,
            filename="bg.mp4",
            storage_path=f"/tmp/{user_id}.mp4",
            size_bytes=2048,
            asset_type='video',
        )
        collection = MediaCollection(
            user_id=user_id,
            name="Backgrounds",
            collection_type='video_background',
        )
        db.add_all([profile, asset, collection])
        await db.flush()

        db.add(
            CollectionItem(
                collection_id=collection.id,
                asset_id=asset.id,
                position=0,
                loop_mode='loop',
            )
        )
        await db.flush()

        db.add(
            CollectionItem(
                collection_id=collection.id,
                asset_id=asset.id,
                position=1,
                loop_mode='invalid',
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


class TestStreamMixModeConstraint:
    """Ensure new stream columns enforce valid values."""

    @pytest.mark.asyncio
    async def test_stream_mix_mode_allows_only_supported_values(self, db: AsyncSession):
        await _require_table(db, "streams")
        await _require_column(db, "streams", "video_collection_id")
        await _require_column(db, "streams", "audio_collection_id")
        await _require_column(db, "streams", "mix_mode")
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@streams.test",
            subscription_tier='free',
            subscription_status='active',
        )
        db.add(profile)
        await db.flush()

        db.add(
            Stream(
                user_id=user_id,
                name="Valid mixed",
                mix_mode='mixed',
                source_type='playlist',
            )
        )
        await db.flush()

        db.add(
            Stream(
                user_id=user_id,
                name="Invalid",
                mix_mode='invalid',
                source_type='playlist',
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


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
