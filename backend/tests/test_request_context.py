from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.api.request_context import extract_request_audit_metadata, resolve_client_ip
from app.middleware.api_metrics import APIMetricsMiddleware


def _make_request(
    *,
    client_host: str = "198.51.100.10",
    forwarded_for: str | None = None,
) -> Request:
    headers = [
        (b"user-agent", b"pytest-agent"),
        (b"origin", b"https://app.example.com"),
        (b"referer", b"https://app.example.com/dashboard/streaming"),
    ]
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/streams/test-stream/stop",
        "headers": headers,
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "scheme": "http",
        "query_string": b"",
        "state": {"request_id": "req-test-123"},
    }
    return Request(scope)


def test_extract_request_audit_metadata_uses_forwarded_ip_for_trusted_proxy(
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.request_context.settings.trusted_proxy_ips", "10.0.0.0/8"
    )
    request = _make_request(
        client_host="10.1.2.3",
        forwarded_for="198.51.100.77, 10.1.2.3",
    )

    metadata = extract_request_audit_metadata(
        request,
        user_payload={"session_id": "sess-123", "jti": "jti-456"},
    )

    assert metadata["request_id"] == "req-test-123"
    assert metadata["client_ip"] == "198.51.100.77"
    assert metadata["origin"] == "https://app.example.com"
    assert metadata["referer"] == "https://app.example.com/dashboard/streaming"
    assert metadata["user_agent"] == "pytest-agent"
    assert metadata["session_id"] == "sess-123"
    assert metadata["jwt_jti"] == "jti-456"


def test_resolve_client_ip_ignores_forwarded_for_for_untrusted_proxy(monkeypatch):
    monkeypatch.setattr(
        "app.api.request_context.settings.trusted_proxy_ips", "10.0.0.0/8"
    )
    request = _make_request(
        client_host="203.0.113.9",
        forwarded_for="198.51.100.77, 10.1.2.3",
    )

    assert resolve_client_ip(request) == "203.0.113.9"


def test_resolve_client_ip_returns_none_for_invalid_values(monkeypatch):
    monkeypatch.setattr(
        "app.api.request_context.settings.trusted_proxy_ips", "10.0.0.0/8"
    )
    request = _make_request(
        client_host="10.1.2.3",
        forwarded_for="not-an-ip",
    )
    request.scope["client"] = None

    assert resolve_client_ip(request) is None


def test_api_metrics_sets_request_id_header():
    app = FastAPI()
    app.add_middleware(APIMetricsMiddleware)

    @app.post("/api/streams/test-stream/stop")
    async def stop_stream():
        return {"ok": True}

    client = TestClient(app)
    response = client.post("/api/streams/test-stream/stop")

    assert response.status_code == 200
    assert response.headers["X-Request-ID"]
