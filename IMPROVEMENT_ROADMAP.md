# YouTube Streaming Platform - Improvement Roadmap

**Базується на аудиті від 2025-11-11**  
**Загальна оцінка проекту: 8.5/10 — ВІДМІННО**

---

## 🔴 CRITICAL PRIORITY - Зробити перед production deploy

### Backend

- [x] **P1: Підвищити database connection pool**
  - Файл: `backend/app/core/config.py:32`
  - Змінити: `db_pool_size: int = 10` (було 3)
  - Змінити: `db_max_overflow: int = 5` (було 0)
  - Reason: 3 connections занадто мало для 10+ concurrent streams
  - Estimated: 5 minutes

- [x] **P2: Add FFmpeg error history cleanup**
  - Файл: `backend/app/streaming/ffmpeg_manager.py:85`
  - Додати метод для cleanup stopped streams older than 1 hour
  - Викликати з `cleanup_dead_streams()` periodic task
  - Reason: Memory leak при багатьох short-lived streams
  - Estimated: 30 minutes

- [x] **P3: Fix supervisor config race condition**
  - Файл: `backend/app/core/supervisor_control.py:103`
  - Додати `await asyncio.sleep(0.1)` після `write_text()`
  - Reason: На повільних FS файл може не бути visible одразу
  - Estimated: 5 minutes

### Frontend

- [x] **P4: Fix stream status polling for error states**
  - Файл: `frontend/src/app/dashboard/streaming/page.tsx:172`
  - Змінити: `refetchInterval: ['running', 'starting', 'error'].includes(stream.status) ? 5000 : 30000`
  - Reason: Error streams потребують fast polling для auto-restart detection
  - Estimated: 2 minutes

- [ ] **P5: Розбити StreamingPage.tsx на компоненти**
  - Файл: `frontend/src/app/dashboard/streaming/page.tsx` (2242 lines!)
  - Створити: `streaming/components/` структуру
  - Extracted components:
    - `ChannelsSidebar/` (200 lines)
    - `StreamsList/` (300 lines)
    - `StreamBuilder/` (600 lines split into tabs)
    - `LiveEditor/` (300 lines)
    - `QualityGateModal/` (200 lines)
  - Створити hooks: `useStreamBuilder`, `useLiveEditor`, `useQualityGate`
  - Reason: Unmaintainable monolith, hard to test
  - Estimated: 2-3 days

### Security

- [x] **P6: Add CSRF protection**
  - Файл: `backend/app/main.py`
  - Install: `starlette-csrf`
  - Add middleware: `CSRFMiddleware`
  - Update frontend to send CSRF tokens
  - Reason: POST/PUT/DELETE vulnerable to CSRF attacks
  - Estimated: 2 hours

- [x] **P7: Centralize admin authorization**
  - Файл: `backend/app/api/deps.py`
  - Створити: `require_admin` dependency
  - Update all admin routes to use it
  - Reason: Manual checks error-prone
  - Estimated: 1 hour

---

## 🟡 HIGH PRIORITY - Зробити до release

### Testing

- [ ] **P8: Add test coverage reporting**
  - Файл: `backend/pytest.ini`
  - Add: `--cov=app --cov-report=html --cov-report=term-missing`
  - Target: ≥80% coverage
  - Create badge with `coverage-badge`
  - Estimated: 30 minutes

- [ ] **P9: Create integration tests**
  - Файл: `backend/tests/integration/test_streaming_flow.py` (new)
  - Test flows:
    - Upload → validate → create stream → start
    - Quality gate rejection → fix → retry
    - Supervisor restart handling
  - Estimated: 4 hours

- [ ] **P10: Add frontend component tests**
  - Files to test:
    - `UploadModal.test.tsx`
    - `AssetCard.test.tsx`
    - `StreamCard.test.tsx`
    - `ChannelForm.test.tsx`
  - Target: Critical user flows covered
  - Estimated: 6 hours

### Code Quality

- [ ] **P11: Extract quality gate logic to helpers**
  - Файл: `frontend/src/app/dashboard/streaming/page.tsx:156`
  - Створити: `streaming/utils/qualityGateHelpers.ts`
  - Move: `groupQualityViolations` function
  - Add unit tests
  - Reason: Business logic not in components
  - Estimated: 1 hour

- [ ] **P12: Implement useReducer for live editor**
  - Файл: `frontend/src/app/dashboard/streaming/page.tsx:124`
  - Створити: `streaming/hooks/useLiveEditor.ts`
  - Replace nested useState with reducer pattern
  - Add action types for type safety
  - Reason: Complex state updates error-prone
  - Estimated: 3 hours

- [ ] **P13: Fix deterministic shuffle**
  - Файл: `backend/app/streaming/playlist_builder.py:148`
  - Update: `_seed_from_components` to use timestamp
  - Add `use_timestamp` parameter (default True)
  - Keep deterministic option for tests
  - Reason: Users expect different order on restart
  - Estimated: 20 minutes

### Infrastructure

- [ ] **P14: Setup CI/CD pipeline**
  - Створити: `.github/workflows/ci.yml`
  - Jobs:
    - Backend lint + type-check + tests
    - Frontend lint + type-check + tests
    - Build Docker images
    - Deploy to staging (optional)
  - Estimated: 3 hours

- [ ] **P15: Add health check endpoint for streams**
  - Файл: `backend/app/api/routes/monitoring.py` (new)
  - Endpoint: `GET /api/health/streams`
  - Return: supervisor program states, failed streams
  - Use for: External monitoring (Uptime Robot, etc)
  - Estimated: 1 hour

---

## 🟢 MEDIUM PRIORITY - Post-MVP improvements

### Design System

- [ ] **P16: Create Storybook documentation**
  - Install Storybook 8
  - Create stories for all UI components:
    - Button, Card, Badge, Input, Tabs
    - AssetCard, FolderCard, StreamCard
  - Add controls and docs
  - Deploy to GitHub Pages
  - Estimated: 1 day

- [ ] **P17: Standardize spacing scale**
  - Файл: `frontend/tailwind.config.js`
  - Define explicit spacing: `xs/sm/md/lg/xl`
  - Replace magic numbers: `space-y-3` → `space-y-sm`
  - Update all components
  - Estimated: 2 hours

- [ ] **P18: Fix component prop naming**
  - Establish convention: boolean props without `is` prefix
  - Update: `isLoading` → `loading`
  - Keep: `disabled`, `selected`, `open`
  - Search & replace across codebase
  - Estimated: 1 hour

### Performance

- [ ] **P19: Implement exponential backoff**
  - Файл: `backend/app/streaming/ffmpeg_manager.py:580`
  - Change: `backoff = min(5 * (2 ** attempts), 60)`
  - Update tests
  - Reason: Fixed 5s backoff too aggressive
  - Estimated: 30 minutes

- [ ] **P20: Add async file reading for logs**
  - Файл: `backend/app/services/streams/control.py:246`
  - Replace: `open()` → `aiofiles.open()`
  - Add: `async with` context manager
  - Reason: Blocks event loop on large files
  - Estimated: 15 minutes

### Monitoring

- [ ] **P21: Setup Sentry for production**
  - Update: `backend/.env` with `SENTRY_DSN`
  - Configure: `sentry_sdk.init()` already present
  - Add source maps for frontend
  - Configure alert rules
  - Estimated: 1 hour

- [ ] **P22: Add OpenTelemetry spans**
  - Install: `opentelemetry-instrumentation-fastapi`
  - Add spans for:
    - Stream start/stop operations
    - FFmpeg command building
    - Quality evaluation
  - Export to: Jaeger or Honeycomb
  - Estimated: 3 hours

### User Experience

- [ ] **P23: Add client-side form validation**
  - Install: `zod` + `react-hook-form`
  - Add schemas for:
    - Channel form (stream key validation)
    - Stream builder (required fields)
  - Show validation errors inline
  - Estimated: 4 hours

- [ ] **P24: Improve error messages**
  - Файл: `frontend/src/lib/api.ts`
  - Create: `ERROR_MESSAGE_MAP` для error codes
  - Map: HTTP status → localized message
  - Replace: `error.message` → `t(errorKey)`
  - Estimated: 2 hours

- [ ] **P25: Add accessibility improvements**
  - Audit with: Lighthouse, axe DevTools
  - Add missing: `aria-label`, `aria-describedby`
  - Ensure: keyboard navigation works
  - Test with: screen reader
  - Estimated: 4 hours

---

## ⚪️ LOW PRIORITY - Future enhancements

### Advanced Features

- [ ] **P26: WebSocket замість SSE**
  - Replace: Server-Sent Events
  - Use: WebSocket for bidirectional communication
  - Benefits: Lower latency, less overhead
  - Estimated: 1 week

- [ ] **P27: GraphQL API**
  - Add: GraphQL endpoint as alternative to REST
  - Use: Strawberry or Ariadne
  - Benefits: Flexible queries, type safety
  - Estimated: 1 week

- [ ] **P28: Advanced scheduling**
  - Add: Cron-like scheduling UI
  - Support: Recurring streams (daily/weekly)
  - Add: Start/stop at specific times
  - Estimated: 1 week

### Performance

- [ ] **P29: Performance benchmarks**
  - Setup: Locust or k6 load testing
  - Test: Concurrent API requests
  - Test: Multiple simultaneous streams
  - Measure: Response times, throughput
  - Estimated: 2 days

- [ ] **P30: Database query optimization**
  - Add: Query performance monitoring
  - Create: Composite indexes where needed
  - Analyze: EXPLAIN plans for slow queries
  - Estimated: 3 days

### DevOps

- [ ] **P31: Docker optimization**
  - Multi-stage builds for smaller images
  - Add healthchecks to containers
  - Setup auto-restart policies
  - Estimated: 4 hours

- [ ] **P32: Kubernetes deployment**
  - Create: Helm charts
  - Setup: Horizontal Pod Autoscaling
  - Configure: Ingress controller
  - Estimated: 1 week

---

## 📊 Progress Tracking

### Sprint 1: Critical Fixes (1 week)
- [x] P1: Database pool
- [x] P2: Memory cleanup
- [x] P3: Supervisor race
- [x] P4: Status polling
- [x] P6: CSRF protection
- [x] P7: Admin auth

### Sprint 2: Frontend Refactor (2 weeks)
- [ ] P5: Split StreamingPage
- [ ] P11: Extract helpers
- [ ] P12: useReducer
- [ ] P8: Test coverage

### Sprint 3: Testing & CI (1 week)
- [ ] P9: Integration tests
- [ ] P10: Component tests
- [ ] P14: CI/CD pipeline

### Sprint 4: Polish & Monitoring (1 week)
- [ ] P15: Health checks
- [ ] P21: Sentry
- [ ] P16: Storybook
- [ ] P23: Form validation

---

## 🎯 Success Criteria

### Ready for Production:
- ✅ All CRITICAL items completed
- ✅ Test coverage ≥80%
- ✅ CI/CD pipeline working
- ✅ Sentry monitoring active
- ✅ Documentation updated

### Production Checklist:
- [ ] ENCRYPTION_KEY set (32 bytes)
- [ ] DATABASE_URL configured (production)
- [ ] db_pool_size ≥ 10
- [ ] CORS origins restricted
- [ ] Sentry DSN configured
- [ ] Supervisor running as service
- [ ] Health endpoints responding
- [ ] Backups configured
- [ ] SSL certificates valid
- [ ] Load testing passed

---

## 📝 Notes

### Known Issues
- StreamingPage refactor is biggest effort (2-3 days)
- Integration tests require real FFmpeg/Supervisor
- Some tests may need Docker for isolation

### Quick Wins
- P1, P3, P4, P13 can be done in <1 hour total
- P8, P15, P19, P20 simple additions

### Dependencies
- P5 should be done before P11, P12 (refactor first)
- P14 needs P8, P9, P10 (tests first)
- P21 requires production deployment

---

**Total Estimated Effort:**
- Critical: 3-4 days
- High: 2 weeks
- Medium: 2 weeks
- Low: 1-2 months

**Minimum for production: ~1 week of focused work**
