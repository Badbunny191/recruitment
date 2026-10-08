PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`application_no` text,
	`round_id` text NOT NULL,
	`email` text NOT NULL,
	`fullname` text NOT NULL,
	`national_id` text NOT NULL,
	`status` text DEFAULT 'SUBMITTED',
	`status_reason` text,
	`verified_by` text,
	`verified_at` integer,
	`form_data` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()),
	`deleted_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `recruitment_rounds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_app_status" CHECK("__new_applications"."status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'))
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "application_no", "round_id", "email", "fullname", "national_id", "status", "status_reason", "verified_by", "verified_at", "form_data", "submitted_at", "deleted_at") SELECT "id", "application_no", "round_id", "email", "fullname", "national_id", "status", "status_reason", "verified_by", "verified_at", "form_data", "submitted_at", "deleted_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_application_no_unique` ON `applications` (`application_no`);--> statement-breakpoint
CREATE INDEX `idx_apps_round` ON `applications` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_apps_status` ON `applications` (`status`);--> statement-breakpoint
CREATE INDEX `idx_apps_round_status` ON `applications` (`round_id`,`status`);--> statement-breakpoint
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
	CONSTRAINT "chk_field_type" CHECK("__new_field_master"."field_type" IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE'))
);
--> statement-breakpoint
INSERT INTO `__new_field_master`("id", "field_type", "label_th", "default_options", "pdf_mapping_key", "is_active", "help_text", "placeholder", "section", "file_config", "validation_type", "validation_message") SELECT "id", "field_type", "label_th", "default_options", "pdf_mapping_key", "is_active", "help_text", "placeholder", "section", "file_config", "validation_type", "validation_message" FROM `field_master`;--> statement-breakpoint
DROP TABLE `field_master`;--> statement-breakpoint
ALTER TABLE `__new_field_master` RENAME TO `field_master`;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `help_text` text;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `placeholder` text;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `validation_rules` text;