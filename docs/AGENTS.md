# AGENTS.md (docs/)

## Package Identity
- Engineering documentation: architecture, operations, API notes, and worklogs.

## How to Work Here
- Prefer updating existing docs instead of creating near-duplicates.
- Keep filenames stable; link from existing indexes where possible.
- Validate the behavior described by running: `make test` (or a narrower command relevant to the doc change).

## Key Docs / Touch Points
- High-level architecture: `docs/ARCHITECTURE.md`
- Work log / change notes: `docs/WORKLOG.md`
- Testing notes: `docs/TESTING.md`
- Ops: `docs/operations/`
- systemd unit examples: `docs/systemd/`
- API collections: `docs/postman/`

## Patterns & Conventions
- When documenting APIs, reference the backend route file (e.g. `backend/app/api/routes/streams.py`) and the matching frontend usage (e.g. `frontend/src/lib/api.ts`).
- When documenting runtime/ops, reference the scripts users actually run:
  - Local: `start-backend.sh`, `start-frontend.sh`, `start-tusd.sh`
  - Docker: `docker/docker-compose.yml`

## JIT Index Hints
- Find where a doc topic is implemented: `rg -n "<keyword>" backend/app frontend/src docs`
- Find API routes to link: `rg -n "^@router\.(get|post|patch|delete)\(" backend/app/api/routes`

## Pre-PR Checks
- `make test && make lint`
