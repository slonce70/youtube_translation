# AGENTS.md (backend/)

## Package Identity
- FastAPI backend providing REST + WebSocket APIs for multi-channel streaming control.
- Async SQLAlchemy + Postgres for data; Supabase is used for **Auth**, not as the main DB.

## Setup & Run
- Install deps (recommended): `make install-backend`
- Apply migrations: `make migrate`
- Run API (local): `make dev-backend` (wraps `start-backend.sh`)
- Run tests: `make test-backend` (sets `FFMPEG_BIN=tests/bin/ffmpeg`)
- Lint: `make lint-backend` (enable Black check: `RUN_BLACK=1 make lint-backend`)
- Typecheck (optional): `RUN_MYPY=1 make type-check`

## Patterns & Conventions (most important)
- **Routes** live in `backend/app/api/routes/*.py` (example: `backend/app/api/routes/streams.py`).
- **Dependencies/auth** helpers live in `backend/app/api/deps.py` (example: `require_user`).
- **Business logic** belongs in `backend/app/services/**`:
  - Streams: `backend/app/services/streams/service.py`, control: `backend/app/services/streams/control.py`
  - Assets: `backend/app/services/assets/service.py`
- **Schemas** (Pydantic) live in `backend/app/schemas/**` (example: `backend/app/schemas/api.py`).
- **Config/settings** live in `backend/app/core/config.py` (uses env-driven settings).
- **Database** connection/session patterns live in `backend/app/core/database.py`.
- **Streaming runtime** lives in `backend/app/streaming/**` (example: `backend/app/streaming/ffmpeg_manager.py`).

Examples:
- ✅ DO: add a new API endpoint by following `backend/app/api/routes/streams.py` (deps → service → schema response).
- ✅ DO: put non-trivial logic into a service like `backend/app/services/media_collections/service.py`.
- ❌ DON'T: add more one-off “direct migration” scripts like `backend/apply_migration_007_direct.py` (prefer `backend/migrations/**` + `backend/apply_migrations.py`).
- ❌ DON'T: commit or rely on generated artifacts/logs like `backend/pip-install.log` or anything under `backend/logs/`.

## Touch Points / Key Files
- App entrypoint + router wiring: `backend/app/main.py`
- Auth + request context: `backend/app/api/deps.py`
- Metrics endpoints: `backend/app/api/routes/metrics.py`, `backend/app/core/metrics.py`
- Quotas: `backend/app/core/quota.py`, `backend/app/services/quota/service.py`
- Supervisor/systemd controls: `backend/app/core/supervisor_control.py`, `backend/app/core/systemd_control.py`
- tusd hooks: `backend/tusd-hooks/pre-create`, `backend/tusd-hooks/post-finish`

## JIT Index Hints
- Find an endpoint: `rg -n "^@router\.(get|post|patch|delete)\(" backend/app/api/routes`
- Find service methods: `rg -n "async def \w+\(" backend/app/services`
- Find DB models: `rg -n "class \w+\(Base\)" backend/app/models`
- Find migrations: `find backend/migrations -maxdepth 2 -type f`
- Find tests: `find backend/tests -type f -name "test_*.py"`

## Common Gotchas
- Many tests assume `FFMPEG_BIN=tests/bin/ffmpeg` (use `make test-backend`).
- Stream runtime can be `manager` / `supervisor` / `systemd` (see `STREAM_RUNTIME_MODE` usage in `start-backend.sh`).
- `backend/.env` drives `DATABASE_URL` and security secrets; avoid hardcoding config values.

## Pre-PR Checks
- `RUN_BLACK=1 RUN_MYPY=1 make lint-backend && RUN_MYPY=1 make type-check && make test-backend`
