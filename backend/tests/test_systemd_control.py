from uuid import uuid4

import pytest

from app.core import systemd_control


class _FakeProcess:
    def __init__(self, returncode: int, stdout: bytes = b"", stderr: bytes = b""):
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr

    async def communicate(self):
        return self._stdout, self._stderr


@pytest.mark.asyncio
async def test_run_systemctl_preserves_zero_return_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess(0, b"ok\n", b"")

    monkeypatch.setattr(
        systemd_control.asyncio,
        "create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    code, out, err = await systemd_control._run_systemctl("show", "ffmpeg@test")

    assert code == 0
    assert out == "ok"
    assert err == ""


@pytest.mark.asyncio
async def test_is_active_returns_true_on_zero_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_systemctl(*args: str):
        assert args == ("is-active", "--quiet", f"ffmpeg@{stream_id}")
        return 0, "", ""

    stream_id = uuid4()
    monkeypatch.setattr(systemd_control, "_run_systemctl", fake_run_systemctl)

    assert await systemd_control.is_active(stream_id) is True


@pytest.mark.asyncio
async def test_unit_status_parses_show_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_systemctl(*args: str):
        assert args == (
            "show",
            f"ffmpeg@{stream_id}",
            "--property=ActiveState,SubState,ExecMainPID,ExecMainStartTimestamp,ExecMainStatus",
        )
        return (
            0,
            "\n".join(
                [
                    "ActiveState=active",
                    "SubState=running",
                    "ExecMainPID=123",
                    "ExecMainStatus=0",
                ]
            ),
            "",
        )

    stream_id = uuid4()
    monkeypatch.setattr(systemd_control, "_run_systemctl", fake_run_systemctl)

    assert await systemd_control.unit_status(stream_id) == {
        "ActiveState": "active",
        "SubState": "running",
        "ExecMainPID": "123",
        "ExecMainStatus": "0",
    }
