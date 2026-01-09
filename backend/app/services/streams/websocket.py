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
        logger.info(f"WebSocket client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        for entry in list(self.active_connections):
            if entry[0] is websocket:
                self.active_connections.remove(entry)
                logger.info(f"WebSocket client disconnected. Total: {len(self.active_connections)}")
                return

    async def broadcast(self, message: Dict[str, Any]):
        if not self.active_connections:
            return
            
        disconnected: List[Tuple[WebSocket, str]] = []

        for connection, user_id in self.active_connections:
            try:
                payload = message
                if message.get("type") == "stream_update" and isinstance(message.get("payload"), dict):
                    filtered = {
                        stream_id: self._sanitize_stream_info(info)
                        for stream_id, info in message["payload"].items()
                        if info
                        and isinstance(info, dict)
                        and (info.get("metadata") or {}).get("user_id") == user_id
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

# Global instance
stream_ws_manager = StreamWebSocketManager()
