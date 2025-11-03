from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID


# Base schemas
class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(ProjectBase):
    name: Optional[str] = None


class ProjectResponse(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime


# Asset schemas
class AssetBase(BaseModel):
    filename: str


class AssetCreate(AssetBase):
    project_id: UUID
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float] = None
    meta: Optional[dict] = None
    compatible_for_copy: bool = False
    validation_errors: Optional[List[str]] = None


class AssetResponse(AssetBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    project_id: UUID
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float]
    meta: Optional[dict]
    compatible_for_copy: bool
    validation_errors: Optional[List[str]]
    created_at: datetime
    updated_at: datetime


# Playlist schemas
class PlaylistItemCreate(BaseModel):
    asset_id: UUID
    position: int


class PlaylistItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    playlist_id: UUID
    asset_id: UUID
    position: int
    created_at: datetime


class PlaylistBase(BaseModel):
    name: str
    description: Optional[str] = None
    loop: bool = True


class PlaylistCreate(PlaylistBase):
    project_id: UUID
    items: List[PlaylistItemCreate] = []


class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loop: Optional[bool] = None


class PlaylistResponse(PlaylistBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime
    items: List[PlaylistItemResponse] = []


# Destination schemas
class DestinationBase(BaseModel):
    name: str
    rtmps_url: str = "rtmps://a.rtmp.youtube.com/live2"
    enabled: bool = True


class DestinationCreate(DestinationBase):
    project_id: UUID
    stream_key: str  # Will be encrypted before storage


class DestinationUpdate(BaseModel):
    name: Optional[str] = None
    rtmps_url: Optional[str] = None
    stream_key: Optional[str] = None
    enabled: Optional[bool] = None


class DestinationResponse(DestinationBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    project_id: UUID
    stream_key_masked: str = Field(default="****")  # Never expose real key
    created_at: datetime
    updated_at: datetime


# Stream schemas
class StreamBase(BaseModel):
    name: Optional[str] = None


class StreamCreate(StreamBase):
    project_id: UUID
    playlist_id: UUID
    destination_ids: List[UUID]


class StreamUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class StreamResponse(StreamBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    project_id: UUID
    playlist_id: UUID
    status: str
    pid: Optional[int]
    log_path: Optional[str]
    error_message: Optional[str]
    started_at: Optional[datetime]
    stopped_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class StreamStatus(BaseModel):
    id: UUID
    status: str
    uptime_seconds: Optional[int] = 0
    is_running: bool
    error_message: Optional[str] = None


# Stream event schemas
class StreamEventCreate(BaseModel):
    stream_id: UUID
    level: str  # info, warning, error, debug
    message: str
    metadata: Optional[dict] = None


class StreamEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    stream_id: UUID
    level: str
    message: str
    metadata: Optional[dict]
    created_at: datetime


# Pagination
class PaginatedResponse(BaseModel):
    items: List[dict]
    total: int
    page: int
    page_size: int
    total_pages: int
