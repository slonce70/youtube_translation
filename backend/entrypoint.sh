#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
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
