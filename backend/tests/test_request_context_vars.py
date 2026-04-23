"""Verify RequestContextFilter injects contextvars into LogRecords."""

from __future__ import annotations

import io
import json
import logging

import pytest

from app.core.logging_config import (
    CustomJsonFormatter,
    RequestContextFilter,
    SensitiveDataFilter,
)
from app.core.request_context_vars import (
    correlation_id_var,
    request_id_var,
    user_id_var,
)


@pytest.fixture
def json_logger():
    """Build a self-contained logger emitting JSON to a StringIO buffer."""
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    handler.setFormatter(CustomJsonFormatter("%(message)s"))
    handler.addFilter(RequestContextFilter())
    handler.addFilter(SensitiveDataFilter())

    logger = logging.getLogger("test_request_context_vars")
    logger.setLevel(logging.DEBUG)
    logger.handlers[:] = [handler]
    logger.propagate = False

    yield logger, buffer

    logger.handlers[:] = []
    for var_token in ("request_id", "user_id", "correlation_id"):
        pass


def _read_last_record(buffer: io.StringIO) -> dict:
    raw = buffer.getvalue().strip().splitlines()[-1]
    return json.loads(raw)


def test_request_id_contextvar_is_injected(json_logger):
    logger, buffer = json_logger
    token = request_id_var.set("req-abc-123")
    try:
        logger.info("hello")
    finally:
        request_id_var.reset(token)

    record = _read_last_record(buffer)
    assert record["request_id"] == "req-abc-123"


def test_user_id_is_masked_when_injected(json_logger):
    logger, buffer = json_logger
    token = user_id_var.set("ffffffff-1111-2222-3333-444444444444")
    try:
        logger.info("auth-check")
    finally:
        user_id_var.reset(token)

    record = _read_last_record(buffer)
    # CustomJsonFormatter.add_fields passes user_id through mask_identifier.
    assert record["user_id"].startswith("ffff")
    assert record["user_id"].endswith("4444")
    assert "..." in record["user_id"]


def test_correlation_id_contextvar_is_injected(json_logger):
    logger, buffer = json_logger
    token = correlation_id_var.set("corr-xyz")
    try:
        logger.warning("maybe-bad")
    finally:
        correlation_id_var.reset(token)

    record = _read_last_record(buffer)
    assert record["correlation_id"] == "corr-xyz"


def test_explicit_extra_overrides_contextvar(json_logger):
    logger, buffer = json_logger
    token = request_id_var.set("ambient-req")
    try:
        logger.info("override", extra={"request_id": "explicit-req"})
    finally:
        request_id_var.reset(token)

    record = _read_last_record(buffer)
    assert record["request_id"] == "explicit-req"


def test_missing_contextvars_do_not_add_fields(json_logger):
    logger, buffer = json_logger
    logger.info("no-context")

    record = _read_last_record(buffer)
    assert "request_id" not in record
    assert "user_id" not in record
    assert "correlation_id" not in record
