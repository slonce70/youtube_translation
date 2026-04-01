"""Async helpers for controlling systemd-managed stream services."""

import asyncio
from asyncio.subprocess import PIPE
from typing import Dict, Tuple
from uuid import UUID

from app.core.config import settings


def systemd_enabled() -> bool:
    """Return True when stream runtime mode is configured for systemd."""
    return settings.stream_runtime_mode == "systemd"


def unit_name(stream_id: UUID) -> str:
    """Render the systemd unit name for a given stream."""
    return settings.systemd_unit_template.format(stream_id=stream_id)


async def _run_systemctl(*args: str) -> Tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        settings.systemctl_path,
        *args,
        stdout=PIPE,
        stderr=PIPE,
    )
    stdout, stderr = await process.communicate()
    return (process.returncode or 1), stdout.decode().strip(), stderr.decode().strip()


def _build_error(action: str, unit: str, stdout: str, stderr: str) -> RuntimeError:
    message = stderr or stdout or f"systemctl {action} {unit} failed"
    return RuntimeError(message)


async def start_unit(stream_id: UUID) -> None:
    unit = unit_name(stream_id)
    code, out, err = await _run_systemctl("start", unit)
    if code != 0:
        raise _build_error("start", unit, out, err)


async def stop_unit(stream_id: UUID) -> None:
    unit = unit_name(stream_id)
    code, out, err = await _run_systemctl("stop", unit)
    if code != 0:
        raise _build_error("stop", unit, out, err)


async def restart_unit(stream_id: UUID) -> None:
    unit = unit_name(stream_id)
    code, out, err = await _run_systemctl("restart", unit)
    if code != 0:
        raise _build_error("restart", unit, out, err)


async def is_active(stream_id: UUID) -> bool:
    unit = unit_name(stream_id)
    code, _, _ = await _run_systemctl("is-active", "--quiet", unit)
    return code == 0


async def unit_status(stream_id: UUID) -> Dict[str, str]:
    unit = unit_name(stream_id)
    code, out, _ = await _run_systemctl(
        "show",
        unit,
        "--property=ActiveState,SubState,ExecMainPID,ExecMainStartTimestamp,ExecMainStatus",
    )
    if code != 0:
        return {}

    info: Dict[str, str] = {}
    for line in out.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        info[key] = value
    return info
