# Керування стрімами через Supervisord

Підходить для macOS, Docker і серверів без systemd. Кожен FFmpeg-процес
запускається через CLI `python -m app.cli.run_stream <stream_id>`, а Supervisord
стежить за його життєвим циклом (автозапуск, перезапуск після збоїв).

## 1. Встановити Supervisor

- **macOS**: `brew install supervisor`
- **Ubuntu/Debian**: `sudo apt install supervisor`
- **Docker**: додайте `pip install supervisor` та стартуйте `supervisord`

## 2. Базовий `supervisord.conf`

1. Скопіюйте `docs/supervisor/supervisord.conf.example` у `/etc/supervisord.conf`
   (або зберіть власний). Він включає глобальні налаштування та приклад
   каталогу для програм.
2. Важливо: **ніяких ручних `[program:...]` блоків створювати не потрібно**.
   Бекенд сам генерує `.ini` для кожної трансляції в директорії
   `SUPERVISOR_CONFIG_DIR` і викликає `supervisorctl reread/update`.
3. Переконайтеся, що каталог логів (`SUPERVISOR_LOG_DIR`) існує й доступний
   для запису.

## 3. Налаштувати бекенд

У `backend/.env` (і кореневому `.env`, якщо використовується) додайте:

```
STREAM_RUNTIME_MODE=supervisor
SUPERVISOR_PROGRAM_TEMPLATE=stream_{stream_id}
SUPERVISOR_CTL_PATH=supervisorctl
```

Після цього бекендові ендпоінти `POST /streams/{id}/start|stop` автоматично:

1. Створюють `.ini` в `SUPERVISOR_CONFIG_DIR` з правильною командою
   `python -m app.cli.run_stream`;
2. Викликають `supervisorctl reread/update`;
3. Стартують/зупиняють потрібну програму;
4. При видаленні стріму зупиняють і прибирають `.ini`.

Статус `/streams/{id}/status` читається напряму з `supervisorctl status`.

## 4. Старт / стоп стріму

```bash
supervisorctl reread            # виявити нові програми
supervisorctl update            # застосувати конфіг
supervisorctl start stream_<uuid>
supervisorctl status stream_<uuid>
supervisorctl stop stream_<uuid>
```

Після краху FFmpeg або перезавантаження хоста Supervisor перезапустить процес і
CLI оновить статус у БД. Фронтенд, у свою чергу, побачить фактичний стан.

## 5. Docker

У контейнері можна запускати `supervisord` як PID 1:

```Dockerfile
CMD ["/usr/local/bin/supervisord", "-c", "/etc/supervisord.conf"]
```

Таким чином той самий конфіг працює у dev (macOS), staging (Docker) та prod
(Debian).
