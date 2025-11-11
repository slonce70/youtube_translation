# Database Migrations - Local PostgreSQL Setup

**Date:** 2025-11-11  
**Purpose:** Document migration changes for local PostgreSQL with Supabase Auth

## Architecture

### Hybrid Approach
- **Authentication:** Supabase Auth (`auth.users` lives in Supabase cloud)
- **Database:** Local PostgreSQL (all application data)
- **Synchronization:** Backend automatically creates `user_profiles` on first authentication via `_ensure_user_profile()` in `deps.py`

### Key Principle
Local PostgreSQL **does not have** `auth.users` table. Therefore, all foreign keys must reference `user_profiles(user_id)` instead of `auth.users(id)`.

## Migration Changes Summary

### Skipped Migrations (Supabase-Only)

#### 001_initial_schema.sql ❌ SKIPPED
- **Reason:** References `auth.users` and projects table (removed)
- **Replaced by:** `000_local_initial_schema.sql`

#### 002_row_level_security.sql ❌ SKIPPED  
- **Reason:** RLS policies are Supabase-specific
- **Note:** Local PostgreSQL uses backend authentication only

#### 006_update_rls_policies.sql ❌ SKIPPED
- **Reason:** RLS policies not applicable to local PostgreSQL
- **Note:** Commented out in `apply_migrations.py`

#### 020_fix_signup_profile_trigger.sql ❌ SKIPPED
- **Reason:** Attempts to create trigger on `auth.users` (doesn't exist locally)
- **Replacement:** Backend handles profile creation via `_ensure_user_profile()`

#### 021_disable_supabase_profile_trigger.sql ❌ SKIPPED
- **Reason:** Attempts to drop trigger from `auth.users` (doesn't exist locally)
- **Note:** Not needed for local setup

### Modified Migrations (Local Version)

#### 000_local_initial_schema.sql ✅ BASE SCHEMA
**Changes:**
- Creates `user_profiles` as **primary table** (not referencing `auth.users`)
- `user_id UUID PRIMARY KEY` (no foreign key constraint)
- Includes all tables from scratch: assets, playlists, destinations, streams, etc.
- **Must be applied first** before other migrations

#### 003_user_profiles_and_tiers.sql ✅ MODIFIED
**Original Issues:**
```sql
user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE  -- ❌ Won't work
```

**Fixed to:**
```sql
user_id UUID PRIMARY KEY,  -- ✅ No FK to auth.users
```

**Removed:**
- Trigger `on_auth_user_created` (can't listen to remote `auth.users`)
- Function `create_user_profile()` (handled by backend)
- `INSERT INTO user_profiles SELECT FROM auth.users` (no local auth.users)

**Note:** Profiles are created by backend on first authentication

#### 004_add_user_id_columns.sql ✅ MODIFIED
**Changed all foreign keys:**
```sql
-- Before:
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE  -- ❌

-- After:
FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE  -- ✅
```

**Affected tables:**
- `assets`
- `playlists`
- `destinations`
- `streams`

#### 005_admin_and_alerts.sql ✅ MODIFIED
**Changed all foreign keys:**
```sql
-- admin_actions
admin_user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE  -- ✅
target_user_id UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL  -- ✅

-- system_alerts
user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE  -- ✅
resolved_by UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL  -- ✅

-- user_activity_log
user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE  -- ✅
```

#### 008_update_admin_alert_fk.sql ✅ ALREADY CORRECT
- Updates FK constraints from `auth.users` to `user_profiles(user_id)`
- **No changes needed** - this migration fixes what we need

#### 019_fix_system_alerts.sql ✅ ALREADY CORRECT
- Updates FK constraints from `auth.users` to `user_profiles(user_id)`
- **No changes needed** - this migration fixes what we need

### Unchanged Migrations (Work As-Is)

#### 007_remove_projects.sql ✅ NO CHANGES
- Removes `projects` table (not needed with user-based architecture)

#### 009_update_user_fk.sql ✅ NO CHANGES
- Updates foreign keys (works with local setup)

#### 010_stream_quality_limits.sql ✅ NO CHANGES
- Adds quality enforcement to `subscription_tier_limits`

#### 011_stream_source_type.sql ✅ NO CHANGES
- Adds `source_type` to streams table

#### 012_stream_assets.sql ✅ NO CHANGES
- Creates `stream_assets` junction table

#### 013_update_tariffs.sql ✅ NO CHANGES
- Updates subscription tier limits with new tiers

#### 014_asset_metadata.sql ✅ NO CHANGES
- Enhances asset metadata storage

#### 015_media_folders.sql ✅ NO CHANGES
- Creates media folder organization

#### 016_media_collections.sql ✅ NO CHANGES
- Creates media collections for playlists

#### 017_streams_collection_link.sql ✅ NO CHANGES
- Links streams to media collections

#### 018_performance_indexes.sql ✅ NO CHANGES
- Adds performance indexes

## Migration Order

### 1. Initial Setup
```bash
# Apply base schema first
psql -h localhost -U youtube_user -d youtube_streaming \
  -f backend/migrations/000_local_initial_schema.sql
```

### 2. Apply Remaining Migrations
```bash
cd backend
source ../.venv/bin/activate
echo "yes" | python apply_migrations.py
```

**Migrations applied (in order):**
1. 000 - Local initial schema (manual)
2. 003 - User profiles and tiers
3. 004 - Add user_id columns
4. 005 - Admin and alerts
5. 007 - Remove projects
6. 008 - Update admin/alert FK
7. 009 - Update user FK
8. 010 - Stream quality limits
9. 011 - Stream source type
10. 012 - Stream assets
11. 013 - Update tariffs
12. 014 - Asset metadata
13. 015 - Media folders
14. 016 - Media collections
15. 017 - Streams collection link
16. 018 - Performance indexes
17. 019 - Fix system alerts

## Backend Integration

### Profile Creation Flow

**When user authenticates:**
```python
# In app/api/deps.py
async def get_current_user(authorization: str):
    # 1. Verify token with Supabase Auth (remote)
    user = await supabase.auth.get_user(token)
    
    # 2. Get user_id from Supabase
    user_id = user.user.id
    
    # 3. Ensure profile exists in local DB
    await _ensure_user_profile(db, {
        "sub": user_id,
        "email": user.user.email,
        ...
    })
    
    return user_payload
```

### _ensure_user_profile() Function

```python
async def _ensure_user_profile(db: AsyncSession, user_payload: dict) -> UUID:
    """Creates profile in local DB if it doesn't exist"""
    user_id = UUID(user_payload["sub"])
    
    # Check if profile exists
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        # Create new profile with data from Supabase
        profile = UserProfile(
            user_id=user_id,
            email=user_payload["email"],
            full_name=user_payload.get("user_metadata", {}).get("full_name"),
            subscription_tier="free",
            subscription_status="active"
        )
        db.add(profile)
        await db.commit()
    
    return profile.user_id
```

## Database State

### Current Tables (16)
```
✓ user_profiles              - User accounts (synced with Supabase Auth)
✓ subscription_tier_limits   - Tier limits and pricing
✓ assets                     - Media files (videos/audio)
✓ playlists                  - User playlists
✓ playlist_items             - Playlist content
✓ destinations               - Stream destinations (YouTube, etc)
✓ streams                    - Active streams
✓ stream_destinations        - Stream ↔ Destination mapping
✓ stream_assets              - Stream ↔ Asset mapping
✓ stream_events              - Stream lifecycle events
✓ media_folders              - Folder organization
✓ media_collections          - Content collections
✓ collection_items           - Collection content
✓ admin_actions              - Admin audit log
✓ system_alerts              - System alerts
✓ user_activity_log          - User activity tracking
```

### Verification Commands

```sql
-- Check all tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Verify user_profiles structure
\d user_profiles

-- Check foreign keys reference user_profiles, not auth.users
SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('user_profiles', 'auth.users')
ORDER BY tc.table_name;
```

## Troubleshooting

### Error: relation "auth.users" does not exist

**Cause:** Migration tries to reference `auth.users`  
**Solution:** 
1. Check which migration failed
2. Verify it's been updated to reference `user_profiles(user_id)`
3. Re-apply fixed migration

### Error: Profile not created on first login

**Cause:** `_ensure_user_profile()` failed  
**Solution:**
```sql
-- Manually create profile
INSERT INTO user_profiles (user_id, email, subscription_tier, subscription_status)
VALUES ('USER_ID_FROM_SUPABASE', 'user@example.com', 'free', 'active');
```

### Error: Foreign key constraint violation

**Cause:** Trying to insert record with user_id not in `user_profiles`  
**Solution:**
```sql
-- Check if profile exists
SELECT * FROM user_profiles WHERE user_id = 'USER_ID';

-- If not, authenticate via API first to create profile
-- Or manually insert as shown above
```

## Rollback Strategy

### Full Database Reset
```bash
# 1. Drop database
psql -h localhost -U alinakovpaka -d postgres \
  -c "DROP DATABASE IF EXISTS youtube_streaming;"

# 2. Recreate
psql -h localhost -U alinakovpaka -d postgres \
  -c "CREATE DATABASE youtube_streaming OWNER youtube_user;"

# 3. Re-apply migrations
psql -h localhost -U youtube_user -d youtube_streaming \
  -f backend/migrations/000_local_initial_schema.sql

cd backend && echo "yes" | python apply_migrations.py
```

### Single Migration Rollback
Not recommended. Better to:
1. Fix the migration file
2. Drop and recreate database
3. Re-apply all migrations

## Best Practices

### Adding New Migrations

**DO:**
- ✅ Reference `user_profiles(user_id)` for user foreign keys
- ✅ Test migration in fresh local database
- ✅ Document any Supabase-specific logic to skip

**DON'T:**
- ❌ Reference `auth.users` (doesn't exist locally)
- ❌ Create triggers on `auth.users`  
- ❌ Assume RLS policies will work
- ❌ Query Supabase-managed tables directly

### Migration File Naming
```
NNN_description.sql

NNN = sequential number (003, 004, etc.)
description = snake_case summary
```

### Testing New Migrations

```bash
# 1. Create test database
psql -h localhost -U alinakovpaka -d postgres \
  -c "CREATE DATABASE youtube_streaming_test OWNER youtube_user;"

# 2. Apply base schema
psql -h localhost -U youtube_user -d youtube_streaming_test \
  -f backend/migrations/000_local_initial_schema.sql

# 3. Test new migration
psql -h localhost -U youtube_user -d youtube_streaming_test \
  -f backend/migrations/NNN_new_migration.sql

# 4. Verify
psql -h localhost -U youtube_user -d youtube_streaming_test \
  -c "\d+ your_new_table"

# 5. Drop test database
psql -h localhost -U alinakovpaka -d postgres \
  -c "DROP DATABASE youtube_streaming_test;"
```

## Summary

✅ **Database is ready:**
- All migrations adapted for local PostgreSQL
- No references to `auth.users`
- Profile creation handled by backend
- Clean separation: Auth (Supabase) + Data (Local)

✅ **Key Changes:**
- 5 migrations skipped (Supabase-only)
- 5 migrations modified (FK updates)
- 12 migrations unchanged (work as-is)
- Total: 17 active migrations

✅ **Production Ready:**
- Users authenticate via Supabase Auth
- Profiles auto-created on first login
- All foreign keys valid and enforceable
- No dependency on Supabase database
