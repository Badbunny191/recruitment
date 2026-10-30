-- ============================================
-- Rollback for Migrations 031 + 032 + 033: audit_logs Index Optimization
--
-- ใช้เมื่อ: ต้องการย้อน index ของ audit_logs กลับสู่สถานะ 5 index ก่อน optimization
-- (สถานะหลัง rollback ตรงกับหลัง migration 017 เสมอ — index set เดิมครบถ้วน)
--
-- ขั้นตอน:
--   1. apply ไฟล์นี้ด้วย wrangler d1 execute (ห้ามใช้ d1 migrations apply)
--      wrangler d1 execute sao-db --remote --file=./fixes/031_032_033_rollback.sql
--   2. กลับ schema.ts ให้ตรง (คืน idx_audit_entity / idx_audit_created_at_desc /
--      idx_audit_entity_id — ดู git history ของ backend/src/db/schema.ts)
--   3. ตรวจสอบ: SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_logs';
--      ต้องได้ 5 ตัว: idx_audit_entity, idx_audit_created_at_desc, idx_audit_action,
--      idx_audit_admin_id, idx_audit_entity_id
-- ============================================

-- คืน index ที่ 031 ลบ (left-prefix เดิมของ idx_audit_entity_created)
CREATE INDEX IF NOT EXISTS idx_audit_entity
ON audit_logs(entity_type, entity_id);

--> statement-breakpoint

-- คืน index ที่ 032 ลบ (created_at เดี่ยว — ยอมรับ TEMP B-TREE ของ tie-breaker ตามเดิม)
CREATE INDEX IF NOT EXISTS idx_audit_created_at_desc
ON audit_logs(created_at DESC);

--> statement-breakpoint

-- คืน index ที่ 033 ลบ (ไม่มี query ใช้ แต่คืนเพื่อสถานะก่อน migration ครบถ้วน)
CREATE INDEX IF NOT EXISTS idx_audit_entity_id
ON audit_logs(entity_id);

--> statement-breakpoint

-- ถอด index ใหม่ที่ 031/032 สร้าง
DROP INDEX IF EXISTS idx_audit_entity_created;

--> statement-breakpoint

DROP INDEX IF EXISTS idx_audit_created_id;
