-- Migration: 022_template_versions_descriptor
-- Feature: Document Composer — Descriptor Storage
--
-- Summary:
--   เก็บ DocumentDescriptor (Block-based layout) ใน template_versions
--   ใช้แทน hardcoded PDF layout ใน V2
--
-- Design:
--   1. template_versions.descriptor_json (TEXT, JSON)
--      → เก็บ serialized DocumentDescriptor (version + blocks)
--      → NULL = ยังไม่ define descriptor (fallback ไป legacy render)
--   2. template_versions.descriptor_schema_version (INTEGER)
--      → เก็บเวอร์ชัน schema ที่ save ไว้ (ปัจจุบัน = 1)
--      → รองรับ backward compat เมื่อมี descriptor schema v2+
--      → ถ้า NULL = ใช้ legacy render (เหมือน descriptor_json = NULL)
--   3. template_versions.descriptor_updated_at (INTEGER)
--      → audit timestamp ตอน save descriptor
--      → null = never updated
--   4. template_versions.descriptor_updated_by (TEXT → admin_users.id)
--      → audit who saved it
--      → nullable
--
-- Backward compatibility:
--   - existing rows: descriptor_json = NULL, descriptor_schema_version = NULL
--   - existing flows (pdf-renderer.service.ts): ยังทำงานได้ (เพราะไม่อ่าน column นี้)
--   - new flows (document-composer): ตรวจ NULL แล้ว fallback ไป default descriptor
--
-- Version-safe:
--   - ตอน load: ถ้า descriptor_schema_version ที่เก็บ != 1 → ถือว่า incompatible
--     return default descriptor (with warning ใน meta)
--   - ตอน save: validate ผ่าน DocumentDescriptorSchema (zod) ก่อน persist
--   - ถ้ามี descriptor v2 ในอนาคต → เพิ่ม migration transform JSON + bump version
--
-- Rollback:
-- ALTER TABLE template_versions DROP COLUMN descriptor_json;
-- ALTER TABLE template_versions DROP COLUMN descriptor_schema_version;
-- ALTER TABLE template_versions DROP COLUMN descriptor_updated_at;
-- ALTER TABLE template_versions DROP COLUMN descriptor_updated_by;
-- DROP INDEX IF EXISTS idx_tpl_versions_descriptor_version;

-- =============================================================================
-- 1. template_versions: add descriptor columns
-- =============================================================================

ALTER TABLE template_versions ADD COLUMN descriptor_json TEXT;
ALTER TABLE template_versions ADD COLUMN descriptor_schema_version INTEGER;
ALTER TABLE template_versions ADD COLUMN descriptor_updated_at INTEGER;
ALTER TABLE template_versions ADD COLUMN descriptor_updated_by TEXT
  REFERENCES admin_users(id) ON DELETE SET NULL;

-- Index สำหรับ query "template versions ที่มี descriptor defined"
CREATE INDEX idx_tpl_versions_descriptor_version
  ON template_versions(descriptor_schema_version)
  WHERE descriptor_schema_version IS NOT NULL;
