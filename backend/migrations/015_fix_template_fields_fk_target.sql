-- ============================================
-- Migration 015: Fix template_fields FK Target
--
-- ปัญหา (Root Cause):
--   template_fields.field_id มี FK ชี้ไปยัง __old_field_master(id)
--   ซึ่งเป็น legacy backup table จาก migration 014 (fix_field_master_constraint.sql)
--   เมื่อ RENAME field_master → __old_field_master แล้วสร้าง field_master ใหม่
--   SQLite RENAME พา FK constraint ตามไปด้วย
--   แต่ migration 014 ลืม DROP FK เก่าแล้ว CREATE FK ใหม่ชี้ field_master
--
-- ผลกระทบ:
--   - Field ใหม่ที่สร้างหลัง migration (UUID-based) ไม่สามารถ INSERT
--     ลง template_fields ได้ (FK fail)
--   - เช่น field "ตำแหน่งปัจจุบัน" (id: e8307a4b-541b-4a3d-9d47-47280af1f18d)
--     มีอยู่ใน field_master แต่ไม่อยู่ใน __old_field_master
--
-- เป้าหมาย:
--   Repoint template_fields.field_id FK จาก __old_field_master → field_master
--   โดยไม่สูญเสียข้อมูล
--
-- วิธี:
--   1. PRAGMA foreign_keys=OFF
--   2. Backup ข้อมูล (INSERT SELECT)
--   3. สร้าง table ใหม่ (__new_template_fields) พร้อม FK ที่ถูกต้อง
--   4. INSERT SELECT ข้อมูลเดิม
--   5. DROP table เดิม
--   6. RENAME __new_template_fields → template_fields
--   7. CREATE indexes (เหมือนเดิม)
--   8. PRAGMA foreign_keys=ON
--   9. ตรวจ foreign_key_check (ต้องไม่มี error)
--
-- ความเสี่ยง: ต่ำ
--   - INSERT SELECT ก่อน DROP (ไม่สูญเสียข้อมูล)
--   - FK integrity check หลัง migration
--   - มี backup table (__old_template_fields) หากต้องการ rollback
--
-- ข้อมูล:
--   - template_fields: 24 rows, 2 indexes
--   - FK targets ทั้ง 3 (template_versions, template_sections, field_master)
--   - field_master: 13 rows (10 slug + 2 UUID เดิม + 1 UUID ใหม่)
--   - __old_field_master: 12 rows (subset ของ field_master)
-- ============================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- ============================================
-- STEP 1: ลบ backup table เก่า (ถ้ามี)
-- ============================================
DROP TABLE IF EXISTS `__old_template_fields`;

--> statement-breakpoint

-- ============================================
-- STEP 2: สร้าง table ใหม่พร้อม FK ที่ถูกต้อง
--
-- หมายเหตุ:
--   - ลำดับ column ตรงกับ schema เดิม
--   - FK 3 ตัว:
--     * template_version_id → template_versions(id) ON DELETE CASCADE
--     * field_id → field_master(id) ON DELETE RESTRICT  ← เปลี่ยนจาก __old_field_master
--     * section_id → template_sections(id) ON DELETE SET NULL
-- ============================================
CREATE TABLE `__new_template_fields` (
    `id` text PRIMARY KEY NOT NULL,
    `template_version_id` text NOT NULL,
    `field_id` text NOT NULL,
    `display_order` integer NOT NULL,
    `is_required` integer DEFAULT true,
    `override_options` text,
    `override_label_th` text,
    `validation_rules` text,
    `help_text` text,
    `placeholder` text,
    `rows` integer,
    `min_length` integer,
    `max_length` integer,
    `section_id` text,
    FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
    FOREIGN KEY (`field_id`) REFERENCES `field_master`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
    FOREIGN KEY (`section_id`) REFERENCES `template_sections`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL
);

--> statement-breakpoint

-- ============================================
-- STEP 3: คัดลอกข้อมูลทั้งหมดจาก table เดิม
-- ============================================
INSERT INTO `__new_template_fields`(
    "id",
    "template_version_id",
    "field_id",
    "display_order",
    "is_required",
    "override_options",
    "override_label_th",
    "validation_rules",
    "help_text",
    "placeholder",
    "rows",
    "min_length",
    "max_length",
    "section_id"
)
SELECT
    "id",
    "template_version_id",
    "field_id",
    "display_order",
    "is_required",
    "override_options",
    "override_label_th",
    "validation_rules",
    "help_text",
    "placeholder",
    "rows",
    "min_length",
    "max_length",
    "section_id"
FROM `template_fields`;

--> statement-breakpoint

-- ============================================
-- STEP 4: RENAME table เดิมเป็น backup
-- (rollback ได้: ALTER TABLE __old_template_fields RENAME TO template_fields)
-- ============================================
ALTER TABLE `template_fields` RENAME TO `__old_template_fields`;

--> statement-breakpoint

-- ============================================
-- STEP 5: DROP indexes เก่า (ถ้าติดมา)
-- SQLite global index namespace - ต้องลบก่อนสร้างใหม่
-- ============================================
DROP INDEX IF EXISTS `idx_tpl_fields_version`;
DROP INDEX IF EXISTS `idx_tpl_fields_section`;

--> statement-breakpoint

-- ============================================
-- STEP 6: RENAME table ใหม่เป็นชื่อจริง
-- ============================================
ALTER TABLE `__new_template_fields` RENAME TO `template_fields`;

--> statement-breakpoint

-- ============================================
-- STEP 7: สร้าง indexes เหมือนเดิม
-- (ตรงกับ Drizzle schema: idx_tpl_fields_version, idx_tpl_fields_section)
-- ============================================
CREATE INDEX `idx_tpl_fields_version` ON `template_fields`(`template_version_id`);
CREATE INDEX `idx_tpl_fields_section` ON `template_fields`(`section_id`);

--> statement-breakpoint

-- ============================================
-- STEP 8: เปิด foreign keys กลับ
-- ============================================
PRAGMA foreign_keys=ON;

--> statement-breakpoint

-- ============================================
-- STEP 9: ตรวจสอบ FK integrity (ต้องไม่มี error)
-- ถ้า error → หมายความว่ามี row ที่ field_id ไม่ตรงกับ field_master.id
-- ในกรณีนั้น: ตรวจ SELECT field_id, COUNT(*) FROM template_fields
--            WHERE field_id NOT IN (SELECT id FROM field_master)
-- ============================================
-- (foreign_key_check จะถูก run แยกหลัง migration เสร็จ)
