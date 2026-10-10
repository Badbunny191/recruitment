-- ============================================
-- Cleanup: ลบตาราง Backup
-- 
-- รันหลังจากยืนยันว่า fix ทำงานได้ 100%
-- หมายเหตุ: รันหลัง verify_constraint.sql ผ่านแล้วเท่านั้น
-- ============================================

-- ============================================
-- 1. ตรวจสอบว่ามี backup table หรือไม่ก่อนลบ
-- ============================================
SELECT '=== Check before cleanup ===' as status;
SELECT name FROM sqlite_master 
WHERE type='table' AND name LIKE '%old%';

--> statement-breakpoint

-- ============================================
-- 2. ลบตาราง backup
-- หมายเหตุ: ใช้ IF EXISTS เพื่อป้องกัน error ถ้าไม่มี
-- ============================================
DROP TABLE IF EXISTS `__old_field_master`;

--> statement-breakpoint

-- ============================================
-- 3. ตรวจสอบว่าลบสำเร็จ
-- ============================================
SELECT '=== Verify cleanup ===' as status;
SELECT name FROM sqlite_master 
WHERE type='table' AND name LIKE '%old%';
-- คาดหวัง: ไม่มี rows (backup ถูกลบแล้ว)

--> statement-breakpoint

-- ============================================
-- 4. ยืนยัน schema ยังถูกต้อง
-- ============================================
SELECT '=== Final schema check ===' as status;
SELECT sql FROM sqlite_master WHERE name = 'field_master';
