#!/usr/bin/env python3
"""Pre-deploy configuration validator.

Loads backend/.env via Pydantic Settings and exits non-zero on any validation
error. Run before deploy_vps.sh touches docker, systemd, or migrations so that
config typos surface as a clean failure instead of a half-applied deploy or a
flapping backend in restart loops.

Replaces the shell-based DATABASE_URL self-heal block previously in
deploy_vps.sh: that hack reconstructed credentials in bash; Pydantic's
validate_database_url already catches the same failure modes (hostless URL,
password mistaken as port, transaction-mode pooler, etc.) and is the canonical
source of truth for config correctness.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    backend = root / "backend"
    sys.path.insert(0, str(backend))
    # Load backend/.env even when this script is invoked from the repo root.
    os.chdir(backend)

    # config.py instantiates `settings = Settings()` at module load, so any
    # validation error fires during import. Catch the specific exception types
    # Pydantic + our validators raise; let MemoryError, KeyboardInterrupt and
    # other unexpected errors bubble up untouched.
    try:
        from pydantic import ValidationError

        from app.core.config import Settings  # noqa: F401  (side-effects)
    except ImportError as exc:
        print(
            f"preflight: cannot import backend Settings ({exc}). "
            "Ensure the backend venv is provisioned (HOST_BACKEND_PYTHON_BIN or "
            "backend/.venv).",
            file=sys.stderr,
        )
        return 2
    except (ValidationError, ValueError, TypeError) as exc:
        print(f"preflight: configuration invalid — {exc}", file=sys.stderr)
        print(
            "Fix backend/.env (or root .env) and re-run the deploy. "
            "DATABASE_URL must include `@host:port`; production secrets must "
            "not be left at default placeholders.",
            file=sys.stderr,
        )
        return 1

    print("preflight: configuration valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
