#!/usr/bin/env python3
"""
Verify Migration - Check that migrations were applied correctly
"""

import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).parent))
from app.core.config import settings


async def main():
    """Verify migrations"""
    print("=" * 60)
    print("🔍 Verifying Database Migration")
    print("=" * 60)
    
    # Create async engine
    database_url = settings.database_url.replace('postgresql://', 'postgresql+asyncpg://')
    engine = create_async_engine(database_url, echo=False)
    
    async with engine.begin() as conn:
        print("\n1. Checking user_profiles table...")
        result = await conn.execute(text("""
            SELECT user_id, email, subscription_tier, current_storage_bytes
            FROM user_profiles
            LIMIT 5
        """))
        profiles = result.all()
        print(f"   Found {len(profiles)} user profile(s)")
        for p in profiles:
            storage_gb = p[3] / (1024**3) if p[3] else 0
            print(f"   - {p[1]}: {p[2]} tier, {storage_gb:.2f} GB used")
        
        print("\n2. Checking subscription tiers...")
        result = await conn.execute(text("""
            SELECT tier, storage_gb, max_concurrent_streams, max_destinations
            FROM subscription_tier_limits
            ORDER BY 
                CASE tier
                    WHEN 'free' THEN 1
                    WHEN 'pro' THEN 2
                    WHEN 'business' THEN 3
                    WHEN 'enterprise' THEN 4
                END
        """))
        tiers = result.all()
        for t in tiers:
            storage = f"{t[1]} GB" if t[1] else "Unlimited"
            streams = f"{t[2]}" if t[2] else "Unlimited"
            dests = f"{t[3]}" if t[3] else "Unlimited"
            print(f"   - {t[0].upper()}: Storage={storage}, Streams={streams}, Destinations={dests}")
        
        print("\n3. Checking user_id columns...")
        checks = {
            'assets': await conn.execute(text("SELECT COUNT(*), COUNT(user_id) FROM assets")),
            'playlists': await conn.execute(text("SELECT COUNT(*), COUNT(user_id) FROM playlists")),
            'destinations': await conn.execute(text("SELECT COUNT(*), COUNT(user_id) FROM destinations")),
            'streams': await conn.execute(text("SELECT COUNT(*), COUNT(user_id) FROM streams"))
        }
        
        for table, result in checks.items():
            total, with_user_id = result.one()
            status = "✅" if total == with_user_id else "❌"
            print(f"   {status} {table}: {with_user_id}/{total} have user_id")
        
        print("\n4. Checking admin tables...")
        admin_tables = ['admin_actions', 'system_alerts', 'user_activity_log']
        for table in admin_tables:
            result = await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = result.scalar()
            print(f"   ✅ {table}: {count} records")
        
        print("\n5. Checking RLS policies...")
        result = await conn.execute(text("""
            SELECT tablename, COUNT(*) as policy_count
            FROM pg_policies
            WHERE schemaname = 'public'
                AND tablename IN ('user_profiles', 'assets', 'playlists', 'destinations', 'streams')
            GROUP BY tablename
            ORDER BY tablename
        """))
        policies = result.all()
        for table, count in policies:
            print(f"   ✅ {table}: {count} RLS policies")
        
        print("\n6. Checking triggers...")
        result = await conn.execute(text("""
            SELECT event_object_table, COUNT(*) as trigger_count
            FROM information_schema.triggers
            WHERE trigger_schema = 'public'
                AND event_object_table IN ('user_profiles', 'assets', 'playlist_items', 'streams', 'auth.users')
            GROUP BY event_object_table
            ORDER BY event_object_table
        """))
        triggers = result.all()
        if triggers:
            for table, count in triggers:
                print(f"   ✅ {table}: {count} trigger(s)")
        else:
            print(f"   ⚠️  No triggers found (check if auth schema is accessible)")
        
        print("\n7. Checking admin users...")
        result = await conn.execute(text("""
            SELECT COUNT(*) FROM user_profiles WHERE is_admin = TRUE
        """))
        admin_count = result.scalar()
        print(f"   Found {admin_count} admin user(s)")
        
        if admin_count == 0:
            print("\n   ⚠️  No admin users found!")
            print("   To create an admin user, run:")
            print("   UPDATE user_profiles SET is_admin = TRUE WHERE email = 'your@email.com';")
            
            # Ask if user wants to create admin now
            result = await conn.execute(text("SELECT user_id, email FROM user_profiles LIMIT 10"))
            users = result.all()
            if users:
                print("\n   Available users:")
                for i, (user_id, email) in enumerate(users, 1):
                    print(f"   {i}. {email}")
        else:
            result = await conn.execute(text("""
                SELECT email FROM user_profiles WHERE is_admin = TRUE
            """))
            admins = result.all()
            for admin in admins:
                print(f"   ✅ Admin: {admin[0]}")
    
    print("\n" + "=" * 60)
    print("✅ Migration Verification Complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Create admin user if needed")
    print("2. Test backend API with new schema")
    print("3. Proceed to Sprint 2: File Storage Reorganization")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
