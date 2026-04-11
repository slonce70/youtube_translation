#!/usr/bin/env bash
set -euo pipefail

docker_bin="${DOCKER_BIN:-docker}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
postgres_container="${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
backend_container="${BACKEND_CONTAINER_NAME:-youtube-streaming-backend}"
runner_container="${RUNNER_CONTAINER_NAME:-youtube-streaming-runner}"
backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
stream_unit_template="${HOST_STREAM_UNIT_TEMPLATE:-ffmpeg@}"
install_root="${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
ss_bin="${SS_BIN:-ss}"

detect_host_binary() {
  local candidate
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      printf 'present:%s' "$candidate"
      return 0
    fi
  done
  echo "missing"
}

check_container_status() {
  local name="$1"
  "$docker_bin" inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "missing"
}

count_active_streams() {
  if ! "$docker_bin" ps --format '{{.Names}}' | grep -qx "$postgres_container"; then
    echo "unknown"
    return 0
  fi

  "$docker_bin" exec "$postgres_container" \
    psql -U youtube_user -d youtube_streaming -tAc \
    "SELECT count(*) FROM streams WHERE status IN ('running','starting','stopping');" \
    | tr -d '[:space:]'
}

unit_state() {
  local unit="$1"
  local enabled
  local active
  enabled="$("$systemctl_bin" is-enabled "$unit" 2>/dev/null || true)"
  active="$("$systemctl_bin" is-active "$unit" 2>/dev/null || true)"
  printf '%s/%s' "${enabled:-unknown}" "${active:-unknown}"
}

loopback_port_state() {
  local port="$1"
  if "$ss_bin" -ltn 2>/dev/null | grep -q "127.0.0.1:${port}"; then
    echo present
    return 0
  fi
  echo missing
}

echo "install_root=$install_root"
echo "active_runtime_streams=$(count_active_streams)"
echo "docker_backend=$(check_container_status "$backend_container")"
echo "docker_runner=$(check_container_status "$runner_container")"
echo "host_backend_unit=$(unit_state "$backend_unit")"
echo "ffmpeg_template_unit=$(test -f /etc/systemd/system/ffmpeg@.service && echo present || echo missing)"
echo "streaming_slice=$(test -f /etc/systemd/system/streaming.slice && echo present || echo missing)"
echo "host_backend_unit_file=$(test -f /etc/systemd/system/${backend_unit}.service && echo present || echo missing)"
echo "host_backend_python=$(detect_host_binary \
  "$install_root/backend/.venv/bin/python" \
  "$install_root/backend/.venv/bin/python3" \
  "$install_root/.venv/bin/python" \
  "$install_root/.venv/bin/python3")"
echo "host_backend_uvicorn=$(detect_host_binary \
  "$install_root/backend/.venv/bin/uvicorn" \
  "$install_root/.venv/bin/uvicorn")"
echo "host_loopback_postgres=$(loopback_port_state 5432)"
echo "host_loopback_redis=$(loopback_port_state 6379)"
echo "host_loopback_backend=$(loopback_port_state 8000)"
echo "host_loopback_runner=$(loopback_port_state 9001)"
