"""Helpers to manage Supervisor-based stream processes automatically."""

from __future__ import annotations

import asyncio
import shutil
import shlex
import sys
from asyncio.subprocess import PIPE
from pathlib import Path
from typing import Dict, Tuple, Optional
import time
from uuid import UUID

from app.core.config import settings
from app.core.stream_runtime_heartbeat import clear_runtime_heartbeat


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DOCKER_BACKEND_ROOT = Path("/app")


def supervisor_enabled() -> bool:
    return settings.stream_runtime_mode == "supervisor"


def get_supervisor_config_dir() -> Path:
    return _config_dir()


def get_supervisor_log_dir() -> Path:
    return _log_dir()


def get_supervisor_conf_path() -> Path:
    return _supervisor_conf()


def decode_program_name(name: str) -> Optional[str]:
    template = settings.supervisor_program_template
    if "{stream_id}" not in template:
        return None
    before, after = template.split("{stream_id}")
    if not name.startswith(before):
        return None
    if after and not name.endswith(after):
        return None
    core = name[len(before) :] if not after else name[len(before) : -len(after)]
    return core or None


def program_name(stream_id: UUID | str) -> str:
    return settings.supervisor_program_template.format(stream_id=stream_id)


def _resolve_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = BACKEND_ROOT / candidate
    return candidate


def _config_dir() -> Path:
    return _resolve_path(settings.supervisor_config_dir)


def _log_dir() -> Path:
    return _resolve_path(settings.supervisor_log_dir)


def _supervisor_conf() -> Path:
    return _resolve_path(settings.supervisor_conf_path)


def _using_host_docker_supervisor() -> bool:
    return _supervisor_conf().name == "supervisord.host-docker.conf"


def _runtime_visible_path(path: Path) -> Path:
    if not _using_host_docker_supervisor():
        return path

    try:
        relative = path.relative_to(BACKEND_ROOT)
    except ValueError:
        if path.is_absolute():
            return path
        return DOCKER_BACKEND_ROOT / path
    return DOCKER_BACKEND_ROOT / relative


def _program_config_path(stream_id: UUID | str) -> Path:
    return _config_dir() / f"{program_name(stream_id)}.ini"


def _supervisorctl_command() -> Tuple[str, ...]:
    raw_path = settings.supervisor_ctl_path.strip()
    if not raw_path:
        raise RuntimeError("SUPERVISOR_CTL_PATH is empty")

    if raw_path == "supervisorctl":
        sibling = Path(sys.executable).with_name("supervisorctl")
        if sibling.exists():
            return (str(sibling),)

        discovered = shutil.which("supervisorctl")
        if discovered:
            return (discovered,)

        return (sys.executable, "-m", "supervisor.supervisorctl")

    if " " in raw_path:
        return tuple(shlex.split(raw_path))

    return (raw_path,)


async def _run_supervisorctl(*args: str) -> Tuple[int, str, str]:
    command = _supervisorctl_command()
    process = await asyncio.create_subprocess_exec(
        *command,
        "-c",
        str(_supervisor_conf()),
        *args,
        stdout=PIPE,
        stderr=PIPE,
    )
    stdout, stderr = await process.communicate()
    return (
        process.returncode if process.returncode is not None else 1,
        stdout.decode().strip(),
        stderr.decode().strip(),
    )


def _build_error(action: str, program: str, stdout: str, stderr: str) -> RuntimeError:
    message = stderr or stdout or f"supervisorctl {action} {program} failed"
    return RuntimeError(message)


async def _write_program_config(stream_id: UUID) -> Path:
    cfg_path = _program_config_path(stream_id)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    log_dir = _log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)

    program = program_name(stream_id)
    runtime_root = (
        DOCKER_BACKEND_ROOT if _using_host_docker_supervisor() else BACKEND_ROOT
    )
    runtime_python = "python" if _using_host_docker_supervisor() else sys.executable
    stdout_log = _runtime_visible_path(log_dir / f"{program}.log")
    stderr_log = _runtime_visible_path(log_dir / f"{program}.err")
    command = f"{runtime_python} -m app.cli.run_stream {stream_id}"

    config_text = """
[program:{program}]
directory={directory}
command={command}
autostart=true
autorestart=true
startsecs=5
stopwaitsecs=20
stdout_logfile={stdout}
stderr_logfile={stderr}
environment=PYTHONPATH="{py_path}"
""".strip().format(
        program=program,
        directory=runtime_root,
        command=command,
        stdout=stdout_log,
        stderr=stderr_log,
        py_path=runtime_root,
    )

    cfg_path.write_text(config_text + "\n")
    await asyncio.sleep(0.1)
    return cfg_path


async def _wait_for_state(
    stream_id: UUID | str, desired: str = "RUNNING", timeout: float = 10.0
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() <= deadline:
        status = await program_status(stream_id)
        state = status.get("state", "UNKNOWN")
        if state == desired:
            return
        if state in {"FATAL", "BACKOFF", "EXITED", "UNKNOWN", "ERROR"}:
            details = status.get("details") or status.get("error", "")
            raise RuntimeError(
                f"Supervisor program {program_name(stream_id)} failed to reach {desired}: {state} {details or ''}"
            )
        await asyncio.sleep(0.5)
    raise RuntimeError(
        f"Timed out waiting for supervisor program {program_name(stream_id)} to reach state {desired}"
    )


async def _reread() -> None:
    code, out, err = await _run_supervisorctl("reread")
    if code != 0:
        raise RuntimeError(err or out or "supervisorctl reread failed")


async def _update(program: str) -> None:
    code, out, err = await _run_supervisorctl("update", program)
    if code != 0:
        raise _build_error("update", program, out, err)


async def start_program(stream_id: UUID) -> None:
    program = program_name(stream_id)
    await _write_program_config(stream_id)
    await _reread()
    await _update(program)
    code, out, err = await _run_supervisorctl("start", program)
    if code != 0:
        raise _build_error("start", program, out, err)
    await _wait_for_state(stream_id)


async def stop_program(stream_id: UUID) -> None:
    program = program_name(stream_id)
    code, out, err = await _run_supervisorctl("stop", program)
    combined = f"{out}\n{err}".lower()
    benign = (
        "not_running" in combined
        or "removed process group" in combined
        or "no such process" in combined
    )
    if code != 0 and not benign:
        raise _build_error("stop", program, out, err)


async def restart_program(stream_id: UUID) -> None:
    program = program_name(stream_id)
    await _write_program_config(stream_id)
    await _reread()
    await _update(program)
    code, out, err = await _run_supervisorctl("restart", program)
    if code != 0:
        raise _build_error("restart", program, out, err)
    await _wait_for_state(stream_id)


async def remove_program(stream_id: UUID) -> None:
    """Remove a supervisor program and its config. Safe to call even if program doesn't exist."""
    program = program_name(stream_id)

    # Try to stop, but don't fail if already stopped or not found
    await _run_supervisorctl("stop", program)

    # Try to remove, but don't fail if program doesn't exist
    code, out, err = await _run_supervisorctl("remove", program)
    combined_output = out + err

    # These are OK states - program already removed or never existed
    if code != 0 and not any(
        status in combined_output
        for status in ["UNKNOWN", "FileNotFoundError", "no such file"]
    ):
        raise _build_error("remove", program, out, err)

    # Remove config file if exists
    cfg_path = _program_config_path(stream_id)
    cfg_path.unlink(missing_ok=True)
    clear_runtime_heartbeat(stream_id)

    # Reread configs
    await _reread()


async def is_running(stream_id: UUID | str) -> bool:
    status = await program_status(stream_id)
    return status.get("state") == "RUNNING"


async def program_status(stream_id: UUID | str) -> Dict[str, str]:
    program = program_name(stream_id)
    code, out, err = await _run_supervisorctl("status", program)
    if code != 0:
        combined = "\n".join(
            [part for part in [out.strip(), err.strip()] if part]
        ).strip()
        message = combined or (err or out).strip()
        lowered = (combined or message).lower()

        if any(
            token in lowered
            for token in ["no such process", "not found", "no such file"]
        ):
            state = "NOT_FOUND"
        elif "connection refused" in lowered or "refused connection" in lowered:
            state = "SUPERVISOR_UNAVAILABLE"
        elif "unix" in lowered and "permission" in lowered:
            state = "PERMISSION_DENIED"
        else:
            state = "UNKNOWN"

        # Provide a stable field for reconciliation logs
        details = message or "supervisorctl status failed"
        return {"state": state, "error": details}

    line = (out.splitlines() or [""])[0]
    parts = line.split(None, 2)
    state = parts[1] if len(parts) > 1 else "UNKNOWN"
    extra = parts[2] if len(parts) > 2 else ""
    return {"state": state, "details": extra}
