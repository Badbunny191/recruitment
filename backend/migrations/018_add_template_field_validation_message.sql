-- Migration: 018_add_template_field_validation_message
-- Feature: Template Field — Override Validation Message
-- Pattern: overrideValue ?? masterValue (null = "use default")
--
-- Logic:
--   - ถ้า template_fields.validation_message = NULL → ใช้ค่าจาก field_master.validation_message
--   - ถ้า template_fields.validation_message = "..." → ใช้ค่า override ของ template
--   - ห้าม copy ค่า Master ลง Template (null ต้องหมายถึง "ใช้ค่าเริ่มต้น")
--
-- ใช้กับ:
--   - Help Text (column: help_text)
--   - Placeholder (column: placeholder)
--   - Validation Message (column: validation_message) ← column ใหม่

ALTER TABLE template_fields ADD COLUMN validation_message TEXT;
