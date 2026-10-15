-- Migration 021: User Management Schema (additive)
-- =============================================================================
-- Purpose: Extend admin_users with the columns required by the User Management
-- UI (frontend/src/types/user.ts) and the /admin/users* endpoints:
--   - is_active                : bool (default 1, existing rows backfilled)
--   - must_change_password     : bool (default 0)
--   - password_changed_at      : integer unix seconds
--   - failed_login_attempts    : integer (default 0)
--   - locked_until             : integer unix seconds, nullable
--   - password_migrated        : bool (default 0)
--
-- ASSUMPTIONS / NON-IDEMPOTENCY WARNING
-- -------------------------------------
-- This migration is NOT idempotent. SQLite's `ALTER TABLE ADD COLUMN` does
-- not support `IF NOT EXISTS`, so re-running this script against a database
-- that already has any of these columns will fail with
-- "duplicate column name: <col>".
--
-- Operative assumptions for this migration:
--   1. It must run exactly once per database. The migration runner
--      (wrangler d1 migrations apply) tracks applied migrations and will
--      not re-apply it on a clean deploy.
--   2. If the columns already exist for any reason (e.g. partial prior
--      run, manual schema edit, or running against a pre-seeded DB), the
--      operator must drop the offending columns (or the table) and rerun
--      the migration fresh. There is no safe guard inside this script.
--   3. The CREATE INDEX step (`idx_admin_users_role_active`) IS idempotent
--      via `IF NOT EXISTS` — that part of the script can be re-run safely
--      on its own.
--   4. The UPDATE / SELECT / PRAGMA steps are read-only or one-shot
--      backfills and are safe to re-run (UPDATE is a no-op when no rows
--      have NULL password_changed_at).
--
-- If you need a re-runnable variant, wrap each ADD COLUMN in a
-- `SELECT CASE WHEN NOT EXISTS (...) THEN ... END` check using a
-- separate script (see docs/migrations for the procedural helper).
-- =============================================================================

-- =============================================================================
-- 1. Add columns
-- =============================================================================
-- NOTE: SQLite does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- Each ADD COLUMN below will fail if the column already exists in the target
-- database. The migration runner must guarantee this migration runs at most
-- once. See the header for the full list of assumptions.

-- is_active
-- (The Drizzle schema in db/schema.ts also declares `is_active` on
-- admin_users. SQLite tolerates the column being present before DDL
-- runs; this ADD COLUMN is here as a defensive backfill for databases
-- where the schema file was applied but the column was somehow missing.)
ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- must_change_password
ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- password_changed_at (nullable; existing rows will be backfilled below)
ALTER TABLE admin_users ADD COLUMN password_changed_at INTEGER;

-- failed_login_attempts
ALTER TABLE admin_users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;

-- locked_until (nullable)
ALTER TABLE admin_users ADD COLUMN locked_until INTEGER;

-- password_migrated
-- (true means the password has been moved to bcrypt / stronger hashing
-- than the current plaintext fallback used by /admin/auth/login.)
ALTER TABLE admin_users ADD COLUMN password_migrated INTEGER NOT NULL DEFAULT 0;

-- =============================================================================
-- 2. Backfill password_changed_at to created_at when missing
-- =============================================================================
-- This keeps the "last changed" indicator sensible for pre-existing users.

UPDATE admin_users
SET password_changed_at = CAST(created_at AS INTEGER)
WHERE password_changed_at IS NULL;

-- =============================================================================
-- 3. Index for lookups by role + active (used by RBAC guards)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_admin_users_role_active
  ON admin_users(role, is_active);

-- =============================================================================
-- 4. Report final state
-- =============================================================================
SELECT '=== admin_users columns after migration 021 ===' AS status;
PRAGMA table_info(admin_users);

SELECT '=== User counts by role + active ===' AS status;
SELECT role, is_active, COUNT(*) AS count
FROM admin_users
GROUP BY role, is_active
ORDER BY role, is_active;
