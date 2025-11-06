import asyncio
import logging
import signal
import shutil
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

import aiofiles
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.database import get_db_context
from app.models.database import Stream, SystemAlert

logger = logging.getLogger(__name__)


class FFmpegStreamManager:
    """Manages FFmpeg streaming processes"""

    def __init__(self, ffmpeg_bin: Optional[str] = None):
        self.ffmpeg_bin = self._resolve_ffmpeg_bin(ffmpeg_bin or settings.ffmpeg_bin)
        self.active_streams: Dict[str, asyncio.subprocess.Process] = {}
        self.stream_info: Dict[str, Dict] = {}
        self._cleanup_lock = asyncio.Lock()  # Thread-safety for cleanup operations

    async def start_stream(
        self,
        stream_id: str,
        playlist_file: Path,
        destinations: List[Dict[str, str]],
        log_file: Optional[Path] = None,
        metadata: Optional[Dict[str, Any]] = None,
        restart: bool = False,
    ) -> bool:
        """
        Start streaming to multiple YouTube channels using FFmpeg tee muxer.
        
        Args:
            stream_id: Unique stream identifier
            playlist_file: Path to concat demuxer playlist file
            destinations: List of dicts with 'url' and 'key' for each YouTube channel
            log_file: Optional path to log file
            metadata: Optional extra context (user_id, stream metadata) for monitoring
            restart: Internal flag used when auto-restarting a failed stream
            
        Returns:
            True if stream started successfully
        """
        if not destinations:
            raise ValueError("At least one destination is required to start streaming")

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
            existing_info = self.stream_info.get(stream_id, {}) if restart else {}
            recent_errors = existing_info.get("recent_errors") if restart else None
            combined_metadata = dict(existing_info.get("metadata", {})) if restart else {}

            if metadata:
                combined_metadata.update(metadata)

            self.active_streams[stream_id] = process
            self.stream_info[stream_id] = {
                "started_at": datetime.utcnow(),
                "pid": process.pid,
                "destinations_count": len(destinations),
                "log_file": str(log_file) if log_file else None,
                "playlist_file": str(playlist_file),
                "destinations": [dict(dest) for dest in destinations],
                "restart_attempts": existing_info.get("restart_attempts", 0) if restart else 0,
                "metadata": combined_metadata,
                "recent_errors": recent_errors if recent_errors is not None else deque(maxlen=20),
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
                info = self.stream_info.get(stream_id)
                if info is not None:
                    info["manual_stop"] = True
                
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
            base_url = str(dest.get("url") or "").rstrip("/")
            stream_key = str(dest.get("key") or "").strip()
            rtmps_url = f"{base_url}/{stream_key}" if base_url else stream_key
            # Use fifo muxer with recovery for each destination to survive transient failures
            output = (
                "[select='v\\:0,a\\:0':"
                "f=fifo:fifo_format=flv:attempt_recovery=1:recovery_wait_time=5]"
                f"{rtmps_url}"
            )
            tee_outputs.append(output)
        
        tee_output = "|".join(tee_outputs)

        # Build command
        cmd = [
            self.ffmpeg_bin,
            "-re",  # Read input at native frame rate
            "-f", "concat",
            "-safe", "0",
            "-i", str(playlist_file),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "copy",  # keep original video stream
            "-c:a", "copy",  # keep original audio stream
            "-bsf:v", "h264_mp4toannexb",
            "-tag:v", "h264",
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

            info = self.stream_info.get(stream_id)
            if info is not None:
                info["last_exit_code"] = returncode
                info["last_finished_at"] = datetime.utcnow()
                manual_stop = bool(info.get("manual_stop"))
            else:
                manual_stop = False

            if returncode == 0 or manual_stop:
                if manual_stop and returncode != 0:
                    logger.info(
                        "Stream %s exited after manual stop (code %s)",
                        stream_id,
                        returncode,
                    )
                else:
                    logger.info(f"Stream {stream_id} exited normally")
                async with self._cleanup_lock:
                    self.active_streams.pop(stream_id, None)
                    self.stream_info.pop(stream_id, None)
            else:
                logger.error(f"Stream {stream_id} exited with code {returncode}")
                await self._handle_stream_failure(stream_id, returncode)

        except Exception as e:
            logger.exception(f"Error monitoring stream {stream_id}: {e}")

    async def _handle_stream_failure(self, stream_id: str, returncode: int):
        """Handle non-zero FFmpeg exit codes with alerts and optional restart."""
        info = self.stream_info.get(stream_id, {})
        metadata = info.get("metadata") or {}
        recent_errors_store = info.get("recent_errors")
        if isinstance(recent_errors_store, deque):
            recent_errors = list(recent_errors_store)[-10:]
        elif isinstance(recent_errors_store, list):
            recent_errors = recent_errors_store[-10:]
        else:
            recent_errors = []

        stream_uuid: Optional[UUID] = None
        try:
            stream_uuid = UUID(str(stream_id))
        except ValueError:
            logger.debug("Stream ID %s is not a UUID; skipping DB failure update", stream_id)

        if recent_errors:
            logger.error(
                "Recent FFmpeg stderr for %s:\n%s",
                stream_id,
                "\n".join(recent_errors[-5:]),
            )

        attempts = info.get("restart_attempts", 0)
        max_attempts = max(settings.ffmpeg_auto_restart_attempts, 0)
        will_restart = max_attempts > 0 and attempts < max_attempts

        await self._create_system_alert(
            stream_id=stream_id,
            metadata=metadata,
            returncode=returncode,
            recent_errors=recent_errors,
            restart_attempts=attempts,
            will_restart=will_restart,
        )

        final_failure = not will_restart

        if will_restart:
            info["restart_attempts"] = attempts + 1
            info["last_failure_at"] = datetime.utcnow()
            playlist_file = info.get("playlist_file")
            destinations = info.get("destinations")
            log_file = info.get("log_file")

            try:
                await asyncio.sleep(max(settings.ffmpeg_restart_backoff_seconds, 0))
            except Exception:
                pass

            async with self._cleanup_lock:
                self.active_streams.pop(stream_id, None)

            if playlist_file and destinations:
                try:
                    playlist_path = Path(playlist_file)
                    if not playlist_path.exists():
                        logger.error(
                            "Cannot auto restart stream %s: playlist file missing (%s)",
                            stream_id,
                            playlist_path,
                        )
                    else:
                        restart_success = await self.start_stream(
                            stream_id,
                            playlist_path,
                            [dict(dest) for dest in destinations],
                            Path(log_file) if log_file else None,
                            metadata=metadata,
                            restart=True,
                        )
                        if restart_success:
                            logger.info(
                                "Auto restart succeeded for stream %s (attempt %s/%s)",
                                stream_id,
                                info["restart_attempts"],
                                max_attempts,
                            )
                            return
                        else:
                            logger.error("Auto restart failed for stream %s", stream_id)
                except Exception:
                    logger.exception(f"Failed to auto restart stream {stream_id}")
            else:
                logger.error("Missing restart metadata for stream %s", stream_id)

            # Escalate if restart attempt failed or could not start
            await self._create_system_alert(
                stream_id=stream_id,
                metadata=metadata,
                returncode=returncode,
                recent_errors=recent_errors,
                restart_attempts=info.get("restart_attempts", attempts + 1),
                will_restart=False,
            )
            final_failure = True

        if final_failure and stream_uuid:
            await self._mark_stream_failed(stream_uuid, returncode, recent_errors)

        async with self._cleanup_lock:
            self.active_streams.pop(stream_id, None)
            self.stream_info.pop(stream_id, None)

    async def _create_system_alert(
        self,
        stream_id: str,
        metadata: Dict[str, Any],
        returncode: int,
        recent_errors: List[str],
        restart_attempts: int,
        will_restart: bool,
    ):
        """Persist a system alert when FFmpeg exits unexpectedly."""
        severity = "warning" if will_restart else "critical"

        user_uuid: Optional[UUID] = None
        raw_user_id = metadata.get("user_id")
        if raw_user_id:
            try:
                user_uuid = UUID(str(raw_user_id))
            except ValueError:
                logger.debug(
                    "Unable to parse user_id %s for FFmpeg alert on stream %s",
                    raw_user_id,
                    stream_id,
                )

        stream_uuid: Optional[UUID] = None
        try:
            stream_uuid = UUID(str(stream_id))
        except ValueError:
            logger.debug("Stream ID %s is not a UUID; storing alert without FK", stream_id)

        alert = SystemAlert(
            alert_type="stream_failure",
            severity=severity,
            user_id=user_uuid,
            stream_id=stream_uuid,
            message=f"FFmpeg process for stream {stream_id} exited with code {returncode}",
            details={
                "returncode": returncode,
                "recent_errors": recent_errors,
                "restart_attempts": restart_attempts,
                "will_restart": will_restart,
            },
        )

        try:
            async with get_db_context() as session:
                session.add(alert)
        except SQLAlchemyError as exc:
            logger.exception("Failed to persist FFmpeg alert for stream %s: %s", stream_id, exc)
        except Exception as exc:
            logger.exception("Unexpected error while persisting alert for stream %s: %s", stream_id, exc)
        else:
            logger.info(
                "Created %s alert for stream %s (attempt %s)",
                severity,
                stream_id,
                restart_attempts,
            )

    async def _mark_stream_failed(
        self,
        stream_uuid: UUID,
        returncode: int,
        recent_errors: List[str],
    ) -> None:
        """Update stream record to reflect a terminal FFmpeg failure."""
        try:
            async with get_db_context() as session:
                stream = await session.get(Stream, stream_uuid)
                if not stream:
                    logger.debug(
                        "Unable to persist failure state: stream %s not found in database",
                        stream_uuid,
                    )
                    return

                now = datetime.utcnow()
                if stream.started_at:
                    elapsed = (now - stream.started_at).total_seconds()
                    if elapsed > 0:
                        current_total = stream.total_duration_seconds or 0.0
                        stream.total_duration_seconds = current_total + elapsed

                stream.status = "error"
                stream.pid = None
                stream.stopped_at = now

                snippet = "; ".join(recent_errors[-3:]) if recent_errors else ""
                if snippet and len(snippet) > 500:
                    snippet = f"{snippet[:497]}..."

                if snippet:
                    stream.error_message = (
                        f"FFmpeg exited with code {returncode}. Last errors: {snippet}"
                    )
                else:
                    stream.error_message = f"FFmpeg exited with code {returncode}."

        except SQLAlchemyError as exc:
            logger.exception(
                "Database error while marking stream %s as failed: %s",
                stream_uuid,
                exc,
            )
        except Exception as exc:
            logger.exception(
                "Unexpected error while marking stream %s as failed: %s",
                stream_uuid,
                exc,
            )

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
                    try:
                        decoded = line.decode(errors="ignore").strip()
                    except Exception:
                        decoded = ""
                    if decoded:
                        info = self.stream_info.get(stream_id)
                        if info:
                            recent_errors = info.get("recent_errors")
                            if isinstance(recent_errors, deque):
                                recent_errors.append(decoded)
                    
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


    @staticmethod
    def _resolve_ffmpeg_bin(candidate: str) -> str:
        """Resolve FFmpeg binary path from settings or PATH with helpful errors."""
        provided_path = Path(candidate)
        if provided_path.exists():
            return str(provided_path)

        detected = shutil.which(candidate) if candidate else None
        if detected:
            logger.info("Using FFmpeg binary at %s", detected)
            return detected

        fallback = shutil.which("ffmpeg")
        if fallback:
            logger.info("Detected FFmpeg binary via PATH at %s", fallback)
            return fallback

        raise FileNotFoundError(
            "FFmpeg binary not found. Install FFmpeg or set FFMPEG_BIN in your environment."
        )


# Global instance
ffmpeg_manager = FFmpegStreamManager(settings.ffmpeg_bin)
