"""Stream CRUD and configuration logic."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, TYPE_CHECKING
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.collections import (
    normalize_collection_items,
    replace_collection_items,
    validate_collection_assets,
)
from app.core.config import settings as default_settings
from app.core.stream_schedule import (
    compute_schedule_stop_time,
    normalize_schedule_repeat,
    resolve_schedule_timezone,
    resolve_weekly_weekdays,
)
from app.models.database import (
    Asset,
    CollectionItem,
    MediaCollection,
    Playlist,
    PlaylistItem,
    Stream,
    StreamAsset,
    StreamDestination,
    UserProfile,
)
from app.schemas.api import (
    StreamCreate,
    StreamLiveUpdateRequest,
    StreamQueueAppend,
    StreamScheduleUpdate,
)

from .helpers import (
    ALLOWED_MIX_MODES,
    build_asset_payload,
    fetch_destinations,
    get_collection_for_user,
    load_stream_with_relations,
)

if TYPE_CHECKING:  # pragma: no cover - for type hints only
    from .control import StreamControlService


logger = logging.getLogger(__name__)


class StreamService:
    """High-level stream operations that interact with the database."""

    def __init__(
        self, db: AsyncSession, user_id: UUID, *, settings_provider=default_settings
    ):
        self.db = db
        self.user_id = user_id
        self.settings = settings_provider

    async def list_streams(self) -> List[Stream]:
        # Optimization: Use lighter query options for listing.
        # We only need stream_assets (for ID/position) and not the full nested objects
        # like playlists, collections, or asset details which are not returned in the list view.
        query = (
            select(Stream)
            .where(Stream.user_id == self.user_id)
            .options(*_load_stream_list_options())
        )
        result = await self.db.execute(query)
        return result.scalars().all()

    async def create_stream(self, stream_data: StreamCreate) -> Stream:
        playlist = None
        selected_assets: List[Asset] = []
        video_collection = None
        audio_collection = None

        if stream_data.playlist_id:
            playlist = await self._get_playlist(stream_data.playlist_id)

        if stream_data.video_collection_id:
            video_collection = await get_collection_for_user(
                self.db,
                self.user_id,
                stream_data.video_collection_id,
                expected_type="video_background",
            )
            if not video_collection.items:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Video collection is empty",
                )

        if stream_data.audio_collection_id:
            audio_collection = await get_collection_for_user(
                self.db,
                self.user_id,
                stream_data.audio_collection_id,
                expected_type="audio_playlist",
            )
            if not audio_collection.items:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Audio collection is empty",
                )

        if playlist and (video_collection or audio_collection):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Choose playlist/assets or collections, not both",
            )

        if (video_collection or audio_collection) and stream_data.asset_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Asset IDs are not allowed when using collections",
            )

        if not playlist and not video_collection and not audio_collection:
            selected_assets = await self._get_assets(stream_data.asset_ids)

        mix_mode = self._determine_mix_mode(
            stream_data.mix_mode, video_collection, audio_collection
        )

        if mix_mode in {"video_only", "mixed"} and not (
            playlist or selected_assets or video_collection
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Video source is required for selected mix mode",
            )

        if mix_mode in {"audio_only", "mixed"} and not audio_collection:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio collection required for selected mix mode",
            )

        settings_json = stream_data.settings_json or {}
        if not isinstance(settings_json, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="settings_json must be an object",
            )

        source_type = "playlist" if playlist else "assets"
        schedule_config = await self._build_schedule_config(stream_data)
        initial_status = (
            "scheduled" if schedule_config["scheduled_start_enabled"] else "stopped"
        )

        stream = Stream(
            user_id=self.user_id,
            playlist_id=playlist.id if playlist else None,
            video_collection_id=video_collection.id if video_collection else None,
            audio_collection_id=audio_collection.id if audio_collection else None,
            mix_mode=mix_mode,
            settings_json=settings_json,
            source_type=source_type,
            name=stream_data.name,
            status=initial_status,
            scheduled_start_enabled=schedule_config["scheduled_start_enabled"],
            scheduled_start_time=schedule_config["scheduled_start_time"],
            schedule_timezone=schedule_config["schedule_timezone"],
            schedule_repeat=schedule_config["schedule_repeat"],
            schedule_weekdays=schedule_config["schedule_weekdays"],
            schedule_window_end_time=schedule_config["schedule_window_end_time"],
            schedule_stop_after_seconds=schedule_config["schedule_stop_after_seconds"],
            scheduled_stop_time=schedule_config["scheduled_stop_time"],
        )

        self.db.add(stream)
        await self.db.flush()

        if selected_assets:
            for position, asset in enumerate(selected_assets):
                self.db.add(
                    StreamAsset(
                        stream_id=stream.id, asset_id=asset.id, position=position
                    )
                )

        destinations = await fetch_destinations(
            self.db, self.user_id, stream_data.destination_ids
        )
        for dest in destinations:
            self.db.add(StreamDestination(stream_id=stream.id, destination_id=dest.id))

        await self.db.commit()

        loaded_stream = await load_stream_with_relations(
            self.db, self.user_id, stream.id
        )
        if not loaded_stream:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stream created but could not be loaded",
            )

        return loaded_stream

    async def get_stream(self, stream_id: UUID) -> Stream:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found",
            )
        return stream

    async def delete_stream(
        self,
        stream_id: UUID,
        control_service: Optional["StreamControlService"] = None,
    ) -> None:
        stream = await self._get_stream_basic(stream_id)
        control = control_service
        if control is None:
            from .control import StreamControlService  # local import to avoid cycle

            control = StreamControlService(self.db, self.user_id)

        await control.ensure_stopped(stream)

        stream_dir = Path(self.settings.stream_dir) / str(stream_id)
        if stream_dir.exists():
            import shutil

            shutil.rmtree(stream_dir)

        await self.db.execute(delete(Stream).where(Stream.id == stream_id))
        await self.db.commit()

    async def update_stream_schedule(
        self, stream_id: UUID, payload: StreamScheduleUpdate
    ) -> Stream:
        stream = await self._get_stream_basic(stream_id)
        schedule_mode = (payload.schedule_mode or "now").lower()
        schedule_config = await self._build_schedule_config(payload)

        if schedule_mode == "schedule":
            from .control import StreamControlService  # local import to avoid cycle

            runtime_status = await StreamControlService(
                self.db, self.user_id
            ).get_stream_status(stream_id)
            if runtime_status.is_running or runtime_status.status in {
                "running",
                "starting",
                "stopping",
            }:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot schedule start while stream is running",
                )

        if schedule_mode == "schedule":
            stream.scheduled_start_enabled = True
            stream.scheduled_start_time = schedule_config["scheduled_start_time"]
            stream.scheduled_start_attempted_at = None
            stream.schedule_timezone = schedule_config["schedule_timezone"]
            stream.schedule_repeat = schedule_config["schedule_repeat"]
            stream.schedule_weekdays = schedule_config["schedule_weekdays"]
            stream.schedule_window_end_time = schedule_config[
                "schedule_window_end_time"
            ]
            stream.schedule_stop_after_seconds = schedule_config[
                "schedule_stop_after_seconds"
            ]
            if stream.status in {"stopped", "error", "scheduled"}:
                stream.status = "scheduled"
        else:
            stream.scheduled_start_enabled = False
            stream.scheduled_start_time = None
            stream.scheduled_start_attempted_at = None
            stream.schedule_timezone = None
            stream.schedule_repeat = "none"
            stream.schedule_weekdays = None
            stream.schedule_window_end_time = None
            stream.schedule_stop_after_seconds = None
            if stream.status == "scheduled":
                stream.status = "stopped"

        if schedule_config["scheduled_stop_time"]:
            stream.scheduled_stop_time = schedule_config["scheduled_stop_time"]
            stream.scheduled_stop_attempted_at = None
        else:
            stream.scheduled_stop_time = None
            stream.scheduled_stop_attempted_at = None

        await self.db.commit()

        updated_stream = await load_stream_with_relations(
            self.db, self.user_id, stream.id
        )
        if not updated_stream:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stream updated but could not be loaded",
            )

        return updated_stream

    async def _build_schedule_config(
        self, payload: StreamCreate | StreamScheduleUpdate
    ) -> Dict[str, Any]:
        schedule_mode = (payload.schedule_mode or "now").lower()
        scheduled_start_enabled = schedule_mode == "schedule"
        schedule_repeat = normalize_schedule_repeat(
            getattr(payload, "schedule_repeat", "none")
        )
        explicit_timezone = getattr(payload, "schedule_timezone", None)
        user_timezone = (
            await self._get_user_timezone()
            if scheduled_start_enabled and schedule_repeat != "none"
            else None
        )
        schedule_timezone = (
            resolve_schedule_timezone(explicit_timezone, user_timezone)
            if scheduled_start_enabled
            and (schedule_repeat != "none" or explicit_timezone or user_timezone)
            else None
        )
        scheduled_start_time = (
            getattr(payload, "schedule_start_at", None)
            if scheduled_start_enabled
            else None
        )
        schedule_weekdays = (
            resolve_weekly_weekdays(
                scheduled_start_time,
                schedule_timezone,
                getattr(payload, "schedule_weekdays", None),
            )
            if scheduled_start_enabled
            and schedule_repeat == "weekly"
            and scheduled_start_time is not None
            else None
        )
        scheduled_stop_time = compute_schedule_stop_time(
            scheduled_start_time,
            explicit_stop_at=getattr(payload, "schedule_stop_at", None),
            schedule_timezone=schedule_timezone,
            repeat=schedule_repeat,
            window_end_time=getattr(payload, "schedule_window_end_time", None),
            stop_after_seconds=getattr(payload, "schedule_stop_after_seconds", None),
        )

        return {
            "scheduled_start_enabled": scheduled_start_enabled,
            "scheduled_start_time": scheduled_start_time,
            "schedule_timezone": schedule_timezone,
            "schedule_repeat": schedule_repeat if scheduled_start_enabled else "none",
            "schedule_weekdays": schedule_weekdays,
            "schedule_window_end_time": (
                getattr(payload, "schedule_window_end_time", None)
                if scheduled_start_enabled
                else None
            ),
            "schedule_stop_after_seconds": (
                getattr(payload, "schedule_stop_after_seconds", None)
                if scheduled_start_enabled
                else None
            ),
            "scheduled_stop_time": scheduled_stop_time,
        }

    async def _get_user_timezone(self) -> Optional[str]:
        result = await self.db.execute(
            select(UserProfile.timezone).where(UserProfile.user_id == self.user_id)
        )
        return result.scalar_one_or_none()

    async def live_update_stream(
        self,
        stream_id: UUID,
        update: StreamLiveUpdateRequest,
        control_service: Optional["StreamControlService"] = None,
    ) -> Stream:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found",
            )

        target_collection = (
            stream.video_collection
            if update.target == "video"
            else stream.audio_collection
        )
        if not target_collection:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stream does not have the requested collection",
            )

        normalized_items = normalize_collection_items(update.items)
        expected_type = "video" if update.target == "video" else "audio"
        await validate_collection_assets(
            self.db, self.user_id, normalized_items, expected_type
        )

        try:
            await replace_collection_items(self.db, target_collection, normalized_items)
            await self.db.flush()
        except Exception as exc:  # pragma: no cover - DB errors
            await self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update collection",
            ) from exc

        loop_enabled = True
        shuffle_enabled = False
        if normalized_items:
            loop_enabled = any(item.loop_mode != "once" for item in normalized_items)
            shuffle_enabled = any(
                item.loop_mode == "shuffle" for item in normalized_items
            )

        control = control_service
        if control is None:
            from .control import StreamControlService  # local import to avoid cycle

            control = StreamControlService(self.db, self.user_id)

        runtime_assets: List[Dict[str, Any]] = []
        wants_live_apply = not update.restart and stream.status == "running"
        should_hot_swap = wants_live_apply and control.supports_hot_swap()
        if should_hot_swap:
            items_with_assets = await self._fetch_collection_items_with_assets(
                target_collection.id
            )
            runtime_assets = [
                build_asset_payload(item.asset, item.loop_mode or "loop")
                for item in items_with_assets
                if item.asset is not None
            ]

            if not runtime_assets:
                await self.db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No assets available for live update",
                )

        if should_hot_swap:
            try:
                hot_swap_applied = await control.apply_live_collection_update(
                    stream,
                    update.target,
                    runtime_assets,
                    loop_enabled=loop_enabled,
                    shuffle_enabled=shuffle_enabled,
                )
            except HTTPException:
                await self.db.rollback()
                raise
            if not hot_swap_applied:
                logger.warning(
                    "Live update for stream %s could not use hot swap at runtime; falling back to restart",
                    stream_id,
                )

        should_restart = update.restart or (wants_live_apply and not should_hot_swap)
        if wants_live_apply and not should_hot_swap:
            logger.info(
                "Applying live update for stream %s via managed-runtime restart fallback",
                stream_id,
            )

        if should_restart:
            await control.restart_stream(stream_id, update.target)

        await self.db.commit()
        updated_stream = await load_stream_with_relations(
            self.db, self.user_id, stream_id
        )
        if not updated_stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found after update",
            )
        return updated_stream

    async def enqueue_stream_asset(
        self,
        stream_id: UUID,
        payload: StreamQueueAppend,
        control_service: Optional["StreamControlService"] = None,
    ) -> None:
        from app.models.database import CollectionItem, PlaylistItem, StreamAsset

        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found",
            )

        target = payload.target
        if target not in {"video", "audio"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target"
            )

        asset = await self._get_asset(payload.asset_id)
        expected_type = "video" if target == "video" else "audio"
        if asset.asset_type != expected_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Asset must be of type {expected_type}",
            )

        loop_mode = payload.loop_mode or "loop"
        asset_payload = build_asset_payload(asset, loop_mode=loop_mode)

        if target == "video" and stream.video_collection:
            next_position = (
                max(
                    (item.position for item in stream.video_collection.items),
                    default=-1,
                )
                + 1
            )
            self.db.add(
                CollectionItem(
                    collection_id=stream.video_collection.id,
                    asset_id=asset.id,
                    position=next_position,
                    loop_mode=loop_mode,
                )
            )
        elif target == "audio" and stream.audio_collection:
            next_position = (
                max(
                    (item.position for item in stream.audio_collection.items),
                    default=-1,
                )
                + 1
            )
            self.db.add(
                CollectionItem(
                    collection_id=stream.audio_collection.id,
                    asset_id=asset.id,
                    position=next_position,
                    loop_mode=loop_mode,
                )
            )
        elif stream.playlist and target == "video":
            next_position = (
                max((item.position for item in stream.playlist.items), default=-1) + 1
            )
            self.db.add(
                PlaylistItem(
                    playlist_id=stream.playlist.id,
                    asset_id=asset.id,
                    position=next_position,
                )
            )
        else:
            next_position = (
                max((link.position for link in stream.stream_assets), default=-1) + 1
            )
            self.db.add(
                StreamAsset(
                    stream_id=stream.id, asset_id=asset.id, position=next_position
                )
            )

        control = control_service
        if control is None:
            from .control import StreamControlService  # local import to avoid cycle

            control = StreamControlService(self.db, self.user_id)

        try:
            await control.enqueue_hot_swap(stream_id, target, asset_payload)
            await self.db.commit()
        except HTTPException:
            await self.db.rollback()
            raise
        except Exception as exc:  # pragma: no cover - defensive
            await self.db.rollback()
            logger.exception(
                "Failed to enqueue runtime update for stream %s", stream_id
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to enqueue stream update",
            ) from exc

    async def _fetch_collection_items_with_assets(
        self, collection_id: UUID
    ) -> List[CollectionItem]:
        query = (
            select(CollectionItem)
            .where(CollectionItem.collection_id == collection_id)
            .options(selectinload(CollectionItem.asset))
            .order_by(CollectionItem.position)
        )
        result = await self.db.execute(query)
        return result.scalars().all()

    async def _get_playlist(self, playlist_id: UUID) -> Playlist:
        query = select(Playlist).where(
            Playlist.id == playlist_id, Playlist.user_id == self.user_id
        )
        result = await self.db.execute(query)
        playlist = result.scalar_one_or_none()
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found",
            )
        return playlist

    async def _get_assets(self, asset_ids: Optional[Sequence[UUID]]) -> List[Asset]:
        asset_ids = asset_ids or []
        if not asset_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one asset must be selected",
            )

        assets_query = select(Asset).where(
            Asset.user_id == self.user_id, Asset.id.in_(asset_ids)
        )
        result = await self.db.execute(assets_query)
        fetched_assets = result.scalars().all()

        if len(fetched_assets) != len(set(asset_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more assets were not found",
            )

        asset_lookup = {str(asset.id): asset for asset in fetched_assets}
        ordered_assets: List[Asset] = []
        for asset_id in asset_ids:
            try:
                ordered_assets.append(asset_lookup[str(asset_id)])
            except KeyError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Asset selection contains duplicates or invalid IDs",
                ) from exc
        return ordered_assets

    async def _get_asset(self, asset_id: UUID) -> Asset:
        query = select(Asset).where(Asset.id == asset_id, Asset.user_id == self.user_id)
        result = await self.db.execute(query)
        asset = result.scalar_one_or_none()
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found",
            )
        return asset

    def _determine_mix_mode(
        self,
        requested: Optional[str],
        video_collection,
        audio_collection,
    ) -> str:
        mix_mode = requested
        if mix_mode is None:
            if video_collection and audio_collection:
                mix_mode = "mixed"
            elif video_collection:
                mix_mode = "video_only"
            elif audio_collection:
                mix_mode = "audio_only"
            else:
                mix_mode = "video_only"

        mix_mode = mix_mode.lower() if isinstance(mix_mode, str) else "video_only"
        if mix_mode not in ALLOWED_MIX_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid mix mode",
            )
        return mix_mode

    async def _get_stream_basic(self, stream_id: UUID) -> Stream:
        query = select(Stream).where(
            Stream.id == stream_id, Stream.user_id == self.user_id
        )
        result = await self.db.execute(query)
        stream = result.scalar_one_or_none()
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found",
            )
        return stream


def load_stream_with_relations_options():  # pragma: no cover - helper for readability
    from sqlalchemy.orm import selectinload

    return (
        selectinload(Stream.playlist)
        .selectinload(Playlist.items)
        .selectinload(PlaylistItem.asset),
        selectinload(Stream.stream_assets).selectinload(StreamAsset.asset),
        selectinload(Stream.stream_destinations).selectinload(
            StreamDestination.destination
        ),
        selectinload(Stream.video_collection)
        .selectinload(MediaCollection.items)
        .selectinload(CollectionItem.asset),
        selectinload(Stream.audio_collection)
        .selectinload(MediaCollection.items)
        .selectinload(CollectionItem.asset),
    )


def _load_stream_list_options():
    from sqlalchemy.orm import selectinload

    return (
        # stream_assets are needed for StreamResponse.stream_assets (List[StreamAssetLink])
        # which requires asset_id and position. These are on the StreamAsset table.
        selectinload(Stream.stream_assets),
        # stream_destinations are accessed to build StreamResponse.destinations
        selectinload(Stream.stream_destinations).selectinload(
            StreamDestination.destination
        ),
    )


__all__ = ["StreamService", "load_stream_with_relations_options"]
