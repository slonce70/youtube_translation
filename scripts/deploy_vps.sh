#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/docker/docker-compose.yml"
backend_env="$repo_root/backend/.env"
root_env="$repo_root/.env"
frontend_env="$repo_root/frontend/.env.local"
caddy_template="$repo_root/docker/Caddyfile.template"
host_caddy_target="${HOST_CADDYFILE_PATH:-/etc/caddy/Caddyfile}"
render_caddy_script="$repo_root/scripts/render_caddyfile.py"
runtime_guards_script="$repo_root/scripts/runtime_guards.sh"
systemd_runtime_installer="$repo_root/scripts/install_systemd_runtime.sh"
host_native_venv_provisioner="$repo_root/scripts/provision_host_native_backend_venv.sh"
host_runtime_cutover_script="$repo_root/scripts/cutover_host_runtime.sh"
host_runtime_rollback_script="$repo_root/scripts/rollback_host_runtime.sh"
all_services=(postgres redis backend tusd frontend mediamtx)
services=()
tmp_dir="$(mktemp -d)"
registry_host="${REGISTRY_HOST:-ghcr.io}"
image_namespace="${IMAGE_NAMESPACE:-ghcr.io/slonce70}"
skip_docker_deploy="${DEPLOY_SKIP_DOCKER:-0}"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

# shellcheck disable=SC1090
source "$runtime_guards_script"

flag_enabled() {
  local raw_value="${1:-0}"
  raw_value="$(printf '%s' "$raw_value" | tr '[:upper:]' '[:lower:]')"
  case "$raw_value" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

upsert_env_kv() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN {
      updated = 0
      pattern = "^[[:space:]]*" key "="
    }
    $0 ~ pattern {
      if (updated == 0) {
        print key "=" value
        updated = 1
      }
      next
    }
    {
      print
    }
    END {
      if (updated == 0) {
        print key "=" value
      }
    }
  ' "$env_file" >"$tmp_file"

  mv "$tmp_file" "$env_file"
}

registry_login() {
  if [[ -z "${REGISTRY_PASSWORD:-}" ]]; then
    return 0
  fi

  if [[ -z "${REGISTRY_USER:-}" ]]; then
    echo "REGISTRY_USER is required when REGISTRY_PASSWORD is provided" >&2
    exit 1
  fi

  echo "Logging in to container registry ${registry_host}..."
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$registry_host" --username "$REGISTRY_USER" --password-stdin >/dev/null
}

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  echo "This deploy path needs root or passwordless sudo for: $*" >&2
  exit 1
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local curl_args=("${@:3}")

  echo "Waiting for ${label}..."
  for _ in $(seq 1 30); do
    if curl "${curl_args[@]}" "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done

  curl "${curl_args[@]}" "$url" >/dev/null
}

dump_host_backend_diagnostics() {
  local backend_unit="$1"

  echo "Collecting host-native backend diagnostics for ${backend_unit}..."
  run_as_root systemctl show \
    --property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts \
    "$backend_unit" || true
  run_as_root systemctl status --no-pager -l "$backend_unit" || true
  run_as_root journalctl -u "$backend_unit" -n "${DEPLOY_HOST_BACKEND_JOURNAL_LINES:-80}" --no-pager || true

  if [[ -f "$repo_root/scripts/check_host_runtime_readiness.sh" ]]; then
    run_as_root env \
      "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}" \
      "SYSTEMD_TARGET_DIR=${SYSTEMD_TARGET_DIR:-/etc/systemd/system}" \
      "SYSTEMD_SERVICE_USER=${SYSTEMD_SERVICE_USER:-streambot}" \
      bash "$repo_root/scripts/check_host_runtime_readiness.sh" || true
  fi
}

count_active_streams() {
  local postgres_container="youtube-streaming-postgres"

  if ! docker ps --format '{{.Names}}' | grep -qx "$postgres_container"; then
    echo 0
    return 0
  fi

  docker exec "$postgres_container" \
    psql -U youtube_user -d youtube_streaming -tAc \
    "SELECT count(*) FROM streams WHERE status IN ('running', 'starting', 'stopping');" \
    | tr -d '[:space:]'
}

service_selected() {
  local needle="$1"
  local service
  for service in "${services[@]}"; do
    if [[ "$service" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

parse_selected_services() {
  if flag_enabled "$skip_docker_deploy"; then
    services=()
    return 0
  fi

  local requested="${DEPLOY_SERVICES:-}"
  local normalized=()
  local seen=""
  local item

  if [[ -z "$requested" ]]; then
    services=("${all_services[@]}")
    return 0
  fi

  requested="${requested//,/ }"
  for item in $requested; do
    case "$item" in
      postgres|redis|backend|tusd|frontend|mediamtx)
        if [[ " $seen " != *" $item "* ]]; then
          normalized+=("$item")
          seen+=" $item"
        fi
        ;;
      *)
        echo "Unknown deploy service requested: $item" >&2
        exit 1
        ;;
    esac
  done

  if [[ "${#normalized[@]}" -eq 0 ]]; then
    echo "DEPLOY_SERVICES resolved to an empty service list" >&2
    exit 1
  fi

  services=("${normalized[@]}")
}

guard_stream_runtime() {
  local allow_live_restart="${ALLOW_LIVE_STREAM_RESTARTS:-0}"
  if flag_enabled "$allow_live_restart"; then
    echo "ALLOW_LIVE_STREAM_RESTARTS=1 set; bypassing live-stream deploy guard."
    return 0
  fi

  local active_streams
  active_streams="$(count_active_streams)"
  if ! [[ "$active_streams" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine active stream count: $active_streams" >&2
    exit 1
  fi

  if (( active_streams <= 0 )); then
    return 0
  fi

  local service
  for service in "${services[@]}"; do
    if [[ "$service" != "frontend" ]]; then
      echo "Refusing deploy: ${active_streams} live stream(s) currently running and service '$service' would be restarted." >&2
      echo "Only a frontend-only deploy is allowed during an active live stream." >&2
      echo "If you intentionally need to override, set ALLOW_LIVE_STREAM_RESTARTS=1 for that deploy." >&2
      exit 1
    fi
  done

  if (( active_streams > 0 )); then
    echo "Active live stream detected; allowing frontend-only deploy without touching runtime services."
  fi
}

maybe_install_systemd_runtime_units() {
  local install_units="${DEPLOY_INSTALL_SYSTEMD_UNITS:-0}"

  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    echo "Skipping systemd unit installation: STREAM_RUNTIME_MODE is not systemd."
    return 0
  fi

  local prepare_host_native="${DEPLOY_PREPARE_HOST_NATIVE:-0}"
  local activate_backend="${DEPLOY_ACTIVATE_HOST_BACKEND:-0}"
  local restart_host_backend="${DEPLOY_RESTART_HOST_BACKEND:-0}"
  local activate_cutover="${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"

  if ! flag_enabled "$install_units"; then
    if ! host_backend_is_active \
      && ! flag_enabled "$prepare_host_native" \
      && ! flag_enabled "$activate_backend" \
      && ! flag_enabled "$restart_host_backend" \
      && ! flag_enabled "$activate_cutover"; then
      return 0
    fi
  fi

  echo "Installing host-native systemd runtime unit files..."
  local env_args=(
    "SYSTEMD_TARGET_DIR=${SYSTEMD_TARGET_DIR:-/etc/systemd/system}"
    "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
    "SYSTEMD_SERVICE_USER=${SYSTEMD_SERVICE_USER:-streambot}"
    "SYSTEMD_SERVICE_GROUP=${SYSTEMD_SERVICE_GROUP:-${SYSTEMD_SERVICE_USER:-streambot}}"
    "SYSTEMD_ENSURE_SERVICE_ACCOUNT=${SYSTEMD_ENSURE_SERVICE_ACCOUNT:-1}"
    "SYSTEMD_ALIGN_ENV_PERMISSIONS=${SYSTEMD_ALIGN_ENV_PERMISSIONS:-1}"
    "SYSTEMD_INSTALL_POLKIT=${SYSTEMD_INSTALL_POLKIT:-1}"
    "SYSTEMD_ENABLE_BACKEND=${DEPLOY_ACTIVATE_HOST_BACKEND:-0}"
  )
  if [[ -n "${DEPLOY_ACTIVATE_STREAM_UNIT:-}" ]]; then
    env_args+=("SYSTEMD_ENABLE_STREAM_UNIT=${DEPLOY_ACTIVATE_STREAM_UNIT}")
  fi
  run_as_root env "${env_args[@]}" "$systemd_runtime_installer"
}

host_backend_is_active() {
  local backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
  if ! command -v systemctl >/dev/null 2>&1; then
    return 1
  fi

  systemctl is-active --quiet "$backend_unit"
}

host_runtime_refresh_requested() {
  flag_enabled "${DEPLOY_INSTALL_SYSTEMD_UNITS:-0}" \
    || flag_enabled "${DEPLOY_PREPARE_HOST_NATIVE:-0}" \
    || flag_enabled "${DEPLOY_RESTART_HOST_BACKEND:-0}" \
    || flag_enabled "${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"
}

ensure_host_runtime_mode_alignment() {
  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" == "systemd" ]]; then
    return 0
  fi

  if ! host_runtime_refresh_requested; then
    return 0
  fi

  if ! host_backend_is_active && ! flag_enabled "${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"; then
    return 0
  fi

  echo "Host-native deploy path requested while STREAM_RUNTIME_MODE=${runtime_mode:-unset}; aligning env files to systemd."
  upsert_env_kv "$backend_env" "STREAM_RUNTIME_MODE" "systemd"
  if [[ -f "$root_env" ]]; then
    upsert_env_kv "$root_env" "STREAM_RUNTIME_MODE" "systemd"
  fi
  export STREAM_RUNTIME_MODE="systemd"
}

ensure_environment_alignment() {
  local deploy_environment="${DEPLOY_ENVIRONMENT:-production}"
  deploy_environment="$(printf '%s' "$deploy_environment" | tr '[:upper:]' '[:lower:]')"

  case "$deploy_environment" in
    development|test|staging|production)
      ;;
    *)
      echo "DEPLOY_ENVIRONMENT must be one of development, test, staging, production." >&2
      exit 1
      ;;
  esac

  local effective_environment="${ENVIRONMENT:-}"
  if [[ -n "$effective_environment" ]]; then
    effective_environment="$(printf '%s' "$effective_environment" | tr '[:upper:]' '[:lower:]')"
  else
    effective_environment="$deploy_environment"
    echo "ENVIRONMENT missing in backend/.env; aligning deploy environment to ${effective_environment}."
  fi

  case "$effective_environment" in
    development|test|staging|production)
      ;;
    *)
      echo "ENVIRONMENT must be one of development, test, staging, production." >&2
      exit 1
      ;;
  esac

  if ! grep -Eq '^[[:space:]]*ENVIRONMENT=' "$backend_env"; then
    upsert_env_kv "$backend_env" "ENVIRONMENT" "$effective_environment"
  fi
  if [[ -f "$root_env" ]] && ! grep -Eq '^[[:space:]]*ENVIRONMENT=' "$root_env"; then
    upsert_env_kv "$root_env" "ENVIRONMENT" "$effective_environment"
  fi

  export ENVIRONMENT="$effective_environment"
}

ensure_host_storage_env_alignment() {
  if ! host_runtime_refresh_requested; then
    return 0
  fi

  if ! host_backend_is_active && ! flag_enabled "${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"; then
    return 0
  fi

  local changed=0
  local current_upload_dir="${UPLOAD_DIR:-}"
  local current_stream_dir="${STREAM_DIR:-}"

  if [[ "$current_upload_dir" != "./uploads" ]]; then
    upsert_env_kv "$backend_env" "UPLOAD_DIR" "./uploads"
    export UPLOAD_DIR="./uploads"
    changed=1
  fi

  if [[ "$current_stream_dir" != "./streams" ]]; then
    upsert_env_kv "$backend_env" "STREAM_DIR" "./streams"
    export STREAM_DIR="./streams"
    changed=1
  fi

  if [[ "$changed" == "1" ]]; then
    echo "Host-native deploy path requested; aligning backend/.env storage dirs to repo-local persistent symlink paths."
  fi
}

ensure_host_ffmpeg_env_alignment() {
  if ! host_runtime_refresh_requested; then
    return 0
  fi

  if ! host_backend_is_active && ! flag_enabled "${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"; then
    return 0
  fi

  local changed=0
  local current_ffmpeg_bin="${FFMPEG_BIN:-}"
  local current_ffprobe_bin="${FFPROBE_BIN:-}"

  if [[ "$current_ffmpeg_bin" != "/usr/bin/ffmpeg" ]]; then
    upsert_env_kv "$backend_env" "FFMPEG_BIN" "/usr/bin/ffmpeg"
    export FFMPEG_BIN="/usr/bin/ffmpeg"
    changed=1
  fi

  if [[ "$current_ffprobe_bin" != "/usr/bin/ffprobe" ]]; then
    upsert_env_kv "$backend_env" "FFPROBE_BIN" "/usr/bin/ffprobe"
    export FFPROBE_BIN="/usr/bin/ffprobe"
    changed=1
  fi

  if [[ "$changed" == "1" ]]; then
    echo "Host-native deploy path requested; aligning backend/.env FFmpeg binaries to Linux system paths."
  fi
}

maybe_provision_host_native_backend_venv() {
  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    return 0
  fi

  local prepare_host_native="${DEPLOY_PREPARE_HOST_NATIVE:-0}"
  local install_units="${DEPLOY_INSTALL_SYSTEMD_UNITS:-0}"
  local activate_backend="${DEPLOY_ACTIVATE_HOST_BACKEND:-0}"
  local activate_cutover="${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"

  if ! flag_enabled "$prepare_host_native" \
    && ! flag_enabled "$install_units" \
    && ! flag_enabled "$activate_backend" \
    && ! flag_enabled "$activate_cutover"; then
    if ! host_backend_is_active; then
      return 0
    fi
  fi

  echo "Provisioning host-native backend venv..."
  local env_args=(
    "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
    "SYSTEMD_BACKEND_DIR=${SYSTEMD_BACKEND_DIR:-${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}/backend}"
    "SYSTEMD_BACKEND_VENV_DIR=${SYSTEMD_BACKEND_VENV_DIR:-${SYSTEMD_BACKEND_DIR:-${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}/backend}/.venv}"
    "HOST_BACKEND_REQUIREMENTS_FILE=${HOST_BACKEND_REQUIREMENTS_FILE:-${SYSTEMD_BACKEND_DIR:-${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}/backend}/requirements.txt}"
    "HOST_BACKEND_BOOTSTRAP_PYTHON=${HOST_BACKEND_BOOTSTRAP_PYTHON:-python3}"
  )
  run_as_root env "${env_args[@]}" "$host_native_venv_provisioner"
}

maybe_run_host_runtime_cutover() {
  local activate_cutover="${DEPLOY_CUTOVER_HOST_RUNTIME:-0}"
  if ! flag_enabled "$activate_cutover"; then
    return 0
  fi

  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    echo "Skipping host runtime cutover: STREAM_RUNTIME_MODE is not systemd."
    return 0
  fi

  echo "Running host-native runtime cutover helper..."
  local env_args=(
    "DOCKER_BIN=${DOCKER_BIN:-docker}"
    "SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}"
    "CURL_BIN=${CURL_BIN:-curl}"
    "POSTGRES_CONTAINER_NAME=${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
    "BACKEND_CONTAINER_NAME=${BACKEND_CONTAINER_NAME:-youtube-streaming-backend}"
    "HOST_BACKEND_UNIT_NAME=${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
    "HOST_BACKEND_HEALTH_URL=${HOST_BACKEND_HEALTH_URL:-http://127.0.0.1:8000/health}"
    "CUTOVER_STOP_DOCKER_RUNTIME=${CUTOVER_STOP_DOCKER_RUNTIME:-1}"
    "ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=${ALLOW_LIVE_STREAM_RUNTIME_CUTOVER:-0}"
  )
  if [[ -n "${DEPLOY_CUTOVER_STREAM_UNIT:-}" ]]; then
    env_args+=("HOST_STREAM_UNIT_NAME=${DEPLOY_CUTOVER_STREAM_UNIT}")
  fi
  run_as_root env "${env_args[@]}" "$host_runtime_cutover_script"
}

maybe_run_host_runtime_rollback() {
  local activate_rollback="${DEPLOY_ROLLBACK_HOST_RUNTIME:-0}"
  if ! flag_enabled "$activate_rollback"; then
    return 0
  fi

  echo "Running host-native runtime rollback helper..."
  local env_args=(
    "COMPOSE_FILE=$compose_file"
    "BACKEND_ENV=$backend_env"
    "ROOT_ENV=$root_env"
    "DOCKER_BIN=${DOCKER_BIN:-docker}"
    "SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}"
    "CURL_BIN=${CURL_BIN:-curl}"
    "POSTGRES_CONTAINER_NAME=${POSTGRES_CONTAINER_NAME:-youtube-streaming-postgres}"
    "HOST_BACKEND_UNIT_NAME=${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
    "DOCKER_BACKEND_HEALTH_URL=${DOCKER_BACKEND_HEALTH_URL:-http://127.0.0.1:8000/health}"
    "ROLLBACK_START_DOCKER_RUNTIME=${ROLLBACK_START_DOCKER_RUNTIME:-1}"
    "ROLLBACK_DOCKER_STREAM_RUNTIME_MODE=${ROLLBACK_DOCKER_STREAM_RUNTIME_MODE:-manager}"
    "ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=${ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK:-0}"
  )
  if [[ -n "${DEPLOY_ROLLBACK_STREAM_UNIT:-}" ]]; then
    env_args+=("HOST_STREAM_UNIT_NAME=${DEPLOY_ROLLBACK_STREAM_UNIT}")
  fi
  run_as_root env "${env_args[@]}" "$host_runtime_rollback_script"
}

should_apply_database_migrations() {
  if flag_enabled "${DEPLOY_APPLY_MIGRATIONS:-1}"; then
    if service_selected backend; then
      return 0
    fi

    if host_runtime_refresh_requested; then
      return 0
    fi
  fi

  return 1
}

run_database_migrations() {
  if ! should_apply_database_migrations; then
    return 0
  fi

  local migration_python="${HOST_BACKEND_PYTHON_BIN:-}"
  if [[ -z "$migration_python" ]]; then
    if [[ -x "$repo_root/backend/.venv/bin/python" ]]; then
      migration_python="$repo_root/backend/.venv/bin/python"
    else
      migration_python="${HOST_BACKEND_BOOTSTRAP_PYTHON:-python3}"
    fi
  fi

  echo "Applying database migrations before backend activation..."
  (
    cd "$repo_root/backend"
    printf 'yes\n' | "$migration_python" apply_migrations.py
  )
}

maybe_restart_host_native_backend() {
  local restart_host_backend="${DEPLOY_RESTART_HOST_BACKEND:-0}"
  if ! flag_enabled "$restart_host_backend"; then
    return 0
  fi

  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    echo "Skipping host-native backend restart: STREAM_RUNTIME_MODE is not systemd."
    return 0
  fi

  local backend_unit="${HOST_BACKEND_UNIT_NAME:-youtube-backend}"
  local backend_health_url="${HOST_BACKEND_HEALTH_URL:-http://127.0.0.1:8000/health}"

  echo "Restarting host-native backend unit ${backend_unit}..."
  run_as_root systemctl daemon-reload
  if ! run_as_root systemctl restart "$backend_unit"; then
    dump_host_backend_diagnostics "$backend_unit"
    exit 1
  fi
  if ! run_as_root systemctl is-active --quiet "$backend_unit"; then
    dump_host_backend_diagnostics "$backend_unit"
    exit 1
  fi
  if ! wait_for_http "host-native backend health endpoint" "$backend_health_url" -fsS --max-time 5; then
    dump_host_backend_diagnostics "$backend_unit"
    exit 1
  fi

  if flag_enabled "${DEPLOY_VERIFY_HOST_RUNTIME:-1}"; then
    echo "Verifying host-native runtime readiness after backend restart..."
    run_as_root env \
      "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}" \
      "SYSTEMD_TARGET_DIR=${SYSTEMD_TARGET_DIR:-/etc/systemd/system}" \
      "SYSTEMD_SERVICE_USER=${SYSTEMD_SERVICE_USER:-streambot}" \
      bash "$repo_root/scripts/check_host_runtime_readiness.sh"
  fi
}

prepare_linux_persistence() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  export PERSISTENT_STORAGE_ROOT="${PERSISTENT_STORAGE_ROOT:-/opt/youtube_translation_data}"
  export HOST_UPLOADS_DIR="${HOST_UPLOADS_DIR:-$PERSISTENT_STORAGE_ROOT/uploads}"
  export HOST_STREAMS_DIR="${HOST_STREAMS_DIR:-$PERSISTENT_STORAGE_ROOT/streams}"
  export HOST_LOGS_DIR="${HOST_LOGS_DIR:-$PERSISTENT_STORAGE_ROOT/logs}"
  export POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-youtube_translation_postgres_data}"
  export CADDY_DATA_VOLUME_NAME="${CADDY_DATA_VOLUME_NAME:-youtube_translation_caddy_data}"
  export CADDY_CONFIG_VOLUME_NAME="${CADDY_CONFIG_VOLUME_NAME:-youtube_translation_caddy_config}"
  export LEGACY_POSTGRES_VOLUME_NAME="${LEGACY_POSTGRES_VOLUME_NAME:-docker_postgres-data}"
}

verify_linux_persistence() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  local persistent_target
  for persistent_target in \
    "$HOST_UPLOADS_DIR" \
    "$HOST_STREAMS_DIR" \
    "$HOST_LOGS_DIR"; do
    if [[ "$persistent_target" != /* ]]; then
      echo "Persistence target must be an absolute path on Linux: $persistent_target" >&2
      exit 1
    fi

    if [[ "$persistent_target" == "$repo_root" || "$persistent_target" == "$repo_root/"* ]]; then
      echo "Refusing to deploy with repo-scoped persistence target: $persistent_target" >&2
      exit 1
    fi
  done
}

sync_legacy_dir() {
  local label="$1"
  local source_dir="$2"
  local target_dir="$3"

  run_as_root mkdir -p "$target_dir"

  if [[ "$source_dir" == "$target_dir" || ! -d "$source_dir" ]]; then
    return 0
  fi

  echo "Syncing ${label} into persistent storage..."
  if command -v rsync >/dev/null 2>&1; then
    run_as_root rsync -a --ignore-existing "$source_dir"/ "$target_dir"/
  else
    run_as_root sh -c 'cp -an "$1"/. "$2"/ 2>/dev/null || true' sh "$source_dir" "$target_dir"
  fi
}

ensure_repo_path_symlink() {
  local label="$1"
  local repo_dir="$2"
  local target_dir="$3"

  run_as_root mkdir -p "$(dirname "$repo_dir")"
  run_as_root mkdir -p "$target_dir"

  if [[ -L "$repo_dir" ]]; then
    local current_target
    current_target="$(readlink "$repo_dir")"
    if [[ "$current_target" == "$target_dir" ]]; then
      return 0
    fi
    run_as_root rm "$repo_dir"
  elif [[ -d "$repo_dir" ]]; then
    sync_legacy_dir "$label" "$repo_dir" "$target_dir"
    run_as_root rm -rf "$repo_dir"
  elif [[ -e "$repo_dir" ]]; then
    echo "Refusing to replace non-directory path with symlink: $repo_dir" >&2
    exit 1
  fi

  run_as_root ln -s "$target_dir" "$repo_dir"
}

ensure_persistent_storage() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  sync_legacy_dir "uploads" "$repo_root/backend/uploads" "$HOST_UPLOADS_DIR"
  sync_legacy_dir "streams" "$repo_root/backend/streams" "$HOST_STREAMS_DIR"
  sync_legacy_dir "logs" "$repo_root/backend/logs" "$HOST_LOGS_DIR"

  if docker volume inspect "$POSTGRES_VOLUME_NAME" >/dev/null 2>&1; then
    return 0
  fi

  if ! docker volume inspect "$LEGACY_POSTGRES_VOLUME_NAME" >/dev/null 2>&1; then
    return 0
  fi

  echo "Migrating PostgreSQL volume ${LEGACY_POSTGRES_VOLUME_NAME} -> ${POSTGRES_VOLUME_NAME}..."
  docker volume create "$POSTGRES_VOLUME_NAME" >/dev/null
  docker run --rm \
    -v "${LEGACY_POSTGRES_VOLUME_NAME}:/from:ro" \
    -v "${POSTGRES_VOLUME_NAME}:/to" \
    --entrypoint sh \
    postgres:16 \
    -c 'cd /from && cp -a . /to/'
}

align_host_storage_links() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  local backend_root="${SYSTEMD_BACKEND_DIR:-$repo_root/backend}"
  ensure_repo_path_symlink "uploads" "$backend_root/uploads" "$HOST_UPLOADS_DIR"
  ensure_repo_path_symlink "streams" "$backend_root/streams" "$HOST_STREAMS_DIR"
  ensure_repo_path_symlink "logs" "$backend_root/logs" "$HOST_LOGS_DIR"
}

align_host_storage_permissions() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  local service_group="${SYSTEMD_SERVICE_GROUP:-${SYSTEMD_SERVICE_USER:-streambot}}"
  local target_dir
  for target_dir in \
    "$HOST_UPLOADS_DIR" \
    "$HOST_STREAMS_DIR" \
    "$HOST_LOGS_DIR"; do
    run_as_root mkdir -p "$target_dir"
    run_as_root chgrp -R "$service_group" "$target_dir"
    run_as_root chmod g+rwX "$target_dir"
    run_as_root find "$target_dir" -type d -exec chmod g+rwx,g+s {} +
    run_as_root find "$target_dir" -type f -exec chmod g+rw {} +
  done
}

sync_host_caddy() {
  local rendered_caddy="$tmp_dir/Caddyfile.host"

  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Skipping host Caddy sync: only enabled on Linux deploy targets."
    return 0
  fi

  if [[ ! -f "$caddy_template" ]]; then
    echo "Skipping host Caddy sync: missing template $caddy_template"
    return 0
  fi

  if [[ ! -d "$(dirname "$host_caddy_target")" ]]; then
    echo "Skipping host Caddy sync: target directory $(dirname "$host_caddy_target") not present"
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to render the host Caddyfile" >&2
    exit 1
  fi

  if ! command -v caddy >/dev/null 2>&1; then
    echo "caddy is required to validate the host Caddyfile" >&2
    exit 1
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl is required to reload the host Caddy service" >&2
    exit 1
  fi

  echo "Rendering host Caddy config from git-managed template..."
  python3 "$render_caddy_script" --variant host --template "$caddy_template" --output "$rendered_caddy"
  caddy fmt --overwrite "$rendered_caddy" >/dev/null
  run_as_root caddy validate --config "$rendered_caddy" >/dev/null

  if [[ -f "$host_caddy_target" ]] && cmp -s "$rendered_caddy" "$host_caddy_target"; then
    echo "Host Caddy config already matches git-managed template."
    return 0
  fi

  echo "Installing host Caddy config to $host_caddy_target..."
  run_as_root install -m 0644 "$rendered_caddy" "$host_caddy_target"
  run_as_root caddy validate --config "$host_caddy_target" >/dev/null
  run_as_root systemctl reload caddy
  run_as_root systemctl is-active --quiet caddy
  echo "Host Caddy reloaded from git-managed config."
}

if flag_enabled "${DEPLOY_VPS_SOURCE_ONLY:-0}"; then
  return 0 2>/dev/null || exit 0
fi

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
if [[ -f "$frontend_env" ]]; then
  # shellcheck disable=SC1090
  source "$frontend_env"
fi
set +a

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "POSTGRES_PASSWORD must be set via backend/.env or .env" >&2
  exit 1
fi

ensure_environment_alignment
ensure_host_runtime_mode_alignment
ensure_host_storage_env_alignment
ensure_host_ffmpeg_env_alignment
parse_selected_services

deploy_ref="${GITHUB_SHA:-$(git rev-parse HEAD)}"
export BACKEND_IMAGE="${BACKEND_IMAGE:-${image_namespace}/youtube_translation-backend:${deploy_ref}}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-${image_namespace}/youtube_translation-frontend:${deploy_ref}}"
export TUSD_IMAGE="${TUSD_IMAGE:-${image_namespace}/youtube_translation-tusd:${deploy_ref}}"

prepare_linux_persistence
verify_linux_persistence
ensure_persistent_storage
align_host_storage_links
align_host_storage_permissions

if ! flag_enabled "$skip_docker_deploy"; then
  echo "Validating compose config..."
  docker compose -f "$compose_file" config >/dev/null
fi

if ! flag_enabled "$skip_docker_deploy"; then
  registry_login
fi
maybe_provision_host_native_backend_venv
maybe_install_systemd_runtime_units
maybe_run_host_runtime_rollback
guard_containerized_systemd_runtime "${services[*]}"
guard_stream_runtime
# Migrations must run BEFORE the new backend container is brought up. The
# new ORM may declare columns the old DB schema doesn't have (e.g.
# Sprint 2 added runtime_restart_attempts in migration 037), and any
# SELECT * loaded by SQLAlchemy against the old schema would fail with
# UndefinedColumn. The migration runner uses the host venv python so it
# is unaffected by the container swap.
#
# In the systemd-mode production path, the host backend isn't restarted
# until maybe_restart_host_native_backend below — that function still
# runs after migrations as it should.
if service_selected backend; then
  run_database_migrations
fi

if ! flag_enabled "$skip_docker_deploy" && [[ "${#services[@]}" -gt 0 ]]; then
  echo "Deploying services via registry images pinned to ${deploy_ref}: ${services[*]}"
  docker compose -f "$compose_file" pull "${services[@]}"

  compose_up_args=(-d --no-build --remove-orphans)
  if [[ "${#services[@]}" -lt "${#all_services[@]}" ]]; then
    compose_up_args=(--no-deps "${compose_up_args[@]}")
  fi

  docker compose -f "$compose_file" up "${compose_up_args[@]}" "${services[@]}"

  if service_selected backend; then
    wait_for_http "backend readiness endpoint" "http://127.0.0.1:8000/readyz" -fsS --max-time 5
  fi
  if service_selected frontend; then
    wait_for_http "frontend health endpoint" "http://127.0.0.1:3000/api/health" -fsS --max-time 5
  fi
  if service_selected tusd; then
    wait_for_http "tusd" "http://127.0.0.1:1080/" -sS -o /dev/null --max-time 5
  fi
elif flag_enabled "$skip_docker_deploy"; then
  echo "Skipping Docker deploy because DEPLOY_SKIP_DOCKER=1"
else
  echo "No Docker services selected for deploy."
fi

if flag_enabled "${DEPLOY_SYNC_HOST_CADDY:-0}"; then
  sync_host_caddy
fi

# Backend not selected (e.g. frontend-only deploy) — migrations didn't run
# above; run them now as a safety net so any pending schema changes land
# even on host-only deploys.
if ! service_selected backend; then
  run_database_migrations
fi

# ----------------------------------------------------------------------------
# Belt-and-suspenders: re-issue migration 037's column adds via the *Docker*
# postgres container directly. The host-native python migrator at
# ``backend/apply_migrations.py`` reports success on every deploy and a
# cross-connection probe inside the same Python process confirms the column
# exists, but the host-native systemd backend then crashes on startup with
# ``column streams.runtime_restart_attempts does not exist``. Hypothesis: the
# migrator and the runtime backend resolve ``localhost:5432`` to *different*
# Postgres processes (host-native vs the Docker-mapped one). Sidestep the
# divergence by issuing the DDL through ``docker exec`` against the named
# container the cutover scripts already trust as the production DB
# (``youtube-streaming-postgres``). Migration 037 is idempotent
# (``IF NOT EXISTS``), so this is safe to run on every deploy.
if docker ps --format '{{.Names}}' | grep -qx 'youtube-streaming-postgres'; then
  echo "Reissuing migration 037 column adds via docker exec on youtube-streaming-postgres"
  docker exec -i youtube-streaming-postgres \
    psql -U youtube_user -d youtube_streaming -v ON_ERROR_STOP=1 <<'EOF_037'
ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS runtime_restart_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS runtime_last_failure_at TIMESTAMPTZ;
COMMENT ON COLUMN streams.runtime_restart_attempts IS
    'Persistent FFmpeg restart counter. Survives backend restarts so a flapping stream cannot bypass ffmpeg_auto_restart_attempts ceiling by counting on in-memory amnesia.';
COMMENT ON COLUMN streams.runtime_last_failure_at IS
    'Wall-clock timestamp of the most recent ffmpeg child non-zero exit; used for restart backoff and observability.';
EOF_037
  if [[ $? -ne 0 ]]; then
    echo "WARN: docker-exec migration 037 fallback failed; backend may crash on startup."
  fi
else
  echo "youtube-streaming-postgres container not running; skipping docker-exec safety net."
fi

# ----------------------------------------------------------------------------
# Forensic diag: prod is failing with ``column streams.runtime_restart_attempts
# does not exist`` *after* both the host-native python migrator (against
# ``localhost:5432``) AND the docker-exec psql safety net (inside the
# ``youtube-streaming-postgres`` container) confirm the column is present.
# That means the runtime backend is connecting to a *third* postgres instance
# that neither path reached. Dump all the relevant facts so we can see the
# divergence in the next deploy log.
# ----------------------------------------------------------------------------
echo "=== Forensic dump: where does runtime backend think postgres lives? ==="
echo "--- /opt/youtube_translation/backend/.env (DB host:port only, password redacted) ---"
# Print DATABASE_URL with the password redacted but host/port/db visible —
# we need to see *where* the runtime backend is dialling.
awk -F= '
  /^[[:space:]]*DATABASE_URL=/ {
    # gsub anything between "://...@" to "://***@" so password is masked
    sub(/=.*/, "");
    line = $0;
    val = substr($0, length(line) + 2);
    # Re-read full line then redact
  }
' "$repo_root/backend/.env" 2>/dev/null
grep -E '^[[:space:]]*(DATABASE_URL|POSTGRES_HOST|POSTGRES_PORT|DB_HOST|DB_PORT)=' \
  "$repo_root/backend/.env" 2>/dev/null \
  | sed -E 's#://[^@]*@#://***@#g' \
  | sed -E 's/(PASSWORD=).*/\1***/' \
  || echo "  (.env unreadable)"
echo "--- listening postgres sockets on host ---"
ss -ltnp 2>/dev/null | grep -E '54(32|33|34)\b' || echo "  (no postgres listener on 5432-5434)"
echo "--- docker port mapping for youtube-streaming-postgres ---"
docker port youtube-streaming-postgres 2>/dev/null || echo "  (container not running)"
echo "--- streams table columns in docker postgres (truth source A) ---"
docker exec -i youtube-streaming-postgres psql -U youtube_user -d youtube_streaming -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='streams' AND column_name LIKE 'runtime_%' ORDER BY column_name" \
  2>/dev/null || echo "  (psql failed)"
echo "--- streams table columns visible from host:5432 (truth source B) ---"
PGPASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$repo_root/backend/.env" 2>/dev/null | head -1)" \
  psql -h 127.0.0.1 -p 5432 -U youtube_user -d youtube_streaming -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='streams' AND column_name LIKE 'runtime_%' ORDER BY column_name" \
  2>/dev/null || echo "  (host:5432 psql failed)"
echo "=== /forensic dump ==="

maybe_restart_host_native_backend
maybe_run_host_runtime_cutover

echo "Deployment complete for commit $(git rev-parse --short HEAD)"
if ! flag_enabled "$skip_docker_deploy"; then
  docker compose -f "$compose_file" ps
fi
