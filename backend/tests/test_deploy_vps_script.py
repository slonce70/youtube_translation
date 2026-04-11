import subprocess
from pathlib import Path


def _script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "deploy_vps.sh"


def test_deploy_vps_script_treats_true_as_enabled_for_skip_docker() -> None:
    script = _script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_SKIP_DOCKER=true DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "parse_selected_services; "
                "printf 'services=%s\\n' \"${#services[@]}\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "services=0" in result.stdout


def test_deploy_vps_script_flag_enabled_accepts_workflow_boolean_variants() -> None:
    script = _script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "for value in true TRUE yes on 1; do "
                "  flag_enabled \"$value\" || exit 1; "
                "done; "
                "for value in false FALSE no off 0 ''; do "
                "  if flag_enabled \"$value\"; then exit 2; fi; "
                "done"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_vps_script_aligns_stream_runtime_mode_for_active_host_backend(
    tmp_path,
) -> None:
    script = _script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text("STREAM_RUNTIME_MODE=supervisor\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                "STREAM_RUNTIME_MODE=supervisor; "
                "DEPLOY_RESTART_HOST_BACKEND=true; "
                "host_backend_is_active(){ return 0; }; "
                "ensure_host_runtime_mode_alignment; "
                "cat \"$backend_env\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "STREAM_RUNTIME_MODE=systemd" in backend_env.read_text(encoding="utf-8")
    assert "aligning" in result.stdout


def test_deploy_vps_script_aligns_effective_runtime_mode_for_cutover_path(
    tmp_path,
) -> None:
    script = _script_path()
    backend_env = tmp_path / "backend.env"
    root_env = tmp_path / "root.env"
    backend_env.write_text("STREAM_RUNTIME_MODE=systemd\n", encoding="utf-8")
    root_env.write_text("STREAM_RUNTIME_MODE=supervisor\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                f"root_env='{root_env}'; "
                "STREAM_RUNTIME_MODE=supervisor; "
                "DEPLOY_CUTOVER_HOST_RUNTIME=true; "
                "host_backend_is_active(){ return 1; }; "
                "ensure_host_runtime_mode_alignment; "
                "printf 'effective=%s\\n' \"$STREAM_RUNTIME_MODE\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "STREAM_RUNTIME_MODE=systemd" in backend_env.read_text(encoding="utf-8")
    assert "STREAM_RUNTIME_MODE=systemd" in root_env.read_text(encoding="utf-8")
    assert "effective=systemd" in result.stdout
