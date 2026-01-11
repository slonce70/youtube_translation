-- Migration 027: Ensure stream status constraint includes 'scheduled'

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS streams_status_check;

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS check_status;

ALTER TABLE streams
    ADD CONSTRAINT check_status
    CHECK (status IN ('stopped', 'starting', 'running', 'error', 'stopping', 'scheduled'));
