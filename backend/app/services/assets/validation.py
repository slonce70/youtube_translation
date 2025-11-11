"""FFmpeg/ffprobe validation utilities."""

from __future__ import annotations

import logging

from app.core.config import settings
from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)

try:
    validator = VideoValidator(settings.ffprobe_bin)
except FileNotFoundError as exc:  # pragma: no cover - depends on env
    logger.error("FFprobe binary not available: %s", exc)
    validator = None

__all__ = ["validator"]
