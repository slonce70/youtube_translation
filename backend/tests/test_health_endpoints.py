"""Tests for the ``/healthz`` and ``/readyz`` endpoints.

The split was added in Sprint 1.7 — these tests pin the contract that the
deploy guard, container HEALTHCHECK, and any external load balancer rely on:

* ``/healthz`` is unconditional 200 (liveness only).
* ``/health`` is preserved as a back-compat alias.
* ``/readyz`` runs DB + Redis + upload-dir probes, returns 200 on all-ok and
  503 on any failure with a JSON breakdown, and (after the security
  hardening) does NOT leak ``detail`` strings or absolute paths to the
  caller — those land only in the structured log.
"""
from __future__ import annotations

import os
import tempfile
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app():
    # Import inside the fixture so test settings (set in conftest.py) are
    # already applied when the FastAPI app is constructed.
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def writable_upload_dir(tmp_path, monkeypatch):
    """Point the health module at a writable temp dir for the duration of a test."""
    from app.api import health as health_module

    monkeypatch.setattr(health_module.settings, "upload_dir", str(tmp_path))
    return tmp_path


async def test_healthz_returns_200_unconditionally(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


async def test_health_alias_returns_200(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in {"healthy", "alive"}


async def test_readyz_all_ok_returns_200(app, writable_upload_dir):
    """Happy path: DB OK + Redis skipped + upload_dir writable → 200."""
    from app.api import health as health_module

    # No Redis configured in the test env → _check_redis returns ok=True skipped.
    with patch.object(health_module.settings, "redis_url", None):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/readyz")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["db"]["ok"] is True
    assert payload["checks"]["redis"]["ok"] is True
    assert payload["checks"]["upload_dir"]["ok"] is True


async def test_readyz_db_failure_returns_503_without_leaking_detail(app, writable_upload_dir):
    """When DB probe fails, response is 503 and contains NO `detail` or DSN."""
    from app.api import health as health_module

    failing_session = MagicMock()
    failing_session.__aenter__ = AsyncMock(
        side_effect=RuntimeError(
            "could not connect to postgres://secret-user:secret-password@db.internal:5432"
        )
    )
    failing_session.__aexit__ = AsyncMock(return_value=False)

    def _failing_session_maker():
        return failing_session

    with patch.object(health_module, "async_session_maker", _failing_session_maker), patch.object(
        health_module.settings, "redis_url", None
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/readyz")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    db_check = payload["checks"]["db"]
    assert db_check["ok"] is False
    # SECURITY: do NOT surface the raw exception detail (DSN, host, password) to
    # unauthenticated callers. Error class name is fine.
    assert "detail" not in db_check, "readyz must not leak exception detail to unauth callers"
    assert "secret-password" not in response.text
    assert "secret-user" not in response.text
    assert "db.internal" not in response.text


async def test_readyz_upload_dir_missing_returns_503_without_leaking_path(app, monkeypatch):
    from app.api import health as health_module

    monkeypatch.setattr(
        health_module.settings,
        "upload_dir",
        "/path/that/does/not/exist/secret-tenant-id",
    )
    with patch.object(health_module.settings, "redis_url", None):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/readyz")

    assert response.status_code == 503
    payload = response.json()
    upload_check = payload["checks"]["upload_dir"]
    assert upload_check["ok"] is False
    assert upload_check["error"] == "missing"
    # Path string must not appear anywhere in the response (no `path` field,
    # no embedded path elsewhere).
    assert "secret-tenant-id" not in response.text


async def test_readyz_upload_dir_not_writable_returns_503(app, tmp_path, monkeypatch):
    from app.api import health as health_module

    read_only = tmp_path / "ro_uploads"
    read_only.mkdir()
    os.chmod(read_only, 0o500)  # read+exec only

    monkeypatch.setattr(health_module.settings, "upload_dir", str(read_only))

    try:
        with patch.object(health_module.settings, "redis_url", None):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/readyz")

        # On a CI runner running as uid 0, mode 0500 still permits writes —
        # skip the strict assertion in that case (the access() check is what
        # we're really exercising).
        if os.geteuid() != 0:
            assert response.status_code == 503
            payload = response.json()
            upload_check = payload["checks"]["upload_dir"]
            assert upload_check["ok"] is False
            assert upload_check["error"] == "not_writable"
    finally:
        os.chmod(read_only, 0o700)
