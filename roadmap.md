# Roadmap — youtube_translation (24/7 streaming)

**Орієнтир:** `requirements.md` та `requirements (1).md` (обидва від 2026‑01‑08) + фактичний стан репозиторію.

## Узгоджені рішення (станом на 2026‑01‑08)
- **Primary deployment (cheap VPS/self‑host):** `docker compose`.
- **Runner у Docker:** окремий `runner/supervisord` сервіс у compose (FFmpeg живе поза FastAPI процесом).
- **Optimize:** hybrid (auto тільки для дозволених tier/умов).
- **Timezone:** timezone зберігається в `user_profiles`, часи в БД — UTC.

## Поточний стан (вже є в репозиторії)
- **Auth + multi‑tenant:** Supabase JWT, ізоляція даних по `user_id`.
- **Library:** tusd resumable uploads, webhook на завершення, ffprobe‑валідація, метадані, папки (`media_folders`), колекції (`media_collections`), плейлисти.
- **Streaming ядро:** start/stop, статуси, лог‑файли, auto‑restart/backoff, multi‑destination через `tee`, placeholders, hot‑swap/live edit механіка (slot/queue).
- **Runtime режими:** `manager` / `supervisor` / `systemd`, CLI `python -m app.cli.run_stream <stream_id>`, reconciler для supervisor/systemd.
- **Observability:** JSON‑логи, метрики (`/api/metrics`, `/api/metrics/prometheus`), базові UI‑екрани (dashboard/streaming).
- **Тестування:** backend pytest, frontend unit (jest), e2e (playwright) — описано в `README.md` / `Makefile`.

## Оновлення (2026-01-09)
- ✅ Виправлено список трансляцій: `GET /api/streams/` більше не падає через async lazy-load (`stream_destinations` тепер eager-load).
- ✅ Додано міграцію `026_collection_items_updated_at.sql` для сумісності старих локальних БД.
- ✅ Streaming builder: останній крок у модалці тепер коректно скролиться (кнопка “Створити” доступна без зуму).
- ✅ Library: після upload файли з’являються в списку без ручного refresh (довший refetch/backoff).

## Ключові прогалини (що дає найбільший приріст цінності)
1) **Repeats scheduler + windows + DST** (stop/timezone для one‑shot вже є, але repeats ще немає).
2) **Production‑готовий runner** для Docker/self‑host: довести до “не плутає” dev/prod (healthcheck, unix socket як default, docs).
3) **Optimize once → copy‑mode** (smart encoder pipeline) для бюджету і стабільності.
4) **YouTube Connect (OAuth) + Live Streaming API** для “one‑click connect” та автоматизації lifecycle.
5) **VOD segmentation** (auto‑restart під <12h архівування) + **live controls** (skip/jump/emergency).

---

## Phase A — “Ship‑ready MVP” (стабілізація і полірування)
**Ціль:** щоб сервіс був надійним для self‑host/Docker і мав мінімально очікувану автоматизацію.

**Deliverables**
- Scheduler: `stop_at` (one‑shot) + гарантований stop job, idempotency.
- Production runner: default для деплою через Docker Compose (окремий runner service) + інструкції.
- Asset lifecycle: “safe delete” як default (не можна видалити використаний asset; `force` — тільки для адмінів/не в UI).
- UX/Docs: “як взяти stream key”, попередження про 12h VOD, “first stream checklist”.
- Regression tests для scheduler stop та runner/reconcile сценаріїв.

**Exit criteria**
- Запущений стрім **не падає** при рестарті API (у production‑режимі).
- `start_at`/`stop_at` працює предиктивно в UTC, UI показує локальний час користувача.

---

## Phase B — “Дешево і масштабовано” (cost‑aware)
**Ціль:** знизити CPU/ризики несумісних файлів за рахунок pre‑convert.

**Deliverables**
- Optimize pipeline: worker + queue (Redis), “Optimize for YouTube” профіль (H.264/AAC, GOP/keyframes), derivative зберігання.
- UI: статус “Optimizing/Ready”, кнопка Optimize, політики зберігання derivative.
- Multi‑destination + plan gating (якщо потрібно для тарифів).
- Нотифікації/алерти (мінімум webhook/email) “stream down > N хв”.

**Exit criteria**
- Для “stream‑ready” файлів стрім іде в `-c copy` (CPU стабільно низький).

---

## Phase C — “v1 конкурентність” (як у SaaS‑патернів ринку)
**Ціль:** зменшити friction в onboarding + додати керування ефіром і розклад “як у конкурентів”.

**Deliverables**
- Scheduler v1: повтори (daily/weekly), windows, timezone per stream, `stop_after_duration`.
- VOD segmentation: автоперезапуск кожні ~11h50m (опція на стрім).
- YouTube OAuth + Live Streaming API: connect channel, create/bind/transition broadcast/stream, збереження refresh token encrypted.
- Live controls: skip current item, jump to item, emergency clip (пріоритет), reload playlist (hot‑swap).

**Exit criteria**
- Користувач може “Connect YouTube” і запускати стріми без ручного stream key (опційно, паралельно з RTMP‑режимом).

---

## Phase D — Later / Optional
- Overlays/templates (ticker/now playing/lower thirds), stream designer.
- Teams/Org/RBAC.
- Backup streams/failover.
- Billing (Stripe) + self‑serve plans.

---

## Рішення, які бажано зафіксувати перед реалізацією Phase A
- **Ціль деплою:** Docker‑first чи VM/systemd‑first (або обидва, але з чітким “default”).
- **Storage:** локальний диск vs S3/MinIO (особливо для optimize derivatives).
- **Черга/воркери:** Redis як single dependency vs окрема job‑система (RQ/Celery/Arq тощо).
