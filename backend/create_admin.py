#!/usr/bin/env python3
"""
Create / manage admin users.

Examples:
  - List users:
      python create_admin.py --list
  - Promote by email:
      python create_admin.py --email admin@example.com
  - Backwards-compatible behavior (first created user):
      python create_admin.py
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).parent))
from app.core.config import settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage admin users in user_profiles.")
    parser.add_argument(
        "--email",
        help="Promote this email to admin (matches user_profiles.email).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all users and exit.",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()

    print("=" * 60)
    print("👤 Admin User Manager")
    print("=" * 60)

    database_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(database_url, echo=False)

    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT user_id, email, is_admin, created_at
                FROM user_profiles
                ORDER BY created_at
                """
            )
        )
        users = result.all()

        print(f"\nFound {len(users)} user(s):")
        for i, (user_id, email, is_admin, created_at) in enumerate(users, 1):
            status = "👑 ADMIN" if is_admin else "👤 USER"
            print(f"   {i}. {email} - {status} ({created_at})")

        if args.list:
            return 0

        target_user_id = None
        target_email = None
        target_is_admin = None

        if args.email:
            match = next((u for u in users if (u[1] or "").lower() == args.email.lower()), None)
            if not match:
                print(f"\n❌ No user found with email: {args.email}")
                return 1
            target_user_id, target_email, target_is_admin, _created_at = match
        else:
            if not users:
                print("\n❌ No users found. Sign up first, then re-run this script.")
                return 1
            target_user_id, target_email, target_is_admin, _created_at = users[0]

        if target_is_admin:
            print(f"\n✅ {target_email} is already an admin.")
        else:
            print(f"\n✨ Making {target_email} an admin...")
            await conn.execute(
                text(
                    """
                    UPDATE user_profiles
                    SET is_admin = TRUE
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": target_user_id},
            )
            await conn.commit()
            print(f"✅ {target_email} is now an admin!")

        print("\n📊 Current admins:")
        result = await conn.execute(
            text(
                """
                SELECT email, subscription_tier
                FROM user_profiles
                WHERE is_admin = TRUE
                ORDER BY created_at
                """
            )
        )
        admins = result.all()
        if not admins:
            print("   (none)")
        for email, tier in admins:
            print(f"   👑 {email} ({tier} tier)")

    print("\n" + "=" * 60)
    print("✅ Done")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as exc:  # pragma: no cover
        print(f"\n❌ Error: {exc}")
        import traceback

        traceback.print_exc()
        raise SystemExit(1)
