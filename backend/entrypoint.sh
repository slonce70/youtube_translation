#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
  # Defence-in-depth: even when the migration runner detects a non-TTY,
  # this env var forces auto-confirm so the entrypoint never blocks on
  # an interactive prompt under docker/ci.
  export MIGRATIONS_AUTO_CONFIRM="${MIGRATIONS_AUTO_CONFIRM:-1}"
  attempt=1
  until [ "$attempt" -gt 10 ]
  do
    if python /app/apply_migrations.py; then
      break
    fi
    echo "[entrypoint] Database not ready yet. Retry ${attempt}/10..." >&2
    attempt=$((attempt + 1))
    sleep 2
  done

  if [ "$attempt" -gt 10 ]; then
    echo "[entrypoint] Failed to apply migrations after retries." >&2
    exit 1
  fi
fi

exec python -m app.run_server
