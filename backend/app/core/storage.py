"""Utilities for tracking per-user media storage usage."""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Asset, UserProfile

logger = logging.getLogger(__name__)


async def adjust_storage_usage(
    db: AsyncSession,
    user_id: UUID,
    delta_bytes: int,
) -> Optional[int]:
    """Incrementally adjust the stored storage usage for a user.

    Args:
        db: Database session.
        user_id: Owner of the assets.
        delta_bytes: Positive or negative delta in bytes.

    Returns:
        The updated storage usage in bytes if a profile was updated, otherwise ``None``.
    """

    if not delta_bytes:
        return None

    stmt = (
        update(UserProfile)
        .where(UserProfile.user_id == user_id)
        .values(
            current_storage_bytes=func.greatest(
                0,
                func.coalesce(UserProfile.current_storage_bytes, 0) + delta_bytes,
            ),
            updated_at=func.now(),
        )
        .returning(UserProfile.current_storage_bytes)
    )

    result = await db.execute(stmt)
    new_value = result.scalar_one_or_none()

    if new_value is None:
        logger.warning("Attempted to adjust storage for missing profile %s", user_id)

    return new_value


async def recalculate_storage_usage(db: AsyncSession, user_id: UUID) -> Optional[int]:
    """Recompute storage usage for a user from scratch.

    Args:
        db: Database session.
        user_id: Owner of the assets.

    Returns:
        The recalculated usage in bytes if a profile exists, otherwise ``None``.
    """

    total_stmt = select(func.coalesce(func.sum(Asset.size_bytes), 0)).where(
        Asset.user_id == user_id
    )
    total_bytes = (await db.execute(total_stmt)).scalar_one()

    stmt = (
        update(UserProfile)
        .where(UserProfile.user_id == user_id)
        .values(current_storage_bytes=total_bytes, updated_at=func.now())
        .returning(UserProfile.current_storage_bytes)
    )

    result = await db.execute(stmt)
    updated = result.scalar_one_or_none()

    if updated is None:
        logger.warning("Attempted to recalculate storage for missing profile %s", user_id)
        return None

    return updated
