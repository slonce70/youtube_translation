#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
cd "${ROOT_DIR}"

CLI_API_PORT="${API_PORT:-}"
DOCKER_RUNNER_NAME="${DOCKER_RUNNER_NAME:-youtube-streaming-runner}"
DOCKER_SUPERVISOR_CONF_PATH="${BACKEND_DIR}/supervisord.host-docker.conf"

# Копируем .env в backend, только если явно разрешено и нет существующего файла
if [ "${COPY_ROOT_ENV_TO_BACKEND:-0}" = "1" ] && [ -f ".env" ] && [ ! -f "${BACKEND_DIR}/.env" ]; then
    cp .env "${BACKEND_DIR}/.env"
    echo "✅ .env copied to backend/"
elif [ "${COPY_ROOT_ENV_TO_BACKEND:-0}" = "1" ] && [ -f ".env" ] && [ -f "${BACKEND_DIR}/.env" ]; then
    echo "ℹ️  Пропускаю копирование .env: backend/.env уже существует"
fi

# Загружаем переменные окружения из backend/.env, чтобы гарантировать корректный DATABASE_URL
if [ -f "${BACKEND_DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "${BACKEND_DIR}/.env"
    set +a
else
    echo "ℹ️  backend/.env не знайдено. Використовую значення середовища/дефолти застосунку."
fi

API_PORT="${CLI_API_PORT:-${API_PORT:-8000}}"

resolve_tool_bin() {
    local configured="${1:-}"
    local venv_candidate="${2:-}"
    local fallback_name="${3:-}"

    if [ -n "${configured}" ]; then
        if [ "${configured}" = "${fallback_name}" ] && [ -n "${venv_candidate}" ] && [ -x "${venv_candidate}" ]; then
            if ! command -v "${configured}" >/dev/null 2>&1; then
                echo "${venv_candidate}"
                return
            fi
        fi
        echo "${configured}"
        return
    fi

    if [ -n "${venv_candidate}" ] && [ -x "${venv_candidate}" ]; then
        echo "${venv_candidate}"
        return
    fi

    echo "${fallback_name}"
}

tool_is_available() {
    local candidate="${1:-}"

    if [ -z "${candidate}" ]; then
        return 1
    fi

    if [ -x "${candidate}" ]; then
        return 0
    fi

    command -v "${candidate}" >/dev/null 2>&1
}

echo "🚀 Starting Backend..."
echo "📍 API will be at: http://localhost:${API_PORT}"
echo "❤️  Health: http://localhost:${API_PORT}/health"
echo "📖 Docs will be at: http://localhost:${API_PORT}/docs"
echo "🧭 Canonical hybrid local boot: 'make dev-bootstrap' -> './start-backend.sh' -> './start-frontend.sh'"
echo ""

# Создаем папки рядом с backend
mkdir -p "${BACKEND_DIR}/uploads" "${BACKEND_DIR}/streams" "${BACKEND_DIR}/logs" "${BACKEND_DIR}/supervisord/logs" "${BACKEND_DIR}/supervisord/programs"

# Значения по умолчанию для путей, если не переопределены в .env
export UPLOAD_DIR="${UPLOAD_DIR:-${BACKEND_DIR}/uploads}"
export STREAM_DIR="${STREAM_DIR:-${BACKEND_DIR}/streams}"
export LOG_DIR="${LOG_DIR:-${BACKEND_DIR}/logs}"

SUPERVISOR_CONF_SETTING="${SUPERVISOR_CONF_PATH:-supervisord.conf}"
case "${SUPERVISOR_CONF_SETTING}" in
    /*) SUPERVISOR_CONF_PATH="${SUPERVISOR_CONF_SETTING}" ;;
    *) SUPERVISOR_CONF_PATH="${BACKEND_DIR}/${SUPERVISOR_CONF_SETTING}" ;;
esac
export SUPERVISOR_CONF_PATH
SUPERVISOR_SOCKET_PATH="${BACKEND_DIR}/supervisord/supervisor.sock"

REQUESTED_RUNTIME_MODE="${STREAM_RUNTIME_MODE:-manager}"
SUPERVISOR_CTL_BIN="$(resolve_tool_bin "${SUPERVISOR_CTL_PATH:-}" "${BACKEND_DIR}/.venv/bin/supervisorctl" "supervisorctl")"
SUPERVISORD_BIN="$(resolve_tool_bin "${SUPERVISORD_PATH:-}" "${BACKEND_DIR}/.venv/bin/supervisord" "supervisord")"

echo "🎬 Requested stream runtime: ${REQUESTED_RUNTIME_MODE}"
if [ "$REQUESTED_RUNTIME_MODE" = "supervisor" ]; then
    echo "ℹ️  Supervisor mode intended for hybrid local dev. If supervisor tools are missing, startup will fall back to manager."
elif [ "$REQUESTED_RUNTIME_MODE" = "systemd" ]; then
    echo "ℹ️  systemd mode is intended for Linux services. Local shell startup will only work if systemd tooling is available."
else
    echo "ℹ️  manager mode runs FFmpeg under the API process and is the built-in local fallback."
fi

if [ "${REQUESTED_RUNTIME_MODE}" = "supervisor" ]; then
    if [ "${SUPERVISOR_CONF_SETTING}" = "supervisord.conf" ] \
        && [ -f "${DOCKER_SUPERVISOR_CONF_PATH}" ] \
        && command -v docker >/dev/null 2>&1; then
        RUNNER_STATUS="$(docker inspect -f '{{.State.Status}}' "${DOCKER_RUNNER_NAME}" 2>/dev/null || true)"
        if [ "${RUNNER_STATUS}" = "running" ]; then
            SUPERVISOR_CONF_PATH="${DOCKER_SUPERVISOR_CONF_PATH}"
            echo "🐳 Використовую Docker runner supervisor endpoint через ${SUPERVISOR_CONF_PATH}."
        fi
    fi

    RUNNING_PID=""
    if tool_is_available "${SUPERVISOR_CTL_BIN}"; then
        RUNNING_PID=$("${SUPERVISOR_CTL_BIN}" -c "${SUPERVISOR_CONF_PATH}" pid 2>/dev/null | tr -d '[:space:]' || true)
    fi

    if [ -n "${RUNNING_PID}" ] && [ "${RUNNING_PID}" != "unknown" ]; then
        echo "♻️  Використовую вже запущений supervisor endpoint (PID: ${RUNNING_PID}) через ${SUPERVISOR_CONF_PATH}."
        export STREAM_RUNTIME_MODE="supervisor"
    elif ! tool_is_available "${SUPERVISOR_CTL_BIN}"; then
        echo "⚠️  supervisorctl не знайдено (${SUPERVISOR_CTL_BIN}). Перемикаю STREAM_RUNTIME_MODE на manager."
        export STREAM_RUNTIME_MODE="manager"
    elif ! tool_is_available "${SUPERVISORD_BIN}"; then
        echo "⚠️  supervisord не знайдено (${SUPERVISORD_BIN}) і зовнішній runner недоступний. Перемикаю STREAM_RUNTIME_MODE на manager."
        export STREAM_RUNTIME_MODE="manager"
    else
        if [ "${SUPERVISOR_CONF_PATH}" = "${BACKEND_DIR}/supervisord.conf" ] && [ -S "${SUPERVISOR_SOCKET_PATH}" ]; then
            echo "🧹 Видаляю stale supervisor socket: ${SUPERVISOR_SOCKET_PATH}"
            rm -f "${SUPERVISOR_SOCKET_PATH}"
        fi
        if [ "${SUPERVISOR_CONF_PATH}" = "${BACKEND_DIR}/supervisord.conf" ] && [ -f "${BACKEND_DIR}/supervisord/supervisord.pid" ]; then
            rm -f "${BACKEND_DIR}/supervisord/supervisord.pid"
        fi
        echo "▶️  Запускаю локальний supervisord (config: ${SUPERVISOR_CONF_PATH})..."
        "${SUPERVISORD_BIN}" -c "${SUPERVISOR_CONF_PATH}"
        sleep 1
        export STREAM_RUNTIME_MODE="supervisor"
    fi
else
    export STREAM_RUNTIME_MODE="${REQUESTED_RUNTIME_MODE}"
fi

echo "✅ Effective stream runtime: ${STREAM_RUNTIME_MODE:-manager}"

FFMPEG_CANDIDATE="${FFMPEG_BIN:-ffmpeg}"
if ! tool_is_available "${FFMPEG_CANDIDATE}"; then
    echo "⚠️  FFmpeg не знайдено (${FFMPEG_CANDIDATE}). Для rehearsal стрімів задайте коректний FFMPEG_BIN або встановіть ffmpeg."
fi

if [ "${ENABLE_DEV_AUTH:-false}" != "true" ] && [ -z "${SUPABASE_URL:-}" ]; then
    echo "⚠️  DEV auth вимкнено і SUPABASE_URL не задано. Auth flow може бути недоступний, поки не налаштовано backend/.env."
fi

# Освобождаем порт API, если он уже занят прошлым процессом
PORT_TO_FREE="${API_PORT}"
if command -v lsof >/dev/null 2>&1; then
    EXISTING_PIDS=$(lsof -ti tcp:"${PORT_TO_FREE}" || true)
    if [ -n "${EXISTING_PIDS}" ]; then
        echo "⚠️  Найден запущенный backend на порту ${PORT_TO_FREE} (PID: ${EXISTING_PIDS}), завершаю..."
        # shellcheck disable=SC2086
        kill ${EXISTING_PIDS} >/dev/null 2>&1 || true
        # Даем процессу время завершиться и перепроверяем порт
        for _ in 1 2 3; do
            sleep 0.5
            if ! lsof -ti tcp:"${PORT_TO_FREE}" >/dev/null 2>&1; then
                break
            fi
        done
        if lsof -ti tcp:"${PORT_TO_FREE}" >/dev/null 2>&1; then
            echo "⚠️  Принудительно завершаю процесс на порту ${PORT_TO_FREE}" && kill -9 ${EXISTING_PIDS} >/dev/null 2>&1 || true
        fi
    fi
fi

# Запускаем
cd "${BACKEND_DIR}"

# Используем локальное виртуальное окружение, если оно создано
PYTHON_BIN="${BACKEND_DIR}/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
fi
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "${API_PORT}"
