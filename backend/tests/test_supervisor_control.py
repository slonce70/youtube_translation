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
