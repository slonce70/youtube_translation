-- Migration 026: Ensure collection_items has updated_at column

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'collection_items'
          AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE collection_items
            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Ensure updated_at trigger exists (in case table was created earlier)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'collection_items'
          AND column_name = 'updated_at'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE event_object_table = 'collection_items'
          AND trigger_name = 'update_collection_items_updated_at'
    ) THEN
        CREATE TRIGGER update_collection_items_updated_at
            BEFORE UPDATE ON collection_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
