-- Migration: Field Master Enhancement Phase 1
-- Add new field types and enhanced configuration

-- 1. Update field_master table - Add new columns
ALTER TABLE field_master ADD COLUMN help_text TEXT;
ALTER TABLE field_master ADD COLUMN placeholder TEXT;
ALTER TABLE field_master ADD COLUMN section TEXT;
ALTER TABLE field_master ADD COLUMN file_config TEXT; -- JSON: {allowedFileTypes, maxFiles, maxSizeMB}

-- 2. Update check constraint to allow new field types
-- Note: SQLite doesn't support ALTER CONSTRAINT, so we need to recreate table
-- For now, we'll handle this in application layer

-- 3. Update template_fields table - Add validation rules
ALTER TABLE template_fields ADD COLUMN validation_rules TEXT; -- JSON: {minLength, maxLength, pattern, min, max}
ALTER TABLE template_fields ADD COLUMN help_text TEXT;
ALTER TABLE template_fields ADD COLUMN placeholder TEXT;

-- 4. Update application_attachments table
ALTER TABLE application_attachments ADD COLUMN file_type TEXT;
ALTER TABLE application_attachments ADD COLUMN file_size INTEGER;

-- 5. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_field_master_section ON field_master(section);
CREATE INDEX IF NOT EXISTS idx_field_master_type ON field_master(field_type);
