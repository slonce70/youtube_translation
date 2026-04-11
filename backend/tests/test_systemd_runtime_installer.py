import subprocess
from pathlib import Path


def _installer_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "install_systemd_runtime.sh"


def test_install_systemd_runtime_renders_units_into_target_dir(tmp_path) -> None:
    script = _installer_script_path()
    target_dir = tmp_path / "systemd"

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
            "SYSTEMD_INSTALL_ROOT": "/srv/youtube_translation",
            "SYSTEMD_SERVICE_USER": "ytbot",
            "SYSTEMD_SERVICE_GROUP": "ytgrp",
            "SYSTEMD_SKIP_RELOAD": "1",
        },
    )

    assert result.returncode == 0, result.stderr
    assert (target_dir / "youtube-backend.service").exists()
    assert (target_dir / "ffmpeg@.service").exists()
    assert (target_dir / "streaming.slice").exists()

    backend_unit = (target_dir / "youtube-backend.service").read_text(encoding="utf-8")
    stream_unit = (target_dir / "ffmpeg@.service").read_text(encoding="utf-8")

    assert "/srv/youtube_translation/backend" in backend_unit
    assert "/srv/youtube_translation/.venv/bin/uvicorn" in backend_unit
    assert "User=ytbot" in backend_unit
    assert "Group=ytgrp" in backend_unit

    assert "/srv/youtube_translation/backend" in stream_unit
    assert "/srv/youtube_translation/.venv/bin/python" in stream_unit
    assert "User=ytbot" in stream_unit
    assert "Group=ytgrp" in stream_unit
