-- fixture: FK cycle a <-> b — reorder must refuse loudly (exit 1, no output
-- file, cycle path reported); an FK cycle can never be restored FK-ON
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE `a` (
	`id` text PRIMARY KEY NOT NULL,
	`b_id` text REFERENCES b(id)
);
CREATE TABLE `b` (
	`id` text PRIMARY KEY NOT NULL,
	`a_id` text REFERENCES a(id)
);
INSERT INTO "a" VALUES('a-1','b-1');
INSERT INTO "b" VALUES('b-1','a-1');
