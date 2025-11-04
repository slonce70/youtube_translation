# YouTube Multi-Channel Streaming Platform

Многоарендная платформа для круглосуточных YouTube‑стримов с разделением квот, загрузкой больших файлов через tusd и административной панелью.

## ⚡️ Основные возможности

- Многоканальные 24/7 стримы без перекодирования (FFmpeg `-c copy`)
- Квоты и тарифы (storage, streams, assets, playlists, destinations)
- Изоляция файлов `/uploads/{user_id}` и RLS в Supabase
- Автоматическое создание профилей пользователей Supabase
- Веб-панель (Next.js) + tusd для возобновляемых загрузок
- Админский интерфейс с метриками и алертами

## 🚀 Быстрый старт (локально)

```bash
git clone https://github.com/slonce70/youtube_translation.git
cd youtube_translation

# 1. Python окружение
python3 -m venv .venv
source .venv/bin/activate
make install-backend

# 2. Node окружение
cd frontend
npm install
cd ..

# 3. Конфигурация
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Заполните ключи Supabase, DATABASE_URL, TUSD_HMAC_SECRET и пути к ffmpeg

# 4. Запуск всех сервисов
make dev

# Backend:  http://localhost:8000
# Frontend: http://localhost:3000
# tusd:     http://localhost:1080/files/
```

Скрипт `make dev` стартует FastAPI, Next.js и tusd. Для корректного копирования файлов в `/uploads/{user_id}` требуется валидный `TUSD_HMAC_SECRET` в `backend/.env`.

## 🔑 Важные переменные окружения

| Переменная | Назначение |
|------------|------------|
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET` | Авторизация и профили пользователей |
| `DATABASE_URL` | Подключение к Supabase Postgres (порт 5432, session mode) |
| `ENCRYPTION_KEY`, `ENCRYPTION_SALT` | Шифрование стрим-ключей |
| `TUSD_HMAC_SECRET` | Подпись запросов tusd → FastAPI |
| `UPLOAD_DIR`, `STREAM_DIR` | Рабочие каталоги (по умолчанию `./uploads`, `./streams`) |
| `FFMPEG_BIN`, `FFPROBE_BIN` | Пути к бинарям FFmpeg/FFprobe |

Все значения хранятся в `backend/.env` и не должны попадать в git.

## 🧭 Структура проекта

```
backend/               FastAPI, миграции, tusd hooks
frontend/              Next.js приложение (app router)
docs/                  Техническая документация
docker/                docker-compose и инфраструктурные файлы
start-*.sh             Локальные скрипты запуска
Makefile               Команды для разработки и CI
```

## 📚 Документация

- `docs/ARCHITECTURE.md` — архитектура решения
- `docs/MVP_COMPLETE.md` — реализованный функционал и API
- `docs/SUPABASE_SETUP.md` — настройка проекта в Supabase
- `docs/IMPLEMENTATION_REPORT.md` — отчёт по доработкам
- `docs/TROUBLESHOOTING.md` — часто встречающиеся проблемы
- `docs/backend_api_contract.md` и `docs/backend_api_map.md` — контракты REST API  
- `docs/postman/` — готовые коллекции и окружения Postman

## 🛠 Команды Makefile

```bash
make install            # backend + frontend зависимости
make dev                # поднять backend, frontend и tusd
make dev-backend        # только FastAPI
make dev-frontend       # только Next.js
make dev-tusd           # только tusd
make test               # pytest + npm test
make lint               # ruff + black + eslint
make type-check         # mypy + npm run type-check
make clean              # очистка временных файлов
```

## 🐳 Docker

Для развёртывания в контейнерах используйте `docker/docker-compose.yml`. Перед запуском пропишите переменные окружения (см. `backend/.env.example`).

```bash
docker compose -f docker/docker-compose.yml up -d
```

## 🔐 Безопасность

- Все таблицы защищены RLS-политиками (см. `backend/migrations`)
- tusd взаимодействует с API только через подписанные запросы
- Секреты Supabase и ключи шифрования находятся вне репозитория
- Для production рекомендуется дополнительно включить Sentry и HTTPS-прокси (см. Caddy конфигурацию в `docker/`)

## 🤝 Вклад и поддержка

Пул-реквесты и issue приветствуются. Перед коммитом запускайте `make lint` и `make test`.  
Вопросы и предложения можно оформлять через Issues на GitHub.

# Docker
make docker-up            # Start containers
make docker-down          # Stop containers
make docker-logs          # View logs

# Database
make migrate              # Apply migrations
make create-admin         # Create admin user

# Utilities
make clean                # Clean temp files
make security-audit       # Audit dependencies
```

For full list: `make help`

## 📝 License

Available for personal and commercial use.

## 🤝 Support

- **GitHub**: https://github.com/slonce70/youtube_translation
- **Issues**: https://github.com/slonce70/youtube_translation/issues

---

**Built with ❤️ using FastAPI, Next.js, FFmpeg, and Supabase**

**Development Time**: ~12 hours | **Lines of Code**: 8,000+ | **Status**: Production Ready 🚀
