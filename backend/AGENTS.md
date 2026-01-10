# Backend (FastAPI) — правила для агентів

## Призначення
- FastAPI API-сервіс з async SQLAlchemy, квотами, streaming (FFmpeg) та інтеграціями (Supabase Auth, tusd hooks).

## Запуск і розробка
- Встановити залежності: `make install-backend` (створить `backend/.venv`)
- Запустити тільки бекенд: `make dev-backend` (або `./start-backend.sh`)
- Запустити все (backend + frontend + tusd): `make dev`

## Тести та якість коду
- Тести бекенду: `make test-backend`
- Лінт бекенду: `make lint-backend` (Black/mypy вимикаються за замовчуванням; вмикаються `RUN_BLACK=1`, `RUN_MYPY=1`)

## Структура (куди що класти)
- API роутери: `backend/app/api/routes/*.py`
- Залежності (auth/db): `backend/app/api/deps.py`
- Доменна логіка/сервіси: `backend/app/services/**`
- Моделі БД: `backend/app/models/**`
- Pydantic-схеми: `backend/app/schemas/**`
- Streaming/FFmpeg: `backend/app/streaming/**`
- Міграції: `backend/migrations/**` + `backend/apply_migrations.py`
- tusd hooks: `backend/tusd-hooks/**`
- Тести: `backend/tests/**`

## Патерни та конвенції
- Писати async/await для БД/IO; використовувати типізацію.
- Тримати модулі малими: сервісний шар — у `backend/app/services/*`.
- Тести іменувати `test_*.py` та “дзеркалити” шлях модуля (напр., `services/streams` → `backend/tests/test_streams_*.py`).

## JIT-підказки (пошук)
- Де оголошено роут: `rg -n 'APIRouter\(|router\.' backend/app/api/routes`
- Де використовується сервіс: `rg -n 'app\.services\.|from app\.services' backend/app`
- Де логіка квот: `rg -n 'quota' backend/app/core backend/app/services`
- Знайти тест: `find backend/tests -name "test_*.py"`

## Поширені граблі
- Для тестів streaming може бути потрібен `FFMPEG_BIN` (у `Makefile` вже використовується `FFMPEG_BIN=tests/bin/ffmpeg`).
- Не комітити `backend/.env`; оновлювати `backend/.env.example`, якщо додаєш нові змінні.

## Перед PR (мінімум)
- `make lint-backend && make test-backend`
