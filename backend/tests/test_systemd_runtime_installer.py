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
