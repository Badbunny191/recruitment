-- Migration: 019_application_number_pattern
-- Feature: Per-Round Application Number Pattern (MVP)
--
-- Summary:
--   ให้ Admin กำหนดรูปแบบเลขที่ใบสมัครได้ราย Round
--   รูปแบบใหม่ใช้เฉพาะ Round ที่สร้างหลัง deploy เท่านั้น
--   ใบสมัครเก่า (APP-YYYY-NNNN) คงเดิมตลอดไป
--
-- Design:
--   1. recruitment_rounds.application_pattern  → NULL = ใช้ format เดิม (APP-YYYY-NNNN)
--                                                not NULL = ใช้ format ใหม่
--   2. recruitment_rounds.round_code          → รหัสรอบ (Admin กำหนด เช่น CHM01, TEMP01)
--                                                ใช้กับ token {ROUND_CODE}
--   3. round_sequences (ตารางใหม่)            → 1 row ต่อ round, เก็บ running number
--                                                สร้างแบบ lazy (ตอน application แรก)
--   4. applications.year / round_code / seq_in_round
--                                              → snapshot เพื่อ query/search โดยไม่ join
--
-- Note: ไม่ snapshot level_code เพราะ:
--   - ไม่ได้ใช้ในการ render เลขที่ใบสมัคร (ตัด {LEVEL} token ออกแล้ว)
--   - ไม่มี feature อื่นใน MVP ที่ใช้ field นี้
--   - ลดความซับซ้อนของ schema
--   - ถ้าต้องการ position_level สามารถ join กับ recruitment_rounds ได้
--
-- Backward compatibility:
--   - application_no เดิมไม่ถูกแตะเลย
--   - existing rounds: application_pattern = NULL, round_code = NULL
--   - existing applications: snapshot fields = NULL แต่ application_no ยัง parse ได้ด้วย parseApplicationNo()
--
-- Rollback:
--   ALTER TABLE recruitment_rounds DROP COLUMN application_pattern;
--   ALTER TABLE recruitment_rounds DROP COLUMN round_code;
--   DROP INDEX IF EXISTS idx_rounds_round_code;
--   DROP TABLE IF EXISTS round_sequences;
--   ALTER TABLE applications DROP COLUMN year;
--   ALTER TABLE applications DROP COLUMN round_code;
--   ALTER TABLE applications DROP COLUMN seq_in_round;
--   DROP INDEX IF EXISTS idx_apps_round_code;
--   DROP INDEX IF EXISTS idx_apps_year_round_code;
--   DROP INDEX IF EXISTS idx_apps_year;

-- =============================================================================
-- 1. recruitment_rounds: เพิ่ม application_pattern + round_code
-- =============================================================================

ALTER TABLE recruitment_rounds ADD COLUMN application_pattern TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN round_code TEXT;

-- Index สำหรับ query/search round_code
CREATE INDEX idx_rounds_round_code ON recruitment_rounds(round_code);

-- =============================================================================
-- 2. round_sequences (ตารางใหม่) — 1 row ต่อ round
-- =============================================================================
-- เก็บ running number ของแต่ละ round
-- ใช้ UPSERT pattern ใน application layer (lazy create)

CREATE TABLE round_sequences (
  round_id TEXT PRIMARY KEY NOT NULL
    REFERENCES recruitment_rounds(id) ON DELETE CASCADE,
  current_value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_round_sequences_updated_at ON round_sequences(updated_at);

-- =============================================================================
-- 3. applications: เพิ่ม snapshot columns
-- =============================================================================
-- ใช้สำหรับ query/filter โดยไม่ต้อง join rounds
-- nullable เพื่อรองรับ application เก่าที่ใช้ format APP-YYYY-NNNN
-- หมายเหตุ: ไม่ snapshot level_code เพราะไม่ได้ใช้ใน MVP

ALTER TABLE applications ADD COLUMN year INTEGER;
ALTER TABLE applications ADD COLUMN round_code TEXT;
ALTER TABLE applications ADD COLUMN seq_in_round INTEGER;

-- Indexes สำหรับ query ในอนาคต (เช่น "applications ในปี 2026 ที่ใช้รหัส CHM01")
CREATE INDEX idx_apps_year ON applications(year);
CREATE INDEX idx_apps_round_code ON applications(round_code);
CREATE INDEX idx_apps_year_round_code ON applications(year, round_code);
