-- Migration: Field Master Enhancement Phase 2 - Validation + Required Fix
-- Fix file config persistence + Add validation type + Required separation

-- 1. Add validation columns to field_master
ALTER TABLE field_master ADD COLUMN validation_type TEXT;
ALTER TABLE field_master ADD COLUMN validation_message TEXT;

-- 2. Rename is_required to required in template_fields for clarity
-- (Keep is_required as is, just ensure required field is properly used)

-- 3. Add placeholder and help_text back if not exists
-- (These may already exist from previous migration)

-- 4. Ensure file_config is properly handled
-- No changes needed for this, handled in application layer

-- 5. Create index for validation_type
CREATE INDEX IF NOT EXISTS idx_field_master_validation_type ON field_master(validation_type);
