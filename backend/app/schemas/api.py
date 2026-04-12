from pydantic import BaseModel, Field, ConfigDict, model_validator, computed_field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, time, timezone
from uuid import UUID

from app.core.config import settings
from app.core.stream_schedule import (
    ensure_utc,
    normalize_schedule_repeat,
    normalize_schedule_timezone,
    normalize_schedule_weekdays,
)

ALLOWED_ASSET_TYPES = {"video", "audio"}
ProviderStatusValue = Literal["live", "offline", "unknown", "stale"]
ProviderHealthStatusValue = Literal["good", "ok", "bad", "noData"]
_PROVIDER_HEALTH_PRIORITY = {"bad": 3, "ok": 2, "good": 1, "noData": 0}


def _aggregate_provider_health_status(statuses: List[str]) -> Optional[str]:
    if not statuses:
        return None
    return max(
        statuses, key=lambda status: (_PROVIDER_HEALTH_PRIORITY.get(status, 2), status)
    )


def _runtime_restart_enabled() -> bool:
    return (
        bool(settings.stream_runtime_auto_restart_enabled)
        and max(int(settings.stream_runtime_restart_max_attempts), 0) > 0
    )


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
    kind: Literal["playlist", "collection", "stream"]
    status: Optional[str] = None
    context: Optional[str] = None


class AssetUsageSummary(BaseModel):
    playlists: List[AssetUsageReference] = Field(default_factory=list)
    collections: List[AssetUsageReference] = Field(default_factory=list)
    streams: List[AssetUsageReference] = Field(default_factory=list)


class AssetOptimizationInfo(BaseModel):
    status: Literal["not_requested", "queued", "processing", "ready", "failed"]
    strategy: Optional[Literal["copy", "transcode"]] = None
    optimized_storage_path: Optional[str] = None
    error: Optional[str] = None
    updated_at: Optional[datetime] = None
    recommended_strategy: Literal["copy", "transcode"]
    can_stream_from_source: bool


class AssetResponse(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    storage_path: str
    storage_backend: Literal["filesystem", "object_storage"] = "filesystem"
    storage_key: Optional[str] = None
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
    optimization: AssetOptimizationInfo


class AssetDownloadLinkResponse(BaseModel):
    download_url: str
    expires_at: datetime


class UploadTokenResponse(BaseModel):
    token: str
    expires_at: datetime


UploadIngestStatus = Literal["received", "validating", "finalized", "failed"]


class UploadIngestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    upload_id: str
    user_id: UUID
    asset_id: Optional[UUID] = None
    filename: Optional[str] = None
    status: UploadIngestStatus
    storage_backend: Literal["filesystem", "object_storage"] = "filesystem"
    storage_key: Optional[str] = None
    local_path: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    validation_errors: List[str] = Field(default_factory=list)
    warning_messages: List[str] = Field(default_factory=list)
    attempt_count: int = 0
    received_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


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
    provider_connection_id: Optional[UUID] = None


class DestinationCreate(DestinationBase):
    stream_key: str = Field(
        ..., min_length=1, description="YouTube stream key (will be encrypted)"
    )


class DestinationUpdate(BaseModel):
    name: Optional[str] = None
    rtmps_url: Optional[str] = None
    stream_key: Optional[str] = None
    enabled: Optional[bool] = None
    provider_connection_id: Optional[UUID] = None


class DestinationResponse(DestinationBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    provider_kind: Optional[Literal["youtube"]] = None
    provider_channel_id: Optional[str] = None
    provider_status: ProviderStatusValue = "unknown"
    provider_viewers: Optional[int] = None
    provider_last_checked_at: Optional[datetime] = None
    provider_video_id: Optional[str] = None
    provider_stream_status: Optional[str] = None
    provider_health_status: Optional[str] = None
    provider_health_issues: List[str] = Field(default_factory=list)
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
    schedule_repeat: Literal["none", "daily", "weekly"] = "none"
    schedule_timezone: Optional[str] = None
    schedule_weekdays: Optional[List[int]] = None
    schedule_window_end_time: Optional[time] = None
    schedule_stop_after_seconds: Optional[int] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_source(cls, model):
        playlist_id = model.playlist_id
        asset_ids = model.asset_ids

        collections_provided = bool(
            model.video_collection_id or model.audio_collection_id
        )

        if not any([playlist_id, asset_ids, collections_provided]):
            raise ValueError(
                "Provide playlist_id, asset_ids, or at least one media collection when creating a stream"
            )

        if playlist_id and asset_ids:
            raise ValueError("Choose only one source between playlist_id and asset_ids")

        if asset_ids is not None and len(asset_ids) == 0:
            raise ValueError("asset_ids must contain at least one asset")

        mode = (model.schedule_mode or "now").lower()
        if mode not in {"now", "schedule"}:
            raise ValueError("schedule_mode must be 'now' or 'schedule'")
        model.schedule_mode = mode
        model.schedule_repeat = normalize_schedule_repeat(model.schedule_repeat)
        model.schedule_timezone = normalize_schedule_timezone(model.schedule_timezone)
        model.schedule_weekdays = normalize_schedule_weekdays(model.schedule_weekdays)

        if model.schedule_mode == "schedule":
            if not model.schedule_start_at:
                raise ValueError(
                    "schedule_start_at is required when schedule_mode is 'schedule'"
                )
            start_at = ensure_utc(model.schedule_start_at)
            if start_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_start_at must be in the future")
            model.schedule_start_at = start_at
        else:
            model.schedule_start_at = None
            if model.schedule_repeat != "none":
                raise ValueError("schedule_repeat requires schedule_mode='schedule'")
            if model.schedule_weekdays:
                raise ValueError("schedule_weekdays requires schedule_repeat='weekly'")
            if model.schedule_window_end_time is not None:
                raise ValueError(
                    "schedule_window_end_time requires a repeating schedule"
                )
            if model.schedule_stop_after_seconds is not None:
                raise ValueError(
                    "schedule_stop_after_seconds requires schedule_mode='schedule'"
                )

        stop_at = model.schedule_stop_at
        if stop_at:
            stop_at = ensure_utc(stop_at)
            if stop_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_stop_at must be in the future")
            if model.schedule_start_at and stop_at <= model.schedule_start_at:
                raise ValueError("schedule_stop_at must be after schedule_start_at")
            model.schedule_stop_at = stop_at

        if model.schedule_repeat != "none":
            if model.schedule_stop_at:
                raise ValueError(
                    "schedule_stop_at is only supported for one-shot schedules"
                )
            if (
                model.schedule_repeat == "weekly"
                and model.schedule_weekdays is not None
                and len(model.schedule_weekdays) == 0
            ):
                raise ValueError("schedule_weekdays must not be empty when provided")
        elif model.schedule_weekdays:
            raise ValueError("schedule_weekdays requires schedule_repeat='weekly'")

        if (
            model.schedule_window_end_time is not None
            and model.schedule_repeat == "none"
        ):
            raise ValueError(
                "schedule_window_end_time requires schedule_repeat='daily' or 'weekly'"
            )

        if model.schedule_stop_at and model.schedule_stop_after_seconds is not None:
            raise ValueError(
                "schedule_stop_at and schedule_stop_after_seconds are mutually exclusive"
            )

        return model


class StreamScheduleUpdate(BaseModel):
    schedule_mode: Literal["now", "schedule"] = "now"
    schedule_start_at: Optional[datetime] = None
    name: Optional[str] = None
    destination_ids: Optional[List[UUID]] = None
    settings_json: Optional[dict] = None
    schedule_stop_at: Optional[datetime] = None
    schedule_repeat: Literal["none", "daily", "weekly"] = "none"
    schedule_timezone: Optional[str] = None
    schedule_weekdays: Optional[List[int]] = None
    schedule_window_end_time: Optional[time] = None
    schedule_stop_after_seconds: Optional[int] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_schedule(cls, model):
        mode = (model.schedule_mode or "now").lower()
        if mode not in {"now", "schedule"}:
            raise ValueError("schedule_mode must be 'now' or 'schedule'")
        model.schedule_mode = mode
        model.schedule_repeat = normalize_schedule_repeat(model.schedule_repeat)
        model.schedule_timezone = normalize_schedule_timezone(model.schedule_timezone)
        model.schedule_weekdays = normalize_schedule_weekdays(model.schedule_weekdays)

        if model.schedule_mode == "schedule":
            if not model.schedule_start_at:
                raise ValueError(
                    "schedule_start_at is required when schedule_mode is 'schedule'"
                )
            start_at = ensure_utc(model.schedule_start_at)
            if start_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_start_at must be in the future")
            model.schedule_start_at = start_at
        else:
            model.schedule_start_at = None
            if model.schedule_repeat != "none":
                raise ValueError("schedule_repeat requires schedule_mode='schedule'")
            if model.schedule_weekdays:
                raise ValueError("schedule_weekdays requires schedule_repeat='weekly'")
            if model.schedule_window_end_time is not None:
                raise ValueError(
                    "schedule_window_end_time requires a repeating schedule"
                )
            if model.schedule_stop_after_seconds is not None:
                raise ValueError(
                    "schedule_stop_after_seconds requires schedule_mode='schedule'"
                )

        stop_at = model.schedule_stop_at
        if stop_at:
            stop_at = ensure_utc(stop_at)
            if stop_at <= datetime.now(timezone.utc):
                raise ValueError("schedule_stop_at must be in the future")
            if model.schedule_start_at and stop_at <= model.schedule_start_at:
                raise ValueError("schedule_stop_at must be after schedule_start_at")
            model.schedule_stop_at = stop_at

        if model.schedule_repeat != "none":
            if model.schedule_stop_at:
                raise ValueError(
                    "schedule_stop_at is only supported for one-shot schedules"
                )
            if (
                model.schedule_repeat == "weekly"
                and model.schedule_weekdays is not None
                and len(model.schedule_weekdays) == 0
            ):
                raise ValueError("schedule_weekdays must not be empty when provided")
        elif model.schedule_weekdays:
            raise ValueError("schedule_weekdays requires schedule_repeat='weekly'")

        if (
            model.schedule_window_end_time is not None
            and model.schedule_repeat == "none"
        ):
            raise ValueError(
                "schedule_window_end_time requires schedule_repeat='daily' or 'weekly'"
            )

        if model.schedule_stop_at and model.schedule_stop_after_seconds is not None:
            raise ValueError(
                "schedule_stop_at and schedule_stop_after_seconds are mutually exclusive"
            )

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
    provider_connection_id: Optional[UUID] = None
    provider_kind: Optional[Literal["youtube"]] = None
    provider_channel_id: Optional[str] = None
    provider_status: ProviderStatusValue = "unknown"
    provider_viewers: Optional[int] = None
    provider_last_checked_at: Optional[datetime] = None
    provider_video_id: Optional[str] = None
    provider_stream_status: Optional[str] = None
    provider_health_status: Optional[str] = None
    provider_health_issues: List[str] = Field(default_factory=list)


class StreamDestinationLink(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    destination_id: UUID
    destination: Optional[DestinationSummary] = None


StreamRuntimeRestartState = Literal[
    "disabled", "idle", "scheduled", "retrying", "exhausted"
]
StreamIncidentSeverity = Literal["healthy", "degraded", "critical"]
StreamIncidentCode = Literal[
    "stream_error",
    "quota_limit",
    "provider_health",
    "runtime_restart",
    "transport_connection_reset",
    "transport_broken_pipe",
    "transport_recovery",
    "timeline_drift",
]


def _stream_runtime_restart_state(
    *,
    status: str,
    attempts: int,
    next_restart_at: Optional[datetime],
) -> StreamRuntimeRestartState:
    enabled = _runtime_restart_enabled()
    if not enabled:
        return "disabled"
    if next_restart_at is not None:
        return "scheduled"
    if status in {"starting", "running"} and attempts > 0:
        return "retrying"
    max_attempts = max(int(settings.stream_runtime_restart_max_attempts), 0)
    if (
        status == "error"
        and attempts > 0
        and (max_attempts == 0 or attempts >= max_attempts)
    ):
        return "exhausted"
    return "idle"


class StreamRuntimeRestartInfo(BaseModel):
    enabled: bool
    state: StreamRuntimeRestartState
    attempts: int
    max_attempts: int
    next_restart_at: Optional[datetime] = None
    last_restart_at: Optional[datetime] = None
    last_failure_at: Optional[datetime] = None


def build_stream_runtime_restart_info(
    *,
    status: str,
    attempts: int,
    next_restart_at: Optional[datetime],
    last_restart_at: Optional[datetime] = None,
    last_failure_at: Optional[datetime] = None,
) -> StreamRuntimeRestartInfo:
    normalized_attempts = max(int(attempts or 0), 0)
    normalized_max_attempts = max(int(settings.stream_runtime_restart_max_attempts), 0)
    enabled = _runtime_restart_enabled()

    return StreamRuntimeRestartInfo(
        enabled=enabled,
        state=_stream_runtime_restart_state(
            status=status,
            attempts=normalized_attempts,
            next_restart_at=next_restart_at,
        ),
        attempts=normalized_attempts,
        max_attempts=normalized_max_attempts,
        next_restart_at=next_restart_at,
        last_restart_at=last_restart_at,
        last_failure_at=last_failure_at,
    )


class StreamIncidentItem(BaseModel):
    code: StreamIncidentCode
    severity: Literal["degraded", "critical"]
    label: str
    detail: Optional[str] = None
    count: Optional[int] = None


class StreamIncidentSummary(BaseModel):
    severity: StreamIncidentSeverity = "healthy"
    headline: Optional[str] = None
    details: List[str] = Field(default_factory=list)
    items: List[StreamIncidentItem] = Field(default_factory=list)


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
    stream_assets: List["StreamAssetLink"] = []
    stream_destinations: List["StreamDestinationLink"] = Field(
        default_factory=list, exclude=True
    )
    scheduled_start_enabled: bool = False
    scheduled_start_time: Optional[datetime] = None
    schedule_timezone: Optional[str] = None
    schedule_repeat: Literal["none", "daily", "weekly"] = "none"
    schedule_weekdays: Optional[List[int]] = None
    schedule_window_end_time: Optional[time] = None
    schedule_stop_after_seconds: Optional[int] = None
    scheduled_stop_time: Optional[datetime] = None
    runtime_restart_attempts: int = Field(default=0, exclude=True)
    runtime_next_restart_at: Optional[datetime] = Field(default=None, exclude=True)
    runtime_last_restart_at: Optional[datetime] = Field(default=None, exclude=True)
    runtime_last_failure_at: Optional[datetime] = Field(default=None, exclude=True)

    @computed_field  # type: ignore[misc]
    @property
    def runtime_incident_summary(self) -> StreamIncidentSummary:
        payload = getattr(self, "_runtime_incident_summary", None)
        if isinstance(payload, StreamIncidentSummary):
            return payload
        if isinstance(payload, dict):
            return StreamIncidentSummary.model_validate(payload)
        return StreamIncidentSummary()

    @staticmethod
    def _destination_summary_from_link(
        link: "StreamDestinationLink",
    ) -> Optional[DestinationSummary]:
        destination = link.destination
        if not destination:
            return None
        return DestinationSummary(
            id=destination.id,
            name=destination.name,
            rtmps_url=destination.rtmps_url,
            enabled=destination.enabled,
            provider_connection_id=getattr(destination, "provider_connection_id", None),
            provider_kind=getattr(destination, "provider_kind", None),
            provider_channel_id=getattr(destination, "provider_channel_id", None),
            provider_status=getattr(destination, "_provider_status", "unknown"),
            provider_viewers=getattr(destination, "_provider_viewers", None),
            provider_last_checked_at=getattr(
                destination, "_provider_last_checked_at", None
            ),
            provider_video_id=getattr(destination, "_provider_video_id", None),
            provider_stream_status=getattr(
                destination, "_provider_stream_status", None
            ),
            provider_health_status=getattr(
                destination, "_provider_health_status", None
            ),
            provider_health_issues=list(
                getattr(destination, "_provider_health_issues", None) or []
            ),
        )

    @computed_field  # type: ignore[misc]
    @property
    def destinations(self) -> List[DestinationSummary]:
        summaries: List[DestinationSummary] = []
        for link in self.stream_destinations:
            destination = self._destination_summary_from_link(link)
            if destination:
                summaries.append(destination)
        return summaries

    @computed_field  # type: ignore[misc]
    @property
    def provider_status(self) -> ProviderStatusValue:
        connected = [
            destination
            for destination in self.destinations
            if destination.provider_connection_id
        ]
        if not connected:
            return "unknown"
        statuses = {destination.provider_status for destination in connected}
        if "live" in statuses:
            return "live"
        if "stale" in statuses:
            return "stale"
        if statuses == {"offline"}:
            return "offline"
        return "unknown"

    @computed_field  # type: ignore[misc]
    @property
    def provider_viewers(self) -> Optional[int]:
        viewers = {
            (str(destination.provider_connection_id), destination.provider_viewers)
            for destination in self.destinations
            if destination.provider_connection_id
            and destination.provider_viewers is not None
        }
        total = sum(viewer for _, viewer in viewers)
        return total if viewers else None

    @computed_field  # type: ignore[misc]
    @property
    def provider_last_checked_at(self) -> Optional[datetime]:
        timestamps = [
            destination.provider_last_checked_at
            for destination in self.destinations
            if destination.provider_last_checked_at is not None
        ]
        return max(timestamps) if timestamps else None

    @computed_field  # type: ignore[misc]
    @property
    def provider_video_id(self) -> Optional[str]:
        video_ids = {
            destination.provider_video_id
            for destination in self.destinations
            if destination.provider_video_id
        }
        if len(video_ids) == 1:
            return next(iter(video_ids))
        return None

    @computed_field  # type: ignore[misc]
    @property
    def provider_stream_status(self) -> Optional[str]:
        stream_statuses = {
            destination.provider_stream_status
            for destination in self.destinations
            if destination.provider_stream_status
        }
        if len(stream_statuses) == 1:
            return next(iter(stream_statuses))
        return None

    @computed_field  # type: ignore[misc]
    @property
    def provider_health_status(self) -> Optional[str]:
        statuses = [
            destination.provider_health_status
            for destination in self.destinations
            if destination.provider_health_status
        ]
        return _aggregate_provider_health_status(statuses)

    @computed_field  # type: ignore[misc]
    @property
    def provider_health_issues(self) -> List[str]:
        issues = {
            issue
            for destination in self.destinations
            for issue in destination.provider_health_issues
            if issue
        }
        return sorted(issues)

    @computed_field  # type: ignore[misc]
    @property
    def provider_mismatch(self) -> bool:
        if self.provider_status == "unknown":
            return False
        runtime_running = self.status == "running"
        provider_live = self.provider_status == "live"
        return runtime_running != provider_live

    @computed_field  # type: ignore[misc]
    @property
    def runtime_restart(self) -> StreamRuntimeRestartInfo:
        return build_stream_runtime_restart_info(
            status=self.status,
            attempts=int(self.runtime_restart_attempts or 0),
            next_restart_at=self.runtime_next_restart_at,
            last_restart_at=self.runtime_last_restart_at,
            last_failure_at=self.runtime_last_failure_at,
        )


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
    provider_status: ProviderStatusValue = "unknown"
    provider_viewers: Optional[int] = None
    provider_last_checked_at: Optional[datetime] = None
    provider_video_id: Optional[str] = None
    provider_stream_status: Optional[str] = None
    provider_health_status: Optional[str] = None
    provider_health_issues: List[str] = Field(default_factory=list)
    provider_mismatch: bool = False
    runtime_restart: StreamRuntimeRestartInfo
    runtime_incident_summary: StreamIncidentSummary = Field(
        default_factory=StreamIncidentSummary
    )


class StreamWsTokenResponse(BaseModel):
    token: str
    expires_at: int


class YoutubeConnectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    youtube_channel_id: str
    youtube_channel_title: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None
    provider_status: ProviderStatusValue = "unknown"
    provider_viewers: Optional[int] = None
    provider_last_checked_at: Optional[datetime] = None
    provider_video_id: Optional[str] = None
    provider_stream_status: Optional[str] = None
    provider_health_status: Optional[str] = None
    provider_health_issues: List[str] = Field(default_factory=list)


class YoutubeOAuthStartResponse(BaseModel):
    auth_url: str


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
    lines: int = Field(
        default=100,
        ge=1,
        le=10000,
        description="Number of log lines to fetch (1-10000)",
    )


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
    asset: Optional["AssetResponse"] = None


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
