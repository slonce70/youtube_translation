"""
Helpers for working with media collections and their items.
"""

from __future__ import annotations

from typing import Iterable, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Asset, CollectionItem, MediaCollection
from app.schemas.api import CollectionItemCreate

ALLOWED_LOOP_MODES = {"loop", "once", "shuffle"}


def normalize_collection_items(
    items: Iterable[CollectionItemCreate],
) -> List[CollectionItemCreate]:
    """
    Deduplicate, sanitize, and reindex collection items.
    """
    seen_assets: set[UUID] = set()
    normalized: List[CollectionItemCreate] = []

    sorted_items = sorted(items, key=lambda item: item.position)

    for index, item in enumerate(sorted_items):
        if item.asset_id in seen_assets:
            continue
        seen_assets.add(item.asset_id)

        loop_mode = item.loop_mode if item.loop_mode in ALLOWED_LOOP_MODES else "loop"
        normalized.append(
            CollectionItemCreate(
                asset_id=item.asset_id,
                position=index,
                loop_mode=loop_mode,
            )
        )

    return normalized


async def validate_collection_assets(
    db: AsyncSession,
    user_id: UUID,
    items: List[CollectionItemCreate],
    expected_type: Optional[str],
) -> None:
    """
    Ensure that collection items reference existing assets of the expected type.
    """
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one asset is required",
        )

    asset_ids = [item.asset_id for item in items]
    result = await db.execute(
        select(Asset.id, Asset.asset_type).where(
            Asset.user_id == user_id,
            Asset.id.in_(asset_ids),
        )
    )
    existing = {row[0]: row[1] for row in result.all()}

    missing = [str(asset_id) for asset_id in asset_ids if asset_id not in existing]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"missing_assets": missing},
        )

    if expected_type:
        mismatched = [
            str(asset_id)
            for asset_id, asset_type in existing.items()
            if asset_type != expected_type
        ]
        if mismatched:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "invalid_asset_type": mismatched,
                    "expected": expected_type,
                },
            )


async def replace_collection_items(
    db: AsyncSession,
    collection: MediaCollection,
    items: List[CollectionItemCreate],
) -> None:
    """
    Replace all items within a collection with the provided set.
    """
    await db.execute(
        delete(CollectionItem).where(CollectionItem.collection_id == collection.id)
    )

    for position, item in enumerate(items):
        db.add(
            CollectionItem(
                collection_id=collection.id,
                asset_id=item.asset_id,
                position=position,
                loop_mode=item.loop_mode,
            )
        )
