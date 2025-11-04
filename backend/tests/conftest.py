"""
Pytest configuration and fixtures for testing.
"""
import asyncio
from typing import AsyncGenerator, Generator

import pytest
from sqlalchemy import select

from app.core.database import async_session_maker
from app.models.database import SubscriptionTierLimits

# Set event loop policy for async tests
@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.get_event_loop_policy()


@pytest.fixture(scope="session")
def event_loop(event_loop_policy) -> Generator:
    """Create event loop for tests"""
    loop = event_loop_policy.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
async def ensure_subscription_tiers() -> AsyncGenerator[None, None]:
    """Seed default subscription tier limits for tests if missing."""
    async with async_session_maker() as session:
        result = await session.execute(select(SubscriptionTierLimits.tier))
        existing = {row[0] for row in result}

        required = {
            "free": {
                "storage_gb": 5,
                "max_concurrent_streams": 1,
                "max_destinations": 2,
                "max_playlists": 3,
                "max_assets": 20,
            },
            "pro": {
                "storage_gb": 50,
                "max_concurrent_streams": 3,
                "max_destinations": 10,
                "max_playlists": 15,
                "max_assets": 200,
            },
            "business": {
                "storage_gb": 200,
                "max_concurrent_streams": 10,
                "max_destinations": 25,
                "max_playlists": 50,
                "max_assets": 1000,
            },
            "enterprise": {
                "storage_gb": None,
                "max_concurrent_streams": None,
                "max_destinations": None,
                "max_playlists": None,
                "max_assets": None,
            },
        }

        missing = required.keys() - existing
        if missing:
            for tier in missing:
                session.add(SubscriptionTierLimits(tier=tier, **required[tier]))
            await session.commit()
        else:
            await session.rollback()

    yield
