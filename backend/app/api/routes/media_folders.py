"""Media folder API routes."""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import require_user
from app.schemas.api import (
    AssetFolderLinkResponse,
    MediaFolderBulkAssetRequest,
    MediaFolderBulkAssetResponse,
    MediaFolderCreate,
    MediaFolderResponse,
    MediaFolderUpdate,
)
from app.services.media_folders import MediaFolderService

router = APIRouter()


def _get_service(user_deps: tuple) -> MediaFolderService:
    db, user_id = user_deps
    return MediaFolderService(db, user_id)


@router.get("/", response_model=List[MediaFolderResponse])
async def list_media_folders(
    parent_id: Optional[UUID] = Query(None, description="Filter by parent folder ID"),
    is_root: Optional[bool] = Query(None, description="Filter by root folders"),
    search: Optional[str] = Query(None, min_length=1, description="Case-insensitive name filter"),
    user_deps: tuple = Depends(require_user),
):
    """Return folders for the current user."""

    service = _get_service(user_deps)
    return await service.list_folders(parent_id, is_root, search)


@router.post("/", response_model=MediaFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_media_folder(
    folder_data: MediaFolderCreate,
    user_deps: tuple = Depends(require_user),
):
    """Create a folder (non-root)."""

    service = _get_service(user_deps)
    return await service.create_folder(folder_data)


@router.patch("/{folder_id}", response_model=MediaFolderResponse)
async def update_media_folder(
    folder_id: UUID,
    folder_update: MediaFolderUpdate,
    user_deps: tuple = Depends(require_user),
):
    """Update folder metadata or parent."""

    service = _get_service(user_deps)
    return await service.update_folder(folder_id, folder_update)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media_folder(
    folder_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Delete a folder if it is empty and not root."""

    service = _get_service(user_deps)
    await service.delete_folder(folder_id)


@router.post(
    "/{folder_id}/assets/{asset_id}",
    response_model=AssetFolderLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_asset_to_folder(
    folder_id: UUID,
    asset_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Link an asset to a folder."""

    service = _get_service(user_deps)
    return await service.add_asset_to_folder(folder_id, asset_id)


@router.delete("/{folder_id}/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_asset_from_folder(
    folder_id: UUID,
    asset_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Unlink an asset from a folder."""

    service = _get_service(user_deps)
    await service.remove_asset_from_folder(folder_id, asset_id)


@router.post(
    "/{folder_id}/assets/bulk",
    response_model=MediaFolderBulkAssetResponse,
    status_code=status.HTTP_200_OK,
)
async def bulk_move_assets_to_folder(
    folder_id: UUID,
    payload: MediaFolderBulkAssetRequest,
    user_deps: tuple = Depends(require_user),
):
    """Bulk assign assets to a folder, optionally enforcing exclusivity."""

    service = _get_service(user_deps)
    return await service.bulk_move_assets(folder_id, payload)

