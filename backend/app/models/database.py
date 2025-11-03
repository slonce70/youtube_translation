from sqlalchemy import Column, String, Integer, BigInteger, Float, Boolean, Text, ForeignKey, ARRAY, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

Base = declarative_base()


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    assets = relationship("Asset", back_populates="project", cascade="all, delete-orphan")
    playlists = relationship("Playlist", back_populates="project", cascade="all, delete-orphan")
    destinations = relationship("Destination", back_populates="project", cascade="all, delete-orphan")
    streams = relationship("Stream", back_populates="project", cascade="all, delete-orphan")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(Text, nullable=False)
    storage_path = Column(Text, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    duration_seconds = Column(Float)
    meta = Column(JSONB)  # ffprobe output
    compatible_for_copy = Column(Boolean, default=False, index=True)
    validation_errors = Column(ARRAY(Text))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="assets")
    playlist_items = relationship("PlaylistItem", back_populates="asset", cascade="all, delete-orphan")


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text)
    loop = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="playlists")
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


class Destination(Base):
    __tablename__ = "destinations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    rtmps_url = Column(Text, nullable=False, default="rtmps://a.rtmp.youtube.com/live2")
    stream_key_encrypted = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="destinations")
    stream_destinations = relationship("StreamDestination", back_populates="destination", cascade="all, delete-orphan")


class Stream(Base):
    __tablename__ = "streams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    playlist_id = Column(UUID(as_uuid=True), ForeignKey("playlists.id", ondelete="RESTRICT"), nullable=False)
    name = Column(Text)
    status = Column(Text, default="stopped", index=True)
    pid = Column(Integer)
    log_path = Column(Text)
    error_message = Column(Text)
    started_at = Column(TIMESTAMP(timezone=True), index=True)
    stopped_at = Column(TIMESTAMP(timezone=True))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="streams")
    playlist = relationship("Playlist", back_populates="streams")
    stream_destinations = relationship("StreamDestination", back_populates="stream", cascade="all, delete-orphan")
    events = relationship("StreamEvent", back_populates="stream", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("status IN ('stopped', 'starting', 'running', 'error', 'stopping')", name='check_status'),
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


class StreamEvent(Base):
    __tablename__ = "stream_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id = Column(UUID(as_uuid=True), ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    level = Column(Text, nullable=False, index=True)
    message = Column(Text, nullable=False)
    metadata = Column(JSONB)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)

    # Relationships
    stream = relationship("Stream", back_populates="events")

    __table_args__ = (
        CheckConstraint("level IN ('info', 'warning', 'error', 'debug')", name='check_level'),
    )
