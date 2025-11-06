"""Media library service for folders, asset filtering, and usage aggregation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import selectinload

from app.models.database import Asset, AssetFolderLink, MediaFolder


class LibraryError(Exception):
    """Base error for media library operations."""


class FolderNotFoundError(LibraryError):
    def __init__(self, folder_id: UUID):
        super().__init__(f"Folder {folder_id} not found")
        self.folder_id = folder_id


class FolderValidationError(LibraryError):
    def __init__(self, folder_id: UUID, message: str):
        super().__init__(message)
        self.folder_id = folder_id


class FolderNotEmptyError(LibraryError):
    def __init__(self, folder_id: UUID):
        super().__init__(f"Folder {folder_id} is not empty")
        self.folder_id = folder_id


@dataclass
class FolderStats:
    asset_count: int
    total_size_bytes: int
    children_count: int


class MediaLibraryService:
    """Encapsulates media folder CRUD, asset filters, and usage metrics."""

    def __init__(self, db, user_id: UUID):
        self.db = db
        self.user_id = user_id

    async def list_folders(self) -> Tuple[List[MediaFolder], Dict[UUID, FolderStats]]:
        query = (
            select(MediaFolder)
            .where(MediaFolder.user_id == self.user_id)
            .options(selectinload(MediaFolder.assets))
        )
        result = await self.db.execute(query)
        folders = result.scalars().unique().all()

        folder_ids = [folder.id for folder in folders]
        stats: Dict[UUID, FolderStats] = {}

        if folder_ids:
            asset_stats_query = (
                select(
                    AssetFolderLink.folder_id,
                    func.count(AssetFolderLink.asset_id).label("asset_count"),
                    func.coalesce(func.sum(Asset.size_bytes), 0).label("total_size"),
                )
                .join(Asset, Asset.id == AssetFolderLink.asset_id)
                .where(
                    AssetFolderLink.folder_id.in_(folder_ids),
                    Asset.user_id == self.user_id,
                )
                .group_by(AssetFolderLink.folder_id)
            )
            asset_stats_result = await self.db.execute(asset_stats_query)
            asset_stats = {
                row.folder_id: (row.asset_count, int(row.total_size))
                for row in asset_stats_result
            }

            children_query = (
                select(MediaFolder.parent_id, func.count(MediaFolder.id))
                .where(
                    MediaFolder.user_id == self.user_id,
                    MediaFolder.parent_id.isnot(None),
                )
                .group_by(MediaFolder.parent_id)
            )
            children_result = await self.db.execute(children_query)
            child_counts = {row.parent_id: row[1] for row in children_result}

            for folder in folders:
                asset_count, total_size = asset_stats.get(folder.id, (0, 0))
                stats[folder.id] = FolderStats(
                    asset_count=asset_count,
                    total_size_bytes=total_size,
                    children_count=child_counts.get(folder.id, 0),
                )
        for folder in folders:
            stats.setdefault(
                folder.id,
                FolderStats(asset_count=0, total_size_bytes=0, children_count=0),
            )
        return folders, stats

    async def compute_usage(self) -> Tuple[int, int]:
        query = select(
            func.coalesce(func.sum(Asset.size_bytes), 0),
            func.count(Asset.id),
        ).where(Asset.user_id == self.user_id)
        result = await self.db.execute(query)
        total_size, asset_count = result.one()
        return int(total_size or 0), int(asset_count or 0)

    async def create_folder(self, *, name: str, parent_id: Optional[UUID], is_tag: bool) -> MediaFolder:
        parent = None
        if parent_id:
            parent = await self._get_folder(parent_id)
            if parent.user_id != self.user_id:
                raise FolderValidationError(parent_id, "Parent folder belongs to a different user")
            if parent.is_tag and not is_tag:
                raise FolderValidationError(parent_id, "Tag folders cannot contain regular folders")

        folder = MediaFolder(
            user_id=self.user_id,
            parent_id=parent_id,
            name=name.strip(),
            is_tag=is_tag,
        )
        self.db.add(folder)
        await self.db.flush()
        return folder

    async def update_folder(self, folder_id: UUID, *, name: Optional[str], parent_id: Optional[UUID]) -> MediaFolder:
        folder = await self._get_folder(folder_id)
        if folder.user_id != self.user_id:
            raise FolderValidationError(folder_id, "Folder belongs to a different user")

        if name is not None:
            folder.name = name.strip()

        if parent_id is not None and parent_id != folder.parent_id:
            if folder.is_tag:
                raise FolderValidationError(folder_id, "Tag folders cannot be nested")
            new_parent = await self._get_folder(parent_id)
            if new_parent.user_id != self.user_id:
                raise FolderValidationError(parent_id, "Parent folder belongs to a different user")
            if new_parent.is_tag:
                raise FolderValidationError(parent_id, "Cannot move folder under a tag")
            if new_parent.id == folder.id:
                raise FolderValidationError(parent_id, "Folder cannot be its own parent")
            folder.parent_id = new_parent.id

        await self.db.flush()
        return folder

    async def delete_folder(self, folder_id: UUID, *, force: bool = False) -> Tuple[MediaFolder, List[UUID]]:
        folder = await self._get_folder(folder_id)
        if folder.user_id != self.user_id:
            raise FolderValidationError(folder_id, "Folder belongs to a different user")

        children_query = select(MediaFolder.id).where(MediaFolder.parent_id == folder_id).limit(1)
        children_result = await self.db.execute(children_query)
        has_children = children_result.scalar_one_or_none() is not None

        assets_query = select(AssetFolderLink.asset_id).where(AssetFolderLink.folder_id == folder_id).limit(1)
        assets_result = await self.db.execute(assets_query)
        has_assets = assets_result.scalar_one_or_none() is not None

        if (has_children or has_assets) and not force:
            raise FolderNotEmptyError(folder_id)

        asset_ids: List[UUID] = []
        if force:
            linked_assets_query = select(AssetFolderLink.asset_id).where(AssetFolderLink.folder_id == folder_id)
            linked_assets_result = await self.db.execute(linked_assets_query)
            asset_ids = [row.asset_id for row in linked_assets_result]
            await self.db.execute(delete(AssetFolderLink).where(AssetFolderLink.folder_id == folder_id))

        await self.db.delete(folder)
        await self.db.flush()
        return folder, asset_ids

    async def assign_asset_links(
        self,
        asset_id: UUID,
        folder_ids: Optional[Sequence[UUID]] = None,
        tag_ids: Optional[Sequence[UUID]] = None,
    ) -> None:
        if folder_ids is not None:
            valid_folder_ids = await self._validate_folder_ids(folder_ids, require_tag=False)
            await self.db.execute(
                delete(AssetFolderLink).where(
                    AssetFolderLink.asset_id == asset_id,
                    AssetFolderLink.link_type == "folder",
                )
            )

            for folder_id in valid_folder_ids:
                self.db.add(
                    AssetFolderLink(
                        asset_id=asset_id,
                        folder_id=folder_id,
                        link_type="folder",
                    )
                )

        if tag_ids is not None:
            valid_tag_ids = await self._validate_folder_ids(tag_ids, require_tag=True)
            await self.db.execute(
                delete(AssetFolderLink).where(
                    AssetFolderLink.asset_id == asset_id,
                    AssetFolderLink.link_type == "tag",
                )
            )

            for tag_id in valid_tag_ids:
                self.db.add(
                    AssetFolderLink(
                        asset_id=asset_id,
                        folder_id=tag_id,
                        link_type="tag",
                    )
                )

        await self.db.flush()

    async def list_assets(
        self,
        *,
        asset_type: Optional[str] = None,
        folder_id: Optional[UUID] = None,
        tag_ids: Optional[Sequence[UUID]] = None,
    ) -> List[Asset]:
        query = (
            select(Asset)
            .where(Asset.user_id == self.user_id)
            .options(selectinload(Asset.folder_links))
        )

        if asset_type:
            query = query.where(Asset.asset_type == asset_type)

        if folder_id:
            query = query.where(
                exists(
                    select(AssetFolderLink.id).where(
                        AssetFolderLink.asset_id == Asset.id,
                        AssetFolderLink.folder_id == folder_id,
                        AssetFolderLink.link_type == "folder",
                    )
                )
            )

        if tag_ids:
            query = query.where(
                exists(
                    select(AssetFolderLink.id).where(
                        AssetFolderLink.asset_id == Asset.id,
                        AssetFolderLink.folder_id.in_(tag_ids),
                        AssetFolderLink.link_type == "tag",
                    )
                )
            )

        query = query.order_by(Asset.created_at.desc())
        result = await self.db.execute(query)
        return result.scalars().unique().all()

    async def _get_folder(self, folder_id: UUID) -> MediaFolder:
        query = select(MediaFolder).where(MediaFolder.id == folder_id)
        result = await self.db.execute(query)
        folder = result.scalar_one_or_none()
        if not folder:
            raise FolderNotFoundError(folder_id)
        return folder

    async def _validate_folder_ids(
        self,
        folder_ids: Sequence[UUID],
        *,
        require_tag: Optional[bool],
    ) -> List[UUID]:
        if not folder_ids:
            return []

        query = select(MediaFolder.id, MediaFolder.is_tag).where(
            MediaFolder.user_id == self.user_id,
            MediaFolder.id.in_(folder_ids),
        )
        result = await self.db.execute(query)
        found = {row.id: row.is_tag for row in result}

        missing = [folder_id for folder_id in folder_ids if folder_id not in found]
        if missing:
            raise FolderNotFoundError(missing[0])

        if require_tag is not None:
            invalid = [folder_id for folder_id, is_tag in found.items() if is_tag != require_tag]
            if invalid:
                desired = "tag" if require_tag else "folder"
                raise FolderValidationError(
                    invalid[0],
                    f"Folder {invalid[0]} must be a {desired}",
                )

        return list(found.keys())
