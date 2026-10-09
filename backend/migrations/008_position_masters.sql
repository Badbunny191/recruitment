-- Migration: Sprint 3 - Position Masters
-- 1. ตาราง job_families (14 รายการเริ่มต้น)
-- 2. ตาราง position_levels (10 รายการเริ่มต้น)
-- ทั้งสองตารางมี display_order สำหรับการเรียง + index

-- =============================================================================
-- 1. Job Families
-- =============================================================================
CREATE TABLE IF NOT EXISTS `job_families` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `display_order` integer NOT NULL,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch())
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_job_families_display_order` ON `job_families`(`display_order`);

--> statement-breakpoint

-- Job Family ข้อมูลเริ่มต้น 14 รายการ
INSERT INTO `job_families` (`id`, `name`, `display_order`) VALUES
('jf-001', 'นักวิชาการตรวจเงินแผ่นดิน', 1),
('jf-002', 'นิติกร', 2),
('jf-003', 'นักทรัพยากรบุคคล', 3),
('jf-004', 'นักวิเคราะห์นโยบายและแผน', 4),
('jf-005', 'นักวิชาการคอมพิวเตอร์', 5),
('jf-006', 'นักประชาสัมพันธ์', 6),
('jf-007', 'นักวิชาการพัสดุ', 7),
('jf-008', 'นักวิเทศสัมพันธ์', 8),
('jf-009', 'นักวิชาการเงินและบัญชี', 9),
('jf-010', 'วิศวกร', 10),
('jf-011', 'นักวิชาการตรวจสอบภายใน', 11),
('jf-012', 'นักวิชาการโสตทัศนศึกษา', 12),
('jf-013', 'บรรณารักษ์', 13),
('jf-014', 'นักจัดการงานทั่วไป', 14);

--> statement-breakpoint

-- =============================================================================
-- 2. Position Levels
-- =============================================================================
CREATE TABLE IF NOT EXISTS `position_levels` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `display_order` integer NOT NULL,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch())
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_position_levels_display_order` ON `position_levels`(`display_order`);

--> statement-breakpoint

-- Position Level ข้อมูลเริ่มต้น 10 รายการ
INSERT INTO `position_levels` (`id`, `name`, `display_order`) VALUES
('pl-001', 'ปฏิบัติงาน', 1),
('pl-002', 'อาวุโส', 2),
('pl-003', 'ชำนาญการ', 3),
('pl-004', 'ชำนาญการพิเศษ', 4),
('pl-005', 'เชี่ยวชาญ', 5),
('pl-006', 'ทรงคุณวุฒิ', 6),
('pl-007', 'อำนวยการต้น', 7),
('pl-008', 'อำนวยการสูง', 8),
('pl-009', 'บริหารต้น', 9),
('pl-010', 'บริหารสูง', 10);

--> statement-breakpoint

-- =============================================================================
-- 3. Positions (Job Family + Position Level reference)
-- ใช้สำหรับทดสอบ SearchableDropdown (ตาม Sprint 3 requirement)
-- ข้อมูลเริ่มต้น 5 รายการ (เป็นตัวอย่าง Job Family + Position Level combination)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `positions` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `job_family_id` text NOT NULL,
  `position_level_id` text NOT NULL,
  `display_order` integer NOT NULL,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch())
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_positions_display_order` ON `positions`(`display_order`);
CREATE INDEX IF NOT EXISTS `idx_positions_job_family` ON `positions`(`job_family_id`);
CREATE INDEX IF NOT EXISTS `idx_positions_level` ON `positions`(`position_level_id`);

--> statement-breakpoint

INSERT INTO `positions` (`id`, `title`, `job_family_id`, `position_level_id`, `display_order`) VALUES
('pos-001', 'นักวิชาการตรวจเงินแผ่นดิน (ปฏิบัติการ)', 'jf-001', 'pl-001', 1),
('pos-002', 'นักวิชาการตรวจเงินแผ่นดิน (ชำนาญการ)', 'jf-001', 'pl-003', 2),
('pos-003', 'นิติกร (ชำนาญการ)', 'jf-002', 'pl-003', 3),
('pos-004', 'นักวิชาการคอมพิวเตอร์ (ปฏิบัติการ)', 'jf-005', 'pl-001', 4),
('pos-005', 'นักวิชาการเงินและบัญชี (ชำนาญการพิเศษ)', 'jf-009', 'pl-004', 5);
