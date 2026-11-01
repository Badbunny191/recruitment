-- =============================================================================
-- 032_add_audit_batch_id.sql
-- Audit Log Foundation — Phase 1 (additive เท่านั้น ไม่ rebuild ตาราง)
-- =============================================================================
-- 1) audit_logs.batch_id — ระบุกลุ่มของ bulk operations (1 ค่าต่อ 1 request)
--    nullable ทุกแถวเดิมคง NULL → backward compatible ทั้ง schema เก่าและโค้ดเก่า
--    (โค้ดเก่าไม่เคยอ้างคอลัมน์นี้จึงไม่มีผล)
-- 2) Reserved SYSTEM actor สำหรับเหตุการณ์ฝั่งผู้สมัคร (APPLICATION_SUBMIT /
--    ATTACHMENT_UPLOAD / ATTACHMENT_DELETE) — audit_logs.admin_id เป็น NOT NULL
--    FK → admin_users(id) จึงต้องมีแถว actor ที่มีจริง
--    ป้องกันการใช้งาน: role = VIEWER + is_active = 0 (login ตอบ 403 "Account
--    Disabled" ก่อนถึง bcrypt) + password_hash เป็น bcrypt ของค่าสุ่ม 64 hex
--    ที่ทิ้งไปทันทีตอน generate (ไม่มีใครรู้ preimage — brute force ไม่ได้)
-- =============================================================================

ALTER TABLE audit_logs ADD COLUMN batch_id TEXT;

CREATE INDEX idx_audit_batch_id ON audit_logs(batch_id);

INSERT INTO admin_users (id, email, password_hash, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@audit.local',
  '$2b$10$d1ehAeCyq0D/xnkLJMAaHOJowcg6/wa/H6bmtyI6K48owCh3.Xou6',
  'VIEWER',
  0
);
