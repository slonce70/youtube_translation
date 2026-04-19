from pathlib import Path


def _makefile_text() -> str:
    return (Path(__file__).resolve().parents[2] / "Makefile").read_text(
        encoding="utf-8"
    )


def test_verify_v0_keeps_canonical_backend_test_path() -> None:
    makefile = _makefile_text()

    assert "verify-v0: backend-venv" in makefile
    assert "$(MAKE) test\n" in makefile


def test_verify_v0_localdb_uses_explicit_localdb_backend_path() -> None:
    makefile = _makefile_text()

    assert "verify-v0-localdb: backend-venv" in makefile
    assert "$(MAKE) test-localdb\n" in makefile
    assert "test-localdb: test-backend-localdb" in makefile


def test_mvp_status_target_uses_print_script() -> None:
    makefile = _makefile_text()

    assert "mvp-status:" in makefile
    assert "./scripts/print_mvp_status.sh" in makefile


def test_verify_mvp_reuses_strict_v0_gate_then_prints_status() -> None:
    makefile = _makefile_text()

    assert "verify-mvp: backend-venv" in makefile
    assert "$(MAKE) verify-v0\n" in makefile
    assert "$(MAKE) mvp-status\n" in makefile


def test_verify_mvp_localdb_reuses_explicit_localdb_gate_then_prints_status() -> None:
    makefile = _makefile_text()

    assert "verify-mvp-localdb: backend-venv" in makefile
    assert "$(MAKE) verify-v0-localdb\n" in makefile
    assert "$(MAKE) mvp-status\n" in makefile
