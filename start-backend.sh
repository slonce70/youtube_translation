#!/bin/bash
cd "$(dirname "$0")"

echo "🚀 Starting Backend..."
echo "📍 API will be at: http://localhost:8000"
echo "📖 Docs will be at: http://localhost:8000/docs"
echo ""

# Копируем .env в backend, только если явно разрешено и нет существующего файла
if [ "${COPY_ROOT_ENV_TO_BACKEND:-0}" = "1" ] && [ -f ".env" ] && [ ! -f "backend/.env" ]; then
    cp .env backend/.env
    echo "✅ .env copied to backend/"
elif [ "${COPY_ROOT_ENV_TO_BACKEND:-0}" = "1" ] && [ -f ".env" ] && [ -f "backend/.env" ]; then
    echo "ℹ️  Пропускаю копирование .env: backend/.env уже существует"
fi

# Загружаем переменные окружения из backend/.env, чтобы гарантировать корректный DATABASE_URL
if [ -f "backend/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source backend/.env
    set +a
fi

# Создаем папки рядом с backend
mkdir -p backend/uploads backend/streams backend/logs

# Значения по умолчанию для путей, если не переопределены в .env
export UPLOAD_DIR="${UPLOAD_DIR:-$(pwd)/backend/uploads}"
export STREAM_DIR="${STREAM_DIR:-$(pwd)/backend/streams}"
export LOG_DIR="${LOG_DIR:-$(pwd)/backend/logs}"

SUPERVISOR_CONF_PATH="$(pwd)/backend/supervisord.conf"

if [ "${STREAM_RUNTIME_MODE}" = "supervisor" ]; then
    if ! command -v supervisord >/dev/null 2>&1 || ! command -v supervisorctl >/dev/null 2>&1; then
        echo "⚠️  supervisor не знайдено. Перемикаю STREAM_RUNTIME_MODE на manager."
        export STREAM_RUNTIME_MODE="manager"
    else
        RUNNING_PID=$(supervisorctl -c "$SUPERVISOR_CONF_PATH" pid 2>/dev/null | tr -d '[:space:]')
        if [ -n "$RUNNING_PID" ] && [ "$RUNNING_PID" != "unknown" ]; then
            echo "♻️  Перезапускаю supervisord (PID: $RUNNING_PID) з оновленим оточенням..."
            supervisorctl -c "$SUPERVISOR_CONF_PATH" shutdown >/dev/null 2>&1 || true
            sleep 1
        fi
        echo "▶️  Запускаю supervisord (config: $SUPERVISOR_CONF_PATH)..."
        supervisord -c "$SUPERVISOR_CONF_PATH"
        sleep 1
    fi
fi

# Освобождаем порт API, если он уже занят прошлым процессом
PORT_TO_FREE="${API_PORT:-8000}"
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
cd backend

# Используем локальное виртуальное окружение, если оно создано
PYTHON_BIN="$(pwd)/backend/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="$(pwd)/.venv/bin/python"
fi
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
