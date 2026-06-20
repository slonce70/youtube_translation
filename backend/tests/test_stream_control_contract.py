"""Contract guards for StreamControlService audit helpers.

Regression coverage for the 2026-06 stop-stream outage: ``_record_stop_audit``
was decorated ``@staticmethod`` while still declaring ``self`` and using
``self.db``. Every ``POST /streams/{id}/stop`` then raised
``TypeError: _record_stop_audit() missing 1 required positional argument:
'stream'`` (surfaced in the UI as "Помилка: Unknown error"). These methods are
always invoked as ``self.<name>(stream, ...)``, so they must remain bound
instance methods. The existing scheduler tests mock ``stop_stream`` wholesale,
so this class of mis-decoration slips past them — hence this lightweight,
DB-free guard.
"""

import inspect

from app.services.streams.control import StreamControlService

# Helpers that are called as ``self.<name>(stream, ...)`` and read ``self.db``.
INSTANCE_AUDIT_METHODS = [
    "_record_stop_audit",
    "_persist_stop_request_attribution",
    "_persist_stop_failure_attribution",
]


def test_stop_audit_helpers_are_not_staticmethods():
    for name in INSTANCE_AUDIT_METHODS:
        raw = inspect.getattr_static(StreamControlService, name)
        assert not isinstance(raw, staticmethod), (
            f"{name} must be an instance method, not @staticmethod — a static "
            "decorator makes self<-stream and drops the real positional arg."
        )


def test_stop_audit_helpers_take_self_first():
    for name in INSTANCE_AUDIT_METHODS:
        params = list(inspect.signature(getattr(StreamControlService, name)).parameters)
        assert params and params[0] == "self", (
            f"{name} first parameter must be 'self', got {params!r}"
        )
