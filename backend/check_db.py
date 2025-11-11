#!/usr/bin/env python3
"""Check database contents"""

import asyncio
from sqlalchemy import text
from app.core.database import get_db_context


async def check_db():
    async with get_db_context() as db:
        # Check user_profiles
        print("=" * 60)
        print("USER PROFILES:")
        print("=" * 60)
        result = await db.execute(
            text('SELECT user_id, email, subscription_tier, created_at FROM user_profiles ORDER BY created_at DESC')
        )
        users = result.fetchall()
        print(f'Total users: {len(users)}\n')
        for user in users:
            print(f'User ID: {user.user_id}')
            print(f'Email: {user.email}')
            print(f'Tier: {user.subscription_tier}')
            print(f'Created: {user.created_at}')
            print('-' * 60)
        
        # Check assets table structure
        print("\n" + "=" * 60)
        print("ASSETS TABLE STRUCTURE:")
        print("=" * 60)
        result = await db.execute(
            text("""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = 'assets'
                ORDER BY ordinal_position
            """)
        )
        columns = result.fetchall()
        for col in columns:
            print(f'{col.column_name:30} {col.data_type:20} nullable={col.is_nullable}')
        
        # Check assets
        print("\n" + "=" * 60)
        print("RECENT ASSETS:")
        print("=" * 60)
        result = await db.execute(
            text('SELECT * FROM assets ORDER BY created_at DESC LIMIT 2')
        )
        assets = result.fetchall()
        print(f'Recent assets: {len(assets)}\n')
        for asset in assets:
            print(f'Asset row: {dict(asset._mapping)}')
            print('-' * 60)


if __name__ == '__main__':
    asyncio.run(check_db())
