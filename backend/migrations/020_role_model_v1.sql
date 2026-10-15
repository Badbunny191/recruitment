-- Migration 020: Role Model v1
-- =============================================================================
-- Purpose: Lock the final role model for the recruitment system.
--
-- Final roles:
--   SUPER_ADMIN - Full access (User Mgmt, Role Mgmt, Audit, System Config)
--   ADMIN       - Recruitment Rounds, Applications, Form Builder, Master Data, Export
--   VIEWER      - Read-only (Dashboard, Applications, Reports, Audit Logs)
--
-- Legacy migrations:
--   HR_ADMIN   -> ADMIN
--   REVIEWER   -> ADMIN
--   HR_OFFICER -> ADMIN
--
-- Unknown roles (if any) are left AS-IS and must be handled manually.
-- This migration does NOT coerce unknown roles.
--
-- This migration is IDEMPOTENT — safe to run multiple times.
-- =============================================================================

-- =============================================================================
-- 1. Report state BEFORE migration
-- =============================================================================

SELECT '=== Role Migration v1: BEFORE ===' AS status;
SELECT role, COUNT(*) AS count
FROM admin_users
GROUP BY role;

-- =============================================================================
-- 2. Migrate known legacy roles to ADMIN
-- =============================================================================
-- HR_ADMIN existed in seed data; treat as ADMIN in the new model.
-- REVIEWER existed in old role model; treat as ADMIN in the new model.
-- HR_OFFICER was the schema default; treat as ADMIN in the new model.

UPDATE admin_users
SET role = 'ADMIN'
WHERE role IN ('HR_ADMIN', 'REVIEWER', 'HR_OFFICER');

-- =============================================================================
-- 3. Report state AFTER migration
-- =============================================================================

SELECT '=== Role Migration v1: AFTER ===' AS status;
SELECT role, COUNT(*) AS count
FROM admin_users
GROUP BY role;

-- =============================================================================
-- 4. Report users that were migrated
-- =============================================================================

SELECT '=== Users migrated from legacy roles ===' AS status;
SELECT id, email, role, created_at
FROM admin_users
WHERE role = 'ADMIN'
ORDER BY created_at DESC;

-- =============================================================================
-- 5. Guardrail: check SUPER_ADMIN count
-- =============================================================================
-- This is a READ-ONLY check. If no SUPER_ADMIN exists, the operator
-- must create one manually via the application or direct DB access.
-- NO automatic promotion is performed.

SELECT '=== SUPER_ADMIN count (must be >= 1) ===' AS status;
SELECT COUNT(*) AS super_admin_count
FROM admin_users
WHERE role = 'SUPER_ADMIN' AND is_active = 1;

-- =============================================================================
-- 6. Report unknown roles (if any — left AS-IS)
-- =============================================================================

SELECT '=== Unknown roles (must be 0 — investigate manually) ===' AS status;
SELECT role, COUNT(*) AS count
FROM admin_users
WHERE role NOT IN ('SUPER_ADMIN', 'ADMIN', 'VIEWER')
GROUP BY role;

-- =============================================================================
-- Notes
-- =============================================================================
-- - This migration does NOT drop the role column or change its type.
-- - Unknown roles are NOT modified — they must be investigated manually.
-- - The application layer (auth.middleware.ts + rbac.service.ts) is the
--   authoritative gate for role validation.
-- - "last SUPER_ADMIN" protection is enforced at write time in the routes
--   (see services/rbac.service.ts) — not by this migration.
