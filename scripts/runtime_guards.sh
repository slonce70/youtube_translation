#!/usr/bin/env bash

guard_containerized_systemd_runtime() {
  local selected_services="${1:-}"
  local runtime_mode="${STREAM_RUNTIME_MODE:-}"
  runtime_mode="$(printf '%s' "$runtime_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$runtime_mode" != "systemd" ]]; then
    return 0
  fi

  local allow_unsafe="${ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME:-false}"
  allow_unsafe="$(printf '%s' "$allow_unsafe" | tr '[:upper:]' '[:lower:]')"
  if [[ "$allow_unsafe" == "1" || "$allow_unsafe" == "true" ]]; then
    echo "ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME set; bypassing containerized systemd runtime guard."
    return 0
  fi

  if [[ " ${selected_services} " == *" backend "* || " ${selected_services} " == *" runner "* ]]; then
    echo "Refusing deploy: docker-compose backend/runner services are selected while STREAM_RUNTIME_MODE=systemd is configured." >&2
    echo "Containerized staging/production backend + systemd runtime is blocked by default because the host-level systemctl control plane is not a supported topology yet." >&2
    echo "Use a host-native backend control plane first, or explicitly set ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=true after reviewing the risk." >&2
    return 1
  fi

  return 0
}
