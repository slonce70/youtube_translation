# TODO / Progress Log

## Completed
- Hardened asset uploads: enforced audio/video extensions on frontend, normalized backend asset typing (cover art aware), and refreshed cards with compact layout + thumbnail resolution.
- Rebuilt Upload modal restrictions so audio mode rejects video streams up front and updated backend/unit tests to respect user-selected media type.
- Refactored library asset cards with tighter density, responsive thumbnails, and consistent badge layout to improve scrolling through large lists.
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

### 🔧 In Progress / Scheduled

1. **Audio vs Video validation parity**
   - Split backend validator paths so audio assets skip video-only checks and expose audio-focused guidance.
   - Adjust library + quality gate UIs to surface audio recommendations only where relevant.
   - Re-test revalidation/stream start flows with pure audio queues.

2. **Stream builder consistency**
   - Align terminology between "collections" in builder and playlists in Files section (copy, labels, available actions).
   - Expose/manage saved presets (video & audio) from a single UX entry point or provide clear CTAs to Library playlists.

3. **Documentation & contributor guide refresh**
   - Update `AGENTS.md` to reflect current architecture, bilingual (EN/UA/RU) localization setup, and new workflow expectations.

4. **Quality tasks backlog**
   - Evaluate remaining items from `IMPROVEMENT_ROADMAP.md` Sprint 2 once above parity tasks are done.

### 📚 Reference Documents
- `docs/AUDIT_REPORT_2025.md` — повний технічний аудит (100+ pages)
- `AUDIT_SUMMARY.md` — executive summary (оцінка 8.5/10)
- `IMPROVEMENT_ROADMAP.md` — prioritized action items

### 🔄 Post-parity ideas
- Expand integration tests for builder/audio streams
- Add Storybook coverage for media management components
- Instrument performance/observability once parity fixes land

**Project Status:** Production-ready after critical fixes (estimated 1 week)
