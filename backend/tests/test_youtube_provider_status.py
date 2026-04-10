from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import encrypt_secret
from app.models.database import Destination, UserProfile, YoutubeConnection
from app.services.destinations import DestinationService
from app.services.youtube.provider_status import YoutubeProviderStatusService


@pytest.mark.asyncio
async def test_provider_status_service_reports_live_viewers(monkeypatch) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_youtube_provider_schema(session)
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@example.com",
                subscription_tier="free",
            )
        )
        connection = YoutubeConnection(
            user_id=user_id,
            youtube_channel_id="channel-1",
            youtube_channel_title="Main channel",
            access_token_encrypted=encrypt_secret("access-token"),
            refresh_token_encrypted=encrypt_secret("refresh-token"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            scopes_json=["https://www.googleapis.com/auth/youtube.readonly"],
        )
        session.add(connection)
        await session.commit()

        async def fake_active_broadcast(_self, _token: str):
            return {"id": "video-123", "contentDetails": {"boundStreamId": "stream-abc"}}

        async def fake_live_details(_self, _token: str, video_id: str):
            assert video_id == "video-123"
            return {"concurrentViewers": "42"}

        async def fake_live_stream_status(_self, _token: str, stream_id: str):
            assert stream_id == "stream-abc"
            return {
                "streamStatus": "active",
                "healthStatus": {
                    "status": "ok",
                    "configurationIssues": [
                        {"type": "gopSizeOver"},
                        {"type": "videoBitrateLow"},
                    ],
                },
            }

        monkeypatch.setattr(
            "app.services.youtube.provider_status.YoutubeClient.fetch_active_broadcast",
            fake_active_broadcast,
        )
        monkeypatch.setattr(
            "app.services.youtube.provider_status.YoutubeClient.fetch_video_live_details",
            fake_live_details,
        )
        monkeypatch.setattr(
            "app.services.youtube.provider_status.YoutubeClient.fetch_live_stream_status",
            fake_live_stream_status,
        )

        service = YoutubeProviderStatusService(session)
        snapshots = await service.enrich_connections([connection])

        snapshot = snapshots[connection.id]
        assert snapshot.provider_status == "live"
        assert snapshot.provider_viewers == 42
        assert snapshot.provider_video_id == "video-123"
        assert snapshot.provider_stream_status == "active"
        assert snapshot.provider_health_status == "ok"
        assert snapshot.provider_health_issues == ["gopSizeOver", "videoBitrateLow"]
        assert snapshot.provider_last_checked_at is not None


@pytest.mark.asyncio
async def test_destination_service_returns_provider_metadata(monkeypatch) -> None:
    user_id = uuid4()
    async with async_session_maker() as session:
        await _ensure_youtube_provider_schema(session)
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@example.com",
                subscription_tier="free",
            )
        )
        connection = YoutubeConnection(
            user_id=user_id,
            youtube_channel_id="channel-1",
            youtube_channel_title="Main channel",
            access_token_encrypted=encrypt_secret("access-token"),
            refresh_token_encrypted=encrypt_secret("refresh-token"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            scopes_json=["https://www.googleapis.com/auth/youtube.readonly"],
        )
        session.add(connection)
        await session.flush()
        session.add(
            Destination(
                user_id=user_id,
                name="Primary",
                rtmps_url="rtmps://a.rtmp.youtube.com/live2",
                stream_key_encrypted=encrypt_secret("stream-key"),
                enabled=True,
                provider_kind="youtube",
                provider_connection_id=connection.id,
                provider_channel_id=connection.youtube_channel_id,
            )
        )
        await session.commit()

        async def fake_enrich(self, destinations):
            for destination in destinations:
                setattr(destination, "_provider_status", "live")
                setattr(destination, "_provider_viewers", 7)
                setattr(
                    destination, "_provider_last_checked_at", datetime.now(timezone.utc)
                )
                setattr(destination, "_provider_video_id", "video-xyz")
                setattr(destination, "_provider_stream_status", "active")
                setattr(destination, "_provider_health_status", "bad")
                setattr(destination, "_provider_health_issues", ["noAudioStream"])

        monkeypatch.setattr(
            YoutubeProviderStatusService, "enrich_destinations", fake_enrich
        )

        service = DestinationService(session, user_id)
        responses = await service.list_destinations()

        assert len(responses) == 1
        response = responses[0]
        assert response.provider_connection_id == connection.id
        assert response.provider_kind == "youtube"
        assert response.provider_channel_id == "channel-1"
        assert response.provider_status == "live"
        assert response.provider_viewers == 7
        assert response.provider_video_id == "video-xyz"
        assert response.provider_stream_status == "active"
        assert response.provider_health_status == "bad"
        assert response.provider_health_issues == ["noAudioStream"]


async def _ensure_youtube_provider_schema(session) -> None:
    await session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS youtube_connections (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
                youtube_channel_id TEXT NOT NULL,
                youtube_channel_title TEXT,
                access_token_encrypted TEXT NOT NULL,
                refresh_token_encrypted TEXT,
                token_expires_at TIMESTAMPTZ,
                scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
                last_sync_at TIMESTAMPTZ,
                last_sync_error TEXT
            )
            """
        )
    )
    await session.execute(
        text(
            """
            ALTER TABLE destinations
                ADD COLUMN IF NOT EXISTS provider_kind TEXT,
                ADD COLUMN IF NOT EXISTS provider_connection_id UUID,
                ADD COLUMN IF NOT EXISTS provider_channel_id TEXT
            """
        )
    )
    await session.commit()
