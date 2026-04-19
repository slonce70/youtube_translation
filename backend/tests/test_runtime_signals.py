from collections import deque
from datetime import datetime, timedelta, timezone

from app.streaming.runtime_signals import (
    count_recent_signal_hits,
    normalize_runtime_signal_state,
    register_runtime_signal_hit,
    signal_cooldown_elapsed,
    summarize_runtime_incidents,
)


def test_normalize_runtime_signal_state_converts_persisted_values():
    observed_at = datetime(2026, 4, 19, tzinfo=timezone.utc)
    state = normalize_runtime_signal_state(
        {
            "remote_output_reset": {
                "hits": [observed_at.isoformat()],
                "last_emitted_at": "2026-04-19T10:00:00+00:00",
                "last_seen_at": "not-a-timestamp",
                "last_line": "reset",
            }
        }
    )

    signal_state = state["remote_output_reset"]
    assert isinstance(signal_state["hits"], deque)
    assert signal_state["hits"].maxlen == 32
    assert signal_state["hits"][0] == observed_at
    assert count_recent_signal_hits(signal_state, now=observed_at, window_seconds=60) == 1
    assert signal_state["last_emitted_at"] == datetime(
        2026, 4, 19, 10, 0, tzinfo=timezone.utc
    )
    assert signal_state["last_seen_at"] == "not-a-timestamp"
    assert signal_state["last_line"] == "reset"


def test_register_and_count_runtime_signal_hits():
    runtime_state = {}
    first = datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc)
    second = first + timedelta(seconds=30)
    later = first + timedelta(seconds=301)

    signal_state = register_runtime_signal_hit(
        runtime_state,
        "remote_output_reset",
        "broken pipe while writing trailer",
        first,
    )
    register_runtime_signal_hit(
        runtime_state,
        "remote_output_reset",
        "connection reset by peer",
        second,
    )

    assert signal_state["last_seen_at"] == second
    assert signal_state["last_line"] == "connection reset by peer"
    assert count_recent_signal_hits(signal_state, now=second, window_seconds=180) == 2
    assert count_recent_signal_hits(signal_state, now=later, window_seconds=180) == 0
    assert signal_cooldown_elapsed(
        signal_state, now=later, cooldown_seconds=900
    ) is True


def test_register_runtime_signal_hit_normalizes_persisted_hits():
    first = datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc)
    second = first + timedelta(seconds=30)
    runtime_state = {
        "remote_output_reset": {
            "hits": [first.isoformat()],
            "last_emitted_at": None,
            "last_seen_at": None,
            "last_line": "stale",
        }
    }

    signal_state = register_runtime_signal_hit(
        runtime_state,
        "remote_output_reset",
        "connection reset by peer",
        second,
    )

    assert list(signal_state["hits"]) == [first, second]
    assert signal_state["last_line"] == "connection reset by peer"


def test_summarize_runtime_incidents_reports_degraded_signals():
    now = datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc)
    runtime_state = {
        "remote_output_reset": {
            "hits": [now - timedelta(seconds=1), now - timedelta(seconds=2), now],
            "last_emitted_at": None,
            "last_seen_at": now,
            "last_line": "broken pipe",
        },
    }

    summary = summarize_runtime_incidents(runtime_state, now=now)

    assert summary["severity"] == "degraded"
    assert summary["headline"] == "Runtime зафіксував повторні remote output resets"
    assert summary["items"] == [
        {
            "code": "transport_connection_reset",
            "severity": "degraded",
            "label": "Runtime зафіксував повторні remote output resets",
            "detail": "3 подій за останні 180с.",
            "count": 3,
        }
    ]
