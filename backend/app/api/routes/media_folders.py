from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from uuid import UUID
import logging

from app.api.deps import require_user
from app.models.database import Asset, AssetFolderLink, MediaFolder
from app.schemas.api import (
    AssetFolderLinkResponse,
    MediaFolderBulkAssetRequest,
    MediaFolderBulkAssetResponse,
    MediaFolderCreate,
    MediaFolderResponse,
    MediaFolderUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()


async def _ensure_root_folder(db: AsyncSession, user_id: UUID) -> MediaFolder:
    query = select(MediaFolder).where(
        MediaFolder.user_id == user_id,
        MediaFolder.is_root.is_(True),
    )
    result = await db.execute(query)
    root = result.scalar_one_or_none()
    if root:
        return root

    root = MediaFolder(user_id=user_id, name="root", is_root=True)
    db.add(root)
    await db.flush()
    return root


async def _get_folder(
    db: AsyncSession,
    user_id: UUID,
    folder_id: UUID,
) -> Optional[MediaFolder]:
    query = select(MediaFolder).where(
        MediaFolder.id == folder_id,
        MediaFolder.user_id == user_id,
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def _ensure_not_descendant(
    db: AsyncSession,
    user_id: UUID,
    folder_id: UUID,
    candidate_parent_id: UUID,
) -> None:
    ancestor_id = candidate_parent_id
    while ancestor_id is not None:
        if ancestor_id == folder_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a folder into its descendant",
            )
        ancestor = await _get_folder(db, user_id, ancestor_id)
        if ancestor is None:
            break
        ancestor_id = ancestor.parent_id


@router.get("/", response_model=List[MediaFolderResponse])
async def list_media_folders(
    parent_id: Optional[UUID] = Query(None, description="Filter by parent folder ID"),
    is_root: Optional[bool] = Query(None, description="Filter by root folders"),
    search: Optional[str] = Query(None, min_length=1, description="Case-insensitive name filter"),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    query = select(MediaFolder).where(MediaFolder.user_id == user_id)

    if parent_id is not None:
        query = query.where(MediaFolder.parent_id == parent_id)
    if is_root is not None:
        query = query.where(MediaFolder.is_root.is_(is_root))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(MediaFolder.name.ilike(pattern))

    query = query.order_by(MediaFolder.created_at)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=MediaFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_media_folder(
    folder_data: MediaFolderCreate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    try:
        parent_folder: MediaFolder
        if folder_data.parent_id:
            parent_folder = await _get_folder(db, user_id, folder_data.parent_id)
            if not parent_folder:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Parent folder not found",
                )
        else:
            parent_folder = await _ensure_root_folder(db, user_id)

        new_folder = MediaFolder(
            user_id=user_id,
            parent_id=parent_folder.id,
            name=folder_data.name.strip() if folder_data.name else "",
            is_root=False,
        )

        if not new_folder.name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder name cannot be empty",
            )

        db.add(new_folder)
        await db.commit()
        await db.refresh(new_folder)

        logger.info("Created media folder %s for user %s", new_folder.id, user_id)
        return new_folder

    except HTTPException:
        raise
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Folder creation conflict for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder with the same name already exists",
        ) from exc
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Error creating media folder for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create folder",
        ) from exc


@router.patch("/{folder_id}", response_model=MediaFolderResponse)
async def update_media_folder(
    folder_id: UUID,
    folder_update: MediaFolderUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    folder = await _get_folder(db, user_id, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )

    if folder_update.name is not None:
        new_name = folder_update.name.strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder name cannot be empty",
            )
        folder.name = new_name

    if folder_update.parent_id is not None:
        if folder.is_root:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Root folder cannot be reparented",
            )
        if folder_update.parent_id == folder.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder cannot be its own parent",
            )

        new_parent = await _get_folder(db, user_id, folder_update.parent_id)
        if not new_parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Target parent folder not found",
            )

        await _ensure_not_descendant(db, user_id, folder.id, new_parent.id)
        folder.parent_id = new_parent.id

    try:
        await db.commit()
        await db.refresh(folder)
        return folder
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Folder update conflict for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder with the same name already exists",
        ) from exc
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Error updating folder %s for user %s: %s", folder_id, user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update folder",
        ) from exc


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media_folder(
    folder_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    folder = await _get_folder(db, user_id, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )

    if folder.is_root:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Root folder cannot be deleted",
        )

    child_exists = await db.execute(
        select(MediaFolder.id).where(MediaFolder.parent_id == folder.id).limit(1)
    )
    asset_exists = await db.execute(
        select(AssetFolderLink.asset_id).where(AssetFolderLink.folder_id == folder.id).limit(1)
    )

    if child_exists.first() is not None or asset_exists.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder is not empty",
        )

    await db.execute(delete(MediaFolder).where(MediaFolder.id == folder.id))
    await db.commit()
    logger.info("Deleted media folder %s for user %s", folder.id, user_id)


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
    db, user_id = user_deps

    folder = await _get_folder(db, user_id, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )

    asset_query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
    asset_result = await db.execute(asset_query)
    asset = asset_result.scalar_one_or_none()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    link = AssetFolderLink(asset_id=asset.id, folder_id=folder.id)
    db.add(link)

    try:
        await db.commit()
        await db.refresh(link)
        return link
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Asset already linked to folder",
        )


@router.delete("/{folder_id}/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_asset_from_folder(
    folder_id: UUID,
    asset_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps

    folder = await _get_folder(db, user_id, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )

    result = await db.execute(
        delete(AssetFolderLink).where(
            AssetFolderLink.folder_id == folder.id,
            AssetFolderLink.asset_id == asset_id,
        )
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found",
        )

    await db.commit()


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
    db, user_id = user_deps

    folder = await _get_folder(db, user_id, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )

    asset_ids = list(dict.fromkeys(payload.asset_ids))
    if not asset_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="asset_ids cannot be empty",
        )

    owned_assets = await db.execute(
        select(Asset.id).where(
            Asset.user_id == user_id,
            Asset.id.in_(asset_ids),
        )
    )
    owned_ids = {row[0] for row in owned_assets}
    missing = [str(asset_id) for asset_id in asset_ids if asset_id not in owned_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"missing_assets": missing},
        )

    if payload.exclusive:
        await db.execute(
            delete(AssetFolderLink).where(
                AssetFolderLink.asset_id.in_(asset_ids)
            )
        )

    existing_links = await db.execute(
        select(AssetFolderLink.asset_id)
        .where(
            AssetFolderLink.asset_id.in_(asset_ids),
            AssetFolderLink.folder_id == folder.id,
        )
    )
    already_linked = {row[0] for row in existing_links}

    inserted = 0
    for asset_id in asset_ids:
        if asset_id in already_linked:
            continue
        db.add(AssetFolderLink(asset_id=asset_id, folder_id=folder.id))
        inserted += 1

    await db.commit()
    updated_count = len(asset_ids) if payload.exclusive else inserted
    return MediaFolderBulkAssetResponse(updated_assets=updated_count)
