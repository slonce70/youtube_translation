import subprocess
from pathlib import Path


def _rollback_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "rollback_host_runtime.sh"


def test_rollback_script_refuses_non_systemd_runtime(tmp_path) -> None:
    script = _rollback_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=supervisor\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "ROLLBACK_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
        },
    )

    assert result.returncode != 0
    assert "STREAM_RUNTIME_MODE must currently be systemd" in result.stderr


def test_rollback_script_dry_run_blocks_live_stream_rollback_without_override(tmp_path) -> None:
    script = _rollback_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "ROLLBACK_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
            "ROLLBACK_ACTIVE_STREAMS_OVERRIDE": "1",
        },
    )

    assert result.returncode != 0
    assert "ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=1" in result.stderr


def test_rollback_script_dry_run_prints_expected_commands_with_override(tmp_path) -> None:
    script = _rollback_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "ROLLBACK_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
            "ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK": "1",
            "ROLLBACK_RUNTIME_MODE_OVERRIDE": "systemd",
            "HOST_STREAM_UNIT_NAME": "test-stream",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "[dry-run] systemctl disable --now youtube-backend" in result.stdout
    assert "[dry-run] systemctl disable --now ffmpeg@test-stream" in result.stdout
    assert "[dry-run] env STREAM_RUNTIME_MODE=supervisor" in result.stdout
    assert "FRONTEND_API_PROXY_TARGET=http://backend:8000" in result.stdout
    assert "TUSD_BACKEND_URL=http://backend:8000" in result.stdout
