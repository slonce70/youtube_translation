from uuid import uuid4

import pytest

from app.services.streams.websocket import StreamWebSocketManager


class _FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[str] = []

    async def send_text(self, payload: str) -> None:
        self.messages.append(payload)


@pytest.mark.asyncio
async def test_broadcast_filters_user_streams_when_metadata_uses_uuid() -> None:
    user_id = str(uuid4())
    websocket = _FakeWebSocket()
    manager = StreamWebSocketManager()

    await manager.connect(websocket, user_id)
    await manager.broadcast(
        {
            "type": "stream_update",
            "payload": {
                "stream-a": {
                    "is_running": True,
                    "metadata": {"user_id": uuid4()},
                },
                "stream-b": {
                    "is_running": True,
                    "metadata": {"user_id": user_id},
                },
                "stream-c": {
                    "is_running": True,
                    "metadata": {"user_id": uuid4().__str__()},
                },
            },
        }
    )

    assert websocket.messages
    message = websocket.messages[0]
    assert "stream-b" in message
    assert "stream-a" not in message
    assert "stream-c" not in message


@pytest.mark.asyncio
async def test_broadcast_matches_uuid_and_string_user_ids() -> None:
    user_uuid = uuid4()
    websocket = _FakeWebSocket()
    manager = StreamWebSocketManager()

    await manager.connect(websocket, str(user_uuid))
    await manager.broadcast(
        {
            "type": "stream_update",
            "payload": {
                "stream-a": {
                    "is_running": True,
                    "metadata": {"user_id": user_uuid},
                },
            },
        }
    )

    assert websocket.messages
    assert "stream-a" in websocket.messages[0]
