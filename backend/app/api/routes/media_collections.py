from typing import List, Sequence
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import require_user
from app.core.collections import (
    CollectionItemOrderError,
    CollectionNotFound,
    InvalidCollectionAsset,
    MediaCollectionService,
)
from app.models.database import MediaCollection, Stream
from app.schemas.api import (
    CollectionItemCreate,
    CollectionReorderRequest,
    MediaCollectionCreate,
    MediaCollectionResponse,
    MediaCollectionUpdate,
    CollectionItemResponse,
    CollectionAssetSummary,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _item_to_response(item) -> CollectionItemResponse:
    asset_summary = None
    if getattr(item, "asset", None):
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


def _collection_to_response(collection: MediaCollection) -> MediaCollectionResponse:
    items = sorted(collection.items or [], key=lambda itm: itm.position)
    return MediaCollectionResponse(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        collection_type=collection.collection_type,
        loop_enabled=collection.loop_enabled,
        shuffle_enabled=collection.shuffle_enabled,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        items=[_item_to_response(item) for item in items],
    )


def _items_payload(items: Sequence[CollectionItemCreate]) -> Sequence[tuple]:
    return [(item.asset_id, item.position, item.loop_mode) for item in items]


@router.get("/", response_model=List[MediaCollectionResponse])
async def list_media_collections(user_deps: tuple = Depends(require_user)) -> List[MediaCollectionResponse]:
    db, user_id = user_deps
    service = MediaCollectionService(db, user_id)
    collections = await service.list_collections()
    return [_collection_to_response(collection) for collection in collections]


@router.post("/", response_model=MediaCollectionResponse, status_code=status.HTTP_201_CREATED)
async def create_media_collection(
    payload: MediaCollectionCreate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = MediaCollectionService(db, user_id)

    try:
        collection = await service.create_collection(
            name=payload.name,
            collection_type=payload.collection_type,
            description=payload.description,
            loop_enabled=payload.loop_enabled,
            shuffle_enabled=payload.shuffle_enabled,
            items=_items_payload(payload.items),
        )
        await db.commit()
        collection = await service.get_collection(collection.id)
        return _collection_to_response(collection)
    except InvalidCollectionAsset as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to create collection: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create collection") from exc


@router.get("/{collection_id}", response_model=MediaCollectionResponse)
async def get_media_collection(
    collection_id: UUID,
    user_deps: tuple = Depends(require_user),
) -> MediaCollectionResponse:
    db, user_id = user_deps
    service = MediaCollectionService(db, user_id)
    try:
        collection = await service.get_collection(collection_id)
        return _collection_to_response(collection)
    except CollectionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{collection_id}", response_model=MediaCollectionResponse)
async def update_media_collection(
    collection_id: UUID,
    payload: MediaCollectionUpdate,
    user_deps: tuple = Depends(require_user),
) -> MediaCollectionResponse:
    db, user_id = user_deps
    service = MediaCollectionService(db, user_id)

    try:
        collection = await service.update_collection(
            collection_id,
            name=payload.name,
            description=payload.description,
            loop_enabled=payload.loop_enabled,
            shuffle_enabled=payload.shuffle_enabled,
            items=_items_payload(payload.items) if payload.items is not None else None,
        )
        await db.commit()
        collection = await service.get_collection(collection.id)
        return _collection_to_response(collection)
    except CollectionNotFound as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (InvalidCollectionAsset, CollectionItemOrderError) as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to update collection %s: %s", collection_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update collection") from exc


@router.post("/{collection_id}/reorder", response_model=MediaCollectionResponse)
async def reorder_media_collection(
    collection_id: UUID,
    payload: CollectionReorderRequest,
    user_deps: tuple = Depends(require_user),
) -> MediaCollectionResponse:
    db, user_id = user_deps
    service = MediaCollectionService(db, user_id)
    try:
        collection = await service.reorder_collection(collection_id, payload.order)
        await db.commit()
        collection = await service.get_collection(collection.id)
        return _collection_to_response(collection)
    except CollectionNotFound as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CollectionItemOrderError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to reorder collection %s: %s", collection_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to reorder collection") from exc


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media_collection(
    collection_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    collection_query = (
        select(MediaCollection)
        .where(MediaCollection.id == collection_id, MediaCollection.user_id == user_id)
        .options(selectinload(MediaCollection.items))
    )
    result = await db.execute(collection_query)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    stream_query = select(Stream.id).where(
        Stream.user_id == user_id,
        or_(
            Stream.video_collection_id == collection_id,
            Stream.audio_collection_id == collection_id,
        ),
    ).limit(1)
    stream_result = await db.execute(stream_query)
    if stream_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Collection is linked to active streams",
        )

    await db.execute(delete(MediaCollection).where(MediaCollection.id == collection_id))
    await db.commit()
    logger.info("Deleted media collection %s", collection_id)
