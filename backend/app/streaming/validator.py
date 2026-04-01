import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)


class VideoValidator:
    """Validates video files for YouTube streaming compatibility"""

    # YouTube requirements for stream copy
    REQUIRED_VIDEO_CODEC = "h264"
    ALLOWED_AUDIO_CODECS = {"aac", "mp3", "mpga"}
    AUDIO_CODEC_LABELS = {
        "aac": "AAC",
        "mp3": "MP3",
        "mpga": "MP3",
    }
    PREFERRED_AUDIO_CODEC = "aac"
    REQUIRED_PIX_FMT = "yuv420p"
    MAX_GOP_SIZE = 120  # 4 seconds at 30fps
    RECOMMENDED_GOP_SIZE = 60  # 2 seconds at 30fps
    MAX_KEYFRAME_INTERVAL_SECONDS = 4.0
    MISSING_FFPROBE_MESSAGE = (
        "ffprobe binary not found. Install FFmpeg or set FFMPEG_BIN/FFPROBE_BIN in .env"
    )

    BITRATE_GUIDANCE = [
        {
            "label": "4K / 2160p",
            "min_height": 2000,
            "max_height": 2400,
            "fps": 60,
            "min_bitrate_mbps": 20,
            "max_bitrate_mbps": 51,
            "target_bitrate_mbps": 40,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "4K / 2160p",
            "min_height": 2000,
            "max_height": 2400,
            "fps": 30,
            "min_bitrate_mbps": 13,
            "max_bitrate_mbps": 34,
            "target_bitrate_mbps": 25,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "1440p",
            "min_height": 1300,
            "max_height": 1999,
            "fps": 60,
            "min_bitrate_mbps": 9,
            "max_bitrate_mbps": 18,
            "target_bitrate_mbps": 15,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "1440p",
            "min_height": 1300,
            "max_height": 1999,
            "fps": 30,
            "min_bitrate_mbps": 6,
            "max_bitrate_mbps": 13,
            "target_bitrate_mbps": 10,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "1080p",
            "min_height": 1000,
            "max_height": 1299,
            "fps": 60,
            "min_bitrate_mbps": 4.5,
            "max_bitrate_mbps": 9,
            "target_bitrate_mbps": 7.5,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "1080p",
            "min_height": 1000,
            "max_height": 1299,
            "fps": 30,
            "min_bitrate_mbps": 3,
            "max_bitrate_mbps": 6,
            "target_bitrate_mbps": 4.5,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "720p",
            "min_height": 600,
            "max_height": 999,
            "fps": 60,
            "min_bitrate_mbps": 2.25,
            "max_bitrate_mbps": 6,
            "target_bitrate_mbps": 4.5,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
        {
            "label": "720p",
            "min_height": 600,
            "max_height": 999,
            "fps": 30,
            "min_bitrate_mbps": 1.5,
            "max_bitrate_mbps": 4,
            "target_bitrate_mbps": 3,
            "video_codec": "H.264",
            "audio_codec": "AAC",
        },
    ]

    def __init__(self, ffprobe_bin: Optional[str] = None):
        self.ffprobe_bin = self._resolve_ffprobe_bin(
            ffprobe_bin or settings.ffprobe_bin,
            allow_deferred=ffprobe_bin is None,
        )

    async def validate_file(self, file_path: Path) -> Dict[str, Any]:
        """Validate media file for streaming compatibility and return metadata."""
        try:
            meta = await self._get_metadata(file_path)

            try:
                keyframe_stats = await self._analyze_keyframes(file_path)
            except (
                Exception
            ) as exc:  # pragma: no cover - defensive logging around ffprobe
                logger.warning("Keyframe analysis failed for %s: %s", file_path, exc)
                keyframe_stats = None

            is_compatible, media_kind = self._check_compatibility(
                meta, keyframe_stats=keyframe_stats
            )
            validation_errors = (
                []
                if is_compatible
                else self._get_validation_errors(
                    meta,
                    media_kind,
                    keyframe_stats=keyframe_stats,
                )
            )

            return {
                "compatible_for_copy": is_compatible,
                "meta": meta,
                "validation_errors": validation_errors,
                "keyframe_stats": keyframe_stats,
            }
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Error validating file %s: %s", file_path, exc)
            error_message = str(exc)
            if isinstance(exc, FileNotFoundError):
                error_message = self.MISSING_FFPROBE_MESSAGE
            return {
                "compatible_for_copy": False,
                "meta": {},
                "validation_errors": [error_message],
                "keyframe_stats": None,
            }

    @classmethod
    def _resolve_ffprobe_bin(cls, candidate: str, *, allow_deferred: bool) -> str:
        """Resolve FFprobe from config/PATH while preserving dry-run behavior."""
        provided_path = Path(candidate)
        if provided_path.exists():
            return str(provided_path)

        detected = shutil.which(candidate) if candidate else None
        if detected:
            logger.info("Using ffprobe binary at %s", detected)
            return detected

        fallback = shutil.which("ffprobe")
        if fallback:
            logger.info("Detected ffprobe binary via PATH at %s", fallback)
            return fallback

        if allow_deferred:
            deferred_candidate = provided_path.name or "ffprobe"
            logger.warning(
                "ffprobe binary %s not found during initialization; deferring resolution until execution time",
                candidate,
            )
            return deferred_candidate

        raise FileNotFoundError(f"ffprobe binary not found: {candidate}")

    async def _get_metadata(self, file_path: Path) -> Dict[str, Any]:
        """Get video metadata using ffprobe"""
        cmd = [
            self.ffprobe_bin,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(file_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {stderr.decode()}")

        return json.loads(stdout.decode())

    def _check_compatibility(
        self,
        meta: Dict[str, Any],
        *,
        keyframe_stats: Optional[Dict[str, Any]] = None,
    ) -> tuple[bool, str]:
        """Return compatibility flag and detected media kind."""
        try:
            video_stream, audio_stream, _cover_art, media_kind = self._classify_streams(
                meta
            )

            if media_kind == "audio":
                if not audio_stream:
                    return False, media_kind
                codec = (audio_stream.get("codec_name") or "").lower()
                if codec not in self.ALLOWED_AUDIO_CODECS:
                    return False, media_kind
                return True, media_kind

            if not video_stream or not audio_stream:
                return False, media_kind

            if video_stream.get("codec_name") != self.REQUIRED_VIDEO_CODEC:
                return False, media_kind

            codec = (audio_stream.get("codec_name") or "").lower()
            if codec not in self.ALLOWED_AUDIO_CODECS:
                return False, media_kind

            if video_stream.get("pix_fmt") != self.REQUIRED_PIX_FMT:
                return False, media_kind

            gop_size = video_stream.get("gop_size")
            if gop_size and int(gop_size) > self.MAX_GOP_SIZE:
                return False, media_kind

            if keyframe_stats:
                max_interval = keyframe_stats.get("max_interval_seconds")
                if max_interval and max_interval > self.MAX_KEYFRAME_INTERVAL_SECONDS:
                    logger.debug(
                        "Keyframe interval %.2fs exceeds recommended limit %.2fs",
                        max_interval,
                        self.MAX_KEYFRAME_INTERVAL_SECONDS,
                    )

            profile = (video_stream.get("profile") or "").lower()
            if profile and profile not in ["high", "main"]:
                logger.warning("Non-optimal profile for stream copy: %s", profile)

            return True, media_kind

        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Error checking compatibility: %s", exc)
            return False, "unknown"

    def _get_validation_errors(
        self,
        meta: Dict[str, Any],
        media_kind: str,
        *,
        keyframe_stats: Optional[Dict[str, Any]] = None,
    ) -> list[str]:
        """Return validation errors tailored to detected media kind."""
        errors: list[str] = []
        video_stream, audio_stream, _cover_art, _ = self._classify_streams(meta)

        if media_kind == "audio":
            if not audio_stream:
                errors.append("No audio stream found")
            else:
                codec = (audio_stream.get("codec_name") or "").lower()
                if codec not in self.ALLOWED_AUDIO_CODECS:
                    errors.append(
                        "Audio codec must be one of "
                        f"{self.allowed_audio_codec_labels()}, "
                        f"got {audio_stream.get('codec_name')}"
                    )
            return errors

        if not video_stream:
            errors.append("No video stream found")
        else:
            if video_stream.get("codec_name") != self.REQUIRED_VIDEO_CODEC:
                errors.append(
                    f"Video codec must be {self.REQUIRED_VIDEO_CODEC}, got {video_stream.get('codec_name')}"
                )

            if video_stream.get("pix_fmt") != self.REQUIRED_PIX_FMT:
                errors.append(
                    f"Pixel format must be {self.REQUIRED_PIX_FMT}, got {video_stream.get('pix_fmt')}"
                )

            gop_size = video_stream.get("gop_size")
            if gop_size and int(gop_size) > self.MAX_GOP_SIZE:
                errors.append(
                    f"GOP size too large: {gop_size} (max {self.MAX_GOP_SIZE})"
                )

            if keyframe_stats:
                max_interval = keyframe_stats.get("max_interval_seconds")
                if max_interval and max_interval > self.MAX_KEYFRAME_INTERVAL_SECONDS:
                    logger.debug(
                        "Treating keyframe interval %.2fs as advisory warning only",
                        max_interval,
                    )

        if not audio_stream:
            errors.append("No audio stream found")
        else:
            codec = (audio_stream.get("codec_name") or "").lower()
            if codec not in self.ALLOWED_AUDIO_CODECS:
                errors.append(
                    "Audio codec must be one of "
                    f"{self.allowed_audio_codec_labels()}, "
                    f"got {audio_stream.get('codec_name')}"
                )

        return errors

    @classmethod
    def allowed_audio_codec_labels(cls) -> str:
        labels = {
            cls.AUDIO_CODEC_LABELS.get(codec, codec.upper())
            for codec in cls.ALLOWED_AUDIO_CODECS
        }
        return ", ".join(sorted(labels))

    def get_stream_info(self, meta: Dict[str, Any]) -> Dict[str, Any]:
        """Extract useful stream information"""
        streams = meta.get("streams", [])
        format_info = meta.get("format", {})

        video_stream, cover_art_stream = self._split_video_streams(streams)
        audio_stream = next((s for s in streams if s["codec_type"] == "audio"), None)

        info = {
            "duration": float(format_info.get("duration", 0)),
            "size_bytes": int(format_info.get("size", 0)),
            "bitrate": int(format_info.get("bit_rate", 0)),
        }

        has_primary_video = video_stream is not None

        if video_stream:
            info["video"] = {
                "codec": video_stream.get("codec_name"),
                "profile": video_stream.get("profile"),
                "width": video_stream.get("width"),
                "height": video_stream.get("height"),
                "fps": self._parse_fps(video_stream.get("r_frame_rate", "0/1")),
                "pix_fmt": video_stream.get("pix_fmt"),
                "bitrate": int(video_stream.get("bit_rate", 0)),
            }

        if cover_art_stream and not video_stream:
            info["cover_art"] = {
                "codec": cover_art_stream.get("codec_name"),
                "width": cover_art_stream.get("width"),
                "height": cover_art_stream.get("height"),
            }

        if audio_stream:
            info["audio"] = {
                "codec": audio_stream.get("codec_name"),
                "sample_rate": int(audio_stream.get("sample_rate", 0)),
                "channels": audio_stream.get("channels"),
                "bitrate": int(audio_stream.get("bit_rate", 0)),
            }

        warnings: list[str] = []

        if has_primary_video:
            recommendation, fps_bucket, fps_out_of_guideline = (
                self._match_bitrate_guidance(
                    info.get("video", {}).get("height"),
                    info.get("video", {}).get("fps"),
                )
            )

            if recommendation:
                bitrate_source = info.get("video", {}).get("bitrate") or info.get(
                    "bitrate"
                )
                bitrate_status = "unknown"
                if bitrate_source:
                    bitrate_mbps = bitrate_source / 1_000_000
                    if (
                        recommendation["min_bitrate_mbps"]
                        <= bitrate_mbps
                        <= recommendation["max_bitrate_mbps"]
                    ):
                        bitrate_status = "within"
                    else:
                        bitrate_status = "outside"
                        warnings.append(
                            "Video bitrate is outside the recommended range "
                            f"({recommendation['min_bitrate_mbps']}–{recommendation['max_bitrate_mbps']} Mbps, "
                            f"target {recommendation['target_bitrate_mbps']} Mbps)."
                        )

                info["recommendation"] = {
                    "label": recommendation["label"],
                    "fps": recommendation["fps"],
                    "min_bitrate_mbps": recommendation["min_bitrate_mbps"],
                    "max_bitrate_mbps": recommendation["max_bitrate_mbps"],
                    "target_bitrate_mbps": recommendation["target_bitrate_mbps"],
                    "normalized_fps": fps_bucket,
                    "fps_out_of_guideline": fps_out_of_guideline,
                    "bitrate_status": bitrate_status,
                }

            if recommendation and fps_out_of_guideline:
                warnings.append(
                    "Frame rate differs from the recommended 30 or 60 fps for live streaming."
                )
        else:
            info["recommendation"] = None

        if warnings:
            info["warnings"] = warnings

        return info

    def _parse_fps(self, fps_str: str) -> float:
        """Parse FPS from fraction string like '30000/1001'"""
        try:
            parts = fps_str.split("/")
            if len(parts) == 2:
                return float(parts[0]) / float(parts[1])
            return float(fps_str)
        except (ValueError, ZeroDivisionError):
            return 0.0

    def _normalize_fps(self, fps_value: Optional[float]) -> Tuple[Optional[int], bool]:
        """Map numeric fps into the 30/60 buckets and flag out-of-guideline values."""
        if not fps_value or fps_value <= 0:
            return None, True

        diff_30 = abs(fps_value - 30)
        diff_60 = abs(fps_value - 60)

        if diff_30 <= 3:
            return 30, False
        if diff_60 <= 5:
            return 60, False

        if diff_30 < diff_60:
            return 30, True
        return 60, True

    def _match_bitrate_guidance(
        self, height: Optional[int], fps_value: Optional[float]
    ):
        """Find the best matching bitrate recommendation for provided height/fps."""
        if not height:
            return None, None, True

        fps_bucket, fps_out_of_guideline = self._normalize_fps(fps_value)

        for entry in self.BITRATE_GUIDANCE:
            if (
                height >= entry["min_height"]
                and height <= entry["max_height"]
                and (fps_bucket is None or entry["fps"] == fps_bucket)
            ):
                return entry, fps_bucket, fps_out_of_guideline

        for entry in self.BITRATE_GUIDANCE:
            if height >= entry["min_height"] and height <= entry["max_height"]:
                return entry, fps_bucket, fps_out_of_guideline

        return None, fps_bucket, fps_out_of_guideline

    def _split_video_streams(
        self, streams: list[dict[str, Any]]
    ) -> Tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
        """Return primary video stream and optional cover art stream."""
        primary = None
        cover_art = None

        for stream in streams:
            if stream.get("codec_type") != "video":
                continue

            if self._is_cover_art_stream(stream):
                if cover_art is None:
                    cover_art = stream
                continue

            if primary is None:
                primary = stream
                continue

            # Prefer streams with higher resolution when multiple real video streams exist
            try:
                current_height = int(primary.get("height") or 0)
                candidate_height = int(stream.get("height") or 0)
            except (TypeError, ValueError):
                current_height = candidate_height = 0

            if candidate_height > current_height:
                primary = stream

        return primary, cover_art

    def _is_cover_art_stream(self, stream: dict[str, Any]) -> bool:
        disposition = stream.get("disposition") or {}
        if any(
            str(disposition.get(flag, 0)) == "1"
            for flag in ("attached_pic", "still_image", "cover_art")
        ):
            return True

        codec = (stream.get("codec_name") or "").lower()
        fps = self._parse_fps(
            stream.get("r_frame_rate") or stream.get("avg_frame_rate") or "0/1"
        )
        if codec in {"mjpeg", "png", "bmp", "jpeg"} and (fps is None or fps <= 1):
            nb_frames = stream.get("nb_frames")
            try:
                nb_frames_value = int(nb_frames)
            except (TypeError, ValueError):
                nb_frames_value = None
            if nb_frames_value is None or nb_frames_value <= 1:
                return True

        tags = stream.get("tags") or {}
        title = str(tags.get("title") or "").lower()
        if "cover" in title and "art" in title:
            return True

        return False

    def _classify_streams(self, meta: Dict[str, Any]) -> Tuple[
        Optional[dict[str, Any]],
        Optional[dict[str, Any]],
        Optional[dict[str, Any]],
        str,
    ]:
        streams = meta.get("streams", [])
        video_stream, cover_art = self._split_video_streams(streams)
        audio_stream = next(
            (s for s in streams if s.get("codec_type") == "audio"), None
        )

        if video_stream and audio_stream:
            return video_stream, audio_stream, cover_art, "video"
        if audio_stream and not video_stream:
            return None, audio_stream, cover_art, "audio"
        if video_stream and not audio_stream:
            return video_stream, None, cover_art, "video"
        return None, None, cover_art, "unknown"

    async def _analyze_keyframes(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Inspect keyframe timestamps to derive interval statistics."""

        cmd = [
            self.ffprobe_bin,
            "-v",
            "quiet",
            "-select_streams",
            "v:0",
            "-skip_frame",
            "nokey",
            "-show_entries",
            "frame=pkt_pts_time,best_effort_timestamp_time,pkt_dts_time",
            "-of",
            "json",
            str(file_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise RuntimeError(
                f"ffprobe keyframe analysis failed: {stderr.decode().strip()}"
            )

        try:
            payload = json.loads(stdout.decode())
        except (
            json.JSONDecodeError
        ) as exc:  # pragma: no cover - malformed ffprobe output
            raise RuntimeError("Unable to parse ffprobe keyframe output") from exc

        frames = payload.get("frames") or []
        if len(frames) < 2:
            return {
                "keyframe_count": len(frames),
                "max_interval_seconds": None,
                "min_interval_seconds": None,
                "average_interval_seconds": None,
            }

        timestamps: list[float] = []

        for frame in frames:
            raw_ts = (
                frame.get("pkt_pts_time")
                or frame.get("best_effort_timestamp_time")
                or frame.get("pkt_dts_time")
            )
            if raw_ts is None:
                continue
            try:
                timestamps.append(float(raw_ts))
            except (TypeError, ValueError):
                continue

        if len(timestamps) < 2:
            return {
                "keyframe_count": len(timestamps),
                "max_interval_seconds": None,
                "min_interval_seconds": None,
                "average_interval_seconds": None,
            }

        timestamps.sort()

        intervals = [b - a for a, b in zip(timestamps, timestamps[1:]) if b >= a]
        if not intervals:
            return {
                "keyframe_count": len(timestamps),
                "max_interval_seconds": None,
                "min_interval_seconds": None,
                "average_interval_seconds": None,
            }

        max_interval = max(intervals)
        min_interval = min(intervals)
        avg_interval = sum(intervals) / len(intervals)

        return {
            "keyframe_count": len(timestamps),
            "max_interval_seconds": max_interval,
            "min_interval_seconds": min_interval,
            "average_interval_seconds": avg_interval,
        }
