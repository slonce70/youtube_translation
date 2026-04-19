from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Union


REMOTE_OUTPUT_RESET_MARKERS = (
    "broken pipe",
    "connection reset by peer",
    "the specified session has been invalidated",
    "error writing trailer",
)
RECOVERY_SUCCESS_MARKERS = ("recovery successful",)
NON_MONOTONIC_DTS_MARKERS = (
    "non-monotonic dts",
    "non monotonically increasing dts",
)

DEGRADED_SIGNAL_SPECS: Dict[str, Dict[str, Union[int, str, Tuple[str, ...]]]] = {
    "remote_output_reset": {
        "threshold": 3,
        "window_seconds": 180,
        "cooldown_seconds": 900,
        "level": "warning",
        "alert_severity": "warning",
        "message": (
            "Stream degraded while still running: repeated remote output resets "
            "detected in FFmpeg logs."
        ),
        "markers": REMOTE_OUTPUT_RESET_MARKERS,
    },
    "non_monotonic_dts": {
        "threshold": 5,
        "window_seconds": 300,
        "cooldown_seconds": 900,
        "level": "warning",
        "alert_severity": "warning",
        "message": (
            "Stream degraded while still running: repeated Non-monotonic DTS "
            "warnings detected in FFmpeg logs."
        ),
        "markers": NON_MONOTONIC_DTS_MARKERS,
    },
    "recovery_storm": {
        "threshold": 3,
        "window_seconds": 300,
        "cooldown_seconds": 900,
        "level": "warning",
        "alert_severity": "warning",
        "message": (
            "Stream degraded while still running: repeated output recoveries "
            "indicate a recovery storm."
        ),
    },
}

RUNTIME_INCIDENT_LABELS = {
    "remote_output_reset": "Runtime зафіксував повторні remote output resets",
    "recovery_storm": "Runtime увійшов у recovery storm",
    "non_monotonic_dts": "Runtime зафіксував повторні Non-monotonic DTS warnings",
}
RUNTIME_INCIDENT_CODES = {
    "remote_output_reset": "transport_connection_reset",
    "recovery_storm": "transport_recovery",
    "non_monotonic_dts": "timeline_drift",
}


def _coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
    else:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_hits(raw_hits: Any) -> deque[datetime]:
    hits: deque[datetime] = deque(maxlen=32)
    for raw_hit in raw_hits or []:
        observed_at = _coerce_datetime(raw_hit)
        if observed_at is not None:
            hits.append(observed_at)
    return hits


def _default_signal_state() -> Dict[str, Any]:
    return {
        "hits": deque(maxlen=32),
        "last_emitted_at": None,
        "last_seen_at": None,
        "last_line": None,
    }


def _normalize_signal_state(raw_state: Dict[str, Any]) -> Dict[str, Any]:
    last_seen_at = raw_state.get("last_seen_at")
    normalized_last_seen_at = _coerce_datetime(last_seen_at)

    return {
        "hits": _normalize_hits(raw_state.get("hits")),
        "last_emitted_at": _coerce_datetime(raw_state.get("last_emitted_at")),
        "last_seen_at": (
            normalized_last_seen_at
            if normalized_last_seen_at is not None
            else last_seen_at
        ),
        "last_line": raw_state.get("last_line"),
    }


def normalize_runtime_signal_state(
    state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}

    for signal_name, raw_state in (state or {}).items():
        if not isinstance(raw_state, dict):
            continue

        normalized[signal_name] = _normalize_signal_state(raw_state)

    return normalized


def healthy_runtime_incident_summary() -> Dict[str, Any]:
    return {
        "severity": "healthy",
        "headline": None,
        "details": [],
        "items": [],
    }


def register_runtime_signal_hit(
    runtime_state: Dict[str, Dict[str, Any]],
    signal_name: str,
    log_line: str,
    observed_at: datetime,
) -> Dict[str, Any]:
    signal_state = ensure_runtime_signal_state(runtime_state, signal_name)
    hits = signal_state["hits"]
    hits.append(observed_at)
    signal_state["last_seen_at"] = observed_at
    signal_state["last_line"] = log_line[:500]
    return signal_state


def ensure_runtime_signal_state(
    runtime_state: Dict[str, Dict[str, Any]],
    signal_name: str,
) -> Dict[str, Any]:
    raw_state = runtime_state.get(signal_name)
    if not isinstance(raw_state, dict):
        signal_state = _default_signal_state()
        runtime_state[signal_name] = signal_state
        return signal_state

    normalized_state = _normalize_signal_state(raw_state)
    raw_state.clear()
    raw_state.update(normalized_state)
    return raw_state


def count_recent_signal_hits(
    signal_state: Dict[str, Any],
    *,
    now: datetime,
    window_seconds: int,
) -> int:
    hits = _normalize_hits(signal_state.get("hits"))
    signal_state["hits"] = hits

    cutoff = now - timedelta(seconds=max(window_seconds, 1))
    while hits and hits[0] < cutoff:
        hits.popleft()
    return len(hits)


def signal_cooldown_elapsed(
    signal_state: Dict[str, Any],
    *,
    now: datetime,
    cooldown_seconds: int,
) -> bool:
    last_emitted_at = _coerce_datetime(signal_state.get("last_emitted_at"))
    if last_emitted_at is not None:
        signal_state["last_emitted_at"] = last_emitted_at

    if not isinstance(last_emitted_at, datetime):
        return True

    if last_emitted_at.tzinfo is None:
        last_emitted_at = last_emitted_at.replace(tzinfo=timezone.utc)

    return (now - last_emitted_at).total_seconds() >= max(cooldown_seconds, 0)


def summarize_runtime_incidents(
    runtime_state: Dict[str, Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    normalized_state = normalize_runtime_signal_state(runtime_state)
    if not normalized_state:
        return healthy_runtime_incident_summary()

    observed_at = now or datetime.now(timezone.utc)
    items: List[Dict[str, Any]] = []
    for signal_name, spec in DEGRADED_SIGNAL_SPECS.items():
        signal_state = normalized_state.get(signal_name)
        if not isinstance(signal_state, dict):
            continue

        count = count_recent_signal_hits(
            signal_state,
            now=observed_at,
            window_seconds=int(spec["window_seconds"]),
        )
        if count < int(spec["threshold"]):
            continue

        detail = (
            f"Remote output reset / recovery storm за останні "
            f"{int(spec['window_seconds'])}с."
            if signal_name == "recovery_storm"
            else f"{count} подій за останні {int(spec['window_seconds'])}с."
        )
        items.append(
            {
                "code": RUNTIME_INCIDENT_CODES[signal_name],
                "severity": "degraded",
                "label": RUNTIME_INCIDENT_LABELS[signal_name],
                "detail": detail,
                "count": count,
            }
        )

    if not items:
        return healthy_runtime_incident_summary()

    headline = str(items[0]["label"])
    details = [
        str(item.get("detail") or item.get("label") or "").strip()
        for item in items
        if str(item.get("detail") or item.get("label") or "").strip()
    ]
    return {
        "severity": "degraded",
        "headline": headline,
        "details": details,
        "items": items,
    }
