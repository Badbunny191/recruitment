# Production Fix Plan: field_master CHECK Constraint

**วันที่:** 10 ตุลาคม 2569  
**เป้าหมาย:** เพิ่ม MASTER_DATA (และ NUMBER, CHECKBOX, DATE) ให้ field_master  
**ข้อจำกัด:** ไม่แก้ d1_migrations ledger  
**ผลกระทบต่อ Production:** ต่ำสุด (table rename ไม่กระทบ data)

---

## 1. สถานะปัจจุบันของ field_master

### 1.1 Schema ปัจจุบัน (Remote)

```sql
CREATE TABLE `field_master` (
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
    CONSTRAINT "chk_field_type" CHECK("field_master"."field_type"
        IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE'))
)
```

### 1.2 ปัญหา

CHECK constraint ปัจจุบันรองรับเพียง **5 ค่า**:
- TEXT, TEXTAREA, DROPDOWN, RADIO, FILE

ต้องการเพิ่ม **4 ค่า**:
- NUMBER, CHECKBOX, DATE, **MASTER_DATA** ⬅️ เป้าหมายหลัก

### 1.3 ข้อมูลปัจจุบัน

```sql
SELECT field_type, COUNT(*) FROM field_master GROUP BY field_type;
```
| field_type | count |
|------------|-------|
| TEXT | ? |
| TEXTAREA | ? |
| DROPDOWN | ? |
| RADIO | ? |
| FILE | ? |

**รวม:** 12 rows (จากการ audit)

---

## 2. วิธีแก้ CHECK Constraint

### 2.1 ปัญหาของ SQLite

SQLite **ไม่รองรับ**:
- `ALTER TABLE ADD CONSTRAINT`
- `ALTER TABLE DROP CONSTRAINT`
- `ALTER TABLE MODIFY CONSTRAINT`

**วิธีเดียวที่ทำได้:** Recreate Table

### 2.2 วิธีที่เลือก: Safe Table Recreation

**หลักการ:** ใช้ `RENAME` แทน `DROP` เพื่อให้ Rollback ได้ทันที

```
[ตารางจริง: field_master] ──RENAME──> [field_master_backup]
[ตารางใหม่: __new_field_master] ──RENAME──> [field_master]
```

**ข้อดี:**
- ถ้าล้มเหลว → กลับไปใช้ `field_master_backup` ได้ทันที
- ไม่ต้อง `DROP` ตารางเก่า (ข้อมูลยังอยู่)
- ไม่แตะ `d1_migrations` ledger

### 2.3 ทางเลือกที่มี

| วิธี | ความเสี่ยง | เวลา downtime | ต้องแก้ Ledger? |
|------|-----------|--------------|----------------|
| **Safe Recreate (RENAME)** | ต่ำ | ~0 | ❌ ไม่ |
| Trigger-based validation | ต่ำ | ~0 | ❌ ไม่ |
| Drizzle push --force | สูง | ~0 | ⚠️ อาจต้อง |

**แนะนำ:** Safe Recreate (RENAME) ✅

---

## 3. SQL ที่จะรันทั้งหมด

### 3.1 SQL File: `fix_field_master_constraint.sql`

**หมายเหตุสำคัญ:** `011_field_type_master_data.sql` เดิมใช้ `DROP TABLE field_master` ซึ่งมีความเสี่ยง — ถ้าล้มเหลวกลางทางข้อมูลจะหายถาวร

**แผนนี้ใช้ `RENAME TO __old_field_master` แทน `DROP`** เพื่อความปลอดภัย — ข้อมูลเดิมยังอยู่ใน backup table สำหรับ rollback

```sql
-- ============================================
-- Fix: field_master CHECK Constraint
-- เพิ่ม NUMBER, CHECKBOX, DATE, MASTER_DATA
-- วิธี: Safe Recreate with RENAME (NO DROP)
-- ความเสี่ยง: ต่ำ (มี backup table)
-- ============================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- ============================================
-- STEP 1: สร้างตารางใหม่พร้อม CHECK constraint ที่ถูกต้อง
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
-- STEP 2: คัดลอกข้อมูลทั้งหมดจากตารางเดิม
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
-- STEP 3: เปลี่ยนชื่อตารางเดิมเป็น backup (ไม่ DROP!)
-- หมายเหตุ: ใช้ RENAME แทน DROP จาก migration 011 เดิม
-- ถ้าเกิดปัญหา → ALTER TABLE __old_field_master RENAME TO field_master
-- ============================================
ALTER TABLE `field_master` RENAME TO `__old_field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 4: เปลี่ยนชื่อตารางใหม่เป็นชื่อจริง
-- ============================================
ALTER TABLE `__new_field_master` RENAME TO `field_master`;

--> statement-breakpoint

-- ============================================
-- STEP 5: คืนค่า foreign keys
-- ============================================
PRAGMA foreign_keys=ON;
```

### 3.2 SQL File: `verify_constraint.sql` (รันหลัง fix)

```sql
-- ============================================
-- Verify: ตรวจสอบว่า fix สำเร็จ
-- ============================================

-- 1. ดู schema ใหม่
SELECT sql FROM sqlite_master WHERE name = 'field_master';

-- 2. ตรวจสอบว่าข้อมูลครบ
SELECT COUNT(*) as total_rows FROM field_master;

-- 3. ทดสอบ insert MASTER_DATA (จะ success ถ้าถูกต้อง)
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__test_master_data', 'MASTER_DATA', 'ทดสอบ MASTER_DATA');

-- 4. ทดสอบ insert NUMBER
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__test_number', 'NUMBER', 'ทดสอบ NUMBER');

-- 5. ทดสอบ insert CHECKBOX
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__test_checkbox', 'CHECKBOX', 'ทดสอบ CHECKBOX');

-- 6. ทดสอบ insert DATE
INSERT INTO field_master (id, field_type, label_th)
VALUES ('__test_date', 'DATE', 'ทดสอบ DATE');

-- 7. ทดสอบ insert ค่าผิด (จะ fail ถ้าถูกต้อง)
-- INSERT INTO field_master (id, field_type, label_th)
-- VALUES ('__test_invalid', 'INVALID_TYPE', 'ทดสอบค่าผิด');

-- 8. cleanup test rows
DELETE FROM field_master WHERE id LIKE '__test_%';

-- 9. ดู field_types ทั้งหมด
SELECT field_type, COUNT(*) FROM field_master GROUP BY field_type;
```

### 3.3 SQL File: `rollback.sql` (กรณีฉุกเฉิน)

```sql
-- ============================================
-- Rollback: กู้คืนไปใช้ตารางเดิม
-- รันเฉพาะเมื่อ fix มีปัญหา
-- ============================================

PRAGMA foreign_keys=OFF;

-- ถ้ามีตารางใหม่อยู่ → ลบทิ้ง
DROP TABLE IF EXISTS `field_master`;

-- กู้คืนตารางเดิมจาก backup
ALTER TABLE `__old_field_master` RENAME TO `field_master`;

PRAGMA foreign_keys=ON;
```

### 3.4 SQL File: `cleanup_backup.sql` (รันหลังยืนยันว่าทำงานได้)

```sql
-- ============================================
-- Cleanup: ลบตาราง backup
-- รันหลังจากยืนยันว่า fix ทำงานได้ 100%
-- ============================================
DROP TABLE IF EXISTS `__old_field_master`;
```

---

## 4. คำสั่งที่จะ Execute

### 4.1 Before: Backup

```bash
# Backup ข้อมูล field_master (JSON format)
npx wrangler d1 export sao-db /tmp/backup_field_master_$(date +%Y%m%d).json --remote --table=field_master

# หรือ backup ทั้ง database
npx wrangler d1 export sao-db /tmp/backup_full_$(date +%Y%m%d).sql --remote
```

### 4.2 Apply Fix

```bash
# รัน fix
npx wrangler d1 execute sao-db --remote --file ./fixes/fix_field_master_constraint.sql
```

### 4.3 Verify

```bash
# รัน verify
npx wrangler d1 execute sao-db --remote --file ./fixes/verify_constraint.sql
```

### 4.4 Cleanup (หลังยืนยันว่าใช้ได้)

```bash
# ลบ backup table
npx wrangler d1 execute sao-db --remote --file ./fixes/cleanup_backup.sql
```

---

## 5. ความเสี่ยงและการจัดการ

### 5.1 ความเสี่ยง

| ความเสี่ยง | ระดับ | วิธีจัดการ |
|-----------|-------|-----------|
| Insert/Update ล้มเหลวระหว่าง process | ต่ำ | `__old_field_master` ยังอยู่ |
| FK constraint broken | ต่ำ | ใช้ `PRAGMA foreign_keys=OFF` ระหว่าง process |
| ข้อมูลหาย | **ต่ำมาก** | คัดลอกไม่ใช่ย้าย (INSERT SELECT) |
| Downtime | **~0 วินาที** | RENAME ใช้เวลาทันที |

### 5.2 สิ่งที่อาจผิดพลาด

**กรณี 1:** ข้อมูลไม่ครบหลังคัดลอก
- **วิธีแก้:** ดูจาก `__old_field_master` ได้เลย

**กรณี 2:** INSERT SELECT ใช้เวลานาน (ถ้ามีข้อมูลมาก)
- **วิธีแก้:** ตารางนี้มีแค่ 12 rows → ใช้เวลา < 1 วินาที

**กรณี 3:** RENAME ล้มเหลว (ตารางใหม่มีชื่อซ้ำ)
- **วิธีแก้:** มี `DROP TABLE IF EXISTS` ก่อน RENAME

### 5.3 สิ่งที่ไม่กระทบ

| สิ่งที่ไม่กระทบ | เหตุผล |
|---------------|--------|
| `d1_migrations` ledger | ไม่ได้ใช้ `wrangler d1 migrations apply` |
| ข้อมูล applications | ไม่เกี่ยวข้องกับ applications table |
| ข้อมูล organizations | ไม่เกี่ยวข้องกับ organizations table |
| API endpoints อื่นๆ | เปลี่ยนเฉพาะ constraint ไม่กระทบ logic |
| Frontend | เปลี่ยนเฉพาะ validation backend |

---

## 6. ขั้นตอนการ Execute (สรุป)

```
┌─────────────────────────────────────────────────────────────┐
│ BEFORE: Backup                                              │
│ npx wrangler d1 export sao-db /tmp/backup_*.sql --remote   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Apply Fix                                           │
│ npx wrangler d1 execute sao-db --remote \                  │
│   --file ./fixes/fix_field_master_constraint.sql           │
│                                                             │
│ สิ่งที่เกิดขึ้น:                                           │
│ 1. สร้าง __new_field_master (พร้อม CHECK ใหม่)              │
│ 2. คัดลอกข้อมูล 12 rows                                    │
│ 3. เปลี่ยน field_master → __old_field_master               │
│ 4. เปลี่ยน __new_field_master → field_master              │
│                                                             │
│ เวลา: < 1 วินาที                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Verify                                              │
│ npx wrangler d1 execute sao-db --remote \                  │
│   --file ./fixes/verify_constraint.sql                      │
│                                                             │
│ ตรวจสอบ:                                                   │
│ □ schema ถูกต้อง                                           │
│ □ ข้อมูลครบ 12 rows                                        │
│ □ INSERT MASTER_DATA สำเร็จ                                 │
│ □ INSERT NUMBER, CHECKBOX, DATE สำเร็จ                      │
│ □ INSERT ค่าผิด → ABORT (ถูกต้อง)                          │
└─────────────────────────────────────────────────────────────┘
                            │
                          ✅ ผ่าน
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Cleanup Backup (optional)                           │
│ npx wrangler d1 execute sao-db --remote \                  │
│   --file ./fixes/cleanup_backup.sql                        │
│                                                             │
│ ลบ __old_field_master (ถ้ายืนยันว่าใช้ได้)                │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Rollback Plan (กรณีฉุกเฉิน)

### 7.1 ทันทีหลัง STEP 1 แต่ก่อน STEP 2

```bash
# กู้คืนจาก backup table
npx wrangler d1 execute sao-db --remote --file ./fixes/rollback.sql
```

### 7.2 หลัง STEP 2 (ถ้า verify ล้มเหลว)

```bash
# วิธีที่ 1: จาก backup table
npx wrangler d1 execute sao-db --remote --file ./fixes/rollback.sql

# วิธีที่ 2: จาก full backup
npx wrangler d1 execute sao-db --remote --file /tmp/backup_full_*.sql
```

### 7.3 หลัง STEP 3 (ถ้า production มีปัญหา)

```sql
-- ดึงข้อมูลจาก backup file
-- import กลับเข้าไป
```

---

## 8. การทดสอบหลัง Fix

### 8.1 ผ่าน API

```bash
# POST /api/v1/admin/fields ด้วย field_type = MASTER_DATA
curl -X POST https://api.example.com/api/v1/admin/fields \
  -H "Content-Type: application/json" \
  -d '{
    "field_type": "MASTER_DATA",
    "label_th": "หน่วยงาน",
    "default_options": "organizations"
  }'

# คาดหวัง: HTTP 201 Created (ไม่ใช่ HTTP 500)
```

### 8.2 ผ่าน Frontend

1. เปิดหน้า Field Management
2. กดปุ่ม "เพิ่ม Field"
3. เลือก Type = "MASTER_DATA"
4. ควรสามารถ save ได้โดยไม่ error

---

## 9. สรุป

| รายการ | รายละเอียด |
|--------|-----------|
| **ไฟล์ที่ต้องสร้าง** | 4 files (fix, verify, rollback, cleanup) |
| **คำสั่งที่ต้องรัน** | 4 คำสั่ง (backup, apply, verify, cleanup) |
| **ความเสี่ยง** | ต่ำมาก |
| **Downtime** | ~0 วินาที |
| **กระทบ Ledger** | ❌ ไม่กระทบ |
| **กระทบข้อมูล** | ❌ ไม่กระทบ (copy only) |
| **Rollback** | ✅ ทำได้ทันทีจาก backup table |

---

## 10. Checklist ก่อน Execute

- [ ] สร้างไฟล์ `fix_field_master_constraint.sql`
- [ ] สร้างไฟล์ `verify_constraint.sql`
- [ ] สร้างไฟล์ `rollback.sql`
- [ ] สร้างไฟล์ `cleanup_backup.sql`
- [ ] สร้างโฟลเดอร์ `fixes/`
- [ ] Backup field_master
- [ ] แจ้ง team ว่าจะมีการ fix (maintenance window ~1 นาที)
- [ ] Execute STEP 1
- [ ] Execute STEP 2 (verify)
- [ ] ถ้า verify ผ่าน → Execute STEP 3 (cleanup)
- [ ] ทดสอบ POST /api/v1/admin/fields ด้วย MASTER_DATA
- [ ] ถ้าทุกอย่าง OK → เสร็จสิ้น
