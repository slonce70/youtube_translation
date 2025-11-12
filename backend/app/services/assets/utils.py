"""Shared helpers for asset operations."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status

from app.core.config import settings

AUDIO_FILE_EXTENSIONS = {
    "aac",
    "aiff",
    "alac",
    "flac",
    "m4a",
    "mp3",
    "ogg",
    "oga",
    "opus",
    "wav",
    "wma",
}

VIDEO_FILE_EXTENSIONS = {
    "3gp",
    "avi",
    "flv",
    "m2ts",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpeg",
    "mpg",
    "ts",
    "webm",
    "wmv",
}


def _normalize_extension(filename: Optional[str]) -> Optional[str]:
    if not filename or "." not in filename:
        return None
    suffix = filename.rsplit(".", 1)[-1].strip().lower()
    return suffix or None


def _only_cover_art(video_meta: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(video_meta, dict):
        return False

    codec = str(video_meta.get("codec") or "").lower()
    if codec not in {"mjpeg", "jpeg", "jpg", "png", "bmp"}:
        return False

    try:
        width = int(video_meta.get("width") or 0)
        height = int(video_meta.get("height") or 0)
    except (TypeError, ValueError):
        width = height = 0

    if width == 0 and height == 0:
        return True

    fps_value = video_meta.get("fps")
    try:
        fps = float(fps_value) if fps_value is not None else 0.0
    except (TypeError, ValueError):
        fps = 0.0

    return fps <= 1 and width <= 2000 and height <= 2000


def infer_asset_type(
    stream_meta: Optional[Dict[str, Any]],
    fallback: str = "video",
    *,
    filename: Optional[str] = None,
) -> str:
    """Infer whether provided metadata represents audio or video."""

    extension = _normalize_extension(filename)
    if extension:
        if extension in AUDIO_FILE_EXTENSIONS:
            return "audio"
        if extension in VIDEO_FILE_EXTENSIONS:
            return "video"

    if not isinstance(stream_meta, dict):
        return fallback

    video_meta = stream_meta.get("video") if isinstance(stream_meta, dict) else None
    audio_meta = stream_meta.get("audio") if isinstance(stream_meta, dict) else None

    has_video = bool(
        video_meta
        and (
            video_meta.get("codec")
            or video_meta.get("width")
            or video_meta.get("height")
        )
    )

    has_audio = bool(
        audio_meta
        and (
            audio_meta.get("codec")
            or audio_meta.get("sample_rate")
            or audio_meta.get("channels")
        )
    )

    if has_video and not _only_cover_art(video_meta):
        return "video"
    if has_audio and not has_video:
        return "audio"
    if has_audio and _only_cover_art(video_meta):
        return "audio"
    return fallback


def normalize_asset_type(
    requested: Optional[str],
    stream_meta: Optional[Dict[str, Any]],
    *,
    filename: Optional[str] = None,
) -> str:
    candidate = (requested or "video").lower()
    if candidate not in {"video", "audio"}:
        candidate = "video"

    inferred = infer_asset_type(stream_meta, candidate, filename=filename)

    if (
        inferred == "video"
        and candidate == "audio"
        and isinstance(stream_meta, dict)
        and stream_meta.get("cover_art")
        and not stream_meta.get("video")
    ):
        return "audio"

    return inferred


def apply_stream_summary_fields(asset, stream_meta: Optional[Dict[str, Any]]) -> None:
    """Populate summary columns (codec, bitrate, resolution) from ffprobe meta."""
    if not stream_meta:
        return

    video_meta = stream_meta.get("video") if isinstance(stream_meta, dict) else None
    audio_meta = stream_meta.get("audio") if isinstance(stream_meta, dict) else None

    try:
        resolution_width = (
            int(video_meta.get("width"))
            if video_meta and video_meta.get("width")
            else None
        )
        resolution_height = (
            int(video_meta.get("height"))
            if video_meta and video_meta.get("height")
            else None
        )
    except (TypeError, ValueError):
        resolution_width = resolution_height = None

    if video_meta and video_meta.get("codec"):
        asset.video_codec = str(video_meta.get("codec"))

    if audio_meta and audio_meta.get("codec"):
        asset.audio_codec = str(audio_meta.get("codec"))

    if resolution_width and resolution_height:
        asset.resolution = f"{resolution_width}x{resolution_height}"

    bitrate_source = None
    if isinstance(stream_meta, dict):
        bitrate_source = stream_meta.get("bitrate")

    if not bitrate_source and video_meta:
        bitrate_source = video_meta.get("bitrate")
    if not bitrate_source and audio_meta:
        bitrate_source = audio_meta.get("bitrate")

    try:
        if bitrate_source:
            asset.bitrate = int(bitrate_source)
    except (TypeError, ValueError):
        pass

    fps_value = None
    if video_meta and video_meta.get("fps"):
        try:
            fps_value = float(video_meta.get("fps"))
        except (TypeError, ValueError):
            fps_value = None

    if fps_value is not None:
        asset.fps = int(round(fps_value))

    asset.asset_type = infer_asset_type(
        stream_meta,
        asset.asset_type or "video",
        filename=getattr(asset, "filename", None),
    )


def _sign_download_payload(payload: str) -> str:
    return hmac.new(
        settings.download_token_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_download_token(asset_id: UUID, user_id: UUID) -> tuple[str, int]:
    expires_at = int(time.time()) + settings.download_token_ttl_seconds
    payload = f"{asset_id}:{user_id}:{expires_at}"
    signature = _sign_download_payload(payload)
    token_bytes = f"{payload}:{signature}".encode("utf-8")
    token = base64.urlsafe_b64encode(token_bytes).decode("utf-8")
    return token, expires_at


def parse_download_token(token: str) -> tuple[UUID, UUID, int]:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        parts = decoded.split(":")
        if len(parts) != 4:
            raise ValueError("invalid token format")
        asset_id_str, user_id_str, expires_at_str, signature = parts
        payload = ":".join(parts[:3])
        expected_signature = _sign_download_payload(payload)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("invalid signature")
        expires_at = int(expires_at_str)
        if expires_at < int(time.time()):
            raise ValueError("token expired")
        return UUID(asset_id_str), UUID(user_id_str), expires_at
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired download token",
        ) from exc
