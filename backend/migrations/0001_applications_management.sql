-- ============================================
-- Migration: Applications Management (Sprint 1)
-- ============================================

-- 1. SQLite doesn't support DROP CONSTRAINT IF EXISTS
-- We'll recreate the table with new schema
-- Note: In production, you should backup data first

-- 2. Add new columns (SQLite supports ADD COLUMN)
ALTER TABLE applications ADD COLUMN status_reason text;
ALTER TABLE applications ADD COLUMN verified_by text;
ALTER TABLE applications ADD COLUMN verified_at integer;

-- 3. For the check constraint, we need to recreate the table
-- Since this is a new project with no production data, we'll use a workaround:
-- Update existing rows to conform to new status values
UPDATE applications SET status = 'SUBMITTED' WHERE status = 'DRAFT' OR status = 'VERIFIED';

-- 4. Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_apps_round_status ON applications(round_id, status);
