-- ============================================
-- Migration: Sprint 2 - Audit Trail & Duplicate Prevention
-- ============================================

-- 1. Add unique constraint for duplicate prevention
-- This ensures one email can only apply once per round
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_round_email 
ON applications(round_id, email) 
WHERE deleted_at IS NULL;
