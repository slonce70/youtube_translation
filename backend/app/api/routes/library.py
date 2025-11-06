from typing import List, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import require_user
from app.core.library import (
    FolderNotEmptyError,
    FolderNotFoundError,
    FolderValidationError,
    MediaLibraryService,
)
from app.core.cascade import CascadeUpdateService
from app.schemas.api import (
    MediaFolderCreate,
    MediaFolderResponse,
    MediaFolderUpdate,
    MediaUsageResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _folder_to_response(folder, stats) -> MediaFolderResponse:
    return MediaFolderResponse(
        id=folder.id,
        user_id=folder.user_id,
        name=folder.name,
        parent_id=folder.parent_id,
        is_tag=folder.is_tag,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        asset_count=stats.asset_count,
        total_size_bytes=stats.total_size_bytes,
        children_count=stats.children_count,
    )


@router.get("/folders", response_model=List[MediaFolderResponse])
async def list_folders(user_deps: tuple = Depends(require_user)) -> List[MediaFolderResponse]:
    db, user_id = user_deps

    service = MediaLibraryService(db, user_id)
    folders, stats_map = await service.list_folders()

    return [_folder_to_response(folder, stats_map[folder.id]) for folder in folders]


@router.post("/folders", response_model=MediaFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    payload: MediaFolderCreate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = MediaLibraryService(db, user_id)

    try:
        folder = await service.create_folder(
            name=payload.name,
            parent_id=payload.parent_id,
            is_tag=payload.is_tag,
        )
        await db.commit()
        folders, stats_map = await service.list_folders()
        return _folder_to_response(folder, stats_map[folder.id])
    except FolderValidationError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except FolderNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to create folder: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create folder") from exc


@router.patch("/folders/{folder_id}", response_model=MediaFolderResponse)
async def update_folder(
    folder_id: UUID,
    payload: MediaFolderUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = MediaLibraryService(db, user_id)

    try:
        folder = await service.update_folder(
            folder_id,
            name=payload.name,
            parent_id=payload.parent_id,
        )
        await db.commit()
        folders, stats_map = await service.list_folders()
        return _folder_to_response(folder, stats_map[folder.id])
    except FolderNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except FolderValidationError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to update folder %s: %s", folder_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update folder") from exc


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: UUID,
    force: bool = Query(False),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = MediaLibraryService(db, user_id)

    try:
        folder, asset_ids = await service.delete_folder(folder_id, force=force)
        cascade = CascadeUpdateService(db, user_id, logger=logger)
        await cascade.handle_folder_removed(folder.id, asset_ids)
        await db.commit()
    except FolderNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except FolderNotEmptyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Folder is not empty. Pass force=true to delete along with its contents.",
        )
    except FolderValidationError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to delete folder %s: %s", folder_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete folder") from exc


@router.get("/usage", response_model=MediaUsageResponse)
async def get_media_usage(user_deps: tuple = Depends(require_user)) -> MediaUsageResponse:
    db, user_id = user_deps
    service = MediaLibraryService(db, user_id)
    total_size, asset_count = await service.compute_usage()
    return MediaUsageResponse(user_id=user_id, total_size_bytes=total_size, asset_count=asset_count)
