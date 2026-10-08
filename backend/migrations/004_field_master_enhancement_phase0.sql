-- Migration: Add Field Master enhancements
-- Phase 0 Bug Fixes - 2026-10-08

-- 1. Add new columns to field_master
ALTER TABLE `field_master` ADD COLUMN `help_text` text;
ALTER TABLE `field_master` ADD COLUMN `placeholder` text;
ALTER TABLE `field_master` ADD COLUMN `section` text;
ALTER TABLE `field_master` ADD COLUMN `file_config` text;
ALTER TABLE `field_master` ADD COLUMN `validation_type` text;
ALTER TABLE `field_master` ADD COLUMN `validation_message` text;

-- 2. Add new columns to template_fields
ALTER TABLE `template_fields` ADD COLUMN `help_text` text;
ALTER TABLE `template_fields` ADD COLUMN `placeholder` text;
ALTER TABLE `template_fields` ADD COLUMN `validation_rules` text;

-- 3. Update check constraint for field types (if SQLite supports it)
-- Note: SQLite doesn't support altering check constraints directly
-- The application will handle validation
