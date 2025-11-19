---
name: backend-dev-guidelines
description: Backend development guidelines for youtube_translation (FastAPI, async SQLAlchemy, Sentry, streaming, quota). Use when створюєш або змінюєш роут, сервіс, core‑логіку чи інтеграцію зі стрімінгом / квотами.
---

# FastAPI Backend Development Guidelines (youtube_translation)

## Purpose

Забезпечити єдині архітектурні патерни для backend youtube_translation: FastAPI API, async SQLAlchemy, Sentry, rate limiting, стрімінг через FFmpeg і scheduler.

## When to Use This Skill

Використовуй цю навичку, коли:
- додаєш/змінюєш endpoint у `backend/app/api/routes/*.py`;
- змінюєш бізнес‑логіку у `backend/app/services/**`;
- чіпаєш `backend/app/core/**` (quota, security, metrics, stream_reconciler, config);
- дописуєш middleware (`backend/app/middleware/**`);
- додаєш нові background‑таски або стрімінгову логіку (`backend/app/streaming/**`);
- створюєш/оновлюєш pytest‑тести для backend.

---

## Architecture Overview

### Layered Architecture (на практиці в youtube_translation)

```text
HTTP Request
    ↓
FastAPI Router (backend/app/api/routes)
    ↓
Service Layer (backend/app/services)
    ↓
Core & Streaming (backend/app/core, backend/app/streaming)
    ↓
Database (async SQLAlchemy, backend/app/models/database.py)
```

**Ключовий принцип:** кожен шар має одну відповідальність — API маршрути не містять бізнес‑логіки, вона живе в сервісах/core.

---

## Directory Structure (Backend)

```text
backend/
  app/
    api/
      routes/           # FastAPI routers (auth, assets, streams, quota, admin, ...)
    core/               # config, security, quota, metrics, logging, stream_reconciler
    middleware/         # rate limiter, security headers, API metrics
    services/           # business logic (assets, streams, playlists, quota, ...)
    streaming/          # ffmpeg manager, playlist builder, validator, hot-swap
    models/             # database models, session factory
    schemas/            # Pydantic schemas
    cli/                # CLI утиліти (run_stream, міграції тощо)
  tests/                # pytest‑тести на всі ключові домени
  migrations/           # SQL міграції
```

---

## Core Principles

### 1. Routers тільки визначають API, логіка в services/core

```python
# ❌ НЕ ТАК: бізнес‑логіка прямо в route
@router.post("/streams")
async def create_stream(request: Request):
    # багато логіки тут → важко тестувати та підтримувати
    ...

# ✅ ПРАВИЛЬНО: router делегує сервісу
@router.post("/streams")
async def create_stream(payload: StreamCreateRequest, service: StreamsService = Depends(get_streams_service)):
    return await service.create_stream(payload)
```

### 2. Sentry інтеграція всюди, де є критичні помилки

У `app/main.py` Sentry вже ініціалізовано:
- `FastApiIntegration` — для трасування endpoint’ів;
- `SqlalchemyIntegration` — для моніторингу БД.

При додаванні нових фон. тасків чи складної логіки:

```python
from sentry_sdk import capture_exception

async def critical_operation(...):
    try:
        ...
    except Exception as exc:
        capture_exception(exc)
        raise
```

### 3. Конфігурація тільки через settings (pydantic), не напряму з env

```python
from app.core.config import settings

# ✅ ПРАВИЛЬНО
db_url = settings.database_url

# ❌ НЕПРАВИЛЬНО
import os
db_url = os.environ["DATABASE_URL"]
```

### 4. Async всюди: IO/DB/streaming

- Використовуй `async def` та async‑сесії для БД.
- Не блокуйте event loop (не викликайте синхронний ffmpeg без окремого процесу/обгортки).

### 5. Rate limiting, security, metrics підключаються як middleware

Додаючи нові маршрути/сервіси, переконайся, що:
- вони не обходять `RateLimitMiddleware` (тобто використовують стандартний FastAPI app);
- важливі endpoint’и мають метрики (через `APIMetricsMiddleware` або явні лічильники).

### 6. Тести обовʼязкові для бізнес‑логіки

При додаванні нового сервісу або зміні поведінки:
- додай/онови pytest‑тести в `backend/tests/test_*`;
- для API використовуй `httpx.AsyncClient` + тестовий FastAPI app;
- для streaming/ffmpeg/ quota — вже є шаблони тестів (див. `test_ffmpeg_manager.py`, `test_quota_enforcement.py`).

---

## Common Patterns & Examples

### FastAPI Router

```python
from fastapi import APIRouter, Depends
from app.schemas.quota import QuotaResponse
from app.services.quota.service import QuotaService, get_quota_service

router = APIRouter()

@router.get("/quota", response_model=QuotaResponse)
async def get_quota(service: QuotaService = Depends(get_quota_service)):
    return await service.get_current_quota()
```

### Service Layer

```python
from app.core.quota import QuotaCalculator
from app.models.database import AsyncSession

class QuotaService:
    def __init__(self, db: AsyncSession, calculator: QuotaCalculator) -> None:
        self._db = db
        self._calculator = calculator

    async def get_current_quota(self) -> QuotaResponse:
        usage = await self._calculator.calculate_usage(self._db)
        # business logic here
        return QuotaResponse(...)
```

### Streaming / FFmpeg Manager

```python
from app.streaming.ffmpeg_manager import ffmpeg_manager

async def start_stream(stream_id: UUID) -> None:
    await ffmpeg_manager.start_stream(stream_id)
```

### Background Tasks

```python
from app.main import schedule_background_task

@app.on_event("startup")
async def startup_event():
    schedule_background_task(cleanup_ffmpeg_streams())
```

---

## Testing Guidelines (Backend)

- Всі нові фічі мають бути покриті pytest‑тестами.
- Використовуй існуючу структуру як приклад:
  - `test_assets_api.py`, `test_stream_duration_tracking.py`, `test_quota_enforcement.py`.
- Для API:
  - піднімай тестовий FastAPI app;
  - використовуй `httpx.AsyncClient` для запитів;
  - перевіряй статус‑коди, тіло відповіді, side‑effects у БД.

---

## Navigation Guide (Reference Files)

> У цьому репозиторії reference‑файли поки що залишаються з оригінального шаблону. Коли буде час, можна витягнути з них корисні ідеї та переписати під FastAPI.

Тимчасово використовуй власний код youtube_translation як головне джерело істини та цей SKILL як "огляд" патернів.

---

## Related Skills

- **error-tracking** — патерни інтеграції Sentry в FastAPI/SQLAlchemy.
- **route-tester** — як тестувати `/api/*` endpoint’и (pytest/httpx/curl).
- **skill-developer** — як додавати/налаштовувати нові skills і тригери.

---

**Skill Status**: ADAPTED for youtube_translation ✅
**Line Count**: < 500 ✅
**Progressive Disclosure**: можна доповнювати reference‑файлами за потреби ✅