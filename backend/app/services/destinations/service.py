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
from app.models.database import Destination
from app.schemas.api import DestinationCreate, DestinationResponse, DestinationUpdate

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
        return [self._to_response(dest) for dest in destinations]

    async def create_destination(
        self, payload: DestinationCreate
    ) -> DestinationResponse:
        enforcer = QuotaEnforcer(self.db, self.user_id)
        await enforcer.check_destinations_limit()
        await enforcer.ensure_destination_allowed(payload.rtmps_url)

        encrypted_key = encrypt_stream_key(payload.stream_key)

        destination = Destination(
            user_id=self.user_id,
            name=payload.name,
            rtmps_url=payload.rtmps_url,
            stream_key_encrypted=encrypted_key,
            enabled=payload.enabled,
        )

        self.db.add(destination)
        await self.db.commit()
        await self.db.refresh(destination)

        logger.info("Created destination %s for user %s", destination.id, self.user_id)
        return self._to_response(
            destination, masked_key=mask_stream_key(payload.stream_key)
        )

    async def get_destination(self, destination_id: UUID) -> DestinationResponse:
        destination = await self._get_destination(destination_id)
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

        await self.db.commit()
        await self.db.refresh(destination)

        logger.info("Updated destination %s for user %s", destination_id, self.user_id)
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
