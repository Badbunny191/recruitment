-- Migration: Remove Unused audit_logs entity_id Index
--
-- idx_audit_entity_id (entity_id) ถูกสร้างใน 017 โดยอ้างว่า "รองรับ search entityId
-- (LIKE prefix match)" — เหตุผลนั้นไม่ถูกต้อง:
--   search ใช้ '%' || q || '%' (wildcard นำหน้า) → B-tree ใช้ไม่ได้
--   และไม่มี query ใดใน production ที่ทำ WHERE entity_id = ? เดี่ยว ๆ
--
-- ยืนยันด้วย EXPLAIN: query search ทั้งหมดขึ้น "SCAN audit_logs USING INDEX idx_audit_created_id"
-- ไม่มี plan ใดเลือก idx_audit_entity_id
--
-- ต้นทุนที่ประหยัด: ~3.5 MB ต่อ 200k แถว
-- (ดูรายงาน Audit Index Investigation 2026-10-30)

DROP INDEX IF EXISTS idx_audit_entity_id;
