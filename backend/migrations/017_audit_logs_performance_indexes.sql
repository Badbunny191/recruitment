-- Migration: Audit Logs Performance Indexes
-- Feature: Server Side Pagination for /admin/audit-logs
--
-- ปัญหาเดิม:
-- - Query หน้า audit-logs ใช้ ORDER BY created_at DESC ทุกครั้ง
--   แต่ไม่มี index บน created_at → SQLite scan ทั้ง table เพื่อ sort
--   เมื่อข้อมูลระดับหมื่นถึงแสนจะช้ามาก
-- - Filter action=UPDATE / entity=RECRUITMENT_ROUND ต้อง full scan เช่นกัน
-- - Search ใน adminId / entityId / ipAddress ใช้ LIKE '%q%'
--   ต้องมี index รองรับ prefix match
--
-- Index ที่มีอยู่: idx_audit_entity (entity_type, entity_id) — ใช้กับ filter entity ได้
--
-- Indexes ที่เพิ่ม:
-- 1. idx_audit_created_at_desc — รองรับ ORDER BY created_at DESC + LIMIT/OFFSET
-- 2. idx_audit_action          — รองรับ WHERE action = ?
-- 3. idx_audit_admin_id        — รองรับ search adminId
-- 4. idx_audit_entity_id       — รองรับ search entityId (เพิ่มประสิทธิภาพ LIKE prefix match)

CREATE INDEX IF NOT EXISTS idx_audit_created_at_desc
ON audit_logs(created_at DESC);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_action
ON audit_logs(action);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_admin_id
ON audit_logs(admin_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_entity_id
ON audit_logs(entity_id);