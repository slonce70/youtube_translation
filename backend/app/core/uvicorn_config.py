from __future__ import annotations

import os
from typing import Any

from app.core.config import settings

DEFAULT_FORWARDED_ALLOW_IPS = ",".join(
    [
        "127.0.0.1",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    ]
)


def resolved_forwarded_allow_ips() -> str:
    explicit_value = os.getenv("FORWARDED_ALLOW_IPS", "").strip()
    if explicit_value:
        return explicit_value

    trusted_proxies = settings.trusted_proxies
    if trusted_proxies:
        return ",".join(trusted_proxies)

    # Host-level reverse proxies often reach Docker containers from bridge ranges
    # rather than 127.0.0.1, so keep private-network proxies trusted by default.
    return DEFAULT_FORWARDED_ALLOW_IPS


def build_uvicorn_run_kwargs(
    *,
    host: str,
    port: int,
    reload: bool = False,
    log_level: str = "info",
) -> dict[str, Any]:
    return {
        "host": host,
        "port": port,
        "reload": reload,
        "log_level": log_level,
        "proxy_headers": True,
        "forwarded_allow_ips": resolved_forwarded_allow_ips(),
    }
