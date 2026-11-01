/**
 * Dashboard Round Filter — pure helper tests
 * -------------------------------------------
 * ครอบคลุม logic ของ dropdown filter รอบบน Executive Dashboard:
 *
 *   - parseDashboardRoundParam: ไม่มี param / มีค่า / ค่าว่าง → null
 *   - dashboardOverviewApiPath: path เดิมเมื่อไม่เลือก + ?roundId= (encode)
 *     เมื่อเลือก — ยังเป็น endpoint เดียว ไม่มี request ต่อ widget เพิ่ม
 *   - isRoundSelectable: self-heal predicate ของ URL ที่ชี้รอบที่ถูกลบ
 *     (rounds=null = ตัดสินไม่ได้ ห้ามล้าง)
 *
 * Run: node --import tsx src/lib/__tests__/dashboard-round-filter.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  parseDashboardRoundParam,
  dashboardOverviewApiPath,
  isRoundSelectable,
  type RoundItem,
} from '../dashboard-overview';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ========== FIXTURES ==========

const ROUNDS: RoundItem[] = [
  { id: 'r-1', title: 'รอบ A', roundCode: 'RC-A' },
  { id: 'r-2', title: 'รอบ B' },
];

function paramsOf(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

// ========== TESTS ==========

console.log('=== parseDashboardRoundParam ===');

test('F1a: ไม่มี param → null (default = ทั้งหมด, ไม่เขียนลง URL)', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('')), null);
  assertEqual(parseDashboardRoundParam(paramsOf('status=SUBMITTED')), null);
});

test('F1b: มีค่า → ค่าตรงตาม URL', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('roundId=r-1')), 'r-1');
  assertEqual(parseDashboardRoundParam(paramsOf('status=SUBMITTED&roundId=r-2')), 'r-2');
});

test('F1c: ค่าว่าง (?roundId=) → null ≡ ทั้งหมด', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('roundId=')), null);
});

console.log('=== dashboardOverviewApiPath ===');

test('F2a: ไม่เลือก → path เดิม ไม่มี query (1 request เท่าเดิม)', () => {
  assertEqual(dashboardOverviewApiPath(null), '/admin/dashboard/overview');
});

test('F2b: เลือกรอบ → endpoint เดียวกัน + ?roundId= แนบท้าย', () => {
  assertEqual(dashboardOverviewApiPath('r-1'), '/admin/dashboard/overview?roundId=r-1');
});

test('F2c: id มีอักขระพิเศษ → encodeURIComponent กัน URL พัง', () => {
  assertEqual(
    dashboardOverviewApiPath('a&b=c'),
    '/admin/dashboard/overview?roundId=a%26b%3Dc',
  );
});

console.log('=== isRoundSelectable (self-heal predicate) ===');

test('F3a: ไม่มีการเลือก → true (ไม่มีอะไรต้อง heal)', () => {
  assertEqual(isRoundSelectable(null, ROUNDS), true);
  assertEqual(isRoundSelectable(null, null), true);
});

test('F3b: id อยู่ในรายการรอบ → true (คงการเลือก)', () => {
  assertEqual(isRoundSelectable('r-1', ROUNDS), true);
  assertEqual(isRoundSelectable('r-2', ROUNDS), true);
});

test('F3c: id ไม่อยู่ในรายการ → false (ต้องล้างกลับทั้งหมด)', () => {
  assertEqual(isRoundSelectable('r-deleted', ROUNDS), false);
  assertEqual(isRoundSelectable('r-1 ', ROUNDS), false, 'ค่าที่มีช่องว่างก็ไม่ match');
});

test('F3d: rounds = null (section ล้ม) → true (ตัดสินไม่ได้ ห้ามล้าง filter)', () => {
  assertEqual(isRoundSelectable('r-1', null), true);
  assertEqual(isRoundSelectable('r-1', undefined), true);
});

// ========== SUMMARY ==========

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
if (failed > 0) {
  (globalThis as any).process.exit(1);
}
