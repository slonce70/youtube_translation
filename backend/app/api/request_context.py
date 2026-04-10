from __future__ import annotations

from ipaddress import ip_address, ip_network
from typing import Any, Dict
from uuid import uuid4

from fastapi import Request

from app.core.config import settings


def _trusted_proxy_values() -> list[str]:
    raw = settings.trusted_proxy_ips
    if isinstance(raw, str):
        values = [proxy.strip() for proxy in raw.split(",") if proxy.strip()]
    else:
        values = [proxy.strip() for proxy in raw if proxy and proxy.strip()]
    return values


def _trusted_proxy_networks() -> list:
    networks = []
    for value in _trusted_proxy_values():
        try:
            networks.append(ip_network(value))
        except ValueError:
            continue
    return networks


def _is_trusted_proxy(client_ip: str) -> bool:
    networks = _trusted_proxy_networks()
    if not networks:
        return False
    try:
        ip = ip_address(client_ip)
    except ValueError:
        return False
    return any(ip in network for network in networks)


def _validated_ip(value: str | None) -> str | None:
    if not value:
        return None
    try:
        ip_address(value)
    except ValueError:
        return None
    return value


def resolve_client_ip(request: Request) -> str | None:
    client_ip = request.client.host if request.client else None
    forwarded = request.headers.get("X-Forwarded-For")

    if forwarded and client_ip and _is_trusted_proxy(client_ip):
        forwarded_client = forwarded.split(",")[0].strip()
        validated_forwarded = _validated_ip(forwarded_client)
        if validated_forwarded:
            return validated_forwarded
        validated_client = _validated_ip(client_ip)
        if validated_client:
            return validated_client

    return _validated_ip(client_ip)


def resolve_request_id(request: Request) -> str:
    existing = getattr(request.state, "request_id", None)
    if isinstance(existing, str) and existing.strip():
        return existing.strip()

    header_value = request.headers.get("X-Request-ID")
    if header_value and header_value.strip():
        request_id = header_value.strip()[:128]
    else:
        request_id = str(uuid4())

    request.state.request_id = request_id
    return request_id


def extract_request_audit_metadata(
    request: Request,
    *,
    route_path: str | None = None,
    user_payload: dict[str, Any] | None = None,
) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "request_id": resolve_request_id(request),
        "route_path": route_path or request.url.path,
        "method": request.method,
        "client_ip": resolve_client_ip(request),
        "user_agent": request.headers.get("user-agent"),
        "origin": request.headers.get("origin"),
        "referer": request.headers.get("referer"),
        "sec_fetch_site": request.headers.get("sec-fetch-site"),
    }

    if user_payload:
        session_id = user_payload.get("session_id")
        jti = user_payload.get("jti")
        if session_id:
            metadata["session_id"] = str(session_id)
        if jti:
            metadata["jwt_jti"] = str(jti)

    return metadata
