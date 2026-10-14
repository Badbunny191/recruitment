# backend/fixes/

## ⚠️ Emergency Recovery & Rollback Scripts

โฟลเดอร์นี้ใช้เก็บ:

1. **Rollback scripts** — สำหรับ undo schema change ที่ apply ไปแล้ว
2. **Emergency recovery scripts** — สำหรับแก้ไขปัญหาเฉพาะหน้าบน production
3. **Data fix scripts** — สำหรับแก้ data inconsistency ที่ไม่สามารถแก้ด้วย forward migration

---

## 🔴 กฎสำคัญ

### ห้าม Apply ไฟล์ในโฟลเดอร์นี้ผ่าน Wrangler Migration

> **ห้ามใช้ `wrangler d1 migrations apply` กับไฟล์ในโฟลเดอร์นี้โดยเด็ดขาด**

เพราะ:

- ไฟล์ใน `fixes/` ไม่อยู่ใน default migrations folder ของ Wrangler (ซึ่งคือ `backend/migrations/`)
- แต่ถ้า dev ย้ายไฟล์จาก `fixes/` ไป `migrations/` แล้ว apply → จะเกิด double-apply หรือ reverse schema
- ไฟล์เหล่านี้ต้อง apply ด้วย `wrangler d1 execute --file=` เท่านั้น

### วิธี Apply ที่ถูกต้อง

```bash
# ✅ ถูก — apply ด้วย execute
wrangler d1 execute sao-db --remote --file=./fixes/fix_xxx.sql

# ❌ ผิด — ห้าม apply ผ่าน migrations apply
wrangler d1 migrations apply sao-db --remote  # จะ scan เฉพาะ backend/migrations/
```

---

## 📁 ไฟล์ที่มีอยู่

| File | Purpose | Apply Method |
|---|---|---|
| `cleanup_backup.sql` | ลบ backup table ที่เหลือจาก migration ก่อนหน้า | `wrangler d1 execute --file=` |
| `fix_field_master_constraint.sql` | แก้ check constraint ของ `field_master` table | `wrangler d1 execute --file=` |
| `rollback.sql` | Rollback schema สำหรับ fix ที่ apply ไปก่อนหน้า | `wrangler d1 execute --file=` |
| `verify_constraint.sql` | Verify ว่า constraint ถูกต้องหลัง apply fix | `wrangler d1 execute --file=` |

---

## ✅ วิธีสร้าง Fix Script ใหม่

```bash
# 1. สร้างไฟล์ใหม่ในโฟลเดอร์นี้ (ไม่ต้องมี prefix NNNN_)
touch backend/fixes/fix_<descriptive_name>.sql

# 2. เขียน SQL + comment อธิบาย
# -- Fix: <อธิบายปัญหา>
# -- Apply: wrangler d1 execute sao-db --remote --file=./fixes/fix_<name>.sql
# -- Rollback: <คำอธิบายวิธี undo>

# 3. ตรวจสอบ SQL บน local ก่อน
wrangler d1 execute sao-db --local --file=./fixes/fix_<name>.sql

# 4. เปิด PR + tag Backend Lead
```

---

## 🔍 เมื่อไหร่ควรใช้ Fix Script vs Migration ใหม่

| สถานการณ์ | ใช้ Fix Script | ใช้ Forward Migration |
|---|---|---|
| Schema change ที่ apply ไปแล้วและต้อง undo | ❌ | ✅ เขียน migration ใหม่ |
| Data inconsistency ที่ต้อง clean up ทันที | ✅ | ❌ |
| Production incident ที่ต้องแก้ schema แบบ ad-hoc | ✅ | ❌ |
| Schema change ปกติที่วางแผนล่วงหน้า | ❌ | ✅ |

---

## 📚 เอกสารเพิ่มเติม

- [Migration Governance Policy](../../docs/MIGRATION_GOVERNANCE.md) — ดูหัวข้อ Rollback Policy
- [Production Fix Plan](../../docs/PRODUCTION_FIX_PLAN.md) — ตัวอย่างการใช้ fix script
- [D1 Migration Recovery Plan](../../docs/D1_MIGRATION_RECOVERY_PLAN.md)

---

**หากไม่แน่ใจว่าจะใช้ fix script หรือ forward migration กรุณาปรึกษา Backend Lead ก่อน**
