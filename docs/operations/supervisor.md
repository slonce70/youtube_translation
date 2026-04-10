# Supervisor для локального runtime

Цей документ описує канонічний локальний runtime path для macOS і Docker-based розробки.

## Коли використовувати

Використовуйте `STREAM_RUNTIME_MODE=supervisor`, якщо хочете:
- тримати FFmpeg-процеси окремо від FastAPI
- наблизити локальну поведінку до production runner-моделі
- тестувати `start/stop/status` через `supervisorctl`

## Що є канонічним локально

- Базові сервіси: `docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner`
- Бекенд: `./start-backend.sh`
- Фронтенд: `./start-frontend.sh`

Локально `start-backend.sh` спочатку намагається підключитися до вже запущеного Docker `runner` через `backend/supervisord.host-docker.conf`, який дивиться на `http://127.0.0.1:9001`. У самому Docker stack backend-контейнер спілкується з runner через `http://runner:9001`. Обидва supervisor HTTP endpoints захищені username/password, де password береться з `UPLOAD_TOKEN_SECRET`. Це дозволяє тримати FFmpeg у Docker `runner` і перезапускати лише API без втрати активних стрімів. Managed runner додатково пише heartbeat у shared `backend/streams/.runtime-heartbeats/`, а API процес тримає DB lease ownership у `streams.runtime_owner_id/runtime_lease_expires_at`, тому reconciliation може виявляти застряглий runtime і не дозволяти двом вузлам одночасно керувати одним stream. Якщо зовнішній runner недоступний, скрипт може підняти локальний `supervisord`; якщо supervisor tooling відсутній, у `development` він явно переходить у `manager` fallback.

## Tranche-one launch topology

Для першого production-like запуску підтримувана топологія така:

- один all-in-one вузол з `frontend`, `backend`, `postgres`, `redis`, `tusd`, `runner`, `ffmpeg` і локальним media disk

Чому саме так:

- `tusd` завершує upload у локальний filesystem path
- backend одразу після цього робить локальну валідацію через `ffprobe`
- thumbnail generation теж читає локальний файл
- stream prep досі будує payload із локального `storage_path`

Тобто backend поки що не можна безпечно відривати від media host. Частковий split можливий лише після переходу на object storage, де локальний диск стане кешем, а не source of truth.

Поки Phase 1 не завершена, не робіть цього:

- не додавайте multi-runner rollout
- не відділяйте backend від media host
- не замінюйте runner на MediaMTX-first схему без явної потреби

## Мінімальне налаштування

У `backend/.env`:

```env
STREAM_RUNTIME_MODE=supervisor
STREAM_RUNTIME_NODE_ID=local-dev-node
ALLOW_UNSAFE_MANAGER_RUNTIME=false
STREAM_RUNTIME_LEASE_TTL_SECONDS=60
STREAM_RUNTIME_HEARTBEAT_INTERVAL_SECONDS=10
STREAM_RUNTIME_HEARTBEAT_TTL_SECONDS=45
STREAM_RUNTIME_AUTO_RESTART_ENABLED=true
STREAM_RUNTIME_RESTART_MAX_ATTEMPTS=5
STREAM_RUNTIME_RESTART_BACKOFF_SECONDS=5
STREAM_RUNTIME_RESTART_BACKOFF_MAX_SECONDS=300
STREAM_RUNTIME_RESTART_JITTER_SECONDS=3
STREAM_RUNTIME_RESTART_RESET_AFTER_SECONDS=900
FFMPEG_TEE_ONFAIL_POLICY=ignore
FFMPEG_OUTPUT_RECOVERY_MAX_ATTEMPTS=0
SUPERVISOR_CTL_PATH=supervisorctl
SUPERVISOR_CONF_PATH=supervisord.conf
SUPERVISOR_CONFIG_DIR=supervisord/programs
SUPERVISOR_LOG_DIR=supervisord/logs
```

`backend/supervisord.docker.conf` лишається Docker-only конфігом для `runner:9001`, а `backend/supervisord.host-docker.conf` використовується лише локальним backend через loopback-публікацію `127.0.0.1:9001:9001`. Так management port не відкривається назовні ширше за localhost, а доступ додатково захищений через `UPLOAD_TOKEN_SECRET`.

## Lease ownership

- `STREAM_RUNTIME_NODE_ID` має бути стабільним для конкретного runtime-вузла або worker-group.
- Під час `start/restart` backend claim-ить DB lease для стріму.
- Standalone runner регулярно renew-ить цей lease разом із file heartbeat.
- Якщо lease перехоплений іншим вузлом або heartbeat застарів, reconciler переводить stream у `error`, чистить ownership і ставить persistent restart policy в БД.
- `STREAM_RUNTIME_AUTO_RESTART_ENABLED=true` вмикає backend-owned restart orchestration для `supervisor/systemd`.
- Retry budget та backoff живуть у `streams.runtime_restart_*`, тому recovery переживає restart самого API процесу.
- Якщо стрім стабільно відпрацював `STREAM_RUNTIME_RESTART_RESET_AFTER_SECONDS`, retry budget обнуляється.

Це не повний distributed coordinator, але цього вже достатньо, щоб уникати локального split-brain між кількома backend workers/nodes без великої міграції.

## Локальний fallback

`manager` не є preferred локальним режимом, але є безпечним fallback, коли:
- у системі немає `supervisorctl`
- у системі немає `supervisord` і немає вже запущеного зовнішнього runner
- ви хочете перевірити API/UI без окремого supervisor процесу

Цей fallback не змінює auth path або bootstrap path. Він лише спрощує локальний запуск. Для `staging` і `production` такий fallback блокується конфіг-валідатором, якщо ви явно не задали `ALLOW_UNSAFE_MANAGER_RUNTIME=true`.

## Приклад конфігурації

Приклад supervisor-конфігу є в:

- `docs/supervisor/supervisord.conf.example`

## Швидка перевірка

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner
./start-backend.sh
curl http://localhost:8000/health
```

Після цього виконайте короткий rehearsal зі списку в `docs/operations/first_stream_checklist.md`.

## Multi-destination failure policy

Для tranche-one runtime `FFMPEG_TEE_ONFAIL_POLICY=ignore` є рекомендованим дефолтом.

Що це дає:

- тимчасовий або постійний збій одного destination не повинен автоматично вбивати весь FFmpeg-процес
- інші destination-и можуть продовжити ефір

Що це не дає:

- це не робить destination “healthy” автоматично
- оператор усе ще має дивитися логи й підтверджувати, що degraded destination справді відновився

Якщо вам потрібен fail-fast сценарій, можна явно повернути `FFMPEG_TEE_ONFAIL_POLICY=abort`, але для публічного multi-destination запуску це менш безпечний режим.

## Операторські runbooks

### 1. Перезапуск вузла

Симптоми:

- після reboot або crash стріми зникли зі статусу `running`
- `/health` недоступний
- `runner` або `backend` не піднімаються

Дії:

1. Підніміть базові сервіси: `docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner`
2. Запустіть backend: `./start-backend.sh`
3. Перевірте `curl http://localhost:8000/health`
4. Перевірте `http://localhost:8000/docs`
5. Для кожного активного стріму перевірте runtime status у UI або logs і вручну перезапустіть лише ті стріми, що реально не відновилися

### 2. Failed stream triage

Симптоми:

- stream перейшов у `error`
- FFmpeg завершився non-zero code
- є repeated auto-restart warnings

Дії:

1. Перевірте log file стріму в `backend/supervisord/logs/`
2. Подивіться, чи проблема в одному destination або у всьому input path
3. Якщо проблема лише в одному destination, тимчасово відключіть його і повторіть start
4. Якщо проблема в input asset, відкрийте asset metadata та validation errors у UI/API
5. Якщо exhausted restart budget, не зациклюйте ручні retry без встановлення причини першого падіння

### 3. Disk pressure

Симптоми:

- upload завершується з помилками
- thumbnail generation або stream prep падають
- `disk_warning_percent` / `disk_critical_percent` перевищені

Дії:

1. Перевірте вільне місце на upload і stream directories
2. Очистіть старі logs та невикористані stream artifacts
3. Видаліть непотрібні uploads лише після звірки з asset records
4. Повторіть upload або stream start тільки після повернення достатнього запасу диска

### 4. Upload validation failures

Симптоми:

- upload успішно дійшов до tusd, але asset не створився або отримав validation errors
- stream не стартує з конкретним asset

Дії:

1. Перевірте backend logs навколо `upload-complete`
2. Переконайтесь, що `ffprobe` доступний на вузлі
3. Подивіться `validation_errors` і codec metadata в asset
4. Для першого ефіру використовуйте H.264 + AAC, GOP 2 секунди
5. Якщо файл був завантажений некоректно або поза allowed path, зробіть повторний upload замість ручного редагування `storage_path`
