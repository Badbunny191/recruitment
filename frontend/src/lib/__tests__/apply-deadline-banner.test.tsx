// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * ApplyDeadlineBanner + DeadlineServerTimeEvidence (component-level)
 * ===================================================================
 * Banner "เหลือเวลารับสมัครอีก" (ไม่มีนาฬิการะบบ — decision 2026-11-11)
 * แสดง 2 ที่: หน้าฟอร์ม (context=apply) และหน้า review เหนือปุ่มยืนยัน
 * (context=review) — ทดสอบ markup จริง:
 *
 *   B1. info apply (48 นาที)     → ข้อความ + เวลาปิด + โทนสงบ (role=status)
 *   B2. warning apply (14 นาที)  → "ตรวจสอบข้อมูลให้ครบถ้วน ก่อนเวลา …"
 *   B3. final apply (4:52)       → ตัวเลข "04:52" ใหญ่ + ห้ามมีนาฬิการะบบ
 *   B4. closed                   → "ปิดรับสมัครแล้ว" ไม่มีตัวเลข/นาฬิกา
 *   B5. hidden                   → null
 *   B6. warning review (14 นาที) → "ตรวจสอบข้อมูลให้เรียบร้อย ก่อนกดยืนยันส่งใบสมัคร"
 *   B7. final review (4:52)      → "04:52" ตัวเลขใหญ่กว่า apply (text-3xl)
 *   B8. info review (48 นาที)    → ข้อความเดียวกับ apply
 *   E1-E3. evidence block (คงเดิม — จุดเดียวที่แสดง "เวลาระบบ")
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/lib/__tests__/apply-deadline-banner.test.tsx
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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ========== FIXTURES ==========

const MINUTE = 60 * 1000;
// ปิด 16:30 น. (เวลาไทย) วันที่ 10 พ.ย. 2026
const CLOSE_1630 = Date.UTC(2026, 10, 10, 9, 30); // 16:30 ICT = 09:30 UTC
// เวลา server ณ render — 15:42:07 น.
const NOW_1542 = Date.UTC(2026, 10, 10, 8, 42, 7); // 15:42:07 ICT = 08:42:07 UTC

const banner = (props: any) =>
  markup(React.createElement(ApplyDeadlineBanner, {
    remainingMs: null,
    closeMs: CLOSE_1630,
    nowMs: NOW_1542,
    ...props,
  }));

// =============================================================================

void (async () => {

await test('B1: info apply (48 นาที) — ข้อความสงบ + เวลาปิด + ไม่มีนาฬิกา', () => {
  const html = banner({ state: 'info', remainingMs: 48 * MINUTE });
  assert(html.includes('เหลือเวลารับสมัครอีก 48 นาที'), `missing countdown: ${html}`);
  assert(html.includes('ระบบจะปิดรับสมัครอัตโนมัติ'), 'missing auto-close line');
  assert(html.includes('16:30\u00A0น.'), 'missing close time');
  assert(html.includes('amber-50'), 'info tone must be calm amber');
  assert(html.includes('role="status"'), 'info is not an alert');
  assertFalse(/เวลาระบบ \d/.test(html), 'banner must NOT show system clock');
});

await test('B2: warning apply (14 นาที) — "ตรวจสอบข้อมูลให้ครบถ้วน ก่อนเวลา …"', () => {
  const html = banner({ state: 'warning', remainingMs: 14 * MINUTE });
  assert(html.includes('เหลือเวลารับสมัครอีก 14 นาที'), `missing countdown: ${html}`);
  assert(html.includes('กรุณาตรวจสอบข้อมูลให้ครบถ้วน'), 'missing action line');
  assert(html.includes('ก่อนเวลา 16:30\u00A0น.'), 'missing "ก่อนเวลา" + close time');
  assert(html.includes('orange-50'), 'warning tone must be orange');
  assert(html.includes('role="alert"'), 'warning must be an alert');
  assertFalse(/เวลาระบบ \d/.test(html), 'banner must NOT show system clock');
});

await test('B3: final apply (4:52) — ตัวเลข "04:52" ใหญ่ + ห้ามมีนาฬิกา', () => {
  const html = banner({ state: 'final', remainingMs: 4 * MINUTE + 52 * 1000 });
  assert(html.includes('เหลือเวลารับสมัครอีก'), 'missing label');
  assert(html.includes('04:52'), `missing MM:SS countdown: ${html}`);
  assertFalse(/นาที 52 วินาที/.test(html), 'final uses MM:SS, not spelled-out text');
  assertFalse(/เวลาระบบ \d/.test(html), 'final must NOT show system clock');
  assert(html.includes('text-2xl'), 'final number must be large (text-2xl)');
});

await test('B4: closed — "ปิดรับสมัครแล้ว" และห้ามมีนาฬิกา/ตัวเลข countdown', () => {
  const html = banner({ state: 'closed', remainingMs: -1000 });
  assert(html.includes('ปิดรับสมัครแล้ว'), `missing closed text: ${html}`);
  assertFalse(/เวลาระบบ \d/.test(html), 'closed must NOT show clock');
  assertFalse(/\d+ วินาที/.test(html), 'closed must NOT show countdown');
  assertFalse(/\d{2}:\d{2}/.test(html), 'closed must NOT show MM:SS');
});

await test('B5: hidden — ไม่ render อะไรเลย', () => {
  const html = banner({ state: 'hidden', remainingMs: 5 * 60 * MINUTE });
  assertEqual(html, '', 'hidden must render nothing');
});

await test('B6: warning review (14 นาที) — "ตรวจสอบข้อมูลให้เรียบร้อย ก่อนกดยืนยันส่งใบสมัคร"', () => {
  const html = banner({ state: 'warning', remainingMs: 14 * MINUTE, context: 'review' });
  assert(html.includes('เหลือเวลารับสมัครอีก 14 นาที'), `missing countdown: ${html}`);
  assert(html.includes('กรุณาตรวจสอบข้อมูลให้เรียบร้อย'), 'missing review action line');
  assert(html.includes('ก่อนกดยืนยันส่งใบสมัคร'), 'missing "ก่อนกดยืนยันส่งใบสมัคร"');
  assertFalse(/ก่อนเวลา/.test(html), 'review warning must NOT mention close time');
  assert(html.includes('orange-50'), 'warning tone must be orange');
  assertFalse(/เวลาระบบ \d/.test(html), 'banner must NOT show system clock');
});

await test('B7: final review (4:52) — "04:52" ใหญ่กว่าสถานะอื่น (text-3xl)', () => {
  const html = banner({ state: 'final', remainingMs: 4 * MINUTE + 52 * 1000, context: 'review' });
  assert(html.includes('เหลือเวลารับสมัครอีก'), 'missing label');
  assert(html.includes('04:52'), `missing MM:SS countdown: ${html}`);
  assert(html.includes('text-3xl'), 'review final number must be larger (text-3xl)');
  assertFalse(/เวลาระบบ \d/.test(html), 'final must NOT show system clock');
});

await test('B8: info review (48 นาที) — ข้อความเดียวกับ apply', () => {
  const html = banner({ state: 'info', remainingMs: 48 * MINUTE, context: 'review' });
  assert(html.includes('เหลือเวลารับสมัครอีก 48 นาที'), 'missing countdown');
  assert(html.includes('ระบบจะปิดรับสมัครอัตโนมัติ'), 'missing auto-close line');
  assert(html.includes('16:30\u00A0น.'), 'missing close time');
  assertFalse(/เวลาระบบ \d/.test(html), 'banner must NOT show system clock');
});

await test('E1: evidence ครบ — กำหนดปิด + เวลาของระบบขณะได้รับคำขอ + นโยบาย (คงเดิม)', () => {
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
