#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT_DIR}"

API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
TUSD_PORT="${TUSD_PORT:-1080}"

log() {
  printf '%s\n' "$1"
}

port_is_listening() {
  local port="${1:?}"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_postgres() {
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    log "✅ PostgreSQL already available on localhost:5432"
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    if brew services list | grep -q '^postgresql@17'; then
      log "▶ Starting local PostgreSQL via Homebrew services..."
      brew services start postgresql@17 >/dev/null 2>&1 || true
      sleep 2
    fi
  fi

  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    log "❌ PostgreSQL is not running on localhost:5432"
    log "   Start it first, then rerun ./start-local-dev.sh"
    exit 1
  fi
}

ensure_redis() {
  if redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    log "✅ Redis already available on localhost:6379"
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    if brew services list | grep -q '^redis'; then
      log "▶ Starting local Redis via Homebrew services..."
      brew services start redis >/dev/null 2>&1 || true
      sleep 2
    fi
  fi

  if ! redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    log "❌ Redis is not running on localhost:6379"
    log "   Start it first, then rerun ./start-local-dev.sh"
    exit 1
  fi
}

stop_repo_docker_services() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  local running=()
  while IFS= read -r name; do
    [ -n "${name}" ] && running+=("${name}")
  done < <(docker ps --format '{{.Names}}' | grep '^youtube-streaming-' || true)

  if [ "${#running[@]}" -eq 0 ]; then
    return 0
  fi

  log "🛑 Stopping repo Docker services to keep the stack fully local..."
  docker stop "${running[@]}" >/dev/null 2>&1 || true
}

kill_port() {
  local port="${1:?}"
  while IFS= read -r pid; do
    [ -n "${pid}" ] && kill -9 "${pid}" >/dev/null 2>&1 || true
  done < <(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)
}

log "🚀 Starting full local stack (no Docker runtime)..."
stop_repo_docker_services
ensure_postgres
ensure_redis

kill_port "${API_PORT}"
kill_port "${FRONTEND_PORT}"
kill_port "${TUSD_PORT}"

log "📍 Backend:  http://localhost:${API_PORT}"
log "📍 tusd:     http://localhost:${TUSD_PORT}/files/"
log "📍 Frontend: http://localhost:${FRONTEND_PORT}"
log ""

trap 'kill 0' INT TERM EXIT

STREAM_RUNTIME_MODE=manager ./start-backend.sh &
TUSD_BACKEND_URL="http://127.0.0.1:${API_PORT}" ./start-tusd.sh &
./start-frontend.sh &

wait
