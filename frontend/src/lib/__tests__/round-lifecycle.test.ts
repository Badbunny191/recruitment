/**
 * Round lifecycle — pure helper tests
 * -----------------------------------
 * ตรวจว่า "สถานะที่ผู้ใช้เห็น" บน Summary Card ตรงกับกติกาที่ระบบบังคับใช้จริง
 *
 *   - resolveRoundLifecycle: DRAFT/CLOSED มาจาก status, ACTIVE ต้องอยู่ในช่วงวันเปิด/ปิด
 *   - partition ต้องบวกกันได้เต็ม: OPEN + DRAFT + CLOSED + SCHEDULED = ทั้งหมด
 *   - timezone: เทียบด้วยเวลา Asia/Bangkok (UTC+7) ไม่ใช่เวลาเครื่องผู้ใช้
 *
 * Run: node --import tsx src/lib/__tests__/round-lifecycle.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  resolveRoundLifecycle,
  ROUND_LIFECYCLE_LABEL,
  type RoundLifecycleInput,
} from '../round-lifecycle';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ========== FIXTURES ==========

const BKK = 7 * 60 * 60 * 1000;

/** สร้าง Date ที่หมายถึง "เวลากรุงเทพฯ ตามที่ผู้ใช้เห็น" */
function bkk(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - BKK);
}

/** now ที่หมายถึงเวลากรุงเทพฯ ที่กำหนด */
function nowAt(y: number, m: number, d: number, h = 0, min = 0): number {
  return bkk(y, m, d, h, min).getTime();
}

function round(over: Partial<RoundLifecycleInput>): RoundLifecycleInput {
  return {
    status: 'ACTIVE',
    openDate: bkk(2026, 11, 1),
    closeDate: bkk(2026, 11, 30),
    ...over,
  };
}

// ========== TESTS ==========

console.log('=== status → lifecycle ===');

test('L1: DRAFT → DRAFT ไม่สนวันที่', () => {
  assertEqual(resolveRoundLifecycle(round({ status: 'DRAFT' }), nowAt(2026, 11, 15)), 'DRAFT');
});

test('L2: CLOSED → CLOSED แม้จะอยู่ในช่วงวันที่', () => {
  assertEqual(resolveRoundLifecycle(round({ status: 'CLOSED' }), nowAt(2026, 11, 15)), 'CLOSED');
});

test('L3: ACTIVE + อยู่ในช่วง → OPEN', () => {
  assertEqual(resolveRoundLifecycle(round({}), nowAt(2026, 11, 15)), 'OPEN');
});

test('L4: ACTIVE + เลย closeDate → CLOSED (ไม่ใช่ OPEN)', () => {
  // นี่คือบั๊กเดิม: status ยังเป็น ACTIVE แต่ผู้สมัครสมัครไม่ได้แล้ว
  assertEqual(resolveRoundLifecycle(round({}), nowAt(2026, 12, 1)), 'CLOSED');
});

test('L5: ACTIVE + ยังไม่ถึง openDate → SCHEDULED', () => {
  assertEqual(resolveRoundLifecycle(round({}), nowAt(2026, 10, 31)), 'SCHEDULED');
});

test('L6: status แปลก/null → CLOSED (fail-closed ไม่ให้แถวหลุดจากทุก Card)', () => {
  assertEqual(resolveRoundLifecycle(round({ status: null }), nowAt(2026, 11, 15)), 'CLOSED');
  assertEqual(resolveRoundLifecycle(round({ status: 'WEIRD' }), nowAt(2026, 11, 15)), 'CLOSED');
});

test('L7: ACTIVE ที่ไม่มีวันที่ → CLOSED (ตรงกับ backend ที่คืน ALREADY_CLOSED)', () => {
  assertEqual(resolveRoundLifecycle(round({ openDate: null }), nowAt(2026, 11, 15)), 'CLOSED');
  assertEqual(resolveRoundLifecycle(round({ closeDate: null }), nowAt(2026, 11, 15)), 'CLOSED');
});

console.log('\n=== ขอบเขตเวลา (Asia/Bangkok) ===');

test('B1: เปิดวันนี้ 00:00 → OPEN ตอน 00:00 กรุงเทพฯ', () => {
  const r = round({ openDate: bkk(2026, 11, 15), closeDate: bkk(2026, 11, 20) });
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 15, 0, 0)), 'OPEN');
});

test('B2: ก่อนเปิด 1 นาที → SCHEDULED', () => {
  const r = round({ openDate: bkk(2026, 11, 15, 9, 0), closeDate: bkk(2026, 11, 20) });
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 15, 8, 59)), 'SCHEDULED');
});

test('B3: closeDate 23:59 → ยัง OPEN, เกินไป 1 นาที → CLOSED', () => {
  const r = round({ openDate: bkk(2026, 11, 1), closeDate: bkk(2026, 11, 15, 23, 59) });
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 15, 23, 59)), 'OPEN');
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 16, 0, 0)), 'CLOSED');
});

test('B4: รับ timestamp เป็น number (unix seconds) ได้', () => {
  const openSec = Math.floor(bkk(2026, 11, 1).getTime() / 1000);
  const closeSec = Math.floor(bkk(2026, 11, 30).getTime() / 1000);
  const r = round({ openDate: openSec, closeDate: closeSec });
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 15)), 'OPEN');
});

test('B5: รับ ISO string ได้', () => {
  const r = round({
    openDate: bkk(2026, 11, 1).toISOString(),
    closeDate: bkk(2026, 11, 30).toISOString(),
  });
  assertEqual(resolveRoundLifecycle(r, nowAt(2026, 11, 15)), 'OPEN');
});

console.log('\n=== partition บวกกันได้เต็ม ===');

test('P1: 4 รอบ (OPEN 2, CLOSED 1, DRAFT 1) → ผลรวม = 4', () => {
  const now = nowAt(2026, 11, 15);
  const rows = [
    round({ status: 'ACTIVE' }),
    round({ status: 'ACTIVE' }),
    round({ status: 'CLOSED' }),
    round({ status: 'DRAFT' }),
  ];
  const counts = { OPEN: 0, DRAFT: 0, CLOSED: 0, SCHEDULED: 0 };
  for (const r of rows) counts[resolveRoundLifecycle(r, now)] += 1;

  assertEqual(counts.OPEN, 2, 'OPEN');
  assertEqual(counts.DRAFT, 1, 'DRAFT');
  assertEqual(counts.CLOSED, 1, 'CLOSED');
  assertEqual(counts.SCHEDULED, 0, 'SCHEDULED');
  assertEqual(counts.OPEN + counts.DRAFT + counts.CLOSED + counts.SCHEDULED, rows.length, 'total');
});

test('P2: ACTIVE ที่หมดเขตถูกนับเป็น CLOSED ไม่ใช่ OPEN (เคสที่ทำให้ 2+1=3 เดิม)', () => {
  const now = nowAt(2026, 12, 15);
  const rows = [
    round({ status: 'ACTIVE', closeDate: bkk(2026, 11, 30) }), // หมดเขต → CLOSED
    round({ status: 'ACTIVE', openDate: bkk(2026, 12, 1), closeDate: bkk(2026, 12, 31) }), // OPEN
    round({ status: 'DRAFT' }),
  ];
  const counts = { OPEN: 0, DRAFT: 0, CLOSED: 0, SCHEDULED: 0 };
  for (const r of rows) counts[resolveRoundLifecycle(r, now)] += 1;

  assertEqual(counts.OPEN, 1, 'OPEN');
  assertEqual(counts.CLOSED, 1, 'CLOSED');
  assertEqual(counts.DRAFT, 1, 'DRAFT');
  assertEqual(counts.OPEN + counts.DRAFT + counts.CLOSED + counts.SCHEDULED, 3, 'total');
});

test('P3: ทุก lifecycle มีป้ายภาษาไทย ครบ 4 ตัว', () => {
  assertEqual(ROUND_LIFECYCLE_LABEL.OPEN, 'เปิดรับ');
  assertEqual(ROUND_LIFECYCLE_LABEL.DRAFT, 'ร่าง');
  assertEqual(ROUND_LIFECYCLE_LABEL.CLOSED, 'ปิดรับ');
  assertEqual(ROUND_LIFECYCLE_LABEL.SCHEDULED, 'กำหนดไว้');
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
