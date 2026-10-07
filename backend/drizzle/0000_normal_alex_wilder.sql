CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'HR_OFFICER' NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `application_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`field_id` text NOT NULL,
	`file_url` text NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_app` ON `application_attachments` (`application_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`application_no` text,
	`round_id` text NOT NULL,
	`email` text NOT NULL,
	`fullname` text NOT NULL,
	`national_id` text NOT NULL,
	`status` text DEFAULT 'SUBMITTED',
	`form_data` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()),
	`deleted_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `recruitment_rounds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_app_status" CHECK("applications"."status" IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_application_no_unique` ON `applications` (`application_no`);--> statement-breakpoint
CREATE INDEX `idx_apps_round` ON `applications` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_apps_status` ON `applications` (`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `field_master` (
	`id` text PRIMARY KEY NOT NULL,
	`field_type` text NOT NULL,
	`label_th` text NOT NULL,
	`default_options` text,
	`pdf_mapping_key` text,
	`is_active` integer DEFAULT true,
	CONSTRAINT "chk_field_type" CHECK("field_master"."field_type" IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE'))
);
--> statement-breakpoint
CREATE TABLE `recruitment_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`title` text NOT NULL,
	`position_level` text NOT NULL,
	`open_date` integer NOT NULL,
	`close_date` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE',
	`created_at` integer DEFAULT (unixepoch()),
	`deleted_at` integer,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_round_status" CHECK("recruitment_rounds"."status" IN ('DRAFT', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "chk_round_dates" CHECK("recruitment_rounds"."close_date" >= "recruitment_rounds"."open_date")
);
--> statement-breakpoint
CREATE TABLE `template_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`field_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_required` integer DEFAULT true,
	`override_options` text,
	`override_label_th` text,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `field_master`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_tpl_fields_version` ON `template_fields` (`template_version_id`);--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text DEFAULT 'DRAFT',
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_version_status" CHECK("template_versions"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unq_template_version` ON `template_versions` (`template_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch())
);
