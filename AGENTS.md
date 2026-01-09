# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the FastAPI service, async SQLAlchemy models, and tusd hooks. Key subfolders: `app/` (domain logic), `tests/`, `tusd-hooks/`, and deployment scripts.
- `frontend/` contains the Next.js dashboard, shared components, and React Query hooks; `public/` holds static assets.
- `docker/`, `Makefile`, and root scripts (`start-backend.sh`, `start-frontend.sh`, `start-tusd.sh`) orchestrate local services and integrations.

## Language Policy
- Supported languages: Ukrainian, English, Russian.
- Default language for UI, docs, and developer notes: Ukrainian.

## Build, Test & Development Commands
- **Backend**: `cd backend && python3 -m pytest` runs the async test suite; ensure dependencies from `requirements.txt` are installed. `uvicorn app.main:app --reload` launches the API locally.
- **Frontend**: `cd frontend && npm install && npm run dev` starts the Next.js app; `npm run lint` enforces ESLint/TypeScript rules.
- **Infra**: `./start-tusd.sh` boots the tusd uploader with quota hooks; export `TUSD_HMAC_SECRET` and `UPLOAD_TOKEN_SECRET` before running.

## Coding Style & Naming Conventions
- Python files follow Black-compatible 4-space indentation, descriptive snake_case names, and FastAPI/SQLAlchemy best practices. Use type hints and async/await for DB or IO operations.
- TypeScript/React uses ESLint + Prettier defaults: 2-space indent, camelCase for vars, PascalCase for components. Prefer hooks and React Query for data fetching.
- Keep modules small: service-layer classes belong in `backend/app/services/*`, UI atoms in `frontend/src/components/*`.

## Testing Guidelines
- Backend tests use `pytest` with async fixtures; name files `test_*.py` and mirror module paths (e.g., `test_stream_live_edit.py` for `services/streams`). Target meaningful coverage for quota, uploads, and streaming flows.
- Frontend relies on `@testing-library/react` (see `frontend/src/components/library/__tests__/`). Use descriptive `it('renders …')` blocks and mock API calls.
- Run `npm run lint` and `python3 -m pytest` before committing; add new tests when touching service logic or React hooks.

## Commit & Pull Request Guidelines
- Follow imperative, concise commit messages (`Secure tus upload webhook`, `Add admin pagination`). Group related backend/frontend changes into logical commits.
- Pull requests should describe the change, list testing done, and mention any secrets/config updates. Include screenshots or GIFs for UI tweaks, and reference Jira/GitHub issues when applicable.

## Skills
- Repo-specific “Droid/Claude skills” were removed from this repository (no `.factory/` or `.claude/skills/`).
