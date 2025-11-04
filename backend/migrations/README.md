# Database Migrations

## Overview

This directory contains SQL migration files for the YouTube Multi-Channel Streaming Platform refactoring from project-based to user-based architecture.

## Migration Files

### Phase 1: Core Infrastructure

1. **001_initial_schema.sql** (Existing)
   - Initial database schema with projects
   - Assets, playlists, destinations, streams tables
   - **Status:** Already applied

2. **002_row_level_security.sql** (Existing)
   - RLS policies for project-based access
   - **Status:** Already applied

### Phase 2: New Architecture (Sprint 1)

3. **003_user_profiles_and_tiers.sql** (NEW)
   - Creates `user_profiles` table with subscription tiers
   - Creates `subscription_tier_limits` table with quotas
   - Adds auto-create trigger for new users
   - Inserts default tier limits (free, pro, business, enterprise)
   - **Status:** Ready to apply

4. **004_add_user_id_columns.sql** (NEW)
   - Adds `user_id` columns to assets, playlists, destinations, streams
   - Migrates data from projects table
   - Creates indexes on user_id
   - Adds statistics columns (storage usage, stream counts, etc.)
   - Creates triggers to auto-update usage statistics
   - **Status:** Ready to apply

5. **005_admin_and_alerts.sql** (NEW)
   - Creates `admin_actions` table for audit logging
   - Creates `system_alerts` table for monitoring
   - Creates `user_activity_log` table for analytics
   - Adds triggers for quota exceeded alerts
   - Adds views for admin dashboard
   - **Status:** Ready to apply

6. **006_update_rls_policies.sql** (NEW)
   - Updates all RLS policies to use user_id
   - Removes project-based policies
   - Adds admin-specific policies
   - **Status:** Ready to apply

## How to Apply Migrations

### Prerequisites

- PostgreSQL database access (Supabase or self-hosted)
- Admin privileges
- Backup of existing data (CRITICAL!)

### Step 1: Backup Current Database

```bash
# For Supabase (using their CLI or dashboard export)
# Or for self-hosted PostgreSQL:
pg_dump -h <host> -U <user> -d <database> -F c -f backup_pre_migration_$(date +%Y%m%d_%H%M%S).dump
```

### Step 2: Apply Migrations in Order

**Using Supabase SQL Editor:**

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `003_user_profiles_and_tiers.sql`
3. Paste and click "Run"
4. Repeat for `004`, `005`, `006`

**Using psql:**

```bash
# Connect to database
psql -h <host> -U <user> -d <database>

# Apply migrations in order
\i /path/to/migrations/003_user_profiles_and_tiers.sql
\i /path/to/migrations/004_add_user_id_columns.sql
\i /path/to/migrations/005_admin_and_alerts.sql
\i /path/to/migrations/006_update_rls_policies.sql
```

**Using Supabase CLI:**

```bash
supabase migration new user_profiles_and_tiers
# Copy contents of 003 into generated file
supabase db push

# Repeat for other migrations
```

### Step 3: Verify Migrations

After applying migrations, verify:

```sql
-- Check user_profiles table exists
SELECT * FROM user_profiles LIMIT 1;

-- Check user_id columns exist
SELECT user_id FROM assets LIMIT 1;
SELECT user_id FROM playlists LIMIT 1;
SELECT user_id FROM destinations LIMIT 1;
SELECT user_id FROM streams LIMIT 1;

-- Check subscription tier limits
SELECT * FROM subscription_tier_limits;

-- Check RLS policies
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('assets', 'playlists', 'destinations', 'streams', 'user_profiles');

-- Check triggers exist
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public';
```

### Step 4: Verify Data Migration

```sql
-- Ensure all assets have user_id populated
SELECT COUNT(*) as total_assets,
       COUNT(user_id) as assets_with_user_id
FROM assets;

-- Verify user_id matches project.user_id
SELECT 
    a.id,
    a.user_id as asset_user_id,
    p.user_id as project_user_id
FROM assets a
JOIN projects p ON p.id = a.project_id
WHERE a.user_id != p.user_id
LIMIT 10;  -- Should return 0 rows

-- Check storage usage calculation
SELECT 
    up.email,
    up.current_storage_bytes / (1024.0 * 1024.0 * 1024.0) as storage_gb,
    COUNT(a.id) as asset_count
FROM user_profiles up
LEFT JOIN assets a ON a.user_id = up.user_id
GROUP BY up.user_id, up.email, up.current_storage_bytes;
```

## Rollback Plan

If migrations fail or cause issues:

### Option 1: Restore from Backup

```bash
pg_restore -h <host> -U <user> -d <database> -c backup_pre_migration_YYYYMMDD_HHMMSS.dump
```

### Option 2: Manual Rollback

```sql
-- Rollback 006: Drop new RLS policies
DROP POLICY IF EXISTS "users_can_manage_own_assets" ON assets;
-- ... (drop all new policies)

-- Recreate old project-based policies (from 002_row_level_security.sql)

-- Rollback 005: Drop admin tables
DROP TABLE IF EXISTS user_activity_log CASCADE;
DROP TABLE IF EXISTS system_alerts CASCADE;
DROP TABLE IF EXISTS admin_actions CASCADE;

-- Rollback 004: Remove user_id columns
ALTER TABLE streams DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE destinations DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE playlists DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE assets DROP COLUMN IF EXISTS user_id CASCADE;

-- Rollback 003: Drop user profile tables
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS subscription_tier_limits CASCADE;
```

## Testing Migrations Locally

Before applying to production:

1. **Setup local test database:**
```bash
docker run --name pg-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 -d postgres:15
```

2. **Apply initial schema:**
```bash
psql -h localhost -p 5433 -U postgres -d postgres < 001_initial_schema.sql
psql -h localhost -p 5433 -U postgres -d postgres < 002_row_level_security.sql
```

3. **Create test data:**
```sql
-- Insert test user
INSERT INTO auth.users (id, email) VALUES 
    ('11111111-1111-1111-1111-111111111111', 'test@example.com');

-- Insert test project
INSERT INTO projects (id, user_id, name) VALUES
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Project');

-- Insert test asset
INSERT INTO assets (id, project_id, filename, storage_path, size_bytes, compatible_for_copy) VALUES
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'test.mp4', '/uploads/test.mp4', 1000000, true);
```

4. **Apply new migrations:**
```bash
psql -h localhost -p 5433 -U postgres -d postgres < 003_user_profiles_and_tiers.sql
psql -h localhost -p 5433 -U postgres -d postgres < 004_add_user_id_columns.sql
psql -h localhost -p 5433 -U postgres -d postgres < 005_admin_and_alerts.sql
psql -h localhost -p 5433 -U postgres -d postgres < 006_update_rls_policies.sql
```

5. **Verify test data migrated correctly:**
```sql
-- Check asset has user_id
SELECT id, user_id, filename FROM assets WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check user profile created
SELECT user_id, email, subscription_tier FROM user_profiles WHERE user_id = '11111111-1111-1111-1111-111111111111';
```

## Post-Migration Tasks

After successful migration:

1. ✅ Update backend models (already done in `app/models/database.py`)
2. ⏳ Update backend API routes (remove project_id parameters)
3. ⏳ Update frontend API client
4. ⏳ Update frontend UI components
5. ⏳ Test quota enforcement
6. ⏳ Test admin panel access
7. ⏳ Monitor system alerts table for issues

## Common Issues & Solutions

### Issue 1: user_id is NULL after migration
**Solution:** Check that projects table has correct user_id values
```sql
SELECT COUNT(*) FROM projects WHERE user_id IS NULL;
-- If > 0, investigate and fix before migration
```

### Issue 2: RLS policies blocking access
**Solution:** Verify auth.uid() function works
```sql
SELECT auth.uid();  -- Should return current user's UUID
```

### Issue 3: Storage usage not calculating
**Solution:** Manually trigger update
```sql
UPDATE user_profiles up
SET current_storage_bytes = (
    SELECT COALESCE(SUM(size_bytes), 0)
    FROM assets a
    WHERE a.user_id = up.user_id
);
```

## Support

For issues or questions:
- Check migration file comments
- Review RLS policies: `SELECT * FROM pg_policies;`
- Check logs: `SELECT * FROM system_alerts WHERE resolved = FALSE;`
- Contact: [Your support channel]

---

**Last Updated:** 2025-11-04  
**Version:** Sprint 1 - Phase 2 Migrations
