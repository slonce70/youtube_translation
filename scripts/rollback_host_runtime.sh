#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_root/docker/docker-compose.yml}"
backend_env="${BACKEND_ENV:-$repo_root/backend/.env}"
root_env="${ROOT_ENV:-$repo_root/.env}"

docker_bin="${DOCKER_BIN:-docker}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
curl_bin="${CURL_BIN:-curl}"
postgres_container="${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
stream_unit="${HOST_STREAM_UNIT_NAME:-}"
backend_health_url="${DOCKER_BACKEND_HEALTH_URL:-http://127.0.0.1:8000/health}"
frontend_health_url="${FRONTEND_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
dry_run="${ROLLBACK_DRY_RUN:-0}"
allow_live_rollback="${ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK:-0}"
start_docker_runtime="${ROLLBACK_START_DOCKER_RUNTIME:-1}"
docker_runtime_mode="${ROLLBACK_DOCKER_STREAM_RUNTIME_MODE:-supervisor}"
restart_frontend_and_tusd="${ROLLBACK_RESTART_FRONTEND_TUSD:-1}"

run_cmd() {
  if [[ "$dry_run" == "1" ]]; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

wait_for_http() {
  local label="$1"
  local url="$2"

  echo "Waiting for ${label}..."
  for _ in $(seq 1 30); do
    if "$curl_bin" -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done

  "$curl_bin" -fsS --max-time 5 "$url" >/dev/null
}

count_active_streams() {
  if [[ -n "${ROLLBACK_ACTIVE_STREAMS_OVERRIDE:-}" ]]; then
    printf '%s\n' "${ROLLBACK_ACTIVE_STREAMS_OVERRIDE}"
    return 0
  fi

  if [[ "$dry_run" == "1" ]]; then
    echo 0
    return 0
  fi

  if ! "$docker_bin" ps --format '{{.Names}}' | grep -qx "$postgres_container"; then
    echo 0
    return 0
  fi

  "$docker_bin" exec "$postgres_container" \
    psql -U youtube_user -d youtube_streaming -tAc \
    "SELECT count(*) FROM streams WHERE status IN ('running', 'starting', 'stopping');" \
    | tr -d '[:space:]'
}

if [[ ! -f "$backend_env" ]]; then
  echo "Missing required env file: $backend_env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$backend_env"
if [[ -f "$root_env" ]]; then
  # shellcheck disable=SC1090
  source "$root_env"
fi
set +a

runtime_mode="${STREAM_RUNTIME_MODE:-}"
runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
if [[ -n "${ROLLBACK_RUNTIME_MODE_OVERRIDE:-}" ]]; then
  runtime_mode="$(printf '%s' "${ROLLBACK_RUNTIME_MODE_OVERRIDE}" | tr '[:upper:]' '[:lower:]')"
fi
if [[ "$runtime_mode" != "systemd" ]]; then
  echo "Refusing rollback helper: STREAM_RUNTIME_MODE must currently be systemd." >&2
  exit 1
fi

active_streams="$(count_active_streams)"
if ! [[ "$active_streams" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine active stream count: $active_streams" >&2
  exit 1
fi

if (( active_streams > 0 )) && [[ "$allow_live_rollback" != "1" ]]; then
  echo "Refusing rollback: ${active_streams} live stream(s) detected. Set ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=1 only for an explicitly reviewed rollback." >&2
  exit 1
fi

run_cmd "$systemctl_bin" disable --now "$backend_unit"
if [[ -n "$stream_unit" ]]; then
  run_cmd "$systemctl_bin" disable --now "ffmpeg@${stream_unit}"
fi

if [[ "$start_docker_runtime" == "1" ]]; then
  run_cmd env \
    STREAM_RUNTIME_MODE="$docker_runtime_mode" \
    ALLOW_UNSAFE_MANAGER_RUNTIME=false \
    ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=false \
    "$docker_bin" compose -f "$compose_file" up -d backend runner
fi

if [[ "$dry_run" != "1" && "$start_docker_runtime" == "1" ]]; then
  wait_for_http "docker backend health endpoint" "$backend_health_url"
fi

if [[ "$restart_frontend_and_tusd" == "1" ]]; then
  run_cmd env \
    FRONTEND_API_PROXY_TARGET="http://backend:8000" \
    TUSD_BACKEND_URL="http://backend:8000" \
    "$docker_bin" compose -f "$compose_file" up -d frontend tusd
  if [[ "$dry_run" != "1" ]]; then
    wait_for_http "frontend health endpoint" "$frontend_health_url"
  fi
fi

echo "Host runtime rollback completed."
