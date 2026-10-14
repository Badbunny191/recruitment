# backend/scripts/migrations/

## 🧪 Ad-hoc Test & Migration Scripts

โฟลเดอร์นี้ใช้เก็บ SQL scripts และ test scripts ที่:

1. **ไม่ใช่ production migration** — ไม่ต้อง apply บน production
2. **ใช้สำหรับ local development** — dev รันทดสอบ feature
3. **ใช้สำหรับ manual testing** — QA / UAT script
4. **ใช้สำหรับ data exploration** — query ดูข้อมูลใน dev environment

---

## 🔴 กฎสำคัญ

### ห้าม Apply ผ่าน `wrangler d1 migrations apply`

> **ไฟล์ในโฟลเดอร์นี้ห้าม apply ผ่าน Wrangler migration โดยเด็ดขาด**

เพราะ:

- ไฟล์เหล่านี้ไม่อยู่ใน `backend/migrations/` (source of truth)
- เป็น ad-hoc scripts ที่อาจมี destructive operations (DROP, DELETE)
- ไม่มี version control ที่ดีพอสำหรับ production

### วิธี Apply ที่ถูกต้อง

```bash
# ✅ ถูก — apply ด้วย execute
wrangler d1 execute sao-db --local --file=./scripts/migrations/test_xxx.sql

# ❌ ผิด — ห้าม apply ผ่าน migrations apply
wrangler d1 migrations apply sao-db --local
```

### ห้ามใช้กับ Production

> **ไฟล์ในโฟลเดอร์นี้ใช้ได้เฉพาะ local / staging เท่านั้น**

ถ้าจำเป็นต้องรันบน production ให้:
1. ย้าย script ไป `backend/fixes/` พร้อมคำอธิบาย incident
2. ได้รับ approval จาก Backend Lead
3. รันด้วย `wrangler d1 execute --remote --file=...`

---

## 📁 ไฟล์ที่มีอยู่

*(ยังไม่มี — โฟลเดอร์นี้ถูกสร้างขึ้นเพื่อรอรับ scripts จากการ refactor)*

scripts ที่ควรย้ายมาที่นี่:
- `backend/test-archive-delete.sql` (untracked, รอการ refactor)

---

## ✅ วิธีสร้าง Test Script ใหม่

```bash
# 1. สร้างไฟล์ใหม่
touch backend/scripts/migrations/test_<feature>.sql

# 2. เขียน SQL + comment อธิบาย
# -- Purpose: <อธิบายว่า script นี้ทำอะไร>
# -- Usage: wrangler d1 execute sao-db --local --file=./scripts/migrations/test_<name>.sql
# -- Cleanup: <วิธี rollback/cleanup>

# 3. ทดสอบบน local
wrangler d1 execute sao-db --local --file=./scripts/migrations/test_<name>.sql

# 4. Commit (พร้อมคำอธิบายใน commit message)
git add backend/scripts/migrations/test_<name>.sql
git commit -m "test: add test script for <feature>"
```

---

## 🗑️ Cleanup Policy

- scripts ที่ไม่ได้ใช้งานเกิน 90 วัน → ลบหรือ archive
- scripts ที่กลายเป็น production feature → ย้ายไป `backend/migrations/`
- scripts ที่กลายเป็น recurring fix → ย้ายไป `backend/fixes/`

---

## 📚 เอกสารเพิ่มเติม

- [Migration Governance Policy](../../../../docs/MIGRATION_GOVERNANCE.md)

---

**หากไม่แน่ใจว่า script ควรอยู่ folder ไหน กรุณาถาม Backend Lead**
