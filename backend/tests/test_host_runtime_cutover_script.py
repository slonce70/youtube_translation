import subprocess
from pathlib import Path


def _cutover_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "cutover_host_runtime.sh"


def test_cutover_script_refuses_non_systemd_runtime(tmp_path) -> None:
    script = _cutover_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=manager\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "CUTOVER_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
        },
    )

    assert result.returncode != 0
    assert "STREAM_RUNTIME_MODE must be systemd" in result.stderr


def test_cutover_script_dry_run_blocks_live_stream_cutover_without_override(tmp_path) -> None:
    script = _cutover_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "CUTOVER_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
            "CUTOVER_ACTIVE_STREAMS_OVERRIDE": "1",
        },
    )

    assert result.returncode != 0
    assert "ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=1" in result.stderr


def test_cutover_script_dry_run_prints_expected_commands_with_override(tmp_path) -> None:
    script = _cutover_script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "CUTOVER_DRY_RUN": "1",
            "POSTGRES_PASSWORD": "test",
            "BACKEND_ENV": str(backend_env),
            "ROOT_ENV": str(tmp_path / "missing-root.env"),
            "ALLOW_LIVE_STREAM_RUNTIME_CUTOVER": "1",
            "CUTOVER_RUNTIME_MODE_OVERRIDE": "systemd",
            "HOST_STREAM_UNIT_NAME": "test-stream",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "[dry-run] verify host loopback ports 5432 and 6379 are present" in result.stdout
    assert "[dry-run] stop container youtube-streaming-backend if running" in result.stdout
    assert "[dry-run] systemctl daemon-reload" in result.stdout
    assert "[dry-run] systemctl enable --now youtube-backend" in result.stdout
    assert "[dry-run] systemctl enable --now ffmpeg@test-stream" in result.stdout
    assert "[dry-run] env FRONTEND_API_PROXY_TARGET=http://host.docker.internal:8000 TUSD_BACKEND_URL=http://host.docker.internal:8000" in result.stdout
