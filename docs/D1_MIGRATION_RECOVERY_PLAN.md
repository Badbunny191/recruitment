# D1 Migration Recovery Plan

**วันที่:** 10 ตุลาคม 2569  
**สถานะ:** Draft - รออนุมัติ  
**วัตถุประสงค์:** กู้คืน Ledger ให้ตรงกับ Schema และ Apply MASTER_DATA constraint

---

## 1. Current Remote Schema

### 1.1 ตารางที่มีอยู่ (17 ตาราง)

| ตาราง | Columns | Indexes | Constraints |
|-------|---------|---------|-------------|
| `admin_users` | 5 | 1 | - |
| `applications` | 14 | 3 | FK, CHECK |
| `application_attachments` | 7 | 1 | FK |
| `audit_logs` | 8 | 1 | FK |
| `field_master` | 12 | 3 | **CHECK (ขาด MASTER_DATA)** |
| `job_families` | 6 | 1 | - |
| `organizations` | 6 | 1 | - |
| `position_levels` | 6 | 1 | - |
| `positions` | 7 | 3 | FK x2 |
| `recruitment_rounds` | 12 | 2 | FK, CHECK x2 |
| `template_fields` | 15 | 2 | FK x2 (**ขาด FK section_id**) |
| `template_sections` | 7 | 3 | FK |
| `template_versions` | 5 | 2 | FK, CHECK |
| `templates` | 4 | 1 | - |

### 1.2 CHECK Constraints ปัจจุบัน

**field_master:**
```sql
CONSTRAINT "chk_field_type" CHECK("field_master"."field_type"
  IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE'))
```
**ขาด:** NUMBER, CHECKBOX, DATE, MASTER_DATA

**applications:**
```sql
CHECK(status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED',
                 'REJECTED', 'CANCELED', 'ARCHIVED'))
```
✅ ถูก expand แล้ว (ขยายจาก 3 → 7 values)

### 1.3 ข้อมูลในตาราง

| ตาราง | Row Count | สถานะ |
|-------|-----------|--------|
| organizations | 141 | ครบทุกหน่วยงาน สตง. |
| job_families | 14 | ครบทุก job family |
| position_levels | 10 | ครบทุก level |
| positions | 6 | มีข้อมูลตัวอย่าง |
| template_sections | 4 | มีข้อมูล |
| field_master | 12 | มี existing fields |

---

## 2. Current Migration Ledger

```sql
SELECT * FROM d1_migrations ORDER BY id;
```

| id | name | applied_at |
|----|------|------------|
| 1 | 0000_normal_alex_wilder.sql | 2026-10-07 15:54:50 |
| 2 | 0001_applications_management.sql | 2026-10-08 12:20:10 |
| 3 | 0002_audit_trail.sql | 2026-10-08 12:29:40 |

**Ledger มี 3 records — ขาดหาย 4-11 (8 records)**

---

## 3. Differences: Ledger vs Schema

### 3.1 ตารางที่ Ledger บอกว่าสร้างแล้ว

| ตาราง | Ledger | Schema จริง | ตรงกัน? |
|-------|--------|-------------|---------|
| admin_users | ✅ 0000 | ✅ มี | ✅ |
| applications | ✅ 0000 | ✅ มี (columns เพิ่ม) | ✅ |
| application_attachments | ✅ 0000 | ✅ มี (columns เพิ่ม) | ✅ |
| audit_logs | ✅ 0000 | ✅ มี | ✅ |
| field_master | ✅ 0000 | ✅ มี (columns เพิ่ม) | ✅ |
| recruitment_rounds | ✅ 0000 | ✅ มี (columns เพิ่ม) | ✅ |
| template_fields | ✅ 0000 | ✅ มี (columns เพิ่ม) | ✅ |
| template_versions | ✅ 0000 | ✅ มี | ✅ |
| templates | ✅ 0000 | ✅ มี | ✅ |

### 3.2 ตารางที่ Ledger ไม่มี แต่ Schema มี

| ตาราง | Ledger | Schema จริง | Data |
|-------|--------|-------------|------|
| organizations | ❌ ไม่มี | ✅ มี | 141 rows |
| job_families | ❌ ไม่มี | ✅ มี | 14 rows |
| position_levels | ❌ ไม่มี | ✅ มี | 10 rows |
| positions | ❌ ไม่มี | ✅ มี | 6 rows |
| template_sections | ❌ ไม่มี | ✅ มี | 4 rows |

### 3.3 Constraints ที่ไม่ตรงกัน

| Constraint | Migration | Schema จริง | ตรง? |
|------------|-----------|-------------|-------|
| field_master.field_type | IN (5 values) | IN (5 values) | ⚠️ ขาด 4 values |
| applications.status | IN (3 values) | IN (7 values) | ✅ ถูก expand แล้ว |
| template_fields.section_id FK | REFERENCES | ไม่มี REFERENCES | ⚠️ ขาด FK |

---

## 4. Migration Files ที่สามารถถือว่า Applied แล้ว

เนื่องจาก Ledger ไม่ตรงกับ Schema แต่ Schema จริงมีครบทุกอย่าง แสดงว่าถูก apply ไปแล้วทั้งทางตรง (ไม่ผ่าน `wrangler d1 migrations apply`) ดังนั้น **ถือว่า applied แล้ว** ทั้ง 8 files:

| File | เหตุผล |
|------|--------|
| 002_field_master_enhancement.sql | `help_text`, `placeholder`, `section`, `file_config` มีอยู่ใน field_master |
| 003_validation_required_fix.sql | `validation_type`, `validation_message` มีอยู่ใน field_master |
| 004_field_master_enhancement_phase0.sql | `validation_rules`, `help_text`, `placeholder` มีอยู่ใน template_fields |
| 005_organizations.sql | ตารางมี 141 rows ครบ |
| 006_sprint1_announcement_metadata.sql | `announcement_*`, `remark`, `rows`, `min_length`, `max_length` มีอยู่ |
| 007_organizations_display_order.sql | `display_order` มีอยู่ใน organizations |
| 008_position_masters.sql | `job_families` (14), `position_levels` (10), `positions` (6) มีครบ |
| 009_template_sections.sql | `template_sections` มี 4 rows, `section_id` column มีอยู่ |

---

## 5. Migration Files ที่ต้องรันจริง

| File | สถานะ | ต้องรัน? |
|------|--------|---------|
| 010_recover_negative_display_order.sql | ❌ ไม่จำเป็น | ❌ ไม่ต้อง |
| **011_field_type_master_data.sql** | ❌ ยังไม่รัน | **✅ ต้องรัน** |

**Migration 011 คือตัวเดียวที่ต้องรัน** เพื่อเพิ่ม MASTER_DATA (และ NUMBER, CHECKBOX, DATE) ลงใน CHECK constraint ของ `field_master`

---

## 6. Migration Files ที่ห้ามรัน

**ไม่มี** — ทุก migration file มีประโยชน์ แต่ ledger กับ schema ไม่ตรงกัน

---

## 7. วิธีทำให้ Ledger กลับมาตรงกับ Schema

### ทางเลือก A: แทรก Records ปลอมลง d1_migrations (Recommended)

**หลักการ:** เพิ่ม 8 records ปลอมลง `d1_migrations` ledger ให้ตรงกับความจริงที่ schema มีอยู่

```sql
-- หลังจาก confirmed ว่า schema มีทุกอย่างแล้ว ให้แทรก:

INSERT INTO d1_migrations (name, applied_at)
VALUES
  ('002_field_master_enhancement.sql', '2026-10-08 13:00:00'),
  ('003_validation_required_fix.sql', '2026-10-08 13:15:00'),
  ('004_field_master_enhancement_phase0.sql', '2026-10-08 13:30:00'),
  ('005_organizations.sql', '2026-10-08 14:00:00'),
  ('006_sprint1_announcement_metadata.sql', '2026-10-08 14:15:00'),
  ('007_organizations_display_order.sql', '2026-10-08 14:30:00'),
  ('008_position_masters.sql', '2026-10-08 15:00:00'),
  ('009_template_sections.sql', '2026-10-08 15:30:00');
```

**ข้อดี:**
- Ledger ตรงกับ Schema ทันที
- สามารถใช้ `wrangler d1 migrations apply` ต่อได้ปกติ
- ปลอดภัยเพราะไม่ได้แก้ไข schema

**ข้อเสี่ยง:**
- applied_at เป็น timestamp ปลอม (อาจสร้างความสับสนในอนาคต)

**ขั้นตอน:**
1. Backup ledger ปัจจุบัน
2. ยืนยันว่า schema มีทุกอย่างจริง (จาก audit ที่ทำไปแล้ว)
3. Execute INSERT statement ด้านบน
4. ยืนยัน `SELECT * FROM d1_migrations` ว่ามี 11 records

---

### ทางเลือก B: ลบ Ledger แล้ว Recreate

**หลักการ:** ลบ records เดิมทิ้ง แล้วใส่ทุกอย่างใหม่ รวมถึง 011 ด้วย

```sql
-- ลบ ledger เดิม
DELETE FROM d1_migrations;

-- Insert ทุก migration (รวม 011)
INSERT INTO d1_migrations (name, applied_at) VALUES
  ('0000_normal_alex_wilder.sql', '2026-10-07 15:54:50'),
  ('0001_applications_management.sql', '2026-10-08 12:20:10'),
  ('0002_audit_trail.sql', '2026-10-08 12:29:40'),
  ('002_field_master_enhancement.sql', '2026-10-08 13:00:00'),
  ('003_validation_required_fix.sql', '2026-10-08 13:15:00'),
  ('004_field_master_enhancement_phase0.sql', '2026-10-08 13:30:00'),
  ('005_organizations.sql', '2026-10-08 14:00:00'),
  ('006_sprint1_announcement_metadata.sql', '2026-10-08 14:15:00'),
  ('007_organizations_display_order.sql', '2026-10-08 14:30:00'),
  ('008_position_masters.sql', '2026-10-08 15:00:00'),
  ('009_template_sections.sql', '2026-10-08 15:30:00');
```

**ข้อดี:**
- Ledger สะอาด ตรงกับความจริง
- รวม migration 011 ด้วยในขั้นตอนเดียว

**ข้อเสี่ยง:**
- ⚠️ ลบ ledger เดิมทิ้ง (ถือว่าเป็น state change ที่ riskier)

---

### ทางเลือก C: ไม่แก้ Ledger ใช้วิธีอื่น Apply 011

**หลักการ:** ไม่ต้องแก้ ledger ใช้ `wrangler d1 execute --file` เพื่อ apply 011 โดยตรง แทน `wrangler d1 migrations apply`

```bash
# รัน migration 011 โดยตรง (ไม่ผ่าน ledger)
npx wrangler d1 execute sao-db --remote --file ./migrations/011_field_type_master_data.sql
```

**ข้อดี:**
- ไม่ต้องแก้ ledger
- รวดเร็ว

**ข้อเสี่ยง:**
- Ledger ยังไม่ตรงกับ Schema ต่อไป
- ถ้ามี migration ใหม่ในอนาคต จะต้องจัดการอีกรอบ

**แนะนำ:** ทางเลือก A เพราะ ledger กับ schema จะตรงกันทันที

---

## 8. วิธี Apply 011_field_type_master_data.sql โดยไม่กระทบข้อมูล Production

### 8.1 ปัญหาของ Migration 011

Migration 011 ใช้วิธี **recreate table** เพราะ SQLite ไม่รองรับ `ALTER CONSTRAINT`:

```sql
-- ปัญหา: ขั้นตอนมี 3 จุดที่อาจกระทบข้อมูล

1. CREATE TABLE __new_field_master (...);  -- สร้างตารางใหม่
2. INSERT INTO __new_field_master SELECT * FROM field_master;  -- คัดลอกข้อมูล
3. DROP TABLE field_master;  -- ลบตารางเดิม ⚠️
4. ALTER TABLE __new_field_master RENAME TO field_master;  -- rename
```

**ความเสี่ยง:**
- ถ้า step 2 หรือ 4 fail → ข้อมูลอยู่ในตารางกลาง
- D1 batch execute ไม่ใช่ transaction (แต่ละ statement แยกจากกัน)
- ถ้าล้มเหลวกลางทาง → schema ไม่ consistent

### 8.2 ขั้นตอนที่ปลอดภัยที่สุด

#### Step 1: Backup ก่อน (Read-only)

```bash
# Export ข้อมูล field_master
npx wrangler d1 export sao-db /tmp/backup_field_master.json --remote --table=field_master

# Export ทั้ง database
npx wrangler d1 export sao-db /tmp/backup_full.sql --remote
```

#### Step 2: แก้ Migration 011 ให้ปลอดภัยขึ้น

แทนที่จะใช้ `DROP TABLE` ซึ่งเป็นจุดเสี่ยง ให้ใช้วิธี:

```sql
-- แก้ไข 011_field_type_master_data.sql เป็น:

PRAGMA foreign_keys=OFF;

-- 1. สร้างตารางใหม่พร้อม CHECK constraint ที่ถูกต้อง
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
        'TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE',
        'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA'
    ))
);

--> statement-breakpoint

-- 2. คัดลอกข้อมูลทั้งหมด
INSERT INTO `__new_field_master`(
    "id", "field_type", "label_th", "default_options", "pdf_mapping_key",
    "is_active", "help_text", "placeholder", "section", "file_config",
    "validation_type", "validation_message"
)
SELECT
    "id", "field_type", "label_th", "default_options", "pdf_mapping_key",
    "is_active", "help_text", "placeholder", "section", "file_config",
    "validation_type", "validation_message"
FROM `field_master`;

--> statement-breakpoint

-- 3. ตรวจสอบว่าคัดลอกครบ
-- (ถ้า COUNT ไม่ตรง → rollback ไม่ทำขั้นตอลต่อไป)
-- SELECT COUNT(*) FROM field_master;  -- ควรเท่ากับ count จาก __new_field_master

--> statement-breakpoint

-- 4. เปลี่ยนชื่อตารางเดิมเป็นชื่อสำรอง
ALTER TABLE `field_master` RENAME TO `__old_field_master`;

--> statement-breakpoint

-- 5. เปลี่ยนชื่อตารางใหม่เป็นชื่อจริง
ALTER TABLE `__new_field_master` RENAME TO `field_master`;

--> statement-breakpoint

-- 6. ลบตารางเก่าหลังจากยืนยันว่าทุกอย่างถูกต้อง
-- (ถ้าต้องการ rollback ให้: ALTER TABLE __old_field_master RENAME TO field_master)
DROP TABLE `__old_field_master`;

--> statement-breakpoint

PRAGMA foreign_keys=ON;
```

**จุดสำคัญ:**
- ใช้ `RENAME` แทน `DROP` → ถ้าล้มเหลว ข้อมูลยังอยู่ใน `__old_field_master`
- มี `__old_field_master` เป็น fallback สำหรับ emergency rollback
- ควรเพิ่ม `SELECT COUNT(*)` เพื่อ verify ก่อน rename

#### Step 3: ตรวจสอบหลัง Apply

```bash
# ตรวจสอบว่า constraint ถูกต้อง
npx wrangler d1 execute sao-db --remote --command="SELECT sql FROM sqlite_master WHERE name='field_master';"

# ตรวจสอบว่าข้อมูลครบ
npx wrangler d1 execute sao-db --remote --command="SELECT COUNT(*) FROM field_master;"

# ตรวจสอบว่าไม่มี MASTER_DATA value ซ้ำ
npx wrangler d1 execute sao-db --remote --command="SELECT field_type, COUNT(*) FROM field_master GROUP BY field_type;"
```

### 8.3 วิธีทางเลือก: ใช้ Check Constraint โดยไม่ Recreate Table

เนื่องจาก SQLite ไม่รองรับ `ALTER TABLE ADD CONSTRAINT` แต่สามารถสร้าง trigger เพื่อ validate ได้:

```sql
-- วิธีนี้ไม่ต้อง recreate table
-- ใช้ trigger เพื่อ validate แทน constraint

CREATE TRIGGER IF NOT EXISTS chk_field_type_master_data
BEFORE INSERT ON field_master
WHEN NEW.field_type NOT IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA')
BEGIN
  SELECT RAISE(ABORT, 'Invalid field_type. Allowed: TEXT, TEXTAREA, DROPDOWN, RADIO, FILE, NUMBER, CHECKBOX, DATE, MASTER_DATA');
END;
```

**ข้อดี:** ไม่ต้อง recreate table ไม่มีความเสี่ยงต่อข้อมูล

**ข้อเสี่ยง:**
- Trigger ช้ากว่า CHECK constraint
- ถ้า migration 011 ถูกรันในอนาคต จะเจอ conflict (table + trigger)

---

## 9. Complete Recovery Workflow

### Phase 1: Sync Ledger (5 นาที)

```sql
-- 1. Backup ledger
-- (SELECT * FROM d1_migrations INTO file)

-- 2. Insert missing records
INSERT INTO d1_migrations (name, applied_at) VALUES
  ('002_field_master_enhancement.sql', '2026-10-08 13:00:00'),
  ('003_validation_required_fix.sql', '2026-10-08 13:15:00'),
  ('004_field_master_enhancement_phase0.sql', '2026-10-08 13:30:00'),
  ('005_organizations.sql', '2026-10-08 14:00:00'),
  ('006_sprint1_announcement_metadata.sql', '2026-10-08 14:15:00'),
  ('007_organizations_display_order.sql', '2026-10-08 14:30:00'),
  ('008_position_masters.sql', '2026-10-08 15:00:00'),
  ('009_template_sections.sql', '2026-10-08 15:30:00');
```

### Phase 2: Backup (5 นาที)

```bash
npx wrangler d1 export sao-db /tmp/backup_$(date +%Y%m%d_%H%M%S).sql --remote
```

### Phase 3: Apply 011 (5 นาที)

```bash
# ใช้คำสั่ง execute โดยตรง (ไม่ผ่าน migrations apply เพราะ ledger ยังไม่มี 011)
npx wrangler d1 execute sao-db --remote --file ./migrations/011_field_type_master_data.sql
```

### Phase 4: Verify (2 นาที)

```sql
-- ยืนยัน constraint
SELECT sql FROM sqlite_master WHERE name = 'field_master';

-- ยืนยันข้อมูลครบ
SELECT COUNT(*) FROM field_master;  -- ต้องได้ 12

-- ยืนยันว่ายังสามารถ insert MASTER_DATA ได้
INSERT INTO field_master (id, field_type, label_th)
VALUES ('test-md', 'MASTER_DATA', 'ทดสอบ MASTER_DATA');
DELETE FROM field_master WHERE id = 'test-md';
```

---

## 10. Rollback Plan

| กรณี | วิธีกู้คืน |
|------|-----------|
| Ledger sync ผิดพลาด | `DELETE FROM d1_migrations WHERE id > 3;` (ลบ 8 records ที่เพิ่งเพิ่ม) |
| Migration 011 ล้มเหลว | `ALTER TABLE __old_field_master RENAME TO field_master;` |
| ข้อมูลหายหลัง 011 | `npx wrangler d1 execute sao-db --remote --file /tmp/backup_*.sql` |
| Trigger approach conflict | `DROP TRIGGER chk_field_type_master_data;` |

---

## 11. สรุปลำดับการทำงาน

```
[สถานะปัจจุบัน]
Ledger: 3 records
Schema: ครบทุกอย่าง (ยกเว้น MASTER_DATA constraint)

        │
        ▼
[Step 1: Sync Ledger]
Ledger: 11 records (เพิ่ม 8 records ปลอม)
        │
        ▼
[Step 2: Backup]
        │
        ▼
[Step 3: Apply 011]
field_master CHECK constraint: มี MASTER_DATA แล้ว
        │
        ▼
[Step 4: Verify]
        │
        ▼
[สถานะสุดท้าย]
Ledger: 11 records ✅
Schema: ครบทุก constraint ✅
POST /api/v1/admin/fields: รองรับ MASTER_DATA ✅
```
