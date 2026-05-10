-- Align the database-level fallback with YouTube's recommended secure RTMPS
-- ingest host. Application code supplies this value explicitly, but the column
-- default must also be correct for direct inserts and production drift checks.
ALTER TABLE destinations
    ALTER COLUMN rtmps_url SET DEFAULT 'rtmps://a.rtmps.youtube.com/live2';
