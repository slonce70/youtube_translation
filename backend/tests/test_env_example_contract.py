from pathlib import Path


REQUIRED_ENV_EXAMPLE_KEYS = {
    "CSRF_SECRET",
    "DISK_CRITICAL_PERCENT",
    "DISK_WARNING_PERCENT",
    "DOWNLOAD_TOKEN_TTL_SECONDS",
    "ENCRYPTION_KEY_PREVIOUS",
    "FFMPEG_OUTPUT_DROP_PKTS_ON_OVERFLOW",
    "FFMPEG_OUTPUT_FIFO_QUEUE_SIZE",
    "FFMPEG_OUTPUT_RW_TIMEOUT_US",
    "FFMPEG_OUTPUT_TCP_KEEPALIVE",
    "FFMPEG_RESTART_BACKOFF_MAX_SECONDS",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_SCOPES",
    "PLAYLIST_SHUFFLE_SEED_MODE",
    "REDIS_RATE_LIMIT_PREFIX",
    "REDIS_URL",
    "STREAM_LOG_MAX_BACKUPS",
    "STREAM_LOG_MAX_BYTES",
    "STREAM_SCHEDULE_POLL_INTERVAL_SECONDS",
    "STREAM_SCHEDULE_RETRY_INTERVAL_SECONDS",
    "SUPABASE_SERVICE_KEY",
    "UPLOAD_TOKEN_TTL_SECONDS",
    "USER_CACHE_MAX_SIZE",
    "WS_TOKEN_SECRET",
    "WS_TOKEN_TTL_SECONDS",
    "YOUTUBE_OAUTH_STATE_SECRET",
    "YOUTUBE_PROVIDER_HTTP_TIMEOUT_SECONDS",
    "YOUTUBE_PROVIDER_STATUS_TTL_SECONDS",
}


def _env_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip())
    return keys


def test_security_and_runtime_settings_are_documented_in_env_example() -> None:
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    missing = REQUIRED_ENV_EXAMPLE_KEYS - _env_keys(env_example)
    assert missing == set()
