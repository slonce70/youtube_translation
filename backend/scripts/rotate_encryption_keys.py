#!/usr/bin/env python3
"""Re-encrypt provider secrets under the current primary ``ENCRYPTION_KEY``.

The encryption module uses ``MultiFernet`` so existing ciphertexts written
under any previous key in ``ENCRYPTION_KEY_PREVIOUS`` are still readable. This
script walks every encrypted column in the database and re-encrypts each
ciphertext under the new primary key, so once the script completes you can
safely remove the previous key from the env.

Columns rotated (in order):

* ``destinations.stream_key_encrypted``
* ``youtube_connections.access_token_encrypted``
* ``youtube_connections.refresh_token_encrypted``

Usage:

    # 1. Add the new primary key, keep the old one as the previous key:
    #    ENCRYPTION_KEY=<new-key>
    #    ENCRYPTION_KEY_PREVIOUS=<old-key>
    # 2. Restart the backend so the new env is picked up.
    # 3. Run the rotation:
    #    python -m scripts.rotate_encryption_keys --dry-run
    #    python -m scripts.rotate_encryption_keys
    # 4. After successful rotation, drop ENCRYPTION_KEY_PREVIOUS and restart.

The script is idempotent — re-running it after a crash will skip records that
are already under the primary key (``MultiFernet.rotate`` is a no-op in that
case, but we still avoid unnecessary writes by detecting the primary token
prefix where possible).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Iterable, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

# Make ``app.*`` importable when run as ``python scripts/rotate_encryption_keys.py``.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.core.security import encryption  # noqa: E402

logger = logging.getLogger("rotate_encryption_keys")

# (table, primary-key column, ciphertext column) tuples.
TARGETS: Tuple[Tuple[str, str, str], ...] = (
    ("destinations", "id", "stream_key_encrypted"),
    ("youtube_connections", "id", "access_token_encrypted"),
    ("youtube_connections", "id", "refresh_token_encrypted"),
)


async def _rotate_table(
    conn: AsyncConnection,
    table: str,
    pk: str,
    column: str,
    *,
    dry_run: bool,
) -> Tuple[int, int, int]:
    """Rotate ciphertexts in a single column.

    Returns ``(scanned, rewritten, errors)``.
    """
    select_sql = text(f"SELECT {pk}, {column} FROM {table} WHERE {column} IS NOT NULL")
    rows = (await conn.execute(select_sql)).fetchall()

    scanned = 0
    rewritten = 0
    errors = 0

    update_sql = text(f"UPDATE {table} SET {column} = :new_value WHERE {pk} = :pk")

    for row in rows:
        scanned += 1
        pk_value = row[0]
        old_token = row[1]
        if not old_token:
            continue

        try:
            new_token = encryption.rotate_record(old_token)
        except Exception as exc:  # noqa: BLE001
            errors += 1
            logger.error(
                "%s.%s rotate failed for %s=%s: %s",
                table,
                column,
                pk,
                pk_value,
                exc,
            )
            continue

        if new_token == old_token:
            # rotate() returned identical bytes — already under primary key.
            continue

        if dry_run:
            rewritten += 1
            continue

        try:
            await conn.execute(update_sql, {"new_value": new_token, "pk": pk_value})
            rewritten += 1
        except Exception as exc:  # noqa: BLE001
            errors += 1
            logger.error(
                "%s.%s update failed for %s=%s: %s",
                table,
                column,
                pk,
                pk_value,
                exc,
            )

    return scanned, rewritten, errors


async def rotate_all(dry_run: bool) -> int:
    """Walk the encrypted columns and rewrap each ciphertext.

    Each table is rotated in its own transaction so a partial failure on one
    table does not roll back work already committed for earlier tables. In
    ``--dry-run`` mode the transaction is explicitly rolled back at the end of
    each table; in normal mode it is committed only if no errors occurred for
    that table.
    """
    database_url = settings.database_url.replace(
        "postgresql://", "postgresql+asyncpg://"
    )
    engine = create_async_engine(database_url, echo=False, future=True)

    total_scanned = 0
    total_rewritten = 0
    total_errors = 0

    try:
        for table, pk, column in TARGETS:
            logger.info("Rotating %s.%s ...", table, column)
            async with engine.connect() as conn:
                trans = await conn.begin()
                try:
                    scanned, rewritten, errors = await _rotate_table(
                        conn, table, pk, column, dry_run=dry_run
                    )
                except Exception:  # noqa: BLE001
                    await trans.rollback()
                    raise

                if dry_run:
                    logger.info("  DRY-RUN: rolling back %s.%s", table, column)
                    await trans.rollback()
                elif errors:
                    logger.error(
                        "  rolling back %s.%s due to %d error(s)",
                        table,
                        column,
                        errors,
                    )
                    await trans.rollback()
                else:
                    await trans.commit()

            total_scanned += scanned
            total_rewritten += rewritten
            total_errors += errors
            logger.info(
                "  %s.%s: scanned=%d rewritten=%d errors=%d",
                table,
                column,
                scanned,
                rewritten,
                errors,
            )
    finally:
        await engine.dispose()

    logger.info(
        "ROTATION SUMMARY: scanned=%d rewritten=%d errors=%d (dry_run=%s)",
        total_scanned,
        total_rewritten,
        total_errors,
        dry_run,
    )
    return 1 if total_errors else 0


def _parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and rotate in-memory only; do not persist updates.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Emit DEBUG-level logs.",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    return asyncio.run(rotate_all(dry_run=args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
