/**
 * Public Rounds — unit tests (frontend contract)
 * ===============================================
 * ตรวจสัญญาข้อมูลที่หน้าแรกใช้:
 *   - parseRoundsResponse: อ่าน shape ใหม่ (groups) และ shape เดิม (data array)
 *   - computeCountdown: badge กับ countdown ต้องมาจาก phase เดียวกัน
 *     → ไม่มีกรณี "เปิดรับสมัคร" แต่ countdown หาย
 *   - formatCountdown: ไม่คืน null/ว่างเมื่อเวลายังเหลือ
 *   - formatThaiDateTime: เวลาไทย ไม่ขึ้นกับ timezone เครื่อง
 *
 * Run: node --import tsx src/lib/__tests__/public-rounds.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  parseRoundsResponse,
  computeCountdown,
  formatCountdown,
  formatThaiDateTime,
  toEpochMs,
  PHASE_STYLE,
} from '../public-rounds';

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

function assertTrue(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'expected true');
}

// ========== FIXTURES ==========

const BKK = 7 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function bkk(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min) - BKK;
}

function round(id: string, over: Record<string, any> = {}) {
  return {
    id,
    title: `รอบ ${id}`,
    positionLevel: 'ทั่วไป',
    status: 'ACTIVE',
    openDate: new Date(bkk(2026, 11, 1, 9, 0)).toISOString(),
    closeDate: new Date(bkk(2026, 11, 30, 16, 30)).toISOString(),
    ...over,
  };
}

// ========== 1. parseRoundsResponse — shape ใหม่ ==========

console.log('=== parseRoundsResponse: shape ใหม่ (groups) ===');

test('P1: อ่าน groups ตรง ๆ ไม่ต้องจัดกลุ่มซ้ำ', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const payload = parseRoundsResponse(
    {
      data: [round('legacy')],
      groups: {
        open: [round('o1')],
        upcoming: [round('u1')],
        closed: [round('c1')],
      },
      serverTime: now,
    },
    now,
  );
  assertEqual(payload.open.length, 1);
  assertEqual(payload.open[0].id, 'o1');
  assertEqual(payload.upcoming[0].id, 'u1');
  assertEqual(payload.closed[0].id, 'c1');
});

test('P2: serverOffsetMs = serverTime - now', () => {
  const now = 1_000_000;
  const payload = parseRoundsResponse(
    { groups: { open: [], upcoming: [], closed: [] }, serverTime: 1_000_500 },
    now,
  );
  assertEqual(payload.serverOffsetMs, 500);
});

test('P3: ไม่มี serverTime → offset 0 (ไม่ทำให้ countdown เพี้ยน)', () => {
  const now = 1_000_000;
  const payload = parseRoundsResponse({ groups: { open: [], upcoming: [], closed: [] } }, now);
  assertEqual(payload.serverOffsetMs, 0);
});

// ========== 2. parseRoundsResponse — fallback shape เดิม ==========

console.log('\n=== parseRoundsResponse: fallback shape เดิม (data = array) ===');

test('P4: จัดกลุ่มเองได้ถูกเมื่อ backend ยังเป็นเวอร์ชันเก่า', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const payload = parseRoundsResponse(
    {
      data: [
        round('live', {
          openDate: new Date(bkk(2026, 11, 1)).toISOString(),
          closeDate: new Date(bkk(2026, 11, 30)).toISOString(),
        }),
        round('expired', {
          openDate: new Date(bkk(2026, 10, 1)).toISOString(),
          closeDate: new Date(bkk(2026, 10, 31)).toISOString(),
        }),
        round('future', {
          openDate: new Date(bkk(2026, 12, 1)).toISOString(),
          closeDate: new Date(bkk(2026, 12, 31)).toISOString(),
        }),
      ],
    },
    now,
  );
  assertEqual(payload.open.length, 1);
  assertEqual(payload.open[0].id, 'live');
  assertEqual(payload.closed[0].id, 'expired');
  assertEqual(payload.upcoming[0].id, 'future');
});

test('P5: fallback ตัด DRAFT ออก', () => {
  const now = bkk(2026, 11, 15);
  const payload = parseRoundsResponse({ data: [round('d', { status: 'DRAFT' })] }, now);
  assertEqual(payload.open.length + payload.upcoming.length + payload.closed.length, 0);
});

test('P6: fallback เรียง OPEN ด้วย closeDate ASC', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const payload = parseRoundsResponse(
    {
      data: [
        round('far', { openDate: new Date(bkk(2026, 11, 1)).toISOString(), closeDate: new Date(bkk(2026, 11, 29)).toISOString() }),
        round('near', { openDate: new Date(bkk(2026, 11, 1)).toISOString(), closeDate: new Date(bkk(2026, 11, 16)).toISOString() }),
      ],
    },
    now,
  );
  assertEqual(payload.open[0].id, 'near');
  assertEqual(payload.open[1].id, 'far');
});

test('P7: fallback เรียง CLOSED ด้วย closeDate DESC', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const payload = parseRoundsResponse(
    {
      data: [
        round('old', { openDate: new Date(bkk(2026, 8, 1)).toISOString(), closeDate: new Date(bkk(2026, 8, 31)).toISOString() }),
        round('recent', { openDate: new Date(bkk(2026, 10, 1)).toISOString(), closeDate: new Date(bkk(2026, 10, 31)).toISOString() }),
      ],
    },
    now,
  );
  assertEqual(payload.closed[0].id, 'recent');
  assertEqual(payload.closed[1].id, 'old');
});

test('P8: response เพี้ยน (null / ไม่มี data) → 3 กลุ่มว่าง ไม่ throw', () => {
  const p1 = parseRoundsResponse(null, 0);
  assertEqual(p1.open.length, 0);
  const p2 = parseRoundsResponse({}, 0);
  assertEqual(p2.closed.length, 0);
});

// ========== 3. computeCountdown — หัวใจของ PHASE 2 ==========

console.log('\n=== computeCountdown: badge กับ countdown ต้องไม่ขัดกัน ===');

test('C1: OPEN → นับถึง closeDate ด้วย label "เหลือเวลาสมัครอีก"', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const r = round('r', {
    openDate: new Date(bkk(2026, 11, 1)).toISOString(),
    closeDate: new Date(bkk(2026, 11, 18, 12, 0)).toISOString(),
  });
  const cd = computeCountdown('OPEN', r, now);
  assertTrue(cd !== null, 'OPEN ต้องมี countdown เสมอ');
  assertEqual(cd.label, 'เหลือเวลาสมัครอีก');
  assertEqual(cd.text, '3 วัน 0 ชั่วโมง');
});

test('C2: UPCOMING → นับถึง openDate ด้วย label "เปิดรับสมัครในอีก"', () => {
  const now = bkk(2026, 11, 15, 12, 0);
  const r = round('r', {
    openDate: new Date(bkk(2026, 11, 17, 12, 0)).toISOString(),
    closeDate: new Date(bkk(2026, 11, 30)).toISOString(),
  });
  const cd = computeCountdown('UPCOMING', r, now);
  assertTrue(cd !== null);
  assertEqual(cd.label, 'เปิดรับสมัครในอีก');
  assertEqual(cd.text, '2 วัน 0 ชั่วโมง');
});

test('C3: CLOSED → ไม่มี countdown', () => {
  const now = bkk(2026, 12, 15);
  const cd = computeCountdown('CLOSED', round('r'), now);
  assertEqual(cd, null);
});

test('C4: OPEN + now === closeDate พอดี → ยังมี countdown (ไม่หาย)', () => {
  // นี่คือเคสที่ทำให้ badge บอก "เปิดรับสมัคร" แต่ countdown หายในโค้ดเดิม
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', {
    openDate: new Date(bkk(2026, 11, 1)).toISOString(),
    closeDate: new Date(close).toISOString(),
  });
  const cd = computeCountdown('OPEN', r, close);
  assertTrue(cd !== null, 'ต้องไม่คืน null');
  assertEqual(cd.text, 'น้อยกว่า 1 นาที');
});

test('C5: OPEN + เหลือ 30 วินาที → "น้อยกว่า 1 นาที" ไม่ใช่ null', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close - 30_000);
  assertTrue(cd !== null);
  assertEqual(cd.text, 'น้อยกว่า 1 นาที');
});

test('C6: OPEN + เหลือ < 24 ชม. → urgent = true', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close - 5 * HOUR);
  assertEqual(cd.urgent, true);
});

test('C7: OPEN + เหลือ > 24 ชม. → urgent = false', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close - 3 * DAY);
  assertEqual(cd.urgent, false);
});

test('C8: OPEN แต่ closeDate อ่านไม่ได้ → ยังคืน label (ไม่ปล่อยให้เงียบ)', () => {
  const r = round('r', { closeDate: null });
  const cd = computeCountdown('OPEN', r, bkk(2026, 11, 15));
  assertTrue(cd !== null, 'ต้องไม่คืน null');
  assertEqual(cd.label, 'เหลือเวลาสมัครอีก');
  assertEqual(cd.text, '');
});

test('C9: INVARIANT — phase ที่ไม่ใช่ CLOSED ต้องมี countdown เสมอ (ทุกช่วงเวลา)', () => {
  const open = bkk(2026, 11, 1, 9, 0);
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', {
    openDate: new Date(open).toISOString(),
    closeDate: new Date(close).toISOString(),
  });

  // ไล่ทุกช่วง: ก่อนเปิด / เปิดวันแรก / กลางรอบ / วันปิด / วินาทีปิด
  const probes: Array<[string, number]> = [
    ['ก่อนเปิด 1 วัน', open - DAY],
    ['ก่อนเปิด 1 นาที', open - MINUTE],
    ['openDate พอดี', open],
    ['กลางรอบ', bkk(2026, 11, 15)],
    ['closeDate -1 นาที', close - MINUTE],
    ['closeDate พอดี', close],
  ];

  for (const [name, now] of probes) {
    const phase = now < open ? 'UPCOMING' : 'OPEN';
    const cd = computeCountdown(phase, r, now);
    assertTrue(cd !== null, `${name}: countdown ต้องไม่หาย`);
    assertTrue(cd.text !== '' || phase === 'OPEN', `${name}: ต้องมีข้อความ`);
  }
});

// ========== 4. formatCountdown ==========

console.log('\n=== formatCountdown ===');

test('F1: 2 วัน 13 ชม. 45 นาที → เอา 2 หน่วยใหญ่', () => {
  assertEqual(formatCountdown(2 * DAY + 13 * HOUR + 45 * MINUTE), '2 วัน 13 ชั่วโมง');
});

test('F2: 5 ชม. 20 นาที', () => {
  assertEqual(formatCountdown(5 * HOUR + 20 * MINUTE), '5 ชั่วโมง 20 นาที');
});

test('F3: 45 นาที', () => {
  assertEqual(formatCountdown(45 * MINUTE), '45 นาที');
});

test('F4: 0 / ค่าลบ / NaN → "น้อยกว่า 1 นาที" (ไม่คืน null)', () => {
  assertEqual(formatCountdown(0), 'น้อยกว่า 1 นาที');
  assertEqual(formatCountdown(-1000), 'น้อยกว่า 1 นาที');
  assertEqual(formatCountdown(NaN), 'น้อยกว่า 1 นาที');
});

// ========== 5. วันที่ไทย ==========

console.log('\n=== formatThaiDateTime ===');

test('D1: แสดงเวลาไทยตามที่แอดมินกรอก (09:00 ไม่ใช่ 02:00)', () => {
  const ms = bkk(2026, 11, 1, 9, 0);
  assertEqual(formatThaiDateTime(new Date(ms).toISOString()), '1 พ.ย. 2569 เวลา 09:00 น.');
});

test('D2: รับ unix seconds ได้', () => {
  const ms = bkk(2026, 11, 1, 9, 0);
  assertEqual(formatThaiDateTime(Math.floor(ms / 1000)), '1 พ.ย. 2569 เวลา 09:00 น.');
});

test('D3: ค่าเพี้ยน → "ไม่กำหนด"', () => {
  assertEqual(formatThaiDateTime(null), 'ไม่กำหนด');
  assertEqual(formatThaiDateTime('abc'), 'ไม่กำหนด');
});

test('D4: เที่ยงคืนไทย = 00:00 ไม่ใช่ 17:00 ของวันก่อน', () => {
  const ms = bkk(2026, 11, 1, 0, 0);
  assertEqual(formatThaiDateTime(new Date(ms).toISOString()), '1 พ.ย. 2569 เวลา 00:00 น.');
});

// ========== 6. toEpochMs ==========

test('E1: รับได้ทุกทรง', () => {
  assertEqual(toEpochMs(1762000000), 1762000000000);
  assertEqual(toEpochMs(1762000000000), 1762000000000);
  assertEqual(toEpochMs('1762000000'), 1762000000000);
  assertEqual(toEpochMs('2026-11-01T02:00:00.000Z'), Date.UTC(2026, 10, 1, 2, 0));
  assertEqual(toEpochMs(null), null);
  assertEqual(toEpochMs(''), null);
});

// ========== 7. ป้าย ==========

test('S1: ป้าย 3 phase ที่หน้าแรกใช้', () => {
  assertEqual(PHASE_STYLE.OPEN.label, 'เปิดรับสมัคร');
  assertEqual(PHASE_STYLE.UPCOMING.label, 'ยังไม่เปิดรับสมัคร');
  assertEqual(PHASE_STYLE.CLOSED.label, 'ปิดรับสมัครแล้ว');
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
