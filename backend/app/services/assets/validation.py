"""FFmpeg/ffprobe validation utilities."""

from __future__ import annotations

import logging

from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)

validator: VideoValidator | None

try:
    validator = VideoValidator()
except FileNotFoundError as exc:  # pragma: no cover - depends on env
    logger.error("FFprobe binary not available: %s", exc)
    validator = None

__all__ = ["validator"]
