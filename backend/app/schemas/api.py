from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional, List, Dict, Literal, Any
from datetime import datetime
from uuid import UUID


# Asset schemas
class AssetBase(BaseModel):
    filename: str
    asset_type: Literal["video", "audio"] = "video"


class AssetCreate(AssetBase):
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float] = None
    meta: Optional[dict] = None
    compatible_for_copy: bool = False
    validation_errors: Optional[List[str]] = None
    codec_info: Optional[dict] = None
    folder_ids: Optional[List[UUID]] = None
    tag_ids: Optional[List[UUID]] = None


class AssetUpdate(BaseModel):
    filename: Optional[str] = None
    asset_type: Optional[Literal["video", "audio"]] = None
    folder_ids: Optional[List[UUID]] = None
    tag_ids: Optional[List[UUID]] = None


class AssetResponse(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    storage_path: str
    size_bytes: int
    duration_seconds: Optional[float]
    meta: Optional[dict]
    compatible_for_copy: bool
    validation_errors: Optional[List[str]]
    codec_info: Optional[dict]
    folder_ids: List[UUID] = Field(default_factory=list)
    tag_ids: List[UUID] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AssetDownloadLinkResponse(BaseModel):
    download_url: str
    expires_at: datetime


# Media library schemas
class MediaFolderBase(BaseModel):
    name: str
    parent_id: Optional[UUID] = None
    is_tag: bool = False


class MediaFolderCreate(MediaFolderBase):
    pass


class MediaFolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[UUID] = None


class MediaFolderResponse(MediaFolderBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    asset_count: int = 0
    total_size_bytes: int = 0
    children_count: int = 0


class MediaUsageResponse(BaseModel):
    user_id: UUID
    total_size_bytes: int
    asset_count: int


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


# Media collection schemas
class CollectionAssetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    asset_type: Literal["video", "audio"]
    duration_seconds: Optional[float] = None


class CollectionItemBase(BaseModel):
    asset_id: UUID
    position: int
    loop_mode: Literal["inherit", "loop", "once"] = "inherit"


class CollectionItemCreate(CollectionItemBase):
    pass


class CollectionItemResponse(CollectionItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    collection_id: UUID
    created_at: datetime
    updated_at: datetime
    asset: Optional[CollectionAssetSummary] = None


class MediaCollectionCreate(BaseModel):
    name: str
    collection_type: Literal["video_background", "audio_playlist"]
    description: Optional[str] = None
    loop_enabled: bool = True
    shuffle_enabled: bool = False
    items: List[CollectionItemCreate] = []


class MediaCollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loop_enabled: Optional[bool] = None
    shuffle_enabled: Optional[bool] = None
    items: Optional[List[CollectionItemCreate]] = None


class MediaCollectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    collection_type: Literal["video_background", "audio_playlist"]
    loop_enabled: bool
    shuffle_enabled: bool
    created_at: datetime
    updated_at: datetime
    items: List[CollectionItemResponse] = Field(default_factory=list)


class CollectionReorderRequest(BaseModel):
    order: List[UUID]


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
    video_collection_id: Optional[UUID] = None
    audio_collection_id: Optional[UUID] = None
    mix_mode: Optional[Literal["video_only", "audio_only", "mixed"]] = "video_only"
    settings: Optional[Dict[str, Any]] = None
    destination_ids: List[UUID]

    @model_validator(mode="after")
    def validate_source(cls, model):
        playlist_id = model.playlist_id
        asset_ids = model.asset_ids
        has_collection = bool(model.video_collection_id or model.audio_collection_id)

        provided_sources = [bool(playlist_id), bool(asset_ids), has_collection]
        if sum(provided_sources) != 1:
            raise ValueError(
                "Provide exactly one source type: playlist_id, asset_ids, or media collections",
            )

        if asset_ids is not None and len(asset_ids) == 0:
            raise ValueError("asset_ids must contain at least one asset")

        if has_collection:
            if not model.video_collection_id and not model.audio_collection_id:
                raise ValueError("At least one collection must be provided")
            if model.mix_mode not in {"video_only", "audio_only", "mixed"}:
                raise ValueError("mix_mode must be video_only, audio_only, or mixed")
            if model.mix_mode == "video_only" and not model.video_collection_id:
                raise ValueError("video_collection_id is required for video_only mix mode")
            if model.mix_mode == "audio_only" and not model.audio_collection_id:
                raise ValueError("audio_collection_id is required for audio_only mix mode")
            if model.mix_mode == "mixed" and not (model.video_collection_id and model.audio_collection_id):
                raise ValueError("Both video and audio collections are required for mixed mode")

        return model


class StreamUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    video_collection_id: Optional[UUID] = None
    audio_collection_id: Optional[UUID] = None
    mix_mode: Optional[Literal["video_only", "audio_only", "mixed"]] = None
    settings: Optional[Dict[str, Any]] = None


class StreamResponse(StreamBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    playlist_id: Optional[UUID]
    video_collection_id: Optional[UUID]
    audio_collection_id: Optional[UUID]
    source_type: str
    mix_mode: str
    status: str
    pid: Optional[int]
    log_path: Optional[str]
    error_message: Optional[str]
    started_at: Optional[datetime]
    stopped_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    settings_json: Optional[Dict[str, Any]] = None
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


class StreamDestinationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    rtmps_url: str
    enabled: bool


class StreamCollectionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    collection_type: Literal["video_background", "audio_playlist"]
    loop_enabled: bool
    shuffle_enabled: bool
    items: List[CollectionItemResponse] = Field(default_factory=list)


class StreamConfigurationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: Optional[str]
    status: str
    mix_mode: str
    created_at: datetime
    updated_at: datetime
    video_collection: Optional[StreamCollectionSummary] = None
    audio_collection: Optional[StreamCollectionSummary] = None
    settings: Dict[str, Any] = Field(default_factory=dict)
    destinations: List[StreamDestinationSummary] = Field(default_factory=list)


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
