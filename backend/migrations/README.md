# backend/migrations/

## ⚠️ Single Source of Truth สำหรับ Database Migration

โฟลเดอร์นี้คือ **แหล่งข้อมูลเดียว** สำหรับ Database Migration ทั้งหมดของโปรเจกต์ Recruitment

Cloudflare Wrangler จะ scan เฉพาะโฟลเดอร์นี้เมื่อรัน:

```bash
wrangler d1 migrations apply sao-db --remote
```

---

## 🔴 กฎสำคัญ

### 1. Cloudflare Wrangler ใช้ "Filename" เป็น Migration Identity

- เมื่อ apply migration แล้ว Wrangler จะบันทึก **ชื่อไฟล์** ลงในตาราง `d1_migrations` บน D1
- การ apply ครั้งถัดไป Wrangler จะตรวจสอบว่าไฟล์ไหน apply ไปแล้ว โดยเทียบ **filename (string)**
- ดังนั้น **ชื่อไฟล์ = identity ของ migration** เปลี่ยนชื่อไม่ได้เด็ดขาด

### 2. ห้าม Rename Migration ที่เคย Deploy

- Migration ที่อยู่ในตาราง `d1_migrations` ของ production แล้ว ห้าม rename โดยเด็ดขาด
- ถ้า rename → Wrangler จะ "ไม่รู้จัก" migration นั้น → apply migration ใหม่ซ้ำ → schema corruption
- กฎนี้บังคับใช้ตลอดกาล ไม่มีข้อยกเว้น

### 3. ห้าม Delete Migration ที่เคย Deploy

- Migration ที่ apply production ไปแล้ว ห้ามลบออกจากโฟลเดอร์นี้
- ลบไม่ได้แม้จะ merge แล้วก็ตาม
- เหตุผล: ledger desync + audit trail หาย

### 4. ห้าม Modify Migration ที่ Merge แล้ว

- Migration ที่ merge เข้า `main` แล้ว ถือเป็น **immutable record**
- ห้ามแก้ SQL ใด ๆ ทั้งสิ้น
- ถ้าจำเป็นต้องแก้ต้องเขียน migration ใหม่

### 5. ห้ามสร้าง Migration ใหม่ใน `backend/drizzle/`

- โฟลเดอร์ `backend/drizzle/` เป็น **frozen read-only reference** เท่านั้น
- ห้าม generate migration ใหม่ด้วย `drizzle-kit generate`
- ทุก schema change ต้องเขียนด้วยมือเป็นไฟล์ใหม่ในโฟลเดอร์นี้

### 6. ห้ามวาง Rollback Script ในโฟลเดอร์นี้ (hard rule — ไม่มีข้อยกเว้น)

- Wrangler scan ทุกไฟล์ `.sql` ในโฟลเดอร์นี้แล้ว apply ตามลำดับชื่อไฟล์
  **โดยไม่สนใจว่าเป็น forward หรือ rollback** → rollback script ที่หลุดมาจะถูก apply
  โดยไม่ตั้งใจ = reverse schema
- Rollback / emergency fix script ต้องอยู่ใน `backend/fixes/` เท่านั้น
- `npm run migration:check` มี check `ROLLBACK_IN_MIGRATIONS_DIR` ที่สแกน **ทุกไฟล์**
  (ไม่มี legacy baseline exemption) → จะ fail ทันทีพร้อมวิธีแก้

> `015_rollback.sql` เคยอยู่ในโฟลเดอร์นี้ (apply production แล้ว 2026-10-14) และถูกย้ายไป
> `backend/fixes/015_rollback.sql` เมื่อ 28 ต.ค. 2569 — การย้ายไม่ทำให้ ledger เสีย
> (Wrangler คำนวณ unapplied = ไฟล์ใน folder − ชื่อใน `d1_migrations` → row ที่ไม่มีไฟล์
> ตรงกันจะถูก ignore) และชื่อไฟล์ไม่ถูก rename → ledger ยังเป็น `'015_rollback.sql'` เดิม
>
> ดู: [Rollback Policy](../../docs/MIGRATION_GOVERNANCE.md#4-rollback-policy) ·
> [Migration Audit 2026 — Finding #3](../../docs/MIGRATION_AUDIT_2026.md)

---

## ✅ วิธีสร้าง Migration ใหม่

```bash
# 1. ดู migration ล่าสุด
ls backend/migrations/ | sort | tail -1
# เช่น: 0018_add_template_field_validation_message.sql

# 2. สร้าง migration ใหม่ (prefix ถัดไป)
cp backend/migrations/0018_xxx.sql backend/migrations/0019_yyy.sql

# 3. แก้ SQL ในไฟล์ใหม่

# 4. ตรวจสอบด้วย linter
npm run migration:check

# 5. ทดสอบ local
npm run db:migrate

# 6. ทดสอบ idempotency (รันซ้ำ)
npm run db:migrate
```

---

## 📋 Naming Convention

```
NNNN_description.sql
```

- `NNNN` = 4 หลัก zero-padded เช่น `0001`, `0019`, `0182`
- `description` = snake_case, lowercase เท่านั้น
- ❌ ห้ามใช้ camelCase, hyphen, ตัวพิมพ์ใหญ่
- ❌ ห้ามมีคำว่า `rollback`, `down`, `revert`, `fix`

### ตัวอย่าง

✅ ถูก:
- `0000_normal_alex_wilder.sql`
- `0019_nullable_national_id.sql`
- `0182_add_user_preferences_table.sql`

❌ ผิด (CI จะ block):
- `019_nullable.sql` (3 หลัก)
- `0019_Nullable.sql` (ตัวพิมพ์ใหญ่)
- `0019-nullable.sql` (ใช้ hyphen)
- `0019_fix_nullable.sql` (มีคำว่า fix)

---

## 🔍 ไฟล์ในโฟลเดอร์นี้

| File | Status | Applied to Production? |
|---|---|---|
| `0000_normal_alex_wilder.sql` | 🔒 Immutable | ✅ Yes |
| `0001_applications_management.sql` | 🔒 Immutable | ✅ Yes |
| `0002_audit_trail.sql` | 🔒 Immutable | ✅ Yes |
| `0003_…sql` ถึง `0018_…sql` | 🔒 Immutable | ✅ Yes |
| (ไฟล์ที่จะเพิ่มในอนาคต) | ✅ Append-only | ❌ Pending |

---

## 📚 เอกสารเพิ่มเติม

- [Migration Governance Policy](../../docs/MIGRATION_GOVERNANCE.md)
- [Migration Audit 2026](../../docs/MIGRATION_AUDIT_2026.md)
- [D1 Migration Recovery Plan](../../docs/D1_MIGRATION_RECOVERY_PLAN.md)

---

**หากพบปัญหาหรือมีคำถาม กรุณาติดต่อ Backend Lead**
