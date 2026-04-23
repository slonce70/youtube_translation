import socket
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import ValidationInfo, field_validator, model_validator
from typing import List, Optional, Union
from urllib.parse import urlparse, urlunparse, quote, unquote, parse_qsl, urlencode


def _running_in_container() -> bool:
    return Path("/.dockerenv").exists()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False
    )

    # Server
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_workers: int = 4
    environment: str  # development, test, staging, production

    # Supabase
    supabase_url: str
    supabase_key: str
    supabase_service_key: Optional[str] = None
    supabase_jwt_secret: str
    supabase_user_cache_ttl_seconds: int = 60
    supabase_user_cache_max_entries: int = 512
    supabase_user_cache_expiry_leeway_seconds: int = 5
    enable_dev_auth: bool = False
    dev_user_id: Optional[str] = None
    dev_user_email: Optional[str] = None

    # Database
    database_url: str
    postgres_password: Optional[str] = None
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_timeout_seconds: int = 30
    db_pool_recycle_seconds: int = 1800
    db_use_null_pool: bool = False
    db_echo_sql: bool = False

    # Security & Encryption
    encryption_key: str
    encryption_salt: str = "default_salt_change_in_production_16bytes"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    download_token_secret: str = "change_this_download_secret"
    download_token_ttl_seconds: int = 300  # 5 minutes
    upload_token_secret: str = "change_this_upload_secret"
    upload_token_ttl_seconds: int = 900  # 15 minutes
    csrf_secret: Optional[str] = None
    ws_token_secret: Optional[str] = None
    ws_token_ttl_seconds: int = 60

    # Storage
    upload_dir: str = "/app/uploads"
    stream_dir: str = "/app/streams"
    max_upload_size: int = 10737418240  # 10GB

    # Schema patch runner (keep True only where deploy has no migrate step)
    run_schema_patches_on_boot: bool = True

    # FFmpeg
    ffmpeg_bin: str = "/usr/bin/ffmpeg"
    ffprobe_bin: str = "/usr/bin/ffprobe"
    ffmpeg_auto_restart_attempts: int = 0
    ffmpeg_restart_backoff_seconds: int = 5
    ffmpeg_restart_backoff_max_seconds: int = 60
    placeholder_video_path: Optional[str] = None
    placeholder_audio_path: Optional[str] = None
    placeholder_video_resolution: str = "1280x720"
    placeholder_video_fps: int = 30
    placeholder_video_color: str = "black"
    placeholder_audio_sample_rate: int = 44100
    placeholder_audio_channel_layout: str = "stereo"
    ffmpeg_video_bitrate_kbps: int = 6000
    ffmpeg_video_maxrate_kbps: int = 7500
    ffmpeg_video_bufsize_kbps: int = 12000
    ffmpeg_audio_bitrate_kbps: int = 160
    ffmpeg_keyframe_interval_seconds: float = 2.0  # YouTube/Twitch recommend 2s, max 4s
    ffmpeg_tee_onfail_policy: str = "ignore"
    # Bound fifo recovery by default so persistent RTMP(S) faults do not loop forever
    # inside a single process and inflate cgroup memory pressure.
    ffmpeg_output_recovery_max_attempts: int = 12
    ffmpeg_output_fifo_queue_size: int = 240
    ffmpeg_output_drop_pkts_on_overflow: bool = True
    ffmpeg_output_rw_timeout_us: int = 15000000
    ffmpeg_output_tcp_keepalive: bool = True
    ffmpeg_cleanup_interval_seconds: int = 60
    stream_log_max_bytes: int = 52428800  # 50MB
    stream_log_max_backups: int = 5

    # Monitoring
    sentry_dsn: str = ""
    metrics_access_token: Optional[str] = None
    disk_warning_percent: int = 80
    disk_critical_percent: int = 90

    # CORS
    allowed_origins: Union[List[str], str] = ["http://localhost:3000"]
    trusted_proxy_ips: Union[List[str], str] = []

    # Internal integrations
    tusd_hmac_secret: Optional[str] = None

    # FFmpeg Manager Configuration
    ffmpeg_error_history_size: int = 20  # Number of recent errors to keep
    user_cache_max_size: int = 512  # Maximum number of cached users
    stream_runtime_mode: str = "manager"  # manager | systemd
    allow_unsafe_manager_runtime: bool = False
    allow_unsafe_containerized_systemd_runtime: bool = False
    systemd_unit_template: str = "ffmpeg@{stream_id}"
    systemctl_path: str = "systemctl"
    # Deprecated supervisor-era settings remain accepted so older production
    # .env files do not crash the systemd worker before launch. They are inert
    # and can be removed during config cleanup.
    supervisor_program_template: Optional[str] = None
    supervisor_ctl_path: Optional[str] = None
    supervisor_config_dir: Optional[str] = None
    supervisor_log_dir: Optional[str] = None
    supervisor_conf_path: Optional[str] = None
    stream_runtime_node_id: str = socket.gethostname()
    stream_runtime_heartbeat_interval_seconds: int = 10
    stream_runtime_heartbeat_ttl_seconds: int = 45
    stream_schedule_poll_interval_seconds: int = 15
    stream_schedule_retry_interval_seconds: int = 60
    playlist_shuffle_seed_mode: str = "deterministic"
    mediamtx_enabled: bool = False
    mediamtx_rtmp_publish_url: Optional[str] = None
    mediamtx_control_api_url: Optional[str] = None
    mediamtx_metrics_url: Optional[str] = None

    # Rate limiting / Redis (optional)
    redis_url: Optional[str] = None
    redis_rate_limit_prefix: str = "rate-limit"

    # YouTube OAuth / provider status
    google_oauth_client_id: Optional[str] = None
    google_oauth_client_secret: Optional[str] = None
    google_oauth_redirect_uri: Optional[str] = None
    google_oauth_authorize_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_oauth_token_url: str = "https://oauth2.googleapis.com/token"
    google_oauth_scopes: Union[List[str], str] = [
        "https://www.googleapis.com/auth/youtube.readonly"
    ]
    youtube_api_base_url: str = "https://www.googleapis.com/youtube/v3"
    youtube_oauth_state_secret: Optional[str] = None
    youtube_provider_status_ttl_seconds: int = 30
    youtube_provider_http_timeout_seconds: int = 15

    @property
    def cors_origins(self) -> List[str]:
        origins = []
        if isinstance(self.allowed_origins, str):
            origins = [origin.strip() for origin in self.allowed_origins.split(",")]
        else:
            origins = self.allowed_origins
        return origins

    @property
    def trusted_proxies(self) -> List[str]:
        proxies: List[str]
        if isinstance(self.trusted_proxy_ips, str):
            proxies = [
                proxy.strip()
                for proxy in self.trusted_proxy_ips.split(",")
                if proxy.strip()
            ]
        else:
            proxies = [
                proxy.strip() for proxy in self.trusted_proxy_ips if proxy.strip()
            ]
        return proxies

    @property
    def google_oauth_scope_list(self) -> List[str]:
        scopes: List[str]
        if isinstance(self.google_oauth_scopes, str):
            scopes = [
                scope.strip()
                for scope in self.google_oauth_scopes.split(",")
                if scope.strip()
            ]
        else:
            scopes = [
                scope.strip() for scope in self.google_oauth_scopes if scope.strip()
            ]
        return scopes or ["https://www.googleapis.com/auth/youtube.readonly"]

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, value: str) -> str:
        normalized = str(value).strip().lower()
        if normalized not in {"development", "test", "staging", "production"}:
            raise ValueError(
                "ENVIRONMENT must be one of development, test, staging, or production"
            )
        return normalized

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str, info: ValidationInfo) -> str:
        """Validate DATABASE_URL to ensure it's compatible with asyncpg."""
        if ":6543/" in v:
            raise ValueError(
                "Transaction Mode pooler (port 6543) is not compatible with asyncpg. "
                "Use Session Mode (port 5432) or direct connection."
            )

        parsed = urlparse(v)

        if not parsed.hostname:
            return v

        hostname = parsed.hostname.lower()

        # Direct connections require IPv6; fail fast with clear guidance.
        if hostname.startswith("db.") and hostname.endswith(".supabase.co"):
            raise ValueError(
                "Direct compute connections (db.<ref>.supabase.co) require IPv6 and "
                "often fail locally. Use the Session Mode pooler host from the Supabase "
                "dashboard instead."
            )

        # Session pooler requires project-qualified usernames. Add it automatically.
        if hostname.endswith(".pooler.supabase.com"):
            current_user = parsed.username or "postgres"
            if "." not in current_user:
                supabase_url = (
                    info.data.get("supabase_url") if info is not None else None
                )
                project_ref = None
                if supabase_url:
                    supabase_host = urlparse(str(supabase_url)).hostname or ""
                    project_ref = supabase_host.split(".")[0] if supabase_host else None

                if not project_ref:
                    raise ValueError(
                        "Supabase project reference is required to build a pooler username. "
                        "Ensure SUPABASE_URL is set."
                    )

                password = unquote(parsed.password) if parsed.password else ""
                new_username = f"{current_user}.{project_ref}"
                netloc = new_username
                if password:
                    netloc += f":{quote(password)}"
                netloc += f"@{parsed.hostname}"
                if parsed.port:
                    netloc += f":{parsed.port}"

                parsed = parsed._replace(netloc=netloc)
                v = urlunparse(parsed)

            # Ensure pooler connections run in session mode and align pool size limits
            query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))

            pool_mode = query_params.pop("pool_mode", None)
            if pool_mode and pool_mode.lower() != "session":
                raise ValueError(
                    "Supabase pooler must use pool_mode=session for async connections. "
                    "Update DATABASE_URL parameters."
                )

            existing_pool_size = query_params.get("pool_size")
            if existing_pool_size:
                try:
                    existing_value = int(existing_pool_size)
                except ValueError as exc:
                    raise ValueError(
                        "DATABASE_URL pool_size must be an integer"
                    ) from exc

                if existing_value < 1:
                    raise ValueError("DATABASE_URL pool_size must be at least 1")
            else:
                configured_pool_size = (
                    (info.data or {}).get("db_pool_size") if info is not None else None
                )
                if configured_pool_size is not None:
                    try:
                        configured_value = int(configured_pool_size)
                    except (TypeError, ValueError) as exc:
                        raise ValueError("DB_POOL_SIZE must be an integer") from exc

                    if configured_value < 1:
                        raise ValueError("DB_POOL_SIZE must be at least 1")

            parsed = parsed._replace(query=urlencode(query_params))
            v = urlunparse(parsed)

        return v

    @field_validator("encryption_salt")
    @classmethod
    def validate_encryption_salt(cls, value: str, info: ValidationInfo) -> str:
        environment = (info.data or {}).get("environment", "development")
        if (
            environment != "development"
            and value == "default_salt_change_in_production_16bytes"
        ):
            raise ValueError("ENCRYPTION_SALT must be set to a secure value")
        return value

    @field_validator("download_token_secret")
    @classmethod
    def validate_download_token_secret(cls, value: str, info: ValidationInfo) -> str:
        environment = (info.data or {}).get("environment", "development")
        if environment != "development" and value == "change_this_download_secret":
            raise ValueError("DOWNLOAD_TOKEN_SECRET must be configured")
        return value

    @field_validator("enable_dev_auth")
    @classmethod
    def validate_dev_auth(cls, value: bool, info: ValidationInfo) -> bool:
        environment = (info.data or {}).get("environment", "development")
        if value and environment != "development":
            raise ValueError("ENABLE_DEV_AUTH is only allowed in development")
        return value

    @field_validator("upload_token_secret")
    @classmethod
    def validate_upload_token_secret(cls, value: str, info: ValidationInfo) -> str:
        environment = (info.data or {}).get("environment", "development")
        if environment != "development" and value == "change_this_upload_secret":
            raise ValueError("UPLOAD_TOKEN_SECRET must be configured")
        return value

    @field_validator("metrics_access_token")
    @classmethod
    def validate_metrics_access_token(
        cls, value: Optional[str], info: ValidationInfo
    ) -> Optional[str]:
        environment = (info.data or {}).get("environment", "development")
        if environment == "development":
            return value
        if not value or value == "change_this_metrics_token":
            raise ValueError(
                "METRICS_ACCESS_TOKEN must be set to a non-default value in non-dev environments"
            )
        return value

    @field_validator("stream_runtime_mode")
    @classmethod
    def validate_stream_runtime_mode(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"manager", "systemd"}:
            raise ValueError("STREAM_RUNTIME_MODE must be 'manager' or 'systemd'")
        return normalized

    @field_validator(
        "stream_runtime_heartbeat_interval_seconds",
        "stream_runtime_heartbeat_ttl_seconds",
        "ffmpeg_output_recovery_max_attempts",
    )
    @classmethod
    def validate_stream_runtime_heartbeat_seconds(
        cls, value: int, info: ValidationInfo
    ) -> int:
        field_name = info.field_name or "stream runtime value"
        minimum = 0 if field_name in {"ffmpeg_output_recovery_max_attempts"} else 1
        if int(value) < minimum:
            qualifier = "at least 0" if minimum == 0 else "at least 1 second"
            raise ValueError(f"{field_name.upper()} must be {qualifier}")
        return int(value)

    @model_validator(mode="after")
    def validate_runtime_policy(self) -> "Settings":
        environment = str(self.environment).lower()
        if (
            self.stream_runtime_mode == "manager"
            and environment in {"production", "staging"}
            and not self.allow_unsafe_manager_runtime
        ):
            raise ValueError(
                "STREAM_RUNTIME_MODE=manager is disabled for staging/production. "
                "Use systemd or explicitly set ALLOW_UNSAFE_MANAGER_RUNTIME=true."
            )

        if (
            self.stream_runtime_mode == "systemd"
            and environment in {"production", "staging"}
            and _running_in_container()
            and not self.allow_unsafe_containerized_systemd_runtime
        ):
            raise ValueError(
                "STREAM_RUNTIME_MODE=systemd is blocked for containerized staging/production backends "
                "unless you explicitly set ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=true. "
                "Use a host-native backend control plane or a reviewed runtime-control mechanism first."
            )

        if (
            self.stream_runtime_heartbeat_ttl_seconds
            < self.stream_runtime_heartbeat_interval_seconds
        ):
            raise ValueError(
                "STREAM_RUNTIME_HEARTBEAT_TTL_SECONDS must be greater than or equal to "
                "STREAM_RUNTIME_HEARTBEAT_INTERVAL_SECONDS."
            )

        return self

    @field_validator("systemd_unit_template")
    @classmethod
    def validate_systemd_unit_template(cls, value: str) -> str:
        if "{stream_id}" not in value:
            raise ValueError(
                "SYSTEMD_UNIT_TEMPLATE must include '{stream_id}' placeholder"
            )
        return value

    @field_validator("ffmpeg_keyframe_interval_seconds")
    @classmethod
    def validate_keyframe_interval(cls, value: float) -> float:
        if not 0.5 <= value <= 4.0:
            raise ValueError(
                "FFMPEG_KEYFRAME_INTERVAL_SECONDS must be between 0.5 and 4.0 seconds"
            )
        return value

    @field_validator("ffmpeg_tee_onfail_policy")
    @classmethod
    def validate_ffmpeg_tee_onfail_policy(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"ignore", "abort"}:
            raise ValueError("FFMPEG_TEE_ONFAIL_POLICY must be 'ignore' or 'abort'")
        return normalized

    @field_validator(
        "ffmpeg_output_recovery_max_attempts",
        "ffmpeg_output_rw_timeout_us",
    )
    @classmethod
    def validate_non_negative_ffmpeg_output_values(cls, value: int) -> int:
        if int(value) < 0:
            raise ValueError("FFMPEG output recovery values must be non-negative")
        return int(value)

    @field_validator("ffmpeg_output_fifo_queue_size")
    @classmethod
    def validate_ffmpeg_output_fifo_queue_size(cls, value: int) -> int:
        if int(value) < 1:
            raise ValueError("FFMPEG_OUTPUT_FIFO_QUEUE_SIZE must be at least 1")
        return int(value)


settings = Settings()  # type: ignore[call-arg]
