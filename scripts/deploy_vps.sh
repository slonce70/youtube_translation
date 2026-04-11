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
all_services=(postgres redis backend tusd frontend runner mediamtx)
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

  if [[ -x "$repo_root/scripts/check_host_runtime_readiness.sh" ]]; then
    run_as_root env \
      "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}" \
      "SYSTEMD_TARGET_DIR=${SYSTEMD_TARGET_DIR:-/etc/systemd/system}" \
      "SYSTEMD_SERVICE_USER=${SYSTEMD_SERVICE_USER:-streambot}" \
      "$repo_root/scripts/check_host_runtime_readiness.sh" || true
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
      postgres|redis|backend|tusd|frontend|runner|mediamtx)
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
  if ! flag_enabled "$install_units"; then
    return 0
  fi

  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    echo "Skipping systemd unit installation: STREAM_RUNTIME_MODE is not systemd."
    return 0
  fi

  echo "Installing host-native systemd runtime unit files..."
  local env_args=(
    "SYSTEMD_TARGET_DIR=${SYSTEMD_TARGET_DIR:-/etc/systemd/system}"
    "SYSTEMD_INSTALL_ROOT=${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
    "SYSTEMD_SERVICE_USER=${SYSTEMD_SERVICE_USER:-streambot}"
    "SYSTEMD_SERVICE_GROUP=${SYSTEMD_SERVICE_GROUP:-${SYSTEMD_SERVICE_USER:-streambot}}"
    "SYSTEMD_ENSURE_SERVICE_ACCOUNT=${SYSTEMD_ENSURE_SERVICE_ACCOUNT:-1}"
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
    "RUNNER_CONTAINER_NAME=${RUNNER_CONTAINER_NAME:-youtube-streaming-runner}"
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
    "ROLLBACK_DOCKER_STREAM_RUNTIME_MODE=${ROLLBACK_DOCKER_STREAM_RUNTIME_MODE:-supervisor}"
    "ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=${ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK:-0}"
  )
  if [[ -n "${DEPLOY_ROLLBACK_STREAM_UNIT:-}" ]]; then
    env_args+=("HOST_STREAM_UNIT_NAME=${DEPLOY_ROLLBACK_STREAM_UNIT}")
  fi
  run_as_root env "${env_args[@]}" "$host_runtime_rollback_script"
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
      "$repo_root/scripts/check_host_runtime_readiness.sh"
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
  export HOST_SUPERVISORD_DIR="${HOST_SUPERVISORD_DIR:-$PERSISTENT_STORAGE_ROOT/supervisord}"
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
    "$HOST_LOGS_DIR" \
    "$HOST_SUPERVISORD_DIR"; do
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

ensure_persistent_storage() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  sync_legacy_dir "uploads" "$repo_root/backend/uploads" "$HOST_UPLOADS_DIR"
  sync_legacy_dir "streams" "$repo_root/backend/streams" "$HOST_STREAMS_DIR"
  sync_legacy_dir "logs" "$repo_root/backend/logs" "$HOST_LOGS_DIR"
  sync_legacy_dir "supervisord state" "$repo_root/backend/supervisord" "$HOST_SUPERVISORD_DIR"

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

ensure_host_runtime_mode_alignment
parse_selected_services

deploy_ref="${GITHUB_SHA:-$(git rev-parse HEAD)}"
export BACKEND_IMAGE="${BACKEND_IMAGE:-${image_namespace}/youtube_translation-backend:${deploy_ref}}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-${image_namespace}/youtube_translation-frontend:${deploy_ref}}"
export TUSD_IMAGE="${TUSD_IMAGE:-${image_namespace}/youtube_translation-tusd:${deploy_ref}}"

prepare_linux_persistence
verify_linux_persistence
ensure_persistent_storage

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
if ! flag_enabled "$skip_docker_deploy" && [[ "${#services[@]}" -gt 0 ]]; then
  echo "Deploying services via registry images pinned to ${deploy_ref}: ${services[*]}"
  docker compose -f "$compose_file" pull "${services[@]}"

  compose_up_args=(-d --no-build --remove-orphans)
  if [[ "${#services[@]}" -lt "${#all_services[@]}" ]]; then
    compose_up_args=(--no-deps "${compose_up_args[@]}")
  fi

  docker compose -f "$compose_file" up "${compose_up_args[@]}" "${services[@]}"

  if service_selected backend; then
    wait_for_http "backend health endpoint" "http://127.0.0.1:8000/health" -fsS --max-time 5
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

maybe_restart_host_native_backend
maybe_run_host_runtime_cutover

echo "Deployment complete for commit $(git rev-parse --short HEAD)"
if ! flag_enabled "$skip_docker_deploy"; then
  docker compose -f "$compose_file" ps
fi
