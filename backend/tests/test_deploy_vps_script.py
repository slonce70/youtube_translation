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


def test_deploy_vps_diagnostics_runs_readiness_script_via_bash_when_not_executable(
    tmp_path,
) -> None:
    script = _script_path()
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "scripts"
    scripts_dir.mkdir(parents=True)
    readiness_script = scripts_dir / "check_host_runtime_readiness.sh"
    readiness_script.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"repo_root='{repo_root}'; "
                "run_as_root(){ printf '%s\\n' \"$*\"; }; "
                "dump_host_backend_diagnostics youtube-backend"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "env SYSTEMD_INSTALL_ROOT=/opt/youtube_translation" in result.stdout
    assert f"bash {readiness_script}" in result.stdout


def test_deploy_vps_aligns_repo_storage_paths_to_persistent_symlinks(tmp_path) -> None:
    script = _script_path()
    repo_root = tmp_path / "repo"
    backend_root = repo_root / "backend"
    uploads_dir = backend_root / "uploads"
    streams_dir = backend_root / "streams"
    logs_dir = backend_root / "logs"
    supervisord_dir = backend_root / "supervisord"
    for directory in (uploads_dir, streams_dir, logs_dir, supervisord_dir):
        directory.mkdir(parents=True, exist_ok=True)

    legacy_file = uploads_dir / "legacy.mp4"
    legacy_file.write_text("video", encoding="utf-8")

    persistent_root = tmp_path / "persistent"
    host_uploads_dir = persistent_root / "uploads"
    host_streams_dir = persistent_root / "streams"
    host_logs_dir = persistent_root / "logs"
    host_supervisord_dir = persistent_root / "supervisord"

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "uname(){ echo Linux; }; "
                "run_as_root(){ \"$@\"; }; "
                f"repo_root='{repo_root}'; "
                f"HOST_UPLOADS_DIR='{host_uploads_dir}'; "
                f"HOST_STREAMS_DIR='{host_streams_dir}'; "
                f"HOST_LOGS_DIR='{host_logs_dir}'; "
                f"HOST_SUPERVISORD_DIR='{host_supervisord_dir}'; "
                "align_host_storage_links"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert uploads_dir.is_symlink()
    assert streams_dir.is_symlink()
    assert logs_dir.is_symlink()
    assert supervisord_dir.is_symlink()
    assert uploads_dir.resolve() == host_uploads_dir.resolve()
    assert streams_dir.resolve() == host_streams_dir.resolve()
    assert logs_dir.resolve() == host_logs_dir.resolve()
    assert supervisord_dir.resolve() == host_supervisord_dir.resolve()
    assert (host_uploads_dir / "legacy.mp4").read_text(encoding="utf-8") == "video"
