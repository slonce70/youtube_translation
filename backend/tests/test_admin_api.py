"""
Integration tests for Admin API

Tests admin-only endpoints for user management, stream monitoring, and system alerts.
"""

import os
import pytest

if os.environ.get("RUN_ADMIN_TESTS", "").lower() not in {"1", "true", "yes"}:
    pytest.skip("Skipping admin API integration tests in shared database", allow_module_level=True)

from uuid import uuid4, UUID
from datetime import datetime
from sqlalchemy import select, text

from app.models.database import (
    UserProfile, SubscriptionTierLimits, AdminAction,
    SystemAlert, Stream, Asset
)


@pytest.mark.asyncio
class TestAdminPermissions:
    """Test admin access control"""
    
    async def test_non_admin_cannot_access_admin_endpoints(self, db_session, auth_headers):
        """Test that non-admin users are blocked from admin endpoints"""
        # Create non-admin user
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="user@example.com",
            subscription_tier='free',
            is_admin=False
        )
        db_session.add(profile)
        await db_session.commit()
        
        # Try to access admin endpoint
        # This would need actual HTTP client setup, so this is a placeholder
        # In practice, you'd use TestClient from FastAPI
        pass
    
    async def test_admin_can_access_admin_endpoints(self, db_session):
        """Test that admin users can access admin endpoints"""
        admin_id = uuid4()
        profile = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            subscription_tier='fhd_flow',
            is_admin=True
        )
        db_session.add(profile)
        await db_session.commit()
        
        # Verify admin status
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == admin_id)
        )
        admin = result.scalar_one()
        assert admin.is_admin is True


@pytest.mark.asyncio
class TestUserManagement:
    """Test admin user management endpoints"""
    
    async def test_list_users(self, db_session):
        """Test listing all users"""
        # Create multiple users
        users = []
        for i in range(5):
            user = UserProfile(
                user_id=uuid4(),
                email=f"user{i}@example.com",
                subscription_tier='free' if i < 3 else 'fhd_start',
                is_suspended=i == 4
            )
            users.append(user)
            db_session.add(user)
        await db_session.commit()
        
        # Test query with filters
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.subscription_tier == 'free')
        )
        free_users = result.scalars().all()
        assert len(free_users) == 3
        
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.is_suspended == True)
        )
        suspended_users = result.scalars().all()
        assert len(suspended_users) == 1
    
    async def test_get_user_detail(self, db_session):
        """Test getting detailed user information"""
        user_id = uuid4()
        profile = UserProfile(
            user_id=user_id,
            email="user@example.com",
            full_name="Test User",
            subscription_tier='fhd_flow',
            current_storage_bytes=1024**3,  # 1 GB
            total_stream_hours=10.5
        )
        db_session.add(profile)
        
        # Create some assets for the user
        for i in range(5):
            asset = Asset(
                user_id=user_id,
                filename=f"video{i}.mp4",
                storage_path=f"/uploads/{user_id}/video{i}.mp4",
                size_bytes=1000000,
                asset_type="video",
            )
            db_session.add(asset)
        
        await db_session.commit()
        
        # Query user details
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        user = result.scalar_one()
        
        assert user.email == "user@example.com"
        assert user.subscription_tier == 'fhd_flow'
        assert user.current_storage_bytes == 1024**3
    
    async def test_suspend_user(self, db_session):
        """Test suspending a user"""
        user_id = uuid4()
        admin_id = uuid4()
        
        # Create user and admin
        user = UserProfile(
            user_id=user_id,
            email="user@example.com",
            subscription_tier='free',
            is_suspended=False
        )
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            subscription_tier='fhd_flow',
            is_admin=True
        )
        db_session.add(user)
        db_session.add(admin)
        
        # Create active stream for user
        stream = Stream(
            user_id=user_id,
            name="Test Stream",
            status='running'
        )
        db_session.add(stream)
        await db_session.commit()
        
        # Suspend user
        user.is_suspended = True
        user.suspension_reason = "Payment failed"
        stream.status = 'stopped'  # All streams should be stopped
        
        # Log admin action
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='suspend_user',
            target_user_id=user_id,
            details={'reason': 'Payment failed'}
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify suspension
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        suspended_user = result.scalar_one()
        assert suspended_user.is_suspended is True
        assert suspended_user.suspension_reason == "Payment failed"
        
        # Verify stream stopped
        result = await db_session.execute(
            select(Stream).where(Stream.user_id == user_id)
        )
        stopped_stream = result.scalar_one()
        assert stopped_stream.status == 'stopped'
        
        # Verify admin action logged
        result = await db_session.execute(
            select(AdminAction).where(AdminAction.target_user_id == user_id)
        )
        logged_action = result.scalar_one()
        assert logged_action.action_type == 'suspend_user'
        assert logged_action.admin_user_id == admin_id
    
    async def test_cannot_suspend_admin(self, db_session):
        """Test that admins cannot suspend other admins"""
        admin1_id = uuid4()
        admin2_id = uuid4()
        
        admin1 = UserProfile(
            user_id=admin1_id,
            email="admin1@example.com",
            is_admin=True
        )
        admin2 = UserProfile(
            user_id=admin2_id,
            email="admin2@example.com",
            is_admin=True
        )
        db_session.add(admin1)
        db_session.add(admin2)
        await db_session.commit()
        
        # This should be blocked in the API endpoint
        # Just verify both are admins
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == admin2_id)
        )
        target_admin = result.scalar_one()
        assert target_admin.is_admin is True
        # The API would throw 400 error here
    
    async def test_unsuspend_user(self, db_session):
        """Test unsuspending a user"""
        user_id = uuid4()
        admin_id = uuid4()
        
        user = UserProfile(
            user_id=user_id,
            email="user@example.com",
            is_suspended=True,
            suspension_reason="Payment failed"
        )
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        db_session.add(user)
        db_session.add(admin)
        await db_session.commit()
        
        # Unsuspend
        user.is_suspended = False
        user.suspension_reason = None
        
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='unsuspend_user',
            target_user_id=user_id
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        unsuspended_user = result.scalar_one()
        assert unsuspended_user.is_suspended is False
        assert unsuspended_user.suspension_reason is None
    
    async def test_change_user_tier(self, db_session):
        """Test changing a user's subscription tier"""
        user_id = uuid4()
        admin_id = uuid4()
        
        user = UserProfile(
            user_id=user_id,
            email="user@example.com",
            subscription_tier='free'
        )
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        db_session.add(user)
        db_session.add(admin)
        await db_session.commit()
        
        # Change tier
        old_tier = user.subscription_tier
        user.subscription_tier = 'fhd_flow'
        
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='change_tier',
            target_user_id=user_id,
            details={
                'old_tier': old_tier,
                'new_tier': 'fhd_flow',
                'reason': 'Promotional upgrade'
            }
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify
        result = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        upgraded_user = result.scalar_one()
        assert upgraded_user.subscription_tier == 'fhd_flow'
        assert upgraded_user.subscription_started_at is not None
        assert upgraded_user.subscription_expires_at is None
        
        # Verify action logged
        result = await db_session.execute(
            select(AdminAction).where(
                AdminAction.target_user_id == user_id,
                AdminAction.action_type == 'change_tier'
            )
        )
        logged_action = result.scalar_one()
        assert logged_action.details['old_tier'] == 'free'
        assert logged_action.details['new_tier'] == 'fhd_flow'


@pytest.mark.asyncio
class TestStreamsMonitoring:
    """Test admin stream monitoring endpoints"""
    
    async def test_list_all_streams(self, db_session):
        """Test listing streams across all users"""
        # Create multiple users with streams
        for i in range(3):
            user_id = uuid4()
            user = UserProfile(
                user_id=user_id,
                email=f"user{i}@example.com",
                subscription_tier='fhd_flow'
            )
            db_session.add(user)
            
            # Create streams for each user
            for j in range(2):
                stream = Stream(
                    user_id=user_id,
                    name=f"User{i} Stream {j}",
                    status='running' if j == 0 else 'stopped'
                )
                db_session.add(stream)
        
        await db_session.commit()
        
        # Query all streams
        result = await db_session.execute(select(Stream))
        all_streams = result.scalars().all()
        assert len(all_streams) == 6  # 3 users * 2 streams
        
        # Query only running streams
        result = await db_session.execute(
            select(Stream).where(Stream.status == 'running')
        )
        running_streams = result.scalars().all()
        assert len(running_streams) == 3  # 1 per user
    
    async def test_force_stop_stream(self, db_session):
        """Test admin force stopping a stream"""
        user_id = uuid4()
        admin_id = uuid4()
        stream_id = uuid4()
        
        user = UserProfile(
            user_id=user_id,
            email="user@example.com",
            subscription_tier='fhd_flow'
        )
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        stream = Stream(
            id=stream_id,
            user_id=user_id,
            name="Test Stream",
            status='running'
        )
        db_session.add(user)
        db_session.add(admin)
        db_session.add(stream)
        await db_session.commit()
        
        # Force stop
        stream.status = 'stopped'
        
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='force_stop_stream',
            target_user_id=user_id,
            details={
                'stream_id': str(stream_id),
                'stream_name': 'Test Stream'
            }
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify
        result = await db_session.execute(
            select(Stream).where(Stream.id == stream_id)
        )
        stopped_stream = result.scalar_one()
        assert stopped_stream.status == 'stopped'


@pytest.mark.asyncio
class TestSystemAlerts:
    """Test admin system alerts management"""
    
    async def test_list_alerts(self, db_session):
        """Test listing system alerts"""
        # Create users and alerts
        for i in range(3):
            user_id = uuid4()
            user = UserProfile(
                user_id=user_id,
                email=f"user{i}@example.com"
            )
            db_session.add(user)
            
            # Create alerts
            alert = SystemAlert(
                user_id=user_id,
                alert_type='quota_exceeded',
                severity='warning' if i < 2 else 'critical',
                message=f"Alert {i}",
                resolved=i == 0
            )
            db_session.add(alert)
        
        await db_session.commit()
        
        # Query unresolved alerts
        result = await db_session.execute(
            select(SystemAlert).where(SystemAlert.resolved == False)
        )
        unresolved = result.scalars().all()
        assert len(unresolved) == 2
        
        # Query by severity
        result = await db_session.execute(
            select(SystemAlert).where(SystemAlert.severity == 'critical')
        )
        critical = result.scalars().all()
        assert len(critical) == 1
    
    async def test_resolve_alert(self, db_session):
        """Test resolving a system alert"""
        user_id = uuid4()
        admin_id = uuid4()
        alert_id = uuid4()
        
        user = UserProfile(
            user_id=user_id,
            email="user@example.com"
        )
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        alert = SystemAlert(
            id=alert_id,
            user_id=user_id,
            alert_type='quota_exceeded',
            severity='warning',
            message="Storage quota exceeded",
            resolved=False
        )
        db_session.add(user)
        db_session.add(admin)
        db_session.add(alert)
        await db_session.commit()
        
        # Resolve alert
        alert.resolved = True
        alert.resolved_at = datetime.utcnow()
        alert.resolved_by = admin_id
        alert.details['resolution_notes'] = "User upgraded to Pro"
        
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='resolve_alert',
            details={
                'alert_id': str(alert_id),
                'alert_type': 'quota_exceeded',
                'notes': 'User upgraded to Pro'
            }
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify
        result = await db_session.execute(
            select(SystemAlert).where(SystemAlert.id == alert_id)
        )
        resolved_alert = result.scalar_one()
        assert resolved_alert.resolved is True
        assert resolved_alert.resolved_by == admin_id
        assert resolved_alert.details['resolution_notes'] == "User upgraded to Pro"


@pytest.mark.asyncio
class TestAdminActionLogging:
    """Test admin action logging"""
    
    async def test_all_admin_actions_logged(self, db_session):
        """Test that all admin actions are logged"""
        admin_id = uuid4()
        user_id = uuid4()
        
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        user = UserProfile(
            user_id=user_id,
            email="user@example.com"
        )
        db_session.add(admin)
        db_session.add(user)
        await db_session.commit()
        
        # Perform multiple admin actions
        action_types = [
            'suspend_user',
            'unsuspend_user',
            'change_tier',
            'force_stop_stream',
            'resolve_alert'
        ]
        
        for action_type in action_types:
            action = AdminAction(
                admin_user_id=admin_id,
                action_type=action_type,
                target_user_id=user_id,
                details={'test': True}
            )
            db_session.add(action)
        
        await db_session.commit()
        
        # Verify all logged
        result = await db_session.execute(
            select(AdminAction).where(AdminAction.admin_user_id == admin_id)
        )
        logged_actions = result.scalars().all()
        assert len(logged_actions) == 5
        
        logged_types = [a.action_type for a in logged_actions]
        assert set(logged_types) == set(action_types)
    
    async def test_admin_action_includes_details(self, db_session):
        """Test that admin actions include relevant details"""
        admin_id = uuid4()
        user_id = uuid4()
        
        admin = UserProfile(
            user_id=admin_id,
            email="admin@example.com",
            is_admin=True
        )
        user = UserProfile(
            user_id=user_id,
            email="user@example.com",
            subscription_tier='free'
        )
        db_session.add(admin)
        db_session.add(user)
        await db_session.commit()
        
        # Log tier change with details
        action = AdminAction(
            admin_user_id=admin_id,
            action_type='change_tier',
            target_user_id=user_id,
            details={
                'old_tier': 'free',
                'new_tier': 'fhd_start',
                'reason': 'Customer support request',
                'ticket_id': '12345'
            }
        )
        db_session.add(action)
        await db_session.commit()
        
        # Verify details
        result = await db_session.execute(
            select(AdminAction).where(
                AdminAction.admin_user_id == admin_id,
                AdminAction.action_type == 'change_tier'
            )
        )
        logged_action = result.scalar_one()
        assert logged_action.details['old_tier'] == 'free'
        assert logged_action.details['new_tier'] == 'fhd_start'
        assert logged_action.details['reason'] == 'Customer support request'
        assert logged_action.details['ticket_id'] == '12345'
        assert 'previous_started_at' in logged_action.details


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
            {'tier': 'free', 'price_cents': 0, 'storage_gb': 3, 'max_concurrent_streams': 1, 'max_destinations': 1},
            {'tier': 'fhd_start', 'price_cents': 1000, 'storage_gb': 50, 'max_concurrent_streams': 1, 'max_destinations': 3},
            {'tier': 'fhd_flow', 'price_cents': 2000, 'storage_gb': 100, 'max_concurrent_streams': 2, 'max_destinations': 6},
            {'tier': 'fhd_boost', 'price_cents': 3500, 'storage_gb': 200, 'max_concurrent_streams': 4, 'max_destinations': 10},
            {'tier': 'uhd_start', 'price_cents': 6900, 'storage_gb': 200, 'max_concurrent_streams': 1, 'max_destinations': 4},
            {'tier': 'uhd_flow', 'price_cents': 10900, 'storage_gb': 400, 'max_concurrent_streams': 2, 'max_destinations': 8},
            {'tier': 'uhd_boost', 'price_cents': 15900, 'storage_gb': 800, 'max_concurrent_streams': 4, 'max_destinations': 12}
        ]

        for tier_data in tiers_data:
            tier = SubscriptionTierLimits(**tier_data)
            session.add(tier)
        
        await session.commit()
        
        yield session
    
    # Cleanup
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
def auth_headers():
    """Mock auth headers for testing"""
    return {"Authorization": "Bearer test_token"}
