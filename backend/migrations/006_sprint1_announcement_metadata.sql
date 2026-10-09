-- Migration: Sprint 1 - Announcement Fields + Rich Field Metadata
-- 1. เพิ่ม announcement fields ใน recruitment_rounds
-- 2. เพิ่ม rich metadata fields ใน template_fields (rows, min_length, max_length)

-- =============================================================================
-- 1. Announcement Fields - สำหรับ Form Header/Announcement
-- =============================================================================
ALTER TABLE recruitment_rounds ADD COLUMN announcement_title TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN announcement_description TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN contact_information TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN remark TEXT;

-- =============================================================================
-- 2. Rich Field Metadata - สำหรับ template_fields
-- =============================================================================
ALTER TABLE template_fields ADD COLUMN rows INTEGER;
ALTER TABLE template_fields ADD COLUMN min_length INTEGER;
ALTER TABLE template_fields ADD COLUMN max_length INTEGER;
