import logging
from pathlib import Path
from typing import List, Dict

from app.core.config import settings

logger = logging.getLogger(__name__)


class PlaylistBuilder:
    """Builds FFmpeg concat demuxer playlist files"""

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
    def validate_playlist_assets(assets: List[Dict]) -> bool:
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
            True if all assets are compatible
        """
        if not assets:
            return False
        
        if len(assets) == 1:
            return True
        
        # Get reference parameters from first asset
        first = assets[0].get("meta", {})
        first_video = first.get("video", {})
        first_audio = first.get("audio", {})
        
        # Check all other assets
        for asset in assets[1:]:
            meta = asset.get("meta", {})
            video = meta.get("video", {})
            audio = meta.get("audio", {})
            
            # Check video parameters
            if video.get("codec") != first_video.get("codec"):
                logger.error("Incompatible video codecs in playlist")
                return False
            
            if video.get("width") != first_video.get("width") or \
               video.get("height") != first_video.get("height"):
                logger.error("Incompatible resolutions in playlist")
                return False
            
            if video.get("pix_fmt") != first_video.get("pix_fmt"):
                logger.error("Incompatible pixel formats in playlist")
                return False
            
            # Check audio parameters
            if audio.get("codec") != first_audio.get("codec"):
                logger.error("Incompatible audio codecs in playlist")
                return False
            
            if audio.get("sample_rate") != first_audio.get("sample_rate"):
                logger.error("Incompatible audio sample rates in playlist")
                return False
        
        logger.info("All playlist assets are compatible")
        return True

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
