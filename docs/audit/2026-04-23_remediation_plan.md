# План виправлень та покращень — 2026-04-23

Документ виводить у план пункти з аудиту `docs/audit/2026-04-23_audit.md` (якщо винесете звіт) та пріоритизує їх за severity. Кожен пункт: **файл:рядок**, **причина**, **дія**, **критерій приймання**, **ризик виконання**.

Легенда: 🔴 High · 🟠 Medium · 🟡 Low · ✨ Improvement.

---

## Фаза 0 — Передумови (до будь-яких змін)

- Створити feature-гілку `chore/audit-remediation-2026-04` від `origin/main`.
- Зафіксувати поточний `git status` (21 M + 2 ??) окремими коммітами за логічними зонами (backend / frontend / scripts / docs) — **не** змішувати з правками цього плану.
- Переконатися що CI зелений на main до старту.

---

## Фаза 1 — Критичні конфігураційні ризики (🔴 High)

### 1.1 Fail-closed валідатор дефолтних секретів

- **Файл:** [backend/app/core/config.py:49-55,97](backend/app/core/config.py)
- **Причина:** `download_token_secret`, `upload_token_secret`, `encryption_salt`, `metrics_access_token` мають дефолтні значення-плейсхолдери. Якщо prod `.env` забуде їх перекрити — застосунок мовчки стартує з відомими секретами.
- **Дія:** додати `@model_validator(mode="after")` у `Settings`:
  ```python
  PROD_ENVS = {"staging", "production"}
  INSECURE_DEFAULTS = {
      "download_token_secret": "change_this_download_secret",
      "upload_token_secret":   "change_this_upload_secret",
      "encryption_salt":       "default_salt_change_in_production_16bytes",
  }

  @model_validator(mode="after")
  def _forbid_default_secrets_in_prod(self) -> "Settings":
      if self.environment.lower() in PROD_ENVS:
          leaked = [k for k, v in INSECURE_DEFAULTS.items() if getattr(self, k) == v]
          if self.metrics_access_token in (None, "", "change_this_metrics_token"):
              leaked.append("metrics_access_token")
          if leaked:
              raise ValueError(
                  f"Refusing to start in {self.environment!r} with default secrets: {leaked}"
              )
      return self
  ```
- **Критерій:** `ENVIRONMENT=production` + дефолтний `.env` → `ValidationError`. Unit-тест `tests/core/test_config_defaults.py`.
- **Ризик:** мінімальний; зачіпає лише старт у prod/staging.

### 1.2 Auto-schema-patch на старті → окремий migrate-step

- **Файл:** [backend/app/main.py:175](backend/app/main.py), [backend/app/core/database.py:150-493](backend/app/core/database.py)
- **Причина:** `apply_schema_patches()` викликається при кожному старті backend. При rolling-deploy дві реплікі одночасно виконують DDL; advisory-lock `SCHEMA_PATCH_LOCK_ID=872634` серіалізує, але lock утримується довго → blocked startup.
- **Дія:**
  1. Додати `settings.run_schema_patches_on_boot: bool = False` (default `False` у prod).
  2. У `main.py:175` викликати тільки якщо `settings.environment == "development"` або прапор увімкнено.
  3. Створити окремий CLI-ентрипойнт `python -m app.cli.migrate` який запускається у `deploy_vps.sh` до старту сервісу.
  4. Додати у `scripts/deploy_vps.sh` фазу `run_migrations` перед `docker compose up` backend.
- **Критерій:** два backend-контейнери піднімаються паралельно без DDL-контенції; `migrate`-step видимий у CI логах.
- **Ризик:** середній — змінює порядок деплою; потрібен rollback-план.

---

## Фаза 2 — Злагодженість конфігів та процесів (🟠 Medium)

### 2.1 Синхронізація версій лінтерів

- **Файли:** [backend/requirements.txt](backend/requirements.txt), [.pre-commit-config.yaml](.pre-commit-config.yaml)
- **Причина:** runtime/CI має `black==26.3.1`, `ruff==0.6.3`, `mypy==1.11.2`; pre-commit — `black 23.12.1`, `ruff v0.1.9`, `mypy v1.8.0`. Локальний pre-commit форматує інакше, ніж CI → нескінченні "fix style" комміти.
- **Дія:** підняти `.pre-commit-config.yaml` rev до відповідних тегів:
  - `psf/black` → `26.3.1`
  - `astral-sh/ruff-pre-commit` → `v0.6.3`
  - `pre-commit/mirrors-mypy` → `v1.11.2`
- Запустити `pre-commit run --all-files`; очікувати 0 diff після попереднього проходу.
- **Критерій:** `pre-commit run --all-files` на main → clean; те саме у CI.
- **Ризик:** низький — одноразовий stylistic diff.

### 2.2 Deploy cron — з 5 хв до години

- **Файл:** `.github/workflows/deploy-vps.yml` (`on.schedule.cron`)
- **Причина:** `*/5 * * * *` = 288 SSH/день + minutes billing. Watch-deploy не потребує такої частоти.
- **Дія:** `cron: '0 * * * *'` + обмежити `needs_deploy` only-on-new-image.
- **Критерій:** workflow викликається 24/добу; функціональність ідентична.
- **Ризик:** мінімальний.

### 2.3 `reload=True` захардкожений у entrypoint

- **Файл:** [backend/app/main.py:270-277](backend/app/main.py)
- **Дія:**
  ```python
  uvicorn.run(
      "app.main:app",
      **build_uvicorn_run_kwargs(
          host=settings.api_host,
          port=settings.api_port,
          reload=settings.environment == "development",
      ),
  )
  ```
- **Критерій:** `ENVIRONMENT=production python app/main.py` не ставить `reload`.
- **Ризик:** нульовий.

### 2.4 Один власник міграцій

- **Файли:** [backend/apply_migrations.py](backend/apply_migrations.py) (51 КБ), `backend/migrations/`, `backend/apply_migration_007.py`, `backend/apply_migration_007_direct.py`
- **Причина:** дві паралельні системи міграцій → двозначна історія схеми.
- **Дія:**
  1. Провести diff: чи всі DDL з `apply_migrations.py` є як Alembic-ревізії.
  2. Якщо так → видалити `apply_migrations.py` і два one-shot `apply_migration_007*.py`.
  3. Якщо ні → згенерувати відсутні ревізії, потім видалити.
  4. Оновити `docs/operations/` + README щодо єдиного шляху `alembic upgrade head`.
- **Критерій:** на чистій БД `alembic upgrade head` повністю відтворює схему; тести `tests/test_migrations.py` зелені.
- **Ризик:** середній — потенційна втрата DDL при неуважному diff. Зробити dry-run на тестовій БД.

### 2.5 Frontend: `useEffect` без dependency array

- **Файл:** [frontend/src/components/upload/UploadModal.tsx:546-559](frontend/src/components/upload/UploadModal.tsx)
- **Причина:** ефект виконується після **кожного** рендеру → handler постійно знімається/додається. Крім того, `hasBlockingUpload` оголошений **після** ефекту (рядок 561) — тільки closure/hoisting рятує від TDZ-помилки.
- **Дія:**
  1. Перемістити `const hasBlockingUpload = useMemo(...)` **вище** `useEffect`.
  2. Додати deps: `[isOpen, isProcessingUpload, hasBlockingUpload, onClose]`.
  3. Увімкнути `eslint-plugin-react-hooks/exhaustive-deps` у workspace (перевірити чи вже active).
- **Критерій:** DevTools → keydown listener реєструється один раз при `isOpen=true`, знімається при `isOpen=false`.
- **Ризик:** нульовий.

### 2.6 Accessibility: modal dialogs

- **Файли:** [frontend/src/app/dashboard/streaming/components/QualityGateModal.tsx](frontend/src/app/dashboard/streaming/components/QualityGateModal.tsx), [frontend/src/components/upload/UploadModal.tsx](frontend/src/components/upload/UploadModal.tsx)
- **Причина:** обидва — `<div>` без `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Немає focus-trap.
- **Дія:**
  1. Обгорнути контент у:
     ```tsx
     <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
       <h2 id="modal-title">…</h2>
       …
     </div>
     ```
  2. Додати залежність `@radix-ui/react-dialog` **або** внутрішній компонент `<Modal>` з focus-trap (`focus-trap-react` ~8 KB, або `@ariakit/react`). Перевірити чи компонент вже існує у `frontend/src/components/ui/` — reuse.
  3. При `open` — first focus на close-button; при `close` — return focus на trigger.
- **Критерій:** axe DevTools → 0 violations; screen reader (VoiceOver/NVDA) озвучує заголовок модалки.
- **Ризик:** низький; потенційно додає dep.

### 2.7 XSS hardening для JSON-LD

- **Файл:** [frontend/src/app/structured-data.tsx:41](frontend/src/app/structured-data.tsx)
- **Дія:**
  ```tsx
  const safeJson = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  ```
- **Критерій:** якщо `title`/`description` містить `</script>` — вихідний HTML не закриває `<script>`.
- **Ризик:** нульовий.

---

## Фаза 3 — Косметика та hygiene (🟡 Low)

### 3.1 `rel="noopener noreferrer"` для target="_blank"

- [frontend/src/components/upload/UploadModal.tsx:1106-1112](frontend/src/components/upload/UploadModal.tsx)
- [frontend/src/components/streaming/AddChannelModal.tsx:106](frontend/src/components/streaming/AddChannelModal.tsx)
- Додати `noopener` до всіх зовнішніх лінків з `target="_blank"`.

### 3.2 Чистка кореня репо

- Видалити з git: кореневий `package.json`, `package-lock.json`, `node_modules/` (залишити лише `frontend/node_modules/`).
- Перенести `prototype-v2.html` з `.git/info/exclude` у `.gitignore` (або видалити, якщо застарів).
- Прибрати фізичні `.DS_Store`, застарілі `backend/apply_migration_007*.py` (після Фази 2.4).
- Прибрати `backend/pip-install.log` з workdir.

### 3.3 ESLint flat config

- Мігрувати `.eslintrc.json` → `eslint.config.mjs` (Next 15 + ESLint 9). Розмір роботи ~1 год.

### 3.4 Прибрати невикористовувані `except Exception: pass`

- [backend/app/services/assets/service.py:325-327,387](backend/app/services/assets/service.py) — додати `logger.debug(...)` перед `pass` для traceability, або використати `contextlib.suppress(...)` з коментарем-причиною.

---

## Фаза 4 — Покращення (✨ Improvement)

### 4.1 Метрики покриття тестів

- Додати `pytest-cov` run до CI (`backend-quality.yml`) з порогом `--cov-fail-under=75`.
- Публікувати coverage report як artifact.

### 4.2 Dependabot / Renovate

- Створити `.github/dependabot.yml` для `pip` + `npm` + `github-actions` (weekly).
- Альтернатива: Renovate з grouping для minor/patch.

### 4.3 Secret-scanning у pre-commit

- `detect-secrets` вже у `.pre-commit-config.yaml` — перевірити що baseline (`.secrets.baseline`) свіжий; refresh через `detect-secrets scan --baseline .secrets.baseline`.

### 4.4 Systemd-unit hardening audit

- Пройтись по `docs/systemd/*.example`, перевірити наявність: `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `MemoryMax=`, `TasksMax=`. Винести рекомендації у `docs/operations/systemd_hardening.md`.

### 4.5 Observability baseline

- Додати `structlog` processor для `request_id` + `user_id` propagation через `contextvars`.
- Задокументувати у `docs/operations/logging.md` формат JSON-логів і ключові поля (`event`, `stream_id`, `user_id`, `duration_ms`).

---

## План виконання по спринтах

| Спринт | Тривалість | Зміст | Gate |
|---|---|---|---|
| S1 | 2–3 дні | Фаза 1 (1.1, 1.2) + Фаза 2.3 + 2.5 + 2.7 | CI green, manual smoke test prod-like stack |
| S2 | 2 дні | Фаза 2.1, 2.2, 2.6 | `pre-commit run --all-files` clean; axe DevTools 0 violations |
| S3 | 3–5 днів | Фаза 2.4 (міграції) | `alembic upgrade head` на чистій БД; `tests/test_migrations.py` green |
| S4 | 1 день | Фаза 3 (hygiene) | repo size diff, lint clean |
| S5 | опційно | Фаза 4 (improvements) | coverage report у CI artifact |

---

## Верифікація (end-to-end)

Після кожної фази:

1. **Backend:** `cd backend && pytest -x -q` — усі 62 тестфайли зелені.
2. **Frontend:** `cd frontend && npm run lint && npm run type-check && npm run test && npm run build`.
3. **Integration:** `docker compose -f docker/docker-compose.yml up -d` → curl `http://localhost:8000/health` = 200, фронт `http://localhost:3000` рендерить dashboard.
4. **Deploy dry-run:** `bash scripts/deploy_vps.sh --dry-run` (якщо підтримується) або staging VPS.
5. **Security:** `bandit -r backend/app` (порівняти baseline), `npm audit --production` (frontend).
6. **A11y (після Фази 2.6):** у Chrome DevTools → Lighthouse → Accessibility ≥ 95.

## Rollback-стратегія

- Кожна фаза — окрема feature-гілка, окремий PR.
- Для Фази 1.2 (міграції): зберегти `apply_schema_patches()` за прапором на 1 реліз; видалити у наступному.
- Для Фази 2.4: зробити snapshot БД перед run на staging.

---

## Коротка зведена таблиця

| # | Severity | Файл | Зусилля |
|---|---|---|---|
| 1.1 | 🔴 | `backend/app/core/config.py:49-55,97` | 1 год |
| 1.2 | 🔴 | `backend/app/main.py:175` + `scripts/deploy_vps.sh` | 4 год |
| 2.1 | 🟠 | `.pre-commit-config.yaml` | 30 хв |
| 2.2 | 🟠 | `.github/workflows/deploy-vps.yml` | 10 хв |
| 2.3 | 🟠 | `backend/app/main.py:270-277` | 5 хв |
| 2.4 | 🟠 | `backend/apply_migrations.py` + `migrations/` | 1–2 дні |
| 2.5 | 🟠 | `frontend/.../UploadModal.tsx:546-559` | 20 хв |
| 2.6 | 🟠 | `frontend/.../QualityGateModal.tsx`, `UploadModal.tsx` | 3 год |
| 2.7 | 🟠 | `frontend/src/app/structured-data.tsx:41` | 5 хв |
| 3.1 | 🟡 | `UploadModal.tsx:1106`, `AddChannelModal.tsx:106` | 10 хв |
| 3.2 | 🟡 | корінь репо | 30 хв |
| 3.3 | 🟡 | `.eslintrc.json` | 1 год |
| 3.4 | 🟡 | `backend/app/services/assets/service.py` | 20 хв |
| 4.1 | ✨ | CI | 1 год |
| 4.2 | ✨ | `.github/dependabot.yml` | 30 хв |
| 4.3 | ✨ | pre-commit | 15 хв |
| 4.4 | ✨ | `docs/systemd/` | 2 год |
| 4.5 | ✨ | logging | 4 год |

**Загальна оцінка зусиль:** 4–6 робочих днів інженера для всіх High+Medium; +2 дні для Improvements.
