-- =============================================================================
-- Test Script: Archive / Restore / Permanent Delete
-- Simulates all 4 test cases against local D1
-- =============================================================================

-- Insert test fixtures
INSERT INTO applications (id, application_no, round_id, email, fullname, national_id, status, form_data, submitted_at, deleted_at)
VALUES ('app-test-001', 'APP-TEST-001', 'round-001', 'test@example.com', 'ทดสอบ ผู้สมัคร', '1234567890123', 'SUBMITTED', '{}', unixepoch(), NULL);

SELECT '=== TEST 1: Round WITHOUT applications (round-test-001) ===' AS '';
SELECT '-- Archive' AS step;
UPDATE recruitment_rounds SET deleted_at = unixepoch() WHERE id = 'round-test-001';
SELECT id, title, deleted_at IS NOT NULL AS is_archived FROM recruitment_rounds WHERE id = 'round-test-001';

SELECT '-- Restore' AS step;
UPDATE recruitment_rounds SET deleted_at = NULL WHERE id = 'round-test-001';
SELECT id, title, deleted_at IS NOT NULL AS is_archived FROM recruitment_rounds WHERE id = 'round-test-001';

SELECT '-- Delete (no apps → allowed)' AS step;
DELETE FROM recruitment_rounds WHERE id = 'round-test-001' AND NOT EXISTS (SELECT 1 FROM applications WHERE round_id = 'round-test-001' AND deleted_at IS NULL);
SELECT '-- After delete' AS step;
SELECT COUNT(*) AS still_exists FROM recruitment_rounds WHERE id = 'round-test-001';

SELECT '' AS '';
SELECT '=== TEST 2: Round WITH applications (round-001) ===' AS '';
SELECT '-- Archive (with apps → allowed)' AS step;
UPDATE recruitment_rounds SET deleted_at = unixepoch() WHERE id = 'round-001';
SELECT id, title, deleted_at IS NOT NULL AS is_archived FROM recruitment_rounds WHERE id = 'round-001';

SELECT '-- Verify apps still exist' AS step;
SELECT COUNT(*) AS app_count FROM applications WHERE round_id = 'round-001' AND deleted_at IS NULL;

SELECT '-- Restore' AS step;
UPDATE recruitment_rounds SET deleted_at = NULL WHERE id = 'round-001';
SELECT id, title, deleted_at IS NOT NULL AS is_archived FROM recruitment_rounds WHERE id = 'round-001';

SELECT '-- Delete (has apps → BLOCKED, would return 409)' AS step;
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM applications WHERE round_id = 'round-001' AND deleted_at IS NULL)
    THEN 'BLOCKED: 409 Conflict - Round contains applications'
    ELSE 'ALLOWED'
  END AS delete_check;

SELECT '' AS '';
SELECT '=== TEST 3: Template WITHOUT rounds (tpl-md-test) ===' AS '';
SELECT '-- Check round count' AS step;
SELECT COUNT(*) AS round_count
FROM recruitment_rounds r
JOIN template_versions v ON r.template_version_id = v.id
WHERE v.template_id = 'tpl-md-test';

SELECT '-- Archive' AS step;
UPDATE templates SET deleted_at = unixepoch() WHERE id = 'tpl-md-test';
SELECT id, name, deleted_at IS NOT NULL AS is_archived FROM templates WHERE id = 'tpl-md-test';

SELECT '-- Restore' AS step;
UPDATE templates SET deleted_at = NULL WHERE id = 'tpl-md-test';

SELECT '-- Delete (no rounds → allowed at API level; but FK restrict from versions may apply)' AS step;
SELECT 'Check if any version exists for this template' AS info;
SELECT id FROM template_versions WHERE template_id = 'tpl-md-test';
-- Note: template_versions has FK ON DELETE restrict → so we cannot hard delete template that has versions
-- The 409 path only checks rounds; in this codebase template delete via API is also blocked by FK
SELECT 'Status: API would allow (no rounds), but DB FK restrict from template_versions applies' AS info;

SELECT '' AS '';
SELECT '=== TEST 4: Template WITH rounds (tpl-general-001) ===' AS '';
SELECT '-- Check round count' AS step;
SELECT COUNT(*) AS round_count
FROM recruitment_rounds r
JOIN template_versions v ON r.template_version_id = v.id
WHERE v.template_id = 'tpl-general-001';

SELECT '-- Archive (with rounds → allowed)' AS step;
UPDATE templates SET deleted_at = unixepoch() WHERE id = 'tpl-general-001';
SELECT id, name, deleted_at IS NOT NULL AS is_archived FROM templates WHERE id = 'tpl-general-001';

SELECT '-- Verify rounds still exist' AS step;
SELECT COUNT(*) AS round_count FROM recruitment_rounds
WHERE template_version_id IN (SELECT id FROM template_versions WHERE template_id = 'tpl-general-001');

SELECT '-- Restore' AS step;
UPDATE templates SET deleted_at = NULL WHERE id = 'tpl-general-001';

SELECT '-- Delete (has rounds → BLOCKED, would return 409)' AS step;
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM recruitment_rounds r
      JOIN template_versions v ON r.template_version_id = v.id
      WHERE v.template_id = 'tpl-general-001'
    )
    THEN 'BLOCKED: 409 Conflict - Template is referenced by recruitment rounds'
    ELSE 'ALLOWED'
  END AS delete_check;

SELECT '' AS '';
SELECT '=== FINAL STATE ===' AS '';
SELECT 'TEMPLATES' AS '', COUNT(*) AS total, COUNT(deleted_at) AS archived FROM templates;
SELECT 'ROUNDS' AS '', COUNT(*) AS total, COUNT(deleted_at) AS archived FROM recruitment_rounds;
SELECT 'APPLICATIONS' AS '', COUNT(*) AS total, COUNT(deleted_at) AS archived FROM applications;
