#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

repo_root="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")/.." && /bin/pwd)"
backend_dir="${SYSTEMD_BACKEND_DIR:-$repo_root/backend}"
venv_python="${SYSTEMD_PYTHON_BIN:-$repo_root/.venv/bin/python}"
log_dir="${SYSTEMD_LOG_DIR:-$repo_root/backend/logs}"
stream_id="${1:-}"

if [[ -z "$stream_id" ]]; then
  echo "stream_id argument is required" >&2
  exit 1
fi

cd "$backend_dir"
export PYTHONPATH="$backend_dir"
/bin/mkdir -p "$log_dir"
wrapper_log="$log_dir/systemd-run-stream-${stream_id}.log"
{
  echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] starting run_stream_systemd wrapper"
  echo "backend_dir=$backend_dir"
  echo "venv_python=$venv_python"
  echo "stream_id=$stream_id"
} >>"$wrapper_log"

resolved_python=""
for candidate in \
  "$venv_python" \
  "$repo_root/.venv/bin/python3" \
  "$repo_root/.venv/bin/python3.12"
do
  if [[ ! -x "$candidate" ]]; then
    continue
  fi
  if "$candidate" -V >>"$wrapper_log" 2>&1; then
    resolved_python="$candidate"
    echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] resolved_python=$resolved_python" >>"$wrapper_log"
    break
  fi
  exit_code=$?
  echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] python_version_probe_failed=$exit_code candidate=$candidate" >>"$wrapper_log"
done

if [[ -z "$resolved_python" ]]; then
  exit 127
fi

"$resolved_python" -m app.cli.run_stream "$stream_id" >>"$wrapper_log" 2>&1
exit_code=$?
echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] wrapper exit_code=$exit_code" >>"$wrapper_log"
exit "$exit_code"
