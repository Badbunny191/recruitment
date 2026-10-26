-- =============================================================================
-- Migration: 029_attachment_uploads_ledger.sql
-- =============================================================================
--
-- Feature: Attachment Lifecycle Ledger (TEMP → ACTIVE → DELETED)
-- Branch:  feat/attachment-lifecycle-security
--
-- ปัญหาที่ปิด (3 เรื่องในงานเดียว):
--   1. Orphan Files — upload เข้า R2 ทันที ไม่มีใคร track ปิด tab ไม่ submit
--      → ไฟล์ค้างใน bucket ตลอดอายุระบบ (ไม่มี cron / DELETE endpoint)
--   2. Delete File UI หลอก — ปุ่มลบหน้า /apply ลบเฉพาะ React state
--   3. Public File Access — GET /public/uploads/files/:key เปิดได้โดยไม่ login
--
-- การเปลี่ยนแปลง (migration นี้สร้างตารางเดียว ไม่แตะตารางอื่น):
--
--   attachment_uploads = ledger ของทุกการอัปโหลด:
--     - POST /public/uploads/direct        → insert แถว status='TEMP'
--     - POST /public/applications/submit   → TEMP → ACTIVE + application_id
--     - DELETE /public/uploads/direct/:id  → R2.delete + status='DELETED'
--       (เฉพาะ TEMP เท่านั้น + ต้องแนบ delete token ที่ออกตอน upload)
--     - Cron Trigger รายวัน                → ลบ TEMP อายุเกิน 7 วัน
--
--   คอลัมน์สำคัญ:
--     - r2_key UNIQUE — 1 object ต่อ 1 แถว (key มี UUID นำหน้าอยู่แล้ว)
--     - delete_token_hash — SHA-256 hex ของ one-time token ที่ frontend
--       เก็บไว้ลบไฟล์ตัวเองได้ (ผู้สมัครไม่มีระบบ login) NULL = legacy
--       (แถวจาก backfill/ข้อมูลเก่า → ไม่สามารถลบผ่าน anonymous endpoint ได้)
--     - application_id nullable — TEMP ยังไม่ผูกใบสมัคร
--
--  Backward compatibility (ตั้งใจ ไม่ทำ SQL backfill):
--   fileUrl เก่าเก็บรูปแบบเดิมใน application_attachments และ decode ไม่ได้ใน
--   SQLite (ชื่อไทย percent-encoded) — ไฟล์เก่าจึงไม่มีแถว ledger:
--   1) ยังเปิดดูได้ผ่าน signed URL ที่ admin mint ให้ (เส้นทางเดียวที่ปลอดภัย)
--   2) ไฟล์เก่าจึงไม่มี delete token (ลบผ่าน anonymous endpoint ไม่ได้)
--   3) orphan เก่าก่อน deploy ไม่เข้าระบบ GC — จัดการด้วย one-off script ภายหลัง
--
-- =============================================================================

CREATE TABLE `attachment_uploads` (
  `id`                 TEXT PRIMARY KEY NOT NULL,
  `r2_key`             TEXT NOT NULL UNIQUE,
  `status`             TEXT NOT NULL DEFAULT 'TEMP',
  `uploaded_at`        INTEGER DEFAULT (unixepoch()),
  `application_id`     TEXT REFERENCES `applications`(`id`) ON DELETE SET NULL,
  `original_filename`  TEXT,
  `delete_token_hash`  TEXT,
  `activated_at`       INTEGER,
  `deleted_at`         INTEGER,
  CONSTRAINT `chk_attachment_uploads_status` CHECK (`attachment_uploads`.`status` IN ('TEMP','ACTIVE','DELETED'))
);

-- Cron scan: WHERE status='TEMP' AND uploaded_at < cutoff
CREATE INDEX `idx_attachment_uploads_status_uploaded`
  ON `attachment_uploads` (`status`, `uploaded_at`);

-- ตรวจ ledger ตอน promote (submit) / เช็คสถานะตอน serve ไฟล์
CREATE INDEX `idx_attachment_uploads_application`
  ON `attachment_uploads` (`application_id`);
