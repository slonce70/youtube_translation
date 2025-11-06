import logging
from pathlib import Path
from typing import List, Dict, Tuple, Any, Optional

from app.core.config import settings
from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)


class PlaylistBuilder:
    """Builds FFmpeg concat demuxer playlist files"""

    def __init__(self, streams_dir: Optional[Path | str] = None):
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
        except Exception as exc:
            logger.exception("Failed to prepare streams directory %s", self.streams_dir)
            raise

        output_file = self.streams_dir / f"{playlist_id}.txt"
        PlaylistBuilder.build_playlist_file(normalized_assets, output_file, loop=True)
        return output_file

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
                    
                    # Write absolute path
                    f.write(f"file '{asset_path.absolute()}'\n")
            
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
                add_issue(
                    "missing_video_metadata",
                    "Video metadata is required for validation.",
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
                    add_issue(
                        "video_codec_invalid",
                        f"Video codec must be {VideoValidator.REQUIRED_VIDEO_CODEC.upper()} for direct streaming.",
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
                add_issue(
                    "missing_audio_metadata",
                    "Audio metadata is required for validation.",
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
