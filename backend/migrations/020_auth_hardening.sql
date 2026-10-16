-- Migration: 020_auth_hardening.sql
-- Authentication Hardening Phase 1
-- 
-- This migration adds fields for:
-- 1. Password migration tracking (dual-mode support)
-- 2. Account lockout mechanism
-- 3. Force password change on first login
-- 4. Enhanced role defaults (changed from HR_OFFICER to VIEWER)
-- 5. isActive flag for user enable/disable
-- =============================================================================

-- =============================================================================
-- 1. Add auth hardening columns to admin_users
-- =============================================================================

ALTER TABLE admin_users 
  ADD COLUMN password_migrated integer DEFAULT 0;

ALTER TABLE admin_users 
  ADD COLUMN password_changed_at integer;

ALTER TABLE admin_users 
  ADD COLUMN must_change_password integer DEFAULT 0;

ALTER TABLE admin_users 
  ADD COLUMN failed_login_attempts integer DEFAULT 0;

ALTER TABLE admin_users 
  ADD COLUMN locked_until integer;

ALTER TABLE admin_users 
  ADD COLUMN is_active integer DEFAULT 1;

-- =============================================================================
-- 2. Update default role from HR_OFFICER to VIEWER
-- Note: This is a schema default only. Existing users keep their roles.
-- =============================================================================

-- =============================================================================
-- 3. Create login_attempts table for brute force protection
-- =============================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  ip_address text,
  user_agent text,
  success integer NOT NULL DEFAULT 0,
  failure_reason text,
  attempted_at integer NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email 
  ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip 
  ON login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time 
  ON login_attempts(attempted_at DESC);

-- =============================================================================
-- 4. Create password_reset_tokens table
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at integer NOT NULL,
  used_at integer,
  created_at integer NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user 
  ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash 
  ON password_reset_tokens(token_hash);

-- =============================================================================
-- 5. Log existing admin users for manual migration
-- These users will need password reset or admin-assisted migration
-- =============================================================================

-- NOTE: Run this manually to see which users need migration:
-- SELECT id, email, password_migrated, length(password_hash) as hash_len 
-- FROM admin_users WHERE password_migrated = 0 OR password_migrated IS NULL;

-- =============================================================================
-- Migration Strategy Notes:
-- 
-- Phase 1: Dual-Mode Support (This migration)
-- - All existing users have password_migrated = 0 (false)
-- - Login will check: if password_migrated = 0 AND hash doesn't look like bcrypt,
--   compare as plaintext (legacy mode)
-- - On successful login in legacy mode, auto-migrate to bcrypt
-- 
-- Phase 2: Force Migration
-- - Admin can mark individual users as migrated with new bcrypt passwords
-- - Password reset will generate bcrypt passwords
-- 
-- Phase 3: Disable Legacy Mode
-- - After all users migrated, add config flag to disable plaintext comparison
-- - Remove plaintext comparison code
-- =============================================================================
