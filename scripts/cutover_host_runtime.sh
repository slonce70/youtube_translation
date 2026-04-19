#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_env="${BACKEND_ENV:-$repo_root/backend/.env}"
root_env="${ROOT_ENV:-$repo_root/.env}"
compose_file="${COMPOSE_FILE:-$repo_root/docker/docker-compose.yml}"

docker_bin="${DOCKER_BIN:-docker}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
curl_bin="${CURL_BIN:-curl}"
ufw_bin="${UFW_BIN:-ufw}"
ss_bin="${SS_BIN:-ss}"
postgres_container="${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
backend_container="${BACKEND_CONTAINER_NAME:-youtube-streaming-backend}"
backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
stream_unit="${HOST_STREAM_UNIT_NAME:-}"
backend_health_url="${HOST_BACKEND_HEALTH_URL:-http://127.0.0.1:8000/health}"
frontend_health_url="${FRONTEND_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
dry_run="${CUTOVER_DRY_RUN:-0}"
allow_live_cutover="${ALLOW_LIVE_STREAM_RUNTIME_CUTOVER:-0}"
stop_docker_runtime="${CUTOVER_STOP_DOCKER_RUNTIME:-1}"
skip_dependency_port_check="${CUTOVER_SKIP_DEPENDENCY_PORT_CHECK:-0}"
host_backend_docker_upstream="${HOST_BACKEND_DOCKER_UPSTREAM:-http://host.docker.internal:8000}"
restart_frontend_and_tusd="${CUTOVER_RESTART_FRONTEND_TUSD:-1}"
host_backend_bridge_port="${HOST_BACKEND_DOCKER_PORT:-8000}"
host_backend_firewall_comment="${HOST_BACKEND_FIREWALL_COMMENT:-youtube host backend bridge}"

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

wait_for_tusd_backend_http() {
  echo "Waiting for tusd backend upstream reachability..."
  for _ in $(seq 1 15); do
    if "$docker_bin" compose -f "$compose_file" exec -T tusd \
      sh -lc 'curl -fsS --max-time 5 "$TUSD_BACKEND_URL/health" >/dev/null' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  "$docker_bin" compose -f "$compose_file" exec -T tusd \
    sh -lc 'curl -fsS --max-time 5 "$TUSD_BACKEND_URL/health" >/dev/null'
}

ufw_is_active() {
  command -v "$ufw_bin" >/dev/null 2>&1 && "$ufw_bin" status 2>/dev/null | grep -q '^Status: active'
}

collect_edge_bridge_interfaces() {
  local container_name

  for container_name in youtube-streaming-tusd youtube-streaming-frontend; do
    "$docker_bin" inspect -f '{{range $name, $net := .NetworkSettings.Networks}}{{$net.NetworkID}}{{"\n"}}{{end}}' "$container_name" 2>/dev/null || true
  done \
    | awk 'NF { print "br-" substr($0, 1, 12) }' \
    | sort -u
}

ufw_backend_bridge_rule_present() {
  local bridge_iface="$1"
  "$ufw_bin" status 2>/dev/null | grep -Fq "${host_backend_bridge_port}/tcp on ${bridge_iface}"
}

ensure_host_backend_bridge_firewall() {
  local bridge_iface

  if ! ufw_is_active; then
    return 0
  fi

  while IFS= read -r bridge_iface; do
    [[ -n "$bridge_iface" ]] || continue
    if ufw_backend_bridge_rule_present "$bridge_iface"; then
      continue
    fi
    run_cmd "$ufw_bin" allow in on "$bridge_iface" to any port "$host_backend_bridge_port" proto tcp comment "$host_backend_firewall_comment"
  done < <(collect_edge_bridge_interfaces)
}

dump_host_backend_diagnostics() {
  echo "Collecting host-native backend diagnostics for ${backend_unit}..."
  "$systemctl_bin" show \
    --property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts \
    "$backend_unit" || true
  "$systemctl_bin" status --no-pager -l "$backend_unit" || true
  journalctl -u "$backend_unit" -n "${CUTOVER_HOST_BACKEND_JOURNAL_LINES:-80}" --no-pager || true
}

host_loopback_port_present() {
  local port="$1"
  "$ss_bin" -ltn 2>/dev/null | grep -q "127.0.0.1:${port}"
}

count_active_streams() {
  if [[ -n "${CUTOVER_ACTIVE_STREAMS_OVERRIDE:-}" ]]; then
    printf '%s\n' "${CUTOVER_ACTIVE_STREAMS_OVERRIDE}"
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

ensure_service_inactive() {
  local container_name="$1"
  if [[ "$dry_run" == "1" ]]; then
    echo "[dry-run] stop container $container_name if running"
    return 0
  fi

  local status
  status="$("$docker_bin" inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
  if [[ "$status" == "running" ]]; then
    "$docker_bin" stop "$container_name" >/dev/null
    echo "Stopped container $container_name"
  fi
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
if [[ -n "${CUTOVER_RUNTIME_MODE_OVERRIDE:-}" ]]; then
  runtime_mode="$(printf '%s' "${CUTOVER_RUNTIME_MODE_OVERRIDE}" | tr '[:upper:]' '[:lower:]')"
fi
if [[ "$runtime_mode" != "systemd" ]]; then
  echo "Refusing cutover: STREAM_RUNTIME_MODE must be systemd." >&2
  exit 1
fi

active_streams="$(count_active_streams)"
if ! [[ "$active_streams" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine active stream count: $active_streams" >&2
  exit 1
fi

if (( active_streams > 0 )) && [[ "$allow_live_cutover" != "1" ]]; then
  echo "Refusing cutover: ${active_streams} live stream(s) detected. Set ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=1 only for an explicitly reviewed canary." >&2
  exit 1
fi

if [[ "$skip_dependency_port_check" != "1" ]]; then
  if [[ "$dry_run" == "1" ]]; then
    echo "[dry-run] verify host loopback ports 5432 and 6379 are present"
  else
    if ! host_loopback_port_present 5432; then
      echo "Refusing cutover: host loopback PostgreSQL port 127.0.0.1:5432 is not listening." >&2
      exit 1
    fi
    if ! host_loopback_port_present 6379; then
      echo "Refusing cutover: host loopback Redis port 127.0.0.1:6379 is not listening." >&2
      exit 1
    fi
  fi
fi

if [[ "$stop_docker_runtime" == "1" ]]; then
  ensure_service_inactive "$backend_container"
fi

run_cmd "$systemctl_bin" daemon-reload
run_cmd "$systemctl_bin" enable --now "$backend_unit"

if [[ -n "$stream_unit" ]]; then
  run_cmd "$systemctl_bin" enable --now "ffmpeg@${stream_unit}"
fi

if [[ "$dry_run" != "1" ]]; then
  if ! wait_for_http "host-native backend health endpoint" "$backend_health_url"; then
    dump_host_backend_diagnostics
    exit 1
  fi
fi

if [[ "$restart_frontend_and_tusd" == "1" ]]; then
  run_cmd env \
    FRONTEND_API_PROXY_TARGET="$host_backend_docker_upstream" \
    TUSD_BACKEND_URL="$host_backend_docker_upstream" \
    "$docker_bin" compose -f "$compose_file" up -d frontend tusd
  if [[ "$dry_run" != "1" ]]; then
    ensure_host_backend_bridge_firewall
    wait_for_http "frontend health endpoint" "$frontend_health_url"
    wait_for_tusd_backend_http
  fi
fi

echo "Host runtime cutover completed."
