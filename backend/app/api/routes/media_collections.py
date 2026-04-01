"""Media collection API routes."""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import require_user
from app.schemas.api import (
    CollectionItemsUpdate,
    MediaCollectionCreate,
    MediaCollectionResponse,
    MediaCollectionUpdate,
)
from app.services.media_collections import MediaCollectionService

router = APIRouter()


def _get_service(user_deps: tuple) -> MediaCollectionService:
    db, user_id = user_deps
    return MediaCollectionService(db, user_id)


@router.get("/", response_model=List[MediaCollectionResponse])
async def list_media_collections(
    collection_type: Optional[str] = Query(None, description="Filter by type"),
    is_active: Optional[bool] = Query(None, description="Filter by active state"),
    include_items: bool = Query(False, description="Include collection items"),
    user_deps: tuple = Depends(require_user),
):
    """Return collections for the current user."""

    service = _get_service(user_deps)
    return await service.list_collections(collection_type, is_active, include_items)


@router.post(
    "/", response_model=MediaCollectionResponse, status_code=status.HTTP_201_CREATED
)
async def create_media_collection(
    collection_data: MediaCollectionCreate,
    user_deps: tuple = Depends(require_user),
):
    """Create a new media collection."""

    service = _get_service(user_deps)
    return await service.create_collection(collection_data)


@router.get("/{collection_id}", response_model=MediaCollectionResponse)
async def get_media_collection(
    collection_id: UUID,
    include_items: bool = Query(True, description="Include collection items"),
    user_deps: tuple = Depends(require_user),
):
    """Fetch a collection by id."""

    service = _get_service(user_deps)
    return await service.get_collection(collection_id, include_items)


@router.patch("/{collection_id}", response_model=MediaCollectionResponse)
async def update_media_collection(
    collection_id: UUID,
    collection_update: MediaCollectionUpdate,
    user_deps: tuple = Depends(require_user),
):
    """Update collection metadata."""

    service = _get_service(user_deps)
    return await service.update_collection(collection_id, collection_update)


@router.put("/{collection_id}/items", response_model=MediaCollectionResponse)
async def replace_collection_items(
    collection_id: UUID,
    items_update: CollectionItemsUpdate,
    user_deps: tuple = Depends(require_user),
):
    """Replace items in a collection."""

    service = _get_service(user_deps)
    return await service.replace_items(collection_id, items_update)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media_collection(
    collection_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Delete a collection."""

    service = _get_service(user_deps)
    await service.delete_collection(collection_id)
