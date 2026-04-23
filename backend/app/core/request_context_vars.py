"""Request-scoped context variables propagated through logging + async tasks.

Context vars carry the current request identity across `await` boundaries
without threading arguments through every service layer. A logging filter
(see `app/core/logging_config.py`) reads them and attaches the values to
every emitted LogRecord, so structured logs are automatically correlated
with the triggering HTTP request.

Usage contract:
- Enter: middleware sets `request_id_var`, `user_id_var`, etc. at dispatch time.
- Exit: middleware resets the tokens so a worker reusing the task slot does
  not inherit stale IDs.
- Consumers (services, routes, background-task wrappers launched inside a
  request) call `logger.info(...)` normally; request_id is injected by the
  filter.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar("user_id", default=None)
correlation_id_var: ContextVar[Optional[str]] = ContextVar(
    "correlation_id", default=None
)


def get_request_id() -> Optional[str]:
    return request_id_var.get()


def get_user_id() -> Optional[str]:
    return user_id_var.get()


def get_correlation_id() -> Optional[str]:
    return correlation_id_var.get()


__all__ = [
    "request_id_var",
    "user_id_var",
    "correlation_id_var",
    "get_request_id",
    "get_user_id",
    "get_correlation_id",
]
