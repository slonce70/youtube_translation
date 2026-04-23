#!/usr/bin/env bash
set -euo pipefail

diff_has_paths() {
  local base_sha="$1"
  local pattern="$2"
  local target_sha="${3:?target sha is required}"

  if [[ -z "$base_sha" ]]; then
    return 0
  fi
  if [[ "$base_sha" == "$target_sha" ]]; then
    return 1
  fi

  git diff --name-only "$base_sha" "$target_sha" | grep -Eq "$pattern"
}

diff_has_paths_excluding() {
  local base_sha="$1"
  local include_pattern="$2"
  local exclude_pattern="$3"
  local target_sha="${4:?target sha is required}"

  if [[ -z "$base_sha" ]]; then
    return 0
  fi
  if [[ "$base_sha" == "$target_sha" ]]; then
    return 1
  fi

  local changed_paths
  changed_paths="$(git diff --name-only "$base_sha" "$target_sha")"
  if [[ -n "$exclude_pattern" ]]; then
    changed_paths="$(printf '%s\n' "$changed_paths" | grep -Ev "$exclude_pattern" || true)"
  fi

  printf '%s\n' "$changed_paths" | grep -Eq "$include_pattern"
}

add_service() {
  local service="$1"
  local existing
  for existing in "${services[@]:-}"; do
    if [[ "$existing" == "$service" ]]; then
      return 0
    fi
  done
  services+=("$service")
}

compute_deploy_impact() {
  : "${TARGET_SHA:?TARGET_SHA is required}"

  local frontend_pattern='^frontend/'
  local backend_pattern='^(backend/|docker/docker-compose\.yml$|docker/Caddyfile(\.template)?$|docker/mediamtx\.yml$|scripts/render_caddyfile\.py$)'
  local tusd_pattern='^(backend/tusd-hooks/|docker/tusd\.Dockerfile$|docker/docker-compose\.yml$)'
  local infra_pattern='^(docker/docker-compose\.yml$|docker/Caddyfile(\.template)?$|docker/mediamtx\.yml$|scripts/render_caddyfile\.py$)'
  local host_runtime_pattern='^(backend/|scripts/(deploy_vps|install_systemd_runtime|provision_host_native_backend_venv|run_stream_systemd|check_host_runtime_readiness|cutover_host_runtime|rollback_host_runtime|runtime_guards)\.sh$|docs/systemd/)'
  local backend_ignore_pattern='^(backend/tests/|backend/pytest\.ini$)'

  local frontend_needs_deploy=false
  local backend_needs_deploy=false
  local tusd_needs_deploy=false
  local infra_needs_deploy=false
  local host_runtime_needs_refresh=false
  local host_runtime_managed=false

  if [[ "${HOST_BACKEND_ACTIVE:-false}" == 'true' || "${HOST_BACKEND_UNIT_PRESENT:-false}" == 'true' || "${CONFIGURED_STREAM_RUNTIME_MODE:-}" == 'systemd' ]]; then
    host_runtime_managed=true
  fi

  local effective_frontend_sha="${CURRENT_FRONTEND_SHA:-${VPS_CHECKOUT_SHA:-}}"
  local effective_backend_sha="${CURRENT_BACKEND_SHA:-${VPS_CHECKOUT_SHA:-}}"
  local effective_tusd_sha="${CURRENT_TUSD_SHA:-${VPS_CHECKOUT_SHA:-}}"

  # In host-native mode the deployed backend code comes from the VPS checkout,
  # not the stale docker backend image that may still exist on the host.
  if [[ "$host_runtime_managed" == 'true' && -n "${VPS_CHECKOUT_SHA:-}" ]]; then
    effective_backend_sha="$VPS_CHECKOUT_SHA"
  fi

  if [[ "$effective_frontend_sha" != "$TARGET_SHA" ]] && diff_has_paths "$effective_frontend_sha" "$frontend_pattern" "$TARGET_SHA"; then
    frontend_needs_deploy=true
  fi

  if [[ "$effective_backend_sha" != "$TARGET_SHA" ]] && diff_has_paths_excluding "$effective_backend_sha" "$backend_pattern" "$backend_ignore_pattern" "$TARGET_SHA"; then
    backend_needs_deploy=true
  fi

  if [[ "$effective_tusd_sha" != "$TARGET_SHA" ]] && diff_has_paths "$effective_tusd_sha" "$tusd_pattern" "$TARGET_SHA"; then
    tusd_needs_deploy=true
  fi

  if diff_has_paths "$effective_backend_sha" "$infra_pattern" "$TARGET_SHA" || diff_has_paths "$effective_tusd_sha" "$infra_pattern" "$TARGET_SHA"; then
    infra_needs_deploy=true
  fi

  if [[ "$host_runtime_managed" == 'true' ]] && diff_has_paths_excluding "$effective_backend_sha" "$host_runtime_pattern" "$backend_ignore_pattern" "$TARGET_SHA"; then
    host_runtime_needs_refresh=true
  fi

  services=()
  local sync_host_caddy=0

  if [[ "$infra_needs_deploy" == 'true' ]]; then
    if [[ "$host_runtime_managed" == 'true' ]]; then
      services=(postgres redis tusd frontend mediamtx)
    else
      services=(postgres redis backend tusd frontend mediamtx)
    fi
    sync_host_caddy=1
  else
    if [[ "$backend_needs_deploy" == 'true' && "$host_runtime_managed" != 'true' ]]; then
      add_service backend
    fi
    if [[ "$tusd_needs_deploy" == 'true' ]]; then
      add_service tusd
    fi
    if [[ "$frontend_needs_deploy" == 'true' ]]; then
      add_service frontend
    fi
  fi

  local deploy_services=''
  local deploy_services_csv=''
  local needs_deploy=false
  local frontend_only_deploy=false
  local skip_docker_deploy=false
  local restart_host_backend=false
  local install_systemd_units=false
  local prepare_host_native=false
  local cutover_host_runtime=false
  local host_runtime_only_refresh=false

  if [[ "$host_runtime_needs_refresh" == 'true' ]]; then
    install_systemd_units=true
    prepare_host_native=true
    if [[ "${HOST_BACKEND_ACTIVE:-false}" == 'true' ]]; then
      restart_host_backend=true
    else
      cutover_host_runtime=true
    fi
  fi

  if [[ "${#services[@]}" -gt 0 ]]; then
    needs_deploy=true
    deploy_services="${services[*]}"
    deploy_services_csv="$(IFS=,; echo "${services[*]}")"
    if [[ "$deploy_services_csv" == 'frontend' && "$sync_host_caddy" == '0' ]]; then
      frontend_only_deploy=true
    fi
  elif [[ "$host_runtime_needs_refresh" == 'true' ]]; then
    needs_deploy=true
    skip_docker_deploy=true
    host_runtime_only_refresh=true
  fi

  cat <<EOF
needs_deploy=$needs_deploy
frontend_needs_deploy=$frontend_needs_deploy
backend_needs_deploy=$backend_needs_deploy
tusd_needs_deploy=$tusd_needs_deploy
infra_needs_deploy=$infra_needs_deploy
host_runtime_needs_refresh=$host_runtime_needs_refresh
host_runtime_managed=$host_runtime_managed
frontend_only_deploy=$frontend_only_deploy
host_runtime_only_refresh=$host_runtime_only_refresh
deploy_services=$deploy_services
deploy_services_csv=$deploy_services_csv
sync_host_caddy=$sync_host_caddy
skip_docker_deploy=$skip_docker_deploy
restart_host_backend=$restart_host_backend
install_systemd_units=$install_systemd_units
prepare_host_native=$prepare_host_native
cutover_host_runtime=$cutover_host_runtime
effective_backend_sha=$effective_backend_sha
effective_frontend_sha=$effective_frontend_sha
effective_tusd_sha=$effective_tusd_sha
EOF
}

evaluate_live_deploy_guard() {
  local active_streams="${ACTIVE_STREAMS:?ACTIVE_STREAMS is required}"
  if [[ ! "$active_streams" =~ ^[0-9]+$ ]]; then
    echo "ACTIVE_STREAMS must be numeric, got: $active_streams" >&2
    return 1
  fi

  local can_deploy=true
  local decision='safe to deploy'

  if (( active_streams > 0 )); then
    if [[ "${FRONTEND_ONLY_DEPLOY:-false}" == 'true' ]]; then
      decision='live stream active: frontend-only deploy allowed'
    elif [[ "${HOST_RUNTIME_ONLY_REFRESH:-false}" == 'true' && "${HOST_BACKEND_ACTIVE:-false}" == 'true' ]]; then
      decision='live stream active: host-native backend refresh allowed'
    else
      can_deploy=false
      decision='deploy deferred to protect live streams'
    fi
  fi

  cat <<EOF
can_deploy=$can_deploy
decision=$decision
EOF
}
