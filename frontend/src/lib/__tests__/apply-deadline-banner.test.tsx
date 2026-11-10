// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * ApplyDeadlineBanner + DeadlineServerTimeEvidence (component-level)
 * ===================================================================
 * Banner บนหน้าฟอร์มสมัครแสดงเฉพาะเมื่อเหลือ <= 1 ชม. และ error state
 * แสดงหลักฐานเวลาเมื่อถูกปฏิเสธเพราะปิดรับสมัคร — ทดสอบ markup จริง:
 *
 *   B1. info (48 นาที)     → ข้อความ + เวลาปิด + โทนสงบ (amber, role=status)
 *   B2. warning (14 นาที)  → ข้อความเร่ง + "ก่อนเวลา" + role=alert
 *   B3. final (4:52)       → countdown วินาที + "เวลาระบบ" ระดับวินาที
 *   B4. closed             → "ปิดรับสมัครแล้ว" และห้ามมีนาฬิกา
 *   B5. hidden             → null (ไม่ render อะไรเลย)
 *   E1. evidence ครบ       → กำหนดปิด + เวลาของระบบขณะได้รับคำขอ + นโยบาย
 *   E2. evidence ไม่มี serverTime → ซ่อนบรรทัดนาฬิกา แต่ยังมีกำหนดปิด+นโยบาย
 *
 * Run: node --import tsx src/lib/__tests__/apply-deadline-banner.test.tsx
 */

// @ts-nocheck
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApplyDeadlineBanner } from '../../components/ApplyDeadlineBanner';
import { DeadlineServerTimeEvidence } from '../../components/DeadlineServerTimeEvidence';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void) {
  try {
    await fn();
    passed++;
    console.log(`ok ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
  }
}

function assert(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'expected true');
}

function assertFalse(cond: any, msg = '') {
  if (cond) throw new Error(msg || 'expected false');
}

function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ========== FIXTURES ==========

const BKK = 7 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// ปิด 16:30 น. (เวลาไทย) วันที่ 10 พ.ย. 2026
const CLOSE_1630 = Date.UTC(2026, 10, 10, 9, 30); // 16:30 ICT = 09:30 UTC
// เวลา server ณ render — 15:42:07 น.
const NOW_1542 = Date.UTC(2026, 10, 10, 8, 42, 7); // 15:42:07 ICT = 08:42:07 UTC

// =============================================================================

void (async () => {

await test('B1: info (48 นาที) — ข้อความสงบ + เวลาปิด + ไม่มีนาฬิกาวินาที', () => {
  const html = markup(
    React.createElement(ApplyDeadlineBanner, {
      state: 'info',
      remainingMs: 48 * MINUTE,
      closeMs: CLOSE_1630,
      nowMs: NOW_1542,
    }),
  );
  assert(html.includes('เหลือเวลารับสมัครอีก 48 นาที'), `missing countdown: ${html}`);
  assert(html.includes('ระบบจะปิดรับสมัครอัตโนมัติ'), 'missing auto-close line');
  assert(html.includes('16:30\u00A0น.'), 'missing close time');
  assert(html.includes('ตามเวลาระบบ'), 'missing "ตามเวลาระบบ"');
  assert(html.includes('amber-50'), 'info tone must be calm amber');
  assert(html.includes('role="status"'), 'info is not an alert');
  assertFalse(/เวลาระบบ \d/.test(html), 'info state must NOT show live clock');
});

await test('B2: warning (14 นาที) — เร่งเตือน + "ก่อนเวลา" + role=alert', () => {
  const html = markup(
    React.createElement(ApplyDeadlineBanner, {
      state: 'warning',
      remainingMs: 14 * MINUTE,
      closeMs: CLOSE_1630,
      nowMs: NOW_1542,
    }),
  );
  assert(html.includes('เหลือเวลารับสมัครอีก 14 นาที'), `missing countdown: ${html}`);
  assert(html.includes('กรุณาตรวจสอบข้อมูลและส่งใบสมัคร'), 'missing action line');
  assert(html.includes('ก่อนเวลา 16:30\u00A0น.'), 'missing "ก่อนเวลา" + close time');
  assert(html.includes('orange-50'), 'warning tone must be orange');
  assert(html.includes('role="alert"'), 'warning must be an alert');
  assertFalse(/เวลาระบบ \d/.test(html), 'warning state must NOT show live clock');
});

await test('B3: final (4 นาที 52 วินาที) — countdown วินาที + เวลาระบบวินาที', () => {
  const html = markup(
    React.createElement(ApplyDeadlineBanner, {
      state: 'final',
      remainingMs: 4 * MINUTE + 52 * 1000,
      closeMs: CLOSE_1630,
      nowMs: NOW_1542,
    }),
  );
  assert(html.includes('เหลือเวลารับสมัครอีก'), 'missing label');
  assert(html.includes('4 นาที 52 วินาที'), `missing seconds countdown: ${html}`);
  assert(html.includes('เวลาระบบ 15:42:07\u00A0น.'), 'missing system clock with seconds');
});

await test('B4: closed — "ปิดรับสมัครแล้ว" และห้ามมีนาฬิกา/ตัวเลข countdown', () => {
  const html = markup(
    React.createElement(ApplyDeadlineBanner, {
      state: 'closed',
      remainingMs: -1000,
      closeMs: CLOSE_1630,
      nowMs: NOW_1542,
    }),
  );
  assert(html.includes('ปิดรับสมัครแล้ว'), `missing closed text: ${html}`);
  assertFalse(/เวลาระบบ \d/.test(html), 'closed must NOT show clock');
  assertFalse(/\d+ วินาที/.test(html), 'closed must NOT show countdown');
});

await test('B5: hidden — ไม่ render อะไรเลย', () => {
  const html = markup(
    React.createElement(ApplyDeadlineBanner, {
      state: 'hidden',
      remainingMs: 5 * 60 * MINUTE,
      closeMs: CLOSE_1630,
      nowMs: NOW_1542,
    }),
  );
  assertEqual(html, '', 'hidden must render nothing');
});

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

await test('E1: evidence ครบ — กำหนดปิด + เวลาของระบบขณะได้รับคำขอ + นโยบาย', () => {
  const html = markup(
    React.createElement(DeadlineServerTimeEvidence, {
      closeValue: CLOSE_1630,
      requestServerTime: NOW_1542 + 35 * 1000, // คำขอถึง server 16:30:42
    }),
  );
  assert(html.includes('กำหนดปิดรับสมัคร'), `missing close label: ${html}`);
  assert(html.includes('16:30\u00A0น.'), 'missing close time');
  assert(html.includes('เวลาของระบบขณะได้รับคำขอ'), 'missing request-time line');
  assert(html.includes('15:42:42\u00A0น.'), 'missing server-measured clock with seconds');
  assert(html.includes('ระบบพิจารณาการรับสมัครตามเวลาของระบบ'), 'missing policy line');
  assert(html.includes('ไม่ใช่เวลาที่แสดงบนอุปกรณ์ของผู้สมัคร'), 'missing policy tail');
});

await test('E2: evidence ไม่มี serverTime — ซ่อนบรรทัดนาฬิกา แต่ยังมีกำหนดปิด+นโยบาย', () => {
  const html = markup(
    React.createElement(DeadlineServerTimeEvidence, {
      closeValue: CLOSE_1630,
      requestServerTime: undefined,
    }),
  );
  assert(html.includes('กำหนดปิดรับสมัคร'), 'missing close label');
  assertFalse(/เวลาของระบบขณะได้รับคำขอ/.test(html), 'must hide clock line when serverTime unknown');
  assert(html.includes('ระบบพิจารณาการรับสมัครตามเวลาของระบบ'), 'policy line must remain');
});

await test('E3: evidence — serverTime ไม่ใช่ number (ค่าปลอม) → ถือว่าไม่รู้', () => {
  const html = markup(
    React.createElement(DeadlineServerTimeEvidence, {
      closeValue: CLOSE_1630,
      requestServerTime: NaN,
    }),
  );
  assertFalse(/เวลาของระบบขณะได้รับคำขอ/.test(html), 'NaN must be treated as unknown');
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

})();
