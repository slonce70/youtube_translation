import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)


class VideoValidator:
    """Validates video files for YouTube streaming compatibility"""

    # YouTube requirements for stream copy
    REQUIRED_VIDEO_CODEC = "h264"
    REQUIRED_AUDIO_CODEC = "aac"
    REQUIRED_PIX_FMT = "yuv420p"
    MAX_GOP_SIZE = 120  # 4 seconds at 30fps
    RECOMMENDED_GOP_SIZE = 60  # 2 seconds at 30fps

    def __init__(self, ffprobe_bin: str = "/usr/bin/ffprobe"):
        candidate = Path(ffprobe_bin)
        if candidate.exists():
            self.ffprobe_bin = ffprobe_bin
        else:
            detected = shutil.which("ffprobe")
            if detected:
                logger.info("Using ffprobe binary at %s", detected)
                self.ffprobe_bin = detected
            else:
                raise FileNotFoundError(
                    "ffprobe binary not found. Install FFmpeg or set FFMPEG_BIN/FFPROBE_BIN in .env"
                )

    async def validate_file(self, file_path: Path) -> Dict[str, Any]:
        """
        Validate video file for YouTube streaming compatibility.
        Returns validation result with metadata.
        """
        try:
            # Get file metadata using ffprobe
            meta = await self._get_metadata(file_path)
            
            # Check compatibility
            is_compatible = self._check_compatibility(meta)
            
            return {
                "compatible_for_copy": is_compatible,
                "meta": meta,
                "validation_errors": self._get_validation_errors(meta) if not is_compatible else []
            }
        except Exception as e:
            logger.error(f"Error validating file {file_path}: {e}")
            return {
                "compatible_for_copy": False,
                "meta": {},
                "validation_errors": [str(e)]
            }

    async def _get_metadata(self, file_path: Path) -> Dict[str, Any]:
        """Get video metadata using ffprobe"""
        cmd = [
            self.ffprobe_bin,
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            str(file_path)
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {stderr.decode()}")

        return json.loads(stdout.decode())

    def _check_compatibility(self, meta: Dict[str, Any]) -> bool:
        """Check if video is compatible with YouTube streaming requirements"""
        try:
            streams = meta.get("streams", [])
            
            # Find video and audio streams
            video_stream = next((s for s in streams if s["codec_type"] == "video"), None)
            audio_stream = next((s for s in streams if s["codec_type"] == "audio"), None)

            if not video_stream or not audio_stream:
                return False

            # Check video codec
            if video_stream.get("codec_name") != self.REQUIRED_VIDEO_CODEC:
                return False

            # Check audio codec
            if audio_stream.get("codec_name") != self.REQUIRED_AUDIO_CODEC:
                return False

            # Check pixel format
            if video_stream.get("pix_fmt") != self.REQUIRED_PIX_FMT:
                return False

            # Check GOP size (if available)
            gop_size = video_stream.get("gop_size")
            if gop_size and int(gop_size) > self.MAX_GOP_SIZE:
                return False

            # Check profile (should be High or Main)
            profile = video_stream.get("profile", "").lower()
            if profile not in ["high", "main"]:
                logger.warning(f"Profile {profile} may not be optimal for YouTube")

            return True

        except Exception as e:
            logger.error(f"Error checking compatibility: {e}")
            return False

    def _get_validation_errors(self, meta: Dict[str, Any]) -> list:
        """Get list of validation errors"""
        errors = []
        streams = meta.get("streams", [])
        
        video_stream = next((s for s in streams if s["codec_type"] == "video"), None)
        audio_stream = next((s for s in streams if s["codec_type"] == "audio"), None)

        if not video_stream:
            errors.append("No video stream found")
        else:
            if video_stream.get("codec_name") != self.REQUIRED_VIDEO_CODEC:
                errors.append(f"Video codec must be {self.REQUIRED_VIDEO_CODEC}, got {video_stream.get('codec_name')}")
            
            if video_stream.get("pix_fmt") != self.REQUIRED_PIX_FMT:
                errors.append(f"Pixel format must be {self.REQUIRED_PIX_FMT}, got {video_stream.get('pix_fmt')}")
            
            gop_size = video_stream.get("gop_size")
            if gop_size and int(gop_size) > self.MAX_GOP_SIZE:
                errors.append(f"GOP size too large: {gop_size} (max {self.MAX_GOP_SIZE})")

        if not audio_stream:
            errors.append("No audio stream found")
        else:
            if audio_stream.get("codec_name") != self.REQUIRED_AUDIO_CODEC:
                errors.append(f"Audio codec must be {self.REQUIRED_AUDIO_CODEC}, got {audio_stream.get('codec_name')}")

        return errors

    def get_stream_info(self, meta: Dict[str, Any]) -> Dict[str, Any]:
        """Extract useful stream information"""
        streams = meta.get("streams", [])
        format_info = meta.get("format", {})
        
        video_stream = next((s for s in streams if s["codec_type"] == "video"), None)
        audio_stream = next((s for s in streams if s["codec_type"] == "audio"), None)

        info = {
            "duration": float(format_info.get("duration", 0)),
            "size_bytes": int(format_info.get("size", 0)),
            "bitrate": int(format_info.get("bit_rate", 0)),
        }

        if video_stream:
            info["video"] = {
                "codec": video_stream.get("codec_name"),
                "profile": video_stream.get("profile"),
                "width": video_stream.get("width"),
                "height": video_stream.get("height"),
                "fps": self._parse_fps(video_stream.get("r_frame_rate", "0/1")),
                "pix_fmt": video_stream.get("pix_fmt"),
                "bitrate": int(video_stream.get("bit_rate", 0))
            }

        if audio_stream:
            info["audio"] = {
                "codec": audio_stream.get("codec_name"),
                "sample_rate": int(audio_stream.get("sample_rate", 0)),
                "channels": audio_stream.get("channels"),
                "bitrate": int(audio_stream.get("bit_rate", 0))
            }

        return info

    def _parse_fps(self, fps_str: str) -> float:
        """Parse FPS from fraction string like '30000/1001'"""
        try:
            parts = fps_str.split("/")
            if len(parts) == 2:
                return float(parts[0]) / float(parts[1])
            return float(fps_str)
        except:
            return 0.0
