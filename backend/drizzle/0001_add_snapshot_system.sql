-- Migration: Add template snapshot system
-- Current + Draft template workflow with immutable round snapshots
-- Created: 2026-10-08

-- 1. Update templateVersions status: PUBLISHED -> CURRENT
UPDATE `template_versions` SET `status` = 'CURRENT' WHERE `status` = 'PUBLISHED';

-- 2. Add status column to templates table
ALTER TABLE `templates` ADD COLUMN `status` text DEFAULT 'ACTIVE';
CREATE INDEX IF NOT EXISTS `idx_templates_status` ON `templates`(`status`);

-- 3. Update templates check constraint
-- Note: SQLite doesn't support altering check constraints, so we create a new table if needed
-- For now, the status will be validated at application level

-- 4. Add new columns to recruitment_rounds
ALTER TABLE `recruitment_rounds` ADD COLUMN `template_id` text REFERENCES `templates`(`id`) ON DELETE RESTRICT;
ALTER TABLE `recruitment_rounds` ADD COLUMN `snapshot_version_id` text;
ALTER TABLE `recruitment_rounds` ADD COLUMN `snapshot_data` text NOT NULL DEFAULT '[]';

-- 5. Create index for faster snapshot lookups
CREATE INDEX IF NOT EXISTS `idx_rounds_template` ON `recruitment_rounds`(`template_id`);

-- 6. Migrate existing data (if any rounds exist with templateVersionId)
-- This will populate template_id from the templateVersions table
-- Note: This is a one-time migration step, run manually if needed
