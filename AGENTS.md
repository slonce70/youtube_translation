# Repository Guidelines

## Project Structure & Module Organization
The `backend/` service is a FastAPI application; core domain logic lives under `backend/app`, with routers in `backend/app/api/routes`, schemas in `backend/app/schemas`, and shared utilities in `backend/app/core`. Tests reside in `backend/tests`, while database changes live in `backend/migrations`. The Next.js frontend sits in `frontend/`, with pages under `frontend/src/app`, shared UI in `frontend/src/components`, and data helpers in `frontend/src/lib`. Docker assets are collected in `docker/`, and the helper scripts `start-backend.sh`, `start-frontend.sh`, and `start-tusd.sh` provide standalone service entry points.

## Build, Test, and Development Commands
Use `make dev` for a full local stack (backend on port 8000, frontend on 3000, tusd on 1080). Backend-only work can rely on `make dev-backend`, while `npm run dev` inside `frontend/` starts the web client alone. Before pushing, run `make build` to catch production issues. For targeted checks run `make test-backend`, `npm run lint`, or `make type-check` as needed.

## Coding Style & Naming Conventions
Python modules follow PEP 8 with four-space indentation, `snake_case` filenames, and type-annotated functions. Enforce style with `make lint`, which wraps Ruff and Black; auto-fixes are available through `make lint-fix`. React components live in PascalCase files (for example, `StreamDashboard.tsx`), while hooks and helpers use camelCase filenames. Tailwind classes should be composed with `tailwind-merge` utilities when extracting shared patterns.

## Testing Guidelines
Pytest is configured in `backend/pytest.ini`; place unit tests beside features under `backend/tests/`, named `test_<feature>.py`. Prefer async tests where appropriate and mark integration-heavy suites with `@pytest.mark.integration` so they can be filtered via `pytest -m "not integration"`. Frontend automated testing is not yet wired; until a framework is introduced, rely on linting, type checks, and manual QA steps recorded in pull requests.

## Commit & Pull Request Guidelines
Follow the conventional commit style used in history (`feat:`, `fix:`, `docs:`) and keep subject lines under 72 characters. Each pull request should summarize the change, link to relevant issues, describe validation steps (`make lint`, `make test-backend`, screenshots for UI changes), and flag any migrations or environment updates. Keep branches focused; large rewrites should be split into reviewable slices.

## Security & Configuration Tips
Backend settings are loaded from `.env` via `app/core/config.py`; never commit secrets and document required variables when adding new ones. Confirm FFmpeg and tusd paths when deploying outside Docker, and run `make security-audit` before releases to surface dependency issues. Rotate Supabase keys stored in deployment environments after major authentication changes.
