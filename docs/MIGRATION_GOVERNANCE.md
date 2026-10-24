# Migration Governance Policy

> **กฎกลางสำหรับการจัดการ Database Migration ของโปรเจกต์ Recruitment**
> มีผลบังคับใช้กับทุกคนในทีม Backend, Frontend, DevOps
> อัปเดตล่าสุด: 25 ตุลาคม 2569 (ปรับ Naming Convention ตาม Business Decision เรื่องเลขสามหลัก)

---

## 1. Source of Truth

**`backend/migrations/` คือแหล่งข้อมูลเดียวเท่านั้น (Single Source of Truth) สำหรับ Database Migration ทั้งหมด**

- Cloudflare Wrangler จะ scan โฟลเดอร์นี้เมื่อรัน `wrangler d1 migrations apply`
- ทุก migration ที่ apply ไปยัง D1 จะถูกบันทึกในตาราง `d1_migrations` ใน D1 โดยใช้ **filename เป็น unique identity**
- ห้ามสร้าง migration ใหม่ใน `backend/drizzle/` โดยเด็ดขาด
- โฟลเดอร์ `backend/drizzle/` ถือเป็น **frozen read-only reference** ห้าม generate / แก้ / ลบ ไฟล์ใด ๆ ในนั้น

### โครงสร้างที่ถูกต้อง
```
backend/
├── migrations/         ← ✅ SOURCE OF TRUTH (เพิ่มไฟล์ได้อย่างเดียว)
├── fixes/              ← ✅ เก็บ rollback / emergency fix เท่านั้น
├── backups/            ← ✅ เก็บ full DB backup
├── scripts/migrations/ ← ✅ เก็บ ad-hoc test SQL
└── drizzle/            ← ❌ FROZEN (ห้ามแตะ)
```

---

## 1.1 Legacy Migrations Exception Policy (อัปเดต 25 ต.ค. 2569)

> **Migration ที่สร้าง/apply ก่อนวันที่ 25 ตุลาคม 2569 ถือเป็น "Legacy Baseline" และได้รับการยกเว้นจากกฎ Naming Convention**

### ไฟล์ที่อยู่ใน Legacy Baseline (26 ไฟล์ — ตรงกับ `LEGACY_BASELINE` ใน `scripts/check-migrations.js`)

**3-digit prefix (23 ไฟล์) — ผิด naming convention แต่ห้าม rename (production ledger อ้างอิงชื่อเดิม):**

```
002_field_master_enhancement.sql          015_fix_template_fields_fk_target.sql
003_validation_required_fix.sql           015_rollback.sql          ← duplicate prefix (documented exception)
004_field_master_enhancement_phase0.sql   016_templates_deleted_at.sql
005_organizations.sql                     017_audit_logs_performance_indexes.sql
006_sprint1_announcement_metadata.sql     018_add_template_field_validation_message.sql
007_organizations_display_order.sql       019_application_number_pattern.sql
008_position_masters.sql                  020_auth_hardening.sql    ← duplicate prefix (documented exception)
009_template_sections.sql                 020_role_model_v1.sql     ← duplicate prefix (documented exception)
010_recover_negative_display_order.sql    022_template_versions_descriptor.sql
011_field_type_master_data.sql            023_admin_users_last_login_at.sql
                                         024_role_migration.sql
                                         025_user_management_reconciliation.sql
                                         026_other_option_support.sql
```

**4-digit prefix (3 ไฟล์) — apply production แล้วก่อน governance adoption:**

```
0000_normal_alex_wilder.sql
0001_applications_management.sql
0002_audit_trail.sql
```

### เหตุผลที่ยกเว้น

1. **Production ledger อ้างอิงชื่อเดิม** — Cloudflare Wrangler บันทึก filename ลงใน `d1_migrations` table บน D1 ดังนั้นการ rename = production ledger desync
2. **Apply production ไปแล้ว** — migration เหล่านี้ apply ไปยัง production แล้ว (ยืนยันจาก `backup-before-sprint4.sql` และ deployment logs)
3. **ห้าม rename ตามกฎ Immutable Migration** — migration ที่ merge เข้า `main` แล้วถือเป็น immutable record
4. **Cost ของการ rename สูงกว่าประโยชน์** — ต้อง verify schema, backfill ledger, risk schema corruption ทั้งหมดเพื่อแค่ชื่อไฟล์ที่ "สวยขึ้น"

### Validation Rules สำหรับ Legacy Migrations

| Rule | Legacy Files | New Files (หลัง 14 ต.ค. 2569) |
|---|---|---|
| **Filename format** (`NNN_description.sql` — สามหลักต่อจากเลขสูงสุดจริง) | ⚠️ Exempt | ✅ Required |
| **Duplicate prefix check** | ⚠️ Exempt | ✅ Required |
| **Forbidden keywords** (rollback/down/revert/fix/drop) | ⚠️ Exempt | ✅ Required |
| **Immutability** (ห้าม rename/delete/modify) | ✅ Enforced | ✅ Enforced |
| **CI validation** | ⚠️ Exempt | ✅ Enforced |

### ผลกระทบต่อ CI

- **Legacy files** จะ **ไม่ถูกตรวจสอบ** ใน CI pipeline (ทั้ง filename format, duplicate prefix, forbidden keywords)
- **New files** ที่เพิ่มหลังจากวันที่ governance adoption จะถูกตรวจสอบ **strictly**
- **ทุกไฟล์** (รวม legacy) ยังคงถูก enforce immutability — ห้าม rename/delete/modify

### วิธีเพิ่ม Legacy File เข้า Baseline

ถ้ามี migration เดิมที่ยังไม่ได้อยู่ใน baseline และต้องการ exempt:

1. Verify ว่าไฟล์นั้น apply production ไปแล้วจริง (เช็คจาก `d1_migrations` ledger)
2. ได้รับ approval จาก Backend Lead
3. Update `LEGACY_BASELINE` ใน `scripts/check-migrations.js`
4. Update รายการในหัวข้อ 1.1 ของเอกสารนี้
5. Commit พร้อมคำอธิบายเหตุผล

---

## 2. Naming Convention

> **Business Decision (25 ตุลาคม 2569): ระบบเลขของ Repository คือ "เลขสามหลัก" สืบต่อจากเลขสูงสุดจริง**
> ประวัติ: repo เริ่มด้วย 0000–0002 (สี่หลัก, drizzle สร้าง) แล้วสลับเป็นสามหลักตั้งแต่ 002 ต่อเนื่องถึง
> 026_other_option_support.sql — ทุกไฟล์หลังจากนั้น (เริ่มจาก 027) **ใช้เลขสามหลักต่อจากเลขสูงสุดจริงเสมอ**
> ห้ามเปลี่ยนระบบเลขกลางทาง และห้าม rename migration ที่ apply แล้วเพื่อ "ทำให้เลขสวย"

### Format บังคับ

```
NNN_description.sql
```

### กฎทั้งหมด

| # | กฎ | ✅ ตัวอย่างที่ถูก | ❌ ตัวอย่างที่ผิด |
|---|---|---|---|
| 1 | ใช้เลขสามหลัก zero-padded **ต่อจากเลขสูงสุดจริงใน repo** (ปัจจุบันล่าสุด = 027) | `028` | `027_2_xxx.sql` (เลขล้น), `28` (ขาด zero-pad) |
| 2 | ตัวเลขต่อเนื่องจากไฟล์สูงสุด ไม่ข้าม ไม่ซ้ำ | 027 → 028 | 027 → 030 (ข้าม), 027 → 027 (ซ้ำ) |
| 3 | Underscore 1 ตัวคั่น prefix กับ description | `028_applications.sql` | `028-applications.sql` |
| 4 | lowercase ทั้งหมด | `audit_trail.sql` | `Audit_Trail.sql`, `AUDIT_TRAIL.sql` |
| 5 | ใช้ snake_case สำหรับ description | `add_template_field_validation_message.sql` | `addTemplateFieldMessage.sql` |
| 6 | ห้ามมีคำว่า `rollback`, `down`, `revert`, `fix`, `drop` ในชื่อ | — | `028_rollback.sql`, `028_fix_xxx.sql` |
| 7 | ห้าม duplicate numeric prefix ใน folder เดียวกัน เว้นแต่เป็น Legacy Exception ที่บันทึกใน `LEGACY_BASELINE` แล้ว (ปัจจุบัน: 015×2, 020×2) | — | `028_a.sql`, `028_b.sql` |
| 8 | ไม่มี random word หรือ random hash ในชื่อ | `field_master_enhancement.sql` | `028_demonic_whistler.sql` |

### ตัวอย่างชื่อที่ถูกต้อง

```
027_application_attachments_original_filename.sql
028_<description>.sql   (ไฟล์ถัดไปหลัง 027)
```

### ตัวอย่างชื่อที่ผิด (จะถูก CI block)

```
28_applications.sql             ← ขาด zero-pad (สองหลัก)
0028_applications.sql           ← สี่หลัก — เปลี่ยนระบบเลขกลางทาง (Business Decision ใช้สามหลัก)
028-applications.sql            ← ใช้ hyphen
028Applications.sql             ← camelCase
028_applications                ← ขาด .sql
028_rollback.sql                ← มีคำว่า rollback
028_fix_template_fields.sql     ← มีคำว่า fix
028_Applications_v2.sql         ← มีตัวพิมพ์ใหญ่
```

### กฎเลขพิเศษ

- **Migration ใหม่ทุกไฟล์ต้องตรวจก่อนสร้างว่าไม่มีเลขนั้นอยู่แล้ว** — หากพบเลขถัดไปถูกใช้แล้ว ให้หยุดและรายงานเจ้าของระบบ ห้ามเดาเลขถัดไปเอง
- **ห้าม rename / แก้ / ย้าย migration ที่ apply แล้ว** (ดูมาตรา 3 Immutable Migration Policy)
- **Legacy 0000–0002 (สี่หลัก) คงชื่อเดิมตลอดกาล** — อนุญาตให้มีอยู่ใน folder แต่ห้ามสร้างไฟล์สี่หลักใหม่

---

## 3. Immutable Migration Policy

> **Migration ที่ merge เข้า `main` แล้ว ถือเป็น "Immutable Record" ห้ามแก้ ห้าม rename ห้ามลบ ตลอดกาล**

### เหตุผล

- Cloudflare Wrangler ใช้ **filename (string)** เป็น unique identity ของ migration ในตาราง `d1_migrations` บน D1
- ถ้า rename migration ที่ apply production ไปแล้ว → Wrangler จะ "ไม่รู้จัก" migration นั้น และ apply migration ใหม่ซ้ำ → schema corruption
- การแก้ production ledger โดยตรง (`DELETE FROM d1_migrations`) เป็นเรื่องอันตรายมาก ไม่มี transaction safety

### สิ่งที่ทำได้ vs ทำไม่ได้

| Action | อนุญาต? | เหตุผล |
|---|---|---|
| เพิ่ม migration ใหม่ (prefix ใหม่) | ✅ | Append-only |
| แก้ SQL ของ migration ที่ merge แล้ว | ❌ | ทำลาย immutability |
| Rename migration ที่ merge แล้ว | ❌ | ทำให้ production ledger desync |
| ลบ migration ที่ merge แล้ว | ❌ | ทำให้ production ledger desync |
| Move migration ไป folder อื่น | ❌ | Wrangler scan เฉพาะ folder เดิม |
| เพิ่ม row ใน `d1_migrations` ledger โดยตรง | ⚠️ | อนุญาตเฉพาะกรณี backfill หลัง verify schema แล้ว ต้องมี PR review 2 คน |

---

## 4. Rollback Policy

### หลักการ: Forward-Only

> **Production ใช้ "Forward-Only Migration" เท่านั้น ไม่มีการ rollback โดยใช้ไฟล์ .rollback.sql**

### ถ้าจำเป็นต้อง undo schema change

1. **เขียน migration ใหม่** ที่ "reverse" schema change นั้น
2. ตั้งชื่อ migration ใหม่ตาม convention ปกติ เช่น `0019_revert_add_column_xxx.sql`
3. Apply migration ใหม่นี้ตาม deploy process ปกติ

### ไฟล์ `.rollback.sql` หรือ `.down.sql`

- ห้ามวางใน `backend/migrations/`
- เก็บใน `backend/fixes/` เท่านั้น
- ห้าม apply ผ่าน `wrangler d1 migrations apply`
- ใช้สำหรับ emergency recovery เท่านั้น และต้องมี incident postmortem ภายใน 48 ชม.

### Emergency Rollback Procedure

```
1. STOP deploy ทันที
2. ประเมิน impact: schema เสียหายหรือไม่, data เสียหายหรือไม่
3. ถ้า schema เสียหาย:
   a. ใช้ไฟล์ใน backend/fixes/ ที่เตรียมไว้
   b. รันด้วย: wrangler d1 execute sao-db --remote --file=./fixes/xxx.sql
   c. ห้ามใช้ wrangler d1 migrations apply
4. ถ้า data เสียหาย:
   a. Restore จาก backup: wrangler d1 execute sao-db --remote --file=/tmp/backup-*.sql
5. เปิด incident postmortem ภายใน 24 ชม.
6. เขียน forward migration เพื่อ reconcile ledger
```

---

## 5. Deployment Workflow

### Local Development

```bash
# 1. สร้าง migration ใหม่ (ใช้ prefix ถัดไปจาก migration ล่าสุด)
cp backend/migrations/0018_xxx.sql backend/migrations/0019_yyy.sql

# 2. แก้ SQL ในไฟล์ใหม่

# 3. ตรวจสอบด้วย linter
npm run migration:check

# 4. ทดสอบ local
npm run db:migrate
# = wrangler d1 migrations apply sao-db --local

# 5. ทดสอบ idempotency (รันซ้ำต้องไม่ error)
npm run db:migrate
```

### Staging Validation

```bash
# 1. Apply บน staging
wrangler d1 migrations apply sao-db-staging --remote

# 2. ตรวจสอบ ledger
wrangler d1 execute sao-db-staging --remote \
  --command="SELECT name FROM d1_migrations ORDER BY id;"

# 3. ตรวจสอบ schema integrity
wrangler d1 execute sao-db-staging --remote \
  --command="PRAGMA integrity_check;"

# 4. รอ ≥ 24 ชม. แล้วค่อย promote ไป production
```

### Production Deploy

```bash
# 1. Backup ก่อนทุกครั้ง
wrangler d1 export sao-db /tmp/backup-pre-$(date +%Y%m%d_%H%M%S).sql --remote

# 2. Apply migration
wrangler d1 migrations apply sao-db --remote

# 3. Verify ledger
wrangler d1 execute sao-db --remote \
  --command="SELECT name FROM d1_migrations ORDER BY id;"

# 4. Smoke test
curl https://api.example.com/v1/healthz
# ตรวจ endpoint ที่เกี่ยวข้องกับ schema ที่เปลี่ยน

# 5. ถ้า fail → rollback ตาม Emergency Rollback Procedure
```

### ห้าม

- ❌ ใช้ `wrangler d1 execute --file=...` แทน `migrations apply` ในกรณีปกติ
- ❌ Apply migration ข้าม staging
- ❌ Apply migration หลายไฟล์พร้อมกันโดยไม่ smoke test ระหว่างทาง

---

## 6. Staging Validation

ทุก migration ต้องผ่านเกณฑ์ก่อน promote ไป production:

| # | เกณฑ์ | เกณฑ์ผ่าน |
|---|---|---|
| 1 | Apply บน local `--local` | exit code 0, ไม่มี error |
| 2 | Apply บน local ซ้ำ (idempotency) | exit code 0, ไม่มี error |
| 3 | Apply บน staging `--remote` | exit code 0 |
| 4 | Uptime บน staging | ≥ 24 ชม. ไม่มี regression |
| 5 | Schema diff check | ตรงกับที่คาดหวัง (เทียบกับ PR description) |
| 6 | Integration test (ถ้ามี) | ผ่าน 100% |
| 7 | PR review | ≥ 1 Backend Lead approve |

---

## 7. Production Safety Rules

### กฎเหล็ก (ต้องปฏิบัติตามทุกครั้ง)

1. **Backup ก่อน Apply** — ทุกครั้งที่ apply migration บน production ต้อง export full DB ก่อน
2. **Smoke test หลัง Apply** — Apply เสร็จต้องตรวจ endpoint หลักทันที
3. **Verify Ledger** — เช็คว่า migration ใหม่ปรากฏใน `d1_migrations` table
4. **มี Rollback Plan** — PR ทุกใบต้องระบุ rollback plan ในคำอธิบาย
5. **ห้าม Apply ในช่วงเวลาทำการ** — Production deploy ต้องทำใน low-traffic window (เช่น หลัง 22:00)
6. **มีคนดูแลตลอดการ Apply** — ห้าม apply แล้วปล่อยทิ้ง

### Incident Response

```
ระดับ 1 (Schema corruption):  rollback ทันที + postmortem 24 ชม.
ระดับ 2 (Data inconsistency):  pause + investigate + postmortem 48 ชม.
ระดับ 3 (Performance issue):  schedule fix migration + postmortem 1 สัปดาห์
```

---

## 8. Migration Checklist

### Pre-merge (ผู้เขียน migration)

- [ ] **Number ถูกต้อง** — ใช้เลขสามหลัก zero-padded ต่อจาก migration ล่าสุดจริงใน repo (ล่าสุดปัจจุบัน = 027 → ไฟล์ถัดไป 028) และตรวจก่อนสร้างว่ายังไม่มีเลขนั้น
- [ ] **ไม่ซ้ำ prefix** — `ls backend/migrations/` แล้วไม่มี prefix นี้
- [ ] **ไม่ rename migration เดิม** — `git diff` แสดงเฉพาะ "new file"
- [ ] **ชื่อเป็น lowercase + underscore** — ไม่มี camelCase, hyphen, ตัวพิมพ์ใหญ่
- [ ] **ไม่มีคำว่า `rollback`/`down`/`revert`/`fix` ในชื่อ**
- [ ] **SQL รันได้บน local** — `npm run db:migrate` ผ่าน
- [ ] **SQL idempotent** — รัน 2 ครั้งติด ๆ ไม่ error (ใช้ `IF NOT EXISTS` กับ CREATE/ALTER)
- [ ] **มี comment header** — อธิบาย feature + ticket link
- [ ] **FK / Index ครบ** — ไม่ลืมสร้าง index สำหรับ column ใหม่
- [ ] **ไม่มี production data ใน migration** — INSERT เฉพาะ master data เช่น `field_type_master`
- [ ] **รัน `npm run migration:check`** — ผ่าน ไม่มี error

### Schema Consistency (CI ตรวจอัตโนมัติ)

- [ ] **Filename format** — `^[0-9]{3,4}_[a-z0-9_]+\.sql$` (ไฟล์ใหม่ใช้สามหลัก; {3,4} เพื่อรองรับ legacy 0000–0002 ใน folder เดียวกัน)
- [ ] **ไม่มี duplicate prefix**
- [ ] **ไม่มี rollback/down/revert ในชื่อ**
- [ ] **ไม่มี migration ใหม่ใน `backend/drizzle/`**
- [ ] **PR แตะ `backend/migrations/**` ต้องมี label `schema-change`**

### Post-merge (ผู้ review)

- [ ] **Diff แสดงเฉพาะ "new file"** — ไม่มี "rename" / "delete" / "modify"
- [ ] **DDL syntax compatible กับ SQLite/D1** — ไม่ใช้ `ENUM`, `BOOLEAN`, `TIMESTAMP` ที่ไม่มี mapping
- [ ] **ถ้าใช้ `PRAGMA foreign_keys=OFF`** — มี `PRAGMA foreign_keys=ON` ปิดท้าย + มีคำอธิบาย
- [ ] **Migration number ต่อจากของเดิม**
- [ ] **มี rollback plan ใน PR description**

### Production Deploy (ผู้ release)

- [ ] **Backup ก่อน apply**
- [ ] **Apply แล้ว verify ledger**
- [ ] **Smoke test ผ่าน**
- [ ] **แจ้งทีมใน #deploy channel**

---

## 9. CI Validation

ไฟล์ CI อยู่ที่ `.github/workflows/migration-validation.yml`

**ตรวจอัตโนมัติ:**

1. **Filename format** — ต้อง match regex `^[0-9]{3,4}_[a-z0-9_]+\.sql$` (ไฟล์ใหม่ = สามหลักต่อเนื่องจากเลขสูงสุดจริง; สี่หลักยอมเฉพาะ legacy 0000–0002)
2. **Duplicate prefix** — ตรวจว่าไม่มี prefix ซ้ำใน folder
3. **No rollback file** — ตรวจว่าไม่มีไฟล์ที่มีคำว่า rollback/down/revert ในชื่อ
4. **No new file in drizzle/** — ตรวจว่าไม่มี migration ใหม่ใน `backend/drizzle/`

**CI จะ fail ทันทีถ้า:**
- มีไฟล์ migration ใหม่ที่ชื่อผิด format
- มี duplicate prefix
- มี rollback file ใน `backend/migrations/`
- มีการแก้ไขไฟล์ใน `backend/drizzle/`

---

## 10. Roles & Responsibilities

| Role | Owner | Responsibility |
|---|---|---|
| Database Steward | Backend Lead | อนุมัติ PR migration, ตัดสิน naming dispute, ตัดสิน rollback plan |
| Migration Author | Feature Dev | เขียน migration + ผ่าน checklist + request review |
| Production Releaser | Tech Lead / DevOps | รัน apply, verify, smoke test |
| Backup Owner | DevOps | Daily `wrangler d1 export`, เก็บใน R2 |
| CI Maintainer | Backend Lead | ดูแล `.github/workflows/migration-validation.yml` |

---

## 11. References

- [D1_MIGRATION_RECOVERY_PLAN.md](./D1_MIGRATION_RECOVERY_PLAN.md) — บันทึกเหตุการณ์ Migration Drift ที่เคยเกิด
- [MIGRATION_AUDIT_2026.md](./MIGRATION_AUDIT_2026.md) — รายงาน audit ครั้งล่าสุด
- [PRODUCTION_READINESS_REPORT.md](./PRODUCTION_READINESS_REPORT.md) — Production readiness
- Cloudflare Docs: [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)

---

**หากมีข้อสงสัยหรือต้องการเสนอแก้ไข policy นี้ กรุณาเปิด PR พร้อม tag Backend Lead**
