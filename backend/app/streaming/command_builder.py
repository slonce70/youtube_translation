from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.config import settings

# Characters that, if present anywhere in a destination URL or stream key,
# would break ffmpeg's tee muxer parsing or allow injection of additional
# tee outputs / options. We reject early; we never escape — escaping is
# version-fragile across ffmpeg builds and there is no legitimate reason
# for these bytes to appear in an RTMP URL or stream key.
TEE_FORBIDDEN_CHARS: frozenset[str] = frozenset({"[", "]", "|", "\\", "\n", "\r", "\t"})


class TeeMetaCharacterError(ValueError):
    """Raised when a destination URL or key contains tee meta-characters."""


def _reject_tee_meta(value: str, *, field: str) -> None:
    """Defence-in-depth check: refuse strings that would break tee assembly.

    The primary defence lives in ``core.rtmp_url_validator`` which rejects
    these bytes in the *hostname* at quota-validation time. This second
    layer covers any other component (path, query, stream key) and protects
    the tee assembly even when the validator is bypassed (e.g. via direct
    service-layer call paths that don't go through the API).
    """
    if not value:
        return
    bad = [c for c in TEE_FORBIDDEN_CHARS if c in value]
    if bad:
        raise TeeMetaCharacterError(
            f"Destination {field} contains forbidden tee meta-character(s): "
            + "".join(repr(c) for c in bad)
        )


@dataclass(frozen=True)
class FFmpegDestinationOutputArgs:
    command: List[str]
    destination_uris: List[str]
    multi_destination: bool
    tee_onfail_policy: Optional[str]


def _resolve_settings(settings_module: Optional[Any] = None) -> Any:
    return settings if settings_module is None else settings_module


def normalize_destinations(destinations: List[Dict[str, str]]) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for dest in destinations:
        base_url = str(dest.get("url") or "").rstrip("/")
        stream_key = str(dest.get("key") or "").strip()

        _reject_tee_meta(base_url, field="url")
        _reject_tee_meta(stream_key, field="key")

        if not base_url:
            normalized.append({"uri": stream_key})
        else:
            normalized.append({"uri": f"{base_url}/{stream_key}"})
    return normalized


def apply_output_transport_options(
    uri: str, *, settings_module: Optional[Any] = None
) -> str:
    settings_obj = _resolve_settings(settings_module)

    try:
        parts = urlsplit(uri)
    except Exception:
        return uri

    if parts.scheme.lower() not in {"rtmp", "rtmps"}:
        return uri

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    query = dict(query_pairs)

    if bool(getattr(settings_obj, "ffmpeg_output_tcp_keepalive", False)):
        query.setdefault("tcp_keepalive", "1")

    rw_timeout = max(int(getattr(settings_obj, "ffmpeg_output_rw_timeout_us", 0)), 0)
    if rw_timeout > 0:
        query.setdefault("rw_timeout", str(rw_timeout))

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query, doseq=True),
            parts.fragment,
        )
    )


def build_tee_destination(uri: str, *, settings_module: Optional[Any] = None) -> str:
    settings_obj = _resolve_settings(settings_module)
    tee_fail_policy = getattr(settings_obj, "ffmpeg_tee_onfail_policy", "ignore")
    max_recovery_attempts = max(
        int(getattr(settings_obj, "ffmpeg_output_recovery_max_attempts", 0)), 0
    )
    queue_size = max(int(getattr(settings_obj, "ffmpeg_output_fifo_queue_size", 1)), 1)
    drop_pkts_on_overflow = (
        "1"
        if bool(getattr(settings_obj, "ffmpeg_output_drop_pkts_on_overflow", False))
        else "0"
    )
    target_uri = apply_output_transport_options(uri, settings_module=settings_obj)

    # Final guard before the tee target string is emitted into argv. If any
    # forbidden meta-character has slipped through (e.g. via a future code
    # path that bypasses normalize_destinations), refuse to render the
    # target rather than emit a string that would let an attacker inject
    # an extra tee output.
    _reject_tee_meta(target_uri, field="url")

    return (
        "[select='v\\:0,a\\:0':"
        f"onfail={tee_fail_policy}:"
        "f=fifo:fifo_format=flv:"
        "attempt_recovery=1:"
        "recovery_wait_time=5:"
        "recover_any_error=1:"
        "restart_with_keyframe=1:"
        f"drop_pkts_on_overflow={drop_pkts_on_overflow}:"
        f"queue_size={queue_size}:"
        f"max_recovery_attempts={max_recovery_attempts}]" + target_uri
    )


def build_destination_output_args(
    normalized_destinations: List[Dict[str, str]],
    *,
    settings_module: Optional[Any] = None,
) -> FFmpegDestinationOutputArgs:
    settings_obj = _resolve_settings(settings_module)

    if not normalized_destinations:
        raise ValueError("At least one destination is required")

    if len(normalized_destinations) == 1:
        target = apply_output_transport_options(
            normalized_destinations[0]["uri"], settings_module=settings_obj
        )
        max_recovery_attempts = max(
            int(getattr(settings_obj, "ffmpeg_output_recovery_max_attempts", 0)), 0
        )
        queue_size = max(
            int(getattr(settings_obj, "ffmpeg_output_fifo_queue_size", 1)), 1
        )
        command = [
            "-f",
            "fifo",
            "-fifo_format",
            "flv",
            "-attempt_recovery",
            "1",
            "-recovery_wait_time",
            "5",
            "-recover_any_error",
            "1",
            "-restart_with_keyframe",
            "1",
            "-drop_pkts_on_overflow",
            (
                "1"
                if bool(
                    getattr(settings_obj, "ffmpeg_output_drop_pkts_on_overflow", False)
                )
                else "0"
            ),
            "-queue_size",
            str(queue_size),
            "-max_recovery_attempts",
            str(max_recovery_attempts),
            target,
        ]
        return FFmpegDestinationOutputArgs(
            command=command,
            destination_uris=[target],
            multi_destination=False,
            tee_onfail_policy=None,
        )

    tee_outputs: List[str] = []
    destination_uris: List[str] = []
    for dest in normalized_destinations:
        uri = dest["uri"]
        target_uri = apply_output_transport_options(uri, settings_module=settings_obj)
        destination_uris.append(target_uri)
        tee_outputs.append(build_tee_destination(uri, settings_module=settings_obj))

    return FFmpegDestinationOutputArgs(
        command=["-f", "tee", "|".join(tee_outputs)],
        destination_uris=destination_uris,
        multi_destination=True,
        tee_onfail_policy=getattr(settings_obj, "ffmpeg_tee_onfail_policy", "ignore"),
    )
