"""Business logic for destination management."""

from __future__ import annotations

import logging
from typing import List
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quota import QuotaEnforcer
from app.core.security import decrypt_stream_key, encrypt_stream_key, mask_stream_key
from app.models.database import Destination, YoutubeConnection
from app.schemas.api import DestinationCreate, DestinationResponse, DestinationUpdate
from app.services.youtube import YoutubeProviderStatusService

logger = logging.getLogger(__name__)


class DestinationService:
    """Encapsulates destination CRUD operations for a user."""

    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id

    async def list_destinations(self) -> List[DestinationResponse]:
        result = await self.db.execute(
            select(Destination).where(Destination.user_id == self.user_id)
        )
        destinations = result.scalars().all()
        await YoutubeProviderStatusService(self.db).enrich_destinations(destinations)
        return [self._to_response(dest) for dest in destinations]

    async def create_destination(
        self, payload: DestinationCreate
    ) -> DestinationResponse:
        enforcer = QuotaEnforcer(self.db, self.user_id)
        await enforcer.check_destinations_limit()
        await enforcer.ensure_destination_allowed(payload.rtmps_url)

        encrypted_key = encrypt_stream_key(payload.stream_key)
        provider_connection = await self._resolve_provider_connection(
            payload.provider_connection_id
        )

        destination = Destination(
            user_id=self.user_id,
            name=payload.name,
            rtmps_url=payload.rtmps_url,
            stream_key_encrypted=encrypted_key,
            enabled=payload.enabled,
            provider_kind="youtube" if provider_connection else None,
            provider_connection_id=(
                provider_connection.id if provider_connection else None
            ),
            provider_channel_id=(
                provider_connection.youtube_channel_id if provider_connection else None
            ),
        )

        self.db.add(destination)
        await self.db.commit()
        await self.db.refresh(destination)

        logger.info("Created destination %s for user %s", destination.id, self.user_id)
        await YoutubeProviderStatusService(self.db).enrich_destinations([destination])
        return self._to_response(
            destination, masked_key=mask_stream_key(payload.stream_key)
        )

    async def get_destination(self, destination_id: UUID) -> DestinationResponse:
        destination = await self._get_destination(destination_id)
        await YoutubeProviderStatusService(self.db).enrich_destinations([destination])
        return self._to_response(destination)

    async def update_destination(
        self, destination_id: UUID, payload: DestinationUpdate
    ) -> DestinationResponse:
        destination = await self._get_destination(destination_id)

        enforcer = QuotaEnforcer(self.db, self.user_id)
        await enforcer.check_suspended()

        if payload.name is not None:
            destination.name = payload.name

        if payload.rtmps_url is not None:
            await enforcer.ensure_destination_allowed(payload.rtmps_url)
            destination.rtmps_url = payload.rtmps_url

        if payload.stream_key is not None and payload.stream_key.strip():
            destination.stream_key_encrypted = encrypt_stream_key(payload.stream_key)
            masked_key_override = mask_stream_key(payload.stream_key)
        else:
            masked_key_override = None

        if payload.enabled is not None:
            destination.enabled = payload.enabled

        if "provider_connection_id" in payload.model_fields_set:
            provider_connection = await self._resolve_provider_connection(
                payload.provider_connection_id
            )
            destination.provider_connection_id = (
                provider_connection.id if provider_connection else None
            )
            destination.provider_kind = "youtube" if provider_connection else None
            destination.provider_channel_id = (
                provider_connection.youtube_channel_id if provider_connection else None
            )

        await self.db.commit()
        await self.db.refresh(destination)

        logger.info("Updated destination %s for user %s", destination_id, self.user_id)
        await YoutubeProviderStatusService(self.db).enrich_destinations([destination])
        return self._to_response(destination, masked_key=masked_key_override)

    async def delete_destination(self, destination_id: UUID) -> None:
        await self._get_destination(destination_id)
        await self.db.execute(
            delete(Destination).where(
                Destination.id == destination_id,
                Destination.user_id == self.user_id,
            )
        )
        await self.db.commit()
        logger.info("Deleted destination %s for user %s", destination_id, self.user_id)

    async def _get_destination(self, destination_id: UUID) -> Destination:
        result = await self.db.execute(
            select(Destination).where(
                Destination.id == destination_id,
                Destination.user_id == self.user_id,
            )
        )
        destination = result.scalar_one_or_none()
        if not destination:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Destination not found"
            )
        return destination

    def _to_response(
        self, destination: Destination, masked_key: str | None = None
    ) -> DestinationResponse:
        stream_key_masked = (
            masked_key
            if masked_key is not None
            else self._mask_destination_key(destination)
        )
        return DestinationResponse(
            id=destination.id,
            name=destination.name,
            rtmps_url=destination.rtmps_url,
            enabled=destination.enabled,
            provider_connection_id=destination.provider_connection_id,
            provider_kind=destination.provider_kind,
            provider_channel_id=destination.provider_channel_id,
            provider_status=getattr(destination, "_provider_status", "unknown"),
            provider_viewers=getattr(destination, "_provider_viewers", None),
            provider_last_checked_at=getattr(
                destination, "_provider_last_checked_at", None
            ),
            provider_video_id=getattr(destination, "_provider_video_id", None),
            stream_key_masked=stream_key_masked,
            created_at=destination.created_at,
            updated_at=destination.updated_at,
        )

    def _mask_destination_key(self, destination: Destination) -> str:
        if not destination.stream_key_encrypted:
            return ""
        try:
            decrypted = decrypt_stream_key(destination.stream_key_encrypted)
            return mask_stream_key(decrypted)
        except Exception as exc:  # pragma: no cover - logging path
            logger.exception(
                "Failed to decrypt stream key for destination %s: %s",
                destination.id,
                exc,
            )
            return ""

    async def _resolve_provider_connection(
        self, provider_connection_id: UUID | None
    ) -> YoutubeConnection | None:
        if provider_connection_id is None:
            return None
        result = await self.db.execute(
            select(YoutubeConnection).where(
                YoutubeConnection.id == provider_connection_id,
                YoutubeConnection.user_id == self.user_id,
            )
        )
        provider_connection = result.scalar_one_or_none()
        if provider_connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="YouTube connection not found",
            )
        return provider_connection
