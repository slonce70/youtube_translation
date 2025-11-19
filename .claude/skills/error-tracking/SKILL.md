environment = development
---
name: error-tracking
description: Sentry error tracking and performance monitoring for youtube_translation (FastAPI + async SQLAlchemy). Use when додаєш нову критичну логіку або хочеш упевнитись, що помилки/повільні операції правильно відслідковуються.
---

# youtube_translation Sentry Integration Skill

## Purpose

Забезпечити послідовне використання Sentry для логування помилок і performance‑метрик у backend youtube_translation (FastAPI + SQLAlchemy).

## When to Use This Skill

- Додаєш новий endpoint або фон. таск у `backend/app/**`.
- Обгортаєш критичну бізнес‑логіку (стрімінг, квоти, робота з БД).
- Потрібно зрозуміти, як правильно ініціалізувати/розширити Sentry.

## Поточна інтеграція

У `backend/app/main.py` уже виконується:

- `sentry_sdk.init(...)` з інтеграціями:
  - `FastApiIntegration(transaction_style="endpoint")`;
  - `SqlalchemyIntegration()`.
- Параметри `dsn`, `environment`, `traces_sample_rate`, `profiles_sample_rate` беруться із `settings`.

Це означає, що всі запити до FastAPI автоматично обгорнуті в Sentry‑транзакції, а SQLAlchemy‑операції відслідковуються.

## Практичні патерни

### 1. Логування помилки в бізнес‑логіці

```python
from sentry_sdk import capture_exception

async def process_stream(stream_id: str) -> None:
    try:
        # business logic
        ...
    except Exception as exc:
        capture_exception(exc)
        raise
```

### 2. Обробка помилок у background‑тасках

Будь‑який `schedule_background_task(...)` у `app/main.py` має ловити помилки та логувати їх у Sentry:

```python
from sentry_sdk import capture_exception

async def cleanup_ffmpeg_streams():
    while True:
        await asyncio.sleep(interval)
        try:
            await ffmpeg_manager.cleanup_dead_streams()
        except Exception as exc:
            capture_exception(exc)
            logger.error("Error cleaning up FFmpeg streams: %s", exc)
```

### 3. Додавання контексту

Для складних операцій (stream scheduler, quota):

```python
import sentry_sdk

try:
    ...
except Exception as exc:
    with sentry_sdk.push_scope() as scope:
        scope.set_tag("service", "streams")
        scope.set_tag("operation", "scheduled_stream_launcher")
        scope.set_extra("stream_id", str(stream_id))
        sentry_sdk.capture_exception(exc)
    raise
```

---

## Checklist при додаванні нової логіки

- [ ] Переконайся, що `sentry_sdk.init` викликається один раз (зараз у `main.py`).
- [ ] У критичних `try/except` блоках використай `capture_exception`.
- [ ] Додай `tags`/`extra`, якщо це допоможе дебажити продакшн‑інциденти.
- [ ] Не логуй чутливі дані (паролі, токени) у Sentry.

---

## Related Skills

- **backend-dev-guidelines** — описує основні архітектурні патерни FastAPI backend.
- **route-tester** — допомагає відтворювати помилки через HTTP‑тести/pytest.

---

**Skill Status**: ADAPTED for youtube_translation ✅