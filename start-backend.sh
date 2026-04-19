#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
cd "${ROOT_DIR}"

CLI_API_PORT="${API_PORT:-}"
CLI_STREAM_RUNTIME_MODE="${STREAM_RUNTIME_MODE:-}"

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

resolve_media_tool_bin() {
    local configured="${1:-}"
    local fallback_name="${2:-}"
    local resolved=""

    if [ -n "${configured}" ] && tool_is_available "${configured}"; then
        echo "${configured}"
        return
    fi

    if [ -n "${fallback_name}" ] && command -v "${fallback_name}" >/dev/null 2>&1; then
        resolved="$(command -v "${fallback_name}")"
        echo "${resolved}"
        return
    fi

    if [ -n "${configured}" ]; then
        echo "${configured}"
        return
    fi

    echo "${fallback_name}"
}

echo "🚀 Starting Backend..."
echo "📍 API will be at: http://localhost:${API_PORT}"
echo "❤️  Health: http://localhost:${API_PORT}/health"
echo "📖 Docs will be at: http://localhost:${API_PORT}/docs"
echo "🧭 Canonical hybrid local boot: 'make dev-bootstrap' -> './start-backend.sh' -> './start-frontend.sh'"
echo ""

# Создаем папки рядом с backend
mkdir -p "${BACKEND_DIR}/uploads" "${BACKEND_DIR}/streams" "${BACKEND_DIR}/logs"

# Значения по умолчанию для путей, если не переопределены в .env
export UPLOAD_DIR="${UPLOAD_DIR:-${BACKEND_DIR}/uploads}"
export STREAM_DIR="${STREAM_DIR:-${BACKEND_DIR}/streams}"
export LOG_DIR="${LOG_DIR:-${BACKEND_DIR}/logs}"

REQUESTED_RUNTIME_MODE="${CLI_STREAM_RUNTIME_MODE:-${STREAM_RUNTIME_MODE:-manager}}"

if [ "$REQUESTED_RUNTIME_MODE" = "supervisor" ]; then
    echo "⚠️  supervisor runtime is deprecated in this repo. Mapping STREAM_RUNTIME_MODE=supervisor to manager."
    REQUESTED_RUNTIME_MODE="manager"
fi

echo "🎬 Requested stream runtime: ${REQUESTED_RUNTIME_MODE}"
if [ "$REQUESTED_RUNTIME_MODE" = "systemd" ]; then
    echo "ℹ️  systemd mode is intended for Linux services. Local shell startup will only work if systemd tooling is available."
else
    echo "ℹ️  manager mode runs FFmpeg under the API process and is the built-in local fallback."
fi
export STREAM_RUNTIME_MODE="${REQUESTED_RUNTIME_MODE}"

echo "✅ Effective stream runtime: ${STREAM_RUNTIME_MODE:-manager}"

FFMPEG_CANDIDATE="${FFMPEG_BIN:-ffmpeg}"
FFPROBE_CANDIDATE="${FFPROBE_BIN:-ffprobe}"
FFMPEG_RESOLVED="$(resolve_media_tool_bin "${FFMPEG_CANDIDATE}" "ffmpeg")"
FFPROBE_RESOLVED="$(resolve_media_tool_bin "${FFPROBE_CANDIDATE}" "ffprobe")"

if [ "${FFMPEG_RESOLVED}" != "${FFMPEG_CANDIDATE}" ]; then
    echo "🎞️  Використовую FFMPEG_BIN=${FFMPEG_RESOLVED} замість ${FFMPEG_CANDIDATE}"
fi
if [ "${FFPROBE_RESOLVED}" != "${FFPROBE_CANDIDATE}" ]; then
    echo "🎛️  Використовую FFPROBE_BIN=${FFPROBE_RESOLVED} замість ${FFPROBE_CANDIDATE}"
fi

export FFMPEG_BIN="${FFMPEG_RESOLVED}"
export FFPROBE_BIN="${FFPROBE_RESOLVED}"

if ! tool_is_available "${FFMPEG_BIN}"; then
    echo "⚠️  FFmpeg не знайдено (${FFMPEG_BIN}). Для rehearsal стрімів задайте коректний FFMPEG_BIN або встановіть ffmpeg."
fi
if ! tool_is_available "${FFPROBE_BIN}"; then
    echo "⚠️  ffprobe не знайдено (${FFPROBE_BIN}). Metadata validation та media smoke можуть бути недоступні без FFPROBE_BIN."
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

"$PYTHON_BIN" -m app.run_server --reload --host 0.0.0.0 --port "${API_PORT}"
