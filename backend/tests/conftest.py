"""
Pytest configuration and fixtures for testing.
"""
import asyncio
from typing import AsyncGenerator, Generator

import pytest
from sqlalchemy import select, text

from app.core.database import async_session_maker
from app.core.config import settings
from app.models.database import SubscriptionTierLimits

# Tests should run in manager mode (no supervisor/systemd side effects)
settings.stream_runtime_mode = "manager"
settings.environment = "test"
settings.ffmpeg_auto_restart_attempts = 0
settings.ffmpeg_restart_backoff_seconds = 0

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
        await session.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await session.execute(text('CREATE SCHEMA IF NOT EXISTS auth'))
        await session.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS auth.users (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    email TEXT NOT NULL UNIQUE,
                    raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
                )
                """
            )
        )
        await session.execute(text('CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users(email)'))
        await session.commit()

        table_check = await session.execute(text("SELECT to_regclass('public.subscription_tier_limits')"))
        table_exists = table_check.scalar()
        if not table_exists:
            await session.commit()
            yield
            return

        await session.execute(text('ALTER TABLE subscription_tier_limits DROP CONSTRAINT IF EXISTS subscription_tier_limits_tier_check'))
        await session.execute(text('DELETE FROM subscription_tier_limits'))
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
            await session.execute(text(statement))

        await session.execute(text(
            "ALTER TABLE subscription_tier_limits ADD CONSTRAINT subscription_tier_limits_tier_check "
            "CHECK (tier IN ('free','fhd_start','fhd_flow','fhd_boost','uhd_start','uhd_flow','uhd_boost'))"
        ))

        result = await session.execute(select(SubscriptionTierLimits.tier))
        existing = {row[0] for row in result}

        required = {
            "free": {
                "price_cents": 0,
                "storage_gb": 3,
                "max_concurrent_streams": 1,
                "max_destinations": 1,
                "max_playlists": 5,
                "max_assets": 20,
                "max_resolution": "1080p",
                "max_resolution_height": 1080,
                "max_fps": 30,
                "daily_streaming_limit_hours": 8,
                "allowed_video_codecs": ['h264'],
            },
            "fhd_start": {
                "price_cents": 1000,
                "storage_gb": 50,
                "max_concurrent_streams": 1,
                "max_destinations": 3,
                "max_playlists": 15,
                "max_assets": 100,
                "max_resolution": "1080p",
                "max_resolution_height": 1080,
                "max_fps": 30,
                "daily_streaming_limit_hours": 24,
                "allowed_video_codecs": ['h264'],
            },
            "fhd_flow": {
                "price_cents": 2000,
                "storage_gb": 100,
                "max_concurrent_streams": 2,
                "max_destinations": 6,
                "max_playlists": 25,
                "max_assets": 200,
                "max_resolution": "1080p",
                "max_resolution_height": 1080,
                "max_fps": 60,
                "daily_streaming_limit_hours": None,
                "allowed_video_codecs": ['h264'],
            },
            "fhd_boost": {
                "price_cents": 3500,
                "storage_gb": 200,
                "max_concurrent_streams": 4,
                "max_destinations": 10,
                "max_playlists": 40,
                "max_assets": 400,
                "max_resolution": "1080p",
                "max_resolution_height": 1080,
                "max_fps": 60,
                "daily_streaming_limit_hours": None,
                "allowed_video_codecs": ['h264'],
            },
            "uhd_start": {
                "price_cents": 6900,
                "storage_gb": 200,
                "max_concurrent_streams": 1,
                "max_destinations": 4,
                "max_playlists": 25,
                "max_assets": 400,
                "max_resolution": "2160p",
                "max_resolution_height": 2160,
                "max_fps": 60,
                "daily_streaming_limit_hours": None,
                "allowed_video_codecs": ['h264', 'hevc'],
            },
            "uhd_flow": {
                "price_cents": 10900,
                "storage_gb": 400,
                "max_concurrent_streams": 2,
                "max_destinations": 8,
                "max_playlists": 50,
                "max_assets": 800,
                "max_resolution": "2160p",
                "max_resolution_height": 2160,
                "max_fps": 60,
                "daily_streaming_limit_hours": None,
                "allowed_video_codecs": ['h264', 'hevc'],
            },
            "uhd_boost": {
                "price_cents": 15900,
                "storage_gb": 800,
                "max_concurrent_streams": 4,
                "max_destinations": 12,
                "max_playlists": 80,
                "max_assets": 1200,
                "max_resolution": "2160p",
                "max_resolution_height": 2160,
                "max_fps": 60,
                "daily_streaming_limit_hours": None,
                "allowed_video_codecs": ['h264', 'hevc'],
            },
        }

        missing = required.keys() - existing
        if missing:
            for tier in missing:
                session.add(SubscriptionTierLimits(tier=tier, **required[tier]))
            await session.commit()
        else:
            await session.rollback()

        await session.execute(text(
            """
            DO $$
            BEGIN
                IF to_regclass('media_folders') IS NOT NULL THEN
                    WITH ranked AS (
                        SELECT
                            id,
                            user_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS row_rank,
                            FIRST_VALUE(id) OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS primary_id
                        FROM media_folders
                        WHERE is_root
                    )
                    UPDATE asset_folder_links afl
                    SET folder_id = ranked.primary_id
                    FROM ranked
                    WHERE afl.folder_id = ranked.id
                      AND ranked.row_rank > 1;

                    WITH ranked AS (
                        SELECT
                            id,
                            user_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS row_rank
                        FROM media_folders
                        WHERE is_root
                    )
                    DELETE FROM media_folders mf
                    USING ranked
                    WHERE mf.id = ranked.id
                      AND ranked.row_rank > 1;

                    IF to_regclass('idx_media_folders_user_root') IS NULL THEN
                        EXECUTE '
                            CREATE UNIQUE INDEX idx_media_folders_user_root
                            ON media_folders(user_id)
                            WHERE is_root
                        ';
                    END IF;
                END IF;
            END $$;
            """
        ))

    yield
