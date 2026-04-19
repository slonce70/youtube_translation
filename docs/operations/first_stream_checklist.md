# Чекліст першого ефіру

Цей список допоможе підготуватися до першої трансляції, щоб старт був стабільним і без помилок.

Для фінального MVP саме цей single-node, single-destination rehearsal є launch bar. `systemd` hardening і multi-destination readiness існують окремо як post-MVP rollout lanes.

## Визначення "першого успішного стріму"

Перший локально успішний стрім у цьому проєкті означає:
- один автентифікований локальний користувач
- один сумісний asset у форматі H.264/AAC
- один увімкнений RTMPS destination
- створений і запущений stream
- статус `running` і стабільні логи протягом кількох хвилин
- коректна зупинка без аварійного падіння

Саме це вважається мінімальним rehearsal-критерієм перед подальшими змінами.

## Підтримувана топологія для першого запуску

Для першого production-like запуску в цьому репозиторії підтримується один all-in-one вузол:

- `frontend`
- `backend`
- `postgres`
- `redis`
- `tusd`
- `runner`
- локальний media disk

Не розділяйте backend і media host до переходу на object storage. Зараз upload finalization, ffprobe validation, thumbnail generation і stream prep все ще спираються на локальний `storage_path`.

## 1) Доступ і середовище
- Для локального rehearsal рекомендовано `ENABLE_DEV_AUTH=true` і `NEXT_PUBLIC_DEV_BYPASS_AUTH=1`.
- Якщо перевіряєте продуктовий auth path, використовуйте валідні Supabase credentials замість DEV auth.
- Переконайтесь, що `.env` містить коректні значення (без прод‑ключів у репозиторії).
- Підніміть базові сервіси через `docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner`.
- Запустіть `./start-backend.sh` і `./start-frontend.sh`.
- Перевірте доступність **FFmpeg** та **tusd**.

## 2) Канал (YouTube / RTMPS)
- Додайте канал у розділі **Канали** (RTMPS URL + stream key).
- Переконайтесь, що канал **увімкнено**.

## 3) Файли та формати
- Завантажте відео/аудіо у розділі **Файли**.
- Рекомендовані налаштування енкодера:
  - Відео: **H.264 (yuv420p)**
  - Аудіо: **AAC**
  - GOP / keyframe: **2 секунди**

## 4) Розклад і тривалість
- Можна запускати **зараз** або **за розкладом**.
- Для зручності використовуйте швидкі тривалості (12/24/48 год).
- **VOD‑обмеження:** YouTube архівує ефір лише до **12 годин**. Для довших стрімів плануйте перезапуск або розбийте ефір на сегменти.

## 5) Перед стартом
- Створіть тестову трансляцію і запустіть на кілька хвилин.
- Перевірте, що backend відповідає на `curl http://localhost:8000/health`.
- Переконайтесь, що відкривається `http://localhost:8000/docs`.
- Переконайтесь, що відкриваються `http://localhost:3000/dashboard` і `http://localhost:3000/admin`.
- Перевірте логи (важливі повідомлення та помилки).
- Переконайтесь, що прев’ю та плейлисти відображаються коректно.

## 6) Після DEV auth rehearsal
- Залиште `DEV auth` як основний локальний шлях.
- Окремо зробіть один sanity check реального Supabase auth path без `NEXT_PUBLIC_DEV_BYPASS_AUTH`, щоб підтвердити, що продуктовий логін не зламаний.

## 7) Під час ефіру
- Слідкуйте за статусом і залишком денного ліміту.
- У разі помилки перевірте лог‑панель та повідомлення системи.

## 8) Post-MVP multi-destination rehearsal
- Для post-MVP публічного запуску вважайте multi-destination окремим rehearsal gate, а не автоматично “готовою” можливістю.
- Рекомендований дефолт: `FFMPEG_TEE_ONFAIL_POLICY=ignore`.
- Якщо один destination падає, перевірте, що інші продовжують ефір, а degraded destination видно в логах.
- Не запускайте публічний multi-destination сценарій без окремої перевірки цього кейсу на своїх RTMPS endpoints.

## 9) Post-MVP systemd rollout
- Host-native `systemd` path для Linux production не є частиною фінального MVP gate.
- Якщо переходите до нього після MVP, використовуйте `docs/operations/systemd.md` як окремий rollout runbook.
