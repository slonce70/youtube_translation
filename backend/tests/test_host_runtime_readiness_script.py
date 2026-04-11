import getpass
import subprocess
from pathlib import Path


def _readiness_script_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / "check_host_runtime_readiness.sh"
    )


def test_readiness_script_reports_missing_runtime_bits_with_stubbed_tools(
    tmp_path,
) -> None:
    script = _readiness_script_path()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()

    docker_script = fake_bin / "docker"
    docker_script.write_text(
        """#!/usr/bin/env bash
if [[ "$1" == "ps" ]]; then
  echo youtube-streaming-postgres
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  echo running
  exit 0
fi
if [[ "$1" == "exec" ]]; then
  echo 0
  exit 0
fi
exit 0
""",
        encoding="utf-8",
    )
    docker_script.chmod(0o755)

    systemctl_script = fake_bin / "systemctl"
    systemctl_script.write_text(
        """#!/usr/bin/env bash
if [[ "$1" == "is-enabled" ]]; then
  echo disabled
  exit 0
fi
if [[ "$1" == "is-active" ]]; then
  echo inactive
  exit 0
fi
exit 0
""",
        encoding="utf-8",
    )
    systemctl_script.chmod(0o755)

    ss_script = fake_bin / "ss"
    ss_script.write_text(
        """#!/usr/bin/env bash
cat <<'EOF'
LISTEN 0 4096 127.0.0.1:8000 0.0.0.0:*
LISTEN 0 4096 127.0.0.1:9001 0.0.0.0:*
EOF
""",
        encoding="utf-8",
    )
    ss_script.chmod(0o755)

    install_root = tmp_path / "install-root"
    install_root.mkdir()
    target_dir = tmp_path / "systemd"
    target_dir.mkdir()
    (target_dir / "ffmpeg@.service").write_text("[Service]\n", encoding="utf-8")
    (target_dir / "streaming.slice").write_text("[Slice]\n", encoding="utf-8")
    (target_dir / "youtube-backend.service").write_text("[Service]\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "SYSTEMD_INSTALL_ROOT": str(install_root),
            "SYSTEMD_TARGET_DIR": str(target_dir),
            "SYSTEMD_SERVICE_USER": getpass.getuser(),
        },
    )

    assert result.returncode == 0, result.stderr
    assert f"install_root={install_root}" in result.stdout
    assert f"host_service_user={getpass.getuser()}" in result.stdout
    assert "host_service_user_exists=present" in result.stdout
    assert "active_runtime_streams=0" in result.stdout
    assert "docker_backend=running" in result.stdout
    assert "docker_runner=running" in result.stdout
    assert "host_backend_unit=disabled/inactive" in result.stdout
    assert "ffmpeg_template_unit=present" in result.stdout
    assert "streaming_slice=present" in result.stdout
    assert "host_backend_unit_file=present" in result.stdout
    assert "host_backend_python_backend=missing" in result.stdout
    assert "host_backend_python_repo=missing" in result.stdout
    assert "host_backend_python=missing" in result.stdout
    assert "host_backend_uvicorn_backend=missing" in result.stdout
    assert "host_backend_uvicorn_repo=missing" in result.stdout
    assert "host_backend_uvicorn=missing" in result.stdout
    assert "host_service_user_systemctl=allowed" in result.stdout
    assert "host_loopback_postgres=missing" in result.stdout
    assert "host_loopback_redis=missing" in result.stdout
    assert "host_loopback_backend=present" in result.stdout
    assert "host_loopback_runner=present" in result.stdout


def test_readiness_script_reports_missing_service_user(tmp_path) -> None:
    script = _readiness_script_path()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()

    docker_script = fake_bin / "docker"
    docker_script.write_text(
        """#!/usr/bin/env bash
if [[ "$1" == "ps" ]]; then
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  echo exited
  exit 0
fi
exit 0
""",
        encoding="utf-8",
    )
    docker_script.chmod(0o755)

    systemctl_script = fake_bin / "systemctl"
    systemctl_script.write_text(
        """#!/usr/bin/env bash
if [[ "$1" == "is-enabled" ]]; then
  echo disabled
  exit 0
fi
if [[ "$1" == "is-active" ]]; then
  echo inactive
  exit 0
fi
exit 0
""",
        encoding="utf-8",
    )
    systemctl_script.chmod(0o755)

    ss_script = fake_bin / "ss"
    ss_script.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    ss_script.chmod(0o755)

    id_script = fake_bin / "id"
    id_script.write_text(
        """#!/usr/bin/env bash
if [[ "$1" == "missingbot" ]]; then
  exit 1
fi
exec /usr/bin/id "$@"
""",
        encoding="utf-8",
    )
    id_script.chmod(0o755)

    target_dir = tmp_path / "systemd"
    target_dir.mkdir()
    (target_dir / "ffmpeg@.service").write_text("[Service]\n", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "SYSTEMD_INSTALL_ROOT": str(tmp_path / "install-root"),
            "SYSTEMD_TARGET_DIR": str(target_dir),
            "SYSTEMD_SERVICE_USER": "missingbot",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "host_service_user=missingbot" in result.stdout
    assert "host_service_user_exists=missing" in result.stdout
    assert "host_service_user_systemctl=unknown:user_missing" in result.stdout
