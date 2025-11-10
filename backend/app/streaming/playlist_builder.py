import hashlib
import logging
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Tuple, Any, Optional, Union

from app.core.config import settings
from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)


ALLOWED_LOOP_MODES = {"loop", "once", "shuffle"}


@dataclass
class PlaylistFileSet:
    """Artifacts generated for FFmpeg streaming inputs."""

    stream_dir: Path
    video_playlist: Optional[Path]
    audio_playlist: Optional[Path]
    mix_mode: str
    video_loop: bool
    audio_loop: bool
    needs_video_placeholder: bool = False
    needs_audio_placeholder: bool = False
    video_copy_compatible: bool = False
    audio_copy_compatible: bool = False
    video_assets: List[Dict[str, Any]] = field(default_factory=list)
    audio_assets: List[Dict[str, Any]] = field(default_factory=list)


class PlaylistBuilder:
    """Builds FFmpeg concat demuxer playlist files"""

    def __init__(self, streams_dir: Optional[Union[Path, str]] = None):
        self.streams_dir = Path(streams_dir) if streams_dir else Path(settings.stream_dir)

    async def build_playlist(self, playlist_id: str, assets: List[Dict[str, Any]]) -> Path:
        """Create a playlist file for the provided assets inside the configured streams directory."""

        if not assets:
            raise ValueError("Playlist asset list is empty")

        normalized_assets: List[Dict[str, Any]] = []
        for index, asset in enumerate(assets):
            try:
                file_path = Path(asset["file_path"])
            except KeyError as exc:
                raise ValueError("Asset entry is missing 'file_path'") from exc

            if not file_path.exists():
                raise FileNotFoundError(f"Asset file not found: {file_path}")

            normalized_assets.append({"path": str(file_path)})

        try:
            self.streams_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            logger.exception("Failed to prepare streams directory %s", self.streams_dir)
            raise

        output_file = self.streams_dir / f"{playlist_id}.txt"
        PlaylistBuilder.build_playlist_file(normalized_assets, output_file, loop=True)
        return output_file

    def prepare_stream_playlists(
        self,
        stream_id: str,
        stream_dir: Path,
        video_assets: Optional[List[Dict[str, Any]]],
        audio_assets: Optional[List[Dict[str, Any]]],
        mix_mode: str,
    ) -> PlaylistFileSet:
        """Generate playlist files for video/audio streams with shuffle & loop semantics."""

        normalized_mode = (mix_mode or "video_only").lower()
        if normalized_mode not in {"video_only", "audio_only", "mixed"}:
            raise ValueError(f"Unsupported mix mode: {mix_mode}")

        stream_dir.mkdir(parents=True, exist_ok=True)

        normalized_video = self._normalize_assets(video_assets or [])
        normalized_audio = self._normalize_assets(audio_assets or [])

        needs_video_placeholder = False
        needs_audio_placeholder = False

        if normalized_mode == "mixed":
            if not normalized_audio:
                raise ValueError("Mixed mode requires at least one audio asset")
            if not normalized_video:
                needs_video_placeholder = True
        elif normalized_mode == "video_only" and not normalized_video:
            raise ValueError("Video-only mode requires at least one video asset")
        elif normalized_mode == "audio_only" and not normalized_audio:
            raise ValueError("Audio-only mode requires at least one audio asset")

        video_loop = self._should_loop(normalized_video)
        audio_loop = self._should_loop(normalized_audio)
        video_shuffle = self._should_shuffle(normalized_video)
        audio_shuffle = self._should_shuffle(normalized_audio)

        video_playlist_path: Optional[Path] = None
        if normalized_video:
            video_playlist_path = stream_dir / "video.txt"
            PlaylistBuilder.build_playlist_file(
                normalized_video,
                video_playlist_path,
                loop=video_loop,
                shuffle=video_shuffle,
                seed=self._seed_from_components(stream_id, "video"),
            )

        audio_playlist_path: Optional[Path] = None
        if normalized_audio:
            audio_playlist_path = stream_dir / "audio.txt"
            PlaylistBuilder.build_playlist_file(
                normalized_audio,
                audio_playlist_path,
                loop=audio_loop,
                shuffle=audio_shuffle,
                seed=self._seed_from_components(stream_id, "audio"),
            )

        video_copy_compatible = bool(normalized_video) and all(
            asset.get("compatible_for_copy") is True for asset in normalized_video
        )
        audio_copy_compatible = self._audio_assets_compatible(normalized_audio)

        needs_video_placeholder = needs_video_placeholder or (normalized_mode == "audio_only")
        needs_audio_placeholder = (normalized_mode == "video_only")

        return PlaylistFileSet(
            stream_dir=stream_dir,
            video_playlist=video_playlist_path,
            audio_playlist=audio_playlist_path,
            mix_mode=normalized_mode,
            video_loop=video_loop,
            audio_loop=audio_loop,
            needs_video_placeholder=needs_video_placeholder,
            needs_audio_placeholder=needs_audio_placeholder,
            video_copy_compatible=video_copy_compatible,
            audio_copy_compatible=audio_copy_compatible,
            video_assets=normalized_video,
            audio_assets=normalized_audio,
        )

    def _normalize_assets(self, assets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []

        for asset in assets:
            entry = dict(asset)

            raw_path = entry.get("path") or entry.get("file_path")
            if not raw_path:
                raise ValueError("Asset entry missing 'path'")

            file_path = Path(str(raw_path)).expanduser()
            entry["path"] = str(file_path)

            loop_mode = self._sanitize_loop_mode(entry.get("loop_mode"))
            entry["loop_mode"] = loop_mode

            normalized.append(entry)

        return normalized

    @staticmethod
    def _sanitize_loop_mode(value: Optional[str]) -> str:
        if not value:
            return "loop"
        candidate = str(value).strip().lower()
        if candidate not in ALLOWED_LOOP_MODES:
            return "loop"
        return candidate

    @staticmethod
    def _should_loop(assets: List[Dict[str, Any]]) -> bool:
        if not assets:
            return False
        return any(asset.get("loop_mode") != "once" for asset in assets)

    @staticmethod
    def _should_shuffle(assets: List[Dict[str, Any]]) -> bool:
        if not assets:
            return False
        return any(asset.get("loop_mode") == "shuffle" for asset in assets)

    @staticmethod
    def _audio_assets_compatible(assets: List[Dict[str, Any]]) -> bool:
        if not assets:
            return False

        for asset in assets:
            meta = asset.get("meta") or {}
            audio = meta.get("audio") or {}
            codec = str(audio.get("codec") or "").lower()
            if codec != VideoValidator.REQUIRED_AUDIO_CODEC:
                return False
        return True

    @staticmethod
    def _seed_from_components(stream_id: str, suffix: str) -> int:
        digest = hashlib.sha1(f"{stream_id}:{suffix}".encode("utf-8")).digest()
        return int.from_bytes(digest[:8], "big", signed=False)

    @staticmethod
    def build_playlist_file(
        assets: List[Dict],
        output_file: Path,
        loop: bool = True,
        shuffle: bool = False,
        seed: Optional[int] = None,
    ) -> Path:
        """
        Build concat demuxer playlist file for FFmpeg.
        
        Args:
            assets: List of asset dicts with 'path' key
            output_file: Path where to save playlist.txt
            loop: Whether to enable infinite loop (currently not used to avoid descriptor leak)
            shuffle: Whether to shuffle assets before writing playlist
            seed: Optional deterministic seed for shuffle order
            
        Returns:
            Path to created playlist file
        """
        try:
            output_file.parent.mkdir(parents=True, exist_ok=True)

            playlist_entries = list(assets)
            if shuffle and len(playlist_entries) > 1:
                rng = random.Random(seed)
                rng.shuffle(playlist_entries)

            with open(output_file, "w") as f:
                f.write("ffconcat version 1.0\n")

                for asset in playlist_entries:
                    asset_path = Path(asset["path"]).expanduser()
                    if not asset_path.exists():
                        logger.error(f"Asset file not found: {asset_path}")
                        continue
                    resolved_path = asset_path.resolve()
                    escaped = resolved_path.as_posix().replace("'", "\\'")
                    # Write absolute path
                    f.write(f"file '{escaped}'\n")
            
            logger.info(f"Created playlist file: {output_file}")
            return output_file
            
        except Exception as e:
            logger.error(f"Error building playlist file: {e}")
            raise

    @staticmethod
    def validate_playlist_assets(assets: List[Dict]) -> Tuple[bool, List[Dict[str, Any]]]:
        """
        Validate that all assets in playlist have compatible parameters.

        For concat demuxer to work without transcoding, all files must have:
        - Same video codec and parameters
        - Same audio codec and parameters
        - Same resolution
        - Same frame rate
        
        Args:
            assets: List of asset dicts with 'meta' key containing stream info
            
        Returns:
            Tuple of (is_valid, issues). Issues is a list of dicts with details.
        """
        issues: List[Dict[str, Any]] = []

        def asset_label(index: int, asset: Dict) -> str:
            return (
                asset.get("filename")
                or asset.get("name")
                or asset.get("path")
                or f"asset #{index + 1}"
            )

        def add_issue(code: str, message: str, index: int, asset: Dict, **context):
            entry = {
                "code": code,
                "message": message,
                "asset_index": index,
                "asset_label": asset_label(index, asset),
            }
            if asset.get("path"):
                entry["asset_path"] = asset["path"]
            entry.update({k: v for k, v in context.items() if v is not None})
            issues.append(entry)

        if not assets:
            add_issue(
                "empty_playlist",
                "Playlist must contain at least one asset.",
                0,
                {},
            )
            return False, issues

        for index, asset in enumerate(assets):
            meta = asset.get("meta") or {}
            video = meta.get("video") or {}
            audio = meta.get("audio") or {}
            validation_errors = asset.get("validation_errors") or []

            for message in validation_errors:
                add_issue("validation_error", message, index, asset)

            if asset.get("compatible_for_copy") is False and not validation_errors:
                add_issue(
                    "requires_transcoding",
                    (
                        "Asset must be prepared with H.264 video, AAC audio, and yuv420p pixel "
                        "format before it can be streamed without transcoding."
                    ),
                    index,
                    asset,
                )

            if not video:
                message = "Video metadata is required for validation."
                add_issue(
                    "missing_video_metadata",
                    message,
                    index,
                    asset,
                )
                add_issue(
                    "missing_metadata",
                    message,
                    index,
                    asset,
                )
            else:
                video_codec = str(video.get("codec") or "").lower()
                if not video_codec:
                    add_issue(
                        "video_codec_missing",
                        "Video codec metadata is missing.",
                        index,
                        asset,
                    )
                elif video_codec != VideoValidator.REQUIRED_VIDEO_CODEC:
                    codec_message = (
                        f"Video codec must be {VideoValidator.REQUIRED_VIDEO_CODEC.upper()} for direct streaming."
                    )
                    add_issue(
                        "video_codec_invalid",
                        codec_message,
                        index,
                        asset,
                        expected=VideoValidator.REQUIRED_VIDEO_CODEC,
                        found=video_codec,
                    )
                    add_issue(
                        "video_codec_mismatch",
                        codec_message,
                        index,
                        asset,
                        expected=VideoValidator.REQUIRED_VIDEO_CODEC,
                        found=video_codec,
                    )

                pix_fmt = str(video.get("pix_fmt") or "").lower()
                if not pix_fmt:
                    add_issue(
                        "pixel_format_missing",
                        "Pixel format metadata is missing.",
                        index,
                        asset,
                    )
                elif pix_fmt != VideoValidator.REQUIRED_PIX_FMT:
                    add_issue(
                        "pixel_format_invalid",
                        f"Pixel format must be {VideoValidator.REQUIRED_PIX_FMT} for direct streaming.",
                        index,
                        asset,
                        expected=VideoValidator.REQUIRED_PIX_FMT,
                        found=pix_fmt,
                    )

            if not audio:
                message = "Audio metadata is required for validation."
                add_issue(
                    "missing_audio_metadata",
                    message,
                    index,
                    asset,
                )
                add_issue(
                    "missing_metadata",
                    message,
                    index,
                    asset,
                )
            else:
                audio_codec = str(audio.get("codec") or "").lower()
                if not audio_codec:
                    add_issue(
                        "audio_codec_missing",
                        "Audio codec metadata is missing.",
                        index,
                        asset,
                    )
                elif audio_codec != VideoValidator.REQUIRED_AUDIO_CODEC:
                    add_issue(
                        "audio_codec_invalid",
                        f"Audio codec must be {VideoValidator.REQUIRED_AUDIO_CODEC.upper()} for direct streaming.",
                        index,
                        asset,
                        expected=VideoValidator.REQUIRED_AUDIO_CODEC,
                        found=audio_codec,
                    )

        if issues:
            logger.warning("Playlist compatibility validation issues detected: %s", issues)
            return False, issues

        if len(assets) == 1:
            logger.info("Single asset playlist validated successfully")
            return True, []

        first = assets[0].get("meta") or {}
        first_video = first.get("video") or {}
        first_audio = first.get("audio") or {}

        if not first_video or not first_audio:
            add_issue(
                "missing_metadata",
                "Reference asset metadata is incomplete.",
                0,
                assets[0],
            )
            return False, issues

        for index, asset in enumerate(assets[1:], start=1):
            meta = asset.get("meta") or {}
            video = meta.get("video") or {}
            audio = meta.get("audio") or {}

            if not video or not audio:
                add_issue(
                    "missing_metadata",
                    "Asset metadata is required for validation.",
                    index,
                    asset,
                )
                continue

            if video.get("codec") != first_video.get("codec"):
                logger.error("Incompatible video codecs in playlist")
                add_issue(
                    "video_codec_mismatch",
                    "Video codec does not match reference asset.",
                    index,
                    asset,
                    expected=first_video.get("codec"),
                    found=video.get("codec"),
                )

            if (
                video.get("width") != first_video.get("width")
                or video.get("height") != first_video.get("height")
            ):
                logger.error("Incompatible resolutions in playlist")
                add_issue(
                    "resolution_mismatch",
                    "Video resolution does not match reference asset.",
                    index,
                    asset,
                    expected=f"{first_video.get('width')}x{first_video.get('height')}",
                    found=f"{video.get('width')}x{video.get('height')}",
                )

            if video.get("pix_fmt") != first_video.get("pix_fmt"):
                logger.error("Incompatible pixel formats in playlist")
                add_issue(
                    "pixel_format_mismatch",
                    "Pixel format does not match reference asset.",
                    index,
                    asset,
                    expected=first_video.get("pix_fmt"),
                    found=video.get("pix_fmt"),
                )

            if (
                first_video.get("fps") is not None
                and video.get("fps") is not None
                and video.get("fps") != first_video.get("fps")
            ):
                logger.error("Incompatible frame rates in playlist")
                add_issue(
                    "frame_rate_mismatch",
                    "Frame rate does not match reference asset.",
                    index,
                    asset,
                    expected=first_video.get("fps"),
                    found=video.get("fps"),
                )

            if audio.get("codec") != first_audio.get("codec"):
                logger.error("Incompatible audio codecs in playlist")
                add_issue(
                    "audio_codec_mismatch",
                    "Audio codec does not match reference asset.",
                    index,
                    asset,
                    expected=first_audio.get("codec"),
                    found=audio.get("codec"),
                )

            if audio.get("sample_rate") != first_audio.get("sample_rate"):
                logger.error("Incompatible audio sample rates in playlist")
                add_issue(
                    "audio_sample_rate_mismatch",
                    "Audio sample rate does not match reference asset.",
                    index,
                    asset,
                    expected=first_audio.get("sample_rate"),
                    found=audio.get("sample_rate"),
                )

        is_valid = len(issues) == 0
        if is_valid:
            logger.info("All playlist assets are compatible")
        return is_valid, issues

    @staticmethod
    def validate_audio_playlist_assets(assets: List[Dict]) -> Tuple[bool, List[Dict[str, Any]]]:
        """Validate that audio-only assets are ready for AAC streaming."""

        issues: List[Dict[str, Any]] = []

        def asset_label(index: int, asset: Dict) -> str:
            return (
                asset.get("filename")
                or asset.get("name")
                or asset.get("path")
                or f"asset #{index + 1}"
            )

        def add_issue(code: str, message: str, index: int, asset: Dict, **context):
            entry = {
                "code": code,
                "message": message,
                "asset_index": index,
                "asset_label": asset_label(index, asset),
            }
            if asset.get("path"):
                entry["asset_path"] = asset["path"]
            entry.update({k: v for k, v in context.items() if v is not None})
            issues.append(entry)

        if not assets:
            add_issue("empty_playlist", "Audio playlist must contain at least one asset.", 0, {})
            return False, issues

        allowed_sample_rates = {44100, 48000}

        for index, asset in enumerate(assets):
            meta = asset.get("meta") or {}
            audio = meta.get("audio") or {}

            if not audio:
                add_issue("missing_audio_metadata", "Audio metadata is required for streaming.", index, asset)
                continue

            codec = str(audio.get("codec") or "").lower()
            if codec != VideoValidator.REQUIRED_AUDIO_CODEC:
                add_issue(
                    "audio_codec_invalid",
                    f"Audio codec must be {VideoValidator.REQUIRED_AUDIO_CODEC.upper()} for direct streaming.",
                    index,
                    asset,
                    expected=VideoValidator.REQUIRED_AUDIO_CODEC,
                    found=codec,
                )

            sample_rate_raw = audio.get("sample_rate")
            try:
                sample_rate = int(sample_rate_raw) if sample_rate_raw is not None else None
            except (TypeError, ValueError):
                sample_rate = None

            if sample_rate is None:
                add_issue("audio_sample_rate_missing", "Audio sample rate metadata is missing.", index, asset)
            elif sample_rate not in allowed_sample_rates:
                add_issue(
                    "audio_sample_rate_mismatch",
                    "Audio sample rate must be 44100 or 48000 Hz for RTMP streaming.",
                    index,
                    asset,
                    expected=list(sorted(allowed_sample_rates)),
                    found=sample_rate,
                )

        if issues:
            logger.warning("Audio playlist validation issues detected: %s", issues)
            return False, issues

        return True, []

    @staticmethod
    async def combine_to_transport_stream(
        assets: List[Dict],
        output_file: Path
    ) -> Path:
        """
        Combine multiple compatible MP4 files into single MPEG-TS file without transcoding.
        This allows using -stream_loop -1 for infinite playback.
        
        Args:
            assets: List of asset dicts
            output_file: Path for output .ts file
            
        Returns:
            Path to created .ts file
        """
        import asyncio
        
        try:
            # Create temporary playlist
            temp_playlist = output_file.parent / f"{output_file.stem}_temp.txt"
            PlaylistBuilder.build_playlist_file(assets, temp_playlist, loop=False)
            
            # Combine using FFmpeg
            cmd = [
                settings.ffmpeg_bin,
                "-f", "concat",
                "-safe", "0",
                "-i", str(temp_playlist),
                "-c", "copy",
                "-bsf:v", "h264_mp4toannexb",  # Convert to Annex B format
                "-f", "mpegts",
                str(output_file)
            ]
            
            logger.info(f"Combining assets to transport stream: {output_file}")
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to combine files: {stderr.decode()}")
                raise RuntimeError("FFmpeg combination failed")
            
            # Cleanup temp playlist
            temp_playlist.unlink(missing_ok=True)
            
            logger.info(f"Successfully created transport stream: {output_file}")
            return output_file
            
        except Exception as e:
            logger.error(f"Error combining to transport stream: {e}")
            raise
