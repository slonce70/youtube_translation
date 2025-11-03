#!/bin/bash
cd "$(dirname "$0")/backend"

echo "🚀 Starting Backend..."
echo "📍 API will be at: http://localhost:8000"
echo "📖 Docs will be at: http://localhost:8000/docs"
echo ""

# Создаем папки
mkdir -p ../uploads ../streams

# Запускаем
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
