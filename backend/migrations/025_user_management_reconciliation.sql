-- Migration 025: User Management Reconciliation (Index Only)
-- =============================================================================
-- Purpose: Create index for RBAC lookups without modifying user data
--
-- This migration:
--   1. Creates idx_admin_users_role_active index (idempotent)
--   2. Reports current state for verification
--
-- NOTE: Does NOT backfill password_changed_at
--       NULL values are preserved to indicate "never changed password"
-- =============================================================================

-- =============================================================================
-- 1. Index for lookups by role + active (used by RBAC guards)
-- =============================================================================
-- This index is idempotent via IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_admin_users_role_active
  ON admin_users(role, is_active);

--> statement-breakpoint

-- =============================================================================
-- 2. Report current state
-- =============================================================================

SELECT '=== Index created: idx_admin_users_role_active ===' AS status;

SELECT '=== admin_users columns ===' AS status;
PRAGMA table_info(admin_users);

SELECT '=== User counts by role + active ===' AS status;
SELECT role, is_active, COUNT(*) AS count
FROM admin_users
GROUP BY role, is_active
ORDER BY role, is_active;

SELECT '=== Users with NULL password_changed_at (never changed password) ===' AS status;
SELECT COUNT(*) AS users_never_changed_password
FROM admin_users
WHERE password_changed_at IS NULL;
