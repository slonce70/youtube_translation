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
# Note: 001 (Supabase bootstrap) is skipped for local PostgreSQL
# Note: 002, 006 are RLS/Supabase-specific policies, skipped for local
# Note: 003 is SKIPPED - already created by 000_local_initial_schema.sql
MIGRATIONS = [
    # 'migrations/003_user_profiles_and_tiers.sql',  # SKIP: duplicates 000_local_initial_schema.sql
    'migrations/004_add_user_id_columns.sql',       # LOCAL: Additional indexes only
    'migrations/005_admin_and_alerts.sql',          # LOCAL: FK to user_profiles
    # 'migrations/006_update_rls_policies.sql',     # SKIP: RLS (Supabase only)
    'migrations/007_remove_projects.sql',
    'migrations/008_update_admin_alert_fk.sql',     # Fixes FK to user_profiles
    # 'migrations/009_update_user_fk.sql',          # SKIP: FK already correct from 000
    'migrations/010_stream_quality_limits.sql',
    'migrations/011_stream_source_type.sql',
    'migrations/012_stream_assets.sql',
    'migrations/013_update_tariffs.sql',
    'migrations/014_asset_metadata.sql',
    'migrations/015_media_folders.sql',
    'migrations/016_media_collections.sql',
    'migrations/017_streams_collection_link.sql',
    'migrations/018_performance_indexes.sql',
    'migrations/019_fix_system_alerts.sql',         # Fixes FK to user_profiles
    'migrations/020_admin_action_reason_column.sql',
    'migrations/021_admin_action_request_metadata.sql',
    'migrations/022_admin_action_type_constraint.sql',
    'migrations/023_stream_schedule_columns.sql',
    'migrations/024_stream_schedule_stop_columns.sql',
    'migrations/025_user_profile_timezone.sql',
    'migrations/026_collection_items_updated_at.sql',
    'migrations/027_stream_status_constraint.sql',
    'migrations/028_stream_scheduler_v1.sql',
    'migrations/029_asset_optimization_status.sql',
    'migrations/030_stream_runtime_leases.sql',
    'migrations/031_stream_runtime_restart_state.sql',
    'migrations/032_asset_storage_contract.sql',
    'migrations/033_upload_ingests.sql',
    'migrations/034_fix_uhd_bitrate_caps.sql',
    'migrations/035_stream_runtime_refusal_alert_type.sql',
    'migrations/036_drop_legacy_stream_runtime_state.sql',
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
        SELECT
            (
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'assets'
                   AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'playlists'
                   AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'destinations'
                   AND column_name = 'user_id') +
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'streams'
                   AND column_name = 'user_id')
            ) = 4
            AND
            (
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'streams'
                   AND column_name = 'total_duration_seconds') = 1
            )
            AND
            (
                (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'playlists'
                   AND column_name IN ('total_duration_seconds', 'total_assets')
                ) = 2
            )
    """)
    result = await conn.execute(query)
    status['004'] = bool(result.scalar())
    
    # Check if admin/system tables exist (migration 005)
    admin_actions = await check_table_exists(conn, 'admin_actions')
    system_alerts = await check_table_exists(conn, 'system_alerts')
    activity_log = await check_table_exists(conn, 'user_activity_log')
    if system_alerts:
        result = await conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'system_alerts'
                  AND column_name IN ('stream_id', 'asset_id', 'resolution_notes')
                """
            )
        )
        system_alert_columns = int(result.scalar() or 0)
    else:
        system_alert_columns = 0

    status['005'] = bool(admin_actions and system_alerts and activity_log and system_alert_columns == 3)
    
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

    # Check subscription tiers populated with pricing (migration 013)
    tier_limits_exists = await check_table_exists(conn, 'subscription_tier_limits')
    if tier_limits_exists:
        query = text("""
            SELECT COUNT(*) = 7
            FROM subscription_tier_limits
            WHERE tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost')
        """)
        result = await conn.execute(query)
        tiers_seeded = result.scalar()
    else:
        tiers_seeded = False
    query = text("""
        SELECT COUNT(*) = 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscription_tier_limits'
          AND column_name = 'price_cents'
    """)
    price_column = (await conn.execute(query)).scalar()
    status['013'] = bool(tiers_seeded and price_column)

    # Check asset metadata enhancements (migration 014)
    query = text(
        """
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'assets'
          AND column_name IN (
              'asset_type',
              'codec_info',
              'video_codec',
              'audio_codec',
              'resolution',
              'bitrate',
              'fps',
              'validation_status'
          )
        """
    )
    result = await conn.execute(query)
    status['014'] = int(result.scalar() or 0) == 8

    # Check media folders tables (migration 015)
    folders_exist = await check_table_exists(conn, 'media_folders')
    links_exist = await check_table_exists(conn, 'asset_folder_links')
    if folders_exist:
        result = await conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'media_folders'
                      AND column_name = 'is_root'
                )
                """
            )
        )
        has_is_root = bool(result.scalar())
    else:
        has_is_root = False
    status['015'] = bool(folders_exist and links_exist and has_is_root)

    # Check media collections tables (migration 016)
    collections_exist = await check_table_exists(conn, 'media_collections')
    items_exist = await check_table_exists(conn, 'collection_items')
    if collections_exist:
        result = await conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'media_collections'
                  AND column_name IN ('collection_type', 'origin_playlist_id', 'is_active')
                """
            )
        )
        collections_columns = int(result.scalar() or 0)
    else:
        collections_columns = 0

    if items_exist:
        result = await conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'collection_items'
                  AND column_name IN ('loop_mode', 'updated_at')
                """
            )
        )
        items_columns = int(result.scalar() or 0)
    else:
        items_columns = 0

    status['016'] = bool(collections_exist and items_exist and collections_columns == 3 and items_columns == 2)

    # Check streams link columns (migration 017)
    query = text("""
        SELECT COUNT(*) = 4
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'streams'
          AND column_name IN ('video_collection_id', 'audio_collection_id', 'mix_mode', 'settings_json')
    """)
    result = await conn.execute(query)
    status['017'] = result.scalar()

    # Check performance indexes (migration 018)
    query = text("""
        SELECT COUNT(*) = 14
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
              'idx_assets_validation_status',
              'idx_streams_status_user',
              'idx_streams_user_started',
              'idx_user_activity_ip',
              'idx_system_alerts_severity_resolved',
              'idx_admin_actions_admin_user_time',
              'idx_destinations_user_enabled',
              'idx_playlist_items_position',
              'idx_collection_items_position',
              'idx_stream_events_stream_time',
              'idx_media_folders_parent',
              'idx_asset_folder_links_folder',
              'idx_assets_user_type',
              'idx_collections_user_type_active'
          )
    """)
    result = await conn.execute(query)
    status['018'] = result.scalar()

    # Check system alert constraints (migration 019)
    query = text("""
        SELECT COUNT(*) = 2
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'system_alerts'
          AND constraint_name IN ('system_alerts_alert_type_check', 'system_alerts_severity_check')
    """)
    constraints_ok = (await conn.execute(query)).scalar()

    query = text(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'system_alerts'
              AND c.conname = 'system_alerts_alert_type_check'
              AND pg_get_constraintdef(c.oid) ILIKE '%collection_depleted%'
        )
        """
    )
    allows_collection_depleted = bool((await conn.execute(query)).scalar())
    query = text("""
        SELECT COUNT(*) = 2
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_class r ON c.confrelid = r.oid
        WHERE c.conname IN ('system_alerts_user_id_fkey', 'user_activity_log_user_id_fkey')
          AND r.relname = 'user_profiles'
    """)
    fks_ok = (await conn.execute(query)).scalar()
    status['019'] = bool(constraints_ok and allows_collection_depleted and fks_ok)

    # Check runtime refusal alert type support (migration 035)
    query = text(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'system_alerts'
              AND c.conname = 'system_alerts_alert_type_check'
              AND pg_get_constraintdef(c.oid) ILIKE '%stream_runtime_refused_terminal_state%'
        )
        """
    )
    status['035'] = bool((await conn.execute(query)).scalar())

    # Check admin actions reason column (migration 020)
    query = text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'admin_actions'
              AND column_name = 'reason'
        )
    """)
    result = await conn.execute(query)
    status['020'] = result.scalar()

    # Check admin actions request metadata columns (migration 021)
    query = text("""
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_actions'
          AND column_name IN ('ip_address', 'user_agent')
    """)
    result = await conn.execute(query)
    status['021'] = result.scalar()

    # Check admin actions constraint updated (migration 022)
    query = text("""
        SELECT pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conrelid = 'admin_actions'::regclass
          AND conname = 'admin_actions_action_type_check'
    """)
    result = await conn.execute(query)
    definition = result.scalar()
    status['022'] = bool(
        definition
        and 'change_tier' in definition
        and 'force_stop_stream' in definition
        and 'resolve_alert' in definition
    )

    # Check stream schedule columns (migration 023)
    query = text("""
        SELECT COUNT(*) = 3
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'streams'
          AND column_name IN (
              'scheduled_start_enabled',
              'scheduled_start_time',
              'scheduled_start_attempted_at'
          )
    """)
    result = await conn.execute(query)
    status['023'] = result.scalar()

    # Check stream scheduled stop columns (migration 024)
    query = text("""
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'streams'
          AND column_name IN (
              'scheduled_stop_time',
              'scheduled_stop_attempted_at'
          )
    """)
    result = await conn.execute(query)
    status['024'] = result.scalar()

    # Check user profile timezone column (migration 025)
    query = text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'user_profiles'
              AND column_name = 'timezone'
        )
    """)
    result = await conn.execute(query)
    status['025'] = result.scalar()

    # Check collection_items updated_at column (migration 026)
    query = text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'collection_items'
              AND column_name = 'updated_at'
        )
    """)
    result = await conn.execute(query)
    status['026'] = result.scalar()

    # Check stream status constraint includes 'scheduled' (migration 027)
    query = text("""
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        WHERE c.conrelid = 'public.streams'::regclass
          AND c.conname IN ('check_status', 'streams_status_check')
        ORDER BY c.conname
        LIMIT 1
    """)
    result = await conn.execute(query)
    definition = result.scalar()
    status['027'] = bool(definition and 'scheduled' in definition)

    for migration_num in ('028', '029', '030', '031', '032', '033', '034', '035', '036'):
        status[migration_num] = await verify_migration(conn, migration_num)

    return status


async def apply_migration(conn: AsyncConnection, migration_file: str):
    """Apply a single migration file"""
    print(f"\n📝 Applying {migration_file}...")
    
    # Read migration file
    migration_path = Path(__file__).parent / migration_file
    if not migration_path.exists():
        print(f"⚠️  Migration file not found: {migration_file} — skipping")
        return True
    
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
        return count >= 4
    
    elif migration_num == '004':
        query = text(
            """
            SELECT
                (
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'assets'
                       AND column_name = 'user_id') +
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'playlists'
                       AND column_name = 'user_id') +
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'destinations'
                       AND column_name = 'user_id') +
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'streams'
                       AND column_name = 'user_id')
                ) = 4
                AND
                (
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'streams'
                       AND column_name = 'total_duration_seconds') = 1
                )
                AND
                (
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public'
                       AND table_name = 'playlists'
                       AND column_name IN ('total_duration_seconds', 'total_assets')
                    ) = 2
                )
            """
        )
        result = await conn.execute(query)
        return bool(result.scalar())
    
    elif migration_num == '005':
        # Check admin tables exist
        tables = ['admin_actions', 'system_alerts', 'user_activity_log']
        for table in tables:
            if not await check_table_exists(conn, table):
                return False

        query = text(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'system_alerts'
              AND column_name IN ('stream_id', 'asset_id', 'resolution_notes')
            """
        )
        result = await conn.execute(query)
        return int(result.scalar() or 0) == 3
    
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

    elif migration_num == '013':
        query = text("""
            SELECT COUNT(*)
            FROM subscription_tier_limits
            WHERE tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost')
        """)
        result = await conn.execute(query)
        tier_count = result.scalar()
        if tier_count != 7:
            return False

        # Ensure expected columns exist (price_cents as representative)
        query = text("""
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'subscription_tier_limits'
              AND column_name = 'price_cents'
        """)
        result = await conn.execute(query)
        return result.scalar() == 1

    elif migration_num == '014':
        query = text(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assets'
              AND column_name IN (
                  'asset_type',
                  'codec_info',
                  'video_codec',
                  'audio_codec',
                  'resolution',
                  'bitrate',
                  'fps',
                  'validation_status'
              )
            """
        )
        result = await conn.execute(query)
        return int(result.scalar() or 0) == 8

    elif migration_num == '015':
        folders = await check_table_exists(conn, 'media_folders')
        links = await check_table_exists(conn, 'asset_folder_links')
        if not (folders and links):
            return False

        query = text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'media_folders'
                  AND column_name = 'is_root'
            )
            """
        )
        result = await conn.execute(query)
        return bool(result.scalar())

    elif migration_num == '016':
        collections = await check_table_exists(conn, 'media_collections')
        items = await check_table_exists(conn, 'collection_items')
        if not (collections and items):
            return False

        query = text(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'media_collections'
              AND column_name IN ('collection_type', 'origin_playlist_id', 'is_active')
            """
        )
        collections_columns = int((await conn.execute(query)).scalar() or 0)

        query = text(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'collection_items'
              AND column_name IN ('loop_mode', 'updated_at')
            """
        )
        items_columns = int((await conn.execute(query)).scalar() or 0)

        return bool(collections_columns == 3 and items_columns == 2)

    elif migration_num == '017':
        query = text("""
            SELECT COUNT(*) = 4
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN ('video_collection_id', 'audio_collection_id', 'mix_mode', 'settings_json')
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '018':
        query = text("""
            SELECT COUNT(*) = 14
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                  'idx_assets_validation_status',
                  'idx_streams_status_user',
                  'idx_streams_user_started',
                  'idx_user_activity_ip',
                  'idx_system_alerts_severity_resolved',
                  'idx_admin_actions_admin_user_time',
                  'idx_destinations_user_enabled',
                  'idx_playlist_items_position',
                  'idx_collection_items_position',
                  'idx_stream_events_stream_time',
                  'idx_media_folders_parent',
                  'idx_asset_folder_links_folder',
                  'idx_assets_user_type',
                  'idx_collections_user_type_active'
              )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '019':
        query = text("""
            SELECT COUNT(*) = 2
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'system_alerts'
              AND constraint_name IN ('system_alerts_alert_type_check', 'system_alerts_severity_check')
        """)
        constraints_ok = (await conn.execute(query)).scalar()

        query = text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                WHERE t.relname = 'system_alerts'
                  AND c.conname = 'system_alerts_alert_type_check'
                  AND pg_get_constraintdef(c.oid) ILIKE '%collection_depleted%'
            )
            """
        )
        allows_collection_depleted = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 2
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_class r ON c.confrelid = r.oid
            WHERE c.conname IN ('system_alerts_user_id_fkey', 'user_activity_log_user_id_fkey')
              AND r.relname = 'user_profiles'
        """)
        fks_ok = (await conn.execute(query)).scalar()
        return bool(constraints_ok and allows_collection_depleted and fks_ok)

    elif migration_num == '020':
        query = text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'admin_actions'
                  AND column_name = 'reason'
            )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '021':
        query = text("""
            SELECT COUNT(*) = 2
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'admin_actions'
              AND column_name IN ('ip_address', 'user_agent')
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '022':
        query = text("""
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'admin_actions'::regclass
              AND conname = 'admin_actions_action_type_check'
        """)
        result = await conn.execute(query)
        definition = result.scalar()
        return bool(
            definition
            and 'change_tier' in definition
            and 'force_stop_stream' in definition
            and 'resolve_alert' in definition
        )

    elif migration_num == '023':
        query = text("""
            SELECT COUNT(*) = 3
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN (
                  'scheduled_start_enabled',
                  'scheduled_start_time',
                  'scheduled_start_attempted_at'
              )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '024':
        query = text("""
            SELECT COUNT(*) = 2
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN (
                  'scheduled_stop_time',
                  'scheduled_stop_attempted_at'
              )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '025':
        query = text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'user_profiles'
                  AND column_name = 'timezone'
            )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '026':
        query = text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'collection_items'
                  AND column_name = 'updated_at'
            )
        """)
        result = await conn.execute(query)
        return result.scalar()

    elif migration_num == '027':
        query = text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            WHERE c.conrelid = 'public.streams'::regclass
              AND c.conname IN ('check_status', 'streams_status_check')
            ORDER BY c.conname
            LIMIT 1
        """)
        result = await conn.execute(query)
        definition = result.scalar()
        return bool(definition and 'scheduled' in definition)

    elif migration_num == '028':
        query = text("""
            SELECT COUNT(*) = 5
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN (
                  'schedule_timezone',
                  'schedule_repeat',
                  'schedule_weekdays',
                  'schedule_window_end_time',
                  'schedule_stop_after_seconds'
              )
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            WHERE c.conrelid = 'public.streams'::regclass
              AND c.conname = 'check_stream_schedule_repeat'
        """)
        definition = (await conn.execute(query)).scalar()
        return bool(
            columns_ok
            and definition
            and 'daily' in definition
            and 'weekly' in definition
        )

    elif migration_num == '029':
        query = text("""
            SELECT COUNT(*) = 5
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assets'
              AND column_name IN (
                  'optimization_status',
                  'optimization_strategy',
                  'optimized_storage_path',
                  'optimization_error',
                  'optimization_updated_at'
              )
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'idx_assets_optimization_status'
        """)
        index_ok = bool((await conn.execute(query)).scalar())
        return bool(columns_ok and index_ok)

    elif migration_num == '030':
        query = text("""
            SELECT COUNT(*) = 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name = 'runtime_last_heartbeat_at'
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 0
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                  'idx_streams_runtime_owner_id',
                  'idx_streams_runtime_lease_expires_at'
              )
        """)
        indexes_ok = bool((await conn.execute(query)).scalar())
        return bool(columns_ok and indexes_ok)

    elif migration_num == '031':
        query = text("""
            SELECT COUNT(*) = 0
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN (
                  'runtime_restart_attempts',
                  'runtime_next_restart_at',
                  'runtime_last_restart_at',
                  'runtime_last_failure_at'
              )
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 0
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'idx_streams_runtime_next_restart_at'
        """)
        index_ok = bool((await conn.execute(query)).scalar())
        return bool(columns_ok and index_ok)

    elif migration_num == '032':
        query = text("""
            SELECT COUNT(*) = 2
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assets'
              AND column_name IN ('storage_backend', 'storage_key')
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'idx_assets_storage_backend'
        """)
        index_ok = bool((await conn.execute(query)).scalar())
        return bool(columns_ok and index_ok)

    elif migration_num == '033':
        if not await check_table_exists(conn, 'upload_ingests'):
            return False

        query = text("""
            SELECT COUNT(*) = 13
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'upload_ingests'
              AND column_name IN (
                  'upload_id',
                  'user_id',
                  'asset_id',
                  'status',
                  'storage_backend',
                  'storage_key',
                  'local_path',
                  'error_code',
                  'error_message',
                  'validation_errors',
                  'warning_messages',
                  'attempt_count',
                  'finalized_at'
              )
        """)
        columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 2
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'upload_ingests'
              AND indexname IN (
                  'idx_upload_ingests_user_id',
                  'idx_upload_ingests_user_status'
              )
        """)
        indexes_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            WHERE c.conrelid = 'public.upload_ingests'::regclass
              AND c.conname = 'check_upload_ingest_status'
        """)
        definition = (await conn.execute(query)).scalar()
        return bool(
            columns_ok
            and indexes_ok
            and definition
            and 'finalized' in definition
            and 'failed' in definition
        )

    elif migration_num == '034':
        query = text("""
            SELECT COUNT(*) = 3
            FROM subscription_tier_limits
            WHERE tier IN ('uhd_start', 'uhd_flow', 'uhd_boost')
              AND max_video_bitrate_mbps >= 51
        """)
        result = await conn.execute(query)
        return bool(result.scalar())

    elif migration_num == '035':
        query = text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                WHERE t.relname = 'system_alerts'
                  AND c.conname = 'system_alerts_alert_type_check'
                  AND pg_get_constraintdef(c.oid) ILIKE '%stream_runtime_refused_terminal_state%'
            )
            """
        )
        return bool((await conn.execute(query)).scalar())

    elif migration_num == '036':
        query = text("""
            SELECT COUNT(*) = 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name = 'runtime_last_heartbeat_at'
        """)
        heartbeat_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 0
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'streams'
              AND column_name IN (
                  'runtime_owner_id',
                  'runtime_lease_expires_at',
                  'runtime_restart_attempts',
                  'runtime_next_restart_at',
                  'runtime_last_restart_at',
                  'runtime_last_failure_at'
              )
        """)
        dropped_columns_ok = bool((await conn.execute(query)).scalar())

        query = text("""
            SELECT COUNT(*) = 0
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                  'idx_streams_runtime_owner_id',
                  'idx_streams_runtime_lease_expires_at',
                  'idx_streams_runtime_next_restart_at'
              )
        """)
        dropped_indexes_ok = bool((await conn.execute(query)).scalar())
        return bool(heartbeat_ok and dropped_columns_ok and dropped_indexes_ok)

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
        # Fresh local databases need the bootstrap schema before status detection.
        if not await check_table_exists(conn, 'user_profiles'):
            print("\n🧱 Bootstrapping local initial schema...")
            success = await apply_migration(conn, 'migrations/000_local_initial_schema.sql')
            if not success:
                print("\n❌ Local bootstrap failed! Rolling back...")
                await conn.rollback()
                return

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
            try:
                migration_file = next(m for m in MIGRATIONS if num in m)
                print(f"   - {migration_file}")
            except StopIteration:
                print(f"   - Migration {num} (SKIPPED: not in active MIGRATIONS list)")
        
        response = input("\nProceed with migrations? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("❌ Migration cancelled by user")
            return
        
        # Filter pending to only include migrations that are in MIGRATIONS list
        migrations_to_apply = []
        for migration_file in MIGRATIONS:
            migration_num = Path(migration_file).stem.split('_')[0]
            if migration_num in pending:
                migrations_to_apply.append((migration_file, migration_num))
        
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
