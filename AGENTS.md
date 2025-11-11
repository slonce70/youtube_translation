# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the FastAPI service, CLI utilities, and tusd hooks; keep domain logic under `backend/app/` and reusable scripts under `backend/scripts/`.
- `backend/tests/` mirrors the app layout; add fixtures beside the features they cover.
- `frontend/src/` contains the Next.js App Router tree plus UI primitives in `frontend/src/components/`; colocate page-specific hooks or stores inside the related feature folder.
- `docs/` stores architecture notes, API contracts, and ops playbooks (systemd, Supervisor, Postman); update the relevant file whenever behavior shifts.
- `docker/` and root `start-*.sh` scripts encode local orchestration; align new services with these entrypoints before editing CI.

## Build, Test, and Development Commands
- `make install` — installs backend (pip) and frontend (npm) dependencies in one step.
- `make dev` — runs backend, frontend, and tusd together; prefer this for full-stack QA.
- Targeted helpers: `make dev-backend`, `make dev-frontend`, or `./start-tusd.sh` when debugging a single service.
- `make test` — executes pytest plus Jest/React Testing Library suites; CI expects it to pass cleanly.
- `make lint` and `make type-check` — run Ruff+Black, ESLint, and mypy/tsc; fix formatting locally before pushing.

## Coding Style & Naming Conventions
- Python: 4-space indent, explicit type hints, and descriptive snake_case module names; format with Black and keep imports Ruff-compliant.
- TypeScript/React: 2-space indent, functional components in PascalCase, hooks in camelCase with the `use` prefix, and translations grouped under `frontend/src/i18n`.
- Configuration files (`.env`, `supervisord.conf`, `docs/systemd/*`) must stay ASCII and documented when keys change.

## Testing Guidelines
- Backend tests live in `backend/tests/test_*.py`; mock external services (Supabase, FFmpeg) via fixtures in `tests/conftest.py`.
- Frontend tests follow `*.spec.tsx` or `*.test.ts` inside feature folders; use Jest snapshots sparingly and favor behavior assertions.
- Maintain ≥80% coverage on new modules; if coverage dips, explain the trade-off in the PR and add a follow-up issue.

## Commit & Pull Request Guidelines
- Follow the Conventional Commit pattern seen in history (`feat:`, `chore(repo):`, `fix(streams):`); keep the subject ≤72 chars and list key changes as bullet points in the body when needed.
- Every PR should include: a concise summary, linked issue/linear ticket, screenshots or curl output for UI/API tweaks, test evidence (`make test` log), and notes on env or migration impacts.
- Request at least one reviewer familiar with the touched area (backend, frontend, or ops) and ensure docs are updated in the same PR.

## Security & Configuration Tips
- Never commit secrets; keep `backend/.env` and `frontend/.env.local` in `.gitignore` and rotate keys via `openssl rand` as documented in `README.md`.
- Validate `DATABASE_URL`, Supabase keys, and `FFMPEG_BIN` before running `make dev`; misconfigured paths are the top cause of failing local streams.
- When altering streaming runtime behavior, update both `docs/operations/supervisor.md` and `docs/systemd/*.md` so operators can mirror your config.
