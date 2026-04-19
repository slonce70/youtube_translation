import subprocess
from pathlib import Path


def _status_script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "print_mvp_status.sh"


def test_mvp_status_script_prints_supported_scope_and_manual_gates() -> None:
    script = _status_script_path()

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "single-node" in result.stdout
    assert "single-destination" in result.stdout
    assert "real auth sanity check" in result.stdout
    assert "first-stream rehearsal" in result.stdout
    assert "docs/operations/first_stream_checklist.md" in result.stdout
    assert "docs/operations/systemd.md" in result.stdout
    assert "post-MVP rollout lane" in result.stdout
