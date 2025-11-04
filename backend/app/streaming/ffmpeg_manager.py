import asyncio
import logging
import signal
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
import aiofiles

logger = logging.getLogger(__name__)


class FFmpegStreamManager:
    """Manages FFmpeg streaming processes"""

    def __init__(self, ffmpeg_bin: str = "/usr/bin/ffmpeg"):
        self.ffmpeg_bin = ffmpeg_bin
        self.active_streams: Dict[str, asyncio.subprocess.Process] = {}
        self.stream_info: Dict[str, Dict] = {}
        self._cleanup_lock = asyncio.Lock()  # Thread-safety for cleanup operations

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

            # Start FFmpeg process with pipes (no file handle leak)
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
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
            
            # Monitor process in background and handle logs
            asyncio.create_task(self._monitor_process(stream_id, process, log_file))

            return True

        except Exception as e:
            logger.exception(f"Error starting stream {stream_id}: {e}")
            return False

    async def stop_stream(self, stream_id: str, timeout: int = 10) -> bool:
        """
        Stop a running stream gracefully with proper cleanup.
        
        Args:
            stream_id: Stream identifier
            timeout: Timeout in seconds for graceful shutdown
            
        Returns:
            True if stream stopped successfully
        """
        async with self._cleanup_lock:
            try:
                if stream_id not in self.active_streams:
                    logger.warning(f"Stream {stream_id} is not running")
                    # Cleanup orphaned info
                    if stream_id in self.stream_info:
                        del self.stream_info[stream_id]
                    return False

                process = self.active_streams[stream_id]
                
                logger.info(f"Stopping stream {stream_id} (PID {process.pid})")

                # Send SIGINT for graceful shutdown
                try:
                    process.send_signal(signal.SIGINT)
                except ProcessLookupError:
                    logger.warning(f"Process {process.pid} already terminated")

                try:
                    # Wait for process to exit
                    await asyncio.wait_for(process.wait(), timeout=timeout)
                    logger.info(f"Stream {stream_id} stopped gracefully")
                except asyncio.TimeoutError:
                    # Force kill if timeout
                    logger.warning(f"Stream {stream_id} timeout, forcing kill")
                    try:
                        process.kill()
                        await process.wait()
                    except ProcessLookupError:
                        pass

                # Cleanup
                if stream_id in self.active_streams:
                    del self.active_streams[stream_id]
                if stream_id in self.stream_info:
                    del self.stream_info[stream_id]

                return True

            except Exception as e:
                logger.exception(f"Error stopping stream {stream_id}: {e}")
                # Force cleanup on error
                self.active_streams.pop(stream_id, None)
                self.stream_info.pop(stream_id, None)
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
        log_file: Optional[Path]
    ):
        """Monitor FFmpeg process, write logs, and cleanup on exit"""
        try:
            # Write logs to file if specified
            if log_file:
                asyncio.create_task(self._write_logs_to_file(stream_id, process, log_file))
            
            returncode = await process.wait()
            
            if returncode == 0:
                logger.info(f"Stream {stream_id} exited normally")
            else:
                logger.error(f"Stream {stream_id} exited with code {returncode}")
            
            # Cleanup
            async with self._cleanup_lock:
                if stream_id in self.active_streams:
                    del self.active_streams[stream_id]
                if stream_id in self.stream_info:
                    del self.stream_info[stream_id]

        except Exception as e:
            logger.exception(f"Error monitoring stream {stream_id}: {e}")

    async def _write_logs_to_file(
        self,
        stream_id: str,
        process: asyncio.subprocess.Process,
        log_file: Path
    ):
        """Write process output to log file safely using async file operations"""
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            
            async with aiofiles.open(log_file, "wb") as f:
                while True:
                    line = await process.stderr.readline()
                    if not line:
                        break
                    await f.write(line)
                    
        except Exception as e:
            logger.exception(f"Error writing logs for stream {stream_id}: {e}")

    async def cleanup_dead_streams(self):
        """Periodically cleanup dead stream info to prevent memory leaks"""
        async with self._cleanup_lock:
            dead_streams = []
            for stream_id, process in list(self.active_streams.items()):
                if process.returncode is not None:
                    dead_streams.append(stream_id)
            
            for stream_id in dead_streams:
                logger.info(f"Cleaning up dead stream {stream_id}")
                self.active_streams.pop(stream_id, None)
                self.stream_info.pop(stream_id, None)


# Global instance
ffmpeg_manager = FFmpegStreamManager()
