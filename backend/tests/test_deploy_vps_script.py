import subprocess
import stat
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
    backend_env.write_text("STREAM_RUNTIME_MODE=manager\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                "STREAM_RUNTIME_MODE=manager; "
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
    root_env.write_text("STREAM_RUNTIME_MODE=manager\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                f"root_env='{root_env}'; "
                "STREAM_RUNTIME_MODE=manager; "
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


def test_deploy_vps_script_aligns_environment_when_missing(tmp_path) -> None:
    script = _script_path()
    backend_env = tmp_path / "backend.env"
    root_env = tmp_path / "root.env"
    backend_env.write_text("STREAM_RUNTIME_MODE=manager\n", encoding="utf-8")
    root_env.write_text("POSTGRES_PASSWORD=test\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                f"root_env='{root_env}'; "
                "unset ENVIRONMENT; "
                "DEPLOY_ENVIRONMENT=staging; "
                "ensure_environment_alignment; "
                "printf 'effective=%s\\n' \"$ENVIRONMENT\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "ENVIRONMENT=staging" in backend_env.read_text(encoding="utf-8")
    assert "ENVIRONMENT=staging" in root_env.read_text(encoding="utf-8")
    assert "effective=staging" in result.stdout
    assert "aligning deploy environment to staging" in result.stdout


def test_deploy_vps_script_overrides_stale_development_environment_for_production(
    tmp_path,
) -> None:
    script = _script_path()
    backend_env = tmp_path / "backend.env"
    root_env = tmp_path / "root.env"
    backend_env.write_text(
        "ENVIRONMENT=development\nENABLE_DEV_AUTH=true\n",
        encoding="utf-8",
    )
    root_env.write_text("ENVIRONMENT=development\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                f"root_env='{root_env}'; "
                "unset ENVIRONMENT; "
                "DEPLOY_ENVIRONMENT=production; "
                "ensure_environment_alignment; "
                "printf 'effective=%s\\n' \"$ENVIRONMENT\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "ENVIRONMENT=production" in backend_env.read_text(encoding="utf-8")
    assert "ENVIRONMENT=production" in root_env.read_text(encoding="utf-8")
    assert "ENABLE_DEV_AUTH=false" in backend_env.read_text(encoding="utf-8")
    assert "effective=production" in result.stdout
    assert "overriding stale ENVIRONMENT=development" in result.stdout


def test_deploy_vps_script_preserves_dev_auth_for_development_deploy(
    tmp_path,
) -> None:
    script = _script_path()
    backend_env = tmp_path / "backend.env"
    root_env = tmp_path / "root.env"
    backend_env.write_text(
        "ENVIRONMENT=development\nENABLE_DEV_AUTH=true\n",
        encoding="utf-8",
    )
    root_env.write_text("ENVIRONMENT=development\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                f"root_env='{root_env}'; "
                "unset ENVIRONMENT; "
                "DEPLOY_ENVIRONMENT=development; "
                "ensure_environment_alignment; "
                "printf 'effective=%s\\n' \"$ENVIRONMENT\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "ENVIRONMENT=development" in backend_env.read_text(encoding="utf-8")
    assert "ENABLE_DEV_AUTH=true" in backend_env.read_text(encoding="utf-8")
    assert "effective=development" in result.stdout


def test_deploy_vps_script_aligns_host_storage_env_for_active_backend(tmp_path) -> None:
    script = _script_path()
    backend_env = tmp_path / ".env"
    backend_env.write_text(
        "STREAM_RUNTIME_MODE=systemd\nUPLOAD_DIR=/app/uploads\nSTREAM_DIR=/app/streams\n",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                f"backend_env='{backend_env}'; "
                "STREAM_RUNTIME_MODE=systemd; "
                "UPLOAD_DIR=/app/uploads; "
                "STREAM_DIR=/app/streams; "
                "DEPLOY_RESTART_HOST_BACKEND=true; "
                "host_backend_is_active(){ return 0; }; "
                "ensure_host_storage_env_alignment; "
                "cat \"$backend_env\""
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    aligned_env = backend_env.read_text(encoding="utf-8")
    assert "UPLOAD_DIR=./uploads" in aligned_env
    assert "STREAM_DIR=./streams" in aligned_env
    assert "aligning backend/.env storage dirs" in result.stdout


def test_deploy_vps_script_reinstalls_systemd_runtime_for_active_host_backend(tmp_path) -> None:
    script = _script_path()
    fake_installer = tmp_path / "install_systemd_runtime.sh"
    fake_installer.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "STREAM_RUNTIME_MODE=systemd; "
                "DEPLOY_RESTART_HOST_BACKEND=true; "
                f"systemd_runtime_installer='{fake_installer}'; "
                "host_backend_is_active(){ return 0; }; "
                "run_as_root(){ printf '%s\\n' \"$*\"; }; "
                "maybe_install_systemd_runtime_units"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "SYSTEMD_INSTALL_POLKIT=1" in result.stdout
    assert str(fake_installer) in result.stdout


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
    for directory in (uploads_dir, streams_dir, logs_dir):
        directory.mkdir(parents=True, exist_ok=True)

    legacy_file = uploads_dir / "legacy.mp4"
    legacy_file.write_text("video", encoding="utf-8")

    persistent_root = tmp_path / "persistent"
    host_uploads_dir = persistent_root / "uploads"
    host_streams_dir = persistent_root / "streams"
    host_logs_dir = persistent_root / "logs"

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
    assert uploads_dir.resolve() == host_uploads_dir.resolve()
    assert streams_dir.resolve() == host_streams_dir.resolve()
    assert logs_dir.resolve() == host_logs_dir.resolve()
    assert (host_uploads_dir / "legacy.mp4").read_text(encoding="utf-8") == "video"


def test_deploy_vps_aligns_host_storage_permissions_for_service_group(tmp_path) -> None:
    script = _script_path()
    current_group = subprocess.run(
        ["id", "-gn"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    uploads_dir = tmp_path / "persistent" / "uploads"
    user_dir = uploads_dir / "user-1"
    user_dir.mkdir(parents=True, exist_ok=True)
    media_file = user_dir / "clip.mp4"
    media_file.write_text("video", encoding="utf-8")
    user_dir.chmod(0o700)
    media_file.chmod(0o600)

    streams_dir = tmp_path / "persistent" / "streams"
    logs_dir = tmp_path / "persistent" / "logs"
    for directory in (streams_dir, logs_dir):
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "uname(){ echo Linux; }; "
                "run_as_root(){ \"$@\"; }; "
                f"HOST_UPLOADS_DIR='{uploads_dir}'; "
                f"HOST_STREAMS_DIR='{streams_dir}'; "
                f"HOST_LOGS_DIR='{logs_dir}'; "
                f"SYSTEMD_SERVICE_GROUP='{current_group}'; "
                "align_host_storage_permissions"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert stat.S_IMODE(user_dir.stat().st_mode) & 0o070 == 0o070
    assert stat.S_IMODE(media_file.stat().st_mode) & 0o060 == 0o060
    assert stat.S_IMODE(uploads_dir.stat().st_mode) & stat.S_ISGID == stat.S_ISGID


def test_deploy_vps_runs_migrations_for_host_backend_refresh(tmp_path) -> None:
    script = _script_path()
    fake_python = tmp_path / "python"
    fake_python.write_text("#!/usr/bin/env bash\nprintf 'python=%s\\n' \"$0\"\nprintf 'args=%s\\n' \"$*\"\n", encoding="utf-8")
    fake_python.chmod(0o755)

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "DEPLOY_RESTART_HOST_BACKEND=true; "
                f"HOST_BACKEND_PYTHON_BIN='{fake_python}'; "
                "services=(); "
                "run_database_migrations"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Applying database migrations before backend activation..." in result.stdout
    assert f"python={fake_python}" in result.stdout
    assert "args=apply_migrations.py" in result.stdout


def test_deploy_vps_skips_migrations_for_frontend_only_deploy() -> None:
    script = _script_path()

    result = subprocess.run(
        [
            "bash",
            "-lc",
            (
                f"DEPLOY_VPS_SOURCE_ONLY=1 source {script}; "
                "services=(frontend); "
                "if should_apply_database_migrations; then exit 9; fi"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
