-- Migration: Make national_id nullable in applications table
-- Reason: Template schema-driven application - national_id is optional depending on template
-- SQLite/D1 does not support ALTER COLUMN, must use copy-recreate method

PRAGMA foreign_keys=OFF;

--> statement-breakpoint
CREATE TABLE `__new_applications` (
  `id` text PRIMARY KEY NOT NULL,
  `application_no` text,
  `round_id` text NOT NULL,
  `email` text NOT NULL,
  `fullname` text NOT NULL,
  `national_id` text,
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
INSERT INTO `__new_applications`("id", "application_no", "round_id", "email", "fullname", "national_id", "status", "status_reason", "verified_by", "verified_at", "form_data", "submitted_at", "deleted_at") SELECT "id", "application_no", "round_id", "email", "fullname", "national_id", "status", "status_reason", "verified_by", "verified_at", "form_data", "submitted_at", "deleted_at" FROM `applications`;
--> statement-breakpoint
DROP TABLE `applications`;
--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `applications_application_no_unique` ON `applications` (`application_no`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_apps_round` ON `applications` (`round_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_apps_status` ON `applications` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_apps_round_status` ON `applications` (`round_id`, `status`);
