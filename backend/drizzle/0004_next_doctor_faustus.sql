CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`job_family_id` text NOT NULL,
	`position_level_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
