-- Migration: Sprint 4 - Recovery for negative display_order
-- ใช้เมื่อ reorder fail กลางทาง (D1 batch ไม่ใช่ transaction)
-- Symptoms: template_sections.display_order มีค่าติดลบ (-1, -2, -3...)
-- หรือ display_order ไม่เรียง 1, 2, 3, ...

-- 1. Reset ค่าติดลบเป็นค่าบวก (ABS)
UPDATE `template_sections`
SET `display_order` = ABS(`display_order`),
    `updated_at` = unixepoch()
WHERE `display_order` < 0;

--> statement-breakpoint

-- 2. Renumber ให้เรียง sequential (1, 2, 3...) per version
-- ใช้ subquery นับจำนวน sections ที่มี displayOrder น้อยกว่า + id น้อยกว่า
UPDATE `template_sections`
SET `display_order` = (
  SELECT COUNT(*)
  FROM `template_sections` ts2
  WHERE ts2.`template_version_id` = `template_sections`.`template_version_id`
    AND ts2.`is_active` = 1
    AND (
      ts2.`display_order` < `template_sections`.`display_order`
      OR (ts2.`display_order` = `template_sections`.`display_order` AND ts2.`id` <= `template_sections`.`id`)
    )
),
`updated_at` = unixepoch()
WHERE `is_active` = 1;

--> statement-breakpoint

-- 3. Verify: ทุก version ที่ active ต้องมีอย่างน้อย 1 section
-- (ถ้าไม่มี หมายความว่า data เสียหาย — ต้อง restore จาก backup)
-- Query สำหรับตรวจสอบ:
-- SELECT tv.id, COUNT(ts.id) AS section_count
-- FROM template_versions tv
-- LEFT JOIN template_sections ts ON ts.template_version_id = tv.id AND ts.is_active = 1
-- GROUP BY tv.id
-- HAVING section_count = 0;
