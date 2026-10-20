-- Migration 023: Add last_login_at column to admin_users
-- Nullable: no default, no backfill
-- Used for tracking last successful login timestamp

ALTER TABLE admin_users
ADD COLUMN last_login_at INTEGER;
