-- ============================================
-- Fix: field_master CHECK Constraint
-- 
-- วัตถุประสงค์: เพิ่ม NUMBER, CHECKBOX, DATE, MASTER_DATA
--             ลงใน CHECK constraint ของ field_master
--
-- วิธี: Safe Recreate with RENAME (ไม่ใช้ DROP)
-- หมายเหตุ: SQLite ไม่รองรับ ALTER TABLE ADD CONSTRAINT
--            จึงต้องสร้างตารางใหม่แล้วคัดลอกข้อมูล
--
-- ความเสี่ยง: ต่ำ (มี backup table __old_field_master)
--
-- การแก้ไข v5:
--   - SQLite ใช้ global index namespace → ห้ามชื่อซ้ำ
--   - DROP old indexes ก่อน CREATE new indexes
--   - ลำดับใหม่:
--     1. CREATE __new_field_master
--     2. INSERT DATA
--     3. RENAME field_master → __old_field_master
--     4. DROP INDEXES (จาก __old_field_master)
--     5. RENAME __new_field_master → field_master
--     6. CREATE INDEXES (ไม่ชนแล้ว)
--
-- อ้างอิง: Schema จริงจาก Remote D1
-- ============================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- ============================================
-- STEP 1: Drop old backup table (ถ้ามีจากครั้งก่อนที่ล้มเหลว)
-- ป้องกันปัญหา "table __old_field_master already exists"
-- ============================================
DROP TABLE IF EXISTS `__old_field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 2: สร้างตารางใหม่พร้อม CHECK constraint ที่ถูกต้อง
-- หมายเหตุ: ลำดับคอลัมน์ต้องตรงกับ schema จริง (12 columns)
-- ไม่สร้าง indexes ที่นี่ - จะสร้างหลัง RENAME เสร็จ
-- ============================================
CREATE TABLE `__new_field_master` (
    `id` text PRIMARY KEY NOT NULL,
    `field_type` text NOT NULL,
    `label_th` text NOT NULL,
    `default_options` text,
    `pdf_mapping_key` text,
    `is_active` integer DEFAULT true,
    `help_text` text,
    `placeholder` text,
    `section` text,
    `file_config` text,
    `validation_type` text,
    `validation_message` text,
    CONSTRAINT "chk_field_type" CHECK("field_type" IN (
        'TEXT',
        'TEXTAREA',
        'DROPDOWN',
        'RADIO',
        'FILE',
        'NUMBER',
        'CHECKBOX',
        'DATE',
        'MASTER_DATA'
    ))
);

--> statement-breakpoint

-- ============================================
-- STEP 3: คัดลอกข้อมูลทั้งหมดจากตารางเดิม
-- หมายเหตุ: INSERT SELECT ไม่ inherit indexes
-- ============================================
INSERT INTO `__new_field_master`(
    "id",
    "field_type",
    "label_th",
    "default_options",
    "pdf_mapping_key",
    "is_active",
    "help_text",
    "placeholder",
    "section",
    "file_config",
    "validation_type",
    "validation_message"
)
SELECT
    "id",
    "field_type",
    "label_th",
    "default_options",
    "pdf_mapping_key",
    "is_active",
    "help_text",
    "placeholder",
    "section",
    "file_config",
    "validation_type",
    "validation_message"
FROM `field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 4: เปลี่ยนชื่อตารางเดิมเป็น backup
-- สำคัญ: หลัง STEP นี้ indexes เดิมจะถูก rename ไปพร้อมกับตาราง
--         __old_field_master จะมี indexes ชื่อเดิม
-- ถ้าเกิดปัญหา → ALTER TABLE __old_field_master RENAME TO field_master
-- ============================================
ALTER TABLE `field_master` RENAME TO `__old_field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 5: DROP indexes เก่าจาก __old_field_master
-- หมายเหตุ: SQLite global index namespace
--           ต้องลบ indexes เก่าก่อนสร้างใหม่บน field_master
-- ป้องกัน: "index already exists"
-- 
-- Indexes ที่ต้อง DROP:
--   - idx_field_master_section
--   - idx_field_master_type
--   - idx_field_master_validation_type
-- ============================================
DROP INDEX IF EXISTS `idx_field_master_section`;
DROP INDEX IF EXISTS `idx_field_master_type`;
DROP INDEX IF EXISTS `idx_field_master_validation_type`;

--> statement-breakpoint

-- ============================================
-- STEP 6: เปลี่ยนชื่อตารางใหม่เป็นชื่อจริง
-- ตอนนี้ __old_field_master ไม่มี indexes แล้ว
--       และ field_master (ใหม่) ยังไม่มี indexes
-- ============================================
ALTER TABLE `__new_field_master` RENAME TO `field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 7: สร้าง Indexes ใหม่บน field_master
-- หมายเหตุ: ตอนนี้ไม่มี index ชื่อเดิมอยู่แล้ว
--           ไม่ต้องใช้ IF NOT EXISTS
-- 
-- Indexes ที่ต้องสร้าง (จาก schema จริง):
--   - idx_field_master_section (section)
--   - idx_field_master_type (field_type)
--   - idx_field_master_validation_type (validation_type)
-- หมายเหตุ: PRIMARY KEY (id) สร้าง index อัตโนมัติชื่อ sqlite_autoindex_*
-- ============================================
CREATE INDEX `idx_field_master_section` ON `field_master`(`section`);
CREATE INDEX `idx_field_master_type` ON `field_master`(`field_type`);
CREATE INDEX `idx_field_master_validation_type` ON `field_master`(`validation_type`);

--> statement-breakpoint

-- ============================================
-- STEP 8: คืนค่า foreign keys
-- ============================================
PRAGMA foreign_keys=ON;
