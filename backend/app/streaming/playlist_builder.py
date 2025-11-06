import logging
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Tuple, Any, Optional, Union

from app.core.config import settings
from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)


@dataclass
class PlaylistOptions:
    """Options controlling playlist generation order."""

    loop: bool = True
    shuffle: bool = False
    shuffle_seed: Optional[int] = None


@dataclass
class PlaylistPlaceholders:
    """Filesystem paths for fallback media assets."""

    video: Optional[Path] = None
    audio: Optional[Path] = None


@dataclass
class PlaylistBuildResult:
    """Return value for dual-track playlist generation."""

    video_playlist: Optional[Path]
    audio_playlist: Optional[Path]
    video_loop: bool
    audio_loop: bool
    video_items: List[Dict[str, Any]] = field(default_factory=list)
    audio_items: List[Dict[str, Any]] = field(default_factory=list)
    video_shuffle_applied: bool = False
    audio_shuffle_applied: bool = False
    used_video_placeholder: bool = False
    used_audio_placeholder: bool = False
    video_copy_compatible: bool = False
    audio_copy_compatible: bool = False


class PlaylistBuilder:
    """Builds FFmpeg concat demuxer playlist files"""

    def __init__(self, streams_dir: Optional[Union[Path, str]] = None):
        self.streams_dir = Path(streams_dir) if streams_dir else Path(settings.stream_dir)

    def _resolve_placeholders(self, placeholders: Optional[PlaylistPlaceholders]) -> PlaylistPlaceholders:
        """Resolve placeholder paths from settings when not provided."""

        if placeholders is None:
            placeholders = PlaylistPlaceholders()

        if placeholders.video is None and settings.placeholder_video_path:
            placeholders.video = Path(settings.placeholder_video_path)
        if placeholders.audio is None and settings.placeholder_audio_path:
            placeholders.audio = Path(settings.placeholder_audio_path)

        return placeholders

    @staticmethod
    def _normalize_playlist_assets(
        assets: List[Dict[str, Any]],
        media_type: str,
        *,
        allow_empty: bool = False,
    ) -> List[Dict[str, Any]]:
        """Normalize raw asset payload into a structure suitable for playlist generation."""

        normalized: List[Dict[str, Any]] = []
        for index, asset in enumerate(assets):
            if not isinstance(asset, dict):
                raise ValueError(f"Invalid {media_type} asset at index {index}: expected dict")

            file_path = asset.get("file_path") or asset.get("path")
            if not file_path:
                raise ValueError(f"{media_type.title()} asset at index {index} is missing 'file_path'")

            path_obj = Path(file_path)
            if not path_obj.exists():
                raise FileNotFoundError(f"{media_type.title()} asset not found: {path_obj}")

            normalized.append(
                {
                    "path": path_obj,
                    "asset_id": asset.get("asset_id"),
                    "meta": asset.get("meta") or {},
                    "compatible_for_copy": bool(asset.get("compatible_for_copy", False)),
                    "placeholder": bool(asset.get("placeholder", False)),
                }
            )

        if not normalized and not allow_empty:
            raise ValueError(f"{media_type.title()} playlist must contain at least one asset")

        return normalized

    @staticmethod
    def _apply_shuffle(
        entries: List[Dict[str, Any]], options: PlaylistOptions
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """Shuffle playlist entries if requested."""

        if not entries:
            return [], False

        if not options.shuffle or len(entries) <= 1:
            return list(entries), False

        rng = random.Random(options.shuffle_seed)
        shuffled = list(entries)
        rng.shuffle(shuffled)
        return shuffled, True

    @staticmethod
    def _determine_copy_compatibility(entries: List[Dict[str, Any]]) -> bool:
        """Check if every entry is compatible with stream copy mode."""

        if not entries:
            return False

        compatible_items = [
            entry
            for entry in entries
            if not entry.get("placeholder")
        ]

        if not compatible_items:
            return False

        return all(entry.get("compatible_for_copy", False) for entry in compatible_items)

    def _prepare_track(
        self,
        assets: List[Dict[str, Any]],
        media_type: str,
        options: PlaylistOptions,
        placeholder: Optional[Path],
    ) -> Tuple[List[Dict[str, Any]], bool, bool, bool]:
        """
        Normalize and shuffle playlist entries, optionally appending a placeholder.

        Returns:
            Tuple of (entries, used_placeholder, copy_compatible, shuffle_applied)
        """

        entries = self._normalize_playlist_assets(assets, media_type, allow_empty=True)
        used_placeholder = False

        if not entries and placeholder is not None:
            placeholder_path = Path(placeholder)
            if placeholder_path.exists():
                entries = [
                    {
                        "path": placeholder_path,
                        "asset_id": None,
                        "meta": {},
                        "compatible_for_copy": False,
                        "placeholder": True,
                    }
                ]
                used_placeholder = True
            else:
                logger.warning(
                    "Placeholder for %s playlist does not exist: %s",
                    media_type,
                    placeholder_path,
                )

        if not entries:
            raise ValueError(
                f"{media_type.title()} playlist requires at least one asset or a valid placeholder"
            )

        ordered_entries, shuffle_applied = self._apply_shuffle(entries, options)
        copy_compatible = self._determine_copy_compatibility(ordered_entries)
        return ordered_entries, used_placeholder, copy_compatible, shuffle_applied

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
        except Exception as exc:
            logger.exception("Failed to prepare streams directory %s", self.streams_dir)
            raise

        output_file = self.streams_dir / f"{playlist_id}.txt"
        PlaylistBuilder.build_playlist_file(normalized_assets, output_file, loop=True)
        return output_file

    async def build_media_playlists(
        self,
        playlist_id: str,
        *,
        video_assets: Optional[List[Dict[str, Any]]] = None,
        audio_assets: Optional[List[Dict[str, Any]]] = None,
        video_options: Optional[PlaylistOptions] = None,
        audio_options: Optional[PlaylistOptions] = None,
        placeholders: Optional[PlaylistPlaceholders] = None,
    ) -> PlaylistBuildResult:
        """
        Generate dedicated playlists for video and audio tracks.

        Args:
            playlist_id: Identifier used for playlist filenames
            video_assets: Assets that provide video stream
            audio_assets: Assets that provide audio stream
            video_options: Ordering options for video playlist
            audio_options: Ordering options for audio playlist
            placeholders: Optional overrides for placeholder files

        Returns:
            PlaylistBuildResult with file paths and ordering metadata
        """

        video_assets = video_assets or []
        audio_assets = audio_assets or []

        if not video_assets and not audio_assets:
            raise ValueError("At least one audio or video asset is required to build playlists")

        video_options = video_options or PlaylistOptions()
        audio_options = audio_options or PlaylistOptions()
        placeholders = self._resolve_placeholders(placeholders)

        try:
            self.streams_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            logger.exception("Failed to prepare streams directory %s", self.streams_dir)
            raise

        video_entries: List[Dict[str, Any]] = []
        audio_entries: List[Dict[str, Any]] = []
        used_video_placeholder = False
        used_audio_placeholder = False
        video_shuffle_applied = False
        audio_shuffle_applied = False
        video_copy_compatible = False
        audio_copy_compatible = False

        if video_assets:
            video_entries, used_video_placeholder, video_copy_compatible, video_shuffle_applied = self._prepare_track(
                video_assets,
                "video",
                video_options,
                placeholders.video,
            )
        elif placeholders.video is not None:
            video_entries, used_video_placeholder, video_copy_compatible, video_shuffle_applied = self._prepare_track(
                [],
                "video",
                video_options,
                placeholders.video,
            )

        if audio_assets:
            audio_entries, used_audio_placeholder, audio_copy_compatible, audio_shuffle_applied = self._prepare_track(
                audio_assets,
                "audio",
                audio_options,
                placeholders.audio,
            )
        elif placeholders.audio is not None:
            audio_entries, used_audio_placeholder, audio_copy_compatible, audio_shuffle_applied = self._prepare_track(
                [],
                "audio",
                audio_options,
                placeholders.audio,
            )

        video_playlist_path: Optional[Path] = None
        audio_playlist_path: Optional[Path] = None

        if video_entries:
            video_playlist_path = self.streams_dir / f"{playlist_id}_video.txt"
            PlaylistBuilder.build_playlist_file(video_entries, video_playlist_path, loop=video_options.loop)

        if audio_entries:
            audio_playlist_path = self.streams_dir / f"{playlist_id}_audio.txt"
            PlaylistBuilder.build_playlist_file(audio_entries, audio_playlist_path, loop=audio_options.loop)

        if not video_playlist_path and not audio_playlist_path:
            raise ValueError("Failed to build playlists: no assets resolved for audio or video")

        return PlaylistBuildResult(
            video_playlist=video_playlist_path,
            audio_playlist=audio_playlist_path,
            video_loop=video_options.loop,
            audio_loop=audio_options.loop,
            video_items=video_entries,
            audio_items=audio_entries,
            video_shuffle_applied=video_shuffle_applied,
            audio_shuffle_applied=audio_shuffle_applied,
            used_video_placeholder=used_video_placeholder,
            used_audio_placeholder=used_audio_placeholder,
            video_copy_compatible=video_copy_compatible,
            audio_copy_compatible=audio_copy_compatible,
        )

    @staticmethod
    def build_playlist_file(
        assets: List[Dict],
        output_file: Path,
        loop: bool = True
    ) -> Path:
        """
        Build concat demuxer playlist file for FFmpeg.
        
        Args:
            assets: List of asset dicts with 'path' key
            output_file: Path where to save playlist.txt
            loop: Whether to enable infinite loop (currently not used to avoid descriptor leak)
            
        Returns:
            Path to created playlist file
        """
        try:
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_file, "w") as f:
                f.write("ffconcat version 1.0\n")
                
                for asset in assets:
                    asset_path = Path(asset["path"])
                    if not asset_path.exists():
                        logger.error(f"Asset file not found: {asset_path}")
                        continue

                    resolved = asset_path.resolve()
                    # Escape single quotes according to concat demuxer requirements
                    safe_path = resolved.as_posix().replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            
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
