import shutil
import subprocess
from pathlib import Path


def _wrapper_source_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "run_stream_systemd.sh"


def _install_wrapper(tmp_path: Path) -> tuple[Path, Path, Path]:
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "scripts"
    backend_dir = repo_root / "backend"
    scripts_dir.mkdir(parents=True)
    backend_dir.mkdir(parents=True)
    wrapper_path = scripts_dir / "run_stream_systemd.sh"
    shutil.copy2(_wrapper_source_path(), wrapper_path)
    wrapper_path.chmod(0o755)
    return repo_root, backend_dir, wrapper_path


def _write_fake_python(binary_path: Path, invocation_log: Path) -> None:
    binary_path.parent.mkdir(parents=True, exist_ok=True)
    binary_path.write_text(
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "-V" ]]; then
  echo "Python 3.12.0"
  exit 0
fi
printf '%s\\n' "$*" >>"{invocation_log}"
if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "app.cli.run_stream" ]]; then
  exit 0
fi
echo "unexpected args: $*" >&2
exit 1
""",
        encoding="utf-8",
    )
    binary_path.chmod(0o755)


def test_wrapper_prefers_backend_venv_when_present(tmp_path) -> None:
    _, backend_dir, wrapper_path = _install_wrapper(tmp_path)
    log_dir = tmp_path / "logs"
    invocation_log = tmp_path / "backend-python.log"
    backend_python = backend_dir / ".venv" / "bin" / "python3"
    _write_fake_python(backend_python, invocation_log)

    result = subprocess.run(
        ["bash", str(wrapper_path), "stream-123"],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "SYSTEMD_BACKEND_DIR": str(backend_dir),
            "SYSTEMD_LOG_DIR": str(log_dir),
        },
    )

    assert result.returncode == 0, result.stderr
    wrapper_log = (
        log_dir / "systemd-run-stream-stream-123.log"
    ).read_text(encoding="utf-8")
    assert f"resolved_python={backend_python}" in wrapper_log
    assert "-m app.cli.run_stream stream-123" in invocation_log.read_text(
        encoding="utf-8"
    )


def test_wrapper_falls_back_to_repo_root_venv(tmp_path) -> None:
    repo_root, backend_dir, wrapper_path = _install_wrapper(tmp_path)
    log_dir = tmp_path / "logs"
    invocation_log = tmp_path / "repo-python.log"
    repo_python = repo_root / ".venv" / "bin" / "python3.12"
    _write_fake_python(repo_python, invocation_log)

    result = subprocess.run(
        ["bash", str(wrapper_path), "stream-456"],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "SYSTEMD_BACKEND_DIR": str(backend_dir),
            "SYSTEMD_LOG_DIR": str(log_dir),
        },
    )

    assert result.returncode == 0, result.stderr
    wrapper_log = (
        log_dir / "systemd-run-stream-stream-456.log"
    ).read_text(encoding="utf-8")
    assert f"resolved_python={repo_python}" in wrapper_log
    assert "-m app.cli.run_stream stream-456" in invocation_log.read_text(
        encoding="utf-8"
    )
