-- =============================================================================
-- Migration: 026_other_option_support.sql
-- =============================================================================
--
-- Feature: Other Option Support
--   RADIO / DROPDOWN / CHECKBOX รองรับตัวเลือก "อื่นๆ (โปรดระบุ)"
--   เมื่อผู้สมัครเลือก "อื่นๆ" → ต้องกรอกข้อความเพิ่มเติมในช่อง Text Input
--
-- การเปลี่ยนแปลง:
--   1. field_master.allow_other (INTEGER, default 0)
--      → true = field ระดับ Master รองรับตัวเลือก "อื่นๆ (โปรดระบุ)"
--   2. template_fields.allow_other (INTEGER, nullable)
--      → override ราย template (NULL = ใช้ค่าจาก Master)
--
-- Backward compatibility:
--   - ค่าเริ่มต้นของ field_master.allow_other = 0 (เท่ากับ "ไม่รองรับ")
--   - ฟิลด์เดิมทุกตัวจึงยังทำงานเหมือนเดิม 100%
--   - template_fields.allow_other = NULL → ไม่มีผลกับฟิลด์เดิม
--
-- หมายเหตุ:
--   - ไม่ต้องแก้ CHECK constraint chk_field_type (ไม่เพิ่ม field type ใหม่)
--   - ไม่มีการเปลี่ยนแปลงข้อมูลเดิมในตาราง applications / form_data
--
-- Idempotent: ใช้ IF NOT EXISTS
-- =============================================================================

-- 1. field_master.allow_other
ALTER TABLE `field_master` ADD COLUMN `allow_other` integer DEFAULT 0;

-- 2. template_fields.allow_other
ALTER TABLE `template_fields` ADD COLUMN `allow_other` integer;
