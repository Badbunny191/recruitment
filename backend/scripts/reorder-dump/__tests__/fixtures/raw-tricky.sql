-- fixture: hostile SQL shapes observed in real d1 exports —
--   * ';' and raw newlines inside single-quoted strings (multi-line INSERT)
--   * '' escaped quotes inside strings, JSON-looking payloads
--   * CHECK constraint with table-qualified identifiers and ';' inside strings
--   * the word REFERENCES inside a string literal (must NOT create an FK edge)
--   * lowercase `references` keyword (case-insensitivity)
--   * partial index (WHERE clause)
--   * FK to a table that is not in the dump (warning path, no edge)
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "chk_notes_status" CHECK("notes"."status" IN ('DRAFT', 'PUBLISHED;FINAL', 'REFERENCES nothing'))
);
INSERT INTO "notes" ("id","body","status") VALUES('n-1','บรรทัดแรก;
บรรทัดสอง; still {"json":"with; quote''s"}; -- not a comment
จบ', 'PUBLISHED;FINAL');
CREATE TABLE `note_links` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL references notes(id),
	`label` text DEFAULT 'REFERENCES nothing'
);
CREATE TABLE `orphans` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text REFERENCES missing_table(id)
);
CREATE INDEX idx_notes_status ON notes(status) WHERE status IS NOT NULL;
INSERT INTO "note_links" VALUES('l-1','n-1','x');
INSERT INTO "orphans" VALUES('o-1','m-1');
