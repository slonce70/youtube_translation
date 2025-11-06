import asyncio
import logging
import signal
import shutil
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

import aiofiles
import psutil
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.database import get_db_context
from app.models.database import Stream, SystemAlert

logger = logging.getLogger(__name__)


@dataclass
class PipelineTrackConfig:
    """Configuration describing a single FFmpeg playlist input."""

    playlist: Optional[Path] = None
    loop: bool = True
    copy_compatible: bool = False

    def __post_init__(self):
        if isinstance(self.playlist, str):
            self.playlist = Path(self.playlist)

    def has_input(self) -> bool:
        return self.playlist is not None


@dataclass
class StreamPipelineConfig:
    """High level instructions for FFmpeg command generation."""

    mode: Literal["video_only", "audio_only", "mixed"] = "mixed"
    video: PipelineTrackConfig = field(default_factory=PipelineTrackConfig)
    audio: PipelineTrackConfig = field(default_factory=PipelineTrackConfig)
    notes: Dict[str, Any] = field(default_factory=dict)

    def has_video(self) -> bool:
        return self.video.has_input()

    def has_audio(self) -> bool:
        return self.audio.has_input()

    def describe(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "video": {
                "playlist": str(self.video.playlist) if self.video.playlist else None,
                "loop": self.video.loop,
                "copy_compatible": self.video.copy_compatible,
            },
            "audio": {
                "playlist": str(self.audio.playlist) if self.audio.playlist else None,
                "loop": self.audio.loop,
                "copy_compatible": self.audio.copy_compatible,
            },
            "notes": self.notes,
        }


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
        playlist_file: Optional[Path],
        destinations: List[Dict[str, str]],
        log_file: Optional[Path] = None,
        metadata: Optional[Dict[str, Any]] = None,
        restart: bool = False,
        pipeline_config: Optional[StreamPipelineConfig] = None,
    ) -> bool:
        """
        Start streaming to multiple YouTube channels using FFmpeg tee muxer.
        
        Args:
            stream_id: Unique stream identifier
            playlist_file: Optional legacy concat playlist file
            destinations: List of dicts with 'url' and 'key' for each YouTube channel
            log_file: Optional path to log file
            metadata: Optional extra context (user_id, stream metadata) for monitoring
            restart: Internal flag used when auto-restarting a failed stream
            pipeline_config: Advanced media pipeline configuration

        Returns:
            True if stream started successfully
        """
        if not destinations:
            raise ValueError("At least one destination is required to start streaming")

        try:
            if stream_id in self.active_streams:
                logger.warning(f"Stream {stream_id} is already running")
                return False

            playlist_path: Optional[Path] = None
            if playlist_file:
                playlist_path = Path(playlist_file)

            # Build FFmpeg command
            cmd = self._build_command(
                playlist_path,
                destinations,
                pipeline_config=pipeline_config,
            )

            logger.info(f"Starting stream {stream_id}")
            logger.debug(f"FFmpeg command: {' '.join(cmd)}")

            if pipeline_config is not None:
                logger.debug(
                    "Stream %s pipeline: %s",
                    stream_id,
                    pipeline_config.describe(),
                )

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
                "playlist_file": str(playlist_path) if playlist_path else None,
                "destinations": [dict(dest) for dest in destinations],
                "restart_attempts": existing_info.get("restart_attempts", 0) if restart else 0,
                "metadata": combined_metadata,
                "recent_errors": recent_errors if recent_errors is not None else deque(maxlen=20),
                "pipeline_config": pipeline_config,
                "ffmpeg_command": cmd,
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

        pipeline_config = info.get("pipeline_config")
        if isinstance(pipeline_config, StreamPipelineConfig):
            info["pipeline_config"] = pipeline_config.describe()

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
        playlist_file: Optional[Path],
        destinations: List[Dict[str, str]],
        *,
        pipeline_config: Optional[StreamPipelineConfig] = None,
    ) -> List[str]:
        """Build FFmpeg command for streaming"""

        normalized_destinations = self._normalize_destinations(destinations)

        if pipeline_config is not None:
            return self._build_command_for_pipeline(normalized_destinations, pipeline_config)

        if playlist_file is None:
            raise ValueError("playlist_file is required when pipeline configuration is not provided")

        if len(normalized_destinations) == 1:
            target = normalized_destinations[0]["uri"]
            cmd = [
                self.ffmpeg_bin,
                "-re",
                "-f", "concat",
                "-safe", "0",
                "-i", str(playlist_file),
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-c:v", "copy",
                "-c:a", "copy",
                "-bsf:v", "h264_mp4toannexb",
                "-tag:v", "7",
                "-tag:a", "10",
                "-f", "flv",
                target,
            ]
            return cmd

        tee_outputs = []
        for dest in normalized_destinations:
            uri = dest["uri"]
            output = (
                "[select='v\\:0,a\\:0':"
                "f=fifo:fifo_format=flv:attempt_recovery=1:recovery_wait_time=5]"
                f"{uri}"
            )
            tee_outputs.append(output)

        tee_output = "|".join(tee_outputs)

        cmd = [
            self.ffmpeg_bin,
            "-re",
            "-f", "concat",
            "-safe", "0",
            "-i", str(playlist_file),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-profile:v", "high",
            "-g", "60",
            "-c:a", "aac",
            "-ar", "44100",
            "-b:a", "160k",
            "-f", "tee",
            tee_output,
        ]

        return cmd

    def _normalize_destinations(self, destinations: List[Dict[str, str]]) -> List[Dict[str, str]]:
        normalized: List[Dict[str, str]] = []
        for dest in destinations:
            base_url = str(dest.get("url") or "").rstrip("/")
            stream_key = str(dest.get("key") or "").strip()
            if not base_url:
                normalized.append({"uri": stream_key})
            else:
                normalized.append({"uri": f"{base_url}/{stream_key}"})
        return normalized

    def _build_command_for_pipeline(
        self,
        destinations: List[Dict[str, str]],
        pipeline_config: StreamPipelineConfig,
    ) -> List[str]:
        """Build FFmpeg command for a dual-playlist pipeline configuration."""

        single_destination = len(destinations) == 1
        command: List[str] = [self.ffmpeg_bin, "-hide_banner", "-loglevel", "info", "-re"]

        input_index = 0
        stream_indexes: Dict[str, int] = {}

        if pipeline_config.video.playlist:
            video_path = Path(pipeline_config.video.playlist)
            if pipeline_config.video.loop:
                command.extend(["-stream_loop", "-1"])
            command.extend(["-f", "concat", "-safe", "0", "-i", str(video_path)])
            stream_indexes["video"] = input_index
            input_index += 1

        if pipeline_config.audio.playlist:
            audio_path = Path(pipeline_config.audio.playlist)
            if pipeline_config.audio.loop:
                command.extend(["-stream_loop", "-1"])
            command.extend(["-f", "concat", "-safe", "0", "-i", str(audio_path)])
            stream_indexes["audio"] = input_index
            input_index += 1

        map_video = "video" in stream_indexes
        map_audio = "audio" in stream_indexes

        if pipeline_config.mode == "mixed":
            if not (map_video and map_audio):
                raise ValueError("Mixed mode requires both video and audio playlists")
        elif pipeline_config.mode == "audio_only":
            if not map_audio:
                raise ValueError("Audio-only mode requires an audio playlist")
            if not map_video:
                logger.warning(
                    "Audio-only pipeline missing video placeholder; RTMP providers may reject the stream",
                )
        elif pipeline_config.mode == "video_only":
            if not map_video:
                raise ValueError("Video-only mode requires a video playlist")
            if not map_audio:
                logger.info("Video-only pipeline will stream without audio track")
        else:
            raise ValueError(f"Unsupported pipeline mode: {pipeline_config.mode}")

        if map_video:
            command.extend(["-map", f"{stream_indexes['video']}:v:0"])
        else:
            command.append("-vn")

        if map_audio:
            command.extend(["-map", f"{stream_indexes['audio']}:a:0"])
        else:
            command.append("-an")

        if not single_destination:
            video_copy = False
            audio_copy = False
        else:
            video_copy = pipeline_config.video.copy_compatible and map_video
            audio_copy = pipeline_config.audio.copy_compatible and map_audio

        if map_video:
            if video_copy:
                command.extend(["-c:v", "copy", "-bsf:v", "h264_mp4toannexb", "-tag:v", "7"])
            else:
                command.extend([
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-pix_fmt", "yuv420p",
                    "-profile:v", "high",
                    "-g", "60",
                ])

        if map_audio:
            if audio_copy:
                command.extend(["-c:a", "copy", "-tag:a", "10"])
            else:
                command.extend(["-c:a", "aac", "-ar", "48000", "-b:a", "160k"])

        if single_destination:
            target = destinations[0]["uri"]
            command.extend(["-f", "flv", target])
        else:
            tee_outputs = []
            for dest in destinations:
                uri = dest["uri"]
                tee_outputs.append(
                    "[select='v\\:0,a\\:0':"
                    "f=fifo:fifo_format=flv:attempt_recovery=1:recovery_wait_time=5]"
                    f"{uri}"
                )
            command.extend(["-f", "tee", "|".join(tee_outputs)])

        return command

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

            if settings.ffmpeg_resource_log_interval_seconds > 0:
                asyncio.create_task(self._track_resource_usage(stream_id, process))

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

                await self._finalize_stream_success(stream_id, manual_stop)

                async with self._cleanup_lock:
                    self.active_streams.pop(stream_id, None)
                    self.stream_info.pop(stream_id, None)
            else:
                logger.error(f"Stream {stream_id} exited with code {returncode}")
                await self._handle_stream_failure(stream_id, returncode)

        except Exception as e:
            logger.exception(f"Error monitoring stream {stream_id}: {e}")

    async def hot_swap_stream(
        self,
        stream_id: str,
        pipeline_config: StreamPipelineConfig,
        *,
        metadata: Optional[Dict[str, Any]] = None,
        destinations: Optional[List[Dict[str, str]]] = None,
        log_file: Optional[Path] = None,
    ) -> bool:
        """Replace a running FFmpeg pipeline with a new configuration."""

        info_snapshot = self.stream_info.get(stream_id)
        if destinations is None and info_snapshot is not None:
            destinations = [dict(dest) for dest in info_snapshot.get("destinations", [])]

        if not destinations:
            raise ValueError("Cannot hot swap stream without destinations")

        combined_metadata: Dict[str, Any] = {}
        if info_snapshot and isinstance(info_snapshot.get("metadata"), dict):
            combined_metadata.update(info_snapshot["metadata"])
        if metadata:
            combined_metadata.update(metadata)

        log_target = log_file
        if log_target is None and info_snapshot and info_snapshot.get("log_file"):
            log_target = Path(info_snapshot["log_file"])

        was_running = self.is_running(stream_id)
        if was_running:
            logger.info("Hot swap requested for stream %s", stream_id)
            stop_success = await self.stop_stream(stream_id)
            if not stop_success:
                logger.warning("Failed to stop stream %s during hot swap", stream_id)

        return await self.start_stream(
            stream_id,
            None,
            destinations,
            log_target,
            metadata=combined_metadata or None,
            restart=was_running,
            pipeline_config=pipeline_config,
        )

    async def _track_resource_usage(self, stream_id: str, process: asyncio.subprocess.Process):
        """Periodically log FFmpeg CPU and memory usage."""

        interval = max(settings.ffmpeg_resource_log_interval_seconds, 0)
        if interval <= 0:
            return

        try:
            tracked_process = psutil.Process(process.pid)
        except (psutil.NoSuchProcess, psutil.Error) as exc:
            logger.debug("Cannot monitor FFmpeg process %s: %s", stream_id, exc)
            return

        try:
            tracked_process.cpu_percent(interval=None)
        except psutil.Error:
            pass

        while True:
            if process.returncode is not None:
                break

            try:
                cpu_percent = tracked_process.cpu_percent(interval=None)
                mem_info = tracked_process.memory_info()
                rss_mb = mem_info.rss / (1024 * 1024)
                vms_mb = mem_info.vms / (1024 * 1024)
                logger.debug(
                    "Stream %s resource usage: CPU %.1f%%, RSS %.1f MiB, VMS %.1f MiB",
                    stream_id,
                    cpu_percent,
                    rss_mb,
                    vms_mb,
                )
            except (psutil.NoSuchProcess, psutil.Error) as exc:
                logger.debug("Stopping resource tracking for %s: %s", stream_id, exc)
                break

            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break

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
            pipeline_config = info.get("pipeline_config")

            try:
                await asyncio.sleep(max(settings.ffmpeg_restart_backoff_seconds, 0))
            except Exception:
                pass

            async with self._cleanup_lock:
                self.active_streams.pop(stream_id, None)

            playlist_path = Path(playlist_file) if playlist_file else None

            if destinations and (playlist_path or pipeline_config):
                try:
                    if playlist_path is not None and not playlist_path.exists():
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
                            pipeline_config=pipeline_config,
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

    async def _finalize_stream_success(self, stream_id: str, manual_stop: bool) -> None:
        """Persist success status and uptime when FFmpeg завершується без помилок."""
        try:
            stream_uuid = UUID(str(stream_id))
        except ValueError:
            logger.debug("Stream ID %s не є UUID — пропускаємо фіналізацію в БД", stream_id)
            return

        now = datetime.now(timezone.utc)

        try:
            async with get_db_context() as session:
                stream = await session.get(Stream, stream_uuid)
                if stream is None:
                    logger.debug("Не знайшли stream %s у БД для фіналізації", stream_id)
                    return

                started_at = stream.started_at
                if started_at is not None:
                    # Перетворюємо на aware datetime у UTC, якщо потрібно
                    if started_at.tzinfo is None:
                        started_aware = started_at.replace(tzinfo=timezone.utc)
                    else:
                        started_aware = started_at.astimezone(timezone.utc)
                    elapsed = (now - started_aware).total_seconds()
                    if elapsed > 0:
                        stream.total_duration_seconds = (stream.total_duration_seconds or 0.0) + elapsed

                stream.pid = None
                stream.stopped_at = now
                stream.error_message = None
                if stream.status != "stopped":
                    stream.status = "stopped"

        except SQLAlchemyError as exc:
            logger.exception("Помилка БД під час фіналізації stream %s: %s", stream_id, exc)
        except Exception as exc:
            logger.exception("Неочікувана помилка під час фіналізації stream %s: %s", stream_id, exc)


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
