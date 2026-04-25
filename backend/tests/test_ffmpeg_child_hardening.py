"""Tests for ``streaming/ffmpeg_manager._harden_ffmpeg_child`` (Sprint 2 H5+H2).

The hardening function runs in the forked child *before* exec(ffmpeg) and
performs three security-critical syscalls. We can't observe the syscalls
post-exec from the parent test process, so the test surface is:

* Smoke: the function is callable and idempotent (failures non-fatal).
* On Linux it actually invokes ``setsid`` + ``prctl``; we monkey-patch
  ``_load_libc`` to record the calls without forking.
* Cross-platform: on non-Linux ``_load_libc`` returns None and the
  function is a no-op (still must not raise).

A separate (manual) integration test under ``soak`` would actually fork
ffmpeg and observe ``/proc/<pid>/cmdline`` from a non-owner UID — that
is out of scope for unit tests.
"""
from __future__ import annotations

import signal
import sys
from unittest.mock import MagicMock, patch

import pytest

from app.streaming.ffmpeg_manager import (
    _PR_SET_DUMPABLE,
    _PR_SET_PDEATHSIG,
    _harden_ffmpeg_child,
)


def test_harden_is_callable_without_failure() -> None:
    """Function must execute cleanly even when libc is unavailable.

    The contract is "best-effort hardening, never abort the child", so
    every failure path inside the function must be swallowed.
    """
    _harden_ffmpeg_child()  # Should not raise.


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux-only syscalls")
def test_harden_invokes_setsid_and_prctl_on_linux() -> None:
    """On Linux, _harden_ffmpeg_child must call setsid + prctl(DUMPABLE,0) + prctl(PDEATHSIG)."""
    fake_libc = MagicMock()
    fake_libc.prctl.return_value = 0  # success

    with patch("app.streaming.ffmpeg_manager._load_libc", return_value=fake_libc), patch(
        "os.setsid"
    ) as fake_setsid:
        _harden_ffmpeg_child()

    assert fake_setsid.called, "setsid() must be invoked to detach process group"
    # Two prctl calls: PR_SET_DUMPABLE then PR_SET_PDEATHSIG.
    assert fake_libc.prctl.call_count >= 2
    call_args = [call.args for call in fake_libc.prctl.call_args_list]
    assert call_args[0][:2] == (_PR_SET_DUMPABLE, 0), (
        "first prctl must be PR_SET_DUMPABLE(0) so /proc/<pid>/cmdline becomes non-readable for other users"
    )
    assert call_args[1][:2] == (_PR_SET_PDEATHSIG, signal.SIGTERM), (
        "second prctl must be PR_SET_PDEATHSIG(SIGTERM) so children die with parent"
    )


def test_harden_swallows_setsid_failure() -> None:
    """OSError from setsid (e.g. already a session leader) must not propagate."""
    with patch("os.setsid", side_effect=OSError("already a session leader")), patch(
        "app.streaming.ffmpeg_manager._load_libc", return_value=None
    ):
        _harden_ffmpeg_child()  # Must not raise.


def test_harden_swallows_libc_unavailable() -> None:
    """When libc cannot be loaded (e.g. macOS), the function must still return cleanly."""
    with patch("app.streaming.ffmpeg_manager._load_libc", return_value=None), patch(
        "os.setsid"
    ):
        _harden_ffmpeg_child()  # Must not raise.


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux-only syscalls")
def test_harden_continues_when_prctl_returns_error() -> None:
    """prctl returning non-zero is logged via os.write but does not raise."""
    fake_libc = MagicMock()
    fake_libc.prctl.return_value = -1  # failure

    with patch("app.streaming.ffmpeg_manager._load_libc", return_value=fake_libc), patch(
        "os.setsid"
    ), patch("os.write") as fake_write:
        _harden_ffmpeg_child()

    # We expect at least one os.write call carrying the failure notice.
    assert fake_write.called
