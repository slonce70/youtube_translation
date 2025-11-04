-- Migration 007: Remove Projects Table and project_id columns
-- Date: 2025-11-04
-- Description: Clean up legacy project-based architecture

-- =====================================================
-- STEP 1: Drop project_id columns from all tables
-- =====================================================

-- Drop project_id from assets
ALTER TABLE assets DROP COLUMN IF EXISTS project_id CASCADE;

-- Drop project_id from playlists
ALTER TABLE playlists DROP COLUMN IF EXISTS project_id CASCADE;

-- Drop project_id from destinations
ALTER TABLE destinations DROP COLUMN IF EXISTS project_id CASCADE;

-- Drop project_id from streams
ALTER TABLE streams DROP COLUMN IF EXISTS project_id CASCADE;

-- =====================================================
-- STEP 2: Drop projects table
-- =====================================================

DROP TABLE IF EXISTS projects CASCADE;

-- =====================================================
-- STEP 3: Verification
-- =====================================================

-- Verify columns are dropped
DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name IN ('assets', 'playlists', 'destinations', 'streams')
    AND column_name = 'project_id';
    
    IF col_count > 0 THEN
        RAISE EXCEPTION 'project_id columns still exist in some tables';
    END IF;
    
    RAISE NOTICE 'Migration 007 completed successfully';
    RAISE NOTICE 'All project_id columns removed';
    RAISE NOTICE 'Projects table dropped';
END $$;
