from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from app.middleware.websocket_safe_csrf import WebSocketSafeCSRFMiddleware


def test_websocket_safe_csrf_skips_websocket_scope():
    app = FastAPI()
    app.add_middleware(
        WebSocketSafeCSRFMiddleware,
        secret="test-secret",
        sensitive_cookies={"csrftoken"},
        header_name="X-CSRF-Token",
        cookie_name="csrftoken",
    )

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json({"ok": True})
        await websocket.close()

    client = TestClient(app)

    with client.websocket_connect("/ws") as websocket:
        assert websocket.receive_json() == {"ok": True}
