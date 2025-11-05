#!/usr/bin/env python3
"""
Migration Script - Apply database migrations to Supabase

This script applies all pending migrations in order.
Run with: python apply_migrations.py
"""

import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncConnection

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.core.config import settings


# List of migrations to apply (in order)
MIGRATIONS = [
    'migrations/003_user_profiles_and_tiers.sql',
    'migrations/004_add_user_id_columns.sql',
    'migrations/005_admin_and_alerts.sql',
    'migrations/006_update_rls_policies.sql',
    'migrations/007_remove_projects.sql',
    'migrations/008_update_admin_alert_fk.sql',
    'migrations/009_update_user_fk.sql',
    'migrations/010_stream_quality_limits.sql',
    'migrations/011_stream_source_type.sql',
    'migrations/012_stream_assets.sql',
]


async def check_table_exists(conn: AsyncConnection, table_name: str) -> bool:
    """Check if a table exists"""
    query = text("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = :table_name
        )
    """)
    result = await conn.execute(query, {"table_name": table_name})
    return result.scalar()


async def get_migration_status(conn: AsyncConnection) -> dict:
    """Check which migrations have been applied"""
    status = {}
    
    # Check if user_profiles exists (migration 003)
    status['003'] = await check_table_exists(conn, 'user_profiles')
    
    # Check if assets has user_id column (migration 004)
    query = text("""
        SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'assets'
            AND column_name = 'user_id'
        )
    """)
    result = await conn.execute(query)
    status['004'] = result.scalar()
    
    # Check if admin_actions exists (migration 005)
    status['005'] = await check_table_exists(conn, 'admin_actions')
    
    # Check if new RLS policies exist (migration 006)
    query = text("""
        SELECT EXISTS (
            SELECT FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = 'assets'
            AND policyname = 'users_can_manage_own_assets'
        )
    """)
    result = await conn.execute(query)
    status['006'] = result.scalar()

    # Check project columns removed (migration 007)
    query = text("""
        SELECT NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('assets', 'playlists', 'destinations', 'streams')
              AND column_name = 'project_id'
        )
    """)
    result = await conn.execute(query)
    status['007'] = result.scalar()

    # Check admin tables reference user_profiles (migration 008)
    query = text("""
        SELECT COUNT(*) = 5
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_class r ON c.confrelid = r.oid
        WHERE c.conname IN (
            'admin_actions_admin_user_id_fkey',
            'admin_actions_target_user_id_fkey',
            'system_alerts_user_id_fkey',
            'system_alerts_resolved_by_fkey',
            'user_activity_log_user_id_fkey'
        )
        AND r.relname = 'user_profiles'
    """)
    result = await conn.execute(query)
    status['008'] = result.scalar()

    # Check core table foreign keys (migration 009)
    query = text("""
        SELECT COUNT(*) = 4
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_class r ON c.confrelid = r.oid
        WHERE c.conname IN (
            'fk_assets_user_id',
            'fk_playlists_user_id',
            'fk_destinations_user_id',
            'fk_streams_user_id'
        )
        AND r.relname = 'user_profiles'
    """)
    result = await conn.execute(query)
    status['009'] = result.scalar()

    # Check stream quality columns (migration 010)
    query = text("""
        SELECT COUNT(*) = 5
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscription_tier_limits'
          AND column_name IN (
              'max_resolution_height',
              'max_fps',
              'max_video_bitrate_mbps',
              'min_video_bitrate_mbps',
              'enforce_stream_quality'
          )
    """)
    result = await conn.execute(query)
    status['010'] = result.scalar()

    # Check stream source type support (migration 011)
    query = text("""
        SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name = 'source_type'
        )
    """)
    result = await conn.execute(query)
    status['011'] = result.scalar()

    # Check stream assets mapping (migration 012)
    query = text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'stream_assets'
        )
    """)
    result = await conn.execute(query)
    status['012'] = result.scalar()

    return status


async def apply_migration(conn: AsyncConnection, migration_file: str):
    """Apply a single migration file"""
    print(f"\n📝 Applying {migration_file}...")
    
    # Read migration file
    migration_path = Path(__file__).parent / migration_file
    if not migration_path.exists():
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    with open(migration_path, 'r') as f:
        sql_content = f.read()
    
    try:
        # Split SQL by statements (handle functions with $$)
        statements = []
        current_statement = []
        in_function = False
        
        for line in sql_content.split('\n'):
            stripped = line.strip()
            
            # Skip empty lines and comments
            if not stripped or stripped.startswith('--'):
                continue
            
            # Check if entering/leaving function definition
            if '$$' in line:
                in_function = not in_function
            
            current_statement.append(line)
            
            # Statement ends with ; (but not inside function)
            if not in_function and stripped.endswith(';'):
                stmt = '\n'.join(current_statement)
                if stmt.strip():
                    statements.append(stmt)
                current_statement = []
        
        # Add last statement if exists
        if current_statement:
            stmt = '\n'.join(current_statement)
            if stmt.strip():
                statements.append(stmt)
        
        # Execute each statement
        for i, statement in enumerate(statements, 1):
            if statement.strip():
                try:
                    await conn.execute(text(statement))
                    print(f"  ✓ Executed statement {i}/{len(statements)}")
                except Exception as stmt_error:
                    print(f"  ❌ Error in statement {i}/{len(statements)}:")
                    print(f"     {str(stmt_error)}")
                    # Continue with other statements for CREATE IF NOT EXISTS
                    if "already exists" not in str(stmt_error).lower():
                        raise
        
        # Don't commit here - commit will be done in main after all migrations
        print(f"✅ Successfully applied {migration_file}")
        return True
    except Exception as e:
        print(f"❌ Error applying {migration_file}:")
        print(f"   {str(e)}")
        return False


async def verify_migration(conn: AsyncConnection, migration_num: str) -> bool:
    """Verify that a migration was applied successfully"""
    if migration_num == '003':
        # Check user_profiles and subscription_tier_limits
        exists = await check_table_exists(conn, 'user_profiles')
        if not exists:
            return False
        
        # Check tier limits populated
        query = text("SELECT COUNT(*) FROM subscription_tier_limits")
        result = await conn.execute(query)
        count = result.scalar()
        return count == 4  # Should have 4 tiers
    
    elif migration_num == '004':
        # Check user_id columns exist
        query = text("""
            SELECT 
                (SELECT COUNT(*) FROM information_schema.columns 
                 WHERE table_name = 'assets' AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns 
                 WHERE table_name = 'playlists' AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns 
                 WHERE table_name = 'destinations' AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns 
                 WHERE table_name = 'streams' AND column_name = 'user_id')
        """)
        result = await conn.execute(query)
        return result.scalar() == 4
    
    elif migration_num == '005':
        # Check admin tables exist
        tables = ['admin_actions', 'system_alerts', 'user_activity_log']
        for table in tables:
            if not await check_table_exists(conn, table):
                return False
        return True
    
    elif migration_num == '006':
        # Check new RLS policies exist
        query = text("""
            SELECT COUNT(*) FROM pg_policies 
            WHERE schemaname = 'public' 
            AND policyname LIKE 'users_can_%'
        """)
        result = await conn.execute(query)
        return result.scalar() > 0

    elif migration_num == '007':
        # Ensure legacy project columns are removed
        query = text("""
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('assets', 'playlists', 'destinations', 'streams')
              AND column_name = 'project_id'
        """)
        result = await conn.execute(query)
        return result.scalar() == 0

    elif migration_num == '008':
        # Ensure admin tables reference user_profiles
        query = text("""
            SELECT COUNT(*)
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_class r ON c.confrelid = r.oid
            WHERE c.conname IN (
                'admin_actions_admin_user_id_fkey',
                'admin_actions_target_user_id_fkey',
                'system_alerts_user_id_fkey',
                'system_alerts_resolved_by_fkey',
                'user_activity_log_user_id_fkey'
            )
            AND r.relname = 'user_profiles'
        """)
        result = await conn.execute(query)
        return result.scalar() == 5

    elif migration_num == '009':
        # Ensure core tables reference user_profiles
        query = text("""
            SELECT COUNT(*) = 4
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_class r ON c.confrelid = r.oid
            WHERE c.conname IN (
                'fk_assets_user_id',
                'fk_playlists_user_id',
                'fk_destinations_user_id',
                'fk_streams_user_id'
            )
            AND r.relname = 'user_profiles'
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '010':
        # Ensure quality limit columns are present
        query = text("""
            SELECT COUNT(*) = 5
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'subscription_tier_limits'
              AND column_name IN (
                  'max_resolution_height',
                  'max_fps',
                  'max_video_bitrate_mbps',
                  'min_video_bitrate_mbps',
                  'enforce_stream_quality'
              )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '011':
        # Ensure streams have source_type column populated
        query = text("""
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name = 'source_type'
        """)
        result = await conn.execute(query)
        if result.scalar() == 0:
            return False

        # Ensure existing rows defaulted to playlist
        query = text("""
            SELECT COUNT(*)
            FROM streams
            WHERE source_type IS NULL
        """)
        result = await conn.execute(query)
        return result.scalar() == 0

    elif migration_num == '012':
        # Ensure stream_assets table exists with indexes
        query = text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'stream_assets'
            )
        """)
        result = await conn.execute(query)
        if not result.scalar():
            return False

        # Ensure stream_id reference is enforced (index exists)
        query = text("""
            SELECT COUNT(*)
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'stream_assets'
              AND indexname IN (
                  'idx_stream_assets_stream_id',
                  'idx_stream_assets_asset_id',
                  'idx_stream_assets_stream_position'
              )
        """)
        result = await conn.execute(query)
        return result.scalar() == 3

    return False


async def main():
    """Main migration script"""
    print("=" * 60)
    print("🚀 YouTube Streaming Platform - Database Migration")
    print("=" * 60)
    
    # Create async engine with asyncpg
    database_url = settings.database_url.replace('postgresql://', 'postgresql+asyncpg://')
    engine = create_async_engine(
        database_url,
        echo=False,
        future=True
    )
    
    async with engine.begin() as conn:
        # Check current migration status
        print("\n📊 Checking current migration status...")
        status = await get_migration_status(conn)
        
        print("\nMigration Status:")
        for migration_num, applied in status.items():
            icon = "✅" if applied else "⏳"
            status_text = "Applied" if applied else "Pending"
            print(f"  {icon} Migration {migration_num}: {status_text}")
        
        # Ask for confirmation
        pending = [num for num, applied in status.items() if not applied]
        if not pending:
            print("\n✅ All migrations already applied!")
            return
        
        print(f"\n⚠️  About to apply {len(pending)} pending migration(s):")
        for num in pending:
            migration_file = next(m for m in MIGRATIONS if num in m)
            print(f"   - {migration_file}")
        
        response = input("\nProceed with migrations? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("❌ Migration cancelled by user")
            return
        
        # Apply pending migrations
        print("\n🔄 Applying migrations...")
        for migration_file in MIGRATIONS:
            migration_num = Path(migration_file).stem.split('_')[0]
            
            if migration_num not in pending:
                print(f"\n⏭️  Skipping {migration_file} (already applied)")
                continue
            
            success = await apply_migration(conn, migration_file)
            if not success:
                print("\n❌ Migration failed! Rolling back...")
                await conn.rollback()
                return
            
            # Verify migration
            print(f"🔍 Verifying {migration_file}...")
            if await verify_migration(conn, migration_num):
                print(f"✅ Verification passed")
            else:
                print(f"⚠️  Verification failed - please check manually")
        
        # Commit all migrations
        print("\n💾 Committing migrations...")
        await conn.commit()
        
        print("\n" + "=" * 60)
        print("✅ All migrations applied successfully!")
        print("=" * 60)
        
        # Print post-migration instructions
        print("\n📋 Post-Migration Checklist:")
        print("1. Verify data:")
        print("   psql <connection> -c 'SELECT * FROM user_profiles LIMIT 5;'")
        print("2. Check storage usage:")
        print("   psql <connection> -c 'SELECT email, current_storage_bytes FROM user_profiles;'")
        print("3. Run tests:")
        print("   pytest backend/tests/test_migrations.py -v")
        print("4. Create admin user:")
        print("   UPDATE user_profiles SET is_admin = TRUE WHERE email = 'your@email.com';")
        print("\n🎉 Ready to proceed to Sprint 2!")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n❌ Migration interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
