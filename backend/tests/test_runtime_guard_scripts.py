import subprocess
from pathlib import Path


def _guard_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "runtime_guards.sh"


def test_containerized_systemd_runtime_guard_blocks_backend_and_runner() -> None:
    script = _guard_script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            f"source {script}; STREAM_RUNTIME_MODE=systemd guard_containerized_systemd_runtime 'frontend backend runner'",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "blocked by default" in result.stderr


def test_containerized_systemd_runtime_guard_allows_safe_service_subset() -> None:
    script = _guard_script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            f"source {script}; STREAM_RUNTIME_MODE=systemd guard_containerized_systemd_runtime 'frontend tusd mediamtx'",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0


def test_containerized_systemd_runtime_guard_respects_explicit_override() -> None:
    script = _guard_script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"source {script}; "
                "STREAM_RUNTIME_MODE=systemd "
                "ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=true "
                "guard_containerized_systemd_runtime 'backend runner'"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "bypassing containerized systemd runtime guard" in result.stdout


def test_containerized_systemd_runtime_guard_blocks_when_host_unit_exists() -> None:
    script = _guard_script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                "systemctl() { "
                "  if [[ \"$1\" == \"is-active\" ]]; then return 3; fi; "
                "  if [[ \"$1\" == \"cat\" ]]; then return 0; fi; "
                "  return 1; "
                "}; "
                f"source {script}; "
                "guard_containerized_systemd_runtime 'backend runner'"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "host-level systemd control plane" in result.stderr
