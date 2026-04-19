# Supervisor runtime status

`supervisor` більше не є підтримуваним stream runtime для цього проєкту.

## Що робити замість цього

- Для production і canary використовуйте `STREAM_RUNTIME_MODE=systemd`
- Операційний runbook тепер живе в `docs/operations/systemd.md`
- Для локальної розробки використовуйте `manager` fallback лише як dev-only режим

## Чому документ залишився

Файл збережений лише як стабільний pointer для старих посилань у нотатках, чеклістах і rollout артефактах. Він не описує підтримуваний path і не повинен використовуватись як інструкція для нового bootstrap або triage.
