from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decrypt_secret, encrypt_secret
from app.models.database import Destination, Stream, YoutubeConnection

from .client import YoutubeApiError, YoutubeClient

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None


@dataclass
class ProviderStatusSnapshot:
    provider_status: str = "unknown"
    provider_viewers: Optional[int] = None
    provider_last_checked_at: Optional[datetime] = None
    provider_video_id: Optional[str] = None
    error: Optional[str] = None


_memory_cache: dict[str, tuple[float, str]] = {}
_memory_lock = asyncio.Lock()
_redis_client = None


class YoutubeProviderStatusService:
    def __init__(self, db: AsyncSession, *, settings_provider=settings):
        self.db = db
        self.settings = settings_provider
        self.client = YoutubeClient(settings_provider)

    async def enrich_destinations(self, destinations: Sequence[Destination]) -> None:
        connection_ids = {
            destination.provider_connection_id
            for destination in destinations
            if destination.provider_connection_id
        }
        snapshots = await self._get_snapshots(connection_ids)
        for destination in destinations:
            snapshot = (
                snapshots.get(destination.provider_connection_id)
                or ProviderStatusSnapshot()
            )
            self._apply_snapshot(destination, snapshot)

    async def enrich_streams(self, streams: Sequence[Stream]) -> None:
        destinations: list[Destination] = []
        for stream in streams:
            for link in stream.stream_destinations or []:
                if link.destination:
                    destinations.append(link.destination)
        await self.enrich_destinations(destinations)

    async def enrich_connections(
        self, connections: Sequence[YoutubeConnection]
    ) -> dict[UUID, ProviderStatusSnapshot]:
        snapshots = await self._get_snapshots(
            {connection.id for connection in connections}
        )
        return snapshots

    async def _get_snapshots(
        self, connection_ids: Iterable[UUID | None]
    ) -> dict[UUID, ProviderStatusSnapshot]:
        ids = [connection_id for connection_id in connection_ids if connection_id]
        if not ids:
            return {}
        result = await self.db.execute(
            select(YoutubeConnection).where(YoutubeConnection.id.in_(ids))
        )
        connections = {
            connection.id: connection for connection in result.scalars().all()
        }
        snapshots: dict[UUID, ProviderStatusSnapshot] = {}
        for connection_id in ids:
            connection = connections.get(connection_id)
            if connection is None:
                continue
            snapshots[connection_id] = await self._snapshot_for_connection(connection)
        return snapshots

    async def _snapshot_for_connection(
        self, connection: YoutubeConnection
    ) -> ProviderStatusSnapshot:
        cache_key = f"youtube-provider-status:{connection.id}"
        cached = await self._cache_get(cache_key)
        if cached:
            return cached

        try:
            access_token = await self._get_valid_access_token(connection)
            active_broadcast = await self.client.fetch_active_broadcast(access_token)
            checked_at = datetime.now(timezone.utc)
            if not active_broadcast:
                snapshot = ProviderStatusSnapshot(
                    provider_status="offline",
                    provider_last_checked_at=checked_at,
                )
            else:
                video_id = active_broadcast.get("id")
                live_details = (
                    await self.client.fetch_video_live_details(access_token, video_id)
                    if video_id
                    else {}
                )
                viewers_raw = live_details.get("concurrentViewers")
                viewers = int(viewers_raw) if viewers_raw is not None else None
                snapshot = ProviderStatusSnapshot(
                    provider_status="live",
                    provider_viewers=viewers,
                    provider_last_checked_at=checked_at,
                    provider_video_id=video_id,
                )
            connection.last_sync_at = snapshot.provider_last_checked_at
            connection.last_sync_error = None
            await self._cache_set(cache_key, snapshot)
            return snapshot
        except Exception as exc:  # pragma: no cover - covered via service tests
            logger.warning(
                "Failed to refresh YouTube provider status for connection %s: %s",
                connection.id,
                exc,
            )
            connection.last_sync_error = "provider_status_refresh_failed"
            if connection.last_sync_at:
                return ProviderStatusSnapshot(
                    provider_status="stale",
                    provider_last_checked_at=connection.last_sync_at,
                    error="provider_status_refresh_failed",
                )
            return ProviderStatusSnapshot(
                provider_status="unknown",
                error="provider_status_refresh_failed",
            )

    async def _get_valid_access_token(self, connection: YoutubeConnection) -> str:
        expires_at = connection.token_expires_at
        now = datetime.now(timezone.utc)
        if expires_at is None or expires_at > now:
            return decrypt_secret(connection.access_token_encrypted)
        if not connection.refresh_token_encrypted:
            raise YoutubeApiError("YouTube refresh token is missing")
        refreshed = await self.client.refresh_access_token(
            decrypt_secret(connection.refresh_token_encrypted)
        )
        connection.access_token_encrypted = encrypt_secret(refreshed.access_token)
        if refreshed.refresh_token:
            connection.refresh_token_encrypted = encrypt_secret(refreshed.refresh_token)
        connection.token_expires_at = refreshed.expires_at
        if refreshed.scopes:
            connection.scopes_json = refreshed.scopes
        return refreshed.access_token

    @staticmethod
    def _apply_snapshot(
        destination: Destination, snapshot: ProviderStatusSnapshot
    ) -> None:
        setattr(destination, "_provider_status", snapshot.provider_status)
        setattr(destination, "_provider_viewers", snapshot.provider_viewers)
        setattr(
            destination, "_provider_last_checked_at", snapshot.provider_last_checked_at
        )
        setattr(destination, "_provider_video_id", snapshot.provider_video_id)

    async def _cache_get(self, key: str) -> Optional[ProviderStatusSnapshot]:
        raw: Optional[str] = None
        client = await self._redis_client()
        if client is not None:
            raw = await client.get(key)
        if raw is None:
            async with _memory_lock:
                cached_entry = _memory_cache.get(key)
                if cached_entry is not None:
                    expires_at, cached_value = cached_entry
                    if expires_at > asyncio.get_event_loop().time():
                        raw = cached_value
                    else:
                        _memory_cache.pop(key, None)
        if not raw:
            return None
        payload = json.loads(raw)
        checked = payload.get("provider_last_checked_at")
        if checked:
            payload["provider_last_checked_at"] = datetime.fromisoformat(checked)
        return ProviderStatusSnapshot(**payload)

    async def _cache_set(self, key: str, snapshot: ProviderStatusSnapshot) -> None:
        payload = asdict(snapshot)
        checked = payload.get("provider_last_checked_at")
        if checked is not None:
            payload["provider_last_checked_at"] = checked.isoformat()
        serialized = json.dumps(payload)
        ttl = max(int(self.settings.youtube_provider_status_ttl_seconds), 1)
        client = await self._redis_client()
        if client is not None:
            await client.set(key, serialized, ex=ttl)
            return
        async with _memory_lock:
            _memory_cache[key] = (asyncio.get_event_loop().time() + ttl, serialized)

    async def _redis_client(self):
        global _redis_client
        if not self.settings.redis_url or redis is None:
            return None
        if _redis_client is None:
            _redis_client = redis.from_url(
                self.settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        return _redis_client
