-- ============================================
-- Rollback for Migration 015: Fix template_fields FK Target
--
-- ใช้เมื่อ: Migration 015 ล้มเหลว หรือต้องการย้อนกลับ
--
-- ขั้นตอน:
--   1. PRAGMA foreign_keys=OFF
--   2. DROP table ใหม่ (template_fields ที่ FK ผิด)
--   3. RENAME __old_template_fields → template_fields
--   4. RENAME FK back ไม่ได้ (FK ใน __old_template_fields ยังชี้ __old_field_master)
--      แต่ระบบจะกลับไปสถานะเดิม (มี __old_field_master อยู่)
--   5. PRAGMA foreign_keys=ON
-- ============================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- DROP table ใหม่
DROP TABLE IF EXISTS `template_fields`;

--> statement-breakpoint

-- RENAME backup กลับ
ALTER TABLE `__old_template_fields` RENAME TO `template_fields`;

--> statement-breakpoint

-- Recreate indexes (กลับสภาพเดิม)
CREATE INDEX IF NOT EXISTS `idx_tpl_fields_version` ON `template_fields`(`template_version_id`);
CREATE INDEX IF NOT EXISTS `idx_tpl_fields_section` ON `template_fields`(`section_id`);

--> statement-breakpoint

PRAGMA foreign_keys=ON;
