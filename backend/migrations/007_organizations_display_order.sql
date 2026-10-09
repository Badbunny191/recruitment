-- Migration: Sprint 2.1 - Organization display_order
-- 1. เพิ่ม column display_order ใน organizations (INTEGER NOT NULL)
-- 2. Update 141 rows: display_order = 1-141 ตามลำดับ id
-- 3. สร้าง index เพื่อ performance

-- =============================================================================
-- 1. Add display_order column
-- =============================================================================
ALTER TABLE organizations ADD COLUMN display_order INTEGER;

-- =============================================================================
-- 2. Populate display_order 1-141 ตาม id (org-001 → 1, ..., org-141 → 141)
-- =============================================================================
-- ส่วนกลาง 1-20 (display_order 1-20)
UPDATE organizations SET display_order = 1  WHERE id = 'org-001';
UPDATE organizations SET display_order = 2  WHERE id = 'org-002';
UPDATE organizations SET display_order = 3  WHERE id = 'org-003';
UPDATE organizations SET display_order = 4  WHERE id = 'org-004';
UPDATE organizations SET display_order = 5  WHERE id = 'org-005';
UPDATE organizations SET display_order = 6  WHERE id = 'org-006';
UPDATE organizations SET display_order = 7  WHERE id = 'org-007';
UPDATE organizations SET display_order = 8  WHERE id = 'org-008';
UPDATE organizations SET display_order = 9  WHERE id = 'org-009';
UPDATE organizations SET display_order = 10 WHERE id = 'org-010';
UPDATE organizations SET display_order = 11 WHERE id = 'org-011';
UPDATE organizations SET display_order = 12 WHERE id = 'org-012';
UPDATE organizations SET display_order = 13 WHERE id = 'org-013';
UPDATE organizations SET display_order = 14 WHERE id = 'org-014';
UPDATE organizations SET display_order = 15 WHERE id = 'org-015';
UPDATE organizations SET display_order = 16 WHERE id = 'org-016';
UPDATE organizations SET display_order = 17 WHERE id = 'org-017';
UPDATE organizations SET display_order = 18 WHERE id = 'org-018';
UPDATE organizations SET display_order = 19 WHERE id = 'org-019';
UPDATE organizations SET display_order = 20 WHERE id = 'org-020';

-- สำนักตรวจเงินแผ่นดินที่ 1-22 (display_order 21-42)
UPDATE organizations SET display_order = 21 WHERE id = 'org-021';
UPDATE organizations SET display_order = 22 WHERE id = 'org-022';
UPDATE organizations SET display_order = 23 WHERE id = 'org-023';
UPDATE organizations SET display_order = 24 WHERE id = 'org-024';
UPDATE organizations SET display_order = 25 WHERE id = 'org-025';
UPDATE organizations SET display_order = 26 WHERE id = 'org-026';
UPDATE organizations SET display_order = 27 WHERE id = 'org-027';
UPDATE organizations SET display_order = 28 WHERE id = 'org-028';
UPDATE organizations SET display_order = 29 WHERE id = 'org-029';
UPDATE organizations SET display_order = 30 WHERE id = 'org-030';
UPDATE organizations SET display_order = 31 WHERE id = 'org-031';
UPDATE organizations SET display_order = 32 WHERE id = 'org-032';
UPDATE organizations SET display_order = 33 WHERE id = 'org-033';
UPDATE organizations SET display_order = 34 WHERE id = 'org-034';
UPDATE organizations SET display_order = 35 WHERE id = 'org-035';
UPDATE organizations SET display_order = 36 WHERE id = 'org-036';
UPDATE organizations SET display_order = 37 WHERE id = 'org-037';
UPDATE organizations SET display_order = 38 WHERE id = 'org-038';
UPDATE organizations SET display_order = 39 WHERE id = 'org-039';
UPDATE organizations SET display_order = 40 WHERE id = 'org-040';
UPDATE organizations SET display_order = 41 WHERE id = 'org-041';
UPDATE organizations SET display_order = 42 WHERE id = 'org-042';

-- สำนักตรวจสอบการปฏิบัติตามกฎหมายที่ 1-3 (display_order 43-45)
UPDATE organizations SET display_order = 43 WHERE id = 'org-043';
UPDATE organizations SET display_order = 44 WHERE id = 'org-044';
UPDATE organizations SET display_order = 45 WHERE id = 'org-045';

-- สำนักตรวจสอบผลสัมฤทธิ์ที่ 1-5 (display_order 46-50)
UPDATE organizations SET display_order = 46 WHERE id = 'org-046';
UPDATE organizations SET display_order = 47 WHERE id = 'org-047';
UPDATE organizations SET display_order = 48 WHERE id = 'org-048';
UPDATE organizations SET display_order = 49 WHERE id = 'org-049';
UPDATE organizations SET display_order = 50 WHERE id = 'org-050';

-- ภูมิภาคที่ 1 (display_order 51-57)
UPDATE organizations SET display_order = 51 WHERE id = 'org-051';
UPDATE organizations SET display_order = 52 WHERE id = 'org-052';
UPDATE organizations SET display_order = 53 WHERE id = 'org-053';
UPDATE organizations SET display_order = 54 WHERE id = 'org-054';
UPDATE organizations SET display_order = 55 WHERE id = 'org-055';
UPDATE organizations SET display_order = 56 WHERE id = 'org-056';
UPDATE organizations SET display_order = 57 WHERE id = 'org-057';

-- ภูมิภาคที่ 2 (display_order 58-64)
UPDATE organizations SET display_order = 58 WHERE id = 'org-058';
UPDATE organizations SET display_order = 59 WHERE id = 'org-059';
UPDATE organizations SET display_order = 60 WHERE id = 'org-060';
UPDATE organizations SET display_order = 61 WHERE id = 'org-061';
UPDATE organizations SET display_order = 62 WHERE id = 'org-062';
UPDATE organizations SET display_order = 63 WHERE id = 'org-063';
UPDATE organizations SET display_order = 64 WHERE id = 'org-064';

-- ภูมิภาคที่ 3 (display_order 65-71)
UPDATE organizations SET display_order = 65 WHERE id = 'org-065';
UPDATE organizations SET display_order = 66 WHERE id = 'org-066';
UPDATE organizations SET display_order = 67 WHERE id = 'org-067';
UPDATE organizations SET display_order = 68 WHERE id = 'org-068';
UPDATE organizations SET display_order = 69 WHERE id = 'org-069';
UPDATE organizations SET display_order = 70 WHERE id = 'org-070';
UPDATE organizations SET display_order = 71 WHERE id = 'org-071';

-- ภูมิภาคที่ 4 (display_order 72-76)
UPDATE organizations SET display_order = 72 WHERE id = 'org-072';
UPDATE organizations SET display_order = 73 WHERE id = 'org-073';
UPDATE organizations SET display_order = 74 WHERE id = 'org-074';
UPDATE organizations SET display_order = 75 WHERE id = 'org-075';
UPDATE organizations SET display_order = 76 WHERE id = 'org-076';

-- ภูมิภาคที่ 5 (display_order 77-83)
UPDATE organizations SET display_order = 77 WHERE id = 'org-077';
UPDATE organizations SET display_order = 78 WHERE id = 'org-078';
UPDATE organizations SET display_order = 79 WHERE id = 'org-079';
UPDATE organizations SET display_order = 80 WHERE id = 'org-080';
UPDATE organizations SET display_order = 81 WHERE id = 'org-081';
UPDATE organizations SET display_order = 82 WHERE id = 'org-082';
UPDATE organizations SET display_order = 83 WHERE id = 'org-083';

-- ภูมิภาคที่ 6 (display_order 84-90)
UPDATE organizations SET display_order = 84 WHERE id = 'org-084';
UPDATE organizations SET display_order = 85 WHERE id = 'org-085';
UPDATE organizations SET display_order = 86 WHERE id = 'org-086';
UPDATE organizations SET display_order = 87 WHERE id = 'org-087';
UPDATE organizations SET display_order = 88 WHERE id = 'org-088';
UPDATE organizations SET display_order = 89 WHERE id = 'org-089';
UPDATE organizations SET display_order = 90 WHERE id = 'org-090';

-- ภูมิภาคที่ 7 (display_order 91-95)
UPDATE organizations SET display_order = 91 WHERE id = 'org-091';
UPDATE organizations SET display_order = 92 WHERE id = 'org-092';
UPDATE organizations SET display_order = 93 WHERE id = 'org-093';
UPDATE organizations SET display_order = 94 WHERE id = 'org-094';
UPDATE organizations SET display_order = 95 WHERE id = 'org-095';

-- ภูมิภาคที่ 8 (display_order 96-100)
UPDATE organizations SET display_order = 96  WHERE id = 'org-096';
UPDATE organizations SET display_order = 97  WHERE id = 'org-097';
UPDATE organizations SET display_order = 98  WHERE id = 'org-098';
UPDATE organizations SET display_order = 99  WHERE id = 'org-099';
UPDATE organizations SET display_order = 100 WHERE id = 'org-100';

-- ภูมิภาคที่ 9 (display_order 101-106)
UPDATE organizations SET display_order = 101 WHERE id = 'org-101';
UPDATE organizations SET display_order = 102 WHERE id = 'org-102';
UPDATE organizations SET display_order = 103 WHERE id = 'org-103';
UPDATE organizations SET display_order = 104 WHERE id = 'org-104';
UPDATE organizations SET display_order = 105 WHERE id = 'org-105';
UPDATE organizations SET display_order = 106 WHERE id = 'org-106';

-- ภูมิภาคที่ 10 (display_order 107-111)
UPDATE organizations SET display_order = 107 WHERE id = 'org-107';
UPDATE organizations SET display_order = 108 WHERE id = 'org-108';
UPDATE organizations SET display_order = 109 WHERE id = 'org-109';
UPDATE organizations SET display_order = 110 WHERE id = 'org-110';
UPDATE organizations SET display_order = 111 WHERE id = 'org-111';

-- ภูมิภาคที่ 11 (display_order 112-118)
UPDATE organizations SET display_order = 112 WHERE id = 'org-112';
UPDATE organizations SET display_order = 113 WHERE id = 'org-113';
UPDATE organizations SET display_order = 114 WHERE id = 'org-114';
UPDATE organizations SET display_order = 115 WHERE id = 'org-115';
UPDATE organizations SET display_order = 116 WHERE id = 'org-116';
UPDATE organizations SET display_order = 117 WHERE id = 'org-117';
UPDATE organizations SET display_order = 118 WHERE id = 'org-118';

-- ภูมิภาคที่ 12 (display_order 119-124)
UPDATE organizations SET display_order = 119 WHERE id = 'org-119';
UPDATE organizations SET display_order = 120 WHERE id = 'org-120';
UPDATE organizations SET display_order = 121 WHERE id = 'org-121';
UPDATE organizations SET display_order = 122 WHERE id = 'org-122';
UPDATE organizations SET display_order = 123 WHERE id = 'org-123';
UPDATE organizations SET display_order = 124 WHERE id = 'org-124';

-- ภูมิภาคที่ 13 (display_order 125-130)
UPDATE organizations SET display_order = 125 WHERE id = 'org-125';
UPDATE organizations SET display_order = 126 WHERE id = 'org-126';
UPDATE organizations SET display_order = 127 WHERE id = 'org-127';
UPDATE organizations SET display_order = 128 WHERE id = 'org-128';
UPDATE organizations SET display_order = 129 WHERE id = 'org-129';
UPDATE organizations SET display_order = 130 WHERE id = 'org-130';

-- ภูมิภาคที่ 14 (display_order 131-135)
UPDATE organizations SET display_order = 131 WHERE id = 'org-131';
UPDATE organizations SET display_order = 132 WHERE id = 'org-132';
UPDATE organizations SET display_order = 133 WHERE id = 'org-133';
UPDATE organizations SET display_order = 134 WHERE id = 'org-134';
UPDATE organizations SET display_order = 135 WHERE id = 'org-135';

-- ภูมิภาคที่ 15 (display_order 136-141)
UPDATE organizations SET display_order = 136 WHERE id = 'org-136';
UPDATE organizations SET display_order = 137 WHERE id = 'org-137';
UPDATE organizations SET display_order = 138 WHERE id = 'org-138';
UPDATE organizations SET display_order = 139 WHERE id = 'org-139';
UPDATE organizations SET display_order = 140 WHERE id = 'org-140';
UPDATE organizations SET display_order = 141 WHERE id = 'org-141';

-- =============================================================================
-- 3. Index เพื่อ performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_organizations_display_order ON organizations(display_order);
