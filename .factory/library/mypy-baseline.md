# Backend mypy baseline

- `RUN_MYPY=1 make type-check` now runs `backend/.venv/bin/python -m mypy --config-file mypy.ini`.
- The strict backend gate is intentionally scoped in `backend/mypy.ini` to the release-hardening infrastructure surfaces that are currently maintained:
  - `app/core/config.py`
  - `app/core/logging_config.py`
  - `app/core/metrics.py`
  - `app/core/security.py`
  - `app/core/stream_runtime_heartbeat.py`
  - `app/core/stream_schedule.py`
  - `app/core/supervisor_control.py`
  - `app/core/systemd_control.py`
  - `app/schemas/admin.py`
  - `app/schemas/quota.py`
  - `app/middleware/security_headers.py`
  - `app/middleware/websocket_safe_csrf.py`
- This keeps mypy meaningful for mission-touched release/runtime code while the larger SQLAlchemy-heavy legacy backlog remains outside the enforced gate.
- If a future worker hardens more backend modules, add them to `backend/mypy.ini` and keep `RUN_MYPY=1 make type-check` green before broadening again.
