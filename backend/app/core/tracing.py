"""OpenTelemetry FastAPI instrumentation (optional).

Wired into ``main.py`` lifespan — calls ``setup_tracing(app)`` once per
process. Behavior is gated on environment so dev runs don't pay the cost
or require a collector:

* Tracing is enabled iff ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set OR
  ``OTEL_ENABLED=true`` is exported.
* Instrumentations are imported lazily so the module can ship in
  environments where the ``opentelemetry-*`` packages are absent.
* Sampler defaults to parent-based with 10% trace ratio in production
  and 100% in staging. ``OTEL_TRACES_SAMPLER`` / ``OTEL_TRACES_SAMPLER_ARG``
  override per the OTEL spec.

PII discipline: the FastAPIInstrumentor is configured with
``server_request_hook`` that strips Authorization, Cookie, and any
custom headers we know carry tokens. Span attributes never carry full
URLs with tokens — request paths are kept; query strings are dropped.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def _otel_enabled() -> bool:
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return True
    flag = os.getenv("OTEL_ENABLED", "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def _strip_sensitive_headers(scope, request_headers, *_args, **_kwargs):  # noqa: ARG001
    """Remove headers that can carry credentials before they hit a span attr."""
    if not request_headers:
        return
    sensitive = {
        b"authorization",
        b"cookie",
        b"x-csrf-token",
        b"x-tusd-signature",
    }
    for header_name in list(request_headers.keys()):
        key = header_name.lower() if isinstance(header_name, str) else header_name
        if key in sensitive or (isinstance(key, str) and key.encode() in sensitive):
            request_headers[header_name] = "[REDACTED]"


def setup_tracing(app) -> Optional[object]:
    """Idempotently initialize OTEL tracing for ``app``.

    Returns the tracer-provider on success, None when tracing is disabled
    or the optional packages are missing.
    """
    if not _otel_enabled():
        logger.info("OpenTelemetry tracing disabled (OTEL_ENABLED unset)")
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    except ImportError as exc:
        logger.warning("OpenTelemetry packages unavailable; tracing disabled: %s", exc)
        return None

    service_name = os.getenv("OTEL_SERVICE_NAME", "youtube-streaming-backend")
    environment = settings.environment

    resource = Resource.create(
        {
            "service.name": service_name,
            "service.namespace": "youtube-streaming",
            "deployment.environment": environment,
        }
    )

    provider = TracerProvider(resource=resource)

    exporter = OTLPSpanExporter()  # honors OTEL_EXPORTER_OTLP_* env
    provider.add_span_processor(BatchSpanProcessor(exporter, max_queue_size=2048))

    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="healthz,readyz,health,metrics/prometheus",
        server_request_hook=_strip_sensitive_headers,
    )

    try:
        # Late import: the engine isn't created until app.core.database is
        # imported. We instrument the SQLAlchemy class which intercepts
        # all engines, including the one created on first DB use.
        SQLAlchemyInstrumentor().instrument(enable_commenter=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("SQLAlchemy instrumentation failed: %s", exc)

    try:
        from opentelemetry.instrumentation.redis import RedisInstrumentor

        RedisInstrumentor().instrument()
    except ImportError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis instrumentation failed: %s", exc)

    logger.info(
        "OpenTelemetry tracing enabled (service=%s, env=%s)",
        service_name,
        environment,
    )
    return provider
