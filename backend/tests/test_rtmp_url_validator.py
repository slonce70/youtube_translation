"""Tests for the RTMPS destination URL validator (SSRF mitigation).

Each test pins one specific contract documented in the validator module
header. The DNS resolver is monkey-patched per test so we can drive the
private-IP / DNS-rebinding scenarios without touching the network.
"""
from __future__ import annotations

import pytest

from app.core.rtmp_url_validator import (
    DEFAULT_ALLOWED_PORTS,
    DENIED_PORTS,
    InvalidDestinationURL,
    validate_destination_url,
)


def _public_resolver(_hostname: str) -> tuple[str, ...]:
    """Default fake resolver: returns a single globally-routable address."""
    return ("1.1.1.1",)


class TestSchemeAndStructure:
    def test_accepts_rtmp(self) -> None:
        result = validate_destination_url(
            "rtmp://a.rtmp.youtube.com/live2/key", resolver=_public_resolver
        )
        assert result.scheme == "rtmp"
        assert result.hostname == "a.rtmp.youtube.com"

    def test_accepts_rtmps(self) -> None:
        result = validate_destination_url(
            "rtmps://a.rtmp.youtube.com/live2/key", resolver=_public_resolver
        )
        assert result.scheme == "rtmps"

    def test_rejects_http(self) -> None:
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "http://a.rtmp.youtube.com/live", resolver=_public_resolver
            )
        assert exc.value.code == "invalid_scheme"

    def test_rejects_missing_hostname(self) -> None:
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url("rtmps:///live/key", resolver=_public_resolver)
        assert exc.value.code == "missing_hostname"

    def test_rejects_empty_url(self) -> None:
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url("", resolver=_public_resolver)
        assert exc.value.code == "missing_url"

    @pytest.mark.parametrize("ch", ["[", "]", "|", "\\"])
    def test_rejects_tee_meta_in_hostname(self, ch: str) -> None:
        # urlparse won't parse `]` inside the hostname so we craft a URL
        # that surfaces the character in the netloc via percent-encoding bypass.
        # Easier: place the character directly as a sub-component.
        url = f"rtmps://evil{ch}host/live"
        with pytest.raises(InvalidDestinationURL):
            validate_destination_url(url, resolver=_public_resolver)


class TestPortPolicy:
    def test_default_port_allowed(self) -> None:
        # No explicit port → defaults to 443 for rtmps, 1935 for rtmp.
        validate_destination_url(
            "rtmps://a.rtmp.youtube.com/live", resolver=_public_resolver
        )
        validate_destination_url(
            "rtmp://a.rtmp.youtube.com/live", resolver=_public_resolver
        )

    def test_explicit_1935_allowed(self) -> None:
        validate_destination_url(
            "rtmp://a.rtmp.youtube.com:1935/live", resolver=_public_resolver
        )

    @pytest.mark.parametrize("port", sorted(DENIED_PORTS))
    def test_denylist_blocks_internal_ports(self, port: int) -> None:
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                f"rtmps://a.rtmp.youtube.com:{port}/live", resolver=_public_resolver
            )
        assert exc.value.code == "denied_port"

    def test_unknown_port_rejected_by_default(self) -> None:
        # 9999 is neither in DEFAULT_ALLOWED_PORTS nor DENIED_PORTS.
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "rtmp://a.rtmp.youtube.com:9999/live", resolver=_public_resolver
            )
        assert exc.value.code == "denied_port"

    def test_operator_can_extend_allowed_ports(self) -> None:
        validate_destination_url(
            "rtmp://a.rtmp.youtube.com:9999/live",
            resolver=_public_resolver,
            allowed_ports=DEFAULT_ALLOWED_PORTS | {9999},
        )


class TestPrivateAddressBlocking:
    @pytest.mark.parametrize(
        "private_ip",
        [
            "10.0.0.5",  # RFC1918
            "172.16.0.5",  # RFC1918
            "192.168.1.5",  # RFC1918
            "127.0.0.1",  # loopback
            "169.254.169.254",  # AWS/GCP metadata
            "0.0.0.0",  # unspecified
            "fd00::1",  # IPv6 ULA
            "::1",  # IPv6 loopback
            "fe80::1",  # IPv6 link-local
            "100.64.0.5",  # CGNAT (RFC 6598) — Python is_private does NOT cover
            "100.127.255.254",  # CGNAT upper end
            "192.0.0.1",  # IETF protocol assignments (RFC 6890)
            "224.0.0.1",  # multicast
            "255.255.255.255",  # broadcast / reserved
            "ff02::1",  # IPv6 multicast
        ],
    )
    def test_rejects_private_resolved_ip(self, private_ip: str) -> None:
        def fake_resolver(_hostname: str) -> tuple[str, ...]:
            return (private_ip,)

        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "rtmps://attacker.example.com/live/key", resolver=fake_resolver
            )
        assert exc.value.code == "private_address"

    def test_rejects_when_any_resolved_ip_is_private(self) -> None:
        # Multi-A record with a public AND a private IP must still be rejected
        # so an attacker cannot mix one valid IP with a target internal IP.
        def mixed_resolver(_hostname: str) -> tuple[str, ...]:
            return ("1.1.1.1", "10.0.0.5")

        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "rtmps://a.attacker.example.com/live", resolver=mixed_resolver
            )
        assert exc.value.code == "private_address"

    def test_accepts_purely_public_resolution(self) -> None:
        result = validate_destination_url(
            "rtmps://a.rtmp.youtube.com/live", resolver=_public_resolver
        )
        assert result.resolved_ips == ("1.1.1.1",)


class TestDnsRebindingMitigation:
    """A second resolution call returning a different (private) IP must fail.

    The contract: callers re-validate at stream-start. If between
    create-destination and start-stream the DNS record flips to a private
    IP, the second call rejects.
    """

    def test_second_call_with_changed_resolution_is_rejected(self) -> None:
        calls = {"n": 0}

        def flipping_resolver(_hostname: str) -> tuple[str, ...]:
            calls["n"] += 1
            return ("1.1.1.1",) if calls["n"] == 1 else ("10.0.0.5",)

        # First call: public → accepted.
        validate_destination_url(
            "rtmps://flip.example.com/live", resolver=flipping_resolver
        )
        # Second call: private → rejected.
        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "rtmps://flip.example.com/live", resolver=flipping_resolver
            )
        assert exc.value.code == "private_address"


class TestLiteralIPInUrl:
    def test_rejects_literal_private_ipv4(self) -> None:
        # urlparse's hostname returns the literal IP; resolver still gets
        # called and (if the literal is a valid IP) returns it as-is.
        def passthrough(host: str) -> tuple[str, ...]:
            return (host,)

        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url("rtmps://10.0.0.5/live", resolver=passthrough)
        assert exc.value.code == "private_address"

    def test_rejects_metadata_endpoint(self) -> None:
        def passthrough(host: str) -> tuple[str, ...]:
            return (host,)

        with pytest.raises(InvalidDestinationURL) as exc:
            validate_destination_url(
                "rtmp://169.254.169.254/computeMetadata/v1/", resolver=passthrough
            )
        assert exc.value.code == "private_address"
