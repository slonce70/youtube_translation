"""Business logic for media folders and asset links."""

from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Asset, AssetFolderLink, MediaFolder
from app.schemas.api import (
    MediaFolderBulkAssetRequest,
    MediaFolderBulkAssetResponse,
    MediaFolderCreate,
    MediaFolderUpdate,
)

logger = logging.getLogger(__name__)


class MediaFolderService:
    """Encapsulates folder CRUD operations and asset linking."""

    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id

    async def list_folders(
        self,
        parent_id: Optional[UUID],
        is_root: Optional[bool],
        search: Optional[str],
    ) -> List[MediaFolder]:
        query = select(MediaFolder).where(MediaFolder.user_id == self.user_id)

        if parent_id is not None:
            query = query.where(MediaFolder.parent_id == parent_id)
        if is_root is not None:
            query = query.where(MediaFolder.is_root.is_(is_root))
        if search:
            pattern = f"%{search.strip()}%"
            query = query.where(MediaFolder.name.ilike(pattern))

        query = query.order_by(MediaFolder.created_at)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def create_folder(self, payload: MediaFolderCreate) -> MediaFolder:
        parent_folder = await self._resolve_parent(payload.parent_id)

        new_folder = MediaFolder(
            user_id=self.user_id,
            parent_id=parent_folder.id,
            name=payload.name.strip() if payload.name else "",
            is_root=False,
        )

        if not new_folder.name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder name cannot be empty",
            )

        self.db.add(new_folder)
        try:
            await self.db.commit()
            await self.db.refresh(new_folder)
            logger.info(
                "Created media folder %s for user %s", new_folder.id, self.user_id
            )
            return new_folder
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning(
                "Folder creation conflict for user %s: %s", self.user_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder with the same name already exists",
            ) from exc
        except Exception as exc:  # pragma: no cover - defensive logging
            await self.db.rollback()
            logger.exception(
                "Error creating media folder for user %s: %s", self.user_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create folder",
            ) from exc

    async def update_folder(
        self, folder_id: UUID, payload: MediaFolderUpdate
    ) -> MediaFolder:
        folder = await self._get_folder(folder_id)

        if payload.name is not None:
            new_name = payload.name.strip()
            if not new_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Folder name cannot be empty",
                )
            folder.name = new_name

        if payload.parent_id is not None:
            if folder.is_root:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Root folder cannot be reparented",
                )
            if payload.parent_id == folder.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Folder cannot be its own parent",
                )

            new_parent = await self._get_folder(payload.parent_id)
            await self._ensure_not_descendant(folder.id, new_parent.id)
            folder.parent_id = new_parent.id

        try:
            await self.db.commit()
            await self.db.refresh(folder)
            return folder
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning("Folder update conflict for user %s: %s", self.user_id, exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder with the same name already exists",
            ) from exc
        except Exception as exc:  # pragma: no cover
            await self.db.rollback()
            logger.exception(
                "Error updating folder %s for user %s: %s", folder_id, self.user_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update folder",
            ) from exc

    async def delete_folder(self, folder_id: UUID) -> None:
        folder = await self._get_folder(folder_id)

        if folder.is_root:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Root folder cannot be deleted",
            )

        child_exists = await self.db.execute(
            select(MediaFolder.id).where(MediaFolder.parent_id == folder.id).limit(1)
        )
        asset_exists = await self.db.execute(
            select(AssetFolderLink.asset_id)
            .where(AssetFolderLink.folder_id == folder.id)
            .limit(1)
        )

        if child_exists.first() is not None or asset_exists.first() is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder is not empty",
            )

        await self.db.execute(delete(MediaFolder).where(MediaFolder.id == folder.id))
        await self.db.commit()
        logger.info("Deleted media folder %s for user %s", folder.id, self.user_id)

    async def add_asset_to_folder(
        self, folder_id: UUID, asset_id: UUID
    ) -> AssetFolderLink:
        folder = await self._get_folder(folder_id)
        await self._assert_asset_owned(asset_id)

        link = AssetFolderLink(asset_id=asset_id, folder_id=folder.id)
        self.db.add(link)

        try:
            await self.db.commit()
            await self.db.refresh(link)
            return link
        except IntegrityError:
            await self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Asset already linked to folder",
            )

    async def remove_asset_from_folder(self, folder_id: UUID, asset_id: UUID) -> None:
        folder = await self._get_folder(folder_id)
        result = await self.db.execute(
            delete(AssetFolderLink).where(
                AssetFolderLink.folder_id == folder.id,
                AssetFolderLink.asset_id == asset_id,
            )
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Link not found"
            )

        await self.db.commit()

    async def bulk_move_assets(
        self, folder_id: UUID, payload: MediaFolderBulkAssetRequest
    ) -> MediaFolderBulkAssetResponse:
        folder = await self._get_folder(folder_id)

        asset_ids = list(dict.fromkeys(payload.asset_ids))
        if not asset_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="asset_ids cannot be empty",
            )

        owned_assets = await self.db.execute(
            select(Asset.id).where(
                Asset.user_id == self.user_id, Asset.id.in_(asset_ids)
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
            await self.db.execute(
                delete(AssetFolderLink).where(AssetFolderLink.asset_id.in_(asset_ids))
            )

        existing_links = await self.db.execute(
            select(AssetFolderLink.asset_id).where(
                AssetFolderLink.asset_id.in_(asset_ids),
                AssetFolderLink.folder_id == folder.id,
            )
        )
        already_linked = {row[0] for row in existing_links}

        inserted = 0
        for asset_id in asset_ids:
            if asset_id in already_linked:
                continue
            self.db.add(AssetFolderLink(asset_id=asset_id, folder_id=folder.id))
            inserted += 1

        await self.db.commit()
        updated_count = len(asset_ids) if payload.exclusive else inserted
        return MediaFolderBulkAssetResponse(updated_assets=updated_count)

    async def _get_folder(self, folder_id: UUID) -> MediaFolder:
        folder = await self._fetch_folder(folder_id)
        if not folder:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found"
            )
        return folder

    async def _fetch_folder(self, folder_id: UUID) -> Optional[MediaFolder]:
        result = await self.db.execute(
            select(MediaFolder).where(
                MediaFolder.id == folder_id, MediaFolder.user_id == self.user_id
            )
        )
        return result.scalar_one_or_none()

    async def _resolve_parent(self, parent_id: Optional[UUID]) -> MediaFolder:
        if parent_id:
            parent = await self._fetch_folder(parent_id)
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Parent folder not found",
                )
            return parent
        return await self._ensure_root_folder()

    async def _ensure_root_folder(self) -> MediaFolder:
        query = select(MediaFolder).where(
            MediaFolder.user_id == self.user_id, MediaFolder.is_root.is_(True)
        )
        result = await self.db.execute(query)
        root = result.scalar_one_or_none()
        if root:
            return root

        root = MediaFolder(user_id=self.user_id, name="root", is_root=True)
        self.db.add(root)
        await self.db.flush()
        return root

    async def _ensure_not_descendant(
        self, folder_id: UUID, candidate_parent_id: UUID
    ) -> None:
        ancestor_id = candidate_parent_id
        while ancestor_id is not None:
            if ancestor_id == folder_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot move a folder into its descendant",
                )
            ancestor = await self._fetch_folder(ancestor_id)
            if ancestor is None:
                break
            ancestor_id = ancestor.parent_id

    async def _assert_asset_owned(self, asset_id: UUID) -> Asset:
        result = await self.db.execute(
            select(Asset).where(Asset.id == asset_id, Asset.user_id == self.user_id)
        )
        asset = result.scalar_one_or_none()
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found"
            )
        return asset
