from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


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

    # Supabase
    supabase_url: str
    supabase_key: str
    supabase_jwt_secret: str

    # Security
    encryption_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # Storage
    upload_dir: str = "/app/uploads"
    stream_dir: str = "/app/streams"
    max_upload_size: int = 10737418240  # 10GB

    # FFmpeg
    ffmpeg_bin: str = "/usr/bin/ffmpeg"
    ffprobe_bin: str = "/usr/bin/ffprobe"

    # Monitoring
    sentry_dsn: str = ""

    # CORS
    allowed_origins: List[str] = ["http://localhost:3000"]

    @property
    def cors_origins(self) -> List[str]:
        if isinstance(self.allowed_origins, str):
            return [origin.strip() for origin in self.allowed_origins.split(",")]
        return self.allowed_origins


settings = Settings()
