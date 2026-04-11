import subprocess
from pathlib import Path


def _script_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / "provision_host_native_backend_venv.sh"
    )


def test_provision_host_native_backend_venv_creates_and_syncs_venv(tmp_path) -> None:
    script = _script_path()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    log_file = tmp_path / "python.log"

    fake_python = fake_bin / "python3"
    fake_python.write_text(
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "venv" ]]; then
  venv_dir="${{3:?missing venv dir}}"
  mkdir -p "$venv_dir/bin"
  cat >"$venv_dir/bin/python" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"{log_file}"
exit 0
EOF
  chmod +x "$venv_dir/bin/python"
  printf 'bootstrap:%s\\n' "$venv_dir" >>"{log_file}"
  exit 0
fi
printf '%s\\n' "$*" >>"{log_file}"
exit 0
""",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)

    backend_dir = tmp_path / "install-root" / "backend"
    backend_dir.mkdir(parents=True)
    (backend_dir / "requirements.txt").write_text("", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "SYSTEMD_INSTALL_ROOT": str(tmp_path / "install-root"),
            "HOST_BACKEND_BOOTSTRAP_PYTHON": "python3",
        },
    )

    assert result.returncode == 0, result.stderr
    assert (
        f"host_backend_venv={backend_dir / '.venv'}" in result.stdout
    )

    logged = log_file.read_text(encoding="utf-8")
    assert f"bootstrap:{backend_dir / '.venv'}" in logged
    assert "-m pip install -U pip wheel" in logged
    assert f"-m pip install -r {backend_dir / 'requirements.txt'}" in logged
