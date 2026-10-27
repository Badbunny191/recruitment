-- =============================================================================
-- Migration: 030_applications_unique_email_and_check_rebuild.sql
-- =============================================================================
--
-- Feature: กันสมัครซ้ำระดับฐานข้อมูล (Partial Unique Index) + CHECK rebuild
-- Branch:  migration/030
-- อ้างอิง: docs/C8_PRODUCTION_VERIFICATION_2026-10-28.md
--
-- ปัญหาที่ปิด:
--   1. สมัครซ้ำในรอบเดียวกันยังเป็นไปได้ — prod ไม่มี unique index เลย
--      (drift: 0002 เขียน idx_apps_round_email ไว้ใน repo แต่ prod ไม่มี)
--      ช่องทางผ่าน 2 ทาง: TOCTOU (check-then-insert ไม่มี lock) และ
--      email ต่าง case (ทั้ง app check และ index เดิมเทียบแบบ case-sensitive)
--   2. CHECK constraint ของ prod มี UNDER_REVIEW (dead value — ไม่มีโค้ด
--      เขียน ไม่มีข้อมูลจริง) และ chain-from-scratch ได้ CHECK ชุด VERIFIED
--      จาก 0000 — 030 ทำให้ prod และ chain บรรจบกันที่ 6 ค่าตาม
--      backend/src/db/schema.ts:201 และ ApplicationStatusEnum (validators.ts:9)
--   3. DDL ของ applications ใน prod เป็นผล repair สะสม (คอลัมน์ year,
--      round_code, seq_in_round ต่อท้าย deleted_at ใน CREATE เดียว) —
--      rebuild จัดรูปใหม่ตรงตาม drizzle schema
--
-- =============================================================================
-- Business Rule (source of truth — ผู้ใหญ่ใจกำหนด 2026-10-28):
-- =============================================================================
--   1. ผู้สมัครสมัครได้หลายรอบ (หลายตำแหน่ง) — แต่ละรอบถืออิสระต่อกัน
--   2. ต่อ 1 รอบ: ผู้สมัครมี ACTIVE application ได้เพียง 1 ใบ
--      ACTIVE = ทุกสถานะยกเว้น CANCELED
--      (DRAFT, SUBMITTED, QUALIFIED, REJECTED, ARCHIVED ล้วนบล็อกการสมัครซ้ำ)
--   3. CANCELED → สมัครใหม่ได้ (สถานะเดียวที่เปิดทาง)
--   4. ARCHIVED = ข้อมูลเก็บเข้าคลัง ไม่ใช่การยกเลิก (ต่างจาก CANCELED)
--   5. ARCHIVED → ห้ามสมัครใหม่ (ต้องให้ admin เปลี่ยนเป็น CANCELED อย่าง
--      ชัดเจนเท่านั้น จึงจะเปิดทาง — เป็นการตัดสินใจของ admin ไม่ใช่ผลข้าง
--      เคียงของการ archive)
--   6. Email เทียบแบบ case-insensitive → index ใช้ lower(email)
--
-- โค้ดฝั่ง application (public.routes.ts) บังคับกฎชุดนี้ให้สอดคล้องกันแล้ว
-- ใน bundle เดียวกัน: duplicate check เทียบ lower(email) (Part A) และ
-- unique violation ของ idx_apps_round_email ตอน insert ถูก map เป็น 400
-- "ท่านได้สมัครรอบนี้แล้ว" (Part B — TOCTOU backstop) พร้อม regression test
-- submit-duplicate-protection.test.ts
--
-- ⚠️ ผลข้างเคียงที่เป็นเจตนา (จากการ trace audit_logs ของคู่ dupe prod):
--   workflow "CANCELED → สมัครใหม่ → admin เก็บใบเก่าเข้าคลังทีหลัง" จะหยุดที่
--   ขั้นเก็บเข้าคลัง — เพราะเปลี่ยนแถวเก่า CANCELED → ARCHIVED ขณะที่มีใบใหม่
--   SUBMITTED อยู่ จะชน index นี้ (UPDATE ล้ม UNIQUE violation → admin เห็น 500)
--   นี่คือ index บังคับกฎข้อ 5: เมื่อสมัครใหม่แล้ว ใบเก่าต้องคงสถานะ CANCELED
--   การ map error ฝั่ง admin status update ให้อ่านง่ายเป็น follow-up แยก
--
-- =============================================================================
-- Predicate ของ Unique Index (หัวใจของ migration):
-- =============================================================================
--   UNIQUE (round_id, lower(email))
--   WHERE status != 'CANCELED' AND deleted_at IS NULL
--
--   - ครอบคลุมทุกสถานะ ACTIVE รวม ARCHIVED ตามข้อ 4-5
--   - CANCELED อยู่นอก index → สมัครใหม่ได้ตามข้อ 3
--   - deleted_at IS NULL = mirror เงื่อนไข isNull(deletedAt) ของ app check
--     (ปัจจุบันไม่มีโค้ด set deleted_at ของ applications แต่คงไว้เพื่อ parity)
--   - NULL status ตกนอก index เช่นเดียวกับ ne(status,'CANCELED') ของ app
--     check (NULL != 'CANCELED' ให้ NULL) — unreachable จริงเพราะมี DEFAULT
--     และ CHECK คุมอยู่
--   - ต่างรอบไม่ชนกัน (key นำด้วย round_id) ตามข้อ 1
--
-- =============================================================================
-- ⚠️ เงื่อนไขก่อน apply (BLOCKER — อ่านก่อนรันเสมอ):
-- =============================================================================
--   Prod มี duplicate 1 คู่: APP-2026-5018 (ARCHIVED) + APP-2026-5019
--   (SUBMITTED) ในรอบเดียวกัน email เดียวกัน — ตามกฎข้อ 5 ทั้งคู่อยู่ใน
--   ขอบเขต index จึงชนกัน → ต้อง resolve ก่อน apply มิฉะนั้น STEP 5
--   (สร้าง unique index) จะ FAIL ตามดีไซน์ fail-fast ของไฟล์นี้
--
--   วิธี resolve (ผ่านช่องทาง admin เพื่อให้มี audit trail — ห้าม UPDATE SQL ตรง):
--     PATCH /admin/applications/<id ของ APP-2026-5019>/status
--     { "status": "CANCELED", "reason": "<เหตุผลตามข้อเท็จจริง เช่น
--        สมัครซ้ำทั้งที่ใบเดิมถูกเก็บเข้าคลังแล้ว>" }
--   (ทางเลือกสำรองหากเจ้าของข้อมูลตัดสินว่าใบใหม่คือใบจริง: ให้ admin
--    เปลี่ยนใบเก่า APP-2026-5018 ARCHIVED → CANCELED แทน — เป็นการตัดสิน
--    ทางธุรกิจ ไม่ใช่หน้าที่ของ migration)
--
--   Pre-flight queries (read-only รันก่อน apply ทุกครั้ง):
--     A) ต้องได้ 0 แถว:
--        SELECT round_id, lower(email) AS email_key, COUNT(*) AS n,
--               GROUP_CONCAT(status) AS statuses
--        FROM applications
--        WHERE deleted_at IS NULL AND status != 'CANCELED'
--        GROUP BY round_id, lower(email) HAVING COUNT(*) > 1;
--     B) ต้องเห็นเฉพาะ 6 สถานะตาม enum (ห้ามมี VERIFIED/UNDER_REVIEW/NULL —
--        มีเมื่อไร INSERT SELECT จะ FAIL ตามดีไซน์):
--        SELECT status, COUNT(*) AS n FROM applications GROUP BY status;
--     C) จดจำนวนแถวไว้เทียบหลัง apply:
--        SELECT COUNT(*) FROM applications;
--
--   Backup ก่อน apply (บังคับตาม go-live plan):
--     wrangler d1 export sao-db --remote --output=backup-pre-030.sql
--     + จด Time Travel bookmark
--   ทดสอบบน scratch จาก chain เต็มก่อนขึ้น prod เสมอ (บทเรียน chain 004/007)
--
-- =============================================================================
-- ขั้นตอนในไฟล์ (PRAGMA foreign_keys OFF→ON ตามแบบ 015):
-- =============================================================================
--   ข้อค้นพบจากการทดสอบ fixture (2026-10-28): CHECK ของ prod เขียนแบบ
--   qualified — CHECK("applications"."status" IN ...) — ทำให้
--   ALTER TABLE applications RENAME TO __old_applications FAIL ทันที
--   ("no such column: applications.status" เพราะ SQLite ไม่ rewrite การอ้าง
--   ชื่อตารางภายใน CHECK ของตารางที่ถูก rename) จึงใช้กลยุทธ์:
--   backup ด้วย CREATE TABLE AS SELECT (ข้อมูลล้วน ไม่มี CHECK/index) →
--   DROP ตารางเก่า → RENAME ตัวใหม่ (CHECK ของตัวใหม่เขียน unqualified
--   จึง rename ได้) — 015 รอดเพราะ template_fields ไม่มี CHECK constraint
--
--   STEP 1   ล้างเศษจากความพยายาม apply ครั้งก่อน (ทำให้ re-run ได้)
--   STEP 2   DROP idx_apps_round_email ชื่อเดิม ถ้ามี (chain-from-scratch
--            มีของ 0002 — case-sensitive — ต้องตัดออกก่อนใช้ชื่อใหม่)
--   STEP 3   สร้าง __new_applications: DDL สะอาด 16 คอลัมน์ตาม drizzle
--            schema + CHECK ใหม่ 6 ค่า
--   STEP 4   คัดลอกข้อมูลทั้งหมด (explicit column list ทั้งสองฝั่ง)
--   STEP 5   สร้าง partial unique index บน __new_applications ← จุด fail-fast:
--            ถ้ามี active duplicate จะ FAIL ตรงนี้ ก่อน DROP ใด ๆ —
--            ตารางจริงยัง untouched
--   STEP 6   backup ข้อมูลเดิม → __old_applications (CTAS — เก็บข้อมูลไว้
--            rollback ทางข้อมูล; DDL เดิมมีประวัติใน C8 + git)
--   STEP 7   DROP ตารางเดิม (คายชื่อตาราง + ชื่อ index เดิม 7 ตัว)
--   STEP 8   RENAME __new_applications → applications
--            (idx_apps_round_email ติดตามตารางมาเอง)
--   STEP 9   สร้าง index เดิม 7 ตัวใหม่บนตารางจริง
--   STEP 10  PRAGMA foreign_keys=ON
--
--   ไม่มี UPDATE/DELETE ข้อมูลใด ๆ ในไฟล์นี้ — schema-only
--   Verification หลัง apply อยู่ท้ายไฟล์ (comment — รันแยก เหมือน 015)
-- =============================================================================

PRAGMA foreign_keys=OFF;

--> statement-breakpoint

-- ============================================
-- STEP 1: ล้างเศษจาก apply ครั้งก่อนที่ล้ม (re-run guard)
-- ============================================
DROP TABLE IF EXISTS `__new_applications`;
DROP TABLE IF EXISTS `__old_applications`;

--> statement-breakpoint

-- ============================================
-- STEP 2: เผื่อชื่อ index ให้ใหม่
-- (chain-from-scratch มี idx_apps_round_email แบบ case-sensitive จาก 0002
--  prod ไม่มี — IF EXISTS จึง no-op บน prod)
-- ============================================
DROP INDEX IF EXISTS `idx_apps_round_email`;

--> statement-breakpoint

-- ============================================
-- STEP 3: ตารางใหม่ — ลำดับคอลัมน์ตรงตาม backend/src/db/schema.ts
--   * national_id เป็น NULLABLE ตาม prod จริงและ schema.ts:178
--     (0000 เขียน NOT NULL ไว้แต่ prod เคยถูกแก้ — 030 ทำให้ chain ตรง prod)
--   * CHECK ใช้ชื่อคอลัมน์แบบ unqualified (status) — บังคับ: CHECK แบบ
--     qualified ทำ ALTER TABLE RENAME พัง (ดูหัวไฟล์) และ rename ได้ทั้งก่อน
--     และหลังขึ้นชื่อจริง — ความหมายเท่ากับ chk_app_status ตาม schema.ts:201
-- ============================================
CREATE TABLE `__new_applications` (
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
  `deleted_at` integer,
  `year` integer,
  `round_code` text,
  `seq_in_round` integer,
  FOREIGN KEY (`round_id`) REFERENCES `recruitment_rounds`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT `chk_app_status` CHECK (`status` IN ('DRAFT', 'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'))
);

--> statement-breakpoint

-- ============================================
-- STEP 4: คัดลอกข้อมูลทั้งหมด
-- (ถ้ามีแถวสถานะนอก 6 ค่า เช่น VERIFIED/UNDER_REVIEW จะ FAIL ตรงนี้
--  ตามดีไซน์ — เช็ค pre-flight B ก่อน apply จะไม่พลาด)
-- ============================================
INSERT INTO `__new_applications` (
  "id", "application_no", "round_id", "email", "fullname", "national_id",
  "status", "status_reason", "verified_by", "verified_at", "form_data",
  "submitted_at", "deleted_at", "year", "round_code", "seq_in_round"
)
SELECT
  "id", "application_no", "round_id", "email", "fullname", "national_id",
  "status", "status_reason", "verified_by", "verified_at", "form_data",
  "submitted_at", "deleted_at", "year", "round_code", "seq_in_round"
FROM `applications`;

--> statement-breakpoint

-- ============================================
-- STEP 5: Partial Unique Index — กันสมัครซ้ำ (BUSINESS RULE ข้อ 2-6)
--   สร้าง "ก่อน" DROP ตารางเดิม เพื่อ fail-fast: ถ้ามี active duplicate
--   จะ FAIL ตรงนี้ โดยตารางจริงยังไม่ถูกแตะเลย
-- ============================================
CREATE UNIQUE INDEX `idx_apps_round_email`
  ON `__new_applications` (`round_id`, lower(`email`))
  WHERE `status` != 'CANCELED' AND `deleted_at` IS NULL;

--> statement-breakpoint

-- ============================================
-- STEP 6: backup ข้อมูลเดิม (CTAS — ตาราง backup มีแต่ข้อมูล ไม่มี
--   CHECK/index/FK ตามธรรมชาติของ CTAS; ใช้ rollback ทางข้อมูล
--   และเป็นหลักฐานเทียบหลัง apply — ลบทิ้งได้เมื่อพอใจแล้ว)
-- ============================================
CREATE TABLE `__old_applications` AS SELECT * FROM `applications`;

--> statement-breakpoint

-- ============================================
-- STEP 7: DROP ตารางเดิม — คายชื่อตารางและชื่อ index เดิม 7 ตัวทั้งหมด
-- (index ตายพร้อมตาราง; FK ปิดอยู่ ลูกทั้งสอง application_attachments /
--  attachment_uploads ยังอ้างชื่อ "applications" ตามเดิม — จะชี้ตารางใหม่
--  ทันทีที่ STEP 8 ขึ้นชื่อเดิม)
-- ============================================
DROP TABLE `applications`;

--> statement-breakpoint

-- ============================================
-- STEP 8: ตารางใหม่ขึ้นชื่อจริง (CHECK unqualified จึง rename ได้ —
--  idx_apps_round_email ที่สร้างบน __new ติดตามมาด้วย ไม่ต้องสร้างซ้ำ)
-- ============================================
ALTER TABLE `__new_applications` RENAME TO `applications`;

--> statement-breakpoint

-- ============================================
-- STEP 9: สร้าง index เดิม 7 ตัวใหม่ (นิยามตรงตามที่ prod มีก่อน 030
--   — ตรวจยืนยันจาก sqlite_master ใน C8 Section C)
-- ============================================
CREATE UNIQUE INDEX `applications_application_no_unique` ON `applications` (`application_no`);
CREATE INDEX `idx_apps_round` ON `applications` (`round_id`);
CREATE INDEX `idx_apps_status` ON `applications` (`status`);
CREATE INDEX `idx_apps_round_status` ON `applications` (`round_id`, `status`);
CREATE INDEX `idx_apps_year` ON `applications` (`year`);
CREATE INDEX `idx_apps_round_code` ON `applications` (`round_code`);
CREATE INDEX `idx_apps_year_round_code` ON `applications` (`year`, `round_code`);

--> statement-breakpoint

-- ============================================
-- STEP 10: เปิด foreign keys กลับ
-- ============================================
PRAGMA foreign_keys=ON;

--> statement-breakpoint

-- =============================================================================
-- VERIFICATION (รันแยกหลัง apply — แนวเดียวกับ 015; ตัวเลขอ้างอิง ณ 2026-10-28)
-- =============================================================================
-- V1) Index ครบ 8 ตัว — ต้องเห็น idx_apps_round_email ที่เป็น UNIQUE พร้อม
--     WHERE status != 'CANCELED' AND deleted_at IS NULL
--     SELECT name, sql FROM sqlite_master
--     WHERE type='index' AND tbl_name='applications' ORDER BY name;
--
-- V2) CHECK ใหม่ — DDL ของ applications ต้องมี chk_app_status ครบ 6 ค่า
--     (DRAFT, SUBMITTED, QUALIFIED, REJECTED, CANCELED, ARCHIVED)
--     และต้อง "ไม่มี" UNDER_REVIEW / VERIFIED
--     SELECT sql FROM sqlite_master WHERE type='table' AND name='applications';
--
-- V3) จำนวนแถวไม่หาย — new_count ต้องเท่ากับ old_count และเท่ากับค่าที่จด
--     จาก pre-flight C (20 ณ วันตรวจ)
--     SELECT (SELECT COUNT(*) FROM applications) AS new_count,
--            (SELECT COUNT(*) FROM __old_applications) AS old_count;
--
-- V4) ไม่เหลือ active duplicate — ต้องได้ 0 แถว
--     SELECT round_id, lower(email) AS email_key, COUNT(*) AS n
--     FROM applications
--     WHERE deleted_at IS NULL AND status != 'CANCELED'
--     GROUP BY round_id, lower(email) HAVING COUNT(*) > 1;
--
-- V5) FK integrity — ต้องไม่มีแถว violation (ตรวจเดี่ยวเหมือน 015)
--     PRAGMA foreign_key_check;
--
-- V6) การบังคับจริงของ index (ทดสอบบน scratch เท่านั้น — ห้าม probe prod):
--     INSERT แถวซ้ำ (email ต่าง case, สถานะ SUBMITTED) ต้อง FAIL
--     INSERT แถวซ้ำสถานะ CANCELED ต้องผ่าน
-- =============================================================================
