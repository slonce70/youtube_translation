"""Cascade update utilities for keeping collections and streams in sync."""
from __future__ import annotations

from typing import Iterable, List, Optional, Sequence, Set
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.models.database import (
    AssetFolderLink,
    CollectionItem,
    MediaCollection,
    Stream,
    SystemAlert,
)


class CascadeUpdateService:
    """Handles cascading updates after destructive media actions."""

    def __init__(self, db, user_id: UUID, logger=None):
        self.db = db
        self.user_id = user_id
        self.logger = logger

    async def handle_asset_removed(self, asset_id: UUID) -> None:
        """Remove asset links from collections and warn affected streams."""
        query = (
            select(CollectionItem)
            .join(MediaCollection)
            .where(
                CollectionItem.asset_id == asset_id,
                MediaCollection.user_id == self.user_id,
            )
            .options(selectinload(CollectionItem.collection))
        )
        result = await self.db.execute(query)
        items = result.scalars().all()
        if not items:
            return

        affected_collections: Set[UUID] = set()
        for item in items:
            affected_collections.add(item.collection_id)
            await self.db.delete(item)

        await self.db.flush()
        await self._renumber_collection_items(affected_collections)
        await self._warn_streams(affected_collections, reason="asset_removed", payload={"asset_id": str(asset_id)})

    async def handle_folder_removed(self, folder_id: UUID, asset_ids: Optional[Sequence[UUID]] = None) -> None:
        """Raise warnings for streams if a folder removal impacts their collections."""
        asset_ids = list(asset_ids or [])
        if not asset_ids:
            asset_query = select(AssetFolderLink.asset_id).where(
                AssetFolderLink.folder_id == folder_id,
                AssetFolderLink.link_type == "folder",
            )
            asset_result = await self.db.execute(asset_query)
            asset_ids = [row.asset_id for row in asset_result]

        if not asset_ids:
            return

        collection_query = (
            select(CollectionItem.collection_id)
            .join(MediaCollection)
            .where(
                CollectionItem.asset_id.in_(asset_ids),
                MediaCollection.user_id == self.user_id,
            )
        )
        collection_result = await self.db.execute(collection_query)
        affected_collections = {row.collection_id for row in collection_result}
        if not affected_collections:
            return

        await self._warn_streams(
            affected_collections,
            reason="folder_removed",
            payload={"folder_id": str(folder_id), "asset_ids": [str(aid) for aid in asset_ids]},
        )

    async def _renumber_collection_items(self, collection_ids: Iterable[UUID]) -> None:
        ids = list(collection_ids)
        if not ids:
            return
        query = (
            select(CollectionItem)
            .where(CollectionItem.collection_id.in_(ids))
            .order_by(CollectionItem.collection_id, CollectionItem.position, CollectionItem.created_at)
        )
        result = await self.db.execute(query)
        items = result.scalars().all()

        by_collection: dict[UUID, List[CollectionItem]] = {}
        for item in items:
            by_collection.setdefault(item.collection_id, []).append(item)

        for coll_id, coll_items in by_collection.items():
            for index, item in enumerate(sorted(coll_items, key=lambda itm: (itm.position, itm.created_at))):
                item.position = index
        await self.db.flush()

    async def _warn_streams(self, collection_ids: Iterable[UUID], *, reason: str, payload: dict) -> None:
        ids = list(collection_ids)
        if not ids:
            return

        stream_query = select(Stream).where(
            Stream.user_id == self.user_id,
            or_(
                Stream.video_collection_id.in_(ids),
                Stream.audio_collection_id.in_(ids),
            ),
        )
        result = await self.db.execute(stream_query)
        streams = result.scalars().all()
        if not streams:
            return

        for stream in streams:
            alert = SystemAlert(
                alert_type="configuration_degraded",
                severity="warning",
                user_id=self.user_id,
                stream_id=stream.id,
                message=f"Stream {stream.id} requires attention after {reason}",
                details={"reason": reason, **payload, "stream_id": str(stream.id)},
            )
            self.db.add(alert)
        await self.db.flush()

        if self.logger:
            self.logger.warning(
                "Cascade update issued %d alerts for reason %s", len(streams), reason
            )
