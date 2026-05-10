# MediaMTX: optional media-plane layer

Цей документ описує **не обов'язковий**, але вже підготовлений `v2` шар для майбутнього scale-up.

## Що це дає

MediaMTX у поточному проекті не замінює FFmpeg runtime. Він додається як:

- RTMP relay / ingress point для майбутнього fan-out
- окремий media-plane surface поруч із backend control-plane
- Prometheus-compatible metrics endpoint
- база для подальшого `runOnReady` / forwarding сценарію

Тобто `v1` лишається FFmpeg-first, а `v2` отримує підготовлений relay/metrics hub.

## Що вже підготовлено в repo

- Docker service: `mediamtx` у [docker/docker-compose.yml](~/Documents/Work/youtube_translation/docker/docker-compose.yml)
- Конфіг: [docker/mediamtx.yml](~/Documents/Work/youtube_translation/docker/mediamtx.yml)
- Optional bootstrap: `make dev-bootstrap-v2`
- Backend metrics summary: `/api/metrics` → `media_plane.mediamtx`
- Control API exposure for active paths: backend summary показує `active_paths` / `active_path_names`

## Як підняти локально

```bash
cd ~/Documents/Work/youtube_translation
make dev-bootstrap-v2
```

Це підніме:

- `postgres`
- `redis`
- `tusd`
- `mediamtx`

Локально MediaMTX management surfaces публікуються лише на loopback:

- Control API: `http://127.0.0.1:9997`
- Metrics: `http://127.0.0.1:9998/metrics`

Конфіг уже підготовлений для довільних локальних relay paths через:

```yaml
paths:
  all_others:
```

Тобто FFmpeg runtime може публікувати в адреси на кшталт `rtmp://mediamtx:1935/test/<stream-id>` без ручного додавання кожного path у конфіг.

## Backend env

У `backend/.env` для локального `v2` режиму:

```env
MEDIAMTX_ENABLED=true
MEDIAMTX_RTMP_PUBLISH_URL=rtmp://mediamtx:1935
MEDIAMTX_CONTROL_API_URL=http://mediamtx:9997
MEDIAMTX_METRICS_URL=http://mediamtx:9998/metrics
```

## Поточний scope

Зараз backend **не маршрутизує стріми через MediaMTX автоматично**. Це свідомо:

- не ламаємо поточний no-transcode path
- не змінюємо publish economics до YouTube
- додаємо observability і relay-ready surface без великої міграції

Але `v2` уже перевірений практично:

1. FFmpeg runtime може успішно publish-ити тестовий RTMP stream у MediaMTX.
2. `GET /v3/paths/list` повертає live path з track metadata.
3. `GET /metrics` відображає `paths{state="ready"}` і RTMP connection counters.

## Наступний етап

Коли будемо переходити до `v2` повноцінно, логіка буде така:

1. FFmpeg публікує в локальний MediaMTX path.
2. MediaMTX стає media-plane ingress/hub.
3. Далі або FFmpeg-forwarder, або `runOnReady` сценарій штовхає потік у YouTube RTMPS.
4. Backend керує control-plane, leases, scheduler і operator UX.

Це дає чистіший поділ:

- backend = orchestration / auth / quotas / scheduling
- systemd stream unit = FFmpeg playout/publish execution
- MediaMTX = relay / observability / future fan-out hub
