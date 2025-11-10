from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
from uuid import UUID
import logging

from app.api.deps import require_user
from app.core.collections import (
    normalize_collection_items,
    replace_collection_items as replace_collection_items_helper,
    validate_collection_assets,
)
from app.models.database import CollectionItem, MediaCollection
from app.schemas.api import (
    CollectionItemResponse,
    CollectionItemsUpdate,
    MediaCollectionCreate,
    MediaCollectionResponse,
    MediaCollectionUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_COLLECTION_TYPES = {"video_background", "audio_playlist"}


def _collection_to_response(
    collection: MediaCollection,
    include_items: bool = True,
) -> MediaCollectionResponse:
    if include_items:
        items = sorted(list(collection.items or []), key=lambda item: item.position)
        item_models = [
            CollectionItemResponse.model_validate(item, from_attributes=True)
            for item in items
        ]
    else:
        item_models = []

    return MediaCollectionResponse(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        collection_type=collection.collection_type,
        is_active=collection.is_active,
        origin_playlist_id=collection.origin_playlist_id,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        items=item_models,
    )


async def _load_collection(
    db: AsyncSession,
    user_id: UUID,
    collection_id: UUID,
    include_items: bool = True,
) -> Optional[MediaCollection]:
    query = select(MediaCollection).where(
        MediaCollection.id == collection_id,
        MediaCollection.user_id == user_id,
    )

    if include_items:
        query = query.options(
            selectinload(MediaCollection.items).selectinload(CollectionItem.asset)
        )

    result = await db.execute(query)
    return result.scalar_one_or_none()


@router.get("/", response_model=List[MediaCollectionResponse])
async def list_media_collections(
    collection_type: Optional[str] = Query(None, description="Filter by type"),
    is_active: Optional[bool] = Query(None, description="Filter by active state"),
    include_items: bool = Query(False, description="Include collection items"),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    query = select(MediaCollection).where(MediaCollection.user_id == user_id)

    if collection_type is not None:
        if collection_type not in ALLOWED_COLLECTION_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported collection type",
            )
        query = query.where(MediaCollection.collection_type == collection_type)

    if is_active is not None:
        query = query.where(MediaCollection.is_active.is_(is_active))

    if include_items:
        query = query.options(
            selectinload(MediaCollection.items).selectinload(CollectionItem.asset)
        )

    query = query.order_by(MediaCollection.created_at)
    result = await db.execute(query)
    collections = result.scalars().unique().all()

    return [
        _collection_to_response(collection, include_items=include_items)
        for collection in collections
    ]


@router.post("/", response_model=MediaCollectionResponse, status_code=status.HTTP_201_CREATED)
async def create_media_collection(
    collection_data: MediaCollectionCreate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    if collection_data.collection_type not in ALLOWED_COLLECTION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported collection type",
        )

    normalized_items = normalize_collection_items(collection_data.items)
    expected_type = (
        "video"
        if collection_data.collection_type == "video_background"
        else "audio"
    )

    await validate_collection_assets(db, user_id, normalized_items, expected_type)

    collection = MediaCollection(
        user_id=user_id,
        name=collection_data.name.strip() if collection_data.name else "",
        description=collection_data.description,
        collection_type=collection_data.collection_type,
        is_active=collection_data.is_active,
    )

    if not collection.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Collection name cannot be empty",
        )

    try:
        db.add(collection)
        await db.flush()
        await replace_collection_items_helper(db, collection, normalized_items)
        await db.commit()
        await db.refresh(collection, attribute_names=["items"])
        logger.info("Created media collection %s for user %s", collection.id, user_id)
        return _collection_to_response(collection)
    except HTTPException:
        raise
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Collection creation conflict for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Collection with the same attributes already exists",
        ) from exc
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Error creating media collection for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create collection",
        ) from exc


@router.get("/{collection_id}", response_model=MediaCollectionResponse)
async def get_media_collection(
    collection_id: UUID,
    include_items: bool = Query(True, description="Include collection items"),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    collection = await _load_collection(db, user_id, collection_id, include_items=include_items)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    return _collection_to_response(collection, include_items=include_items)


@router.patch("/{collection_id}", response_model=MediaCollectionResponse)
async def update_media_collection(
    collection_id: UUID,
    collection_update: MediaCollectionUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    collection = await _load_collection(db, user_id, collection_id, include_items=True)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    if collection_update.name is not None:
        new_name = collection_update.name.strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Collection name cannot be empty",
            )
        collection.name = new_name

    if collection_update.description is not None:
        collection.description = collection_update.description

    if collection_update.is_active is not None:
        collection.is_active = collection_update.is_active

    try:
        await db.commit()
        await db.refresh(collection, attribute_names=["items"])
        return _collection_to_response(collection)
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Collection update conflict for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Collection update violates constraints",
        ) from exc
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Error updating collection %s for user %s: %s", collection_id, user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update collection",
        ) from exc


@router.put("/{collection_id}/items", response_model=MediaCollectionResponse)
async def replace_collection_items(
    collection_id: UUID,
    items_update: CollectionItemsUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    collection = await _load_collection(db, user_id, collection_id, include_items=True)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    normalized_items = normalize_collection_items(items_update.items)
    expected_type = (
        "video" if collection.collection_type == "video_background" else "audio"
    )

    await validate_collection_assets(db, user_id, normalized_items, expected_type)

    try:
        await replace_collection_items_helper(db, collection, normalized_items)
        await db.commit()
        await db.refresh(collection, attribute_names=["items"])
        return _collection_to_response(collection)
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Error replacing collection items for %s: %s", collection_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update collection items",
        ) from exc


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media_collection(
    collection_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    collection = await _load_collection(db, user_id, collection_id, include_items=False)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    await db.execute(
        delete(MediaCollection).where(MediaCollection.id == collection_id)
    )
    await db.commit()
    logger.info("Deleted media collection %s for user %s", collection_id, user_id)
