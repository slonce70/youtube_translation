"""Business logic for media collection CRUD and item management."""

from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.collections import (
    normalize_collection_items,
    replace_collection_items as replace_collection_items_helper,
    validate_collection_assets,
)
from app.models.database import CollectionItem, MediaCollection
from app.schemas.api import (
    CollectionItemResponse,
    CollectionItemsUpdate,
    MediaCollectionCreate,
    MediaCollectionResponse,
    MediaCollectionUpdate,
)

logger = logging.getLogger(__name__)

ALLOWED_COLLECTION_TYPES = {"video_background", "audio_playlist"}


class MediaCollectionService:
    """Encapsulates media collection operations for a user."""

    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id

    async def list_collections(
        self, collection_type: Optional[str], is_active: Optional[bool], include_items: bool
    ) -> List[MediaCollectionResponse]:
        query = select(MediaCollection).where(MediaCollection.user_id == self.user_id)

        if collection_type is not None:
            self._assert_supported_type(collection_type)
            query = query.where(MediaCollection.collection_type == collection_type)

        if is_active is not None:
            query = query.where(MediaCollection.is_active.is_(is_active))

        if include_items:
            query = query.options(
                selectinload(MediaCollection.items).selectinload(CollectionItem.asset)
            )

        query = query.order_by(MediaCollection.created_at)
        result = await self.db.execute(query)
        collections = result.scalars().unique().all()
        return [self._to_response(collection, include_items) for collection in collections]

    async def create_collection(self, payload: MediaCollectionCreate) -> MediaCollectionResponse:
        self._assert_supported_type(payload.collection_type)

        normalized_items = normalize_collection_items(payload.items)
        expected_type = "video" if payload.collection_type == "video_background" else "audio"
        await validate_collection_assets(self.db, self.user_id, normalized_items, expected_type)

        name = payload.name.strip() if payload.name else ""
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Collection name cannot be empty",
            )

        collection = MediaCollection(
            user_id=self.user_id,
            name=name,
            description=payload.description,
            collection_type=payload.collection_type,
            is_active=payload.is_active,
            origin_playlist_id=payload.origin_playlist_id,
        )

        self.db.add(collection)

        try:
            await self.db.flush()
            await replace_collection_items_helper(self.db, collection, normalized_items)
            await self.db.commit()
            await self.db.refresh(collection, attribute_names=["items"])
            return self._to_response(collection)
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning("Collection creation conflict for user %s: %s", self.user_id, exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Collection violates uniqueness constraints",
            ) from exc
        except Exception as exc:  # pragma: no cover
            await self.db.rollback()
            logger.exception("Error creating collection for user %s: %s", self.user_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create collection",
            ) from exc

    async def get_collection(
        self, collection_id: UUID, include_items: bool
    ) -> MediaCollectionResponse:
        collection = await self._load_collection(collection_id, include_items)
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        return self._to_response(collection, include_items)

    async def update_collection(
        self, collection_id: UUID, payload: MediaCollectionUpdate
    ) -> MediaCollectionResponse:
        collection = await self._load_collection(collection_id, include_items=True)
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

        if payload.name is not None:
            new_name = payload.name.strip()
            if not new_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Collection name cannot be empty",
                )
            collection.name = new_name

        if payload.description is not None:
            collection.description = payload.description

        if payload.is_active is not None:
            collection.is_active = payload.is_active

        try:
            await self.db.commit()
            await self.db.refresh(collection, attribute_names=["items"])
            return self._to_response(collection)
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning("Collection update conflict for user %s: %s", self.user_id, exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Collection update violates constraints",
            ) from exc
        except Exception as exc:  # pragma: no cover
            await self.db.rollback()
            logger.exception(
                "Error updating collection %s for user %s: %s", collection_id, self.user_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update collection",
            ) from exc

    async def replace_items(
        self, collection_id: UUID, payload: CollectionItemsUpdate
    ) -> MediaCollectionResponse:
        collection = await self._load_collection(collection_id, include_items=True)
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

        normalized_items = normalize_collection_items(payload.items)
        expected_type = "video" if collection.collection_type == "video_background" else "audio"
        await validate_collection_assets(self.db, self.user_id, normalized_items, expected_type)

        try:
            await replace_collection_items_helper(self.db, collection, normalized_items)
            await self.db.commit()
            await self.db.refresh(collection, attribute_names=["items"])
            return self._to_response(collection)
        except Exception as exc:  # pragma: no cover
            await self.db.rollback()
            logger.exception("Error replacing collection items for %s: %s", collection_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update collection items",
            ) from exc

    async def delete_collection(self, collection_id: UUID) -> None:
        collection = await self._load_collection(collection_id, include_items=False)
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

        await self.db.execute(delete(MediaCollection).where(MediaCollection.id == collection_id))
        await self.db.commit()
        logger.info("Deleted media collection %s for user %s", collection_id, self.user_id)

    async def _load_collection(
        self, collection_id: UUID, include_items: bool
    ) -> Optional[MediaCollection]:
        query = select(MediaCollection).where(
            MediaCollection.id == collection_id,
            MediaCollection.user_id == self.user_id,
        )

        if include_items:
            query = query.options(
                selectinload(MediaCollection.items).selectinload(CollectionItem.asset)
            )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    def _assert_supported_type(self, collection_type: str) -> None:
        if collection_type not in ALLOWED_COLLECTION_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported collection type",
            )

    def _to_response(
        self, collection: MediaCollection, include_items: bool = True
    ) -> MediaCollectionResponse:
        if include_items:
            items = sorted(list(collection.items or []), key=lambda item: item.position)
            response_items = [
                CollectionItemResponse.model_validate(item, from_attributes=True) for item in items
            ]
        else:
            response_items = []

        return MediaCollectionResponse(
            id=collection.id,
            user_id=collection.user_id,
            name=collection.name,
            description=collection.description,
            collection_type=collection.collection_type,
            is_active=collection.is_active,
            origin_playlist_id=collection.origin_playlist_id,
            created_at=collection.created_at,
            updated_at=collection.updated_at,
            items=response_items,
        )
