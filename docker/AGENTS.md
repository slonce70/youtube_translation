# AGENTS.md (docker/)

## Package Identity
- Local/prod-ish infrastructure: docker-compose stack + Caddy reverse proxy + tusd uploader.

## Setup & Run
- Start stack: `make docker-up` (uses `docker/docker-compose.yml`)
- Stop stack: `make docker-down`
- Tail logs: `make docker-logs`
- Build images: `make docker-build`

## Patterns & Conventions
- Compose file: `docker/docker-compose.yml` is the source of truth for container wiring.
- Reverse proxy: `docker/Caddyfile` (keep routes minimal; prefer app-level auth).
- tusd image: `docker/tusd.Dockerfile` (ensure hooks/env match backend expectations).

Examples:
- ✅ DO: keep compose env in sync with backend expectations (see `backend/.env.example` for variables).
- ❌ DON'T: bake secrets into images or commit them into `docker/docker-compose.yml`.

## Touch Points / Key Files
- Compose: `docker/docker-compose.yml`
- Proxy: `docker/Caddyfile`
- tusd: `docker/tusd.Dockerfile`

## JIT Index Hints
- Find ports/hosts: `rg -n "ports:|Caddyfile" docker`
- Find tusd hook paths: `rg -n "tusd|hook" docker docker/docker-compose.yml backend/tusd-hooks`

## Pre-PR Checks
- `docker compose -f docker/docker-compose.yml config`
