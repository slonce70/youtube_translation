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
all_services=(postgres redis backend tusd frontend runner mediamtx)
services=()
tmp_dir="$(mktemp -d)"
registry_host="${REGISTRY_HOST:-ghcr.io}"
image_namespace="${IMAGE_NAMESPACE:-ghcr.io/slonce70}"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

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
  if [[ "$allow_live_restart" == "1" ]]; then
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

parse_selected_services

deploy_ref="${GITHUB_SHA:-$(git rev-parse HEAD)}"
export BACKEND_IMAGE="${BACKEND_IMAGE:-${image_namespace}/youtube_translation-backend:${deploy_ref}}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-${image_namespace}/youtube_translation-frontend:${deploy_ref}}"
export TUSD_IMAGE="${TUSD_IMAGE:-${image_namespace}/youtube_translation-tusd:${deploy_ref}}"

prepare_linux_persistence
verify_linux_persistence
ensure_persistent_storage

echo "Validating compose config..."
docker compose -f "$compose_file" config >/dev/null

registry_login
guard_stream_runtime
echo "Deploying services via registry images pinned to ${deploy_ref}: ${services[*]}"
docker compose -f "$compose_file" pull "${services[@]}"
docker compose -f "$compose_file" up -d --no-build --remove-orphans "${services[@]}"

if service_selected backend; then
  wait_for_http "backend health endpoint" "http://127.0.0.1:8000/health" -fsS --max-time 5
fi
if service_selected frontend; then
  wait_for_http "frontend health endpoint" "http://127.0.0.1:3000/api/health" -fsS --max-time 5
fi
if service_selected tusd; then
  wait_for_http "tusd" "http://127.0.0.1:1080/" -sS -o /dev/null --max-time 5
fi

if [[ "${DEPLOY_SYNC_HOST_CADDY:-0}" == "1" ]]; then
  sync_host_caddy
fi

echo "Deployment complete for commit $(git rev-parse --short HEAD)"
docker compose -f "$compose_file" ps
