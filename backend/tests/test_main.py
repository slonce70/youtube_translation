"""Tests for FastAPI application startup hooks."""

from unittest.mock import AsyncMock

import pytest


class DummyTask:
    """Minimal stand-in for asyncio.Task used in startup tests."""

    def __init__(self, coro):
        self._coro = coro

    def cancel(self):
        if not self._coro.cr_running:
            self._coro.close()


@pytest.mark.asyncio
async def test_startup_schedules_ffmpeg_cleanup(monkeypatch):
    """startup_event should schedule periodic FFmpeg cleanup alongside rate limiter cleanup."""

    from app import main

    scheduled_coroutines = []

    def fake_create_task(coro):
        scheduled_coroutines.append(coro)
        return DummyTask(coro)

    fake_check = AsyncMock(return_value=True)
    fake_patch = AsyncMock()

    monkeypatch.setattr("app.main.asyncio.create_task", fake_create_task)
    monkeypatch.setattr("app.core.database.check_db_connection", fake_check)
    monkeypatch.setattr("app.core.database.apply_schema_patches", fake_patch)

    await main.startup_event()

    fake_check.assert_awaited()
    fake_patch.assert_awaited()

    names = {coro.cr_code.co_name for coro in scheduled_coroutines}
    assert "cleanup_ffmpeg_streams" in names
    assert "cleanup_rate_limiter" in names

    for coro in scheduled_coroutines:
        if not coro.cr_running:
            coro.close()
