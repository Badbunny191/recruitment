/**
 * Round Visibility — unit tests
 * ==============================
 * ครอบกติกาที่หน้าแรกใช้ตัดสินว่ารอบไหนอยู่กลุ่มไหน
 * (backend/src/lib/round-visibility.ts)
 *
 * นิยามที่ต้องเป็นจริง:
 *   OPEN      = ACTIVE + openDate <= now <= closeDate
 *   UPCOMING  = ACTIVE + now < openDate
 *   CLOSED    = CLOSED หรือ (ACTIVE + now > closeDate)
 *   DRAFT     = ไม่ขึ้นหน้า public
 *
 * Boundary ที่ต้องแม่นเป็นนาที:
 *   now === openDate        → OPEN
 *   now === closeDate       → OPEN
 *   now === closeDate + 1ms → CLOSED
 *   now === openDate - 1ms  → UPCOMING
 *
 * Run: node --import tsx src/lib/__tests__/round-visibility.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  resolveRoundPhase,
  groupRounds,
  toEpochMs,
  ROUND_PHASE_LABEL,
} from '../round-visibility';

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

function assertArrayEqual(actual: any[], expected: any[], msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

// ========== FIXTURES ==========

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** เวลากรุงเทพฯ → epoch ms (UTC) ตรงกับค่าที่ admin กรอกใน datetime-local */
const BKK = 7 * 60 * 60 * 1000;
function bkk(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min) - BKK;
}

function round(over: Record<string, any> = {}) {
  return {
    id: 'r1',
    status: 'ACTIVE',
    openDate: new Date(bkk(2026, 11, 1, 9, 0)),
    closeDate: new Date(bkk(2026, 11, 30, 16, 30)),
    ...over,
  };
}

// ========== 1. นิยามหลัก ==========

console.log('=== นิยาม OPEN / UPCOMING / CLOSED ===');

test('V1: ACTIVE + อยู่ในช่วง → OPEN', () => {
  assertEqual(resolveRoundPhase(round(), bkk(2026, 11, 15, 12, 0)), 'OPEN');
});

test('V2: ACTIVE + ยังไม่ถึง openDate → UPCOMING', () => {
  assertEqual(resolveRoundPhase(round(), bkk(2026, 10, 31, 23, 59)), 'UPCOMING');
});

test('V3: ACTIVE + เลย closeDate → CLOSED (นี่คือบั๊กที่ทำให้ปิดแล้วโผล่ใน "เปิดอยู่")', () => {
  assertEqual(resolveRoundPhase(round(), bkk(2026, 12, 1, 0, 0)), 'CLOSED');
});

test('V4: status CLOSED → CLOSED แม้จะอยู่ในช่วงวันที่', () => {
  assertEqual(resolveRoundPhase(round({ status: 'CLOSED' }), bkk(2026, 11, 15)), 'CLOSED');
});

test('V5: status DRAFT → DRAFT (ไม่ขึ้นหน้า public)', () => {
  assertEqual(resolveRoundPhase(round({ status: 'DRAFT' }), bkk(2026, 11, 15)), 'DRAFT');
});

test('V6: status พิมพ์เล็ก → normalize ได้', () => {
  assertEqual(resolveRoundPhase(round({ status: 'active' }), bkk(2026, 11, 15)), 'OPEN');
  assertEqual(resolveRoundPhase(round({ status: 'closed' }), bkk(2026, 11, 15)), 'CLOSED');
});

test('V7: status แปลก/null → CLOSED (fail-closed ไม่ให้หลุดเข้า OPEN)', () => {
  assertEqual(resolveRoundPhase(round({ status: null }), bkk(2026, 11, 15)), 'CLOSED');
  assertEqual(resolveRoundPhase(round({ status: 'WEIRD' }), bkk(2026, 11, 15)), 'CLOSED');
});

test('V8: ACTIVE ที่อ่านวันที่ไม่ได้ → CLOSED', () => {
  assertEqual(resolveRoundPhase(round({ openDate: null }), bkk(2026, 11, 15)), 'CLOSED');
  assertEqual(resolveRoundPhase(round({ closeDate: null }), bkk(2026, 11, 15)), 'CLOSED');
  assertEqual(resolveRoundPhase(round({ closeDate: 'not-a-date' }), bkk(2026, 11, 15)), 'CLOSED');
});

// ========== 2. Boundary ==========

console.log('\n=== Boundary (แม่นถึงนาที) ===');

test('B1: now === openDate พอดี → OPEN (inclusive)', () => {
  const open = bkk(2026, 11, 15, 9, 0);
  const r = round({ openDate: new Date(open), closeDate: new Date(bkk(2026, 11, 20)) });
  assertEqual(resolveRoundPhase(r, open), 'OPEN');
});

test('B2: ก่อน openDate 1 นาที → UPCOMING', () => {
  const open = bkk(2026, 11, 15, 9, 0);
  const r = round({ openDate: new Date(open), closeDate: new Date(bkk(2026, 11, 20)) });
  assertEqual(resolveRoundPhase(r, open - MINUTE), 'UPCOMING');
});

test('B3: ก่อน openDate 1 ms → UPCOMING', () => {
  const open = bkk(2026, 11, 15, 9, 0);
  const r = round({ openDate: new Date(open), closeDate: new Date(bkk(2026, 11, 20)) });
  assertEqual(resolveRoundPhase(r, open - 1), 'UPCOMING');
});

test('B4: now === closeDate พอดี → ยัง OPEN (สมัครได้จนถึงวินาทีปิด)', () => {
  const close = bkk(2026, 11, 15, 16, 30);
  const r = round({ openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(close) });
  assertEqual(resolveRoundPhase(r, close), 'OPEN');
});

test('B5: เกิน closeDate 1 ms → CLOSED', () => {
  const close = bkk(2026, 11, 15, 16, 30);
  const r = round({ openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(close) });
  assertEqual(resolveRoundPhase(r, close + 1), 'CLOSED');
});

test('B6: เกิน closeDate 1 นาที → CLOSED', () => {
  const close = bkk(2026, 11, 15, 16, 30);
  const r = round({ openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(close) });
  assertEqual(resolveRoundPhase(r, close + MINUTE), 'CLOSED');
});

test('B7: รอบวันเดียว (open === close) → OPEN เฉพาะวินาทีนั้น', () => {
  const t = bkk(2026, 11, 15, 9, 0);
  const r = round({ openDate: new Date(t), closeDate: new Date(t) });
  assertEqual(resolveRoundPhase(r, t), 'OPEN');
  assertEqual(resolveRoundPhase(r, t - 1), 'UPCOMING');
  assertEqual(resolveRoundPhase(r, t + 1), 'CLOSED');
});

test('B8: เที่ยงคืนกรุงเทพฯ (00:00) ไม่เพี้ยนเป็นวันก่อนหน้า', () => {
  // 1 พ.ย. 2026 00:00 กรุงเทพฯ = 31 ต.ค. 17:00 UTC
  const open = bkk(2026, 11, 1, 0, 0);
  const r = round({ openDate: new Date(open), closeDate: new Date(bkk(2026, 11, 30, 23, 59)) });
  assertEqual(resolveRoundPhase(r, open), 'OPEN');
  assertEqual(resolveRoundPhase(r, open - 1), 'UPCOMING');
});

// ========== 3. รูปแบบค่าที่รับได้ ==========

console.log('\n=== รับวันที่ได้หลายทรง (drizzle / JSON / unix) ===');

test('F1: Date object', () => {
  assertEqual(toEpochMs(new Date(1762000000000)), 1762000000000);
});

test('F2: unix seconds (number)', () => {
  assertEqual(toEpochMs(1762000000), 1762000000000);
});

test('F3: unix ms (number)', () => {
  assertEqual(toEpochMs(1762000000000), 1762000000000);
});

test('F4: ISO string', () => {
  assertEqual(toEpochMs('2026-11-01T02:00:00.000Z'), Date.UTC(2026, 10, 1, 2, 0));
});

test('F5: numeric string (unix seconds) — new Date() ตรง ๆ จะพัง', () => {
  assertEqual(toEpochMs('1762000000'), 1762000000000);
});

test('F6: ค่าที่อ่านไม่ได้ → null', () => {
  assertEqual(toEpochMs(null), null);
  assertEqual(toEpochMs(undefined), null);
  assertEqual(toEpochMs(''), null);
  assertEqual(toEpochMs('abc'), null);
  assertEqual(toEpochMs(NaN), null);
});

test('F7: รับ unix seconds ทั้งฝั่ง open/close → phase ถูก', () => {
  const r = round({
    openDate: Math.floor(bkk(2026, 11, 1) / 1000),
    closeDate: Math.floor(bkk(2026, 11, 30) / 1000),
  });
  assertEqual(resolveRoundPhase(r, bkk(2026, 11, 15)), 'OPEN');
});

// ========== 4. การจัดกลุ่ม + ลำดับ ==========

console.log('\n=== groupRounds: แบ่งกลุ่ม + เรียงลำดับ ===');

test('G1: แบ่ง 3 กลุ่มถูก และ DRAFT ไม่โผล่ที่ไหนเลย', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'open-a', openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(bkk(2026, 11, 20)) }),
    round({ id: 'closed-a', openDate: new Date(bkk(2026, 10, 1)), closeDate: new Date(bkk(2026, 10, 31)) }),
    round({ id: 'upcoming-a', openDate: new Date(bkk(2026, 12, 1)), closeDate: new Date(bkk(2026, 12, 31)) }),
    round({ id: 'draft-a', status: 'DRAFT' }),
  ];

  const g = groupRounds(rows, now);
  assertArrayEqual(g.open.map((r) => r.id), ['open-a'], 'open');
  assertArrayEqual(g.upcoming.map((r) => r.id), ['upcoming-a'], 'upcoming');
  assertArrayEqual(g.closed.map((r) => r.id), ['closed-a'], 'closed');

  const total = g.open.length + g.upcoming.length + g.closed.length;
  assertEqual(total, 3, 'DRAFT ต้องไม่ถูกนับ');
});

test('G2: OPEN เรียง closeDate ASC (ใกล้ปิดก่อน)', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'far', openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(bkk(2026, 11, 29)) }),
    round({ id: 'near', openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(bkk(2026, 11, 16)) }),
    round({ id: 'mid', openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(bkk(2026, 11, 20)) }),
  ];
  assertArrayEqual(groupRounds(rows, now).open.map((r) => r.id), ['near', 'mid', 'far']);
});

test('G3: UPCOMING เรียง openDate ASC (เปิดเร็วสุดก่อน)', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'dec', openDate: new Date(bkk(2026, 12, 1)), closeDate: new Date(bkk(2026, 12, 31)) }),
    round({ id: 'nov', openDate: new Date(bkk(2026, 11, 20)), closeDate: new Date(bkk(2026, 12, 10)) }),
    round({ id: 'jan', openDate: new Date(bkk(2027, 1, 5)), closeDate: new Date(bkk(2027, 1, 31)) }),
  ];
  assertArrayEqual(groupRounds(rows, now).upcoming.map((r) => r.id), ['nov', 'dec', 'jan']);
});

test('G4: CLOSED เรียง closeDate DESC (ปิดล่าสุดก่อน)', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'old', openDate: new Date(bkk(2026, 8, 1)), closeDate: new Date(bkk(2026, 8, 31)) }),
    round({ id: 'recent', openDate: new Date(bkk(2026, 10, 1)), closeDate: new Date(bkk(2026, 10, 31)) }),
    round({ id: 'mid', openDate: new Date(bkk(2026, 9, 1)), closeDate: new Date(bkk(2026, 9, 30)) }),
  ];
  assertArrayEqual(groupRounds(rows, now).closed.map((r) => r.id), ['recent', 'mid', 'old']);
});

test('G5: แถวที่ไม่มีวันที่ถูกจัดไว้ท้ายกลุ่ม ไม่ทำให้ sort พัง', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'broken', openDate: null, closeDate: null }),
    round({ id: 'ok', openDate: new Date(bkk(2026, 10, 1)), closeDate: new Date(bkk(2026, 10, 31)) }),
  ];
  // broken → CLOSED (fail-closed) และอยู่ท้ายเพราะไม่มี closeDate
  assertArrayEqual(groupRounds(rows, now).closed.map((r) => r.id), ['ok', 'broken']);
});

test('G6: ไม่มีรอบเลย → 3 กลุ่มว่าง ไม่ throw', () => {
  const g = groupRounds([], bkk(2026, 11, 15));
  assertArrayEqual(g.open, []);
  assertArrayEqual(g.upcoming, []);
  assertArrayEqual(g.closed, []);
});

test('G7: รอบที่ปิดแล้วต้องไม่อยู่ใน open (เคสหลักของ bug)', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const rows = [
    round({ id: 'expired', openDate: new Date(bkk(2026, 10, 1)), closeDate: new Date(bkk(2026, 10, 31)) }),
    round({ id: 'live', openDate: new Date(bkk(2026, 11, 1)), closeDate: new Date(bkk(2026, 11, 30)) }),
  ];
  const g = groupRounds(rows, now);
  assertEqual(g.open.some((r) => r.id === 'expired'), false, 'expired ต้องไม่อยู่ใน open');
  assertEqual(g.closed.some((r) => r.id === 'expired'), true, 'expired ต้องอยู่ closed');
  assertArrayEqual(g.open.map((r) => r.id), ['live']);
});

// ========== 5. ป้าย ==========

test('L1: ป้ายภาษาไทยครบ 4 phase', () => {
  assertEqual(ROUND_PHASE_LABEL.OPEN, 'กำลังเปิดรับสมัคร');
  assertEqual(ROUND_PHASE_LABEL.UPCOMING, 'กำหนดเปิดรับสมัคร');
  assertEqual(ROUND_PHASE_LABEL.CLOSED, 'ปิดรับสมัครแล้ว');
  assertEqual(ROUND_PHASE_LABEL.DRAFT, 'ร่าง');
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
