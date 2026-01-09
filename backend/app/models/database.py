from sqlalchemy import Column, Integer, BigInteger, Float, Boolean, Text, ForeignKey, ARRAY, CheckConstraint, PrimaryKeyConstraint, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP, INET
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

Base = declarative_base()


# ==================================================
# USER PROFILES AND SUBSCRIPTION TIERS
# ==================================================

class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(UUID(as_uuid=True), primary_key=True)
    email = Column(Text, nullable=False, unique=True, index=True)
    full_name = Column(Text)
    company_name = Column(Text)
    timezone = Column(Text)
    
    # Subscription info
    subscription_tier = Column(Text, nullable=False, default='free', index=True)
    subscription_status = Column(Text, nullable=False, default='active', index=True)
    subscription_started_at = Column(TIMESTAMP(timezone=True))
    subscription_expires_at = Column(TIMESTAMP(timezone=True))
    
    # Payment integration
    stripe_customer_id = Column(Text, unique=True, index=True)
    stripe_subscription_id = Column(Text, unique=True)
    
    # Usage tracking
    current_storage_bytes = Column(BigInteger, default=0)
    total_stream_hours = Column(Float, default=0)
    
    # Admin flags
    is_admin = Column(Boolean, default=False, index=True)
    is_suspended = Column(Boolean, default=False, index=True)
    suspension_reason = Column(Text)
    
    # Metadata
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at = Column(TIMESTAMP(timezone=True))


class SubscriptionTierLimits(Base):
    __tablename__ = "subscription_tier_limits"

    tier = Column(Text, primary_key=True)
    price_cents = Column(Integer, nullable=False, default=0)
    storage_gb = Column(Integer)  # NULL = unlimited
    max_concurrent_streams = Column(Integer)  # NULL = unlimited
    max_destinations = Column(Integer)  # NULL = unlimited
    max_playlists = Column(Integer)  # NULL = unlimited
    max_assets = Column(Integer)  # NULL = unlimited
    max_resolution = Column(Text, nullable=False, default='1080p')
    daily_streaming_limit_hours = Column(Integer)
    api_access_enabled = Column(Boolean, default=False)
    custom_rtmps_enabled = Column(Boolean, default=False)
    analytics_enabled = Column(Boolean, default=False)
    team_collaboration_enabled = Column(Boolean, default=False)
    calendar_enabled = Column(Boolean, default=False)
    branding_enabled = Column(Boolean, default=False)
    automation_enabled = Column(Boolean, default=False)
    priority_support_level = Column(Text)
    dedicated_manager = Column(Boolean, default=False)
    allowed_video_codecs = Column(ARRAY(Text))
    log_retention_days = Column(Integer, default=7)
    min_video_bitrate_mbps = Column(Integer)
    max_resolution_height = Column(Integer)
    max_fps = Column(Integer)
    max_video_bitrate_mbps = Column(Integer)
    enforce_stream_quality = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


# ==================================================
# ASSETS
# ==================================================

class Asset(Base):
    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    # File info
    filename = Column(Text, nullable=False)
    storage_path = Column(Text, nullable=False, unique=True)
    size_bytes = Column(BigInteger, nullable=False)
    duration_seconds = Column(Float)

    # Video metadata
    meta = Column(JSONB)  # ffprobe output
    asset_type = Column(Text, nullable=False, default='video', index=True)
    video_codec = Column(Text)
    audio_codec = Column(Text)
    resolution = Column(Text)
    bitrate = Column(Integer)
    fps = Column(Integer)
    codec_info = Column(JSONB)

    # Validation
    compatible_for_copy = Column(Boolean, default=False, index=True)
    validation_errors = Column(ARRAY(Text))
    validation_status = Column(Text, default='pending', index=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    playlist_items = relationship("PlaylistItem", back_populates="asset", cascade="all, delete-orphan")
    folder_links = relationship("AssetFolderLink", back_populates="asset", cascade="all, delete-orphan")
    collection_items = relationship("CollectionItem", back_populates="asset", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("asset_type IN ('video', 'audio')", name='check_asset_type'),
    )


# ==================================================
# PLAYLISTS
# ==================================================

class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    name = Column(Text, nullable=False)
    description = Column(Text)
    loop = Column(Boolean, default=True)
    
    # Statistics (auto-calculated by triggers)
    total_duration_seconds = Column(Float, default=0)
    total_assets = Column(Integer, default=0)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    items = relationship("PlaylistItem", back_populates="playlist", cascade="all, delete-orphan", order_by="PlaylistItem.position")
    streams = relationship("Stream", back_populates="playlist")


class PlaylistItem(Base):
    __tablename__ = "playlist_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    playlist_id = Column(UUID(as_uuid=True), ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    playlist = relationship("Playlist", back_populates="items")
    asset = relationship("Asset", back_populates="playlist_items")

    __table_args__ = (
        CheckConstraint('position >= 0', name='check_position_positive'),
    )


# ==================================================
# DESTINATIONS
# ==================================================

class Destination(Base):
    __tablename__ = "destinations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    name = Column(Text, nullable=False)
    rtmps_url = Column(Text, nullable=False, default="rtmps://a.rtmp.youtube.com/live2")
    stream_key_encrypted = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, index=True)
    
    # Statistics (auto-updated by triggers)
    total_streams = Column(Integer, default=0)
    total_stream_hours = Column(Float, default=0)
    last_used_at = Column(TIMESTAMP(timezone=True), index=True)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    stream_destinations = relationship("StreamDestination", back_populates="destination", cascade="all, delete-orphan")


# ==================================================
# STREAMS
# ==================================================

class Stream(Base):
    __tablename__ = "streams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    playlist_id = Column(UUID(as_uuid=True), ForeignKey("playlists.id", ondelete="RESTRICT"), nullable=True)
    source_type = Column(Text, nullable=False, default="playlist")
    name = Column(Text)
    status = Column(Text, default="stopped", index=True)
    pid = Column(Integer)
    log_path = Column(Text)
    error_message = Column(Text)
    started_at = Column(TIMESTAMP(timezone=True), index=True)
    stopped_at = Column(TIMESTAMP(timezone=True))
    video_collection_id = Column(UUID(as_uuid=True), ForeignKey("media_collections.id", ondelete="SET NULL"))
    audio_collection_id = Column(UUID(as_uuid=True), ForeignKey("media_collections.id", ondelete="SET NULL"))
    mix_mode = Column(Text, nullable=False, default='video_only')
    settings_json = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    scheduled_start_enabled = Column(Boolean, nullable=False, server_default=text("false"))
    scheduled_start_time = Column(TIMESTAMP(timezone=True))
    scheduled_start_attempted_at = Column(TIMESTAMP(timezone=True))
    scheduled_stop_time = Column(TIMESTAMP(timezone=True))
    scheduled_stop_attempted_at = Column(TIMESTAMP(timezone=True))

    # Track total duration for billing
    total_duration_seconds = Column(Float, default=0)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    playlist = relationship("Playlist", back_populates="streams")
    stream_destinations = relationship("StreamDestination", back_populates="stream", cascade="all, delete-orphan")
    stream_assets = relationship("StreamAsset", back_populates="stream", cascade="all, delete-orphan", order_by="StreamAsset.position")
    events = relationship("StreamEvent", back_populates="stream", cascade="all, delete-orphan")
    video_collection = relationship("MediaCollection", foreign_keys=[video_collection_id])
    audio_collection = relationship("MediaCollection", foreign_keys=[audio_collection_id])

    __table_args__ = (
        CheckConstraint("status IN ('stopped', 'starting', 'running', 'error', 'stopping', 'scheduled')", name='check_status'),
        CheckConstraint("source_type IN ('playlist', 'assets')", name='check_source_type'),
        CheckConstraint("mix_mode IN ('video_only', 'audio_only', 'mixed')", name='check_stream_mix_mode'),
    )


class StreamDestination(Base):
    __tablename__ = "stream_destinations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id = Column(UUID(as_uuid=True), ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    destination_id = Column(UUID(as_uuid=True), ForeignKey("destinations.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    stream = relationship("Stream", back_populates="stream_destinations")
    destination = relationship("Destination", back_populates="stream_destinations")


class StreamAsset(Base):
    __tablename__ = "stream_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id = Column(UUID(as_uuid=True), ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    stream = relationship("Stream", back_populates="stream_assets")
    asset = relationship("Asset")

    __table_args__ = (
        CheckConstraint("position >= 0", name="check_stream_asset_position"),
    )


class StreamEvent(Base):
    __tablename__ = "stream_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id = Column(UUID(as_uuid=True), ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    level = Column(Text, nullable=False, index=True)
    message = Column(Text, nullable=False)
    event_metadata = Column("metadata", JSONB)  # 'metadata' reserved in SQLAlchemy, use event_metadata
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)

    # Relationships
    stream = relationship("Stream", back_populates="events")

    __table_args__ = (
        CheckConstraint("level IN ('info', 'warning', 'error', 'debug')", name='check_level'),
    )


# ==================================================
# MEDIA FOLDERS AND COLLECTIONS
# ==================================================


class MediaFolder(Base):
    __tablename__ = "media_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("media_folders.id", ondelete="CASCADE"))
    name = Column(Text, nullable=False)
    is_root = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    parent = relationship("MediaFolder", remote_side=[id], back_populates="children")
    children = relationship("MediaFolder", back_populates="parent", cascade="all, delete-orphan")
    asset_links = relationship("AssetFolderLink", back_populates="folder", cascade="all, delete-orphan")

    __table_args__ = (
        Index(
            "uq_media_folders_root_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_root"),
        ),
    )


class AssetFolderLink(Base):
    __tablename__ = "asset_folder_links"

    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("media_folders.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    asset = relationship("Asset", back_populates="folder_links")
    folder = relationship("MediaFolder", back_populates="asset_links")

    __table_args__ = (
        PrimaryKeyConstraint('asset_id', 'folder_id'),
    )


class MediaCollection(Base):
    __tablename__ = "media_collections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(Text, nullable=False)
    collection_type = Column(Text, nullable=False, default='video_background', index=True)
    description = Column(Text)
    origin_playlist_id = Column(UUID(as_uuid=True), ForeignKey("playlists.id", ondelete="SET NULL"), unique=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    items = relationship("CollectionItem", back_populates="collection", cascade="all, delete-orphan", order_by="CollectionItem.position")
    origin_playlist = relationship("Playlist")

    __table_args__ = (
        CheckConstraint("collection_type IN ('video_background', 'audio_playlist')", name='check_media_collection_type'),
    )


class CollectionItem(Base):
    __tablename__ = "collection_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id = Column(UUID(as_uuid=True), ForeignKey("media_collections.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0)
    loop_mode = Column(Text, nullable=False, default='loop')
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    collection = relationship("MediaCollection", back_populates="items")
    asset = relationship("Asset", back_populates="collection_items")

    __table_args__ = (
        CheckConstraint("position >= 0", name='check_collection_item_position'),
        CheckConstraint("loop_mode IN ('loop', 'once', 'shuffle')", name='check_collection_items_loop_mode'),
    )


# ==================================================
# ADMIN ACTIONS AND SYSTEM MONITORING
# ==================================================

class AdminAction(Base):
    __tablename__ = "admin_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    target_user_id = Column(UUID(as_uuid=True), index=True)
    
    action_type = Column(Text, nullable=False, index=True)
    details = Column(JSONB)
    reason = Column(Text)
    
    # Request info
    ip_address = Column(INET)
    user_agent = Column(Text)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)


class SystemAlert(Base):
    __tablename__ = "system_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    alert_type = Column(Text, nullable=False, index=True)
    severity = Column(Text, nullable=False, index=True)
    
    # Related entities
    user_id = Column(UUID(as_uuid=True), index=True)
    stream_id = Column(UUID(as_uuid=True), ForeignKey("streams.id", ondelete="CASCADE"), index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), index=True)
    
    message = Column(Text, nullable=False)
    details = Column(JSONB)
    
    # Resolution tracking
    resolved = Column(Boolean, default=False, index=True)
    resolved_at = Column(TIMESTAMP(timezone=True))
    resolved_by = Column(UUID(as_uuid=True))
    resolution_notes = Column(Text)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)


class UserActivityLog(Base):
    __tablename__ = "user_activity_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    activity_type = Column(Text, nullable=False, index=True)
    
    # Request info
    ip_address = Column(INET, index=True)
    user_agent = Column(Text)
    details = Column(JSONB)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)
