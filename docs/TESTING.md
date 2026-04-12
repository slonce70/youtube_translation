# Запуск і тестування (актуально)

## Канонічний локальний bootstrap

Поточний базовий шлях для розробки та smoke/e2e:

1. Встановити залежності:
```bash
make install
```

2. Підняти базові сервіси через канонічну обгортку:
```bash
make dev-bootstrap
```

Цей шлях автоматично підхоплює `POSTGRES_PASSWORD` з `backend/.env`.
Якщо `127.0.0.1:5432` або `127.0.0.1:6379` вже зайняті стороннім локальним `postgres`/`redis`, bootstrap має fail-fast: канонічний шлях не підміняє compose-залежності довільними host services.

3. Запустити бекенд локально:
```bash
./start-backend.sh
```

4. Запустити фронтенд локально:
```bash
./start-frontend.sh
```

## Auth paths

### Локальний smoke / e2e

Рекомендований локальний шлях:
- `backend/.env`: `ENABLE_DEV_AUTH=true`
- `frontend/.env.local`: `NEXT_PUBLIC_DEV_BYPASS_AUTH=1`

Цей режим потрібен для швидкої локальної перевірки флоу без залежності від реального Supabase проєкту.

### Продуктова перевірка auth

Якщо потрібно перевірити справжній auth flow:
- вимкніть `NEXT_PUBLIC_DEV_BYPASS_AUTH`
- задайте валідні `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`

## Runtime note

- Цільовий локальний режим: `STREAM_RUNTIME_MODE=supervisor`
- Якщо `supervisorctl` або `supervisord` відсутні, `start-backend.sh` автоматично переходить у `manager`
- `systemd` лишається Linux-only production шляхом

## Мінімальний validation bar

```bash
curl http://localhost:8000/health
make lint
make type-check
make i18n-check
make test
cd frontend && npm run test:e2e
```

Для V0 stabilization/release використовуйте не розрізнений набір команд, а один строгий gate:

```bash
make verify-v0
```

`make test` у канонічному локальному шляху сам перевіряє/піднімає `postgres` і `redis` через Docker Compose та відмовляється запускати backend tests проти довільних локальних сервісів на тих самих портах. Якщо порти зайняті не очікуваними compose-контейнерами, це вважається конфліктом середовища, а не валідним baseline.

## Поточний baseline

| Surface | Що має бути перевірено | Автоматичний baseline | Додатково перед release |
| --- | --- | --- | --- |
| Backend auth | login/logout/current-user, multi-tenant scoping, quota auth binding | `backend/tests/test_auth_api.py`, `backend/tests/test_auth_multitenancy.py` | один manual прогін реального Supabase auth path без DEV bypass |
| Backend assets | list/filter/delete/download/optimization, asset typing, folder routing, storage seam resolution | `backend/tests/test_assets_api.py`, `backend/tests/test_assets_helpers.py`, `backend/tests/test_asset_storage.py` | manual upload + delete flow у локальному UI |
| Backend streaming | playlist validation, live edit, hot swap, scheduler, runtime stop/restart, FFmpeg negative paths, storage-backed asset payload resolution | `backend/tests/test_playlist_builder.py`, `backend/tests/test_playlist_storage_resolution.py`, `backend/tests/test_stream_asset_payload.py`, `backend/tests/test_stream_live_edit.py`, `backend/tests/test_hot_swap.py`, `backend/tests/test_stream_scheduler.py`, `backend/tests/test_stream_schedule_update.py`, `backend/tests/test_ffmpeg_manager.py`, `backend/tests/test_stream_supervisor_stop.py` | rehearsal одного реального локального стріму за `docs/operations/first_stream_checklist.md` |
| Backend security/runtime | encryption, rate limit, websocket middleware, supervisor deps, health/startup | `backend/tests/test_security.py`, `backend/tests/test_rate_limiter.py`, `backend/tests/test_websocket_safe_csrf.py`, `backend/tests/test_supervisor_runtime_dependencies.py`, `backend/tests/test_main.py` | перевірка `/health` і логів під час rehearsal |
| Frontend app shell | dashboard bootstrap, admin page, локалізація, API auth wrapper | `frontend/src/app/dashboard/__tests__/page.test.tsx`, `frontend/src/app/admin/__tests__/page.test.tsx`, `frontend/src/components/__tests__/localization-smoke.test.tsx`, `frontend/src/lib/__tests__/*` | ручна перевірка DEV auth та real auth path |
| Frontend library/upload | asset cards, asset display rules, upload modal/token flow | `frontend/src/components/library/__tests__/AssetCard.test.tsx`, `frontend/src/app/dashboard/library/__tests__/*`, `frontend/e2e/dashboard-flows.spec.ts` | manual upload через tusd з оновленням списку файлів |
| Frontend streaming UX | builder helpers, schedule utils, start/stop/live edit | `frontend/src/app/dashboard/streaming/__tests__/*`, `frontend/e2e/dashboard-flows.spec.ts` | manual stream start/stop з перевіркою статусу і логів |

Станом на локальну перевірку 2026-03-30:

- `make lint` проходить
- `make type-check` проходить
- `make i18n-check` проходить
- `make test` проходить
- `cd frontend && npm run build` проходить
- `cd frontend && npm run test:e2e` / `npx playwright test` проходить

Нюанс по якості backend:

- `make lint` не запускає `black --check`, якщо явно не передати `RUN_BLACK=1`
- `make type-check` не запускає backend `mypy`, якщо явно не передати `RUN_MYPY=1`

Тобто default gates зелені, але це не повний backend static-analysis gate. Для стабілізаційного tranche canonical gate = `make verify-v0`.

Для tranche-one launch цього репозиторію окремо вважайте multi-destination rehearsal обов'язковим pre-public gate:

- дефолтний режим: `FFMPEG_TEE_ONFAIL_POLICY=ignore`
- треба окремо перевірити, що падіння одного destination не валить інші
- оператор має бачити degraded destination у логах і мати documented triage path з `docs/operations/supervisor.md`

Storage seam regression bar:

- filesystem assets мають і далі резолвитись у локальний файл всередині `upload_dir/<user_id>/...`
- `object_storage` asset без локального cache не повинен тихо доходити до playlist/stream runtime
- canonical automated checks: `backend/tests/test_asset_storage.py`, `backend/tests/test_stream_asset_payload.py`, `backend/tests/test_playlist_storage_resolution.py`

## Merge Gate

Для звичайного merge в активну гілку engineering baseline має бути таким:

```bash
make lint
make type-check
make i18n-check
make test
```

Додатково запускати `cd frontend && npm run test:e2e`, якщо зміни торкаються:
- auth
- dashboard routing
- library/upload
- streaming UI flows

## Release Gate

Перед релізом рекомендація жорсткіша:

```bash
make verify-v0
```

Після automated gate обов'язковий ручний rehearsal:

1. `curl http://localhost:8000/health`
2. відкрити `http://localhost:8000/docs`
3. перевірити `http://localhost:3000/`, `http://localhost:3000/dashboard`, `http://localhost:3000/admin`
4. DEV auth path: вхід у dashboard, upload media, перегляд library
5. Створення test stream, start/stop, перевірка логів
6. Один реальний auth sanity check без `NEXT_PUBLIC_DEV_BYPASS_AUTH`
7. Перевірка сценарію з `docs/operations/first_stream_checklist.md`
8. Для multi-destination: окремо перевірити кейс з одним failing destination при `FFMPEG_TEE_ONFAIL_POLICY=ignore`
9. Звірити операторські runbooks у `docs/operations/supervisor.md` для node restart, failed stream, disk pressure і upload validation failures

## Точкові перевірки

Backend:
```bash
cd backend
FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest -v
```

Frontend unit:
```bash
cd frontend
CI=1 npm test
```

Frontend e2e (Playwright):
```bash
cd frontend
npm run test:e2e
```

## Нотатки

- Для e2e локально за замовчуванням використовується DEV auth (`NEXT_PUBLIC_DEV_BYPASS_AUTH=1`).
- Якщо потрібно перевірити реальний редірект `/dashboard -> /login`, запустіть e2e з `NEXT_PUBLIC_DEV_BYPASS_AUTH=0`.
- Визначення успішного локального rehearsal див. у `docs/operations/first_stream_checklist.md`.
