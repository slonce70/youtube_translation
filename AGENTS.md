# Repository Guidelines

This repository delivers the multi-tenant YouTube streaming platform through a FastAPI backend, a Next.js frontend, and tusd upload helpers.

## Project Structure & Module Organization

- `backend/app` holds FastAPI routers (`api/`), domain services (`core/`, `streaming/`), Pydantic schemas, and SQL models; migrations reside in `backend/migrations`, tests in `backend/tests/`.
- `frontend/src` uses the App Router with UI elements inside `components/`, utilities in `lib/`, and locale assets under `i18n/` and `messages/`.
- `docs/` contains architecture notes, `docker/` covers deployment manifests, and root scripts `start-*.sh` plus the `Makefile` manage local workflows.

## Build, Test, and Development Commands

Prefer the Makefile shortcuts:

```bash
make dev              # start FastAPI, Next.js, and tusd together
make test             # run pytest and Jest suites
make lint             # ruff + black + eslint
make type-check       # mypy + TypeScript checks
make migrate          # apply database migrations
```

Use underlying commands as needed: `pytest -v`, `npm run dev`, `npm test`, or `python3 apply_migrations.py`.

## Coding Style & Naming Conventions

- Backend code uses Python 3.11+, four-space indentation, type hints, and `snake_case` modules; enforce style with `ruff`, `black`, and `mypy`. Classes (SQLAlchemy, Pydantic, enums) stay in `PascalCase`.
- Frontend TypeScript keeps functional React components, Tailwind utility classes, and `camelCase` variables. `npm run lint` and `npm run type-check` must be clean before review.
- Keep `backend/.env.example` and `frontend/.env.example` updated when adding configuration.

## Testing Guidelines

Place pytest modules in `backend/tests/` alongside route or service names (e.g., `test_stream_routes.py`); run coverage with `make test-backend-coverage` when touching critical flows. Frontend behavior tests belong near their components or in `frontend/src/__tests__`, using Jest and Testing Library with the helpers defined in `jest.setup.ts`. Pull requests must pass `make test`.

## Commit & Pull Request Guidelines

- Follow Conventional Commits as in history (`feat(streams): …`, `fix: …`); group refactors under `chore:` and config changes under `build:` or `ci:`.
- PRs need a concise summary, linked issue, screenshots for UI changes, and the list of verification commands run (`make lint`, `make test`, migrations). Document new environment variables and reference doc updates when applicable.
- Rebase onto `main` before review and keep PRs small; include design notes in `docs/` if the change alters architecture.

## Security & Configuration Tips

Store secrets only in `backend/.env` and `frontend/.env.local`, not in Git. Validate `TUSD_HMAC_SECRET`, FFmpeg paths, and Supabase credentials before `make dev`. Rotate tokens regularly and run `make security-audit` ahead of releases.
