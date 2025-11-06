"""Service helpers for media collections and items."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.models.database import Asset, CollectionItem, MediaCollection


class CollectionError(Exception):
    """Base error for media collection operations."""


class CollectionNotFound(CollectionError):
    def __init__(self, collection_id: UUID):
        super().__init__(f"Collection {collection_id} not found")
        self.collection_id = collection_id


class InvalidCollectionAsset(CollectionError):
    def __init__(self, asset_id: UUID, reason: str):
        super().__init__(reason)
        self.asset_id = asset_id


class CollectionItemOrderError(CollectionError):
    pass


@dataclass
class CollectionWithItems:
    collection: MediaCollection
    items: List[CollectionItem]


class MediaCollectionService:
    """Encapsulates collection CRUD and validation logic."""

    def __init__(self, db, user_id: UUID):
        self.db = db
        self.user_id = user_id

    async def list_collections(self) -> List[MediaCollection]:
        query = (
            select(MediaCollection)
            .where(MediaCollection.user_id == self.user_id)
            .options(selectinload(MediaCollection.items).selectinload(CollectionItem.asset))
            .order_by(MediaCollection.created_at)
        )
        result = await self.db.execute(query)
        return result.scalars().unique().all()

    async def get_collection(self, collection_id: UUID) -> MediaCollection:
        query = (
            select(MediaCollection)
            .where(
                MediaCollection.id == collection_id,
                MediaCollection.user_id == self.user_id,
            )
            .options(selectinload(MediaCollection.items).selectinload(CollectionItem.asset))
        )
        result = await self.db.execute(query)
        collection = result.scalar_one_or_none()
        if not collection:
            raise CollectionNotFound(collection_id)
        return collection

    async def create_collection(
        self,
        *,
        name: str,
        collection_type: str,
        description: Optional[str],
        loop_enabled: bool,
        shuffle_enabled: bool,
        items: Sequence[Tuple[UUID, int, str]],
    ) -> MediaCollection:
        collection = MediaCollection(
            user_id=self.user_id,
            name=name.strip(),
            description=description,
            collection_type=collection_type,
            loop_enabled=loop_enabled,
            shuffle_enabled=shuffle_enabled,
        )
        self.db.add(collection)
        await self.db.flush()

        await self._replace_items(collection, items)
        return collection

    async def update_collection(
        self,
        collection_id: UUID,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        loop_enabled: Optional[bool] = None,
        shuffle_enabled: Optional[bool] = None,
        items: Optional[Sequence[Tuple[UUID, int, str]]] = None,
    ) -> MediaCollection:
        collection = await self.get_collection(collection_id)

        if name is not None:
            collection.name = name.strip()
        if description is not None:
            collection.description = description
        if loop_enabled is not None:
            collection.loop_enabled = loop_enabled
        if shuffle_enabled is not None:
            collection.shuffle_enabled = shuffle_enabled

        if items is not None:
            await self._replace_items(collection, items)

        await self.db.flush()
        return collection

    async def reorder_collection(self, collection_id: UUID, order: Sequence[UUID]) -> MediaCollection:
        collection = await self.get_collection(collection_id)
        existing_ids = [item.id for item in collection.items]
        if set(existing_ids) != set(order):
            raise CollectionItemOrderError("Provided order does not match collection items")

        order_map = {item_id: index for index, item_id in enumerate(order)}
        for item in collection.items:
            item.position = order_map[item.id]

        await self.db.flush()
        return collection

    async def remove_asset_from_collections(self, asset_id: UUID) -> List[UUID]:
        query = (
            select(CollectionItem)
            .join(MediaCollection)
            .where(
                CollectionItem.asset_id == asset_id,
                MediaCollection.user_id == self.user_id,
            )
        )
        result = await self.db.execute(query)
        items = result.scalars().all()
        if not items:
            return []

        collection_ids: List[UUID] = []
        for item in items:
            collection_ids.append(item.collection_id)
            await self.db.delete(item)

        await self.db.flush()

        await self._renumber_positions(collection_ids)
        return collection_ids

    async def _replace_items(
        self,
        collection: MediaCollection,
        items: Sequence[Tuple[UUID, int, str]],
    ) -> None:
        await self.db.execute(
            delete(CollectionItem).where(CollectionItem.collection_id == collection.id)
        )
        await self.db.flush()

        if not items:
            collection.items = []
            return

        validated_assets = await self._load_assets([asset_id for asset_id, _, _ in items])

        new_items: List[CollectionItem] = []
        for asset_id, position, loop_mode in items:
            asset = validated_assets[asset_id]
            if collection.collection_type == "video_background" and asset.asset_type != "video":
                raise InvalidCollectionAsset(asset_id, "Only video assets allowed in a video collection")
            if collection.collection_type == "audio_playlist" and asset.asset_type != "audio":
                raise InvalidCollectionAsset(asset_id, "Only audio assets allowed in an audio collection")

            new_items.append(
                CollectionItem(
                    collection_id=collection.id,
                    asset_id=asset_id,
                    position=position,
                    loop_mode=loop_mode,
                )
            )

        for item in new_items:
            self.db.add(item)
        await self.db.flush()
        await self._renumber_positions([collection.id])
        await self.db.refresh(collection)

    async def _load_assets(self, asset_ids: Sequence[UUID]) -> Dict[UUID, Asset]:
        if not asset_ids:
            return {}
        query = select(Asset).where(
            Asset.user_id == self.user_id,
            Asset.id.in_(asset_ids),
        )
        result = await self.db.execute(query)
        assets = {asset.id: asset for asset in result.scalars()}
        missing = [asset_id for asset_id in asset_ids if asset_id not in assets]
        if missing:
            raise InvalidCollectionAsset(missing[0], "Asset not found or does not belong to user")
        return assets

    async def _renumber_positions(self, collection_ids: Sequence[UUID]) -> None:
        if not collection_ids:
            return
        query = (
            select(CollectionItem)
            .where(CollectionItem.collection_id.in_(collection_ids))
            .order_by(CollectionItem.collection_id, CollectionItem.position, CollectionItem.created_at)
        )
        result = await self.db.execute(query)
        all_items = result.scalars().all()

        by_collection: Dict[UUID, List[CollectionItem]] = {}
        for item in all_items:
            by_collection.setdefault(item.collection_id, []).append(item)

        for coll_id, items in by_collection.items():
            for index, item in enumerate(sorted(items, key=lambda x: (x.position, x.created_at))):
                item.position = index
        await self.db.flush()
