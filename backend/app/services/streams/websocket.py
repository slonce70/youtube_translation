from typing import List, Dict, Any, Tuple
import asyncio
import logging
import json
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class StreamWebSocketManager:
    """
    Manages WebSocket connections for real-time stream status updates.
    """

    def __init__(self):
        self.active_connections: List[Tuple[WebSocket, str]] = []
        self._broadcast_task: asyncio.Task | None = None

    async def connect(self, websocket: WebSocket, user_id: str):
        self.active_connections.append((websocket, user_id))
        logger.info(
            f"WebSocket client connected. Total: {len(self.active_connections)}"
        )

    def disconnect(self, websocket: WebSocket):
        for entry in list(self.active_connections):
            if entry[0] is websocket:
                self.active_connections.remove(entry)
                logger.info(
                    f"WebSocket client disconnected. Total: {len(self.active_connections)}"
                )
                return

    async def broadcast(self, message: Dict[str, Any]):
        if not self.active_connections:
            return

        disconnected: List[Tuple[WebSocket, str]] = []

        for connection, user_id in self.active_connections:
            try:
                payload = message
                if message.get("type") == "stream_update" and isinstance(
                    message.get("payload"), dict
                ):
                    filtered = {
                        stream_id: self._sanitize_stream_info(info)
                        for stream_id, info in message["payload"].items()
                        if info
                        and isinstance(info, dict)
                        and str((info.get("metadata") or {}).get("user_id"))
                        == str(user_id)
                    }
                    payload = {"type": "stream_update", "payload": filtered}

                await connection.send_text(json.dumps(payload))
            except WebSocketDisconnect:
                disconnected.append((connection, user_id))
            except Exception as e:
                logger.warning(f"Error broadcasting to WS client: {e}")
                disconnected.append((connection, user_id))

        for conn, _ in disconnected:
            self.disconnect(conn)

    @staticmethod
    def _sanitize_stream_info(info: Dict[str, Any]) -> Dict[str, Any]:
        allowed_keys = {
            "is_running",
            "uptime_seconds",
            "started_at",
            "last_exit_code",
            "last_error_at",
            "mix_mode",
            "restart_attempts",
            "destinations_count",
        }
        sanitized: Dict[str, Any] = {}
        for key in allowed_keys:
            if key in info:
                sanitized[key] = info[key]
        return sanitized

    def snapshot_for_user(
        self, user_id: str, active_streams: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """Build a sanitized active-stream snapshot for a single user.

        Track 5b/G (2026-04-26): each per-stream entry now also carries
        the latest ``live_metrics`` and ``playback`` snapshots so the
        operator panel can switch from 5-second HTTP polling to a 1-Hz
        WebSocket feed for sparkline updates. Both keys are best-effort —
        missing data resolves to None and the UI falls back to the
        polled /metrics endpoint.
        """
        # Local imports keep this module free of streaming-layer deps at
        # cold-start time (the manager is created during app boot).
        try:
            from app.streaming.ffmpeg_metrics import ffmpeg_metrics
        except Exception:  # pragma: no cover - defensive
            ffmpeg_metrics = None  # type: ignore[assignment]
        try:
            from app.streaming.hot_swap import hot_swap_manager
        except Exception:  # pragma: no cover - defensive
            hot_swap_manager = None  # type: ignore[assignment]

        filtered: Dict[str, Dict[str, Any]] = {}
        for stream_id, info in active_streams.items():
            if not info or not isinstance(info, dict):
                continue
            metadata = info.get("metadata") or {}
            if str(metadata.get("user_id")) != str(user_id):
                continue
            entry = self._sanitize_stream_info(info)
            if ffmpeg_metrics is not None:
                try:
                    entry["live_metrics"] = ffmpeg_metrics.snapshot(
                        stream_id, samples=60
                    )
                except Exception:  # pragma: no cover
                    entry["live_metrics"] = None
            if hot_swap_manager is not None:
                try:
                    entry["playback"] = hot_swap_manager.get_now_playing(stream_id)
                except Exception:  # pragma: no cover
                    entry["playback"] = None
            filtered[stream_id] = entry
        return filtered


# Global instance
stream_ws_manager = StreamWebSocketManager()
