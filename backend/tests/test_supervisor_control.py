from pathlib import Path
from uuid import uuid4

import pytest

from app.core import supervisor_control


@pytest.mark.asyncio
async def test_start_program_accepts_successful_reread_available_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_id = uuid4()
    calls: list[tuple[str, ...]] = []

    async def fake_run_supervisorctl(*args: str) -> tuple[int, str, str]:
        calls.append(args)
        if args == ("reread",):
            return 0, f"{supervisor_control.program_name(stream_id)}: available", ""
        if args == ("update", supervisor_control.program_name(stream_id)):
            return (
                0,
                f"{supervisor_control.program_name(stream_id)}: added process group",
                "",
            )
        if args == ("start", supervisor_control.program_name(stream_id)):
            return 0, f"{supervisor_control.program_name(stream_id)}: started", ""
        raise AssertionError(f"unexpected supervisorctl args: {args}")

    async def fake_write_program_config(_stream_id) -> Path:
        return Path("/tmp/unused.ini")

    waited_for: list[str] = []

    async def fake_wait_for_state(_stream_id, desired: str = "RUNNING", timeout: float = 10.0) -> None:
        waited_for.append(desired)

    monkeypatch.setattr(supervisor_control, "_run_supervisorctl", fake_run_supervisorctl)
    monkeypatch.setattr(
        supervisor_control, "_write_program_config", fake_write_program_config
    )
    monkeypatch.setattr(supervisor_control, "_wait_for_state", fake_wait_for_state)

    await supervisor_control.start_program(stream_id)

    assert calls == [
        ("reread",),
        ("update", supervisor_control.program_name(stream_id)),
        ("start", supervisor_control.program_name(stream_id)),
    ]
    assert waited_for == ["RUNNING"]


@pytest.mark.asyncio
async def test_restart_program_accepts_successful_reread_available_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_id = uuid4()
    calls: list[tuple[str, ...]] = []

    async def fake_run_supervisorctl(*args: str) -> tuple[int, str, str]:
        calls.append(args)
        if args == ("reread",):
            return 0, f"{supervisor_control.program_name(stream_id)}: available", ""
        if args == ("update", supervisor_control.program_name(stream_id)):
            return (
                0,
                f"{supervisor_control.program_name(stream_id)}: added process group",
                "",
            )
        if args == ("restart", supervisor_control.program_name(stream_id)):
            return 0, f"{supervisor_control.program_name(stream_id)}: restarted", ""
        raise AssertionError(f"unexpected supervisorctl args: {args}")

    async def fake_write_program_config(_stream_id) -> Path:
        return Path("/tmp/unused.ini")

    waited_for: list[str] = []

    async def fake_wait_for_state(_stream_id, desired: str = "RUNNING", timeout: float = 10.0) -> None:
        waited_for.append(desired)

    monkeypatch.setattr(supervisor_control, "_run_supervisorctl", fake_run_supervisorctl)
    monkeypatch.setattr(
        supervisor_control, "_write_program_config", fake_write_program_config
    )
    monkeypatch.setattr(supervisor_control, "_wait_for_state", fake_wait_for_state)

    await supervisor_control.restart_program(stream_id)

    assert calls == [
        ("reread",),
        ("update", supervisor_control.program_name(stream_id)),
        ("restart", supervisor_control.program_name(stream_id)),
    ]
    assert waited_for == ["RUNNING"]


@pytest.mark.asyncio
async def test_stop_program_ignores_removed_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_id = uuid4()

    async def fake_run_supervisorctl(*args: str) -> tuple[int, str, str]:
        assert args == ("stop", supervisor_control.program_name(stream_id))
        return 1, "", f"{supervisor_control.program_name(stream_id)}: removed process group"

    monkeypatch.setattr(supervisor_control, "_run_supervisorctl", fake_run_supervisorctl)

    await supervisor_control.stop_program(stream_id)


@pytest.mark.asyncio
async def test_write_program_config_uses_container_visible_paths_for_host_docker_supervisor(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    stream_id = uuid4()
    cfg_path = tmp_path / "stream.ini"

    monkeypatch.setattr(
        supervisor_control.settings,
        "supervisor_conf_path",
        str(tmp_path / "supervisord.host-docker.conf"),
    )
    monkeypatch.setattr(
        supervisor_control,
        "_program_config_path",
        lambda _stream_id: cfg_path,
    )
    monkeypatch.setattr(
        supervisor_control,
        "_log_dir",
        lambda: supervisor_control.BACKEND_ROOT / "supervisord/logs",
    )

    await supervisor_control._write_program_config(stream_id)

    config_text = cfg_path.read_text(encoding="utf-8")
    program = supervisor_control.program_name(stream_id)
    assert "directory=/app" in config_text
    assert f"command=python -m app.cli.run_stream {stream_id}" in config_text
    assert "autorestart=unexpected" in config_text
    assert "exitcodes=0" in config_text
    assert f"stdout_logfile=/app/supervisord/logs/{program}.log" in config_text
    assert f"stderr_logfile=/app/supervisord/logs/{program}.err" in config_text
    assert 'environment=PYTHONPATH="/app"' in config_text


def test_supervisorctl_command_prefers_sibling_binary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_bin_dir = tmp_path / "bin"
    fake_bin_dir.mkdir(parents=True)
    fake_python = fake_bin_dir / "python"
    fake_supervisorctl = fake_bin_dir / "supervisorctl"
    fake_python.write_text("", encoding="utf-8")
    fake_supervisorctl.write_text("", encoding="utf-8")

    monkeypatch.setattr(supervisor_control.settings, "supervisor_ctl_path", "supervisorctl")
    monkeypatch.setattr(supervisor_control.sys, "executable", str(fake_python))
    monkeypatch.setattr(supervisor_control.shutil, "which", lambda _name: None)

    assert supervisor_control._supervisorctl_command() == (str(fake_supervisorctl),)


def test_strip_supervisor_warnings_removes_pkg_resources_noise() -> None:
    noisy_output = "\n".join(
        [
            "/tmp/site-packages/supervisor/options.py:13: UserWarning: pkg_resources is deprecated as an API.",
            "  import pkg_resources",
            "stream_123 FATAL Exited too quickly (process log may have details)",
        ]
    )

    assert supervisor_control._strip_supervisor_warnings(noisy_output) == (
        "stream_123 FATAL Exited too quickly (process log may have details)"
    )
