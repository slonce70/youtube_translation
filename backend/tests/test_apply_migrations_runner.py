"""Unit tests for the migration runner helpers in ``apply_migrations.py``.

These cover the surface area introduced by Sprint 1.5:

* ``-- @autocommit`` directive detection.
* Statement splitter (terminator and ``$$``-function handling).
* Migration 018 file structure (autocommit marker present, every CREATE INDEX
  is CONCURRENTLY, IF NOT EXISTS guards).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

# Add backend/ to path so apply_migrations.py is importable as a module.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from apply_migrations import (  # noqa: E402
    _DUPLICATE_OBJECT_SQLSTATES,
    _has_autocommit_marker,
    _is_duplicate_object_error,
    _split_statements,
    MIGRATIONS,
)


MIGRATION_018 = (
    BACKEND_ROOT / "migrations" / "018_performance_indexes.sql"
)
MIGRATION_018_ROLLBACK = (
    BACKEND_ROOT / "migrations" / "018_performance_indexes_rollback.sql"
)
MIGRATION_038 = BACKEND_ROOT / "migrations" / "038_youtube_rtmps_default.sql"


class TestAutocommitMarker:
    def test_marker_at_top(self) -> None:
        sql = "-- @autocommit\nCREATE INDEX foo ON bar(x);"
        assert _has_autocommit_marker(sql) is True

    def test_marker_after_blank_lines_and_other_comments(self) -> None:
        sql = (
            "\n\n"
            "-- some preamble\n"
            "-- @autocommit\n"
            "CREATE INDEX foo ON bar(x);\n"
        )
        assert _has_autocommit_marker(sql) is True

    def test_marker_case_insensitive(self) -> None:
        sql = "-- @AUTOCOMMIT\nCREATE INDEX foo ON bar(x);"
        assert _has_autocommit_marker(sql) is True

    def test_no_marker(self) -> None:
        sql = "-- regular migration\nCREATE TABLE foo (id INT);"
        assert _has_autocommit_marker(sql) is False

    def test_marker_far_below_first_10_non_blank_lines_ignored(self) -> None:
        # Marker buried beneath 10+ non-empty/non-comment lines must be ignored
        # so it cannot accidentally be planted in the middle of a long file.
        body = "\n".join(f"SELECT {i};" for i in range(15))
        sql = body + "\n-- @autocommit\n"
        assert _has_autocommit_marker(sql) is False


class TestSplitStatements:
    def test_basic_terminator(self) -> None:
        sql = "CREATE TABLE foo (id INT);\nCREATE TABLE bar (id INT);\n"
        stmts = _split_statements(sql)
        assert len(stmts) == 2
        assert "foo" in stmts[0]
        assert "bar" in stmts[1]

    def test_skips_comment_only_lines(self) -> None:
        sql = (
            "-- header comment\n"
            "-- @autocommit\n"
            "\n"
            "CREATE INDEX i1 ON t(a);\n"
            "CREATE INDEX i2 ON t(b);\n"
        )
        stmts = _split_statements(sql)
        assert len(stmts) == 2
        for stmt in stmts:
            assert stmt.strip().startswith("CREATE INDEX")
            assert "@autocommit" not in stmt

    def test_handles_dollar_quoted_function_body(self) -> None:
        sql = (
            "CREATE FUNCTION f() RETURNS void AS $$\n"
            "BEGIN\n"
            "    PERFORM 1;\n"
            "END;\n"
            "$$ LANGUAGE plpgsql;\n"
            "CREATE INDEX after_fn ON t(c);\n"
        )
        stmts = _split_statements(sql)
        # The whole function body must arrive as a single statement.
        assert len(stmts) == 2
        assert stmts[0].count("$$") == 2
        assert "after_fn" in stmts[1]


class TestMigration018File:
    @pytest.fixture
    def sql(self) -> str:
        assert MIGRATION_018.exists(), "migration 018 file missing"
        return MIGRATION_018.read_text()

    def test_autocommit_marker_present(self, sql: str) -> None:
        assert _has_autocommit_marker(sql), (
            "migration 018 must carry the -- @autocommit directive so the "
            "runner takes a separate AUTOCOMMIT connection (CONCURRENTLY "
            "cannot run inside a transaction)."
        )

    def test_every_create_index_is_concurrently(self, sql: str) -> None:
        statements = _split_statements(sql)
        create_index_stmts = [s for s in statements if "CREATE INDEX" in s.upper()]
        assert len(create_index_stmts) == 14, (
            f"expected 14 CREATE INDEX statements in migration 018, "
            f"got {len(create_index_stmts)}"
        )
        for stmt in create_index_stmts:
            assert "CONCURRENTLY" in stmt.upper(), (
                f"CREATE INDEX must use CONCURRENTLY in migration 018: {stmt!r}"
            )
            assert re.search(r"IF\s+NOT\s+EXISTS", stmt, re.IGNORECASE), (
                f"CREATE INDEX must use IF NOT EXISTS for idempotency: {stmt!r}"
            )

    def test_no_transaction_or_function_blocks(self, sql: str) -> None:
        # CONCURRENTLY can't run inside transaction blocks. The file must NOT
        # contain BEGIN/COMMIT or DO $$ blocks.
        upper = sql.upper()
        assert "BEGIN;" not in upper, "BEGIN; not allowed in autocommit migration"
        assert "COMMIT;" not in upper, "COMMIT; not allowed in autocommit migration"
        assert "DO $$" not in upper, "DO $$ blocks not allowed (transactional)"


class TestDuplicateObjectErrorMatching:
    """``_is_duplicate_object_error`` must accept *only* known SQLSTATEs.

    Previously the runner matched the substring ``"already exists"`` in the
    error message, which silently swallowed any unrelated error whose
    message mentioned an object that exists. This locks in the SQLSTATE-
    based contract so that regression cannot return.
    """

    @pytest.fixture
    def fake_dbapi_error(self):
        def _build(pgcode: str | None) -> Exception:
            inner = type("Inner", (), {"pgcode": pgcode, "sqlstate": pgcode})()
            outer = Exception("simulated DB error")
            outer.orig = inner  # type: ignore[attr-defined]
            return outer

        return _build

    def test_accepts_duplicate_table(self, fake_dbapi_error) -> None:
        assert _is_duplicate_object_error(fake_dbapi_error("42P07")) is True

    def test_accepts_duplicate_column(self, fake_dbapi_error) -> None:
        assert _is_duplicate_object_error(fake_dbapi_error("42701")) is True

    def test_accepts_all_documented_states(self, fake_dbapi_error) -> None:
        for code in _DUPLICATE_OBJECT_SQLSTATES:
            assert _is_duplicate_object_error(fake_dbapi_error(code)) is True

    def test_rejects_unrelated_sqlstate_with_already_exists_in_message(
        self, fake_dbapi_error
    ) -> None:
        # Class 23 = integrity_violation. Even if the message says "already
        # exists", a constraint violation MUST NOT be swallowed.
        outer = fake_dbapi_error("23505")
        outer.args = ("duplicate key value violates unique constraint: row already exists",)
        assert _is_duplicate_object_error(outer) is False

    def test_rejects_missing_pgcode(self, fake_dbapi_error) -> None:
        assert _is_duplicate_object_error(fake_dbapi_error(None)) is False

    def test_rejects_plain_exception_without_orig(self) -> None:
        assert _is_duplicate_object_error(RuntimeError("relation already exists")) is False


class TestMigration018Rollback:
    def test_rollback_file_exists_and_drops_each_index(self) -> None:
        assert MIGRATION_018_ROLLBACK.exists(), "rollback file missing"
        sql = MIGRATION_018_ROLLBACK.read_text()
        assert _has_autocommit_marker(sql), "rollback must also be autocommit"

        # Every index name created in 018 must have a matching DROP in rollback.
        forward_sql = MIGRATION_018.read_text()
        index_names = re.findall(
            r"CREATE INDEX CONCURRENTLY IF NOT EXISTS (\w+)", forward_sql
        )
        assert len(index_names) == 14
        for name in index_names:
            assert f"DROP INDEX CONCURRENTLY IF EXISTS {name}" in sql, (
                f"rollback file is missing DROP for {name}"
            )


class TestMigration038File:
    def test_migration_is_in_active_runner_list(self) -> None:
        assert "migrations/038_youtube_rtmps_default.sql" in MIGRATIONS

    def test_migration_updates_destination_column_default(self) -> None:
        sql = MIGRATION_038.read_text(encoding="utf-8")

        assert "ALTER TABLE destinations" in sql
        assert "ALTER COLUMN rtmps_url SET DEFAULT" in sql
        assert "rtmps://a.rtmps.youtube.com/live2" in sql
