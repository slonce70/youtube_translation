"""Business logic for playlist CRUD and validation."""

from __future__ import annotations

import logging
from typing import Iterable, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.quota import QuotaEnforcer
from app.models.database import Asset, Playlist, PlaylistItem, Stream
from app.schemas.api import (
    PlaylistCreate,
    PlaylistItemResponse,
    PlaylistResponse,
    PlaylistUpdate,
)
from app.services.assets.storage import resolve_asset_local_path
from app.streaming.playlist_builder import PlaylistBuilder

logger = logging.getLogger(__name__)


class PlaylistService:
    """Encapsulates playlist operations for a user."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: UUID,
        quota_cls: type[QuotaEnforcer] = QuotaEnforcer,
        builder: type[PlaylistBuilder] = PlaylistBuilder,
    ):
        self.db = db
        self.user_id = user_id
        self.quota_cls = quota_cls
        self.builder = builder

    # See destinations/service.py for the rationale behind these constants.
    DEFAULT_LIST_LIMIT = 500
    MAX_LIST_LIMIT = 2000

    async def list_playlists(
        self, limit: int = DEFAULT_LIST_LIMIT
    ) -> List[PlaylistResponse]:
        bounded = max(1, min(limit, self.MAX_LIST_LIMIT))
        query = (
            select(Playlist)
            .where(Playlist.user_id == self.user_id)
            .options(selectinload(Playlist.items))
            .order_by(Playlist.created_at.desc(), Playlist.id.desc())
            .limit(bounded)
        )

        result = await self.db.execute(query)
        playlists = result.scalars().unique().all()
        return [self._to_response(playlist) for playlist in playlists]

    async def create_playlist(self, payload: PlaylistCreate) -> PlaylistResponse:
        enforcer = self.quota_cls(self.db, self.user_id)
        await enforcer.check_playlists_limit()

        playlist = Playlist(
            user_id=self.user_id,
            name=payload.name,
            description=payload.description,
            loop=payload.loop,
        )

        self.db.add(playlist)
        await self.db.flush()

        await self._insert_items(playlist.id, payload.items)

        await self.db.commit()
        await self.db.refresh(playlist, attribute_names=["items"])

        logger.info("Created playlist %s for user %s", playlist.id, self.user_id)
        return self._to_response(playlist)

    async def get_playlist(self, playlist_id: UUID) -> PlaylistResponse:
        playlist = await self._load_playlist(playlist_id, include_items=True)
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found"
            )
        return self._to_response(playlist)

    async def update_playlist(
        self, playlist_id: UUID, payload: PlaylistUpdate
    ) -> PlaylistResponse:
        playlist = await self._load_playlist(playlist_id, include_items=True)
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found"
            )

        if payload.name is not None:
            playlist.name = payload.name
        if payload.description is not None:
            playlist.description = payload.description
        if payload.loop is not None:
            playlist.loop = payload.loop

        try:
            await self.db.commit()
            await self.db.refresh(playlist, attribute_names=["items"])
            return self._to_response(playlist)
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning(
                "Playlist update conflict for user %s: %s", self.user_id, exc
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Playlist update violates constraints",
            ) from exc
        except Exception as exc:  # pragma: no cover
            await self.db.rollback()
            logger.exception(
                "Error updating playlist %s for user %s: %s",
                playlist_id,
                self.user_id,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update playlist",
            ) from exc

    async def delete_playlist(self, playlist_id: UUID) -> None:
        playlist = await self._load_playlist(playlist_id, include_items=False)
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found"
            )

        in_use_query = select(Stream.id).where(
            Stream.playlist_id == playlist_id, Stream.user_id == self.user_id
        )
        in_use_result = await self.db.execute(in_use_query.limit(1))
        if in_use_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete playlist while streams are using it",
            )

        await self.db.execute(delete(Playlist).where(Playlist.id == playlist_id))
        await self.db.commit()
        logger.info("Deleted playlist %s", playlist_id)

    async def validate_playlist(self, playlist_id: UUID) -> dict:
        playlist = await self._load_playlist(
            playlist_id, include_items=True, with_assets=True
        )
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found"
            )

        assets_data = [
            {
                "path": str(
                    resolve_asset_local_path(
                        item.asset,
                        self.user_id,
                        must_exist=True,
                    ).resolve()
                ),
                "meta": item.asset.meta,
                "asset_id": str(item.asset.id),
                "filename": item.asset.filename,
            }
            for item in sorted(playlist.items, key=lambda x: x.position)
        ]

        is_compatible, issues = self.builder.validate_playlist_assets(assets_data)
        return {
            "playlist_id": playlist_id,
            "compatible": is_compatible,
            "assets_count": len(assets_data),
            "issues": issues,
        }

    async def _insert_items(self, playlist_id: UUID, items: Iterable) -> None:
        """Bulk-validate every item's asset in a single SELECT instead of N.

        Pre-Sprint-5 this issued one ``SELECT`` per item via ``_get_asset``;
        a 100-item playlist meant 100 round-trips. Now we collect all
        ``asset_id``s, run one SELECT bounded by ``user_id``, and validate
        membership in Python.
        """
        items_list = list(items)
        if not items_list:
            return

        asset_ids = [item.asset_id for item in items_list]

        result = await self.db.execute(
            select(Asset.id).where(
                Asset.user_id == self.user_id,
                Asset.id.in_(asset_ids),
            )
        )
        owned_ids = {row[0] for row in result.all()}

        for item_data in items_list:
            if item_data.asset_id not in owned_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Asset {item_data.asset_id} not found",
                )
            playlist_item = PlaylistItem(
                playlist_id=playlist_id,
                asset_id=item_data.asset_id,
                position=item_data.position,
            )
            self.db.add(playlist_item)

    async def _get_asset(self, asset_id: UUID) -> Optional[Asset]:
        result = await self.db.execute(
            select(Asset).where(Asset.id == asset_id, Asset.user_id == self.user_id)
        )
        return result.scalar_one_or_none()

    async def _load_playlist(
        self,
        playlist_id: UUID,
        include_items: bool,
        with_assets: bool = False,
    ) -> Optional[Playlist]:
        query = select(Playlist).where(
            Playlist.id == playlist_id, Playlist.user_id == self.user_id
        )
        if include_items:
            option = selectinload(Playlist.items)
            if with_assets:
                option = option.selectinload(PlaylistItem.asset)
            query = query.options(option)

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    def _to_response(self, playlist: Playlist) -> PlaylistResponse:
        items = sorted(list(playlist.items or []), key=lambda item: item.position)
        return PlaylistResponse(
            user_id=playlist.user_id,
            id=playlist.id,
            name=playlist.name,
            description=playlist.description,
            loop=playlist.loop,
            created_at=playlist.created_at,
            updated_at=playlist.updated_at,
            items=[
                PlaylistItemResponse.model_validate(item, from_attributes=True)
                for item in items
            ],
        )
