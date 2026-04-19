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
        "enable_dev_auth": False,
    }


def test_environment_must_be_explicitly_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("environment", raising=False)

    with pytest.raises(ValidationError, match="environment"):
        Settings(
            _env_file=None,
            **_base_settings_kwargs(),
        )


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


def test_containerized_systemd_runtime_is_blocked_in_production_without_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.config._running_in_container", lambda: True)

    with pytest.raises(
        ValidationError,
        match="ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=true",
    ):
        Settings(
            _env_file=None,
            environment="production",
            stream_runtime_mode="systemd",
            **_base_settings_kwargs(),
        )


def test_containerized_systemd_runtime_can_be_explicitly_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.config._running_in_container", lambda: True)

    settings = Settings(
        _env_file=None,
        environment="production",
        stream_runtime_mode="systemd",
        allow_unsafe_containerized_systemd_runtime=True,
        **_base_settings_kwargs(),
    )

    assert settings.stream_runtime_mode == "systemd"
    assert settings.allow_unsafe_containerized_systemd_runtime is True


def test_runtime_heartbeat_intervals_must_be_positive() -> None:
    with pytest.raises(
        ValidationError, match="STREAM_RUNTIME_HEARTBEAT_INTERVAL_SECONDS"
    ):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="systemd",
            stream_runtime_heartbeat_interval_seconds=0,
            **_base_settings_kwargs(),
        )


def test_ffmpeg_tee_onfail_policy_accepts_ignore_and_abort() -> None:
    ignore_settings = Settings(
        _env_file=None,
        environment="development",
        stream_runtime_mode="systemd",
        ffmpeg_tee_onfail_policy="ignore",
        **_base_settings_kwargs(),
    )
    abort_settings = Settings(
        _env_file=None,
        environment="development",
        stream_runtime_mode="systemd",
        ffmpeg_tee_onfail_policy="abort",
        **_base_settings_kwargs(),
    )

    assert ignore_settings.ffmpeg_tee_onfail_policy == "ignore"
    assert abort_settings.ffmpeg_tee_onfail_policy == "abort"


def test_ffmpeg_tee_onfail_policy_is_normalized() -> None:
    settings = Settings(
        _env_file=None,
        environment="development",
        stream_runtime_mode="systemd",
        ffmpeg_tee_onfail_policy="IGNORE",
        **_base_settings_kwargs(),
    )

    assert settings.ffmpeg_tee_onfail_policy == "ignore"


def test_ffmpeg_tee_onfail_policy_rejects_unknown_values() -> None:
    with pytest.raises(ValidationError, match="FFMPEG_TEE_ONFAIL_POLICY"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="systemd",
            ffmpeg_tee_onfail_policy="drop-only",
            **_base_settings_kwargs(),
        )


def test_ffmpeg_output_fifo_queue_size_must_be_positive() -> None:
    with pytest.raises(ValidationError, match="FFMPEG_OUTPUT_FIFO_QUEUE_SIZE"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="systemd",
            ffmpeg_output_fifo_queue_size=0,
            **_base_settings_kwargs(),
        )


def test_ffmpeg_output_recovery_values_must_be_non_negative() -> None:
    with pytest.raises(
        ValidationError, match="FFMPEG_OUTPUT_RECOVERY_MAX_ATTEMPTS"
    ):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="systemd",
            ffmpeg_output_recovery_max_attempts=-1,
            **_base_settings_kwargs(),
        )


def test_supervisor_runtime_mode_is_rejected() -> None:
    with pytest.raises(ValidationError, match="STREAM_RUNTIME_MODE"):
        Settings(
            _env_file=None,
            environment="development",
            stream_runtime_mode="supervisor",
            **_base_settings_kwargs(),
        )


def test_legacy_supervisor_env_keys_do_not_break_systemd_runtime(
    tmp_path: pytest.TempPathFactory,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "SUPERVISOR_PROGRAM_TEMPLATE=ffmpeg-%(stream_id)s",
                "SUPERVISOR_CTL_PATH=/usr/bin/supervisorctl",
                "SUPERVISOR_CONFIG_DIR=/etc/supervisor/conf.d",
                "SUPERVISOR_LOG_DIR=/var/log/supervisor",
                "SUPERVISOR_CONF_PATH=/etc/supervisord.conf",
            ]
        ),
        encoding="utf-8",
    )

    settings = Settings(
        _env_file=env_file,
        environment="production",
        stream_runtime_mode="systemd",
        systemd_unit_template="ffmpeg@{stream_id}",
        systemctl_path="/bin/systemctl",
        **_base_settings_kwargs(),
    )

    assert settings.stream_runtime_mode == "systemd"
    assert settings.systemctl_path == "/bin/systemctl"
