from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import DeclarativeBase, Mapped

class Base(DeclarativeBase):
    def __init__(self, **kw: Any) -> None: ...

class UserProfile(Base):
    user_id: Mapped[UUID]
    email: Mapped[str]
    full_name: Mapped[str | None]
    is_admin: Mapped[bool]
    is_suspended: Mapped[bool]
    suspension_reason: Mapped[str | None]
    current_storage_bytes: Mapped[int | None]
    subscription_tier: Mapped[str]
    subscription_status: Mapped[str]

class SubscriptionTierLimits(Base):
    tier: Mapped[str]
    storage_gb: Mapped[int | None]
    max_concurrent_streams: Mapped[int | None]
    max_destinations: Mapped[int | None]
    max_playlists: Mapped[int | None]
    max_assets: Mapped[int | None]
    max_resolution: Mapped[str]
    daily_streaming_limit_hours: Mapped[int | None]
    allowed_video_codecs: Mapped[list[str] | None]
    custom_rtmps_enabled: Mapped[bool]
    min_video_bitrate_mbps: Mapped[int | None]
    max_resolution_height: Mapped[int | None]
    max_fps: Mapped[int | None]
    max_video_bitrate_mbps: Mapped[int | None]
    enforce_stream_quality: Mapped[bool]

class Asset(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]

class Playlist(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]

class Destination(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    provider_connection_id: Mapped[UUID | None]

class StreamDestination(Base):
    destination: Mapped[Destination | None]

class SystemAlert(Base):
    user_id: Mapped[UUID | None]
    alert_type: Mapped[str]
    severity: Mapped[str]
    message: Mapped[str]
    details: Mapped[dict[str, Any] | None]
    resolved: Mapped[bool]

class Stream(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    status: Mapped[str]
    started_at: Mapped[datetime | None]
    stopped_at: Mapped[datetime | None]
    runtime_last_heartbeat_at: Mapped[datetime | None]
    stream_destinations: Mapped[list[StreamDestination]]

class YoutubeConnection(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    youtube_channel_id: Mapped[str]
    youtube_channel_title: Mapped[str | None]
    access_token_encrypted: Mapped[str]
    refresh_token_encrypted: Mapped[str | None]
    token_expires_at: Mapped[datetime | None]
    scopes_json: Mapped[list[str] | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    last_sync_at: Mapped[datetime | None]
    last_sync_error: Mapped[str | None]
