# AGENTS.md (root)

This repo uses a **hierarchical AGENTS.md** setup. When editing a file, follow the **nearest** `AGENTS.md` in that directory tree (nearest-wins).

## Project Snapshot
- Type: multi-project repo (`backend/` + `frontend/` + `docker/` + `docs/`)
- Backend: FastAPI (Python 3.11), async SQLAlchemy + Postgres, FFmpeg orchestration, tusd hooks
- Frontend: Next.js (App Router) + TypeScript + Tailwind + React Query + next-intl + Supabase Auth
- Sub-packages have their own guidance: see the JIT Index below.

## Root Setup Commands
- Install all deps: `make install`
- Run everything (local): `make dev`
- Run tests: `make test`
- Lint: `make lint`
- Typecheck: `make type-check` (set `RUN_MYPY=1` to enable backend mypy)
- Apply DB migrations: `make migrate`
- Docker (optional): `make docker-up` / `make docker-down`

## Universal Conventions
- Prefer **small, focused diffs**; don’t mix backend + frontend refactors unless necessary.
- Keep formatting/tooling consistent with existing config:
  - Backend: `ruff` (+ optional `black`), line length 100 (see `.pre-commit-config.yaml`)
  - Frontend: `next lint` + TypeScript + Tailwind conventions
- Use repo scripts/targets instead of ad-hoc commands when available (`make …`, `start-*.sh`).

## Security & Secrets
- Do not commit secrets or production credentials.
- Local env files:
  - Backend: `backend/.env` (template: `backend/.env.example`)
  - Frontend: `frontend/.env.local` (template: `frontend/.env.example`)
- Treat stream keys, JWTs, Supabase secrets, and upload HMAC secrets as sensitive.

## JIT Index (what to open, not what to paste)

### Directory Map
- Backend API + runtime: `backend/` → [backend/AGENTS.md](backend/AGENTS.md)
- Frontend web app: `frontend/` → [frontend/AGENTS.md](frontend/AGENTS.md)
- Docker / infra: `docker/` → [docker/AGENTS.md](docker/AGENTS.md)
- Docs: `docs/` → [docs/AGENTS.md](docs/AGENTS.md)

### Quick Find Commands
- Find a backend route: `rg -n "^@router\.(get|post|patch|delete)\(" backend/app/api/routes`
- Find a backend service: `rg -n "class .*Service\b" backend/app/services`
- Find backend settings/env usage: `rg -n "settings\.|os\.environ|pydantic-settings" backend/app/core`
- Find a Next.js page/route: `rg -n "^export default function" frontend/src/app`
- Find a UI component: `rg -n "export (function|const)" frontend/src/components`
- Find React Query usage: `rg -n "useQuery\b|useMutation\b" frontend/src`
- Find tests: `find backend/tests frontend/src -name "*.test.*" -o -name "*.spec.*"`

## Definition of Done
- Relevant tests pass (`make test` or package-specific tests).
- Lint/typecheck pass (`make lint` and `make type-check` as applicable).
- No secrets or credentials added to the repo.
