import pytest
from unittest.mock import AsyncMock


class _FakeSessionContext:
    def __init__(self, session, events):
        self._session = session
        self._events = events

    async def __aenter__(self):
        self._events.append("session_factory_enter")
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        self._events.append("session_factory_exit")
        return False


def _build_session_factory(session, events):
    def factory():
        return _FakeSessionContext(session, events)

    return factory


@pytest.mark.asyncio
async def test_managed_session_without_commit_closes_cleanly(monkeypatch):
    from app.core import database

    events = []
    session = AsyncMock()
    session.commit = AsyncMock(side_effect=lambda: events.append("commit"))
    session.rollback = AsyncMock(side_effect=lambda: events.append("rollback"))
    session.close = AsyncMock(side_effect=lambda: events.append("close"))
    monkeypatch.setattr(
        database, "async_session_maker", _build_session_factory(session, events)
    )

    async with database._managed_session(commit_on_success=False) as managed_session:
        assert managed_session is session
        events.append("body")

    assert events == ["session_factory_enter", "body", "close", "session_factory_exit"]
    session.commit.assert_not_awaited()
    session.rollback.assert_not_awaited()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_db_context_commits_by_default_and_closes(monkeypatch):
    from app.core import database

    events = []
    session = AsyncMock()
    session.commit = AsyncMock(side_effect=lambda: events.append("commit"))
    session.rollback = AsyncMock(side_effect=lambda: events.append("rollback"))
    session.close = AsyncMock(side_effect=lambda: events.append("close"))
    monkeypatch.setattr(
        database, "async_session_maker", _build_session_factory(session, events)
    )

    async with database.get_db_context() as managed_session:
        assert managed_session is session
        events.append("body")

    assert events == [
        "session_factory_enter",
        "body",
        "commit",
        "close",
        "session_factory_exit",
    ]
    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_db_context_can_disable_commit_on_success(monkeypatch):
    from app.core import database

    events = []
    session = AsyncMock()
    session.commit = AsyncMock(side_effect=lambda: events.append("commit"))
    session.rollback = AsyncMock(side_effect=lambda: events.append("rollback"))
    session.close = AsyncMock(side_effect=lambda: events.append("close"))
    monkeypatch.setattr(
        database, "async_session_maker", _build_session_factory(session, events)
    )

    async with database.get_db_context(commit_on_success=False) as managed_session:
        assert managed_session is session
        events.append("body")

    assert events == ["session_factory_enter", "body", "close", "session_factory_exit"]
    session.commit.assert_not_awaited()
    session.rollback.assert_not_awaited()
    session.close.assert_awaited_once()
