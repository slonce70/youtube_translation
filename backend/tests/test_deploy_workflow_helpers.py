import subprocess
from pathlib import Path


def _script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "deploy_workflow_helpers.sh"


def _run_bash(command: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-lc", command],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _commit_all(repo: Path, message: str) -> str:
    _git(repo, "add", "-A")
    subprocess.run(
        ["git", "commit", "-m", message],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    return _git(repo, "rev-parse", "HEAD")


def _parse_key_values(output: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for line in output.strip().splitlines():
        key, _, value = line.partition("=")
        pairs[key] = value
    return pairs


def _init_deploy_repo(tmp_path: Path) -> tuple[Path, str, str, str]:
    repo = tmp_path / "repo"
    (repo / "frontend").mkdir(parents=True)
    (repo / "docker").mkdir(parents=True)
    (repo / "scripts").mkdir(parents=True)

    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "codex@example.com")
    _git(repo, "config", "user.name", "Codex")

    (repo / "frontend" / "app.tsx").write_text("export default 'v0'\n", encoding="utf-8")
    (repo / "docker" / "Caddyfile.template").write_text(":80 { respond \"ok\" }\n", encoding="utf-8")
    (repo / "scripts" / "deploy_vps.sh").write_text("#!/usr/bin/env bash\nprintf 'base\\n'\n", encoding="utf-8")
    base_sha = _commit_all(repo, "base")

    (repo / "docker" / "Caddyfile.template").write_text(":80 { respond \"infra-v1\" }\n", encoding="utf-8")
    (repo / "scripts" / "deploy_vps.sh").write_text("#!/usr/bin/env bash\nprintf 'host-runtime-v1\\n'\n", encoding="utf-8")
    checkout_sha = _commit_all(repo, "host runtime refresh")

    (repo / "frontend" / "app.tsx").write_text("export default 'frontend-v2'\n", encoding="utf-8")
    target_sha = _commit_all(repo, "frontend only")

    return repo, base_sha, checkout_sha, target_sha


def test_deploy_impact_ignores_stale_backend_container_sha_for_host_runtime(tmp_path: Path) -> None:
    script = _script_path()
    repo, stale_backend_sha, checkout_sha, target_sha = _init_deploy_repo(tmp_path)

    result = _run_bash(
        (
            f"source {script}; "
            f"TARGET_SHA='{target_sha}'; "
            f"CURRENT_BACKEND_SHA='{stale_backend_sha}'; "
            f"CURRENT_FRONTEND_SHA='{checkout_sha}'; "
            f"CURRENT_TUSD_SHA='{checkout_sha}'; "
            "HOST_BACKEND_ACTIVE=true; "
            "HOST_BACKEND_UNIT_PRESENT=true; "
            "CONFIGURED_STREAM_RUNTIME_MODE=systemd; "
            f"VPS_CHECKOUT_SHA='{checkout_sha}'; "
            "compute_deploy_impact"
        ),
        cwd=repo,
    )

    assert result.returncode == 0, result.stderr
    values = _parse_key_values(result.stdout)

    assert values["effective_backend_sha"] == checkout_sha
    assert values["frontend_needs_deploy"] == "true"
    assert values["backend_needs_deploy"] == "false"
    assert values["infra_needs_deploy"] == "false"
    assert values["host_runtime_needs_refresh"] == "false"
    assert values["deploy_services_csv"] == "frontend"
    assert values["frontend_only_deploy"] == "true"
    assert values["host_runtime_only_refresh"] == "false"


def test_live_deploy_guard_blocks_mixed_deploys_during_active_streams() -> None:
    script = _script_path()

    result = _run_bash(
        (
            f"source {script}; "
            "ACTIVE_STREAMS=1; "
            "FRONTEND_ONLY_DEPLOY=false; "
            "HOST_RUNTIME_ONLY_REFRESH=false; "
            "HOST_BACKEND_ACTIVE=true; "
            "evaluate_live_deploy_guard"
        )
    )

    assert result.returncode == 0, result.stderr
    values = _parse_key_values(result.stdout)
    assert values["can_deploy"] == "false"
    assert values["decision"] == "deploy deferred to protect live streams"


def test_live_deploy_guard_allows_host_runtime_only_refresh_for_active_streams() -> None:
    script = _script_path()

    result = _run_bash(
        (
            f"source {script}; "
            "ACTIVE_STREAMS=1; "
            "FRONTEND_ONLY_DEPLOY=false; "
            "HOST_RUNTIME_ONLY_REFRESH=true; "
            "HOST_BACKEND_ACTIVE=true; "
            "evaluate_live_deploy_guard"
        )
    )

    assert result.returncode == 0, result.stderr
    values = _parse_key_values(result.stdout)
    assert values["can_deploy"] == "true"
    assert values["decision"] == "live stream active: host-native backend refresh allowed"
