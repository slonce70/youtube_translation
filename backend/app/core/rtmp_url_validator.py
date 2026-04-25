"""RTMPS destination URL validation with SSRF mitigation.

Custom RTMPS destinations (where the user supplies an arbitrary hostname) are
the standard SaaS-platform SSRF vector for streaming services: an attacker
can configure ``rtmp://10.0.0.5/live/key`` and have the backend's ffmpeg
worker open a TCP connection to a private host on their behalf, which lets
them probe internal services or hit cloud-metadata endpoints
(``rtmp://169.254.169.254/...``).

This module enforces a defence-in-depth posture:

1. **Scheme allowlist** — only ``rtmp`` and ``rtmps`` are permitted.
2. **Hostname structural rejection** — ``[``, ``]``, ``|``, and ``\\`` are
   rejected outright. These are syntactic meta-characters of ffmpeg's tee
   muxer, and a hostname containing them is always either malformed or a
   tee-injection attempt.
3. **Port allowlist / denylist** — defaults to allowing the standard RTMP
   port 1935 plus 80/443 (some operators front RTMP via these ports). Common
   internal-service ports (22, 25, 3306, 5432, 6379, 8080, 9090, 9091) are
   denied even if the operator did not opt into the explicit allowlist.
4. **DNS resolution + IP allowlist** — every A/AAAA record returned for the
   hostname must be a globally-routable address. RFC 1918 ranges, loopback,
   link-local, IPv6 ULA, multicast, reserved, and unspecified addresses are
   rejected.

The ``DNS rebinding`` attack is partially mitigated by re-validating at
stream-start (call ``validate_destination_url`` again from
``services/streams/control.py`` before spawning ffmpeg). The residual
window between our resolution and ffmpeg's own resolution cannot be closed
without binding ffmpeg to a specific IP, which is out of scope for this
sprint. The runbook should document the residual risk.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence
from urllib.parse import urlparse

# Schemes the platform supports.
ALLOWED_SCHEMES: frozenset[str] = frozenset({"rtmp", "rtmps"})

# Default port allowlist. RTMP standard port is 1935; some networks allow
# RTMP over 80/443 to traverse restrictive egress firewalls.
DEFAULT_ALLOWED_PORTS: frozenset[int] = frozenset({1935, 80, 443})

# Ports that indicate an attempted internal-service probe even when the rest
# of the URL looks plausible. Always rejected.
DENIED_PORTS: frozenset[int] = frozenset(
    {
        22,  # SSH
        23,  # Telnet
        25,  # SMTP
        110,  # POP3
        111,  # rpcbind
        139,  # SMB
        143,  # IMAP
        445,  # SMB
        1433,  # MSSQL
        1521,  # Oracle
        2049,  # NFS
        3306,  # MySQL
        3389,  # RDP
        5432,  # PostgreSQL
        5984,  # CouchDB
        6379,  # Redis
        8080,  # common internal HTTP
        8443,  # common internal HTTPS
        9000,  # common internal admin
        9090,  # Prometheus
        9091,  # Pushgateway
        9200,  # Elasticsearch
        11211,  # Memcached
        27017,  # MongoDB
        50070,  # HDFS
    }
)

# Hostname meta-characters that can break ffmpeg argv assembly when the URL
# is used in tee or filter contexts. Reject before any parsing.
HOSTNAME_FORBIDDEN_CHARS: frozenset[str] = frozenset({"[", "]", "|", "\\"})


class InvalidDestinationURL(ValueError):
    """Raised when a destination URL fails validation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:  # noqa: D401
        return self.message


@dataclass(frozen=True)
class ValidatedDestination:
    """Normalized form of an accepted RTMPS destination URL."""

    scheme: str
    hostname: str
    port: int
    resolved_ips: tuple[str, ...]


def _resolve(hostname: str) -> tuple[str, ...]:
    """Resolve ``hostname`` to all reachable IPv4/IPv6 addresses.

    Pulled out as a small helper so tests can monkey-patch a fake resolver
    (e.g. for DNS-rebinding scenarios where the same hostname returns a
    public IP first and a private IP on the second call).
    """
    try:
        infos = socket.getaddrinfo(
            hostname,
            None,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as exc:
        raise InvalidDestinationURL(
            "dns_resolution_failed",
            f"Could not resolve destination hostname: {exc}",
        ) from exc

    addresses: list[str] = []
    seen: set[str] = set()
    for family, _socktype, _proto, _canon, sockaddr in infos:
        addr = sockaddr[0] if sockaddr else None
        if not addr or addr in seen:
            continue
        seen.add(addr)
        addresses.append(addr)

    if not addresses:
        raise InvalidDestinationURL(
            "dns_resolution_failed",
            "Destination hostname did not resolve to any address",
        )

    return tuple(addresses)


def _is_disallowed_address(addr: ipaddress._BaseAddress) -> Optional[str]:
    """Return a reason string if ``addr`` is in a disallowed range, else None.

    The ipaddress stdlib already exposes the canonical predicates we need.
    The link-local check covers RFC 3927 (IPv4 169.254/16) and RFC 4291 IPv6
    (fe80::/10). ``is_private`` covers RFC 1918 / RFC 4193 (IPv6 ULA).
    """
    if addr.is_unspecified:
        return "unspecified"
    if addr.is_loopback:
        return "loopback"
    if addr.is_link_local:
        return "link_local"
    if addr.is_multicast:
        return "multicast"
    if addr.is_reserved:
        return "reserved"
    if addr.is_private:
        return "private"
    return None


def validate_destination_url(
    url: str,
    *,
    allowed_ports: Optional[Iterable[int]] = None,
    denied_ports: Optional[Iterable[int]] = None,
    resolver: Optional[callable] = None,  # type: ignore[type-arg]
) -> ValidatedDestination:
    """Validate ``url`` and return a normalized ``ValidatedDestination``.

    Raises ``InvalidDestinationURL`` with a stable ``.code`` for every
    rejection so callers can surface a useful API error without relying on
    string parsing.
    """
    if not url or not isinstance(url, str):
        raise InvalidDestinationURL("missing_url", "Destination URL is required")

    try:
        parsed = urlparse(url.strip())
    except ValueError as exc:
        # urlparse raises on malformed IPv6 bracket syntax — ``[`` / ``]`` /
        # mismatched brackets. Surface as a structured rejection.
        raise InvalidDestinationURL(
            "invalid_hostname_characters",
            f"Destination URL is malformed: {exc}",
        ) from exc

    scheme = (parsed.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise InvalidDestinationURL(
            "invalid_scheme",
            "Destination URL must use rtmp or rtmps scheme",
        )

    hostname = parsed.hostname or ""
    if not hostname:
        raise InvalidDestinationURL(
            "missing_hostname",
            "Destination URL must include a hostname",
        )

    if any(ch in hostname for ch in HOSTNAME_FORBIDDEN_CHARS):
        raise InvalidDestinationURL(
            "invalid_hostname_characters",
            "Destination hostname contains characters forbidden by the tee muxer",
        )

    # urlparse decodes IPv6 hostnames already (without brackets); reject
    # any non-printable / control / whitespace bytes outright.
    if any(ord(ch) < 0x21 or ord(ch) > 0x7E for ch in hostname):
        raise InvalidDestinationURL(
            "invalid_hostname_characters",
            "Destination hostname contains non-ASCII or control characters",
        )

    port = (
        parsed.port if parsed.port is not None else (443 if scheme == "rtmps" else 1935)
    )

    denied = frozenset(denied_ports) if denied_ports is not None else DENIED_PORTS
    if port in denied:
        raise InvalidDestinationURL(
            "denied_port",
            f"Destination port {port} is not allowed",
        )

    allowed = (
        frozenset(allowed_ports) if allowed_ports is not None else DEFAULT_ALLOWED_PORTS
    )
    if port not in allowed:
        raise InvalidDestinationURL(
            "denied_port",
            f"Destination port {port} is not in the allowed RTMP port set",
        )

    # Resolve and validate every returned IP. We also reject if the URL itself
    # is a literal private IP (urlparse hostname returns the literal).
    resolve = resolver or _resolve
    addresses = resolve(hostname)

    bad_reasons: list[str] = []
    for raw in addresses:
        try:
            addr = ipaddress.ip_address(raw)
        except ValueError:
            bad_reasons.append(f"{raw}: not_an_ip")
            continue
        reason = _is_disallowed_address(addr)
        if reason is not None:
            bad_reasons.append(f"{raw}: {reason}")

    if bad_reasons:
        raise InvalidDestinationURL(
            "private_address",
            "Destination resolves to a non-public address: " + ", ".join(bad_reasons),
        )

    return ValidatedDestination(
        scheme=scheme,
        hostname=hostname,
        port=port,
        resolved_ips=tuple(addresses),
    )


def split_destinations(urls: Sequence[str]) -> List[ValidatedDestination]:
    """Validate a batch of URLs; raises on the first failure.

    Convenience wrapper for the call sites that take a list of destinations
    (e.g. multi-tee stream start).
    """
    return [validate_destination_url(url) for url in urls]
