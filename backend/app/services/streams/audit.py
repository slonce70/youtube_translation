"""Stream audit helpers for durable operator-facing event trails."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence
from uuid import UUID

from app.core.database import async_session_maker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Stream, StreamEvent, SystemAlert, UserActivityLog

_REMOTE_OUTPUT_RESET_PATTERN = re.compile(
    r"broken pipe|connection reset by peer|the specified session has been invalidated|error writing trailer",
    re.IGNORECASE,
)
_CONNECTION_RESET_PATTERN = re.compile(r"connection reset by peer", re.IGNORECASE)
_BROKEN_PIPE_PATTERN = re.compile(r"broken pipe", re.IGNORECASE)
_RECOVERY_SUCCESS_PATTERN = re.compile(r"recovery successful", re.IGNORECASE)
_NON_MONOTONIC_DTS_PATTERN = re.compile(
    r"non-monotonic dts|non monotonically increasing dts",
    re.IGNORECASE,
)
_LOG_TIMESTAMP_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b"
)
_DEGRADED_ALERT_FALLBACK_SECONDS = 900
_RUNTIME_SIGNAL_CODES = {
    "remote_output_reset": "transport_connection_reset",
    "recovery_storm": "transport_recovery",
    "non_monotonic_dts": "timeline_drift",
}
_RUNTIME_SIGNAL_LABELS = {
    "remote_output_reset": "Runtime зафіксував повторні remote output resets",
    "recovery_storm": "Runtime увійшов у recovery storm",
    "non_monotonic_dts": "Runtime зафіксував повторні Non-monotonic DTS warnings",
}


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


def _healthy_runtime_incident_summary() -> dict[str, Any]:
    return {
        "severity": "healthy",
        "headline": None,
        "details": [],
        "items": [],
    }


def _create_runtime_incident_item(
    code: str,
    severity: str,
    label: str,
    *,
    detail: str | None = None,
    count: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "severity": severity,
        "label": label,
    }
    if detail:
        payload["detail"] = detail
    if count is not None:
        payload["count"] = count
    return payload


def _create_runtime_incident_summary(items: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return _healthy_runtime_incident_summary()

    severity = (
        "critical"
        if any(item.get("severity") == "critical" for item in items)
        else "degraded"
    )
    primary, *rest = items
    details = [
        str(value).strip()
        for value in [primary.get("detail"), *[item.get("label") for item in rest]]
        if str(value or "").strip()
    ]
    return {
        "severity": severity,
        "headline": primary.get("label"),
        "details": details,
        "items": list(items),
    }


def merge_runtime_incident_summaries(
    *summaries: Mapping[str, Any] | None,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for summary in summaries:
        if not isinstance(summary, Mapping):
            continue
        raw_items = summary.get("items")
        if not isinstance(raw_items, list):
            continue

        for item in raw_items:
            if not isinstance(item, Mapping):
                continue
            code = str(item.get("code") or "").strip()
            label = str(item.get("label") or "").strip()
            detail = str(item.get("detail") or "").strip()
            if not code or not label:
                continue
            key = (code, label, detail)
            if key in seen:
                continue
            seen.add(key)
            items.append(
                {
                    "code": code,
                    "severity": str(item.get("severity") or "degraded"),
                    "label": label,
                    "detail": detail or None,
                    "count": item.get("count"),
                }
            )

    return _create_runtime_incident_summary(items)


def summarize_runtime_incidents_from_log_lines(lines: Sequence[str]) -> dict[str, Any]:
    normalized_lines = [str(line) for line in lines if str(line).strip()]
    if not normalized_lines:
        return _healthy_runtime_incident_summary()

    connection_reset_count = sum(
        1 for line in normalized_lines if _CONNECTION_RESET_PATTERN.search(line)
    )
    broken_pipe_count = sum(
        1 for line in normalized_lines if _BROKEN_PIPE_PATTERN.search(line)
    )
    recovery_count = sum(
        1 for line in normalized_lines if _RECOVERY_SUCCESS_PATTERN.search(line)
    )
    timeline_drift_count = sum(
        1 for line in normalized_lines if _NON_MONOTONIC_DTS_PATTERN.search(line)
    )
    transport_fault_count = connection_reset_count + broken_pipe_count
    items: list[dict[str, Any]] = []

    if connection_reset_count > 0:
        items.append(
            _create_runtime_incident_item(
                "transport_connection_reset",
                "degraded" if recovery_count > 0 else "critical",
                f"RTMPS ingest скинув з'єднання {connection_reset_count} раз(и)",
                count=connection_reset_count,
            )
        )

    if broken_pipe_count > 0:
        items.append(
            _create_runtime_incident_item(
                "transport_broken_pipe",
                "degraded" if recovery_count > 0 else "critical",
                f"FFmpeg зафіксував Broken pipe {broken_pipe_count} раз(и)",
                count=broken_pipe_count,
            )
        )

    if recovery_count > 0:
        items.append(
            _create_runtime_incident_item(
                "transport_recovery",
                "degraded" if transport_fault_count > 0 else "critical",
                f"Runtime відновив потік {recovery_count} раз(и)",
                detail=(
                    "Потік живий, але вже проходив через transport fault і recovery."
                    if transport_fault_count > 0
                    else "Лог показує recovery без повного контексту причини; варто перевірити raw log."
                ),
                count=recovery_count,
            )
        )

    if timeline_drift_count > 0:
        items.append(
            _create_runtime_incident_item(
                "timeline_drift",
                "degraded",
                f"FFmpeg попереджає про Non-monotonic DTS {timeline_drift_count} раз(и)",
                detail="Є ризик таймінгових артефактів або нестабільного muxing path.",
                count=timeline_drift_count,
            )
        )

    return _create_runtime_incident_summary(items)


def _parse_log_timestamp(line: str) -> datetime | None:
    match = _LOG_TIMESTAMP_PATTERN.match(line.strip())
    if not match:
        return None

    raw_value = match.group("timestamp")
    normalized = raw_value[:-1] + "+00:00" if raw_value.endswith("Z") else raw_value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_utc_timestamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def filter_recent_runtime_log_lines(
    lines: Sequence[str],
    *,
    now: datetime | None = None,
    recency_window_seconds: int = _DEGRADED_ALERT_FALLBACK_SECONDS,
    session_started_at: datetime | None = None,
) -> list[str]:
    if recency_window_seconds <= 0:
        return [str(line) for line in lines if str(line).strip()]

    current_time = now or _utcnow()
    cutoff = current_time - timedelta(seconds=recency_window_seconds)
    if session_started_at is not None:
        session_cutoff = _normalize_utc_timestamp(session_started_at)
        assert session_cutoff is not None
        if session_cutoff > cutoff:
            cutoff = session_cutoff
    filtered: list[str] = []

    for raw_line in lines:
        line = str(raw_line).strip()
        if not line:
            continue
        timestamp = _parse_log_timestamp(line)
        if timestamp is None:
            if session_started_at is not None:
                # Without a timestamp we cannot safely attribute a raw FFmpeg line
                # to the current session, so do not surface it as live degradation.
                continue
        elif timestamp < cutoff:
            continue
        filtered.append(line)

    return filtered


async def read_runtime_incident_summary_from_log(
    log_path: str | None,
    *,
    line_limit: int = 200,
    session_started_at: datetime | None = None,
) -> dict[str, Any]:
    if not log_path:
        return _healthy_runtime_incident_summary()

    path = Path(log_path)
    if not path.exists():
        return _healthy_runtime_incident_summary()

    def _read_tail(target: Path, limit: int) -> list[str]:
        tail: list[str] = []
        with target.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                tail.append(line.rstrip("\n\r"))
        return tail[-limit:]

    try:
        lines = await asyncio.to_thread(_read_tail, path, line_limit)
    except FileNotFoundError:
        return _healthy_runtime_incident_summary()

    return summarize_runtime_incidents_from_log_lines(
        filter_recent_runtime_log_lines(
            lines, session_started_at=session_started_at
        )
    )


def _persisted_runtime_alert_to_item(alert: SystemAlert) -> Optional[dict[str, Any]]:
    details = alert.details if isinstance(alert.details, dict) else {}
    if details.get("category") != "stream_runtime_health":
        return None
    if details.get("status") != "degraded_running":
        return None

    signal_name = str(details.get("signal") or "").strip()
    code = _RUNTIME_SIGNAL_CODES.get(signal_name)
    if not code:
        if _REMOTE_OUTPUT_RESET_PATTERN.search(alert.message):
            code = "transport_connection_reset"
        elif _NON_MONOTONIC_DTS_PATTERN.search(alert.message):
            code = "timeline_drift"
        else:
            return None

    count = details.get("occurrence_count")
    window_seconds = details.get("window_seconds")
    detail: str | None = None
    if signal_name == "recovery_storm":
        detail = (
            f"Remote output reset / recovery storm за останні {int(window_seconds)}с."
            if isinstance(window_seconds, int)
            else "Remote output reset / recovery storm."
        )
    elif isinstance(count, int) and isinstance(window_seconds, int):
        detail = f"{count} подій за останні {window_seconds}с."

    return _create_runtime_incident_item(
        code,
        "degraded",
        _RUNTIME_SIGNAL_LABELS.get(signal_name, alert.message),
        detail=detail,
        count=int(count) if isinstance(count, int) else None,
    )


async def load_persisted_runtime_incident_summaries(
    db: AsyncSession, streams: Sequence[Stream]
) -> dict[UUID, dict[str, Any]]:
    ids = [stream.id for stream in streams if stream.id]
    if not ids:
        return {}

    fallback_cutoff = _utcnow() - timedelta(seconds=_DEGRADED_ALERT_FALLBACK_SECONDS)
    session_cutoffs = {
        stream.id: max(
            fallback_cutoff,
            _normalize_utc_timestamp(stream.started_at) or fallback_cutoff,
        )
        for stream in streams
        if stream.id
    }
    result = await db.execute(
        select(SystemAlert)
        .where(
            SystemAlert.stream_id.in_(ids),
            SystemAlert.alert_type == "ffmpeg_error",
            SystemAlert.resolved.is_(False),
            SystemAlert.created_at >= fallback_cutoff,
        )
        .order_by(SystemAlert.created_at.desc())
    )
    alerts = result.scalars().all()

    grouped: dict[UUID, list[dict[str, Any]]] = {}
    seen_signals: dict[UUID, set[str]] = {}
    for alert in alerts:
        stream_id = alert.stream_id
        if stream_id is None:
            continue
        created_at = _normalize_utc_timestamp(alert.created_at)
        session_cutoff = session_cutoffs.get(stream_id, fallback_cutoff)
        if created_at is not None and created_at < session_cutoff:
            continue
        item = _persisted_runtime_alert_to_item(alert)
        if item is None:
            continue
        signal_name = str((alert.details or {}).get("signal") or item["code"])
        already_seen = seen_signals.setdefault(stream_id, set())
        if signal_name in already_seen:
            continue
        already_seen.add(signal_name)
        grouped.setdefault(stream_id, []).append(item)

    return {
        stream_id: _create_runtime_incident_summary(items)
        for stream_id, items in grouped.items()
    }


async def attach_runtime_incident_summaries(
    db: AsyncSession,
    streams: Sequence[Stream],
    *,
    manager: Any | None = None,
) -> None:
    if not streams:
        return

    persisted = await load_persisted_runtime_incident_summaries(db, streams)
    log_summaries = await asyncio.gather(
        *[
            read_runtime_incident_summary_from_log(
                stream.log_path,
                session_started_at=stream.started_at,
            )
            for stream in streams
        ]
    )

    for stream, log_summary in zip(streams, log_summaries):
        in_memory_summary = None
        if manager is not None and hasattr(manager, "get_runtime_incident_summary"):
            in_memory_summary = manager.get_runtime_incident_summary(str(stream.id))

        setattr(
            stream,
            "_runtime_incident_summary",
            merge_runtime_incident_summaries(
                in_memory_summary,
                log_summary,
                persisted.get(stream.id),
            ),
        )


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


async def persist_stream_alert_event(
    stream_id: UUID,
    *,
    level: str,
    message: str,
    alert_type: str,
    alert_severity: str,
    metadata: Mapping[str, Any] | None = None,
    alert_details: Mapping[str, Any] | None = None,
    user_id: UUID | None = None,
    log_path: str | None = None,
) -> None:
    """Persist an operator-facing stream event and system alert together."""

    timestamp = _utcnow()
    normalized_metadata = _normalize_metadata(metadata)
    normalized_alert_details = _normalize_metadata(alert_details or metadata)

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
        db.add(
            SystemAlert(
                alert_type=alert_type,
                severity=alert_severity,
                user_id=user_id,
                stream_id=stream_id,
                message=message,
                details=normalized_alert_details,
                created_at=timestamp,
            )
        )
        await db.commit()

    if log_path:
        await asyncio.to_thread(
            _append_line,
            Path(log_path),
            _format_log_line(timestamp, level, message, normalized_metadata),
        )
