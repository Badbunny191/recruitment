-- Migration 021: User Management Schema (Reconciliation)
-- =============================================================================
-- Purpose: Reconciliation with 020_auth_hardening.sql
--
-- REVISION HISTORY:
-- - Original version (removed): Added duplicate columns that already existed
--   in 020_auth_hardening.sql, causing "duplicate column name" errors.
-- - This version: Retains ONLY additive components unique to this migration.
--
-- COLUMNS ALREADY CREATED BY 020_auth_hardening.sql:
--   - is_active
--   - must_change_password
--   - password_changed_at
--   - failed_login_attempts
--   - locked_until
--   - password_migrated
--
-- TABLES ALREADY CREATED BY 020_auth_hardening.sql:
--   - login_attempts
--   - password_reset_tokens
--
-- UNIQUE COMPONENTS IN THIS MIGRATION:
--   1. Backfill password_changed_at for existing users
--   2. Create idx_admin_users_role_active index
--   3. Report final state
-- =============================================================================

-- =============================================================================
-- 1. Backfill password_changed_at to created_at when missing
-- =============================================================================
-- This keeps the "last changed" indicator sensible for pre-existing users.
-- Safe to re-run: UPDATE is a no-op when no rows have NULL password_changed_at.

UPDATE admin_users
SET password_changed_at = CAST(created_at AS INTEGER)
WHERE password_changed_at IS NULL;

-- =============================================================================
-- 2. Index for lookups by role + active (used by RBAC guards)
-- =============================================================================
-- This index is idempotent via IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_admin_users_role_active
  ON admin_users(role, is_active);

-- =============================================================================
-- 3. Report final state
-- =============================================================================

SELECT '=== admin_users columns after migration 021 ===' AS status;
PRAGMA table_info(admin_users);

SELECT '=== User counts by role + active ===' AS status;
SELECT role, is_active, COUNT(*) AS count
FROM admin_users
GROUP BY role, is_active
ORDER BY role, is_active;
