import asyncio
import logging
import signal
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class FFmpegStreamManager:
    """Manages FFmpeg streaming processes"""

    def __init__(self, ffmpeg_bin: str = "/usr/bin/ffmpeg"):
        self.ffmpeg_bin = ffmpeg_bin
        self.active_streams: Dict[str, asyncio.subprocess.Process] = {}
        self.stream_info: Dict[str, Dict] = {}

    async def start_stream(
        self,
        stream_id: str,
        playlist_file: Path,
        destinations: List[Dict[str, str]],
        log_file: Optional[Path] = None
    ) -> bool:
        """
        Start streaming to multiple YouTube channels using FFmpeg tee muxer.
        
        Args:
            stream_id: Unique stream identifier
            playlist_file: Path to concat demuxer playlist file
            destinations: List of dicts with 'url' and 'key' for each YouTube channel
            log_file: Optional path to log file
            
        Returns:
            True if stream started successfully
        """
        try:
            if stream_id in self.active_streams:
                logger.warning(f"Stream {stream_id} is already running")
                return False

            # Build FFmpeg command
            cmd = self._build_command(playlist_file, destinations)
            
            logger.info(f"Starting stream {stream_id}")
            logger.debug(f"FFmpeg command: {' '.join(cmd)}")

            # Open log file if specified
            log_handle = None
            if log_file:
                log_file.parent.mkdir(parents=True, exist_ok=True)
                log_handle = open(log_file, "wb")

            # Start FFmpeg process
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE if not log_handle else log_handle,
                stderr=asyncio.subprocess.PIPE if not log_handle else log_handle,
                preexec_fn=None  # Don't change process group
            )

            # Store process and metadata
            self.active_streams[stream_id] = process
            self.stream_info[stream_id] = {
                "started_at": datetime.utcnow(),
                "pid": process.pid,
                "destinations_count": len(destinations),
                "log_file": str(log_file) if log_file else None
            }

            logger.info(f"Stream {stream_id} started with PID {process.pid}")
            
            # Monitor process in background
            asyncio.create_task(self._monitor_process(stream_id, process, log_handle))

            return True

        except Exception as e:
            logger.error(f"Error starting stream {stream_id}: {e}")
            return False

    async def stop_stream(self, stream_id: str, timeout: int = 10) -> bool:
        """
        Stop a running stream gracefully.
        
        Args:
            stream_id: Stream identifier
            timeout: Timeout in seconds for graceful shutdown
            
        Returns:
            True if stream stopped successfully
        """
        try:
            if stream_id not in self.active_streams:
                logger.warning(f"Stream {stream_id} is not running")
                return False

            process = self.active_streams[stream_id]
            
            logger.info(f"Stopping stream {stream_id} (PID {process.pid})")

            # Send SIGINT for graceful shutdown
            process.send_signal(signal.SIGINT)

            try:
                # Wait for process to exit
                await asyncio.wait_for(process.wait(), timeout=timeout)
                logger.info(f"Stream {stream_id} stopped gracefully")
            except asyncio.TimeoutError:
                # Force kill if timeout
                logger.warning(f"Stream {stream_id} did not stop gracefully, forcing kill")
                process.kill()
                await process.wait()

            # Cleanup
            del self.active_streams[stream_id]
            del self.stream_info[stream_id]

            return True

        except Exception as e:
            logger.error(f"Error stopping stream {stream_id}: {e}")
            return False

    def is_running(self, stream_id: str) -> bool:
        """Check if stream is currently running"""
        if stream_id not in self.active_streams:
            return False
        
        process = self.active_streams[stream_id]
        return process.returncode is None

    def get_stream_info(self, stream_id: str) -> Optional[Dict]:
        """Get information about a running stream"""
        if stream_id not in self.stream_info:
            return None
        
        info = self.stream_info[stream_id].copy()
        info["is_running"] = self.is_running(stream_id)
        
        if info["is_running"] and "started_at" in info:
            uptime = (datetime.utcnow() - info["started_at"]).total_seconds()
            info["uptime_seconds"] = int(uptime)
        
        return info

    def get_all_streams(self) -> Dict[str, Dict]:
        """Get information about all streams"""
        return {
            stream_id: self.get_stream_info(stream_id)
            for stream_id in self.stream_info.keys()
        }

    async def stop_all_streams(self):
        """Stop all running streams"""
        stream_ids = list(self.active_streams.keys())
        for stream_id in stream_ids:
            await self.stop_stream(stream_id)

    def _build_command(
        self,
        playlist_file: Path,
        destinations: List[Dict[str, str]]
    ) -> List[str]:
        """Build FFmpeg command for streaming"""
        
        # Build tee muxer output
        tee_outputs = []
        for dest in destinations:
            rtmps_url = f"{dest['url']}/{dest['key']}"
            # Use fifo muxer with recovery for each destination
            output = f"[f=fifo:fifo_format=flv:attempt_recovery=1:recovery_wait_time=5]{rtmps_url}"
            tee_outputs.append(output)
        
        tee_output = "|".join(tee_outputs)

        # Build command
        cmd = [
            self.ffmpeg_bin,
            "-re",  # Read input at native frame rate
            "-f", "concat",
            "-safe", "0",
            "-i", str(playlist_file),
            "-c", "copy",  # NO TRANSCODING
            "-f", "tee",
            tee_output
        ]

        return cmd

    async def _monitor_process(
        self,
        stream_id: str,
        process: asyncio.subprocess.Process,
        log_handle
    ):
        """Monitor FFmpeg process and cleanup on exit"""
        try:
            returncode = await process.wait()
            
            if returncode == 0:
                logger.info(f"Stream {stream_id} exited normally")
            else:
                logger.error(f"Stream {stream_id} exited with code {returncode}")
            
            # Cleanup
            if stream_id in self.active_streams:
                del self.active_streams[stream_id]
            
            if log_handle:
                log_handle.close()

        except Exception as e:
            logger.error(f"Error monitoring stream {stream_id}: {e}")


# Global instance
ffmpeg_manager = FFmpegStreamManager()
