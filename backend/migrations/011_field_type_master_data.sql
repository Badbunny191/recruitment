-- Migration: Add MASTER_DATA to field_type CHECK constraint
-- รองรับ Phase 1 MASTER_ORGANIZATION
-- SQLite ไม่รองรับ ALTER TABLE ADD CONSTRAINT จึงต้องสร้างตารางใหม่แล้วคัดลอกข้อมูล
-- หมายเหตุ: ชื่อคอลัมน์ใน CHECK ต้องไม่ระบุ prefix ตาราง
-- เพราะ SQLite ไม่แก้ไข reference ภายใน CHECK เมื่อ RENAME TABLE

PRAGMA foreign_keys=OFF;

CREATE TABLE `__new_field_master` (
	`id` text PRIMARY KEY NOT NULL,
	`field_type` text NOT NULL,
	`label_th` text NOT NULL,
	`default_options` text,
	`pdf_mapping_key` text,
	`is_active` integer DEFAULT true,
	`help_text` text,
	`placeholder` text,
	`section` text,
	`file_config` text,
	`validation_type` text,
	`validation_message` text,
	CONSTRAINT "chk_field_type" CHECK("field_type" IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA'))
);
--> statement-breakpoint

INSERT INTO `__new_field_master`("id", "field_type", "label_th", "default_options", "pdf_mapping_key", "is_active", "help_text", "placeholder", "section", "file_config", "validation_type", "validation_message")
SELECT "id", "field_type", "label_th", "default_options", "pdf_mapping_key", "is_active", "help_text", "placeholder", "section", "file_config", "validation_type", "validation_message" FROM `field_master`;
--> statement-breakpoint

DROP TABLE `field_master`;
--> statement-breakpoint

ALTER TABLE `__new_field_master` RENAME TO `field_master`;
--> statement-breakpoint

PRAGMA foreign_keys=ON;