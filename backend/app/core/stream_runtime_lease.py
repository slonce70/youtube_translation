"""Database-backed runtime leases for stream ownership.

This layer prevents multiple runtime nodes from trying to manage the same
stream at once. It complements the shared heartbeat files by keeping the
current runtime owner in the database, which is visible to all API workers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.database import Stream


@dataclass(slots=True)
class StreamRuntimeLeaseResult:
    acquired: bool
    owner_id: Optional[str]
    expires_at: Optional[datetime]


def runtime_lease_owner_id(owner_id: Optional[str] = None) -> str:
    value = (owner_id or settings.stream_runtime_node_id or "").strip()
    return value or "unknown-node"


def _coerce_stream_id(stream_id: UUID | str) -> UUID | str:
    if isinstance(stream_id, UUID):
        return stream_id
    try:
        return UUID(str(stream_id))
    except ValueError:
        return str(stream_id)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def runtime_lease_expiry(
    *,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> datetime:
    effective_now = (now or utcnow()).astimezone(timezone.utc)
    ttl = max(int(ttl_seconds or settings.stream_runtime_lease_ttl_seconds), 1)
    return effective_now + timedelta(seconds=ttl)


def runtime_lease_is_active(stream: Stream, *, now: Optional[datetime] = None) -> bool:
    if not stream.runtime_owner_id or not stream.runtime_lease_expires_at:
        return False

    effective_now = (now or utcnow()).astimezone(timezone.utc)
    expiry = stream.runtime_lease_expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry > effective_now


def sync_stream_runtime_lease(
    stream: Stream,
    *,
    owner_id: Optional[str] = None,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> datetime:
    effective_now = (now or utcnow()).astimezone(timezone.utc)
    expiry = runtime_lease_expiry(now=effective_now, ttl_seconds=ttl_seconds)
    stream.runtime_owner_id = runtime_lease_owner_id(owner_id)
    stream.runtime_last_heartbeat_at = effective_now
    stream.runtime_lease_expires_at = expiry
    return expiry


def clear_stream_runtime_lease(stream: Stream) -> None:
    stream.runtime_owner_id = None
    stream.runtime_lease_expires_at = None
    stream.runtime_last_heartbeat_at = None


async def claim_stream_runtime_lease(
    db: AsyncSession,
    stream_id: UUID,
    *,
    owner_id: Optional[str] = None,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> StreamRuntimeLeaseResult:
    effective_owner = runtime_lease_owner_id(owner_id)
    effective_now = (now or utcnow()).astimezone(timezone.utc)

    query = select(Stream).where(Stream.id == _coerce_stream_id(stream_id)).with_for_update()
    result = await db.execute(query)
    stream = result.scalar_one_or_none()
    if stream is None:
        return StreamRuntimeLeaseResult(False, None, None)

    if runtime_lease_is_active(stream, now=effective_now) and stream.runtime_owner_id != effective_owner:
        return StreamRuntimeLeaseResult(False, stream.runtime_owner_id, stream.runtime_lease_expires_at)

    expiry = sync_stream_runtime_lease(
        stream,
        owner_id=effective_owner,
        now=effective_now,
        ttl_seconds=ttl_seconds,
    )
    return StreamRuntimeLeaseResult(True, effective_owner, expiry)


async def renew_stream_runtime_lease(
    db: AsyncSession,
    stream_id: UUID | str,
    *,
    owner_id: Optional[str] = None,
    now: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> bool:
    effective_owner = runtime_lease_owner_id(owner_id)
    effective_now = (now or utcnow()).astimezone(timezone.utc)

    query = select(Stream).where(Stream.id == _coerce_stream_id(stream_id)).with_for_update()
    result = await db.execute(query)
    stream = result.scalar_one_or_none()
    if stream is None:
        return False

    if runtime_lease_is_active(stream, now=effective_now) and stream.runtime_owner_id != effective_owner:
        return False

    sync_stream_runtime_lease(
        stream,
        owner_id=effective_owner,
        now=effective_now,
        ttl_seconds=ttl_seconds,
    )
    return True


async def release_stream_runtime_lease(
    db: AsyncSession,
    stream_id: UUID | str,
    *,
    owner_id: Optional[str] = None,
    force: bool = False,
) -> bool:
    effective_owner = runtime_lease_owner_id(owner_id)

    query = select(Stream).where(Stream.id == _coerce_stream_id(stream_id)).with_for_update()
    result = await db.execute(query)
    stream = result.scalar_one_or_none()
    if stream is None:
        return False

    if not force and stream.runtime_owner_id and stream.runtime_owner_id != effective_owner:
        return False

    clear_stream_runtime_lease(stream)
    return True
