#!/usr/bin/env bash
set -euo pipefail

install_root="${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
backend_dir="${SYSTEMD_BACKEND_DIR:-$install_root/backend}"
venv_dir="${SYSTEMD_BACKEND_VENV_DIR:-$backend_dir/.venv}"
requirements_file="${HOST_BACKEND_REQUIREMENTS_FILE:-$backend_dir/requirements.txt}"
bootstrap_python="${HOST_BACKEND_BOOTSTRAP_PYTHON:-python3}"

if [[ ! -d "$backend_dir" ]]; then
  echo "Backend directory not found: $backend_dir" >&2
  exit 1
fi

if [[ ! -f "$requirements_file" ]]; then
  echo "Requirements file not found: $requirements_file" >&2
  exit 1
fi

if [[ ! -x "$venv_dir/bin/python" ]]; then
  echo "Creating host-native backend venv at $venv_dir"
  "$bootstrap_python" -m venv "$venv_dir"
fi

echo "Syncing host-native backend venv from $requirements_file"
"$venv_dir/bin/python" -m pip install -U pip wheel
"$venv_dir/bin/python" -m pip install -r "$requirements_file"

echo "host_backend_venv=$venv_dir"
