#!/bin/sh

set -eu

SUPERVISOR_CONFIG_DIR="${SUPERVISOR_CONFIG_DIR:-/app/supervisord/programs}"
SUPERVISOR_LOG_DIR="${SUPERVISOR_LOG_DIR:-/app/supervisord/logs}"
SUPERVISOR_INVALID_DIR="${SUPERVISOR_INVALID_DIR:-/app/supervisord/invalid-programs}"

mkdir -p "${SUPERVISOR_CONFIG_DIR}" "${SUPERVISOR_LOG_DIR}" "${SUPERVISOR_INVALID_DIR}"

for config_path in "${SUPERVISOR_CONFIG_DIR}"/*.ini; do
    [ -e "${config_path}" ] || continue

    if awk -F= '
        $1 == "stdout_logfile" || $1 == "stderr_logfile" {
            if ($2 ~ "^/" && $2 !~ "^/app/") {
                invalid = 1
            }
        }
        END { exit invalid ? 0 : 1 }
    ' "${config_path}"; then
        echo "Quarantining incompatible supervisor config: ${config_path}"
        mv "${config_path}" "${SUPERVISOR_INVALID_DIR}/$(basename "${config_path}")"
    fi
done

exec supervisord -c /app/supervisord.conf -n
