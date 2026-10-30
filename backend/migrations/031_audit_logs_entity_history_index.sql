-- Migration: Audit Logs Entity History Composite Index
-- Feature: GET /admin/applications/:id/history (admin.routes.ts:2551)
--
-- ปัญหาเดิม:
-- - query หลักคือ WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC, id DESC
-- - idx_audit_entity (entity_type, entity_id) ครอบ WHERE ได้ แต่ไม่ครอบ ORDER BY
--   → EXPLAIN ขึ้น "USE TEMP B-TREE FOR ORDER BY" ทุกครั้ง
-- - application ที่ถูกดาวน์โหลด PDF ซ้ำ ๆ สะสม PDF_DOWNLOAD ได้หลักพันแถว
--   (ดู comment ที่ admin.routes.ts:2501) → sort ทั้งก้อนทุกครั้งที่เปิด history
--
-- ผลที่วัดได้ (SQLite, 200k rows, entity 5,000 แถว — ดูรายงาน Audit Index Investigation 2026-10-30):
--   ก่อน: 14.06 ms + TEMP B-TREE
--   หลัง:  0.11 ms ไม่มี TEMP B-TREE  (128x)
--
-- idx_audit_entity ถูกลบเพราะเป็น exact left-prefix ของ index ใหม่:
-- ทุก query ที่ใช้ idx_audit_entity เดิม ย้ายไปใช้ index ใหม่ได้ทั้งหมด
-- (ยืนยันด้วย EXPLAIN หลัง DROP — ไม่มี query ใดแย่ลง)

CREATE INDEX IF NOT EXISTS idx_audit_entity_created
ON audit_logs(entity_type, entity_id, created_at DESC, id DESC);

--> statement-breakpoint

DROP INDEX IF EXISTS idx_audit_entity;
