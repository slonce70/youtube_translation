from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import deps
from app.api.routes.metrics import estimate_stream_capacity, get_stream_metrics
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
                ),
                Stream(
                    id=uuid4(),
                    user_id=user_id,
                    name="scheduled-retry",
                    status="error",
                ),
                Stream(
                    id=uuid4(),
                    user_id=user_id,
                    name="exhausted",
                    status="error",
                ),
                Stream(
                    id=uuid4(),
                    user_id=other_user_id,
                    name="other-user",
                    status="error",
                ),
            ]
        )
        await session.commit()

        metrics = await get_stream_metrics(session, str(user_id))

    assert metrics["total_streams"] == 3
    assert metrics["active_streams"] == 1
    assert metrics["error_streams"] == 2

    restart_summary = metrics["restart_orchestration"]
    assert restart_summary["auto_restart_enabled"] is False
    assert restart_summary["scheduled_restart_streams"] == 0
    assert restart_summary["streams_with_retry_history"] == 0
    assert restart_summary["total_restart_attempts"] == 0
    assert restart_summary["max_attempts"] == 0
    assert restart_summary["next_restart_at"] is None


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
                Stream(user_id=user_b, name="B error", status="error"),
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
        == baseline["restart_orchestration"]["streams_with_retry_history"]
    )


@pytest.mark.asyncio
async def test_get_stream_metrics_hides_restart_orchestration_in_systemd_mode(
    monkeypatch,
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(settings, "stream_runtime_mode", "systemd")

    async with async_session_maker() as session:
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"metrics-systemd-{uuid4()}@example.com",
                subscription_tier="free",
                subscription_status="active",
            )
        )
        session.add_all(
            [
                Stream(
                    user_id=user_id,
                    name="systemd-error",
                    status="error",
                ),
                Stream(
                    user_id=user_id,
                    name="systemd-running",
                    status="running",
                ),
            ]
        )
        await session.commit()

        metrics = await get_stream_metrics(session, str(user_id))

    restart_summary = metrics["restart_orchestration"]
    assert restart_summary["auto_restart_enabled"] is False
    assert restart_summary["scheduled_restart_streams"] == 0
    assert restart_summary["streams_with_retry_history"] == 0
    assert restart_summary["total_restart_attempts"] == 0
    assert restart_summary["max_attempts"] == 0
    assert restart_summary["next_restart_at"] is None


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


def test_estimate_stream_capacity_is_explicitly_marked_as_heuristic(
    monkeypatch,
) -> None:
    class _Memory:
        total = 32 * 1024**3

    monkeypatch.setattr(
        "app.api.routes.metrics.psutil.virtual_memory", lambda: _Memory()
    )

    capacity = estimate_stream_capacity(
        cpu_percent=12.5, memory_percent=25.0, active_streams=2
    )

    assert capacity["mode"] == "heuristic"
    assert capacity["recommended_for_production_decisions"] is False
    assert "measured workload profiles" in capacity["summary"]
    assert capacity["assumptions"]["avg_cpu_percent_per_stream"] == 3.5
    assert capacity["assumptions"]["avg_memory_gb_per_stream"] == 0.075
    assert capacity["assumptions"]["reserved_cpu_percent"] == 20
    assert capacity["assumptions"]["reserved_memory_percent"] == 20
