-- =============================================================================
-- 034 — Submission Failure Evidence (Option A: Submit Fail Events Only)
--
-- วัตถุประสงค์:
--   บันทึกหลักฐานการส่งใบสมัครไม่สำเร็จ (Rejection Events) เพื่อให้ HR ตอบข้อร้องเรียน
--   และข้อพิพาทของผู้สมัครได้ภายใน 30 วินาที (Submission Dispute & Evidence Defense)
--
-- คุณสมบัติ:
--   - Additive-only migration (ตารางใหม่ ไม่กระทบตารางหลัก applications)
--   - Zero downtime ปลอดภัยต่อระบบที่กำลังเปิดรับสมัครอยู่
--   - คอลัมน์ที่มาจาก request เป็น NULLABLE ทั้งหมด ป้องกัน constraint crash
--
-- Rollback:
--   DROP TABLE IF EXISTS application_submit_failures;
-- =============================================================================

CREATE TABLE IF NOT EXISTS application_submit_failures (
  id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  round_id TEXT,
  email TEXT,
  fullname TEXT,
  submission_token TEXT,
  category TEXT NOT NULL,
  reason_code TEXT,
  error_message TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  ip_address TEXT,
  cf_ray TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

-- Index สำหรับค้นหาด่วนด้วย Ref Code (HR ค้นหาภายใน 3 วินาที)
CREATE INDEX IF NOT EXISTS idx_submit_failures_ref_code
  ON application_submit_failures(ref_code);

-- Composite Index สำหรับ HR ค้นหาด้วยรอบและอีเมล/เวลา
CREATE INDEX IF NOT EXISTS idx_submit_failures_round_email
  ON application_submit_failures(round_id, email, created_at DESC);

-- Index สำหรับ Scheduled Retention Purge (180 วัน) และ Timeline
CREATE INDEX IF NOT EXISTS idx_submit_failures_created_at
  ON application_submit_failures(created_at);
