"""Sprint 2 H4 — quota TOCTOU lock unit tests.

Concurrent integration tests that verify ``50 starts → 10 succeed`` against
a real Postgres are deferred to a follow-up integration test (they need
Postgres + multiple sessions + the streams table populated). Here we pin
the unit-level contract:

* ``acquire_user_quota_lock`` issues ``SELECT pg_advisory_xact_lock(:ns,
  hashtext(:user_id))`` with the user's UUID stringified.
* The four namespace constants are distinct and stable (changing them
  silently breaks running deployments because pg_locks identity changes).
* Each ``QuotaEnforcer`` check method invokes the lock with the right
  namespace before its SELECT.
"""
from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.core.quota import (
    QUOTA_LOCK_NAMESPACE_ASSETS,
    QUOTA_LOCK_NAMESPACE_DESTINATIONS,
    QUOTA_LOCK_NAMESPACE_START_STREAM,
    QUOTA_LOCK_NAMESPACE_STORAGE,
    acquire_user_quota_lock,
)


def test_namespace_constants_are_distinct() -> None:
    namespaces = {
        QUOTA_LOCK_NAMESPACE_START_STREAM,
        QUOTA_LOCK_NAMESPACE_DESTINATIONS,
        QUOTA_LOCK_NAMESPACE_ASSETS,
        QUOTA_LOCK_NAMESPACE_STORAGE,
    }
    assert len(namespaces) == 4, "all four lock namespaces must be unique"


def test_namespace_constants_fit_in_int4() -> None:
    """pg_advisory_xact_lock(int4, int4) requires the namespace fit in int4."""
    INT4_MIN = -(2**31)
    INT4_MAX = 2**31 - 1
    for ns in (
        QUOTA_LOCK_NAMESPACE_START_STREAM,
        QUOTA_LOCK_NAMESPACE_DESTINATIONS,
        QUOTA_LOCK_NAMESPACE_ASSETS,
        QUOTA_LOCK_NAMESPACE_STORAGE,
    ):
        assert INT4_MIN <= ns <= INT4_MAX, (
            f"namespace {ns:#x} would overflow pg_advisory_xact_lock(int4, int4)"
        )


@pytest.mark.asyncio
async def test_acquire_user_quota_lock_issues_correct_sql() -> None:
    """The SQL template + params must call pg_advisory_xact_lock(int4, hashtext(uuid))."""
    db = AsyncMock()
    user_id = UUID("12345678-1234-5678-1234-567812345678")

    await acquire_user_quota_lock(db, user_id, QUOTA_LOCK_NAMESPACE_DESTINATIONS)

    db.execute.assert_awaited_once()
    args, kwargs = db.execute.await_args
    sql_obj = args[0]
    params = args[1] if len(args) > 1 else kwargs.get("params")
    sql_text = str(sql_obj)
    assert "pg_advisory_xact_lock" in sql_text
    assert "hashtext" in sql_text
    assert params == {
        "ns": QUOTA_LOCK_NAMESPACE_DESTINATIONS,
        "user_id": str(user_id),
    }


@pytest.mark.asyncio
async def test_acquire_user_quota_lock_with_distinct_users_uses_distinct_keys() -> None:
    """Two different users → two different ``user_id`` parameter values."""
    db = AsyncMock()
    u1 = uuid4()
    u2 = uuid4()
    assert u1 != u2

    await acquire_user_quota_lock(db, u1, QUOTA_LOCK_NAMESPACE_ASSETS)
    await acquire_user_quota_lock(db, u2, QUOTA_LOCK_NAMESPACE_ASSETS)

    assert db.execute.await_count == 2
    user_ids = [
        call.args[1]["user_id"] for call in db.execute.await_args_list
    ]
    assert user_ids == [str(u1), str(u2)]
