"""
Structured logging configuration with JSON output and correlation IDs

Provides:
- JSON formatted logs for easy parsing
- Correlation IDs for request tracing
- Sensitive data masking
- Different log levels for different environments
"""

import logging
import sys
import re
from uuid import UUID
from datetime import datetime, timezone
from typing import Any, Dict
from pythonjsonlogger import jsonlogger

from app.core.request_context_vars import (
    correlation_id_var,
    request_id_var,
    user_id_var,
)

UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}\b"
)
IDENTITY_HINT_RE = re.compile(r"\b(user|tenant)(?:[_\s-]?id)?\b", re.IGNORECASE)


def mask_identifier(value: str) -> str:
    if not value:
        return value
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


def mask_uuids(text: str) -> str:
    return UUID_RE.sub(lambda match: mask_identifier(match.group(0)), text)


class RequestContextFilter(logging.Filter):
    """Inject request-scoped context vars into every LogRecord.

    Runs *before* CustomJsonFormatter so the downstream add_fields() hooks
    can read the attributes off the record. Values already set on the record
    by explicit `extra=` take precedence over the ambient context var — this
    lets middlewares override per-call values when they must.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = request_id_var.get()
        if request_id and not getattr(record, "request_id", None):
            record.request_id = request_id

        user_id = user_id_var.get()
        if user_id and not getattr(record, "user_id", None):
            record.user_id = user_id

        correlation_id = correlation_id_var.get()
        if correlation_id and not getattr(record, "correlation_id", None):
            record.correlation_id = correlation_id

        return True


class SensitiveDataFilter(logging.Filter):
    """Filter to mask sensitive data in logs"""

    SENSITIVE_PATTERNS = [
        (re.compile(r'(api[_-]?key["\s:=]+)[\w-]+', re.IGNORECASE), r"\1****"),
        (re.compile(r'(secret["\s:=]+)[\w-]+', re.IGNORECASE), r"\1****"),
        (re.compile(r'(password["\s:=]+)[\w-]+', re.IGNORECASE), r"\1****"),
        (re.compile(r'(token["\s:=]+)[\w-]+', re.IGNORECASE), r"\1****"),
        (
            re.compile(r'(authorization["\s:=]+bearer\s+)[\w.-]+', re.IGNORECASE),
            r"\1****",
        ),
        (
            re.compile(
                r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", re.IGNORECASE
            ),
            r"***@***.***",
        ),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        """Mask sensitive data in log messages"""
        message_has_identity_hint = False
        if hasattr(record, "msg") and isinstance(record.msg, str):
            message_has_identity_hint = bool(IDENTITY_HINT_RE.search(record.msg))
            for pattern, replacement in self.SENSITIVE_PATTERNS:
                record.msg = pattern.sub(replacement, record.msg)
            if message_has_identity_hint:
                record.msg = mask_uuids(record.msg)

        # Also check args
        if hasattr(record, "args") and record.args:
            masked_args = []
            for arg in record.args:
                if isinstance(arg, UUID):
                    arg = str(arg)
                if isinstance(arg, str):
                    for pattern, replacement in self.SENSITIVE_PATTERNS:
                        arg = pattern.sub(replacement, arg)
                    if message_has_identity_hint:
                        arg = mask_uuids(arg)
                masked_args.append(arg)
            record.args = tuple(masked_args)

        return True


class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter with additional fields"""

    def add_fields(
        self,
        log_record: Dict[str, Any],
        record: logging.LogRecord,
        message_dict: Dict[str, Any],
    ):
        """Add custom fields to log record"""
        super(CustomJsonFormatter, self).add_fields(log_record, record, message_dict)

        # Add timestamp
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()

        # Add log level
        log_record["level"] = record.levelname

        # Add logger name
        log_record["logger"] = record.name

        # Add source location
        log_record["source"] = {
            "file": record.pathname,
            "line": record.lineno,
            "function": record.funcName,
        }

        # Add correlation ID if present (set by middleware)
        if hasattr(record, "correlation_id"):
            log_record["correlation_id"] = record.correlation_id

        # Add user ID if present (masked)
        if hasattr(record, "user_id"):
            log_record["user_id"] = mask_identifier(str(record.user_id))

        # Add tenant ID if present (masked)
        if hasattr(record, "tenant_id"):
            log_record["tenant_id"] = mask_identifier(str(record.tenant_id))

        # Add request ID if present
        if hasattr(record, "request_id"):
            log_record["request_id"] = record.request_id


def setup_logging(level: str = "INFO", json_output: bool = True):
    """
    Setup application logging with structured output.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_output: Whether to use JSON formatter (recommended for production)
    """
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)

    # Set formatter
    formatter: logging.Formatter
    if json_output:
        formatter = CustomJsonFormatter("%(timestamp)s %(level)s %(name)s %(message)s")
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

    console_handler.setFormatter(formatter)

    # Inject request-scoped context vars before masking + JSON formatting.
    console_handler.addFilter(RequestContextFilter())
    # Add sensitive data filter
    console_handler.addFilter(SensitiveDataFilter())

    # Add handler to root logger
    root_logger.addHandler(console_handler)

    # Set levels for third-party libraries
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)

    return root_logger


class ContextLogger:
    """Logger with context (correlation ID, user ID, etc.)"""

    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.context: Dict[str, Any] = {}

    def set_context(self, **kwargs):
        """Set context for subsequent log messages"""
        self.context.update(kwargs)

    def clear_context(self):
        """Clear context"""
        self.context.clear()

    def _log(self, level: int, msg: str, *args, **kwargs):
        """Internal log method with context"""
        extra = kwargs.get("extra", {})
        extra.update(self.context)
        kwargs["extra"] = extra
        self.logger.log(level, msg, *args, **kwargs)

    def debug(self, msg: str, *args, **kwargs):
        self._log(logging.DEBUG, msg, *args, **kwargs)

    def info(self, msg: str, *args, **kwargs):
        self._log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: str, *args, **kwargs):
        self._log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: str, *args, **kwargs):
        self._log(logging.ERROR, msg, *args, **kwargs)

    def critical(self, msg: str, *args, **kwargs):
        self._log(logging.CRITICAL, msg, *args, **kwargs)

    def exception(self, msg: str, *args, **kwargs):
        """Log exception with traceback"""
        kwargs["exc_info"] = True
        self._log(logging.ERROR, msg, *args, **kwargs)


def get_logger(name: str) -> ContextLogger:
    """
    Get a context-aware logger.

    Args:
        name: Logger name (usually __name__)

    Returns:
        ContextLogger instance
    """
    return ContextLogger(logging.getLogger(name))
