-- Migration: Audit Logs Created+Id Tie-breaker Index
-- Feature: GET /admin/audit-logs (admin.routes.ts:3361), dashboard activities
--          (dashboard-overview.service.ts:286)
--
-- ปัญหาเดิม:
-- - ORDER BY created_at DESC, id DESC แต่ idx_audit_created_at_desc มีแค่ created_at DESC
-- - term ที่สอง (id DESC) ไม่มี index รองรับ → "USE TEMP B-TREE FOR LAST TERM OF ORDER BY"
--   ทุกหน้าเพจ รวมถึง COUNT และ dashboard
--
-- ผลที่วัดได้ (SQLite, 200k rows — ดูรายงาน Audit Index Investigation 2026-10-30):
--   page 1:              0.119 ms → 0.153 ms (temp b-tree หายไป)
--   deep page OFFSET 100k: 86.19 ms → 4.44 ms  (19.4x)
--
-- idx_audit_created_at_desc ถูกลบเพราะเป็น left-prefix ของ index ใหม่

CREATE INDEX IF NOT EXISTS idx_audit_created_id
ON audit_logs(created_at DESC, id DESC);

--> statement-breakpoint

DROP INDEX IF EXISTS idx_audit_created_at_desc;
