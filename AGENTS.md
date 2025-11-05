# Repository Guidelines

## Project Structure & Module Organization
The backend FastAPI service lives in `backend/`, with domain logic under `backend/app`, routers in `backend/app/api/routes`, schemas in `backend/app/schemas`, and shared utilities in `backend/app/core`. Backend tests reside in `backend/tests`, and alembic migrations are tracked in `backend/migrations`. The Next.js frontend is in `frontend/`, where pages sit in `frontend/src/app`, reusable UI in `frontend/src/components`, and data helpers in `frontend/src/lib`. Docker orchestration assets live in `docker/`, while helper scripts (`start-backend.sh`, `start-frontend.sh`, `start-tusd.sh`) boot individual services.

## Build, Test, and Development Commands
Run `make dev` for the full stack (backend on 8000, frontend on 3000, tusd on 1080). Use `make dev-backend` for backend-only work and `npm run dev` from `frontend/` for the web client. Before merging, execute `make build` to simulate production. Focused checks include `make test-backend` for pytest, `make lint` for Ruff/Black, and `make type-check` for TypeScript validation.

## Coding Style & Naming Conventions
Python code follows PEP 8 with four-space indentation and type hints. Keep filenames snake_case (`transcript_service.py`) and expose FastAPI dependencies through `backend/app/core`. Frontend components live in PascalCase files (`StreamDashboard.tsx`), with hooks/helpers in camelCase. When extracting Tailwind class sets, prefer `tailwind-merge` utilities. Format code via `make lint-fix` when bulk changes accumulate.

## Testing Guidelines
Pytest is configured via `backend/pytest.ini`; add unit tests beside features under `backend/tests/test_<feature>.py`. Favor async tests for async endpoints and tag heavier suites as `@pytest.mark.integration` so they can be excluded with `pytest -m "not integration"`. Capture expected fixtures or sample payloads in dedicated modules rather than inline literals.

## Commit & Pull Request Guidelines
Follow conventional commits (`feat: add upload workflow`, `fix: handle tusd errors`) and keep subjects under 72 characters. Each pull request should summarize scope, link issues, note environment changes, and include validation steps (for example, `make lint`, `make test-backend`, `npm run lint`). Attach screenshots or recordings for UI updates and mention any migrations or config updates explicitly.

## Security & Configuration Tips
Environment variables load through `backend/app/core/config.py`; never commit `.env` files and document new keys in PRs. Verify FFmpeg and tusd paths when running outside Docker images. Before releases, run `make security-audit` to surface dependency issues and rotate any Supabase keys tied to authentication changes.
