CREATE TABLE `template_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tpl_sections_version` ON `template_sections` (`template_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_tpl_sections_version_order` ON `template_sections` (`template_version_id`,`display_order`);--> statement-breakpoint
ALTER TABLE `template_fields` ADD `section_id` text REFERENCES template_sections(id);--> statement-breakpoint
CREATE INDEX `idx_tpl_fields_section` ON `template_fields` (`section_id`);