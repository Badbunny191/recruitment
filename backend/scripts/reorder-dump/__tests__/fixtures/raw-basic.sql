-- fixture: child-before-parent interleaved dump — smallest reproducer of the
-- Restore Drill Lite failure (raw d1 export order, FK-ON restore explodes on
-- the first INSERT because the parent table does not exist yet)
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `recruitment_rounds`(`id`) ON DELETE cascade
);
INSERT INTO "applications" ("id","round_id","status") VALUES('app-1','round-1','SUBMITTED');
CREATE TABLE `recruitment_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL
);
INSERT INTO "recruitment_rounds" ("id","title","status") VALUES('round-1','รอบรับสมัคร 2569','ACTIVE');
CREATE UNIQUE INDEX `rounds_title_unique` ON `recruitment_rounds` (`title`);
CREATE INDEX idx_apps_round ON applications(round_id);
