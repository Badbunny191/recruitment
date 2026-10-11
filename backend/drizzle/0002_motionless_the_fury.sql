CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
ALTER TABLE `recruitment_rounds` ADD `announcement_title` text;--> statement-breakpoint
ALTER TABLE `recruitment_rounds` ADD `announcement_description` text;--> statement-breakpoint
ALTER TABLE `recruitment_rounds` ADD `contact_information` text;--> statement-breakpoint
ALTER TABLE `recruitment_rounds` ADD `remark` text;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `rows` integer;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `min_length` integer;--> statement-breakpoint
ALTER TABLE `template_fields` ADD `max_length` integer;