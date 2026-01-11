# AGENTS (корінь репозиторію)

## Знімок проєкту
- Монорепо: `backend/` (FastAPI + async SQLAlchemy + streaming/tusd) та `frontend/` (Next.js 15 + React 19).
- Оркестрація локально: `Makefile` + `start-*.sh`.
- Детальні правила для конкретних зон: див. підпапкові `AGENTS.md` (найближчий файл “перемагає”).

## Швидкі команди (root)
- Встановити залежності: `make install`
- Запуск (backend + frontend + tusd): `make dev`
- Тести: `make test`
- Лінт: `make lint`
- Міграції БД: `make migrate`

## Мовна політика
- Підтримувані мови: українська, англійська, російська.
- За замовчуванням для UI/доків/нотаток розробника: **українська**.

## Безпека та секрети
- Не комітити ключі/токени/паролі та локальні `.env` файли.
- Джерела конфігів: `.env.example`, `backend/.env.example`, `frontend/.env.example`.
- Для tusd інтеграцій потрібні `TUSD_HMAC_SECRET` і `UPLOAD_TOKEN_SECRET` (локально — через env).

## JIT-індекс (що відкривати, а не копіювати)
- Backend: `backend/AGENTS.md`
- Backend app-код: `backend/app/AGENTS.md`
- Frontend: `frontend/AGENTS.md`
- Frontend source: `frontend/src/AGENTS.md`
- Локальний запуск/архітектура: `README.md`
- Docker: `docker/docker-compose.yml`

## Швидкий пошук
- Загальний пошук: `rg -n "Pattern" backend/app frontend/src`
- API роутери: `rg -n "include_router|APIRouter" backend/app`
- React компоненти: `rg -n "export (default )?function|export const [A-Z]" frontend/src/components`

## Definition of Done (мінімум перед PR)
- Проходять `make lint` та `make test`.
- Немає секретів у diff; за потреби оновлено відповідний `*.env.example`.
