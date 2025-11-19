"""Video thumbnail generation helpers."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


async def generate_video_thumbnail(
    video_path: Path,
    output_dir: Path,
    asset_id,
    timestamp: float = 1.0,
    width: int = 1280,
    height: int = 720,
) -> Optional[str]:
    """Generate a thumbnail for a video using FFmpeg."""
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        thumbnail_filename = f"{asset_id}.jpg"
        thumbnail_path = output_dir / thumbnail_filename

        ffmpeg_bin = getattr(settings, "ffmpeg_bin", "ffmpeg")
        ffmpeg_cmd = [
            ffmpeg_bin,
            "-ss",
            str(timestamp),
            "-i",
            str(video_path),
            "-vframes",
            "1",
            "-vf",
            (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
            ),
            "-q:v",
            "2",
            "-y",
            str(thumbnail_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        _, stderr = await asyncio.wait_for(process.communicate(), timeout=30)

        if process.returncode != 0:
            logger.error(
                "FFmpeg thumbnail generation failed for %s: %s",
                video_path,
                stderr.decode("utf-8", errors="replace"),
            )
            return None

        if not thumbnail_path.exists():
            logger.error("Thumbnail file not created: %s", thumbnail_path)
            return None

        relative_path = f"/thumbnails/{thumbnail_filename}"
        logger.info("Generated thumbnail for asset %s at %s", asset_id, thumbnail_path)
        return relative_path

    except asyncio.TimeoutError:
        logger.error("Thumbnail generation timed out for %s", video_path)
        return None
    except Exception as error:  # pylint: disable=broad-except
        logger.error(
            "Error generating thumbnail for %s: %s",
            video_path,
            error,
            exc_info=True,
        )
        return None
