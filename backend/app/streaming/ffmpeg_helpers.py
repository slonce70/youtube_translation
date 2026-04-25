"""Pure helpers extracted from ``ffmpeg_manager.py``.

Sprint 8.3 split: lifts the module-level pure helper functions out of
the 2.1k-LOC ``FFmpegStreamManager`` host module into a sibling. Every
function here is either:

  * platform / pre-exec hardening that runs before the FFmpeg child
    image is loaded (``_load_libc``, ``_harden_ffmpeg_child``), or
  * pure string / list manipulation with zero state
    (RTMP URL redaction, failure-message construction, marker matching).

None of them depend on ``FFmpegStreamManager`` instance state, on the
asyncio loop, or on the database. Lifting them keeps ``ffmpeg_manager``
shrinking toward the 800-LOC ceiling and makes the redaction +
hardening behaviour independently unit-testable.

``ffmpeg_manager.py`` re-imports the public names so existing call
sites (and existing tests that monkey-patch ``_load_libc`` /
``_harden_ffmpeg_child``) keep working without churn.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
import re
import signal
import sys
from typing import List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from app.streaming import runtime_signals


# Keyframe interval ceilings used by ``_select_keyframe_settings``. Pinned
# to RTMP-friendly bounds: at <0.5 s ffmpeg's GOP encoder thrashes; at >4 s
# YouTube's HLS packager rejects the upload.
DEFAULT_KEYFRAME_INTERVAL_SECONDS = 2.0
MIN_KEYFRAME_INTERVAL_SECONDS = 0.5
MAX_KEYFRAME_INTERVAL_SECONDS = 4.0


# Compiled once at import — reused across every redaction call.
_RTMP_URL_PATTERN = re.compile(r"rtmps?://[^\s'\"|]+", re.IGNORECASE)


# prctl(2) constants (see Linux ``include/linux/prctl.h``). The two values
# below are the only ones we issue from the ffmpeg pre-exec hook.
_PR_SET_DUMPABLE = 4
_PR_SET_PDEATHSIG = 1


# Process-wide cache for libc. Re-loading on every fork would add up to
# tens of milliseconds per stream start under load.
_libc: Optional[ctypes.CDLL] = None


def _load_libc() -> Optional[ctypes.CDLL]:
    """Lazy-load libc. Cached on success, None on platforms without prctl."""
    global _libc
    if _libc is not None:
        return _libc
    if not sys.platform.startswith("linux"):
        return None
    libc_path = ctypes.util.find_library("c")
    if libc_path is None:
        return None
    try:
        _libc = ctypes.CDLL(libc_path, use_errno=True)
    except OSError:
        return None
    return _libc


def _harden_ffmpeg_child() -> None:
    """preexec_fn — runs in the forked child *before* exec(ffmpeg).

    Three hardening steps, all best-effort (failures are logged via
    ``os.write(2, ...)`` because the python logger is not safe across
    fork — but they never abort the child; exec proceeds with reduced
    hardening rather than refusing to stream).

    1. ``setsid()`` — detaches the child from the parent's process group.
       Without this, a SIGTERM/SIGINT delivered to the backend (e.g. by
       systemd or by Ctrl-C) is broadcast to every running ffmpeg child,
       killing every live stream simultaneously. With ``setsid`` the
       child has its own session/pgid; the only signals it receives are
       the ones we deliver ourselves on graceful stop.

       Note on stop semantics: ``stop_stream`` currently sends ``SIGINT``
       to the leader PID (which equals the new session/pgid leader since
       only ffmpeg lives in this session) and falls back to SIGKILL on
       timeout. ffmpeg traps SIGINT for clean shutdown, so this works.
       We do NOT broadcast via ``killpg`` — there are no fork-children of
       ffmpeg in our use case, and a future version that spawns helpers
       can revisit. The sole purpose of ``setsid`` here is to *isolate
       inbound* signals, not to require pgid-scoped outbound delivery.

    2. ``prctl(PR_SET_DUMPABLE, 0)`` — Linux-only. Marks the process as
       non-dumpable, which causes ``/proc/<pid>/cmdline`` (and many other
       /proc/<pid>/* files) to become readable only by the same euid and
       root. Other tenants on a shared box, ``ps auxww`` collected by
       ops tooling under a different user, and accidental log scrapes
       under a non-owner UID no longer surface the RTMP URL with the
       embedded stream key. Same-euid readers (the backend's own service
       account) still see the URL — defence is against *cross-tenant*
       reads, not against on-host ops queries by the running user.

    3. ``prctl(PR_SET_PDEATHSIG, SIGTERM)`` — if the backend's process
       (the parent) dies, the kernel delivers SIGTERM to this child,
       preventing orphan ffmpeg processes after a backend crash.
    """
    try:
        os.setsid()
    except OSError:
        # Already a session leader, or not supported. Continue.
        pass

    libc = _load_libc()
    if libc is None:
        return
    try:
        # int prctl(int option, unsigned long arg2, ...);
        if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
            os.write(2, b"_harden_ffmpeg_child: prctl(PR_SET_DUMPABLE, 0) failed\n")
        # PR_SET_PDEATHSIG=SIGTERM — if the backend dies, the kernel
        # delivers SIGTERM to this child. Combined with setsid, this gives
        # us a clean shutdown story without leaving orphan ffmpegs.
        if libc.prctl(_PR_SET_PDEATHSIG, signal.SIGTERM, 0, 0, 0) != 0:
            os.write(2, b"_harden_ffmpeg_child: prctl(PR_SET_PDEATHSIG) failed\n")
    except (OSError, AttributeError):
        # libc lookup or prctl call failed — non-fatal.
        pass


def _redact_rtmp_uri(uri: str) -> str:
    """Return ``uri`` with the trailing path segment replaced by ``<redacted>``.

    The trailing segment is the stream key for both RTMP and RTMPS targets;
    masking it prevents accidental disclosure when log lines containing the
    full URL are forwarded to crash dumps, error pages, or third-party
    monitoring backends.
    """
    try:
        parts = urlsplit(uri)
    except Exception:
        return uri

    if parts.scheme.lower() not in {"rtmp", "rtmps"}:
        return uri

    path = parts.path or ""
    if not path or path == "/":
        return uri

    segments = path.split("/")
    if len(segments) >= 2:
        segments[-1] = "<redacted>"
    redacted_path = "/".join(segments)

    return urlunsplit(
        (parts.scheme, parts.netloc, redacted_path, parts.query, parts.fragment)
    )


def _redact_rtmp_text(value: str) -> str:
    """Scan ``value`` for embedded RTMP/RTMPS URLs and redact each one.

    Used to scrub multi-URL log lines (e.g. tee outputs) before they
    reach metrics, alerts, or any payload that could leave the host.
    """
    if not value:
        return value

    def _replace(match: re.Match[str]) -> str:
        return _redact_rtmp_uri(match.group(0))

    return _RTMP_URL_PATTERN.sub(_replace, value)


def _has_remote_output_reset_evidence(recent_errors: List[str]) -> bool:
    """True if any recent stderr line matches a remote-disconnect marker."""
    for line in recent_errors:
        lowered = str(line).lower()
        if any(
            marker in lowered for marker in runtime_signals.REMOTE_OUTPUT_RESET_MARKERS
        ):
            return True
    return False


def _build_stream_failure_message(returncode: int, recent_errors: List[str]) -> str:
    """Compact, redacted summary persisted on terminal stream failures.

    Constraints:
      * length <= 500 chars (DB column limit)
      * any RTMP URL is redacted before inclusion
      * remote-output disconnect evidence gets a distinguishing prefix
        so dashboard heuristics can route it differently from generic
        encoder failures.
    """
    snippet = "; ".join(
        _redact_rtmp_text(str(line).strip())
        for line in recent_errors[-3:]
        if str(line).strip()
    )
    if snippet and len(snippet) > 500:
        snippet = f"{snippet[:497]}..."

    base_message = f"FFmpeg exited with code {returncode}."
    if snippet:
        base_message = f"{base_message} Last errors: {snippet}"

    if _has_remote_output_reset_evidence(recent_errors):
        return (
            "Remote output disconnect evidence detected in FFmpeg logs. "
            f"{base_message}"
        )[:500]

    return base_message[:500]


def _line_matches_markers(line: str, markers: Tuple[str, ...]) -> bool:
    """Case-insensitive check whether ``line`` contains any of ``markers``."""
    lowered = line.lower()
    return any(marker in lowered for marker in markers)
