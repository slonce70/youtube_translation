"""Tests for FastAPI application startup hooks."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient


class DummyTask:
    """Minimal stand-in for asyncio.Task used in startup tests."""

    def __init__(self, coro):
        self._coro = coro
        self._callbacks = []

    def cancel(self):
        if not self._coro.cr_running:
            self._coro.close()

    def add_done_callback(self, callback):
        self._callbacks.append(callback)


@pytest.mark.asyncio
async def test_startup_schedules_ffmpeg_cleanup(monkeypatch):
    """run_startup_tasks should schedule periodic FFmpeg cleanup alongside rate limiter cleanup."""

    from app import main

    scheduled_coroutines = []

    def fake_schedule(coro):
        scheduled_coroutines.append(coro)
        return DummyTask(coro)

    fake_check = AsyncMock(return_value=True)
    fake_patch = AsyncMock()
    fake_reconcile = AsyncMock(return_value={"reconciled": True})
    fake_db = object()

    class FakeSessionFactory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return fake_db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(main, "schedule_background_task", fake_schedule)
    monkeypatch.setattr("app.core.database.check_db_connection", fake_check)
    monkeypatch.setattr("app.core.database.apply_schema_patches", fake_patch)
    monkeypatch.setattr("app.core.database.async_session_maker", FakeSessionFactory())
    monkeypatch.setattr("app.core.stream_reconciler.reconcile_streams", fake_reconcile)

    await main.run_startup_tasks()

    fake_check.assert_awaited()
    fake_patch.assert_awaited()
    fake_reconcile.assert_awaited_once_with(fake_db)

    names = {coro.cr_code.co_name for coro in scheduled_coroutines}
    assert "cleanup_ffmpeg_streams" in names
    assert "cleanup_rate_limiter" in names

    for coro in scheduled_coroutines:
        if not coro.cr_running:
            coro.close()


@pytest.mark.asyncio
async def test_shutdown_cancels_background_tasks():
    """run_shutdown_tasks should cancel and clear tracked background tasks."""

    from app import main

    main._background_tasks.clear()
    started = asyncio.Event()

    async def sleeper():
        started.set()
        await asyncio.sleep(3600)

    task = asyncio.create_task(sleeper())
    await started.wait()
    main._background_tasks.add(task)

    await main.run_shutdown_tasks()

    assert task.done()
    assert task.cancelled()
    assert not main._background_tasks


def test_app_lifespan_runs_startup_and_shutdown(monkeypatch):
    """The FastAPI lifespan hook should delegate to startup and shutdown helpers."""

    from app import main

    fake_startup = AsyncMock()
    fake_shutdown = AsyncMock()

    monkeypatch.setattr(main, "run_startup_tasks", fake_startup)
    monkeypatch.setattr(main, "run_shutdown_tasks", fake_shutdown)

    with TestClient(main.app):
        pass

    fake_startup.assert_awaited_once()
    fake_shutdown.assert_awaited_once()
