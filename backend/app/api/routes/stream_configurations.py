from typing import List, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import require_user
from app.models.database import (
    CollectionItem,
    MediaCollection,
    Stream,
    StreamDestination,
)
from app.schemas.api import (
    CollectionAssetSummary,
    CollectionItemResponse,
    StreamConfigurationResponse,
    StreamCollectionSummary,
    StreamDestinationSummary,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _item_to_response(item: CollectionItem) -> CollectionItemResponse:
    asset_summary = None
    if item.asset:
        asset_summary = CollectionAssetSummary(
            id=item.asset.id,
            filename=item.asset.filename,
            asset_type=item.asset.asset_type,
            duration_seconds=item.asset.duration_seconds,
        )
    return CollectionItemResponse(
        id=item.id,
        collection_id=item.collection_id,
        asset_id=item.asset_id,
        position=item.position,
        loop_mode=item.loop_mode,
        created_at=item.created_at,
        updated_at=item.updated_at,
        asset=asset_summary,
    )


def _collection_summary(collection: Optional[MediaCollection]) -> Optional[StreamCollectionSummary]:
    if not collection:
        return None
    items = sorted(collection.items or [], key=lambda itm: itm.position)
    return StreamCollectionSummary(
        id=collection.id,
        name=collection.name,
        collection_type=collection.collection_type,
        loop_enabled=collection.loop_enabled,
        shuffle_enabled=collection.shuffle_enabled,
        items=[_item_to_response(item) for item in items],
    )


def _destinations_summary(destinations: List[StreamDestination]) -> List[StreamDestinationSummary]:
    summaries: List[StreamDestinationSummary] = []
    for link in destinations:
        destination = link.destination
        if destination is None:
            continue
        summaries.append(
            StreamDestinationSummary(
                id=destination.id,
                name=destination.name,
                rtmps_url=destination.rtmps_url,
                enabled=destination.enabled,
            )
        )
    return summaries


@router.get("/", response_model=List[StreamConfigurationResponse])
async def list_stream_configurations(user_deps: tuple = Depends(require_user)) -> List[StreamConfigurationResponse]:
    db, user_id = user_deps
    query = (
        select(Stream)
        .where(Stream.user_id == user_id)
        .options(
            selectinload(Stream.video_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
            selectinload(Stream.audio_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
            selectinload(Stream.stream_destinations).selectinload(StreamDestination.destination),
        )
    )

    result = await db.execute(query)
    streams = result.scalars().unique().all()
    return [
        StreamConfigurationResponse(
            id=stream.id,
            name=stream.name,
            status=stream.status,
            mix_mode=stream.mix_mode,
            created_at=stream.created_at,
            updated_at=stream.updated_at,
            video_collection=_collection_summary(stream.video_collection),
            audio_collection=_collection_summary(stream.audio_collection),
            settings=stream.settings_json or {},
            destinations=_destinations_summary(stream.stream_destinations),
        )
        for stream in streams
    ]


@router.get("/{stream_id}", response_model=StreamConfigurationResponse)
async def get_stream_configuration(
    stream_id: UUID,
    user_deps: tuple = Depends(require_user),
) -> StreamConfigurationResponse:
    db, user_id = user_deps

    query = (
        select(Stream)
        .where(Stream.id == stream_id, Stream.user_id == user_id)
        .options(
            selectinload(Stream.video_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
            selectinload(Stream.audio_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
            selectinload(Stream.stream_destinations).selectinload(StreamDestination.destination),
        )
    )
    result = await db.execute(query)
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")

    return StreamConfigurationResponse(
        id=stream.id,
        name=stream.name,
        status=stream.status,
        mix_mode=stream.mix_mode,
        created_at=stream.created_at,
        updated_at=stream.updated_at,
        video_collection=_collection_summary(stream.video_collection),
        audio_collection=_collection_summary(stream.audio_collection),
        settings=stream.settings_json or {},
        destinations=_destinations_summary(stream.stream_destinations),
    )
