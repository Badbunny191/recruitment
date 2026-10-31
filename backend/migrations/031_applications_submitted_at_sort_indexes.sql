-- =============================================================================
-- Migration: 031_applications_submitted_at_sort_indexes.sql
-- =============================================================================
--
-- Feature: Platform Hardening Phase 1 — submitted_at index
-- Branch:  feature/platform-hardening-phase1
--
-- ปัญหา (audit query จริง — ทุก query ที่ ORDER BY submitted_at บน prod
-- วิ่งแบบ "TEMP B-TREE FOR ORDER BY" เพราะไม่มี index ที่ครอบคลุมลำดับ):
--
--   1. GET /admin/applications (+ /ids) — รายชื่อผู้สมัคร (hot path, paginated)
--      WHERE deleted_at IS NULL [AND round_id = ?] [AND status = ?]
--      ORDER BY submitted_at IS NULL ASC, submitted_at DESC, id ASC
--      LIMIT ? OFFSET ?
--      (src/lib/applications-list-query.ts — buildApplicationsListOrderBy,
--       default sort = submittedAt-desc)
--
--   2. GET /admin/applications/export — Excel FILTERED (อ่านทั้งรอบก่อน cap
--      ที่ MAX_EXPORT_ROWS=1000 ที่ 422 ถ้าเกิน)
--      WHERE deleted_at IS NULL AND round_id = ? [AND submitted_at range]
--      ORDER BY submitted_at DESC, id DESC
--      (src/services/excel-export.service.ts:677)
--
-- การออกแบบจาก EXPLAIN QUERY PLAN (better-sqlite3, ข้อมูลสังเคราะห์ 6,000 แถว,
--  index ชุดเดียวกับ prod — ดูรายงานใน PR description):
--
--   BEFORE: ทุก query = SEARCH idx_apps_round/SCAN + USE TEMP B-TREE FOR ORDER BY
--
--   idx_apps_round_submitted_sort (index 1):
--     list (round_id=?)        → SEARCH ... USING INDEX ไม่มี TEMP B-TREE
--                                (ORDER BY ตรงกับ index ทุก term รวม expression
--                                 (submitted_at IS NULL) และทิศ DESC/ASC ผสม)
--     list (ไม่มี round_id)    → SCAN บน partial index ที่เล็กกว่าตารางจริง
--                                (ยังมี TEMP B-TREE — คาดหมายไว้, ไม่ใช่ hot path)
--
--   idx_apps_round_submitted_export (index 2):
--     export (round_id + range)→ SEARCH ... (round_id=? AND submitted_at>? AND
--                                submitted_at<?) ไม่มี TEMP B-TREE — range ถูก
--                                push เข้า index
--
--   export-selected (id IN)   → คงใช้ PK autoindex (≤1000 id, sort ชั่วคราว
--                                บนชุดเล็ก — ไม่จำเป็นต้องมี index เพิ่ม)
--
-- ทำไม partial (WHERE deleted_at IS NULL):
--   - ทุก query เป้าหมายมีเงื่อนไขนี้เสมอ (deletedAt IS NULL ใน builder กลาง)
--   - ใบที่ soft-delete แล้วไม่ต้องอยู่ใน index → index เล็กลง เขียนถูกกว่า
--
-- ข้อจำกัดที่ยอมรับโดยมีหลักฐาน (ไม่ใช่การเดา):
--   - sort submittedAt-asc ของหน้ารายชื่อ (ไม่ใช่ default) ยัง TEMP B-TREE —
--     index ที่ทั้ง DESC/ASC ผสมเดียวกันใช้ไม่ได้กับทั้งสองทิศ, เลือกครอบ
--     default sort (desc) ตามการใช้งานจริง
--   - sort fullname ไม่เกี่ยวกับ migration นี้
--
-- ความเสี่ยง: index สร้างแบบ non-concurrent เดียวกับ SQLite ปกติ — ตาราง
-- applications ขนาดปัจจุบัน (สิบ ๆ แถว) และ D1 ทำงานใน transaction เดียว
-- ของ wrangler d1 migrations apply จึงเร็วและ atomic (ล้ม = rollback ทั้งไฟล์)
--
-- การ rollback: DROP INDEX ทั้งสองตัว (ดูคอมเมนต์ท้ายไฟล์) — ไม่แตะข้อมูล
-- =============================================================================

-- Index 1 — รายชื่อผู้สมัคร (default sort submittedAt-desc + tie-break id ASC)
-- คอลัมน์แรก (submitted_at IS NULL) ตรงกับ ORDER BY term แรกของ
-- buildApplicationsListOrderBy (nulls-last) — SQLite จับคู่ expression ใน
-- ORDER BY กับ expression ใน index ได้เมื่อเขียนเหมือนกันทุกตัวอักษร
CREATE INDEX IF NOT EXISTS idx_apps_round_submitted_sort
  ON applications (round_id, (submitted_at IS NULL), submitted_at DESC, id)
  WHERE deleted_at IS NULL;

-- Index 2 — Excel export FILTERED (round + ช่วงวันที่, submitted_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_apps_round_submitted_export
  ON applications (round_id, submitted_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- ── Rollback (รันเองถ้าต้องการย้อน — migration นี้ไม่มีข้อมูลให้ย้อน) ──────
-- DROP INDEX IF EXISTS idx_apps_round_submitted_sort;
-- DROP INDEX IF EXISTS idx_apps_round_submitted_export;
