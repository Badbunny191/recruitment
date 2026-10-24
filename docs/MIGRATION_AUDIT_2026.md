# Migration Audit Report — 2026

**วันที่ทำ Audit:** 14 ตุลาคม 2569
**ผู้ทำ Audit:** Backend Lead
**สถานะ:** โปรเจกต์ Recruitment

---

## 📋 สรุปผู้บริหาร (Executive Summary)

โปรเจกต์ Recruitment ใช้ Cloudflare D1 เป็น database และ Cloudflare Wrangler เป็นเครื่องมือ deploy migration แต่ระบบ migration ปัจจุบันมีความเสี่ยงสูงที่จะเกิด **Migration Drift** ซึ่งเคยเกิดขึ้นแล้วในอดีต

**ระดับความเสี่ยงรวม:** 🔴 **CRITICAL**

**สาเหตุหลัก 5 ข้อ:**

1. มีระบบ migration 2 ชุดทำงานขนานกัน (`backend/migrations/` และ `backend/drizzle/`)
2. Naming convention ไม่สม่ำเสมอ (3 หลัก vs 4 หลัก, มีคำว่า rollback ปะปน)
3. Rollback files ปะปนอยู่ใน folder migration หลัก
4. Production เคย apply migration ด้วย `wrangler d1 execute --file` แทน `migrations apply` ทำให้ ledger ไม่ตรงกับ schema
5. Cloudflare Wrangler ใช้ **filename เป็น unique identity** ทำให้ rename migration = corruption

---

## 🔍 ประเด็นที่พบ (Findings)

### 1. มี Migration 2 ระบบทำงานขนานกัน

**รายละเอียด:**

โปรเจกต์มีโฟลเดอร์ migration 2 แห่ง:

| Folder | ไฟล์ | ใช้งานจริง? | หลักฐาน |
|---|---|---|---|
| `backend/migrations/` | 18 ไฟล์ | ✅ Production source of truth | มี INSERT ใน `d1_migrations` ledger ของ production |
| `backend/drizzle/` | 9 ไฟล์ + meta/ | ❌ ไม่ได้ใช้แล้ว (frozen) | มี `_journal.json` แต่ `wrangler.toml` ไม่ได้ชี้มาที่ folder นี้ |

**ผลกระทบ:**

- Developer ใหม่สับสนว่าจะสร้าง migration ที่ folder ไหน
- มี migration ที่ทำ logic เดียวกันอยู่ทั้ง 2 folder เช่น `drizzle/0006_add_template_field_validation_message.sql` กับ `migrations/018_add_template_field_validation_message.sql`
- `drizzle/0006_nullable_national_id.sql` เป็น orphan (มีไฟล์แต่ไม่มีใน `_journal.json`)

**ความเสี่ยง:** 🔴 CRITICAL

---

### 2. Naming Convention ไม่สม่ำเสมอ

**รายละเอียด:**

ใน `backend/migrations/` มีไฟล์ที่ใช้ prefix ทั้ง 3 หลัก และ 4 หลัก ปะปนกัน:

```
0000_normal_alex_wilder.sql        ← 4 หลัก
0001_applications_management.sql   ← 4 หลัก
0002_audit_trail.sql               ← 4 หลัก
002_field_master_enhancement.sql   ← 3 หลัก ❌
003_validation_required_fix.sql    ← 3 หลัก ❌
004_field_master_enhancement_phase0.sql  ← 3 หลัก ❌
005_organizations.sql              ← 3 หลัก ❌
006_sprint1_announcement_metadata.sql     ← 3 หลัก ❌
007_organizations_display_order.sql       ← 3 หลัก ❌
008_position_masters.sql          ← 3 หลัก ❌
009_template_sections.sql         ← 3 หลัก ❌
010_recover_negative_display_order.sql   ← 3 หลัก ❌
011_field_type_master_data.sql    ← 3 หลัก ❌
015_fix_template_fields_fk_target.sql    ← 3 หลัก ❌
015_rollback.sql                  ← 3 หลัก + duplicate ❌❌
016_templates_deleted_at.sql      ← 3 หลัก ❌
017_audit_logs_performance_indexes.sql   ← 3 หลัก ❌
018_add_template_field_validation_message.sql  ← 3 หลัก ❌
```

**ผลกระทบ:**

- Cloudflare Wrangler เรียง migration ตาม filename (string comparison)
- เมื่อเรียง lexicographic: `002_xxx` < `015_xxx` < `0001_xxx` (เนื่องจาก string sort ให้ `0` < `1` แต่ `0001` < `002` ในบาง OS)
- ผลคือ migration อาจถูก apply ผิดลำดับ → FK violation, schema corruption

**ตัวอย่างที่เกิดขึ้นจริง:**

```
015_fix_template_fields_fk_target.sql
015_rollback.sql
```

ทั้ง 2 ไฟล์มี prefix `015_` เหมือนกัน → Wrangler คิดว่าเป็น 2 migration ที่ต้อง apply ตามลำดับตัวอักษรของชื่อ ไม่ใช่ตามลำดับเลข

**ความเสี่ยง:** 🔴 CRITICAL

> **อัปเดต 25 ตุลาคม 2569 — RESOLVED (เรื่องเลขสาม/สี่หลัก):**
> Business Decision ยืนยันให้ระบบเลขของ repo เป็น "สามหลักต่อจากเลขสูงสุดจริง" (026 → 027)
> พร้อมกันนั้น `scripts/check-migrations.js` ถูกปรับให้ตรวจ `^[0-9]{3,4}_` (สี่หลักยอมเฉพาะ
> legacy 0000–0002) และ 019–026 ที่ apply จริงแล้วถูกบันทึกเป็น Legacy Baseline ครบถ้วน
> (duplicate 020×2 เป็น documented exception เช่นเดียวกับ 015×2) —
> รายละเอียดดู `docs/MIGRATION_GOVERNANCE.md` มาตรา 2 (ฉบับ 25 ต.ค. 2569)
> ปัญหาคงเหลือจาก Finding นี้: ไฟล์ `015_rollback.sql` ยังอยู่ใน migrations/ (ตามห้าม rename) — ดู Finding #3

---

### 3. มี Rollback File ปะปนใน Migration Folder

**รายละเอียด:**

ไฟล์ `backend/migrations/015_rollback.sql` เป็น rollback script ที่:

- วางอยู่ใน folder migration หลัก
- Wrangler scan ไฟล์ `.sql` ทุกไฟล์ใน folder และ apply โดยไม่สนใจว่าเป็น forward หรือ rollback
- ถ้า OS sort ไฟล์ `015_rollback.sql` มาก่อน `015_fix_template_fields_fk_target.sql` → apply rollback ก่อน apply fix → schema ผิด

**ผลกระทบ:**

- Wrangler apply rollback script โดยไม่ตั้งใจ → reverse schema
- หรือถ้า rename ไฟล์ migration หลักแต่ลืม rename rollback → ledger desync

**ความเสี่ยง:** 🔴 CRITICAL

---

### 4. เคยเกิด Migration Drift ในอดีต

**รายละเอียด:**

จากหลักฐานใน `docs/D1_MIGRATION_RECOVERY_PLAN.md`:

- Production เคย apply migration ผ่าน `wrangler d1 execute --file=...` แทน `wrangler d1 migrations apply`
- ผลคือ `d1_migrations` ledger ไม่มี record ของ migration เหล่านั้น แม้ schema จะ apply ไปแล้ว
- ทีมต้องเขียน recovery plan เพื่อ reconcile ledger กับ schema

**Backup file `backend/backup-before-sprint4.sql` มี INSERT เข้า `d1_migrations` เป็นหลักฐาน:**

```sql
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_normal_alex_wilder.sql',...);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0001_applications_management.sql',...);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0002_audit_trail.sql',...);
```

→ ยืนยันว่า production ใช้ `backend/migrations/` เป็น source of truth และ 3 migration แรก (0000-0002) apply ไปแล้ว

**ผลกระทบ:**

- การ apply migration ใหม่ในอนาคตอาจ skip หรือ double-apply โดยไม่รู้ตัว
- ต้อง verify ledger กับ schema จริงก่อน apply migration ใหม่ทุกครั้ง

**ความเสี่ยง:** 🔴 CRITICAL

---

### 5. Cloudflare Wrangler ใช้ Filename เป็น Identity

**รายละเอียด:**

Cloudflare Wrangler ใช้ **filename (string)** เป็น unique identity ของ migration ในตาราง `d1_migrations` บน D1

**กลไก:**

1. เมื่อรัน `wrangler d1 migrations apply sao-db --remote`
2. Wrangler scan ไฟล์ `.sql` ใน default migrations folder
3. เทียบกับ `d1_migrations` table ว่าไฟล์ไหน apply ไปแล้ว
4. Apply เฉพาะไฟล์ที่ยังไม่มีใน ledger
5. INSERT row ใหม่ใน `d1_migrations` ด้วย filename เป็น primary key

**ผลกระทบ:**

- ถ้า rename migration ที่ apply production ไปแล้ว → Wrangler "ไม่รู้จัก" migration นั้น → apply migration ใหม่ซ้ำ → schema corruption
- การแก้ production ledger โดยตรง (`DELETE FROM d1_migrations WHERE name=...`) เป็นเรื่องอันตรายมาก ไม่มี transaction safety

**ความเสี่ยง:** 🔴 CRITICAL

---

### 6. ความเสี่ยงของการ Rename Migration ที่ถูก Deploy แล้ว

**รายละเอียด:**

Migration ที่ deploy ไปยัง production แล้ว จะถูกบันทึกใน `d1_migrations` table โดยใช้ **filename** เป็น identity

**สถานการณ์ที่เกิดขึ้น:**

| Action | ผลลัพธ์ |
|---|---|
| Rename `0000_xxx.sql` → `0000_yyy.sql` | Wrangler คิดว่า `0000_yyy.sql` เป็น migration ใหม่ → apply schema ใหม่ซ้ำ → `table already exists` error |
| Delete `0000_xxx.sql` | Wrangler ไม่มีปัญหา (ไม่ apply migration ที่ไม่มีใน folder) แต่ ledger ใน D1 ยังคงมี record → audit trail เพี้ยน |
| Move `0000_xxx.sql` ไป folder อื่น | Wrangler scan ไม่เจอ → คิดว่ายังไม่ apply → apply ใหม่ถ้า move กลับ |
| Modify SQL ใน `0000_xxx.sql` | Schema ใน D1 ไม่เปลี่ยน (มี row ใน ledger แล้ว) แต่ schema ใน repo ≠ schema ใน D1 → drift |

**ความเสี่ยง:** 🔴 CRITICAL

**ข้อสรุป:** **ห้าม rename, ห้าม delete, ห้าม move, ห้าม modify migration ที่ merge เข้า main แล้ว**

---

## 📊 Risk Matrix

| # | ประเด็น | ความเสี่ยง | Impact | Probability |
|---|---|---|---|---|
| 1 | มี migration 2 ระบบ | 🔴 CRITICAL | High | High |
| 2 | Naming ไม่สม่ำเสมอ | 🔴 CRITICAL | High | High |
| 3 | Rollback file ปะปน | 🔴 CRITICAL | High | High |
| 4 | Migration Drift เคยเกิด | 🔴 CRITICAL | High | High |
| 5 | Filename = identity | 🔴 CRITICAL | High | High |
| 6 | Rename deployed migration | 🔴 CRITICAL | High | Medium |

---

## ✅ แผนแก้ไข (Remediation Plan)

### Phase 0 — Immediate (1-3 วัน)

- [x] สร้าง `docs/MIGRATION_GOVERNANCE.md` (governance policy)
- [x] สร้าง `backend/migrations/README.md` (อธิบาย source of truth)
- [x] สร้าง `backend/fixes/README.md` (rollback policy)
- [x] สร้าง `backend/backups/README.md` (backup policy)
- [x] สร้าง `backend/scripts/migrations/README.md` (ad-hoc scripts)
- [x] สร้าง `.github/workflows/migration-validation.yml` (CI guard)
- [x] สร้าง `scripts/check-migrations.js` (linter)
- [x] เพิ่ม `migration:check` script ใน `package.json`

### Phase 1 — Short-term (1-2 สัปดาห์)

- [ ] **Verify production ledger** — เปรียบเทียบ `d1_migrations` table กับไฟล์ใน `backend/migrations/`
- [ ] **Backfill ledger** — ถ้าพบ migration ที่ schema apply แล้วแต่ไม่มีใน ledger → INSERT row เข้า `d1_migrations`
- [ ] **Move `015_rollback.sql` ไป `backend/fixes/`** — ห้าม apply ผ่าน `migrations apply`
- [ ] **Lock `backend/drizzle/` folder** — เพิ่ม `.gitignore` rule หรือเปลี่ยนเป็น read-only

### Phase 2 — Medium-term (2-4 สัปดาห์)

- [ ] **Audit production schema** — เทียบ schema จริงใน D1 กับ SQL ใน `backend/migrations/`
- [ ] **Reconcile drift** — ถ้าพบ migration ที่ apply แล้วแต่ไม่มีไฟล์ → เขียน migration ใหม่ที่เป็น no-op
- [ ] **Refactor drizzle/** — ตัดสินใจว่าจะ archive หรือลบ (หลัง verify ว่าไม่มี dependency)
- [ ] **Run disaster recovery drill** — simulate "production ledger corrupt" แล้วซ้อม restore

### Phase 3 — Long-term (1-3 เดือน)

- [ ] **Migrate to Drizzle only** — ถ้าตัดสินใจใช้ Drizzle เป็น single source of truth → migrate ทุก migration เข้า Drizzle schema
- [ ] **Setup CI/CD** — integrate migration validation เข้า GitHub Actions
- [ ] **Database Steward rotation** — กำหนดคนดูแล migration governance อย่างเป็นทางการ

---

## 📚 เอกสารอ้างอิง

- [Migration Governance Policy](./MIGRATION_GOVERNANCE.md) — กฎกลาง
- [D1 Migration Recovery Plan](./D1_MIGRATION_RECOVERY_PLAN.md) — บันทึกเหตุการณ์ drift ที่เคยเกิด
- [Production Readiness Report](./PRODUCTION_READINESS_REPORT.md)
- Cloudflare Docs: [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)

---

**ผู้อนุมัติ:** Backend Lead
**วันที่อนุมัติ:** 14 ตุลาคม 2569
