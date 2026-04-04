#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/docker/docker-compose.yml"
backend_env="$repo_root/backend/.env"
root_env="$repo_root/.env"
services=(postgres redis backend tusd frontend runner mediamtx)

if [[ ! -f "$backend_env" ]]; then
  echo "Missing required env file: $backend_env" >&2
  exit 1
fi

cd "$repo_root"

set -a
# shellcheck disable=SC1090
source "$backend_env"
if [[ -f "$root_env" ]]; then
  # shellcheck disable=SC1090
  source "$root_env"
fi
set +a

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "POSTGRES_PASSWORD must be set via backend/.env or .env" >&2
  exit 1
fi

echo "Validating compose config..."
docker compose -f "$compose_file" config >/dev/null

echo "Deploying services: ${services[*]}"
docker compose -f "$compose_file" up -d --build --remove-orphans "${services[@]}"

echo "Waiting for backend health endpoint..."
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null

echo "Deployment complete for commit $(git rev-parse --short HEAD)"
docker compose -f "$compose_file" ps
