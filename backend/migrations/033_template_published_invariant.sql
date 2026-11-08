-- =============================================================================
-- 033 — Publish Invariant: 1 template = 1 PUBLISHED version (DB-level backstop)
--
-- ที่มา: prod incident 2026-10 — tpl-general-001 มี v2-v5 PUBLISHED พร้อมกัน
-- (publish ยุคก่อน auto-archive 8cd02f59 + auto-archive เดิมเก็บแถว arbitrary)
-- Code-level fix ลงแล้ว (conditional db.batch + 409 race path — commit a8a4374c)
-- index นี้คือชั้นป้องกันสุดท้าย: ไม่มีทางเขียน state แตกผ่าน layer ใดได้อีก
--
-- ⚠️  PRECONDITION — apply ได้เฉพาะเมื่อ invariant สะอาดแล้วเท่านั้น:
--     ตรวจก่อน apply (ต้องได้ 0 แถว):
--       SELECT template_id, COUNT(*) FROM template_versions
--        WHERE status = 'PUBLISHED' GROUP BY template_id HAVING COUNT(*) > 1;
--     ถ้ายังมีแถว → ห้าม apply — index จะสร้างไม่ผ่าน (fail-closed by design)
--     ขั้นตอน cleanup: docs/ZOMBIE_CLEANUP_RUNBOOK.md (archive zombie ทาง API
--     เพื่อ audit trail → verify → apply migration นี้เป็นลำดับสุดท้าย)
--
-- Rollback:
--   DROP INDEX unq_template_published;
--
-- Partial unique index — SQLite รองรับ WHERE บน index; ยอมรับทั้ง 0 และ 1
-- PUBLISHED ต่อ template (archive ตัวเดียวจนหมดไม่ผิด index)
-- =============================================================================

CREATE UNIQUE INDEX unq_template_published
  ON template_versions (template_id)
  WHERE status = 'PUBLISHED';
