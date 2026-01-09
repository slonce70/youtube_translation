"""Helpers for optional alerting integrations (Sentry)."""

from typing import Any, Mapping, Optional

from app.core.config import settings


def capture_alert(
    message: str,
    *,
    level: str = "warning",
    tags: Optional[Mapping[str, str]] = None,
    extra: Optional[Mapping[str, Any]] = None,
) -> None:
    if not settings.sentry_dsn:
        return

    environment = settings.environment.lower()
    if environment not in {"production", "staging"}:
        return

    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            if tags:
                for key, value in tags.items():
                    scope.set_tag(key, value)
            if extra:
                for key, value in extra.items():
                    scope.set_extra(key, value)
            scope.set_level(level)
            sentry_sdk.capture_message(message)
    except Exception:
        # Never let alerting failures break request handling.
        return
