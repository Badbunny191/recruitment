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
  planRefresh,
  planDeadlineTimer,
  shouldRefetchOnEvent,
  deadlinesToMarkHandled,
  collectDeadlines,
  effectivePhase,
  CLOSED_COUNTDOWN_TEXT,
  MIN_REFETCH_INTERVAL_MS,
  MAX_REFRESH_DELAY_MS,
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

test('C4: OPEN + now === closeDate พอดี → ยังนับอยู่ (ขอบเขต inclusive เท่า backend)', () => {
  // นี่คือเคสที่ทำให้ badge บอก "เปิดรับสมัคร" แต่ countdown หายในโค้ดเดิม
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', {
    openDate: new Date(bkk(2026, 11, 1)).toISOString(),
    closeDate: new Date(close).toISOString(),
  });
  const cd = computeCountdown('OPEN', r, close);
  assertTrue(cd !== null, 'ต้องไม่คืน null');
  assertEqual(cd.text, 'ปิดรับสมัครแล้ว');
  assertEqual(cd.closed, true, 'ต้องบอกว่าปิดแล้ว ไม่ใช่ค้างที่ "น้อยกว่า 1 นาที"');
});

test('C5: OPEN + เหลือ 30 วินาที → "30 วินาที" (เห็นวินาทีจริง)', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close - 30_000);
  assertTrue(cd !== null);
  assertEqual(cd.text, '30 วินาที');
  assertEqual(cd.closed, false);
});

test('C5b: OPEN + เหลือ 4 นาที 52 วินาที → แสดงวินาที', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close - (4 * MINUTE + 52_000));
  assertEqual(cd.text, '4 นาที 52 วินาที');
});

test('C5c: OPEN + เลย closeDate ไปแล้ว (snapshot ยังเก่า) → closed = true', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  const cd = computeCountdown('OPEN', r, close + 60_000);
  assertTrue(cd !== null, 'ยังคืน object เพื่อให้การ์ดบอกว่าปิดแล้ว');
  assertEqual(cd.text, 'ปิดรับสมัครแล้ว');
  assertEqual(cd.closed, true);
  assertEqual(cd.urgent, false, 'ปิดแล้วต้องไม่ถูกจัดเป็น urgent');
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

test('F4: 0 / ค่าลบ → "ปิดรับสมัครแล้ว" (ไม่ใช่ "น้อยกว่า 1 นาที" ที่ค้างอยู่)', () => {
  assertEqual(formatCountdown(0), 'ปิดรับสมัครแล้ว');
  assertEqual(formatCountdown(-1000), 'ปิดรับสมัครแล้ว');
});

test('F5: NaN / Infinity → "" (ไม่รู้เวลา ห้ามเดาว่าเปิดหรือปิด)', () => {
  assertEqual(formatCountdown(NaN), '');
  assertEqual(formatCountdown(Infinity), '');
});

test('F6: 5 นาทีสุดท้าย → แสดงวินาทีจริง (4:52)', () => {
  assertEqual(formatCountdown(4 * MINUTE + 52_000), '4 นาที 52 วินาที');
});

test('F7: 1 นาที 15 วินาที', () => {
  assertEqual(formatCountdown(1 * MINUTE + 15_000), '1 นาที 15 วินาที');
});

test('F8: 23 วินาที (ไม่มีนาที)', () => {
  assertEqual(formatCountdown(23_000), '23 วินาที');
});

test('F9: 1 วินาทีสุดท้าย', () => {
  assertEqual(formatCountdown(1_000), '1 วินาที');
});

test('F10: เหลือ < 1 วินาที (แต่ยังไม่ปิด) → "1 วินาที" ไม่ใช่ "ปิดรับสมัครแล้ว"', () => {
  assertEqual(formatCountdown(400), '1 วินาที');
});

test('F11: ขอบ 5 นาที → ยังเป็นรูปแบบนาที (45 นาที / 5 นาที)', () => {
  assertEqual(formatCountdown(5 * MINUTE), '5 นาที');
  assertEqual(formatCountdown(5 * MINUTE - 1000), '4 นาที 59 วินาที');
});

test('F12: 59 วินาที → "59 วินาที" (เดิมคือ "น้อยกว่า 1 นาที")', () => {
  assertEqual(formatCountdown(59_000), '59 วินาที');
});

test('F13: 1 ชั่วโมงขึ้นไปยังเป็นรูปแบบเดิม (ไม่ regress)', () => {
  assertEqual(formatCountdown(HOUR), '1 ชั่วโมง 0 นาที');
  assertEqual(formatCountdown(DAY), '1 วัน 0 ชั่วโมง');
});

// ========== 5. วันที่ไทย ==========

console.log('\n=== formatThaiDateTime ===');

test('D1: แสดงเวลาไทยตามที่แอดมินกรอก (09:00 ไม่ใช่ 02:00)', () => {
  const ms = bkk(2026, 11, 1, 9, 0);
  assertEqual(formatThaiDateTime(new Date(ms).toISOString()), '1 พ.ย. 2569 เวลา\u00A009:00\u00A0น.');
});

test('D2: รับ unix seconds ได้', () => {
  const ms = bkk(2026, 11, 1, 9, 0);
  assertEqual(formatThaiDateTime(Math.floor(ms / 1000)), '1 พ.ย. 2569 เวลา\u00A009:00\u00A0น.');
});

test('D3: ค่าเพี้ยน → "ไม่กำหนด"', () => {
  assertEqual(formatThaiDateTime(null), 'ไม่กำหนด');
  assertEqual(formatThaiDateTime('abc'), 'ไม่กำหนด');
});

test('D4: เที่ยงคืนไทย = 00:00 ไม่ใช่ 17:00 ของวันก่อน', () => {
  const ms = bkk(2026, 11, 1, 0, 0);
  assertEqual(formatThaiDateTime(new Date(ms).toISOString()), '1 พ.ย. 2569 เวลา\u00A000:00\u00A0น.');
});

test('D5: REGRESSION — "น." ต้องไม่ตกบรรทัดใหม่ (ใช้ NBSP ผูกเวลาไว้)', () => {
  const ms = bkk(2026, 11, 6, 16, 30);
  const out = formatThaiDateTime(new Date(ms).toISOString());

  // ต้องมี NBSP คั่นระหว่าง "เวลา" กับตัวเลข และระหว่างตัวเลขกับ "น."
  assertTrue(out.includes('\u00A016:30'), 'ต้องมี NBSP ก่อนเวลา');
  assertTrue(out.includes('16:30\u00A0น.'), 'ต้องมี NBSP ระหว่างเวลาและ น.');

  // ต้องไม่มี space ปกติในส่วน "เวลา HH:MM น." เลย (นั่นคือจุดที่ทำให้ตัดบรรทัด)
  const timePart = out.slice(out.indexOf('เวลา'));
  assertTrue(!timePart.includes(' '), `ส่วนเวลาต้องไม่มี space ปกติ: ${JSON.stringify(timePart)}`);

  // หน้าตาที่ผู้ใช้อ่านยังเหมือนเดิม
  assertEqual(out.replace(/\u00A0/g, ' '), '6 พ.ย. 2569 เวลา 16:30 น.');
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

// ========== 8. planRefresh (ความสดของข้อมูล) ==========

test('R1: ยังไม่เคยโหลด → refetch ทันที', () => {
  const plan = planRefresh(1000, null, []);
  assertEqual(plan.refetch, true);
  assertEqual(plan.reason, 'first-load');
});

test('R2: เพิ่งโหลดไป (< 15 วิ) → ไม่ refetch แม้มี event (throttle)', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 5_000, []);
  assertEqual(plan.refetch, false);
  assertEqual(plan.reason, 'throttled');
  assertEqual(plan.delayMs, MIN_REFETCH_INTERVAL_MS - 5_000);
});

test('R3: ผ่าน 15 วิไปแล้ว ไม่มี deadline → ไม่ refetch และไม่ตั้ง timer (ไม่มี polling)', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 60_000, []);
  assertEqual(plan.refetch, false);
  assertEqual(plan.delayMs, null);
  assertEqual(plan.reason, 'idle');
});

test('R4 (fail-when-no-fix): deadline เลยไปแล้วแต่ snapshot ยังมี → refetch ทันที', () => {
  // หัวใจของ bug: รอบปิดไปแล้ว 5 นาที แต่ payload ยังบอกว่าเปิด
  const now = 1_000_000;
  const plan = planRefresh(now, now - 60_000, [now - 5 * 60_000]);
  assertEqual(plan.refetch, true);
  assertEqual(plan.reason, 'deadline-passed');
});

test('R5: deadline เลยไปแล้วแต่ยัง throttle → เลื่อนออกไป ไม่ยิงรัว', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 3_000, [now - 1_000]);
  assertEqual(plan.refetch, false);
  assertEqual(plan.reason, 'throttled');
  assertTrue(plan.delayMs !== null && plan.delayMs > 0, 'ต้องตั้ง timer ไปยิงหลังพ้น throttle');
});

test('R6: deadline ในอนาคตไกล → ตั้ง timer ไว้ที่ deadline (ไม่เกินเพดาน)', () => {
  const now = 1_000_000;
  const deadline = now + 2 * 60 * 60_000; // อีก 2 ชั่วโมง
  const plan = planRefresh(now, now - 60_000, [deadline]);
  assertEqual(plan.refetch, false);
  assertEqual(plan.reason, 'next-deadline');
  assertTrue(plan.delayMs !== null, 'ต้องมี timer');
  assertTrue(plan.delayMs <= MAX_REFRESH_DELAY_MS, `ต้องไม่เกินเพดาน (ได้ ${plan.delayMs})`);
});

test('R7: deadline อีก 30 วิ → timer ตื่นที่ deadline ไม่ใช่ 30 วิ + เพดาน', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 60_000, [now + 30_000]);
  assertTrue(plan.delayMs !== null);
  assertTrue(plan.delayMs <= 31_000, `ต้องตื่นใกล้ deadline (ได้ ${plan.delayMs}ms)`);
});

test('R8: deadline หลายตัว → เลือกตัวที่ใกล้ที่สุด', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 60_000, [now + 3 * 60 * 60_000, now + 60_000, now + 10 * 60_000]);
  assertTrue(plan.delayMs !== null);
  assertTrue(plan.delayMs <= 61_000, `ต้องอิง deadline ที่ใกล้ที่สุด (ได้ ${plan.delayMs}ms)`);
});

test('R9: deadline เพี้ยน (NaN) ถูกตัดทิ้ง ไม่ทำให้ timer พัง', () => {
  const now = 1_000_000;
  const plan = planRefresh(now, now - 60_000, [NaN, Infinity]);
  assertEqual(plan.refetch, false);
  assertEqual(plan.delayMs, null);
  assertEqual(plan.reason, 'idle');
});

test('R10 (anti-loop): deadline ที่จัดการแล้ว → ไม่ตั้ง timer ซ้ำไม่รู้จบ', () => {
  const now = 1_000_000;
  const passed = now - 60_000;
  // ยังไม่จัดการ → ต้องยิงเดี๋ยวนี้
  assertEqual(planDeadlineTimer(now, [passed]).delayMs, 0);
  // จัดการแล้ว → ต้องไม่ตั้ง timer อีก (เดิมจะยิง 0ms ไม่มีที่สิ้นสุด)
  const after = planDeadlineTimer(now, [passed], [passed]);
  assertEqual(after.delayMs, null);
  assertEqual(after.reason, 'idle');
});

test('R11 (anti-loop): ยังมี deadline ในอนาคตอีกตัว → ยังตั้ง timer ต่อ', () => {
  const now = 1_000_000;
  const passed = now - 60_000;
  const future = now + 60_000;
  const plan = planDeadlineTimer(now, [passed, future], [passed]);
  assertTrue(plan.delayMs !== null, 'ต้องยังตั้ง timer สำหรับ deadline ที่ยังไม่ถึง');
  assertTrue(plan.delayMs <= 61_000, `ต้องอิง deadline ในอนาคต (ได้ ${plan.delayMs})`);
});

test('R12: deadlinesToMarkHandled เลือกเฉพาะที่เลยเวลาแล้ว', () => {
  const now = 1_000_000;
  const passed = now - 1_000;
  const future = now + 1_000;
  const handled = deadlinesToMarkHandled(now, [passed, future]);
  assertEqual(handled.length, 1);
  assertEqual(handled[0], passed);
});

test('R13: shouldRefetchOnEvent ไม่ผูกกับ deadline (กดกลับแท็บต้องได้ดึงใหม่)', () => {
  const now = 1_000_000;
  assertEqual(shouldRefetchOnEvent(now, null), true, 'ยังไม่เคยโหลด');
  assertEqual(shouldRefetchOnEvent(now, now - 1_000), false, 'ติด throttle');
  assertEqual(shouldRefetchOnEvent(now, now - 20_000), true, 'พ้น throttle');
});

// ========== 9. collectDeadlines ==========

test('D1: เก็บ closeDate ของ OPEN + openDate ของ UPCOMING (ไม่เก็บ CLOSED)', () => {
  const openClose = bkk(2026, 11, 30, 16, 30);
  const upOpen = bkk(2026, 12, 15, 9, 0);
  const payload = {
    open: [round('o1', { closeDate: new Date(openClose).toISOString() })],
    upcoming: [round('u1', { openDate: new Date(upOpen).toISOString() })],
    closed: [round('c1', { closeDate: new Date(bkk(2026, 10, 1)).toISOString() })],
    serverOffsetMs: 0,
  };
  const ds = collectDeadlines(payload);
  assertEqual(ds.length, 2);
  assertTrue(ds.includes(openClose), 'ต้องมี closeDate ของรอบที่เปิด');
  assertTrue(ds.includes(upOpen), 'ต้องมี openDate ของรอบที่จะเปิด');
});

test('D2: วันที่อ่านไม่ได้ → ข้าม ไม่ throw', () => {
  const payload = {
    open: [round('o1', { closeDate: null })],
    upcoming: [],
    closed: [],
    serverOffsetMs: 0,
  };
  assertEqual(collectDeadlines(payload).length, 0);
});

// ========== 10. effectivePhase (กันการ์ดขัดกันเอง) ==========

test('P1 (fail-when-no-fix): OPEN + เลย closeDate → CLOSED (badge ต้องไม่บอกว่าเปิด)', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  assertEqual(effectivePhase('OPEN', r, close + 1), 'CLOSED');
});

test('P2: OPEN + now === closeDate → ยัง OPEN (inclusive เท่า backend)', () => {
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  assertEqual(effectivePhase('OPEN', r, close), 'OPEN');
});

test('P3: UPCOMING + ถึง openDate แล้ว → OPEN', () => {
  const open = bkk(2026, 12, 15, 9, 0);
  const r = round('r', { openDate: new Date(open).toISOString() });
  assertEqual(effectivePhase('UPCOMING', r, open), 'OPEN');
});

test('P4: UPCOMING + ยังไม่ถึง openDate → UPCOMING', () => {
  const open = bkk(2026, 12, 15, 9, 0);
  const r = round('r', { openDate: new Date(open).toISOString() });
  assertEqual(effectivePhase('UPCOMING', r, open - 1000), 'UPCOMING');
});

test('P5: CLOSED จาก backend → ห้ามอัปเกรดกลับเป็น OPEN แม้เวลาดูเหมือนยังไม่ปิด', () => {
  // backend ตัดสินแล้ว (เช่น status = CLOSED ด้วยมือ) — ต้องเชื่อ backend
  const close = bkk(2026, 11, 30, 16, 30);
  const r = round('r', { closeDate: new Date(close).toISOString() });
  assertEqual(effectivePhase('CLOSED', r, close - 60_000), 'CLOSED');
});

test('P6: วันที่อ่านไม่ได้ → คง phase เดิม (ไม่เดา)', () => {
  const r = round('r', { openDate: null, closeDate: null });
  assertEqual(effectivePhase('OPEN', r, 1_000_000), 'OPEN');
  assertEqual(effectivePhase('UPCOMING', r, 1_000_000), 'UPCOMING');
});

test('P7: ข้อความปิดรับสมัครใช้ค่าคงที่เดียวกันทั้งระบบ', () => {
  assertEqual(CLOSED_COUNTDOWN_TEXT, 'ปิดรับสมัครแล้ว');
  assertEqual(formatCountdown(0), CLOSED_COUNTDOWN_TEXT);
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
