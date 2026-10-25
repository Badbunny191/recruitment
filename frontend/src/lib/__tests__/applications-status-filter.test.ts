/**
 * Status filter ของหน้า Applications (admin) tests
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/applications-status-filter.test.ts
 *
 * ครอบคลุม:
 *   - parseStatusFilter: ?status= ทั้ง 5 ค่า + all + ค่าไม่รู้จัก/ว่าง → default
 *     + legacy ?view= (all|active|archived) fallback เมื่อไม่มี ?status=
 *     + ?status= ชนะ ?view= เสมอ
 *   - statusFilterToParam: ALL → null (ไม่เขียนลง URL), แต่ละสถานะ → param ตาม spec
 *     + round-trip parse(statusFilterToParam(v)) === v ครบทุกค่า
 *   - filterByStatus: ALL คืนทั้งหมด, กรองเฉพาะสถานะที่เลือก, ไม่มีรายการ → ว่าง,
 *     ไม่แก้ array ต้นฉบับ
 *   - statusFilterToExportStatusParam: ALL → null, สถานะเดี่ยว → enum ตรง ๆ
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  STATUS_FILTER_OPTIONS,
  parseStatusFilter,
  statusFilterToParam,
  filterByStatus,
  statusFilterToExportStatusParam,
} from '../applications-status-filter';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err && err.message ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.error(`✗ ${name}`);
    console.error(`  ${msg}`);
  }
}

function eq(actual, expected, note = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${note} expected ${e}, got ${a}`);
  }
}

// ============================================================
// parseStatusFilter — ?status= (ค่าใหม่ตาม spec)
// ============================================================

test('parse: ?status=pending → SUBMITTED', () => {
  eq(parseStatusFilter('pending'), 'SUBMITTED');
});

test('parse: ?status=approved → QUALIFIED', () => {
  eq(parseStatusFilter('approved'), 'QUALIFIED');
});

test('parse: ?status=incomplete → REJECTED', () => {
  eq(parseStatusFilter('incomplete'), 'REJECTED');
});

test('parse: ?status=cancelled → CANCELED', () => {
  eq(parseStatusFilter('cancelled'), 'CANCELED');
});

test('parse: ?status=archived → ARCHIVED', () => {
  eq(parseStatusFilter('archived'), 'ARCHIVED');
});

test('parse: ไม่มี param → ALL (ทั้งหมด = default)', () => {
  eq(parseStatusFilter(null), 'ALL');
});

test('parse: ?status=all (explicit) → ALL', () => {
  eq(parseStatusFilter('all'), 'ALL');
});

test('parse: ค่าไม่รู้จัก (?status=foo) → ALL ไม่ crash', () => {
  eq(parseStatusFilter('foo'), 'ALL');
});

test('parse: ค่าว่าง ("") → ALL', () => {
  eq(parseStatusFilter(''), 'ALL');
});

test('parse: case-sensitive — PENDING (พิมพ์ใหญ่) ไม่ตรง → ALL', () => {
  eq(parseStatusFilter('PENDING'), 'ALL');
});

// ============================================================
// parseStatusFilter — legacy ?view= (filter 3 ปุ่มเดิม)
// ============================================================

test('parse legacy: ?view=archived → ARCHIVED', () => {
  eq(parseStatusFilter(null, 'archived'), 'ARCHIVED');
});

test('parse legacy: ?view=all → ALL', () => {
  eq(parseStatusFilter(null, 'all'), 'ALL');
});

test('parse legacy: ?view=active ("กำลังดำเนินการ" ไม่มีในชุดใหม่) → ALL', () => {
  eq(parseStatusFilter(null, 'active'), 'ALL');
});

test('parse priority: ?status= ชนะ ?view= เสมอ', () => {
  eq(parseStatusFilter('pending', 'archived'), 'SUBMITTED');
  eq(parseStatusFilter('archived', 'all'), 'ARCHIVED');
});

test('parse legacy: ค่า ?view= ไม่รู้จัก → ALL', () => {
  eq(parseStatusFilter(null, 'foo'), 'ALL');
});

// ============================================================
// statusFilterToParam — ค่า URL ที่เขียนลง URL
// ============================================================

test('toParam: ALL → null (ไม่เขียนลง URL)', () => {
  eq(statusFilterToParam('ALL'), null);
});

test('toParam: สถานะเดี่ยว → param ตาม spec', () => {
  eq(statusFilterToParam('SUBMITTED'), 'pending');
  eq(statusFilterToParam('QUALIFIED'), 'approved');
  eq(statusFilterToParam('REJECTED'), 'incomplete');
  eq(statusFilterToParam('CANCELED'), 'cancelled');
  eq(statusFilterToParam('ARCHIVED'), 'archived');
});

test('round-trip: parse(statusFilterToParam(v)) === v ครบทุกค่าใน options', () => {
  for (const opt of STATUS_FILTER_OPTIONS) {
    eq(parseStatusFilter(opt.param), opt.value, `round-trip ${opt.value}:`);
  }
});

test('options: มีครบ 6 ค่า เรียงตาม spec และ label ไม่ซ้ำ', () => {
  eq(STATUS_FILTER_OPTIONS.length, 6);
  eq(
    STATUS_FILTER_OPTIONS.map((o) => o.value),
    ['ALL', 'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'],
  );
  eq(new Set(STATUS_FILTER_OPTIONS.map((o) => o.label)).size, 6);
});

// ============================================================
// filterByStatus — กรอง list
// ============================================================

const SAMPLE = [
  { id: '1', status: 'SUBMITTED' },
  { id: '2', status: 'QUALIFIED' },
  { id: '3', status: 'QUALIFIED' },
  { id: '4', status: 'ARCHIVED' },
  { id: '5', status: 'CANCELED' },
];

test('filter: ALL → คืนทั้งหมด', () => {
  eq(filterByStatus(SAMPLE, 'ALL').length, 5);
});

test('filter: QUALIFIED → เฉพาะรายการสถานะนั้น', () => {
  const out = filterByStatus(SAMPLE, 'QUALIFIED');
  eq(out.map((x) => x.id), ['2', '3']);
});

test('filter: REJECTED (ไม่มีเลย) → ลิสต์ว่าง', () => {
  eq(filterByStatus(SAMPLE, 'REJECTED'), []);
});

test('filter: ไม่แก้ array ต้นฉบับ', () => {
  const source = [...SAMPLE];
  filterByStatus(source, 'SUBMITTED');
  filterByStatus(source, 'ALL');
  eq(source.length, SAMPLE.length);
});

// ============================================================
// statusFilterToExportStatusParam — Export Excel
// ============================================================

test('export param: ALL → null (backend คืนทุกสถานะ)', () => {
  eq(statusFilterToExportStatusParam('ALL'), null);
});

test('export param: สถานะเดี่ยว → enum ตรง ๆ (backend รับรูปแบบนี้อยู่แล้ว)', () => {
  eq(statusFilterToExportStatusParam('SUBMITTED'), 'SUBMITTED');
  eq(statusFilterToExportStatusParam('ARCHIVED'), 'ARCHIVED');
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFAILURES:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
