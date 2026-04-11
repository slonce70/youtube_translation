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
