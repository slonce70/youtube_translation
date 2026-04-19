#!/usr/bin/env bash
set -euo pipefail

docker_bin="${DOCKER_BIN:-docker}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
postgres_container="${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
backend_container="${BACKEND_CONTAINER_NAME:-youtube-streaming-backend}"
backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
stream_unit_template="${HOST_STREAM_UNIT_TEMPLATE:-ffmpeg@}"
install_root="${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
service_user="${SYSTEMD_SERVICE_USER:-streambot}"
systemd_target_dir="${SYSTEMD_TARGET_DIR:-/etc/systemd/system}"
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

backend_port_state() {
  if "$ss_bin" -ltn 2>/dev/null | awk '
    $4 ~ /:8000$/ &&
    ($4 ~ /^127\.0\.0\.1:8000$/ || $4 ~ /^0\.0\.0\.0:8000$/ || $4 ~ /^172\.[0-9]+\.[0-9]+\.[0-9]+:8000$/ || $4 ~ /^\[::\]:8000$/) {
      found = 1
    }
    END { exit found ? 0 : 1 }
  '; then
    echo present
    return 0
  fi
  echo missing
}

run_as_service_user() {
  local target_user="$1"
  shift

  if ! id "$target_user" >/dev/null 2>&1; then
    return 11
  fi

  if [[ "$(id -un)" == "$target_user" ]]; then
    "$@"
    return $?
  fi

  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$target_user" -- "$@"
    return $?
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo -n -u "$target_user" "$@"
    return $?
  fi

  return 12
}

service_user_state() {
  if id "$service_user" >/dev/null 2>&1; then
    echo present
    return 0
  fi

  echo missing
}

service_user_systemctl_access() {
  local probe_unit="${HOST_STREAM_PERMISSION_PROBE_UNIT:-${stream_unit_template}__readiness_probe}"

  if [[ ! -f "$systemd_target_dir/ffmpeg@.service" ]]; then
    echo "unknown:unit_template_missing"
    return 0
  fi

  local output=""
  local rc=0
  output="$(run_as_service_user "$service_user" "$systemctl_bin" start --dry-run "$probe_unit" 2>&1)" || rc=$?

  case "$rc" in
    0)
      echo "allowed"
      ;;
    11)
      echo "unknown:user_missing"
      ;;
    12)
      echo "unknown:no_impersonation_tool"
      ;;
    *)
      if printf '%s' "$output" | grep -qi "access denied\\|not authorized\\|authentication is required\\|interactive authentication required"; then
        echo "denied"
      else
        echo "denied"
      fi
      ;;
  esac
}

echo "install_root=$install_root"
echo "host_service_user=$service_user"
echo "host_service_user_exists=$(service_user_state)"
echo "active_runtime_streams=$(count_active_streams)"
echo "docker_backend=$(check_container_status "$backend_container")"
echo "host_backend_unit=$(unit_state "$backend_unit")"
echo "ffmpeg_template_unit=$(test -f "$systemd_target_dir/ffmpeg@.service" && echo present || echo missing)"
echo "streaming_slice=$(test -f "$systemd_target_dir/streaming.slice" && echo present || echo missing)"
echo "host_backend_unit_file=$(test -f "$systemd_target_dir/${backend_unit}.service" && echo present || echo missing)"
echo "host_backend_python_backend=$(detect_host_binary \
  "$install_root/backend/.venv/bin/python" \
  "$install_root/backend/.venv/bin/python3")"
echo "host_backend_python_repo=$(detect_host_binary \
  "$install_root/.venv/bin/python" \
  "$install_root/.venv/bin/python3")"
echo "host_backend_python=$(detect_host_binary \
  "$install_root/backend/.venv/bin/python" \
  "$install_root/backend/.venv/bin/python3" \
  "$install_root/.venv/bin/python" \
  "$install_root/.venv/bin/python3")"
echo "host_backend_uvicorn_backend=$(detect_host_binary \
  "$install_root/backend/.venv/bin/uvicorn")"
echo "host_backend_uvicorn_repo=$(detect_host_binary \
  "$install_root/.venv/bin/uvicorn")"
echo "host_backend_uvicorn=$(detect_host_binary \
  "$install_root/backend/.venv/bin/uvicorn" \
  "$install_root/.venv/bin/uvicorn")"
echo "host_service_user_systemctl=$(service_user_systemctl_access)"
echo "host_loopback_postgres=$(loopback_port_state 5432)"
echo "host_loopback_redis=$(loopback_port_state 6379)"
echo "host_loopback_backend=$(backend_port_state)"
echo "host_loopback_runner=$(loopback_port_state 9001)"
