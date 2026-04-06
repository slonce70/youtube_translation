import asyncio
import inspect
import logging
import re
import signal
import shutil
from urllib.parse import urlsplit, urlunsplit
from collections import deque
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import UUID

import aiofiles
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.database import get_db_context
from app.core.metrics import track_stream_error, track_stream_start, track_stream_stop
from app.core.observability import capture_alert
from app.core.quota import QuotaEnforcer
from app.core.stream_runtime_lease import clear_stream_runtime_lease
from app.core.stream_runtime_restart import clear_stream_runtime_restart_state
from app.models.database import Stream, SystemAlert
from app.streaming.hot_swap import hot_swap_manager
from app.streaming.playlist_builder import PlaylistFileSet

logger = logging.getLogger(__name__)


DEFAULT_KEYFRAME_INTERVAL_SECONDS = 2.0
MIN_KEYFRAME_INTERVAL_SECONDS = 0.5
MAX_KEYFRAME_INTERVAL_SECONDS = 4.0


_RTMP_URL_PATTERN = re.compile(r"rtmps?://[^\s'\"|]+", re.IGNORECASE)
_REMOTE_OUTPUT_RESET_MARKERS = (
    "connection reset by peer",
    "the specified session has been invalidated",
    "error writing trailer",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _redact_rtmp_uri(uri: str) -> str:
    try:
        parts = urlsplit(uri)
    except Exception:
        return uri

    if parts.scheme.lower() not in {"rtmp", "rtmps"}:
        return uri

    path = parts.path or ""
    if not path or path == "/":
        return uri

    segments = path.split("/")
    if len(segments) >= 2:
        segments[-1] = "<redacted>"
    redacted_path = "/".join(segments)

    return urlunsplit(
        (parts.scheme, parts.netloc, redacted_path, parts.query, parts.fragment)
    )


def _redact_rtmp_text(value: str) -> str:
    if not value:
        return value

    def _replace(match: re.Match[str]) -> str:
        return _redact_rtmp_uri(match.group(0))

    return _RTMP_URL_PATTERN.sub(_replace, value)


def _has_remote_output_reset_evidence(recent_errors: List[str]) -> bool:
    for line in recent_errors:
        lowered = str(line).lower()
        if any(marker in lowered for marker in _REMOTE_OUTPUT_RESET_MARKERS):
            return True
    return False


def _build_stream_failure_message(returncode: int, recent_errors: List[str]) -> str:
    snippet = "; ".join(
        _redact_rtmp_text(str(line).strip())
        for line in recent_errors[-3:]
        if str(line).strip()
    )
    if snippet and len(snippet) > 500:
        snippet = f"{snippet[:497]}..."

    base_message = f"FFmpeg exited with code {returncode}."
    if snippet:
        base_message = f"{base_message} Last errors: {snippet}"

    if _has_remote_output_reset_evidence(recent_errors):
        return (
            "Remote output disconnect evidence detected in FFmpeg logs. "
            f"{base_message}"
        )[:500]

    return base_message[:500]


def _build_tee_destination(uri: str) -> str:
    tee_fail_policy = settings.ffmpeg_tee_onfail_policy
    # FFmpeg's fifo muxer is explicitly recommended for network outputs when
    # temporary failures should be recovered transparently; see ffmpeg-formats
    # "fifo" muxer docs (attempt_recovery / recovery_wait_time).
    return (
        "[select='v\\:0,a\\:0':"
        f"onfail={tee_fail_policy}:"
        "f=fifo:fifo_format=flv:"
        "attempt_recovery=1:"
        "recovery_wait_time=5:"
        "recover_any_error=1:"
        "restart_with_keyframe=1:"
        "max_recovery_attempts=3]" + uri
    )


@dataclass
class FFmpegCommandPlan:
    """Structured summary of the FFmpeg command and encoding decisions."""

    command: List[str]
    copy_video: bool
    copy_audio: bool
    multi_destination: bool
    video_bitrate_kbps: Optional[int]
    video_maxrate_kbps: Optional[int]
    video_bufsize_kbps: Optional[int]
    audio_bitrate_kbps: Optional[int]
    uses_video_placeholder: bool
    uses_audio_placeholder: bool
    destination_uris: List[str]
    keyframe_interval_seconds: Optional[float] = None
    keyframe_gop_frames: Optional[int] = None
    tee_onfail_policy: Optional[str] = None

    def telemetry(self) -> Dict[str, Any]:
        """Return a sanitized dictionary for logging or in-memory state."""
        return {
            "copy_video": self.copy_video,
            "copy_audio": self.copy_audio,
            "multi_destination": self.multi_destination,
            "video_bitrate_kbps": self.video_bitrate_kbps,
            "video_maxrate_kbps": self.video_maxrate_kbps,
            "video_bufsize_kbps": self.video_bufsize_kbps,
            "audio_bitrate_kbps": self.audio_bitrate_kbps,
            "uses_video_placeholder": self.uses_video_placeholder,
            "uses_audio_placeholder": self.uses_audio_placeholder,
            "destination_uris": [
                _redact_rtmp_uri(uri) for uri in self.destination_uris
            ],
            "keyframe_interval_seconds": self.keyframe_interval_seconds,
            "keyframe_gop_frames": self.keyframe_gop_frames,
            "tee_onfail_policy": self.tee_onfail_policy,
        }


class FFmpegStreamManager:
    """Manages FFmpeg streaming processes"""

    def __init__(self, ffmpeg_bin: Optional[str] = None):
        self.ffmpeg_bin = self._resolve_ffmpeg_bin(
            ffmpeg_bin or settings.ffmpeg_bin,
            allow_deferred=ffmpeg_bin is None,
        )
        self.active_streams: Dict[str, asyncio.subprocess.Process] = {}
        self.stream_info: Dict[str, Dict] = {}
        self._cleanup_lock = asyncio.Lock()  # Thread-safety for cleanup operations
        self._monitor_tasks: Dict[str, asyncio.Task] = {}

    def _register_monitor_task(self, stream_id: str, task: asyncio.Task) -> None:
        """Track monitor tasks so they can be awaited or cancelled during shutdown."""
        if not isinstance(task, asyncio.Task):
            return

        self._monitor_tasks[stream_id] = task

        def _cleanup(
            completed: asyncio.Task, *, tracked_stream: str = stream_id
        ) -> None:
            stored = self._monitor_tasks.get(tracked_stream)
            if stored is completed:
                self._monitor_tasks.pop(tracked_stream, None)
            try:
                completed.result()
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # pragma: no cover - diagnostic safeguard
                logger.exception(
                    "Monitor task for stream %s raised unexpected error: %s",
                    tracked_stream,
                    exc,
                )

        task.add_done_callback(_cleanup)

    async def _await_monitor_task(self, stream_id: str) -> None:
        task = self._monitor_tasks.get(stream_id)
        if not isinstance(task, asyncio.Task):
            self._monitor_tasks.pop(stream_id, None)
            return

        current = asyncio.current_task()
        if task is current:
            return

        if not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "Waiting for monitor task of stream %s failed: %s",
                    stream_id,
                    exc,
                )

        self._monitor_tasks.pop(stream_id, None)

    async def _await_all_monitor_tasks(self) -> None:
        pending: List[Tuple[str, asyncio.Task]] = []
        for stream_id, task in list(self._monitor_tasks.items()):
            if not isinstance(task, asyncio.Task):
                self._monitor_tasks.pop(stream_id, None)
                continue
            if task is asyncio.current_task():
                continue
            if task.done():
                self._monitor_tasks.pop(stream_id, None)
                try:
                    task.result()
                except asyncio.CancelledError:
                    pass
                except Exception as exc:  # pragma: no cover
                    logger.exception(
                        "Monitor task for stream %s raised unexpected error: %s",
                        stream_id,
                        exc,
                    )
                continue
            pending.append((stream_id, task))

        for stream_id, task in pending:
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "Waiting for monitor task of stream %s failed: %s",
                    stream_id,
                    exc,
                )
            finally:
                stored = self._monitor_tasks.get(stream_id)
                if stored is task:
                    self._monitor_tasks.pop(stream_id, None)

    def _normalize_playlists(
        self, playlists: Union[PlaylistFileSet, Path, str]
    ) -> PlaylistFileSet:
        """Accept legacy playlist inputs by wrapping them in PlaylistFileSet."""

        if isinstance(playlists, PlaylistFileSet):
            return playlists

        playlist_path = Path(playlists)
        if playlist_path.is_dir():
            raise ValueError("Playlist path must point to a file, not a directory")
        if not playlist_path.exists():
            raise FileNotFoundError(f"Playlist file not found: {playlist_path}")

        return PlaylistFileSet(
            stream_dir=playlist_path.parent,
            video_playlist=playlist_path,
            audio_playlist=None,
            mix_mode="video_only",
            video_loop=True,
            audio_loop=False,
            needs_video_placeholder=False,
            needs_audio_placeholder=False,
            video_copy_compatible=False,
            audio_copy_compatible=False,
            video_assets=[],
            audio_assets=[],
        )

    async def start_stream(
        self,
        stream_id: str,
        playlists: Union[PlaylistFileSet, Path, str],
        destinations: List[Dict[str, str]],
        log_file: Optional[Path] = None,
        metadata: Optional[Dict[str, Any]] = None,
        restart: bool = False,
    ) -> bool:
        """
        Start streaming to multiple YouTube channels using FFmpeg tee muxer.

        Args:
            stream_id: Unique stream identifier
            playlists: Prepared playlist artifacts for video/audio inputs
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
            normalized_playlists = self._normalize_playlists(playlists)
            if stream_id in self.active_streams:
                logger.warning(f"Stream {stream_id} is already running")
                return False

            # Build FFmpeg command
            plan = self._build_command(normalized_playlists, destinations)
            cmd = plan.command

            logger.info(f"Starting stream {stream_id}")
            logger.debug("FFmpeg command: %s", _redact_rtmp_text(" ".join(cmd)))
            logger.info(
                "Stream %s plan: mix_mode=%s copy_video=%s copy_audio=%s placeholders={'video': %s, 'audio': %s} destinations=%s",
                stream_id,
                normalized_playlists.mix_mode,
                plan.copy_video,
                plan.copy_audio,
                plan.uses_video_placeholder,
                plan.uses_audio_placeholder,
                [_redact_rtmp_uri(uri) for uri in plan.destination_uris],
            )

            # Start FFmpeg process with pipes (no file handle leak)
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=None,  # Don't change process group
            )

            # Store process and metadata
            existing_info = self.stream_info.get(stream_id, {}) if restart else {}
            recent_errors = existing_info.get("recent_errors") if restart else None
            combined_metadata = (
                dict(existing_info.get("metadata", {})) if restart else {}
            )

            if metadata:
                combined_metadata.update(metadata)

            self.active_streams[stream_id] = process
            self.stream_info[stream_id] = {
                "started_at": _utcnow(),
                "pid": process.pid,
                "destinations_count": len(destinations),
                "log_file": str(log_file) if log_file else None,
                "playlists": replace(normalized_playlists),
                "destinations": [dict(dest) for dest in destinations],
                "restart_attempts": (
                    existing_info.get("restart_attempts", 0) if restart else 0
                ),
                "metadata": combined_metadata,
                "recent_errors": (
                    recent_errors
                    if recent_errors is not None
                    else deque(maxlen=settings.ffmpeg_error_history_size)
                ),
                "mix_mode": normalized_playlists.mix_mode,
                "ffmpeg_plan": plan.telemetry(),
            }

            logger.info(f"Stream {stream_id} started with PID {process.pid}")
            track_stream_start()

            try:
                await hot_swap_manager.register_stream(stream_id, normalized_playlists)
            except Exception:
                logger.exception(
                    "Failed to initialize hot swap manager for stream %s", stream_id
                )

            # Monitor process in background and handle logs
            monitor_task = asyncio.create_task(
                self._monitor_process(stream_id, process, log_file)
            )
            self._register_monitor_task(stream_id, monitor_task)

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
        try:
            stopped = False
            async with self._cleanup_lock:
                if stream_id not in self.active_streams:
                    logger.warning(f"Stream {stream_id} is not running")
                    if stream_id in self.stream_info:
                        del self.stream_info[stream_id]
                else:
                    process = self.active_streams[stream_id]
                    info = self.stream_info.get(stream_id)
                    if info is not None:
                        info["manual_stop"] = True

                    logger.info(f"Stopping stream {stream_id} (PID {process.pid})")

                    try:
                        process.send_signal(signal.SIGINT)
                    except ProcessLookupError:
                        logger.warning(f"Process {process.pid} already terminated")

                    try:
                        await asyncio.wait_for(
                            self._await_process_exit(stream_id, process),
                            timeout=timeout,
                        )
                        logger.info(f"Stream {stream_id} stopped gracefully")
                    except asyncio.TimeoutError:
                        logger.warning(f"Stream {stream_id} timeout, forcing kill")
                        try:
                            process.kill()
                            # Even after SIGKILL the process might not exit cleanly (or might be a mocked
                            # process in tests). Never hang forever on forced shutdown.
                            force_timeout = max(0.5, min(float(timeout), 5.0))
                            try:
                                await asyncio.wait_for(
                                    self._await_process_exit(stream_id, process),
                                    timeout=force_timeout,
                                )
                            except asyncio.TimeoutError:
                                logger.error(
                                    "Stream %s did not exit after SIGKILL within %.1fs; cleaning up anyway",
                                    stream_id,
                                    force_timeout,
                                )
                        except ProcessLookupError:
                            pass

                    if stream_id in self.active_streams:
                        del self.active_streams[stream_id]
                    if stream_id in self.stream_info:
                        del self.stream_info[stream_id]
                    stopped = True

            await self._await_monitor_task(stream_id)
            await hot_swap_manager.unregister_stream(stream_id)
            return stopped

        except Exception as e:
            logger.exception(f"Error stopping stream {stream_id}: {e}")
            self.active_streams.pop(stream_id, None)
            self.stream_info.pop(stream_id, None)
            await self._await_monitor_task(stream_id)
            return False

    async def restart_stream(
        self,
        stream_id: str,
        playlists: PlaylistFileSet,
        destinations: Optional[List[Dict[str, str]]] = None,
        log_file: Optional[Path] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Gracefully restart a running stream with updated playlists/destinations."""

        existing_info = self.stream_info.get(stream_id, {})
        stored_destinations = existing_info.get("destinations") or []
        resolved_destinations = destinations or [
            dict(dest) for dest in stored_destinations
        ]

        if not resolved_destinations:
            raise ValueError("Destinations are required to restart a stream")

        combined_metadata: Dict[str, Any] = dict(existing_info.get("metadata") or {})
        if metadata:
            combined_metadata.update(metadata)
        combined_metadata.setdefault("hot_swap", True)

        resolved_log: Optional[Path] = log_file
        if resolved_log is None:
            stored_log = existing_info.get("log_file")
            if isinstance(stored_log, str):
                resolved_log = Path(stored_log)

        logger.info("Restarting stream %s with hot swap metadata", stream_id)

        if stream_id in self.active_streams:
            stop_ok = await self.stop_stream(stream_id)
            if not stop_ok:
                logger.warning(
                    "Stream %s was not running during restart; starting fresh",
                    stream_id,
                )

        return await self.start_stream(
            stream_id=stream_id,
            playlists=playlists,
            destinations=resolved_destinations,
            log_file=resolved_log,
            metadata=combined_metadata,
            restart=True,
        )

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
            started_at = info["started_at"]
            if isinstance(started_at, datetime):
                if started_at.tzinfo is None:
                    started_at = started_at.replace(tzinfo=timezone.utc)
                uptime = (_utcnow() - started_at).total_seconds()
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
        await self._await_all_monitor_tasks()

    async def wait_for_exit(self, stream_id: str, poll_interval: float = 1.0) -> None:
        """Wait until a managed stream finishes executing."""
        stream_id = str(stream_id)
        while stream_id in self.active_streams:
            await asyncio.sleep(max(poll_interval, 0.1))

    def _build_command(
        self, playlists: PlaylistFileSet, destinations: List[Dict[str, str]]
    ) -> FFmpegCommandPlan:
        """Build FFmpeg command for streaming across supported modes."""

        normalized_destinations: List[Dict[str, str]] = []
        for dest in destinations:
            base_url = str(dest.get("url") or "").rstrip("/")
            stream_key = str(dest.get("key") or "").strip()
            if not base_url:
                normalized_destinations.append({"uri": stream_key})
            else:
                normalized_destinations.append({"uri": f"{base_url}/{stream_key}"})

        multi_destination = len(normalized_destinations) > 1

        copy_video = (
            playlists.video_playlist is not None
            and not playlists.needs_video_placeholder
            and playlists.video_copy_compatible
        )
        copy_audio = (
            playlists.audio_playlist is not None
            and not playlists.needs_audio_placeholder
            and playlists.audio_copy_compatible
        )

        # Keep logs user-friendly by default (no frame progress spam).
        cmd: List[str] = [self.ffmpeg_bin, "-hide_banner", "-nostats"]
        input_sections: List[Dict[str, Any]] = []

        def add_input(
            args: List[str], *, provides_video: bool, provides_audio: bool
        ) -> int:
            index = len(input_sections)
            input_sections.append(
                {
                    "args": args,
                    "provides_video": provides_video,
                    "provides_audio": provides_audio,
                }
            )
            return index

        video_input_idx: Optional[int] = None
        audio_input_idx: Optional[int] = None

        reuse_video_audio = (
            playlists.mix_mode == "video_only"
            and playlists.audio_playlist is None
            and playlists.video_has_audio
        )

        if playlists.mix_mode == "audio_only":
            if playlists.audio_playlist:
                audio_args: List[str] = []
                if playlists.audio_loop:
                    audio_args.extend(["-stream_loop", "-1"])
                audio_args.extend(
                    [
                        "-re",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(playlists.audio_playlist),
                    ]
                )
                audio_input_idx = add_input(
                    audio_args, provides_video=False, provides_audio=True
                )
            else:
                audio_input_idx = add_input(
                    self._build_audio_placeholder_args(),
                    provides_video=False,
                    provides_audio=True,
                )
                copy_audio = False

            video_input_idx = add_input(
                self._build_video_placeholder_args(playlists),
                provides_video=True,
                provides_audio=False,
            )
            copy_video = False
        else:
            if playlists.video_playlist:
                video_args: List[str] = []
                if playlists.video_loop:
                    video_args.extend(["-stream_loop", "-1"])
                video_args.extend(
                    [
                        "-re",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(playlists.video_playlist),
                    ]
                )
                video_input_idx = add_input(
                    video_args, provides_video=True, provides_audio=True
                )
            elif playlists.needs_video_placeholder:
                video_input_idx = add_input(
                    self._build_video_placeholder_args(playlists),
                    provides_video=True,
                    provides_audio=False,
                )
                copy_video = False
            else:
                raise ValueError("Video playlist is required for this stream mode")

            if reuse_video_audio:
                audio_input_idx = video_input_idx
                copy_audio = (
                    playlists.video_audio_copy_compatible
                    and not playlists.needs_audio_placeholder
                )
            elif playlists.mix_mode == "video_only":
                audio_input_idx = add_input(
                    self._build_audio_placeholder_args(),
                    provides_video=False,
                    provides_audio=True,
                )
                copy_audio = False
            elif playlists.audio_playlist:
                audio_args = []
                if playlists.audio_loop:
                    audio_args.extend(["-stream_loop", "-1"])
                audio_args.extend(
                    [
                        "-re",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(playlists.audio_playlist),
                    ]
                )
                audio_input_idx = add_input(
                    audio_args, provides_video=False, provides_audio=True
                )
            elif playlists.mix_mode == "mixed":
                raise ValueError("Mixed streams require an audio playlist")
            else:
                audio_input_idx = add_input(
                    self._build_audio_placeholder_args(),
                    provides_video=False,
                    provides_audio=True,
                )
                copy_audio = False

        if video_input_idx is None or audio_input_idx is None:
            raise ValueError("Failed to configure FFmpeg inputs for stream")

        for section in input_sections:
            cmd.extend(section["args"])

        cmd.extend(["-map", f"{video_input_idx}:v:0"])
        cmd.extend(["-map", f"{audio_input_idx}:a:0?"])

        video_bitrate: Optional[int] = None
        video_maxrate: Optional[int] = None
        video_bufsize: Optional[int] = None

        keyframe_interval_seconds: Optional[float] = None
        keyframe_gop_frames: Optional[int] = None

        if copy_video:
            cmd.extend(["-c:v", "copy", "-bsf:v", "h264_mp4toannexb", "-tag:v", "7"])
        else:
            video_bitrate = max(
                int(getattr(settings, "ffmpeg_video_bitrate_kbps", 6000)), 1000
            )
            video_maxrate = max(
                int(getattr(settings, "ffmpeg_video_maxrate_kbps", video_bitrate)),
                video_bitrate,
            )
            video_bufsize = max(
                int(getattr(settings, "ffmpeg_video_bufsize_kbps", video_maxrate * 2)),
                video_maxrate,
            )

            keyframe_gop_frames, keyframe_interval_seconds = (
                self._select_keyframe_settings(playlists)
            )
            gop_value = max(1, keyframe_gop_frames)
            keyframe_expr = f"expr:gte(t,n_forced*{keyframe_interval_seconds:.3f})"

            cmd.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-profile:v",
                    "high",
                    "-g",
                    str(gop_value),
                    "-keyint_min",
                    str(gop_value),
                    "-sc_threshold",
                    "0",
                    "-b:v",
                    f"{video_bitrate}k",
                    "-maxrate",
                    f"{video_maxrate}k",
                    "-bufsize",
                    f"{video_bufsize}k",
                    "-tune",
                    "zerolatency",
                    "-force_key_frames",
                    keyframe_expr,
                ]
            )
        video_bitrate_value = video_bitrate if not copy_video else None
        video_maxrate_value = video_maxrate if not copy_video else None
        video_bufsize_value = video_bufsize if not copy_video else None

        audio_bitrate: Optional[int] = None

        if copy_audio:
            cmd.extend(["-c:a", "copy", "-tag:a", "10"])
        else:
            sample_rate = getattr(settings, "placeholder_audio_sample_rate", 44100)
            audio_bitrate = max(
                int(getattr(settings, "ffmpeg_audio_bitrate_kbps", 160)), 64
            )
            cmd.extend(
                ["-c:a", "aac", "-ar", str(sample_rate), "-b:a", f"{audio_bitrate}k"]
            )
        audio_bitrate_value = audio_bitrate if not copy_audio else None

        if len(normalized_destinations) == 1:
            target = normalized_destinations[0]["uri"]
            # Even a single RTMP(S) destination benefits from fifo-based recovery,
            # otherwise a transient remote disconnect immediately tears down the
            # FFmpeg process.
            cmd.extend(
                [
                    "-f",
                    "fifo",
                    "-fifo_format",
                    "flv",
                    "-attempt_recovery",
                    "1",
                    "-recovery_wait_time",
                    "5",
                    "-recover_any_error",
                    "1",
                    "-restart_with_keyframe",
                    "1",
                    "-max_recovery_attempts",
                    "3",
                    target,
                ]
            )
            destination_uris = [target]
            tee_onfail_policy = None
        else:
            tee_outputs = []
            destination_uris = []
            for dest in normalized_destinations:
                uri = dest["uri"]
                destination_uris.append(uri)
                tee_outputs.append(_build_tee_destination(uri))

            cmd.extend(["-f", "tee", "|".join(tee_outputs)])
            tee_onfail_policy = settings.ffmpeg_tee_onfail_policy

        return FFmpegCommandPlan(
            command=cmd,
            copy_video=copy_video,
            copy_audio=copy_audio,
            multi_destination=multi_destination,
            video_bitrate_kbps=video_bitrate_value,
            video_maxrate_kbps=video_maxrate_value,
            video_bufsize_kbps=video_bufsize_value,
            audio_bitrate_kbps=audio_bitrate_value,
            uses_video_placeholder=playlists.needs_video_placeholder
            and playlists.video_playlist is None,
            uses_audio_placeholder=playlists.needs_audio_placeholder
            and playlists.audio_playlist is None,
            destination_uris=destination_uris,
            keyframe_interval_seconds=keyframe_interval_seconds,
            keyframe_gop_frames=keyframe_gop_frames,
            tee_onfail_policy=tee_onfail_policy,
        )

    @staticmethod
    def _parse_fps_value(raw: Any) -> Optional[float]:
        if raw is None:
            return None

        if isinstance(raw, (int, float)):
            try:
                value = float(raw)
            except (TypeError, ValueError):  # pragma: no cover - defensive conversion
                return None
            return value if value > 0 else None

        if isinstance(raw, str):
            text = raw.strip()
            if not text:
                return None
            if "/" in text:
                parts = text.split("/", 1)
                try:
                    numerator = float(parts[0])
                    denominator = float(parts[1])
                    if denominator == 0:
                        return None
                    value = numerator / denominator
                except (ValueError, ZeroDivisionError):
                    return None
            else:
                try:
                    value = float(text)
                except ValueError:
                    return None
            return value if value > 0 else None

        return None

    def _select_keyframe_settings(
        self, playlists: PlaylistFileSet
    ) -> Tuple[int, float]:
        fps_candidates: List[float] = []

        for asset in playlists.video_assets:
            meta = asset.get("meta") or {}
            video_meta = meta.get("video") or {}

            for key in ("fps", "avg_frame_rate", "r_frame_rate"):
                fps_value = self._parse_fps_value(video_meta.get(key))
                if fps_value:
                    fps_candidates.append(fps_value)
                    break

        if not fps_candidates:
            placeholder_fps = getattr(settings, "placeholder_video_fps", 30)
            fps_value = self._parse_fps_value(placeholder_fps) or 30.0
        else:
            fps_value = fps_candidates[0]

        fps_value = max(min(fps_value, 120.0), 1.0)

        configured_interval = getattr(
            settings,
            "ffmpeg_keyframe_interval_seconds",
            DEFAULT_KEYFRAME_INTERVAL_SECONDS,
        )
        try:
            configured_interval = float(configured_interval)
        except (TypeError, ValueError):  # pragma: no cover - fallback to default
            configured_interval = DEFAULT_KEYFRAME_INTERVAL_SECONDS

        interval_seconds = max(
            min(configured_interval, MAX_KEYFRAME_INTERVAL_SECONDS),
            MIN_KEYFRAME_INTERVAL_SECONDS,
        )
        gop_frames = max(1, int(round(fps_value * interval_seconds)))

        return gop_frames, interval_seconds

    def _build_video_placeholder_args(self, playlists: PlaylistFileSet) -> List[str]:
        placeholder_path = getattr(settings, "placeholder_video_path", None)
        if placeholder_path:
            candidate = Path(placeholder_path)
            if candidate.exists():
                return ["-loop", "1", "-i", str(candidate)]
            logger.warning(
                "Video placeholder file %s not found; falling back to generated color",
                candidate,
            )

        resolution = getattr(settings, "placeholder_video_resolution", "1280x720")
        fps = getattr(settings, "placeholder_video_fps", 30)
        color = getattr(settings, "placeholder_video_color", "black")

        return [
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:size={resolution}:rate={fps}",
        ]

    def _build_audio_placeholder_args(self) -> List[str]:
        placeholder_path = getattr(settings, "placeholder_audio_path", None)
        if placeholder_path:
            candidate = Path(placeholder_path)
            if candidate.exists():
                return ["-stream_loop", "-1", "-i", str(candidate)]
            logger.warning(
                "Audio placeholder file %s not found; using anullsrc",
                candidate,
            )

        sample_rate = getattr(settings, "placeholder_audio_sample_rate", 44100)
        channel_layout = getattr(settings, "placeholder_audio_channel_layout", "stereo")

        return [
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}",
        ]

    async def _monitor_process(
        self,
        stream_id: str,
        process: asyncio.subprocess.Process,
        log_file: Optional[Path],
    ):
        """Monitor FFmpeg process, write logs, and cleanup on exit"""
        try:
            # Write logs to file if specified
            log_task = None
            if log_file:
                log_task = asyncio.create_task(
                    self._write_logs_to_file(stream_id, process, log_file)
                )

            quota_task: Optional[asyncio.Task] = None
            try:
                quota_task = asyncio.create_task(
                    self._enforce_runtime_limit(stream_id, process)
                )
            except Exception:  # pragma: no cover - defensive logging
                logger.exception(
                    "Failed to start quota monitor for stream %s", stream_id
                )

            returncode = await self._await_process_exit(stream_id, process)

            if log_task is not None:
                try:
                    await log_task
                except Exception:  # pragma: no cover - defensive cleanup
                    logger.exception("Log writer failed for stream %s", stream_id)

            if quota_task is not None:
                quota_task.cancel()
                try:
                    await quota_task
                except asyncio.CancelledError:
                    pass
                except Exception:  # pragma: no cover - diagnostic logging
                    logger.exception(
                        "Quota monitor for stream %s raised error", stream_id
                    )

            info = self.stream_info.get(stream_id)
            if info is not None:
                info["last_exit_code"] = returncode
                info["last_finished_at"] = _utcnow()
                manual_stop = bool(info.get("manual_stop"))
                quota_context = info.get("quota_stop")
            else:
                manual_stop = False
                quota_context = None

            if returncode == 0 or manual_stop:
                if manual_stop and returncode != 0:
                    logger.info(
                        "Stream %s exited after manual stop (code %s)",
                        stream_id,
                        returncode,
                    )
                else:
                    logger.info(f"Stream {stream_id} exited normally")

                await self._finalize_stream_success(
                    stream_id, manual_stop, quota_context
                )

                async with self._cleanup_lock:
                    self.active_streams.pop(stream_id, None)
                    self.stream_info.pop(stream_id, None)
                await hot_swap_manager.unregister_stream(stream_id)
            else:
                logger.error(f"Stream {stream_id} exited with code {returncode}")
                await self._handle_stream_failure(stream_id, returncode)

        except Exception as e:
            logger.exception(f"Error monitoring stream {stream_id}: {e}")

    async def _await_process_exit(
        self,
        stream_id: str,
        process: asyncio.subprocess.Process,
    ) -> int:
        """Wait for FFmpeg process termination, handling mocked processes in tests."""

        wait_callable = getattr(process, "wait", None)
        returncode: Optional[int] = None

        if callable(wait_callable):
            try:
                wait_result = wait_callable()
            except TypeError:
                wait_result = None

            if wait_result is not None:
                if inspect.isawaitable(wait_result):
                    returncode = await wait_result
                else:
                    try:
                        returncode = int(wait_result)
                    except (TypeError, ValueError):
                        logger.debug(
                            "Non-awaitable wait() result for stream %s: %r",
                            stream_id,
                            wait_result,
                        )

        if returncode is None:
            fallback_code = getattr(process, "returncode", None)
            if fallback_code is None:
                logger.debug(
                    "Process %s has no awaitable wait(); assuming successful exit",
                    stream_id,
                )
                fallback_code = 0
            returncode = int(fallback_code)

        return returncode

    async def _handle_stream_failure(self, stream_id: str, returncode: int):
        """Handle non-zero FFmpeg exit codes with alerts and optional restart."""
        info = self.stream_info.get(stream_id, {})
        metadata = info.get("metadata") or {}

        duration_seconds: Optional[float] = None
        started_at_info = info.get("started_at")
        if isinstance(started_at_info, datetime):
            started_at = started_at_info
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            duration_seconds = max(
                (datetime.now(timezone.utc) - started_at).total_seconds(), 0.0
            )

        recent_errors_store = info.get("recent_errors")
        if isinstance(recent_errors_store, deque):
            recent_errors = list(recent_errors_store)[-10:]
        elif isinstance(recent_errors_store, list):
            recent_errors = recent_errors_store[-10:]
        else:
            recent_errors = []

        track_stream_error()
        track_stream_stop(duration_seconds)

        stream_uuid: Optional[UUID] = None
        try:
            stream_uuid = UUID(str(stream_id))
        except ValueError:
            logger.debug(
                "Stream ID %s is not a UUID; skipping DB failure update", stream_id
            )

        if recent_errors:
            logger.error(
                "Recent FFmpeg stderr for %s:\n%s",
                stream_id,
                "\n".join(recent_errors[-5:]),
            )

        attempts = info.get("restart_attempts", 0)
        max_attempts = max(settings.ffmpeg_auto_restart_attempts, 0)
        will_restart = max_attempts > 0 and attempts < max_attempts

        if will_restart:
            await self._create_restart_warning_alert(
                stream_id=stream_id,
                metadata=metadata,
                returncode=returncode,
                recent_errors=recent_errors,
                restart_attempts=attempts,
            )

        if will_restart:
            info["restart_attempts"] = attempts + 1
            info["last_failure_at"] = _utcnow()
            playlists_snapshot: Optional[PlaylistFileSet] = info.get("playlists")
            destinations = info.get("destinations")
            log_file = info.get("log_file")

            try:
                base_backoff = max(settings.ffmpeg_restart_backoff_seconds, 0)
                max_backoff = max(
                    settings.ffmpeg_restart_backoff_max_seconds, base_backoff
                )
                backoff = min(base_backoff * (2**attempts), max_backoff)
                if backoff:
                    await asyncio.sleep(backoff)
            except Exception:
                pass

            async with self._cleanup_lock:
                self.active_streams.pop(stream_id, None)

            if playlists_snapshot and destinations:
                try:
                    missing_files: List[str] = []
                    if (
                        playlists_snapshot.video_playlist
                        and not Path(playlists_snapshot.video_playlist).exists()
                    ):
                        missing_files.append(str(playlists_snapshot.video_playlist))
                    if (
                        playlists_snapshot.audio_playlist
                        and not Path(playlists_snapshot.audio_playlist).exists()
                    ):
                        missing_files.append(str(playlists_snapshot.audio_playlist))

                    if missing_files:
                        logger.error(
                            "Cannot auto restart stream %s: playlist artifacts missing %s",
                            stream_id,
                            missing_files,
                        )
                    else:
                        restart_success = await self.start_stream(
                            stream_id,
                            replace(playlists_snapshot),
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
                        logger.error("Auto restart failed for stream %s", stream_id)
                except Exception as exc:
                    logger.exception(
                        "Failed to auto restart stream %s: %s", stream_id, exc
                    )
            else:
                logger.error("Missing restart metadata for stream %s", stream_id)

            # Escalate if restart attempt failed or could not start
            self._capture_terminal_failure_observability(
                returncode=returncode,
                restart_attempts=info.get("restart_attempts", attempts + 1),
                recent_errors=recent_errors,
            )
            if stream_uuid:
                await self._mark_stream_failed(stream_uuid, returncode, recent_errors)

        else:
            self._capture_terminal_failure_observability(
                returncode=returncode,
                restart_attempts=attempts,
                recent_errors=recent_errors,
            )
        if not will_restart and stream_uuid:
            await self._mark_stream_failed(stream_uuid, returncode, recent_errors)

        async with self._cleanup_lock:
            self.active_streams.pop(stream_id, None)
            self.stream_info.pop(stream_id, None)
        await hot_swap_manager.unregister_stream(stream_id)

    async def _enforce_runtime_limit(
        self,
        stream_id: str,
        process: asyncio.subprocess.Process,
    ) -> None:
        info = self.stream_info.get(stream_id)
        if not info:
            return

        metadata = info.get("metadata") or {}
        raw_user_id = metadata.get("user_id")
        try:
            user_uuid = UUID(str(raw_user_id))
        except (TypeError, ValueError):
            return

        interval_setting = getattr(settings, "stream_quota_poll_seconds", 60)
        try:
            poll_interval = float(interval_setting)
        except (TypeError, ValueError):  # pragma: no cover - misconfig safeguard
            poll_interval = 60.0
        poll_interval = max(poll_interval, 15.0)

        had_error = False

        while process.returncode is None:
            usage = await self._fetch_daily_usage(user_uuid)
            if usage is None:
                if not had_error:
                    logger.exception(
                        "Failed to evaluate quota usage for user %s; will retry",
                        user_uuid,
                    )
                    had_error = True
                await asyncio.sleep(poll_interval)
                continue

            had_error = False

            limit_seconds = usage.get("limit_seconds")
            if not limit_seconds:
                return

            used_seconds = usage.get("used_seconds", 0.0)
            if used_seconds >= limit_seconds:
                limit_hours = usage.get("limit_hours")
                remaining_seconds = usage.get("remaining_seconds", 0.0)
                message = (
                    f"Daily streaming limit reached ({limit_hours:.0f}h). Stream stopped automatically."
                    if limit_hours
                    else "Daily streaming limit reached. Stream stopped automatically."
                )

                payload = {
                    "message": message,
                    "limit_hours": limit_hours,
                    "limit_seconds": limit_seconds,
                    "used_seconds": used_seconds,
                    "remaining_seconds": remaining_seconds,
                    "tier": usage.get("tier"),
                }

                refreshed_info = self.stream_info.get(stream_id)
                if refreshed_info is not None:
                    refreshed_info["quota_stop"] = payload
                    refreshed_info["manual_stop"] = True

                logger.warning(
                    "Stopping stream %s after exceeding daily limit (used=%s, limit=%s)",
                    stream_id,
                    used_seconds,
                    limit_seconds,
                )

                try:
                    process.send_signal(signal.SIGINT)
                except ProcessLookupError:
                    logger.debug("Process for stream %s no longer exists", stream_id)
                return

            try:
                await asyncio.sleep(poll_interval)
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - defensive logging
                logger.exception("Quota monitor sleep failed for stream %s", stream_id)
                await asyncio.sleep(poll_interval)

    async def _fetch_daily_usage(self, user_id: UUID) -> Optional[Dict[str, Any]]:
        try:
            async with get_db_context() as session:
                enforcer = QuotaEnforcer(session, user_id)
                return await enforcer.get_daily_streaming_usage()
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception(
                "Failed to compute daily streaming usage for user %s: %s",
                user_id,
                exc,
            )
            return None

    def _capture_terminal_failure_observability(
        self,
        *,
        returncode: int,
        restart_attempts: int,
        recent_errors: List[str],
    ) -> None:
        capture_alert(
            "ffmpeg_stream_crash_loop",
            level="error",
            tags={"component": "ffmpeg", "event": "stream_failure"},
            extra={
                "restart_attempts": restart_attempts,
                "returncode": returncode,
                "remote_output_reset_evidence": _has_remote_output_reset_evidence(
                    recent_errors
                ),
            },
        )

    async def _create_restart_warning_alert(
        self,
        stream_id: str,
        metadata: Dict[str, Any],
        returncode: int,
        recent_errors: List[str],
        restart_attempts: int,
    ):
        """Persist a restart-path system alert when FFmpeg exits unexpectedly."""
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
            logger.debug(
                "Stream ID %s is not a UUID; storing alert without FK", stream_id
            )

        alert = SystemAlert(
            alert_type="stream_failure",
            severity="warning",
            user_id=user_uuid,
            stream_id=stream_uuid,
            message=_build_stream_failure_message(returncode, recent_errors),
            details={
                "returncode": returncode,
                "recent_errors": recent_errors,
                "restart_attempts": restart_attempts,
                "will_restart": True,
            },
        )

        try:
            async with get_db_context() as session:
                session.add(alert)
        except SQLAlchemyError as exc:
            logger.exception(
                "Failed to persist FFmpeg alert for stream %s: %s", stream_id, exc
            )
        except Exception as exc:
            logger.exception(
                "Unexpected error while persisting alert for stream %s: %s",
                stream_id,
                exc,
            )
        else:
            logger.info(
                "Created warning restart alert for stream %s (attempt %s)",
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

                now = datetime.now(timezone.utc)
                started_at = stream.started_at
                if started_at:
                    if started_at.tzinfo is None:
                        started_at = started_at.replace(tzinfo=timezone.utc)
                    else:
                        started_at = started_at.astimezone(timezone.utc)

                    elapsed = (now - started_at).total_seconds()
                    if elapsed > 0:
                        current_total = stream.total_duration_seconds or 0.0
                        stream.total_duration_seconds = current_total + elapsed

                stream.status = "error"
                stream.pid = None
                stream.stopped_at = now

                stream.error_message = _build_stream_failure_message(
                    returncode, recent_errors
                )

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
        self, stream_id: str, process: asyncio.subprocess.Process, log_file: Path
    ):
        """Write process output to log file safely using async file operations"""
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)

            max_bytes = max(int(getattr(settings, "stream_log_max_bytes", 0) or 0), 0)
            max_backups = max(
                int(getattr(settings, "stream_log_max_backups", 0) or 0), 0
            )
            bytes_written = log_file.stat().st_size if log_file.exists() else 0

            async def _open_log():
                return await aiofiles.open(log_file, "ab")

            f = await _open_log()
            try:
                while True:
                    line = await process.stderr.readline()
                    if not line:
                        break

                    if max_bytes and bytes_written + len(line) > max_bytes:
                        await f.flush()
                        await f.close()
                        self._rotate_log_file(log_file, max_backups)
                        bytes_written = 0
                        f = await _open_log()

                    await f.write(line)
                    bytes_written += len(line)

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
                                info["last_error_at"] = _utcnow()
            finally:
                await f.flush()
                await f.close()
        except Exception as e:
            logger.exception(f"Error writing logs for stream {stream_id}: {e}")

    @staticmethod
    def _rotate_log_file(log_file: Path, max_backups: int) -> None:
        if max_backups <= 0:
            try:
                log_file.unlink(missing_ok=True)
            except Exception:
                return
            return

        for idx in range(max_backups, 0, -1):
            src = log_file.with_suffix(log_file.suffix + f".{idx}")
            dst = log_file.with_suffix(log_file.suffix + f".{idx + 1}")
            if src.exists():
                src.replace(dst)

        if log_file.exists():
            log_file.replace(log_file.with_suffix(log_file.suffix + ".1"))

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

            self._cleanup_stale_stream_info_locked()

    def _cleanup_stale_stream_info_locked(self, *, max_age_seconds: int = 3600) -> None:
        """Remove cached stream info for stopped streams older than the allowed age."""

        cutoff_utc = _utcnow() - timedelta(seconds=max_age_seconds)
        stale_streams: List[str] = []

        for stream_id, info in list(self.stream_info.items()):
            if stream_id in self.active_streams:
                continue

            last_activity: Optional[datetime] = None

            for key in ("last_error_at", "last_failure_at", "started_at"):
                candidate = info.get(key)
                if isinstance(candidate, datetime):
                    if candidate.tzinfo is None:
                        last_activity = candidate.replace(tzinfo=timezone.utc)
                    else:
                        last_activity = candidate.astimezone(timezone.utc)
                    break

            if last_activity is None:
                continue

            if cutoff_utc >= last_activity:
                stale_streams.append(stream_id)

        for stream_id in stale_streams:
            logger.debug("Pruning stale stream info cache for %s", stream_id)
            self.stream_info.pop(stream_id, None)

    async def _finalize_stream_success(
        self,
        stream_id: str,
        manual_stop: bool,
        quota_context: Optional[Dict[str, Any]],
    ) -> None:
        """Persist success status and uptime when FFmpeg завершується без помилок."""
        duration_seconds: Optional[float] = None
        try:
            stream_uuid = UUID(str(stream_id))
        except ValueError:
            logger.debug(
                "Stream ID %s не є UUID — пропускаємо фіналізацію в БД", stream_id
            )
            track_stream_stop(duration_seconds)
            return

        now = datetime.now(timezone.utc)

        try:
            async with get_db_context() as session:
                stream = await session.get(Stream, stream_uuid)
                if stream is None:
                    logger.debug("Не знайшли stream %s у БД для фіналізації", stream_id)
                else:
                    started_at = stream.started_at
                    if started_at is not None:
                        if started_at.tzinfo is None:
                            started_aware = started_at.replace(tzinfo=timezone.utc)
                        else:
                            started_aware = started_at.astimezone(timezone.utc)
                        elapsed = (now - started_aware).total_seconds()
                        if elapsed > 0:
                            duration_seconds = elapsed
                            stream.total_duration_seconds = (
                                stream.total_duration_seconds or 0.0
                            ) + elapsed

                    stream.pid = None
                    stream.stopped_at = now
                    clear_stream_runtime_lease(stream)
                    clear_stream_runtime_restart_state(stream)
                    if quota_context and quota_context.get("message"):
                        stream.error_message = str(quota_context["message"])[:500]
                    else:
                        stream.error_message = None
                    if stream.status != "stopped":
                        stream.status = "stopped"

        except SQLAlchemyError as exc:
            logger.exception(
                "Помилка БД під час фіналізації stream %s: %s", stream_id, exc
            )
        except Exception as exc:
            logger.exception(
                "Неочікувана помилка під час фіналізації stream %s: %s", stream_id, exc
            )
        finally:
            track_stream_stop(duration_seconds)

    @staticmethod
    def _resolve_ffmpeg_bin(candidate: str, *, allow_deferred: bool) -> str:
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

        bare_candidate = (
            bool(candidate)
            and provided_path.name == candidate
            and not provided_path.is_absolute()
        )

        if allow_deferred or bare_candidate:
            deferred_candidate = provided_path.name or "ffmpeg"
            logger.warning(
                "FFmpeg binary %s not found during initialization; deferring resolution until execution time",
                candidate,
            )
            return deferred_candidate

        raise FileNotFoundError(
            "FFmpeg binary not found. Install FFmpeg or set FFMPEG_BIN in your environment."
        )


# Global instance
ffmpeg_manager = FFmpegStreamManager()
