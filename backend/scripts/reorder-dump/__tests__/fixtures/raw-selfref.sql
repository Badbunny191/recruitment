-- fixture: self-referencing FK (must not count as a cycle) + AUTOINCREMENT +
-- the sqlite_sequence restore semantics from the drill: DELETE FROM
-- sqlite_sequence must run AFTER all data inserts, then the saved counters
-- are re-inserted (group pinned last, internal order preserved)
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text REFERENCES categories(id),
	`name` text NOT NULL
);
INSERT INTO "categories" ("id","parent_id","name") VALUES('c-1',NULL,'root');
INSERT INTO "categories" ("id","parent_id","name") VALUES('c-2','c-1','child');
CREATE TABLE `items` (
	`id` INTEGER PRIMARY KEY AUTOINCREMENT,
	`cat_id` text NOT NULL,
	`qty` integer DEFAULT 0,
	FOREIGN KEY (`cat_id`) REFERENCES `categories`(`id`)
);
INSERT INTO "items" ("id","cat_id","qty") VALUES(5,'c-1',3);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('items',5);
