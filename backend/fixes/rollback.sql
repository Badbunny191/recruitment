-- ============================================
-- Rollback: กู้คืนไปใช้ตารางเดิม
-- 
-- รันเฉพาะเมื่อ fix มีปัญหา
-- วิธีการ: Rename ไม่ใช่ Drop
--
-- หลักการ:
--   field_master (ล้มเหลว) -> __failed_field_master
--   __old_field_master (เดิม) -> field_master
--
-- หมายเหตุ: ไม่ DROP ตาราง production โดยตรง
-- ============================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- ============================================
-- STEP 1: ตรวจสอบว่ามี backup table หรือไม่
-- ============================================
SELECT '=== Check backup table ===' as status;
SELECT name FROM sqlite_master 
WHERE type='table' AND name='__old_field_master';

--> statement-breakpoint

-- ============================================
-- STEP 2: เปลี่ยนชื่อ production table ที่มีปัญหาเป็น failed
-- หมายเหตุ: ไม่ DROP เพื่อเก็บข้อมูลไว้สำหรับ investigate
-- ============================================
ALTER TABLE `field_master` RENAME TO `__failed_field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 3: กู้คืนตารางเดิมจาก backup
-- ============================================
ALTER TABLE `__old_field_master` RENAME TO `field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 4: คืนค่า foreign keys
-- ============================================
PRAGMA foreign_keys=ON;

--> statement-breakpoint

-- ============================================
-- STEP 5: ตรวจสอบว่า rollback สำเร็จ
-- ============================================
SELECT '=== Verify rollback ===' as status;
SELECT sql FROM sqlite_master WHERE name = 'field_master';
SELECT COUNT(*) as row_count FROM field_master;

--> statement-breakpoint

-- ============================================
-- STEP 6: แสดงรายละเอียดของ failed table (สำหรับ investigate)
-- ============================================
SELECT '=== Failed table info ===' as status;
SELECT name, sql FROM sqlite_master 
WHERE type='table' AND name='__failed_field_master';
SELECT COUNT(*) as failed_row_count FROM `__failed_field_master`;

--> statement-breakpoint

-- ============================================
-- หมายเหตุสำหรับ manual cleanup:
-- หลังจากยืนยันว่า rollback สำเร็จแล้ว สามารถลบ failed table ได้ด้วย:
--   DROP TABLE IF EXISTS `__failed_field_master`;
-- แต่แนะนำให้เก็บไว้สักพักเพื่อ investigate ปัญหา
-- ============================================
