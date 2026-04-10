from fastapi import FastAPI
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.uvicorn_config import (
    DEFAULT_FORWARDED_ALLOW_IPS,
    build_uvicorn_run_kwargs,
    resolved_forwarded_allow_ips,
)


def test_resolved_forwarded_allow_ips_prefers_env(monkeypatch):
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "172.18.0.1")
    monkeypatch.setattr(
        "app.core.uvicorn_config.settings.trusted_proxy_ips", "10.0.0.0/8"
    )

    assert resolved_forwarded_allow_ips() == "172.18.0.1"


def test_resolved_forwarded_allow_ips_uses_trusted_proxy_ips(monkeypatch):
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    monkeypatch.setattr(
        "app.core.uvicorn_config.settings.trusted_proxy_ips",
        "10.0.0.0/8,127.0.0.1",
    )

    assert resolved_forwarded_allow_ips() == "10.0.0.0/8,127.0.0.1"


def test_resolved_forwarded_allow_ips_defaults_to_private_proxy_ranges(monkeypatch):
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    monkeypatch.setattr("app.core.uvicorn_config.settings.trusted_proxy_ips", [])

    assert resolved_forwarded_allow_ips() == DEFAULT_FORWARDED_ALLOW_IPS


def test_build_uvicorn_run_kwargs_enables_proxy_headers(monkeypatch):
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    monkeypatch.setattr("app.core.uvicorn_config.settings.trusted_proxy_ips", [])

    kwargs = build_uvicorn_run_kwargs(host="0.0.0.0", port=8000, reload=True)

    assert kwargs["host"] == "0.0.0.0"
    assert kwargs["port"] == 8000
    assert kwargs["reload"] is True
    assert kwargs["proxy_headers"] is True
    assert kwargs["forwarded_allow_ips"] == DEFAULT_FORWARDED_ALLOW_IPS


def test_proxy_headers_keep_https_redirects_for_trusted_private_proxies():
    app = FastAPI()

    @app.get("/api/streams/")
    async def list_streams():
        return {"ok": True}

    wrapped = ProxyHeadersMiddleware(app, trusted_hosts=DEFAULT_FORWARDED_ALLOW_IPS)
    client = TestClient(
        wrapped,
        base_url="http://example.test",
        follow_redirects=False,
        client=("172.18.0.1", 12345),
    )

    response = client.get("/api/streams", headers={"x-forwarded-proto": "https"})

    assert response.status_code == 307
    assert response.headers["location"] == "https://example.test/api/streams/"
