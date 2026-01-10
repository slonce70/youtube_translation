from pydantic import BaseModel, Field, ConfigDict, model_validator, computed_field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, timezone
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


class UploadTokenResponse(BaseModel):
    token: str
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
    schedule_mode: Literal["now", "schedule"] = "now"
    schedule_start_at: Optional[datetime] = None
    schedule_stop_at: Optional[datetime] = None

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

        mode = (model.schedule_mode or "now").lower()
        if mode not in {"now", "schedule"}:
            raise ValueError("schedule_mode must be 'now' or 'schedule'")
        model.schedule_mode = mode

        if model.schedule_mode == "schedule":
            if not model.schedule_start_at:
                raise ValueError("schedule_start_at is required when schedule_mode is 'schedule'")
            start_at = model.schedule_start_at
            if start_at.tzinfo is None:
                start_at = start_at.replace(tzinfo=timezone.utc)
            else:
                start_at = start_at.astimezone(timezone.utc)
            if start_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_start_at must be in the future")
            model.schedule_start_at = start_at
        else:
            model.schedule_start_at = None

        stop_at = model.schedule_stop_at
        if stop_at:
            if stop_at.tzinfo is None:
                stop_at = stop_at.replace(tzinfo=timezone.utc)
            else:
                stop_at = stop_at.astimezone(timezone.utc)
            if stop_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_stop_at must be in the future")
            if model.schedule_start_at and stop_at <= model.schedule_start_at:
                raise ValueError("schedule_stop_at must be after schedule_start_at")
            model.schedule_stop_at = stop_at

        return model


class StreamScheduleUpdate(BaseModel):
    schedule_mode: Literal["now", "schedule"] = "now"
    schedule_start_at: Optional[datetime] = None
    schedule_stop_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_schedule(cls, model):
        mode = (model.schedule_mode or "now").lower()
        if mode not in {"now", "schedule"}:
            raise ValueError("schedule_mode must be 'now' or 'schedule'")
        model.schedule_mode = mode

        if model.schedule_mode == "schedule":
            if not model.schedule_start_at:
                raise ValueError("schedule_start_at is required when schedule_mode is 'schedule'")
            start_at = model.schedule_start_at
            if start_at.tzinfo is None:
                start_at = start_at.replace(tzinfo=timezone.utc)
            else:
                start_at = start_at.astimezone(timezone.utc)
            if start_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_start_at must be in the future")
            model.schedule_start_at = start_at
        else:
            model.schedule_start_at = None

        stop_at = model.schedule_stop_at
        if stop_at:
            if stop_at.tzinfo is None:
                stop_at = stop_at.replace(tzinfo=timezone.utc)
            else:
                stop_at = stop_at.astimezone(timezone.utc)
            if stop_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_stop_at must be in the future")
            if model.schedule_start_at and stop_at <= model.schedule_start_at:
                raise ValueError("schedule_stop_at must be after schedule_start_at")
            model.schedule_stop_at = stop_at

        return model


class StreamUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    video_collection_id: Optional[UUID] = None
    audio_collection_id: Optional[UUID] = None
    mix_mode: Optional[str] = None
    settings_json: Optional[dict] = None


class DestinationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    rtmps_url: str
    enabled: bool


class StreamDestinationLink(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    destination_id: UUID
    destination: Optional[DestinationSummary] = None


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
    total_duration_seconds: Optional[float]
    created_at: datetime
    updated_at: datetime
    stream_assets: List['StreamAssetLink'] = []
    stream_destinations: List['StreamDestinationLink'] = Field(default_factory=list, exclude=True)
    scheduled_start_enabled: bool = False
    scheduled_start_time: Optional[datetime] = None
    scheduled_stop_time: Optional[datetime] = None

    @computed_field  # type: ignore[misc]
    @property
    def destinations(self) -> List[DestinationSummary]:
        summaries: List[DestinationSummary] = []
        for link in self.stream_destinations:
            destination = link.destination
            if destination:
                summaries.append(destination)
        return summaries


class StreamStatus(BaseModel):
    id: UUID
    status: str
    uptime_seconds: Optional[int] = 0
    is_running: bool
    error_message: Optional[str] = None
    live_duration_seconds: Optional[int] = None
    total_duration_seconds: Optional[int] = None
    daily_limit_seconds: Optional[int] = None
    remaining_daily_seconds: Optional[int] = None
    quota_limit_reached: Optional[bool] = None


class StreamWsTokenResponse(BaseModel):
    token: str
    expires_at: int


class StreamAssetLink(BaseModel):
    asset_id: UUID
    position: int


StreamResponse.model_rebuild()


class StreamQueueAppend(BaseModel):
    target: Literal["video", "audio"] = "video"
    asset_id: UUID
    loop_mode: Optional[str] = None


class StreamQueueResponse(BaseModel):
    success: bool = True


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


class StreamAudioQualityRecommendation(BaseModel):
    codec: Optional[str] = None
    sample_rate_hz: Optional[int] = None
    min_bitrate_kbps: Optional[int] = None
    target_bitrate_kbps: Optional[int] = None
    channels: Optional[int] = None


class StreamQualityResponse(BaseModel):
    ok: bool
    tier: str
    limits: StreamQualityLimits
    violations: List[StreamQualityViolation]
    recommended: Optional[StreamQualityRecommendation] = None
    mode: Literal["video", "audio", "mixed"] = "video"
    audio_recommended: Optional[StreamAudioQualityRecommendation] = None


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
    asset: Optional['AssetResponse'] = None


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
