-- Migration: Add deleted_at column to templates
-- Feature: Archive / Restore / Permanent Delete

ALTER TABLE templates
ADD COLUMN deleted_at integer;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_templates_deleted_at
ON templates(deleted_at);