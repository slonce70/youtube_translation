import subprocess
from pathlib import Path


def _installer_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "install_systemd_runtime.sh"


def test_install_systemd_runtime_renders_units_into_target_dir(tmp_path) -> None:
    script = _installer_script_path()
    target_dir = tmp_path / "systemd"
    polkit_dir = tmp_path / "polkit"
    install_root = tmp_path / "srv" / "youtube_translation"
    install_root.mkdir(parents=True)

    result = subprocess.run(
        [
            "bash",
            str(script),
        ],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": str(Path("/usr/bin")) + ":" + str(Path("/bin")),
            "SYSTEMD_TARGET_DIR": str(target_dir),
            "SYSTEMD_INSTALL_ROOT": str(install_root),
            "SYSTEMD_SERVICE_USER": "ytbot",
            "SYSTEMD_SERVICE_GROUP": "ytgrp",
            "SYSTEMD_ENSURE_SERVICE_ACCOUNT": "0",
            "SYSTEMD_INSTALL_POLKIT": "1",
            "SYSTEMD_POLKIT_RULES_DIR": str(polkit_dir),
            "SYSTEMD_SKIP_RELOAD": "1",
        },
    )

    assert result.returncode == 0, result.stderr
    assert (target_dir / "youtube-backend.service").exists()
    assert (target_dir / "ffmpeg@.service").exists()
    assert (target_dir / "streaming.slice").exists()

    backend_unit = (target_dir / "youtube-backend.service").read_text(encoding="utf-8")
    stream_unit = (target_dir / "ffmpeg@.service").read_text(encoding="utf-8")
    polkit_rule = (polkit_dir / "50-youtube-ffmpeg.rules").read_text(encoding="utf-8")
    stream_wrapper = install_root / "scripts" / "run_stream_systemd.sh"

    assert "/srv/youtube_translation/backend" in backend_unit
    assert f"{install_root}/backend/.venv/bin/uvicorn" in backend_unit
    assert '/bin/bash -lc' in backend_unit
    assert 'HOST_BACKEND_BIND_HOST:-0.0.0.0' in backend_unit
    assert 'HOST_BACKEND_PORT:-8000' in backend_unit
    assert "User=ytbot" in backend_unit
    assert "Group=ytgrp" in backend_unit

    assert "StartLimitBurst=5" in stream_unit
    assert "StartLimitIntervalSec=300" in stream_unit
    assert "RestartPreventExitStatus=10" in stream_unit
    assert f"/bin/bash {install_root}/scripts/run_stream_systemd.sh %i" in stream_unit
    assert "User=ytbot" in stream_unit
    assert "Group=ytgrp" in stream_unit

    assert 'subject.user !== "ytbot"' in polkit_rule
    assert "youtube-backend.service" in polkit_rule

    assert stream_wrapper.exists()
    wrapper_text = stream_wrapper.read_text(encoding="utf-8")
    assert 'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' in wrapper_text
    assert 'repo_root="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")/.." && /bin/pwd)"' in wrapper_text
    assert 'backend_dir="${SYSTEMD_BACKEND_DIR:-$repo_root/backend}"' in wrapper_text
    assert 'backend_venv_dir="${SYSTEMD_BACKEND_VENV_DIR:-$backend_dir/.venv}"' in wrapper_text
    assert 'repo_venv_dir="${SYSTEMD_REPO_VENV_DIR:-$repo_root/.venv}"' in wrapper_text
    assert 'preferred_python="${SYSTEMD_PYTHON_BIN:-}"' in wrapper_text


def test_install_systemd_runtime_provisions_missing_service_account(tmp_path) -> None:
    script = _installer_script_path()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    target_dir = tmp_path / "systemd"
    install_root = tmp_path / "srv" / "youtube_translation"
    install_root.mkdir(parents=True)
    backend_dir = install_root / "backend"
    backend_dir.mkdir()
    (backend_dir / ".env").write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")
    call_log = tmp_path / "calls.log"

    def write_fake(name: str, body: str) -> None:
        path = fake_bin / name
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)

    write_fake(
        "id",
        f"""#!/usr/bin/env bash
if [[ "$1" == "ytbot" ]]; then
  exit 1
fi
exec /usr/bin/id "$@"
""",
    )
    write_fake(
        "uname",
        """#!/usr/bin/env bash
echo Linux
""",
    )
    write_fake(
        "getent",
        """#!/usr/bin/env bash
if [[ "$1" == "group" && "$2" == "ytgrp" ]]; then
  exit 2
fi
exit 0
""",
    )
    write_fake(
        "groupadd",
        f"""#!/usr/bin/env bash
printf 'groupadd:%s\\n' "$*" >> "{call_log}"
exit 0
""",
    )
    write_fake(
        "useradd",
        f"""#!/usr/bin/env bash
printf 'useradd:%s\\n' "$*" >> "{call_log}"
exit 0
""",
    )
    write_fake(
        "chgrp",
        f"""#!/usr/bin/env bash
printf 'chgrp:%s\\n' "$*" >> "{call_log}"
exit 0
""",
    )
    write_fake(
        "chmod",
        f"""#!/usr/bin/env bash
printf 'chmod:%s\\n' "$*" >> "{call_log}"
exit 0
""",
    )

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
        env={
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "SYSTEMD_TARGET_DIR": str(target_dir),
            "SYSTEMD_INSTALL_ROOT": str(install_root),
            "SYSTEMD_SERVICE_USER": "ytbot",
            "SYSTEMD_SERVICE_GROUP": "ytgrp",
            "SYSTEMD_SKIP_RELOAD": "1",
        },
    )

    assert result.returncode == 0, result.stderr
    log_text = call_log.read_text(encoding="utf-8")
    assert "groupadd:--system ytgrp" in log_text
    assert "useradd:--system --home-dir " in log_text
    assert "--create-home --shell /usr/sbin/nologin --gid ytgrp ytbot" in log_text
    assert f"chgrp:ytgrp {backend_dir / '.env'}" in log_text
    assert f"chmod:0640 {backend_dir / '.env'}" in log_text
