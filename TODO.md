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

## Next Up
1. Наступна хвиля сервісної декомпозиції: фіналізувати решту media-модулів (наприклад, playlist helpers, потенційні destination hooks) та оновити відповідні DI-фабрики.
2. Оновити `docs/operations/*`, `docs/systemd/*` і повʼязані нотатки в `docs/` з описом нової сервісної архітектури та інструкціями для операторів.
3. Повторювати `make lint` + `make type-check` після наступних великих блоків (Python/TS) й занотовувати результати (останній прогін успішний).
4. Провести аудит місць, де все ще напряму викликаються `QuotaEnforcer`, `ffmpeg_manager` чи інші «сирі» сервіси, та перенаправити їх через новостворені `Service`-класи.
5. Після стабілізації бекенду перейти до фронтенду: рефакторити `frontend/src/components/upload/UploadModal.tsx`, бібліотечні компоненти (`AssetCard`, `Breadcrumbs`, `FolderCard`) і актуалізувати локалізації + тести.
