"""Live FFmpeg stderr → operator-panel metrics.

Track 5b/C #2 (2026-04-26): the modern operator panel needs sparklines
of bitrate / fps / dropped frames during a live stream. FFmpeg already
prints these on stderr at ~1 Hz when invoked with progress reporting
enabled; we parse the lines and keep a sliding window per stream.

This module is intentionally additive — it does NOT modify the existing
2000-LOC ``ffmpeg_manager.py`` god module. The manager wires a callback
that feeds stderr lines here; everything else stays unchanged.

Format reminder (FFmpeg 5+):
    frame= 1234 fps=30 q=-1.0 size=1234kB time=00:01:23.45
    bitrate=4502.3kbits/s drop=0 speed=1.00x

Older builds use ``Lsize=`` and may omit ``drop=``; we accept missing
fields and leave them as None.
"""

from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Deque, Dict, Optional

# Match each `key=value` token. Values may include digits, decimal points,
# the letter `N` (FFmpeg's "N/A"), or units (`kbits/s`, `kB`, `x`).
_TOKEN_PATTERN = re.compile(r"(?P<key>[A-Za-z_]+)\s*=\s*(?P<value>\S+)")

# Tokens we care about. Anything else in the line is ignored.
_FIELDS = {"bitrate", "fps", "drop", "speed", "frame"}


def _to_float(raw: str) -> Optional[float]:
    if not raw or raw.upper() == "N/A":
        return None
    cleaned = re.sub(r"[A-Za-z/%]+$", "", raw)
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _to_int(raw: str) -> Optional[int]:
    value = _to_float(raw)
    if value is None:
        return None
    return int(value)


@dataclass
class MetricSample:
    ts: float
    bitrate_kbps: Optional[float] = None
    fps: Optional[float] = None
    dropped_frames: Optional[int] = None
    speed: Optional[float] = None


@dataclass
class _StreamMetricsState:
    samples: Deque[MetricSample] = field(default_factory=lambda: deque(maxlen=120))
    dropped_frames_total: int = 0
    reconnect_count_24h: int = 0


class FFmpegMetricsRegistry:
    """Per-stream sliding-window store for parsed stderr metrics.

    Single instance lives in this module; ``ffmpeg_manager`` calls
    ``feed_line(stream_id, line)`` for each stderr line it receives.
    The operator panel reads via ``snapshot(stream_id, samples=N)``.
    """

    def __init__(self, max_samples: int = 120) -> None:
        self._max_samples = max_samples
        self._states: Dict[str, _StreamMetricsState] = {}
        self._lock = Lock()

    def reset(self, stream_id: str) -> None:
        """Clear samples for a stream (called on start / restart)."""
        with self._lock:
            self._states[stream_id] = _StreamMetricsState(
                samples=deque(maxlen=self._max_samples)
            )

    def drop(self, stream_id: str) -> None:
        """Remove all state for a stream (called on stop / cleanup)."""
        with self._lock:
            self._states.pop(stream_id, None)

    def feed_line(self, stream_id: str, line: str) -> None:
        """Parse one FFmpeg stderr line. Silently ignores non-progress lines."""
        if not line:
            return
        # Cheap guard: progress lines almost always contain "frame=" or "size=".
        if "frame=" not in line and "bitrate=" not in line:
            return

        sample_kwargs: Dict[str, Optional[float]] = {}
        for match in _TOKEN_PATTERN.finditer(line):
            key = match.group("key").lower()
            if key not in _FIELDS:
                continue
            raw = match.group("value")
            if key == "bitrate":
                sample_kwargs["bitrate_kbps"] = _to_float(raw)
            elif key == "fps":
                sample_kwargs["fps"] = _to_float(raw)
            elif key == "drop":
                sample_kwargs["dropped_frames"] = _to_int(raw)
            elif key == "speed":
                sample_kwargs["speed"] = _to_float(raw)

        if not sample_kwargs:
            return

        sample = MetricSample(ts=time.time(), **sample_kwargs)
        with self._lock:
            state = self._states.setdefault(
                stream_id,
                _StreamMetricsState(samples=deque(maxlen=self._max_samples)),
            )
            state.samples.append(sample)
            # Cumulative drop counter: FFmpeg's `drop=` is a running total
            # since stream start, so just track the highest value seen.
            if sample.dropped_frames is not None:
                state.dropped_frames_total = max(
                    state.dropped_frames_total, sample.dropped_frames
                )

    def record_reconnect(self, stream_id: str) -> None:
        """Increment the rolling 24h reconnect counter."""
        with self._lock:
            state = self._states.setdefault(
                stream_id,
                _StreamMetricsState(samples=deque(maxlen=self._max_samples)),
            )
            state.reconnect_count_24h += 1

    def snapshot(
        self, stream_id: str, *, samples: int = 60
    ) -> Optional[Dict[str, object]]:
        """Read-only view of current metrics for a stream.

        Returns ``None`` when the stream has never sent a sample. The shape
        matches ``StreamLiveMetrics``: latest bitrate/fps + cumulative
        drops + reconnects + last N samples for sparklines.
        """
        with self._lock:
            state = self._states.get(stream_id)
            if state is None:
                return None
            tail = list(state.samples)[-max(samples, 1) :]
            latest = tail[-1] if tail else None
            return {
                "bitrate_kbps": latest.bitrate_kbps if latest else None,
                "fps": latest.fps if latest else None,
                "dropped_frames_total": state.dropped_frames_total,
                "reconnect_count_24h": state.reconnect_count_24h,
                "samples": [
                    {
                        "ts": s.ts,
                        "bitrate_kbps": s.bitrate_kbps,
                        "fps": s.fps,
                        "dropped_frames": s.dropped_frames,
                        "speed": s.speed,
                    }
                    for s in tail
                ],
            }


# Module-level singleton — same pattern as ``hot_swap_manager``.
ffmpeg_metrics = FFmpegMetricsRegistry()


__all__ = ["ffmpeg_metrics", "FFmpegMetricsRegistry", "MetricSample"]
