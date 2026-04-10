"""Stream audit helpers for durable operator-facing event trails."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import UUID

from app.core.database import async_session_maker
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Stream, StreamEvent, UserActivityLog


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not metadata:
        return None

    normalized: dict[str, Any] = {}
    for key, value in metadata.items():
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool, list, dict)):
            normalized[key] = value
        else:
            normalized[key] = str(value)
    return normalized or None


def _format_log_line(
    timestamp: datetime,
    level: str,
    message: str,
    metadata: dict[str, Any] | None,
) -> str:
    parts = [
        timestamp.astimezone(timezone.utc).isoformat(),
        "[audit]",
        level.upper(),
        message,
    ]
    if metadata:
        parts.append(json.dumps(metadata, ensure_ascii=True, sort_keys=True))
    return " ".join(parts)


def _append_line(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{line}\n")


async def record_stream_audit_event(
    db: AsyncSession,
    stream: Stream,
    *,
    level: str,
    message: str,
    metadata: Mapping[str, Any] | None = None,
) -> None:
    timestamp = _utcnow()
    normalized_metadata = _normalize_metadata(metadata)

    db.add(
        StreamEvent(
            stream_id=stream.id,
            level=level,
            message=message,
            event_metadata=normalized_metadata,
            created_at=timestamp,
        )
    )
    await db.flush()

    if not stream.log_path:
        return

    await asyncio.to_thread(
        _append_line,
        Path(stream.log_path),
        _format_log_line(timestamp, level, message, normalized_metadata),
    )


async def persist_stream_audit_event(
    stream_id: UUID,
    *,
    level: str,
    message: str,
    metadata: Mapping[str, Any] | None = None,
    log_path: str | None = None,
    activity_payload: Mapping[str, Any] | None = None,
) -> None:
    timestamp = _utcnow()
    normalized_metadata = _normalize_metadata(metadata)

    async with async_session_maker() as db:
        db.add(
            StreamEvent(
                stream_id=stream_id,
                level=level,
                message=message,
                event_metadata=normalized_metadata,
                created_at=timestamp,
            )
        )

        if activity_payload:
            db.add(
                UserActivityLog(
                    user_id=UUID(str(activity_payload["user_id"])),
                    activity_type=str(activity_payload["activity_type"]),
                    ip_address=activity_payload.get("ip_address"),
                    user_agent=activity_payload.get("user_agent"),
                    details=dict(activity_payload.get("details") or {}),
                )
            )

        await db.commit()

    if log_path:
        await asyncio.to_thread(
            _append_line,
            Path(log_path),
            _format_log_line(timestamp, level, message, normalized_metadata),
        )
