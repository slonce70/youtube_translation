---
name: route-tester
description: Test FastAPI routes and youtube_translation API endpoints (auth, assets, streams, quota) using pytest + httpx or curl. Use when треба перевірити коректність нового/зміненного endpoint’а.
---

# youtube_translation Route Tester Skill

## Purpose

Надати стандартні патерни для тестування backend‑маршрутів youtube_translation:
- автоматизовані інтеграційні тести (pytest + httpx.AsyncClient);
- ручні curl‑запити до `/api/*` endpoint’ів;
- перевірка side‑effects у БД та стрімінгових ресурсах.

## When to Use This Skill

- Додаєш новий endpoint у `backend/app/api/routes/*.py`.
- Змінюєш поведінку існуючого endpoint’а (auth, assets, streams, quota, admin).
- Виправляєш баг, відтворюваний через HTTP‑запити.
- Хочеш упевнитися, що зміни не зламали критичні сценарії (стрімінг, квоти, завантаження).

---

## Testing Methods

### 1. pytest + httpx.AsyncClient (рекомендовано)

Використовуй існуючу тестову інфраструктуру в `backend/tests/` як шаблон.

```python
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.anyio
async def test_streams_list_returns_200():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/streams")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
```

Патерн:
- створюй тестовий клієнт з `AsyncClient(app=app, base_url="http://test")`;
- роби запити до `/api/...`;
- перевіряй статус‑код, структуру JSON, важливі поля.

### 2. Ручне тестування через curl

```bash
curl -X GET "http://localhost:<BACKEND_PORT>/api/streams" \
  -H "Accept: application/json"

curl -X POST "http://localhost:<BACKEND_PORT>/api/assets" \
  -H "Content-Type: application/json" \
  -d '{"source_url": "https://...", "title": "Test asset"}'
```

Поради:
- перевіряй базові сценарії (200/400/401/403/404/500);
- якщо endpoint потребує auth — використай наявний механізм авторизації (tokens/cookies) згідно з реалізацією `auth`.

### 3. Специфічні сценарії youtube_translation

- **Streams**: тестуй створення/зупинку/редагування стрімів (`/api/streams`, `/api/streams/{id}`);
- **Quota**: сценарії перевищення/оновлення квоти (`/api/quota`);
- **Assets**: завантаження медіа, перевірка доступності `/thumbnails/*` і API `/api/assets`.

---

## Testing Checklist

Перед тим як вважати endpoint протестованим:

- [ ] Є інтеграційний pytest‑тест, який покриває основний happy‑path.
- [ ] Є тест/кейси на помилкові вхідні дані (400).
- [ ] Перевірено сценарій без авторизації (очікуваний 401/403, якщо endpoint захищений).
- [ ] За потреби перевірено зміни в БД (через вже наявні хелпери/моделі).
- [ ] Для стрімінгу/квот — перевірено повʼязані сервіси (streams, quota).

---

## Debugging Failed Tests

- **4xx (400/401/403/404)**:
  - перевір правильність URL (`/api/...`), параметрів, тіла запиту;
  - для 401/403: переконайся, що токени/сесія коректні.
- **5xx (500)**:
  - дивись логи backend;
  - використай `error-tracking` skill, щоб переконатися, що Sentry фіксує помилку.

---

## Related Skills

- **backend-dev-guidelines** — як правильно дизайнити FastAPI endpoint’и та сервіси.
- **error-tracking** — як інтегрувати Sentry, щоб бачити stack traces для провалених запитів.

---

**Skill Status**: ADAPTED for youtube_translation ✅
