from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import deps
from app.api.routes.metrics import get_stream_metrics
from app.core.config import settings
from app.core.database import async_session_maker
from app.models.database import Stream, UserProfile


@pytest.mark.asyncio
async def test_get_stream_metrics_includes_restart_orchestration_summary() -> None:
    user_id = uuid4()
    other_user_id = uuid4()
    now = datetime.now(timezone.utc)

    async with async_session_maker() as session:
        session.add_all(
            [
                UserProfile(
                    user_id=user_id,
                    email=f"metrics-user-{uuid4()}@example.com",
                    subscription_tier="free",
                    subscription_status="active",
                ),
                UserProfile(
                    user_id=other_user_id,
                    email=f"metrics-other-{uuid4()}@example.com",
                    subscription_tier="free",
                    subscription_status="active",
                ),
            ]
        )

        session.add_all(
            [
                Stream(
                    id=uuid4(),
                    user_id=user_id,
                    name="running",
                    status="running",
                    runtime_restart_attempts=1,
                    runtime_last_restart_at=now - timedelta(minutes=5),
                ),
                Stream(
                    id=uuid4(),
                    user_id=user_id,
                    name="scheduled-retry",
                    status="error",
                    runtime_restart_attempts=2,
                    runtime_next_restart_at=now + timedelta(seconds=30),
                    runtime_last_failure_at=now - timedelta(seconds=20),
                ),
                Stream(
                    id=uuid4(),
                    user_id=user_id,
                    name="exhausted",
                    status="error",
                    runtime_restart_attempts=5,
                    runtime_last_failure_at=now - timedelta(minutes=1),
                ),
                Stream(
                    id=uuid4(),
                    user_id=other_user_id,
                    name="other-user",
                    status="error",
                    runtime_restart_attempts=99,
                    runtime_next_restart_at=now + timedelta(seconds=1),
                ),
            ]
        )
        await session.commit()

        metrics = await get_stream_metrics(session, str(user_id))

    assert metrics["total_streams"] == 3
    assert metrics["active_streams"] == 1
    assert metrics["error_streams"] == 2

    restart_summary = metrics["restart_orchestration"]
    assert restart_summary["scheduled_restart_streams"] == 1
    assert restart_summary["streams_with_retry_history"] == 3
    assert restart_summary["total_restart_attempts"] == 8
    assert restart_summary["next_restart_at"] is not None


@pytest.mark.asyncio
async def test_get_stream_metrics_without_user_id_returns_global_counts() -> None:
    user_a = uuid4()
    user_b = uuid4()

    async with async_session_maker() as session:
        baseline = await get_stream_metrics(session)

        session.add_all(
            [
                UserProfile(
                    user_id=user_a,
                    email=f"metrics-global-a-{uuid4()}@example.com",
                    subscription_tier="free",
                    subscription_status="active",
                ),
                UserProfile(
                    user_id=user_b,
                    email=f"metrics-global-b-{uuid4()}@example.com",
                    subscription_tier="free",
                    subscription_status="active",
                ),
            ]
        )
        session.add_all(
            [
                Stream(user_id=user_a, name="A running", status="running"),
                Stream(user_id=user_a, name="A stopped", status="stopped"),
                Stream(
                    user_id=user_b,
                    name="B error",
                    status="error",
                    runtime_restart_attempts=1,
                ),
            ]
        )
        await session.commit()

        metrics = await get_stream_metrics(session)

    assert metrics["total_streams"] == baseline["total_streams"] + 3
    assert metrics["active_streams"] == baseline["active_streams"] + 1
    assert metrics["idle_streams"] == baseline["idle_streams"] + 1
    assert metrics["error_streams"] == baseline["error_streams"] + 1
    assert (
        metrics["restart_orchestration"]["streams_with_retry_history"]
        == baseline["restart_orchestration"]["streams_with_retry_history"] + 1
    )


@pytest.mark.asyncio
async def test_require_metrics_access_accepts_only_shared_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_access_token", "metrics-secret")

    via_header = await deps.require_metrics_access(metrics_token="metrics-secret")
    via_bearer = await deps.require_metrics_access(
        authorization="Bearer metrics-secret"
    )

    assert via_header == {"token": "metrics"}
    assert via_bearer == {"token": "metrics"}


@pytest.mark.asyncio
async def test_require_metrics_access_rejects_regular_bearer_tokens(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "metrics_access_token", "metrics-secret")

    with pytest.raises(HTTPException) as exc:
        await deps.require_metrics_access(authorization="Bearer regular-user-jwt")

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_require_metrics_access_fails_closed_without_config(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_access_token", None)

    with pytest.raises(HTTPException) as exc:
        await deps.require_metrics_access(metrics_token="metrics-secret")

    assert exc.value.status_code == 503
