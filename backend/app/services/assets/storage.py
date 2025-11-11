"""Storage helpers shared across asset services."""

from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    CollectionItem,
    MediaCollection,
    SystemAlert,
    UserProfile,
)

logger = logging.getLogger(__name__)


async def apply_storage_delta(db: AsyncSession, user_id: UUID, delta_bytes: int) -> None:
    if not delta_bytes:
        return

    await db.execute(
        update(UserProfile)
        .where(UserProfile.user_id == user_id)
        .values(
            current_storage_bytes=func.GREATEST(
                func.coalesce(UserProfile.current_storage_bytes, 0) + delta_bytes,
                0,
            )
        )
    )


async def audit_collection_quorum(
    db: AsyncSession,
    collection_ids: List[UUID],
    asset_id: Optional[UUID] = None,
) -> None:
    if not collection_ids:
        return

    unique_ids = list({cid for cid in collection_ids if cid is not None})
    if not unique_ids:
        return

    result = await db.execute(
        select(
            MediaCollection.id,
            MediaCollection.user_id,
            MediaCollection.name,
            MediaCollection.collection_type,
            func.count(CollectionItem.id).label("items"),
        )
        .outerjoin(CollectionItem, CollectionItem.collection_id == MediaCollection.id)
        .where(MediaCollection.id.in_(unique_ids))
        .group_by(
            MediaCollection.id,
            MediaCollection.user_id,
            MediaCollection.name,
            MediaCollection.collection_type,
        )
    )

    depleted: List[MediaCollection] = []
    for row in result.all():
        if row.items == 0:
            collection = await db.get(MediaCollection, row.id)
            if collection and collection.is_active:
                collection.is_active = False
                depleted.append(collection)

    for collection in depleted:
        alert = SystemAlert(
            user_id=collection.user_id,
            alert_type="collection_depleted",
            severity="warning",
            asset_id=asset_id,
            message=f"Collection '{collection.name}' no longer contains assets",
            details={
                "collection_id": str(collection.id),
                "collection_type": collection.collection_type,
            },
        )
        db.add(alert)

