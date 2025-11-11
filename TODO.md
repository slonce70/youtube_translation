# TODO / Progress Log

## Completed
- Extracted asset API logic into dedicated services (`backend/app/services/assets/*`) and slimmed down `app/api/routes/assets.py` to HTTP orchestration only.
- Refactored stream routes to rely on `StreamService` + `StreamControlService`, moved playlist/destination prep, quota checks, and runtime orchestration into `backend/app/services/streams/*`.
- Updated CLI runner and tests to use the new helpers, ensuring full backend `pytest` suite passes.
- Moved admin router business logic into `AdminService` + shared schemas, exposing the module through `Depends(get_admin_service)` so the router stays focused on HTTP concerns.
- Extracted destination CRUD logic into `DestinationService`, returning typed responses and keeping `destinations.py` at HTTP-only orchestration; full backend/frontend test suites now run clean via `make test`.
- Переніс усю квотну бізнес-логіку в `QuotaService` + `backend/app/schemas/quota.py`, залишивши роутер `quota.py` лише HTTP-шаром (tusd hook + user quota) й перевірив через `make test`.
- Виніс увесь функціонал `media_folders.py` (CRUD + прив’язки asset-ів) до `MediaFolderService`, роутер тепер просто делегує, а `make test` гарантує цілісність після змін.
- Аналогічно відрефакторив `media_collections.py`: зʼявився `MediaCollectionService`, додано `origin_playlist_id` в `MediaCollectionCreate`, повні `make test` (pytest + Jest) знову зелені.
- Переніс playlist CRUD/валідації в `PlaylistService`, оновив роутер на DI, зміг залишити Quota/PlaylistBuilder інʼєкцією й підтвердив стабільність `make test`.
- Після великого бекенд-рефакторингу прогнав `make lint` + `make type-check` (backend/frontend) — обидві команди зелені, зафіксовано як контрольну точку.
- **[2025-11-11] Проведено повний технічний аудит проекту:** backend (9/10), frontend (8/10), streaming (9/10), design (7.5/10), testing (8/10), security (8.5/10), docs (9/10). **Загальна оцінка: 8.5/10 — ВІДМІННО**. Виявлено 7 критичних issues (3-4 дні фіксів). Створено детальні звіти в `docs/AUDIT_REPORT_2025.md`, `AUDIT_SUMMARY.md` та `IMPROVEMENT_ROADMAP.md`.

## Next Up

### 🎯 CRITICAL - Must Fix Before Production (3-4 days)
See detailed roadmap in `IMPROVEMENT_ROADMAP.md`

1. **Quick Wins** (<1 hour total):
   - Increase `db_pool_size` from 3 to 10 (`backend/app/core/config.py`)
   - Fix status polling for error states (`frontend/src/app/dashboard/streaming/page.tsx:172`)
   - Add supervisor config sleep (`backend/app/core/supervisor_control.py:103`)
   - Fix deterministic shuffle seed (`backend/app/streaming/playlist_builder.py:148`)

2. **Frontend Refactor** (2-3 days):
   - Split `StreamingPage.tsx` (2,242 lines) into components
   - Extract business logic to helpers
   - Implement useReducer for complex state

3. **Security** (3 hours):
   - Add CSRF protection middleware
   - Centralize admin authorization

4. **Infrastructure** (5 hours):
   - Add FFmpeg memory cleanup
   - Setup CI/CD pipeline
   - Add test coverage reporting

### 📚 Reference Documents
- `docs/AUDIT_REPORT_2025.md` — повний технічний аудит (100+ pages)
- `AUDIT_SUMMARY.md` — executive summary (оцінка 8.5/10)
- `IMPROVEMENT_ROADMAP.md` — prioritized action items

### 🔄 Post-Critical Tasks
- Integration tests для main flows
- Frontend component testing
- Storybook for design system
- Performance monitoring (Sentry, OpenTelemetry)

**Project Status:** Production-ready after critical fixes (estimated 1 week)
