from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.database import async_engine, async_session_maker
from app.models.database import Base, SubscriptionTierLimits, SystemAlert, UserProfile
from app.services.admin.service import AdminService


@pytest.fixture
async def db_session():
    """Create an isolated session for admin alert service tests."""
    async with async_engine.begin() as conn:
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS public"))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        for view in (
            "unresolved_critical_alerts",
            "recent_admin_actions",
            "recent_user_activity",
        ):
            await conn.execute(text(f"DROP VIEW IF EXISTS {view}"))
        await conn.execute(
            text("DROP TABLE IF EXISTS subscription_tier_limits CASCADE")
        )
        await conn.execute(text("DROP TABLE IF EXISTS media_folders CASCADE"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                "ALTER TABLE subscription_tier_limits "
                "ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0"
            )
        )

    async with async_session_maker() as session:
        session.add(
            SubscriptionTierLimits(
                tier="free",
                price_cents=0,
                storage_gb=3,
                max_concurrent_streams=1,
                max_destinations=1,
            )
        )
        await session.commit()
        yield session

    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _seed_orphan_and_owned_alerts(db_session) -> None:
    owner_id = uuid4()
    db_session.add(
        UserProfile(
            user_id=owner_id,
            email="owner@example.com",
            subscription_tier="free",
        )
    )
    db_session.add_all(
        [
            SystemAlert(
                user_id=None,
                alert_type="stream_failure",
                severity="warning",
                message="Orphaned stream alert",
                resolved=False,
            ),
            SystemAlert(
                user_id=owner_id,
                alert_type="stream_failure",
                severity="critical",
                message="Owned stream alert",
                resolved=False,
            ),
        ]
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_alerts_includes_orphan_rows(db_session):
    await _seed_orphan_and_owned_alerts(db_session)

    service = AdminService(db_session, admin_user_id=uuid4())
    response = await service.list_alerts(
        resolved=False,
        severity=None,
        alert_type=None,
        limit=10,
        offset=0,
    )

    assert response.summary.total == 2
    assert response.summary.unresolved == 2
    assert response.summary.critical == 1
    assert len(response.items) == 2

    orphan_item = next(item for item in response.items if item.user_id is None)
    assert orphan_item.user_email is None


@pytest.mark.asyncio
async def test_list_alerts_summary_tracks_full_filtered_dataset_not_page_length(
    db_session,
):
    await _seed_orphan_and_owned_alerts(db_session)

    service = AdminService(db_session, admin_user_id=uuid4())
    response = await service.list_alerts(
        resolved=False,
        severity=None,
        alert_type=None,
        limit=1,
        offset=0,
    )

    assert response.summary.total == 2
    assert response.summary.unresolved == 2
    assert len(response.items) == 1
