import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _base_settings_kwargs() -> dict:
    return {
        "supabase_url": "https://example.supabase.co",
        "supabase_key": "anon-key",
        "supabase_jwt_secret": "jwt-secret",
        "database_url": "postgresql://user:password@localhost:5432/youtube_streaming",
        "encryption_key": "a" * 64,
        "encryption_salt": "b" * 32,
        "upload_token_secret": "c" * 32,
        "download_token_secret": "d" * 32,
    }


def test_manager_runtime_is_blocked_in_production_without_explicit_override() -> None:
    with pytest.raises(ValidationError, match="ALLOW_UNSAFE_MANAGER_RUNTIME=true"):
        Settings(
            _env_file=None,
            environment="production",
            stream_runtime_mode="manager",
            **_base_settings_kwargs(),
        )


def test_manager_runtime_can_be_explicitly_allowed_in_production() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        stream_runtime_mode="manager",
        allow_unsafe_manager_runtime=True,
        **_base_settings_kwargs(),
    )

    assert settings.stream_runtime_mode == "manager"
    assert settings.allow_unsafe_manager_runtime is True


def test_runtime_heartbeat_intervals_must_be_positive() -> None:
    with pytest.raises(ValidationError, match="STREAM_RUNTIME_HEARTBEAT_INTERVAL_SECONDS"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="supervisor",
            stream_runtime_heartbeat_interval_seconds=0,
            **_base_settings_kwargs(),
        )


def test_runtime_lease_ttl_must_cover_heartbeat_interval() -> None:
    with pytest.raises(ValidationError, match="STREAM_RUNTIME_LEASE_TTL_SECONDS"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="supervisor",
            stream_runtime_lease_ttl_seconds=5,
            stream_runtime_heartbeat_interval_seconds=10,
            **_base_settings_kwargs(),
        )


def test_runtime_restart_backoff_max_must_cover_base() -> None:
    with pytest.raises(ValidationError, match="STREAM_RUNTIME_RESTART_BACKOFF_MAX_SECONDS"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="supervisor",
            stream_runtime_restart_backoff_seconds=10,
            stream_runtime_restart_backoff_max_seconds=5,
            **_base_settings_kwargs(),
        )
