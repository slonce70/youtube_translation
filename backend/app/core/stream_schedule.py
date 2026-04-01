"""Helpers for recurring stream schedules and timezone-safe occurrence math."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SCHEDULE_REPEAT_VALUES = {"none", "daily", "weekly"}


def ensure_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_schedule_repeat(value: Optional[str]) -> str:
    candidate = (value or "none").strip().lower()
    if candidate not in SCHEDULE_REPEAT_VALUES:
        raise ValueError("schedule_repeat must be 'none', 'daily', or 'weekly'")
    return candidate


def normalize_schedule_timezone(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    candidate = value.strip()
    if not candidate:
        return None

    try:
        ZoneInfo(candidate)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("schedule_timezone must be a valid IANA timezone") from exc

    return candidate


def get_schedule_zone(timezone_name: Optional[str]) -> ZoneInfo:
    candidate = normalize_schedule_timezone(timezone_name) or "UTC"
    return ZoneInfo(candidate)


def normalize_schedule_weekdays(value: Optional[Iterable[int]]) -> Optional[list[int]]:
    if value is None:
        return None

    normalized = sorted({int(day) for day in value})
    if not normalized:
        return None
    if any(day < 0 or day > 6 for day in normalized):
        raise ValueError("schedule_weekdays values must be between 0 (Monday) and 6 (Sunday)")
    return normalized


def resolve_schedule_timezone(*candidates: Optional[str]) -> str:
    for candidate in candidates:
        normalized = normalize_schedule_timezone(candidate)
        if normalized:
            return normalized
    return "UTC"


def resolve_weekly_weekdays(
    start_at: datetime,
    schedule_timezone: Optional[str],
    weekdays: Optional[Iterable[int]],
) -> list[int]:
    normalized = normalize_schedule_weekdays(weekdays)
    if normalized:
        return normalized

    zone = get_schedule_zone(schedule_timezone)
    return [ensure_utc(start_at).astimezone(zone).weekday()]  # type: ignore[union-attr]


def has_recurring_schedule(stream: object) -> bool:
    repeat = normalize_schedule_repeat(getattr(stream, "schedule_repeat", "none"))
    return bool(getattr(stream, "scheduled_start_enabled", False) and repeat != "none")


def compute_next_repeating_start(
    start_at: datetime,
    *,
    schedule_timezone: Optional[str],
    repeat: str,
    weekdays: Optional[Iterable[int]] = None,
) -> Optional[datetime]:
    normalized_repeat = normalize_schedule_repeat(repeat)
    if normalized_repeat == "none":
        return None

    zone = get_schedule_zone(schedule_timezone)
    local_start = ensure_utc(start_at).astimezone(zone)  # type: ignore[union-attr]
    local_time = local_start.timetz().replace(tzinfo=None)

    if normalized_repeat == "daily":
        next_local = _localize_wall_time(local_start.date() + timedelta(days=1), local_time, zone)
        return next_local.astimezone(timezone.utc)

    weekday_set = resolve_weekly_weekdays(start_at, schedule_timezone, weekdays)
    for day_offset in range(1, 15):
        candidate_date = local_start.date() + timedelta(days=day_offset)
        if candidate_date.weekday() in weekday_set:
            next_local = _localize_wall_time(candidate_date, local_time, zone)
            return next_local.astimezone(timezone.utc)

    raise ValueError("Unable to compute next weekly schedule occurrence")


def compute_schedule_stop_time(
    start_at: Optional[datetime],
    *,
    explicit_stop_at: Optional[datetime],
    schedule_timezone: Optional[str],
    repeat: str,
    window_end_time: Optional[time],
    stop_after_seconds: Optional[int],
) -> Optional[datetime]:
    explicit_stop = ensure_utc(explicit_stop_at)
    if explicit_stop is not None:
        return explicit_stop

    start_utc = ensure_utc(start_at)
    if start_utc is None:
        return None

    candidates: list[datetime] = []
    if stop_after_seconds:
        candidates.append(start_utc + timedelta(seconds=int(stop_after_seconds)))

    if window_end_time is not None:
        zone = get_schedule_zone(schedule_timezone)
        local_start = start_utc.astimezone(zone)
        stop_date = local_start.date()
        local_start_time = local_start.timetz().replace(tzinfo=None)
        if window_end_time <= local_start_time:
            stop_date += timedelta(days=1)
        local_stop = _localize_wall_time(stop_date, window_end_time, zone)
        candidates.append(local_stop.astimezone(timezone.utc))

    if not candidates:
        return None

    future_candidates = [candidate for candidate in candidates if candidate > start_utc]
    if future_candidates:
        return min(future_candidates)

    return min(candidates)


def _localize_wall_time(local_date: date, local_time: time, zone: ZoneInfo) -> datetime:
    naive = datetime.combine(local_date, local_time)
    valid_candidates: list[datetime] = []
    fallback_candidates: list[datetime] = []

    for fold in (0, 1):
        candidate = naive.replace(tzinfo=zone, fold=fold)
        roundtrip = candidate.astimezone(timezone.utc).astimezone(zone)
        if roundtrip.replace(tzinfo=None) == naive:
            valid_candidates.append(roundtrip)
        else:
            fallback_candidates.append(roundtrip)

    if valid_candidates:
        return min(valid_candidates, key=lambda item: item.astimezone(timezone.utc))

    if not fallback_candidates:
        return naive.replace(tzinfo=zone)

    future_candidates = [candidate for candidate in fallback_candidates if candidate.replace(tzinfo=None) >= naive]
    if future_candidates:
        return min(future_candidates, key=lambda item: item.replace(tzinfo=None))

    return max(fallback_candidates, key=lambda item: item.replace(tzinfo=None))
