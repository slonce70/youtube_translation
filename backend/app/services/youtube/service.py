from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import encrypt_secret
from app.models.database import YoutubeConnection
from app.schemas.api import YoutubeConnectionResponse

from .client import YoutubeClient
from .oauth_state import create_oauth_state
from .provider_status import YoutubeProviderStatusService


class YoutubeConnectionService:
    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id
        self.client = YoutubeClient()

    async def build_oauth_start(
        self, *, redirect_origin: str, redirect_path: str
    ) -> str:
        state = create_oauth_state(
            user_id=self.user_id,
            redirect_origin=redirect_origin,
            redirect_path=redirect_path,
        )
        return self.client.build_authorization_url(state=state)

    async def list_connections(self) -> list[YoutubeConnectionResponse]:
        result = await self.db.execute(
            select(YoutubeConnection)
            .where(YoutubeConnection.user_id == self.user_id)
            .order_by(YoutubeConnection.created_at.desc())
        )
        connections = result.scalars().all()
        status_service = YoutubeProviderStatusService(self.db)
        snapshots = await status_service.enrich_connections(connections)
        return [
            self._to_response(connection, snapshots.get(connection.id))
            for connection in connections
        ]

    async def delete_connection(self, connection_id: UUID) -> None:
        connection = await self._get_connection(connection_id)
        await self.db.delete(connection)

    async def upsert_connection_from_code(
        self, *, user_id: UUID, code: str
    ) -> YoutubeConnection:
        token_bundle = await self.client.exchange_code(code)
        identity = await self.client.fetch_channel_identity(token_bundle.access_token)
        channel_id = identity.get("channel_id")
        if not channel_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="YouTube channel id was not returned",
            )
        result = await self.db.execute(
            select(YoutubeConnection).where(
                YoutubeConnection.user_id == user_id,
                YoutubeConnection.youtube_channel_id == channel_id,
            )
        )
        connection = result.scalar_one_or_none()
        if connection is None:
            connection = YoutubeConnection(
                user_id=user_id,
                youtube_channel_id=channel_id,
            )
            self.db.add(connection)
        connection.youtube_channel_title = identity.get("channel_title")
        connection.access_token_encrypted = encrypt_secret(token_bundle.access_token)
        if token_bundle.refresh_token:
            connection.refresh_token_encrypted = encrypt_secret(
                token_bundle.refresh_token
            )
        connection.token_expires_at = token_bundle.expires_at
        connection.scopes_json = token_bundle.scopes
        connection.last_sync_error = None
        await self.db.flush()
        return connection

    def _to_response(
        self, connection: YoutubeConnection, snapshot=None
    ) -> YoutubeConnectionResponse:
        return YoutubeConnectionResponse(
            id=connection.id,
            youtube_channel_id=connection.youtube_channel_id,
            youtube_channel_title=connection.youtube_channel_title,
            scopes=list(connection.scopes_json or []),
            created_at=connection.created_at,
            updated_at=connection.updated_at,
            last_sync_at=connection.last_sync_at,
            last_sync_error=connection.last_sync_error,
            provider_status=getattr(snapshot, "provider_status", "unknown"),
            provider_viewers=getattr(snapshot, "provider_viewers", None),
            provider_last_checked_at=getattr(
                snapshot, "provider_last_checked_at", None
            ),
            provider_video_id=getattr(snapshot, "provider_video_id", None),
        )

    async def _get_connection(self, connection_id: UUID) -> YoutubeConnection:
        result = await self.db.execute(
            select(YoutubeConnection).where(
                YoutubeConnection.id == connection_id,
                YoutubeConnection.user_id == self.user_id,
            )
        )
        connection = result.scalar_one_or_none()
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="YouTube connection not found",
            )
        return connection
