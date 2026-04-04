#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/docker/docker-compose.yml"
backend_env="$repo_root/backend/.env"
root_env="$repo_root/.env"
caddy_template="$repo_root/docker/Caddyfile.template"
host_caddy_target="${HOST_CADDYFILE_PATH:-/etc/caddy/Caddyfile}"
render_caddy_script="$repo_root/scripts/render_caddyfile.py"
services=(postgres redis backend tusd frontend runner mediamtx)
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

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
set +a

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "POSTGRES_PASSWORD must be set via backend/.env or .env" >&2
  exit 1
fi

echo "Validating compose config..."
docker compose -f "$compose_file" config >/dev/null

echo "Deploying services: ${services[*]}"
docker compose -f "$compose_file" up -d --build --remove-orphans "${services[@]}"

wait_for_http "backend health endpoint" "http://127.0.0.1:8000/health" -fsS --max-time 5
wait_for_http "frontend health endpoint" "http://127.0.0.1:3000/api/health" -fsS --max-time 5
wait_for_http "tusd" "http://127.0.0.1:1080/" -sS -o /dev/null --max-time 5

sync_host_caddy

echo "Deployment complete for commit $(git rev-parse --short HEAD)"
docker compose -f "$compose_file" ps
