-- Migration: Sprint 4 - Template Sections
-- 1. New table: template_sections (Section เป็น Per-Version)
-- 2. Add column: template_fields.section_id (nullable FK)
-- 3. Data migration: create default section "ข้อมูลทั่วไป" for every existing version
--    ใช้ UUID แบบสุ่ม (randomblob + hex) ตามมาตรฐานระบบ (ห้าม deterministic id)
-- 4. Assign all existing fields to default section
-- 5. Indexes for performance

-- =============================================================================
-- 1. New table: template_sections
-- =============================================================================
CREATE TABLE IF NOT EXISTS `template_sections` (
  `id` text PRIMARY KEY NOT NULL,
  `template_version_id` text NOT NULL,
  `name` text NOT NULL,
  `display_order` integer NOT NULL,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch()),
  FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON DELETE CASCADE
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_tpl_sections_version` ON `template_sections`(`template_version_id`);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `unq_tpl_sections_version_order` ON `template_sections`(`template_version_id`, `display_order`);

--> statement-breakpoint

-- =============================================================================
-- 2. Add column: template_fields.section_id
-- =============================================================================
ALTER TABLE `template_fields` ADD COLUMN `section_id` text REFERENCES `template_sections`(`id`) ON DELETE SET NULL;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_tpl_fields_section` ON `template_fields`(`section_id`);

--> statement-breakpoint

-- =============================================================================
-- 3. Data migration: create default section "ข้อมูลทั่วไป" with random UUID for every version
-- ทุก version เดิมจะมี 1 section "ข้อมูลทั่วไป" (display_order=1)
-- UUID generation: lower(hex(randomblob(4))) || '-' || ... (32 hex chars + 4 dashes)
-- =============================================================================
INSERT INTO `template_sections` (`id`, `template_version_id`, `name`, `display_order`, `is_active`)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  tv.id,
  'ข้อมูลทั่วไป',
  1,
  1
FROM `template_versions` tv
WHERE NOT EXISTS (
  SELECT 1 FROM `template_sections` ts
  WHERE ts.template_version_id = tv.id
);

--> statement-breakpoint

-- =============================================================================
-- 4. Assign all existing fields to default section (by name)
-- =============================================================================
UPDATE `template_fields`
SET `section_id` = (
  SELECT ts.id
  FROM `template_sections` ts
  WHERE ts.template_version_id = template_fields.template_version_id
    AND ts.name = 'ข้อมูลทั่วไป'
  LIMIT 1
)
WHERE `section_id` IS NULL;
