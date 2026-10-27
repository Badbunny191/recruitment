# C8 — Production Readiness Verification Bundle

**วันที่:** 2026-10-28 · **เป้าหมาย:** ประเมินความพร้อม Production D1 (`sao-db`) ก่อน Migration 030 (unique index + CHECK rebuild)

**ขอบเขตการรัน:** Read-only เท่านั้น — ทุกคำสั่งเป็น `SELECT` / `sqlite_master` อ่าน / `wrangler secret list` (แสดงชื่อเท่านั้น) ผ่าน `npx wrangler d1 execute sao-db --remote`
**หลักฐานความปลอดภัย:** `meta.rows_written = 0` และ `meta.changed_db = false` ทุก query · ไม่มีการ apply migration · ไม่มีการ deploy · PII ปกปิดทั้งหมด (email mask, ไม่ query national_id)

---

## Section A — Migration State

ผลจาก `SELECT id, name, applied_at FROM d1_migrations ORDER BY id` — รวม **29 แถว**

| คำถาม | ผลตรวจ |
|---|---|
| Migration ล่าสุด | `029_attachment_uploads_ledger.sql` — applied **2026-10-26 16:53:31 UTC** |
| 029 apply แล้วหรือยัง | **แล้ว** ✅ (แถวล่าสุดของ ledger) |
| 015_rollback ปรากฏหรือไม่ | **ปรากฏ** — `015_rollback.sql` applied 2026-10-14 14:48:40 UTC โดยมี `015_fix_template_fields_fk_target.sql` applied ก่อนหน้า 2 นาที (14:46:10) |

ข้อสังเกตเพิ่มเติม (ไม่ block 030):

- **Ledger id กระโดด: มี id 1–3 แล้วข้ามไป 16–41** — id 4–15 หายไป สอดคล้องกับการ recovery ledger ในอดีต (docs/D1_MIGRATION_RECOVERY_PLAN.md) ชื่อ migration ปัจจุบันต่อเนื่องถูกต้อง 016→029
- `020_auth_hardening.sql` และ `020_role_model_v1.sql` ถูก apply **ทั้งคู่** (2026-10-15) — เป็นเจตนาของ chain เดิม
- คู่ 015: rollback apply หลัง fix → state จริงของ FK `template_fields` ต้องเช็คแยก (เป็นประเด็น known issue จาก audit เดิม) — **ไม่เกี่ยวกับ 030** ที่แตะเฉพาะตาราง `applications`
- **ใน repo ยังไม่มีไฟล์ migration 030** (`backend/migrations/` ถึง 029 เท่านั้น) — ต้องเขียนก่อน

## Section B — Schema State

ผลจาก `sqlite_master` — DDL จริงของ `applications` ใน Production:

```sql
CREATE TABLE "applications" (
  `id` text PRIMARY KEY NOT NULL,
  `application_no` text,
  `round_id` text NOT NULL,
  `email` text NOT NULL,
  `fullname` text NOT NULL,
  `national_id` text,
  `status` text DEFAULT 'SUBMITTED',
  `status_reason` text,
  `verified_by` text,
  `verified_at` integer,
  `form_data` text NOT NULL,
  `submitted_at` integer DEFAULT (unixepoch()),
  `deleted_at` integer, year INTEGER, round_code TEXT, seq_in_round INTEGER,
  FOREIGN KEY (`round_id`) REFERENCES `recruitment_rounds`(`id`) ...,
  CONSTRAINT "chk_app_status" CHECK("applications"."status" IN
    ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'))
)
```

| ประเด็น | ผลตรวจ |
|---|---|
| **CHECK constraint ปัจจุบัน (prod)** | `chk_app_status` มีอยู่จริง 7 ค่า: `DRAFT, SUBMITTED, UNDER_REVIEW, QUALIFIED, REJECTED, CANCELED, ARCHIVED` |
| **national_id** | **NULLABLE** (ไม่มี NOT NULL) — และข้อมูลจริง: NULL **20/20 แถว (100%)** |
| **enum status ที่ใช้งานจริง (data)** | QUALIFIED 13 · SUBMITTED 5 · ARCHIVED 1 · REJECTED 1 (รวม 20 แถว) — ไม่มีแถวใดมี `UNDER_REVIEW` หรือค่านอก CHECK |

**CHECK drift ที่พบ (ตัวจริงสำหรับ 030):**

- Prod CHECK มี `'UNDER_REVIEW'` แต่โค้ด `backend/src/db/schema.ts:201` กำหนดเพียง 6 ค่า (ไม่มี UNDER_REVIEW)
- `grep UNDER_REVIEW` ทั้ง backend + frontend (นอก test): **0 จุดใช้งาน** — เป็น dead value ใน prod เท่านั้น
- → Rebuild CHECK ให้ตรงกับ code enum (ตัด UNDER_REVIEW ออก) **ปลอดภัย** ไม่มี code path เขียนค่านี้ และไม่มีข้อมูลเดิมค่านี้

**Drift signature อื่น:** คอลัมน์ `year, round_code, seq_in_round` ถูก append ต่อท้าย `deleted_at` ใน CREATE statement เดียว (ร่องรอย recovery จาก 019) — ทำงานถูกต้อง แต่ 030 ตอน rebuild ควรจัดรูป DDL ใหม่ให้สะอาดตาม drizzle schema

`attachment_uploads` ตรงกับไฟล์ 029 ทุกคอลัมน์ (id, r2_key UNIQUE, status CHECK TEMP/ACTIVE/DELETED, application_id nullable + FK, uploaded_at, original_filename, delete_token_hash, activated_at, deleted_at)

## Section C — Index State

Indexes ทั้งหมดของ `applications` (8 รายการ):

| Index | นิยาม | Unique |
|---|---|---|
| `applications_application_no_unique` | (application_no) | ✅ UNIQUE |
| `idx_apps_round` | (round_id) | — |
| `idx_apps_round_code` | (round_code) | — |
| `idx_apps_round_status` | (round_id, status) | — |
| `idx_apps_status` | (status) | — |
| `idx_apps_year` | (year) | — |
| `idx_apps_year_round_code` | (year, round_code) | — |
| `sqlite_autoindex_applications_1` | PK (id) (อัตโนมัติ) | ✅ |

**`idx_apps_round_email`: ยังไม่มี** — ยืนยันว่า unique index กันสมัครซ้ำต้องสร้างใหม่ทั้งหมดโดย 030 (ช่องโหว่สมัครซ้ำยังเปิดอยู่ใน prod ณ วันตรวจ)

## Section D — Duplicate Risk

ผลจาก `GROUP BY (round_id, lower(email)) HAVING COUNT(*) > 1` บนทั้ง 20 แถว:

- **พบ 1 กลุ่ม (2 แถว)** — ตารางเดียวในระบบ:

| id (ย่อ) | application_no | status | email (mask) | submitted_at |
|---|---|---|---|---|
| d2a3b1cd | APP-2026-5018 | **ARCHIVED** | ma***@xxx.com | 1792764517 (≈ 2026-10-23 21:08 ICT) |
| f2830205 | APP-2026-5019 | **SUBMITTED** | ma***@xxx.com | 1792780340 (≈ 2026-10-24 01:12 ICT) |

กลุ่มเดียว round_id `5a7ca25c…` — แถวใหม่ (SUBMITTED) สมัครหลังแถวเดิม ~4 ชม. และแถวเดิมถูก ARCHIVED ไปแล้ว

**ผลต่อ 030 (สำคัญที่สุดของรายงานนี้):**

- ถ้า 030 สร้าง **full unique index** บน `(round_id, lower(email))` → **apply จะ FAIL ทันที** ด้วยคู่นี้
- ถ้า 030 สร้าง **partial unique index** ที่ยกเว้น `CANCELED`/`ARCHIVED` (เช่น `WHERE status NOT IN ('CANCELED','ARCHIVED')`) → **ผ่านได้ทันที** เพราะแถวที่ชนกันฝั่งเก่าเป็น ARCHIVED อยู่แล้ว ไม่ต้อง dedupe ไม่ต้องแตะข้อมูล

## Section E — Attachment State

ผลจาก `attachment_uploads` (ledger 029): **DELETED 10 · TEMP 2 · ACTIVE 1**

| ประเด็น | ผลตรวจ |
|---|---|
| **Orphan ACTIVE (ไม่มี application_id)** | **0 แถว** ✅ — ACTIVE ทั้งหมดถูกผูกใบสมัครเรียบร้อย |
| TEMP 2 แถว | application_id = NULL ตามดีไซน์ (รอ submit) อายุ ≈ 1–1.7 วัน — อยู่ในกรอบ GC 7 วัน (cron 01:00 ICT รายวัน) **ปกติ** |
| DELETED 10 แถว | ledger ทำงานครบวงจร — ปุ่มลบ + cron เขียน state จริง |
| ไฟล์ legacy ก่อน 029 | ไม่มีแถว ledger **โดยเจตนา** (ตาม header ของ 029) — R2 orphan เก่าจัดการด้วย one-off script ตามแผนเดิม ไม่เกี่ยวกับ 030 |

## Section F — Secrets/Config Dependencies

`npx wrangler secret list` (worker `sao-recruitment-backend`, แสดงเฉพาะชื่อ):

| Secret | มีหรือไม่ | ประเภท |
|---|---|---|
| `JWT_SECRET` | ✅ มี | secret_text |
| `TURNSTILE_SECRET_KEY` | ✅ มี | secret_text |

ไม่มีค่า secret ใดถูกแสดงหรืออ่าน · ใน `wrangler.toml` มีเฉพาะ vars ไม่ละเอียดอ่อน (HONEYPOT_FIELD_NAME, RATE_LIMIT_*, IDEMPOTENCY_*, TURNSTILE_ENABLED=true, TURNSTILE_SITE_KEY — site key สาธารณะ)

**Bindings ที่มีอยู่:**

| ประเภท | Binding | ทรัพยากร |
|---|---|---|
| D1 | `DB` | sao-db (`c8c9e923-0b64-4203-880b-ea5af58d316f`) ← ฐานที่ตรวจ |
| D1 | `DB_LOCAL` | sao-db-local (dev เท่านั้น) |
| R2 | `R2_BUCKET` | sao-storage |
| Cron | — | `0 18 * * *` (01:00 ICT, GC ledger) |

**Migration 030 พึ่งอะไรบ้าง:** D1 binding `DB` เท่านั้น — เป็น schema-level change (CREATE UNIQUE INDEX + CHECK rebuild บน `applications`) ไม่ต้อง secret/R2/binding ใหม่ใด ๆ · สิ่งที่ต้องพึ่งเพิ่มคือ **backup point** ก่อน rebuild (d1 export หรือ Time Travel bookmark) และการตัดสินใจ partial vs full index (Section D)

---

## สรุปผู้บริหาร (Go-Live Recommendation)

**Production พร้อมสำหรับ Migration 030 หรือไม่?**
**พร้อม — ภายใต้เงื่อนไข** คือ 030 ต้องออกแบบเป็น **partial unique index** (ยกเว้น CANCELED/ARCHIVED) และ CHECK rebuild ตัด `UNDER_REVIEW` (ความมั่นใจ ~90%: ข้อมูลทั้งหมดตรวจจาก prod จริงวันนี้ ส่วนที่เหลือคือความเสี่ยง runtime ช่วง rebuild ซึ่งต้องจัดการด้วย backup + ทดสอบ chain บน scratch ก่อน)

**Blocker:**
1. **ไม่มีไฟล์ migration 030 ใน repo** — ต้องเขียนก่อน (งานแรกสุด)
2. **Duplicate 1 กลุ่ม** — blocker เฉพาะเมื่อเลือก full unique index; เลือก partial แล้วไม่เป็น blocker
3. (เดิมจาก go-live plan) ต้อง backup + ทดสอบ chain จาก scratch ก่อน apply จริง — บทเรียน chain 004/007

**ต้องแก้อะไรก่อน (เรียงตามลำดับ):**
1. ตัดสินใจรูปแบบ unique index: **แนะนำ partial** `(round_id, lower(email)) WHERE status NOT IN ('CANCELED','ARCHIVED')` — สอดคล้อง semantics "กันสมัครซ้ำในรอบที่ยัง active" และไม่ต้องแตะข้อมูลเดิม
2. เขียน `030_*.sql` 2 ตอน (ตามแผนเดิม): ตอน 1 = partial unique index + (ถ้าเลือก full) dedupe plan; ตอน 2 = rebuild `applications` ให้ CHECK ตรง code enum (ตัด UNDER_REVIEW) และจัดรูปคอลัมน์ year/round_code/seq_in_round ให้สะอาด
3. ทดสอบ migration บน local/scratch จาก chain เต็ม (ห้าม apply ตรง prod โดยไม่ผ่าน scratch — drift เดิม)
4. Backup prod ก่อน apply (d1 export + จด Time Travel bookmark)
5. Apply 030 → verify ด้วยชุด SELECT เดียวกับรายงานนี้ (เช็ค `idx_apps_round_email` ปรากฏ + CHECK ใหม่ + dupe query ไม่พบ active pair)

**ข้อเท็จจริงที่ไม่ต้องแก้ก่อน 030:** ledger gap (A), FK คู่ 015 (A), national_id nullable ทั้งหมด (B — แยกเป็นงานอื่น), TEMP 2 แถว (E — GC จัดการเอง), R2 legacy orphan (E — one-off script ตามแผนเดิม)

---

## ภาคผนวก — คำสั่งที่ใช้ (read-only ทั้งหมด)

```
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('applications','attachment_uploads')"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='applications' ORDER BY name"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT status, COUNT(*) AS n FROM applications GROUP BY status ORDER BY n DESC"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT COUNT(*) AS total, SUM(CASE WHEN national_id IS NULL THEN 1 ELSE 0 END) AS null_national_id FROM applications"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT COUNT(*) AS dupe_groups FROM (SELECT round_id, lower(email) AS ek FROM applications GROUP BY round_id, lower(email) HAVING COUNT(*) > 1)"
npx wrangler d1 execute sao-db --remote --json --command \
  "WITH dupes AS (SELECT round_id, lower(email) AS ek FROM applications GROUP BY round_id, lower(email) HAVING COUNT(*) > 1) SELECT a.id, a.round_id, a.status, a.application_no, substr(a.email,1,2) || '***' || substr(a.email, instr(a.email,'@')) AS email_masked, a.submitted_at FROM applications a JOIN dupes d ON a.round_id = d.round_id AND lower(a.email) = d.ek ORDER BY d.ek, a.id"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT status, COUNT(*) AS n FROM attachment_uploads GROUP BY status ORDER BY n DESC"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT COUNT(*) AS orphan_active FROM attachment_uploads WHERE status='ACTIVE' AND application_id IS NULL"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT id, uploaded_at, application_id FROM attachment_uploads WHERE status='TEMP' ORDER BY uploaded_at"
npx wrangler d1 execute sao-db --remote --json --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler secret list
```

ตารางทั้งหมดใน prod (23): `__old_field_master`, `__old_template_fields` (เศษ rebuild เก่า — แยกเคลียร์ภายหลัง), `_cf_KV`, `admin_users`, `application_attachments`, `applications`, `attachment_uploads`, `audit_logs`, `d1_migrations`, `field_master`, `job_families`, `login_attempts`, `organizations`, `password_reset_tokens`, `position_levels`, `positions`, `recruitment_rounds`, `round_sequences`, `sqlite_sequence`, `template_fields`, `template_sections`, `template_versions`, `templates`

*หมายเหตุ: หนึ่ง query รอบแรกคืน error 7403 (auth flake) และถูกรันซ้ำจนสำเร็จ — ผลลัพธ์ในรายงานเป็นของรอบสำเร็จ · เวลาที่อ้าง epoch เป็นค่าประมาณ ICT (UTC+7) · ตรวจ ณ 2026-10-28*
