from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from uuid import UUID

ALLOWED_ASSET_TYPES = {"video", "audio"}

# Asset schemas
class AssetBase(BaseModel):
    filename: str


class AssetCreate(AssetBase):
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float] = None
    meta: Optional[dict] = None
    compatible_for_copy: bool = False
    validation_errors: Optional[List[str]] = None
    asset_type: str = "video"
    codec_info: Optional[dict] = None

    @model_validator(mode="before")
    @classmethod
    def validate_asset_type(cls, data: Any) -> Any:
        values: Dict[str, Any]
        if isinstance(data, dict):
            values = data
        else:
            return data

        candidate = (values.get("asset_type") or "video").lower()
        if candidate not in ALLOWED_ASSET_TYPES:
            raise ValueError("asset_type must be 'video' or 'audio'")
        values["asset_type"] = candidate
        return values


class AssetUpdate(BaseModel):
    filename: Optional[str] = None


class AssetFolderInfo(BaseModel):
    folder_id: UUID
    name: str
    is_root: bool


class AssetUsageReference(BaseModel):
    id: UUID
    name: str
    kind: Literal['playlist', 'collection', 'stream']
    status: Optional[str] = None
    context: Optional[str] = None


class AssetUsageSummary(BaseModel):
    playlists: List[AssetUsageReference] = Field(default_factory=list)
    collections: List[AssetUsageReference] = Field(default_factory=list)
    streams: List[AssetUsageReference] = Field(default_factory=list)


class AssetResponse(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float]
    meta: Optional[dict]
    asset_type: str
    compatible_for_copy: bool
    validation_errors: Optional[List[str]]
    codec_info: Optional[dict]
    created_at: datetime
    updated_at: datetime
    primary_folder_id: Optional[UUID] = None
    folders: List[AssetFolderInfo] = Field(default_factory=list)
    usage: AssetUsageSummary = Field(default_factory=AssetUsageSummary)
    thumbnail_url: Optional[str] = None


class AssetDownloadLinkResponse(BaseModel):
    download_url: str
    expires_at: datetime


# Media folder schemas
class MediaFolderBase(BaseModel):
    name: str
    parent_id: Optional[UUID] = None


class MediaFolderCreate(MediaFolderBase):
    pass


class MediaFolderResponse(MediaFolderBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    is_root: bool
    created_at: datetime
    updated_at: datetime


class AssetFolderLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    asset_id: UUID
    folder_id: UUID
    created_at: datetime


class MediaFolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[UUID] = None


class MediaFolderBulkAssetRequest(BaseModel):
    asset_ids: List[UUID]
    exclusive: bool = True


class MediaFolderBulkAssetResponse(BaseModel):
    updated_assets: int


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
    items: List[PlaylistItemCreate] = []


class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loop: Optional[bool] = None


class PlaylistResponse(PlaylistBase):
    model_config = ConfigDict(from_attributes=True)
    
    user_id: UUID
    id: UUID
    created_at: datetime
    updated_at: datetime
    items: List[PlaylistItemResponse] = []


# Destination schemas
class DestinationBase(BaseModel):
    name: str
    rtmps_url: str = "rtmps://a.rtmp.youtube.com/live2"
    enabled: bool = True


class DestinationCreate(DestinationBase):
    stream_key: str = Field(..., min_length=1, description="YouTube stream key (will be encrypted)")


class DestinationUpdate(BaseModel):
    name: Optional[str] = None
    rtmps_url: Optional[str] = None
    stream_key: Optional[str] = None
    enabled: Optional[bool] = None


class DestinationResponse(DestinationBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    stream_key_masked: str = Field(default="****")  # Never expose real key
    created_at: datetime
    updated_at: datetime


# Stream schemas
class StreamBase(BaseModel):
    name: Optional[str] = None


class StreamCreate(StreamBase):
    playlist_id: Optional[UUID] = None
    asset_ids: Optional[List[UUID]] = None
    destination_ids: List[UUID]
    video_collection_id: Optional[UUID] = None
    audio_collection_id: Optional[UUID] = None
    mix_mode: Optional[str] = None
    settings_json: Optional[dict] = None

    @model_validator(mode="after")
    def validate_source(cls, model):
        playlist_id = model.playlist_id
        asset_ids = model.asset_ids

        collections_provided = bool(model.video_collection_id or model.audio_collection_id)

        if not any([playlist_id, asset_ids, collections_provided]):
            raise ValueError("Provide playlist_id, asset_ids, or at least one media collection when creating a stream")

        if playlist_id and asset_ids:
            raise ValueError("Choose only one source between playlist_id and asset_ids")

        if asset_ids is not None and len(asset_ids) == 0:
            raise ValueError("asset_ids must contain at least one asset")

        return model


class StreamUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    video_collection_id: Optional[UUID] = None
    audio_collection_id: Optional[UUID] = None
    mix_mode: Optional[str] = None
    settings_json: Optional[dict] = None


class StreamResponse(StreamBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    playlist_id: Optional[UUID]
    source_type: str
    status: str
    pid: Optional[int]
    log_path: Optional[str]
    error_message: Optional[str]
    started_at: Optional[datetime]
    stopped_at: Optional[datetime]
    video_collection_id: Optional[UUID]
    audio_collection_id: Optional[UUID]
    mix_mode: str
    settings_json: dict
    created_at: datetime
    updated_at: datetime
    stream_assets: List['StreamAssetLink'] = []


class StreamStatus(BaseModel):
    id: UUID
    status: str
    uptime_seconds: Optional[int] = 0
    is_running: bool
    error_message: Optional[str] = None


class StreamAssetLink(BaseModel):
    asset_id: UUID
    position: int


StreamResponse.model_rebuild()


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


# Stream logs schemas
class StreamLogsRequest(BaseModel):
    lines: int = Field(default=100, ge=1, le=10000, description="Number of log lines to fetch (1-10000)")


class StreamLogsResponse(BaseModel):
    stream_id: UUID
    logs: List[str]
    total_lines: int


class StreamQualityViolation(BaseModel):
    code: str
    message: str
    asset_id: Optional[UUID] = None
    filename: Optional[str] = None
    position: int
    current: Optional[str] = None
    allowed: Optional[str] = None


class StreamQualityLimits(BaseModel):
    min_video_bitrate_mbps: Optional[int] = None
    max_resolution_height: Optional[int] = None
    max_fps: Optional[int] = None
    max_video_bitrate_mbps: Optional[int] = None
    enforce_stream_quality: bool = True


class StreamQualityRecommendation(BaseModel):
    resolution: Optional[str] = None
    fps: Optional[int] = None
    min_bitrate_mbps: Optional[float] = None
    max_bitrate_mbps: Optional[float] = None
    target_bitrate_mbps: Optional[float] = None


class StreamQualityResponse(BaseModel):
    ok: bool
    tier: str
    limits: StreamQualityLimits
    violations: List[StreamQualityViolation]
    recommended: Optional[StreamQualityRecommendation] = None


# Pagination
class PaginatedResponse(BaseModel):
    items: List[dict]
    total: int
    page: int
    page_size: int
    total_pages: int


# Media collection schemas
class CollectionItemBase(BaseModel):
    asset_id: UUID
    position: int = 0
    loop_mode: str = "loop"


class CollectionItemCreate(CollectionItemBase):
    pass


class CollectionItemResponse(CollectionItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    collection_id: UUID
    created_at: datetime
    updated_at: datetime


class MediaCollectionBase(BaseModel):
    name: str
    collection_type: str = "video_background"
    description: Optional[str] = None
    is_active: bool = True


class MediaCollectionCreate(MediaCollectionBase):
    items: List[CollectionItemCreate] = []
    origin_playlist_id: Optional[UUID] = None


class MediaCollectionResponse(MediaCollectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    origin_playlist_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    items: List[CollectionItemResponse] = []


class MediaCollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class CollectionItemsUpdate(BaseModel):
    items: List[CollectionItemCreate] = []


class StreamLiveUpdateRequest(BaseModel):
    target: Literal["video", "audio"]
    items: List[CollectionItemCreate]
    restart: bool = True

    @model_validator(mode="after")
    def validate_items(self):
        if not self.items:
            raise ValueError("At least one collection item is required")
        return self
