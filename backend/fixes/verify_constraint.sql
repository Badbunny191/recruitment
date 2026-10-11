-- ============================================
-- Verify: ตรวจสอบว่า Fix สำเร็จ
-- 
-- รันหลังจาก fix_field_master_constraint.sql
-- คาดหวัง: ทุก assertion ผ่าน
-- 
-- หมายเหตุ: ใช้ test IDs ที่ unique เพื่อหลีกเลี่ยง conflict
-- รูปแบบ: __verify_{type}_{timestamp}_{random}
-- ============================================

-- สร้าง unique prefix จาก timestamp
-- ตัวอย่าง: __vrfy_md_20261010_001
-- ============================================

-- ============================================
-- 1. ดู Schema ใหม่
-- คาดหวัง: CHECK มี 9 values (รวม MASTER_DATA)
-- ============================================
SELECT '=== Schema ===' as check_name;
SELECT sql FROM sqlite_master WHERE name = 'field_master';

--> statement-breakpoint

-- ============================================
-- 2. ตรวจสอบว่าข้อมูลครบ
-- คาดหวัง: 12 rows (จาก audit)
-- ============================================
SELECT '=== Row Count ===' as check_name;
SELECT COUNT(*) as total_rows FROM field_master;

--> statement-breakpoint

-- ============================================
-- 3. ตรวจสอบ Indexes ครบ
-- คาดหวัง: 4 indexes (รวม PRIMARY KEY)
-- ============================================
SELECT '=== Indexes ===' as check_name;
SELECT name FROM sqlite_master 
WHERE type='index' AND tbl_name='field_master'
ORDER BY name;

--> statement-breakpoint

-- ============================================
-- 4. ตรวจสอบว่าไม่มี field_type ที่ผิดกฎ
-- คาดหวัง: ทุก row ผ่าน (ไม่มี row ที่ field_type ไม่อยู่ใน list)
-- ============================================
SELECT '=== Valid field_types ===' as check_name;
SELECT field_type, COUNT(*) as count 
FROM field_master 
WHERE field_type NOT IN (
    'TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE',
    'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA'
)
GROUP BY field_type;
-- ถ้าไม่มี rows แสดงว่าทุก field_type ถูกต้อง

--> statement-breakpoint

-- ============================================
-- 5. ทดสอบ INSERT MASTER_DATA
-- คาดหวัง: SUCCESS (ไม่ใช่ ABORT)
-- หมายเหตุ: ใช้ random suffix เพื่อหลีกเลี่ยง conflict
-- ============================================
SELECT '=== Test INSERT MASTER_DATA ===' as check_name;
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__vrfy_md_a1b2c3', 'MASTER_DATA', 'ทดสอบ MASTER_DATA');
SELECT 'MASTER_DATA: SUCCESS' as result;

--> statement-breakpoint

-- ============================================
-- 6. ทดสอบ INSERT NUMBER
-- คาดหวัง: SUCCESS
-- ============================================
SELECT '=== Test INSERT NUMBER ===' as check_name;
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__vrfy_num_d4e5f6', 'NUMBER', 'ทดสอบ NUMBER');
SELECT 'NUMBER: SUCCESS' as result;

--> statement-breakpoint

-- ============================================
-- 7. ทดสอบ INSERT CHECKBOX
-- คาดหวัง: SUCCESS
-- ============================================
SELECT '=== Test INSERT CHECKBOX ===' as check_name;
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__vrfy_cb_g7h8i9', 'CHECKBOX', 'ทดสอบ CHECKBOX');
SELECT 'CHECKBOX: SUCCESS' as result;

--> statement-breakpoint

-- ============================================
-- 8. ทดสอบ INSERT DATE
-- คาดหวัง: SUCCESS
-- ============================================
SELECT '=== Test INSERT DATE ===' as check_name;
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__vrfy_dt_j1k2l3', 'DATE', 'ทดสอบ DATE');
SELECT 'DATE: SUCCESS' as result;

--> statement-breakpoint

-- ============================================
-- 9. ทดสอบ INSERT ค่าผิด (should FAIL)
-- คาดหวัง: ABORT - เพื่อยืนยันว่า CHECK constraint ทำงาน
-- หมายเหตุ: uncomment บรรทัดด้านล่างเพื่อทดสอบ
-- ============================================
-- SELECT '=== Test INSERT INVALID (should FAIL) ===' as check_name;
-- INSERT INTO field_master (id, field_type, label_th)
-- VALUES ('__test_inv_001', 'INVALID_TYPE', 'ทดสอบค่าผิด');
-- ถ้ารันได้ → CHECK constraint ไม่ทำงาน!
-- ถ้า ABORT → CHECK constraint ทำงานถูกต้อง

-- ============================================
-- 10. Cleanup test rows
-- ============================================
SELECT '=== Cleanup Test Rows ===' as check_name;
DELETE FROM field_master WHERE id LIKE '__vrfy_%';
SELECT 'Cleanup: SUCCESS' as result;

--> statement-breakpoint

-- ============================================
-- 11. ดู field_types ทั้งหมดหลัง cleanup
-- ============================================
SELECT '=== Final field_type distribution ===' as check_name;
SELECT field_type, COUNT(*) as count 
FROM field_master 
GROUP BY field_type 
ORDER BY field_type;

--> statement-breakpoint

-- ============================================
-- 12. ตรวจสอบว่าไม่มี __old_field_master (backup ควรถูกลบ)
-- ============================================
SELECT '=== Check backup table exists ===' as check_name;
SELECT name FROM sqlite_master 
WHERE type='table' AND name LIKE '%old%';
-- คาดหวัง: ไม่มี rows (ถ้ามี → ยังไม่ได้ cleanup)
