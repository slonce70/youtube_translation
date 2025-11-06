from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, FieldValidationInfo
from typing import List, Optional
from urllib.parse import urlparse, urlunparse, quote, unquote


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
    )

    # Server
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_workers: int = 4
    environment: str = "development"  # development, staging, production

    # Supabase
    supabase_url: str
    supabase_key: str
    supabase_service_key: Optional[str] = None
    supabase_jwt_secret: str
    supabase_user_cache_ttl_seconds: int = 60
    supabase_user_cache_max_entries: int = 512
    supabase_user_cache_expiry_leeway_seconds: int = 5

    # Database
    database_url: str
    db_pool_size: int = 3
    db_max_overflow: int = 0
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

    # Storage
    upload_dir: str = "/app/uploads"
    stream_dir: str = "/app/streams"
    max_upload_size: int = 10737418240  # 10GB

    # FFmpeg
    ffmpeg_bin: str = "/usr/bin/ffmpeg"
    ffprobe_bin: str = "/usr/bin/ffprobe"
    ffmpeg_auto_restart_attempts: int = 1
    ffmpeg_restart_backoff_seconds: int = 5

    # Monitoring
    sentry_dsn: str = ""

    # CORS
    allowed_origins: List[str] | str = ["http://localhost:3000"]

    # Internal integrations
    tusd_hmac_secret: Optional[str] = None

    @property
    def cors_origins(self) -> List[str]:
        if isinstance(self.allowed_origins, str):
            return [origin.strip() for origin in self.allowed_origins.split(",")]
        return self.allowed_origins

    @field_validator('database_url')
    @classmethod
    def validate_database_url(cls, v: str, info: FieldValidationInfo) -> str:
        """Validate DATABASE_URL to ensure it's compatible with asyncpg."""
        if ':6543/' in v:
            raise ValueError(
                "Transaction Mode pooler (port 6543) is not compatible with asyncpg. "
                "Use Session Mode (port 5432) or direct connection."
            )

        parsed = urlparse(v)

        if not parsed.hostname:
            return v

        hostname = parsed.hostname.lower()

        # Direct connections require IPv6; fail fast with clear guidance.
        if hostname.startswith('db.') and hostname.endswith('.supabase.co'):
            raise ValueError(
                "Direct compute connections (db.<ref>.supabase.co) require IPv6 and "
                "often fail locally. Use the Session Mode pooler host from the Supabase "
                "dashboard instead."
            )

        # Session pooler requires project-qualified usernames. Add it automatically.
        if hostname.endswith('.pooler.supabase.com'):
            current_user = parsed.username or 'postgres'
            if '.' not in current_user:
                supabase_url = info.data.get('supabase_url') if info is not None else None
                project_ref = None
                if supabase_url:
                    supabase_host = urlparse(str(supabase_url)).hostname or ''
                    project_ref = supabase_host.split('.')[0] if supabase_host else None

                if not project_ref:
                    raise ValueError(
                        "Supabase project reference is required to build a pooler username. "
                        "Ensure SUPABASE_URL is set."
                    )

                password = unquote(parsed.password) if parsed.password else ''
                new_username = f"{current_user}.{project_ref}"
                netloc = new_username
                if password:
                    netloc += f":{quote(password)}"
                netloc += f"@{parsed.hostname}"
                if parsed.port:
                    netloc += f":{parsed.port}"

                parsed = parsed._replace(netloc=netloc)
                v = urlunparse(parsed)

        return v

    @field_validator('encryption_salt')
    @classmethod
    def validate_encryption_salt(cls, value: str, info: FieldValidationInfo) -> str:
        environment = (info.data or {}).get('environment', 'development')
        if environment != 'development' and value == "default_salt_change_in_production_16bytes":
            raise ValueError("ENCRYPTION_SALT must be set to a secure value")
        return value

    @field_validator('download_token_secret')
    @classmethod
    def validate_download_token_secret(cls, value: str, info: FieldValidationInfo) -> str:
        environment = (info.data or {}).get('environment', 'development')
        if environment != 'development' and value == "change_this_download_secret":
            raise ValueError("DOWNLOAD_TOKEN_SECRET must be configured")
        return value


settings = Settings()
