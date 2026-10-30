// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Application History grouping / transition tests
 * =======================================================================
 * Phase 2 ของส่วน "ประวัติการดำเนินการ":
 *
 *   A. จัดกลุ่มตามวัน — วันเรียงใหม่ → เก่า, ใช้ local date ไม่ใช่ UTC
 *   B. ยุบ PDF_DOWNLOAD ซ้ำ: วันเดียวกัน + action เดียวกัน + actor เดียวกัน
 *   C. ห้ามยุบข้ามวัน / ข้าม actor / ข้าม action
 *   D. กลุ่มที่มีเหตุการณ์เดียว → คืนเป็นรายการเดี่ยว (ไม่มีปุ่มขยายเปล่า)
 *   E. UPDATE status transition อ่านจาก payload จริงเท่านั้น
 *      (previousStatus + changes[field=status]) ไม่มีข้อมูล → null
 *   F. payload ที่เป็น string (ของจริงจาก DB) และ object อ่านได้ทั้งคู่
 *   G. formatTimeRange / chronological
 *
 * Run: node --import tsx src/lib/__tests__/application-history.test.ts
 */

import {
  parseAuditPayload,
  getStatusTransition,
  getStatusReason,
  groupHistory,
  formatTimeRange,
  chronological,
  formatDayLabel,
  formatTime,
} from '../application-history';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** unix seconds ของเวลาท้องถิ่น (ให้ dayKey ตรงกับ local date) */
function localTs(y, m, d, hh = 12, mm = 0) {
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0).getTime() / 1000);
}

const ACTOR_A = 'thanet_30@hotmail.com';
const ACTOR_B = 'somchai@example.com';

function ev(id, action, actor, ts, payload = null) {
  return {
    id,
    action,
    adminId: `admin-${actor}`,
    adminEmail: actor,
    payload,
    createdAt: ts,
  };
}

console.log('\n[F] parseAuditPayload — string / object / null / เสียหาย');

test('F1: payload string (รูปแบบจริงจาก DB) อ่านได้', () => {
  const parsed = parseAuditPayload('{"changes":[],"summary":""}');
  assert(Array.isArray(parsed.changes), 'changes ต้องเป็น array');
});

test('F2: payload object ผ่านมาแล้วก็อ่านได้', () => {
  const parsed = parseAuditPayload({ previousStatus: 'DRAFT' });
  assertEqual(parsed.previousStatus, 'DRAFT', 'previousStatus');
});

test('F3: payload ว่าง / JSON เสีย → null (ไม่ throw)', () => {
  assertEqual(parseAuditPayload(null), null, 'null');
  assertEqual(parseAuditPayload(''), null, 'empty');
  assertEqual(parseAuditPayload('{not json'), null, 'broken');
});

console.log('\n[E] status transition — ใช้ข้อมูลจริงเท่านั้น');

test('E1: previousStatus + changes[status] → from/to ครบ', () => {
  const payload = JSON.stringify({
    changes: [
      { field: 'status', fieldLabel: 'สถานะใบสมัคร', oldValue: 'รอการตรวจสอบ', newValue: 'ผ่านการตรวจสอบ' },
    ],
    summary: 'สถานะใบสมัคร: รอการตรวจสอบ → ผ่านการตรวจสอบ',
    previousStatus: 'SUBMITTED',
  });
  const t = getStatusTransition(ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 24, 1, 26), payload));
  assertEqual(t.to, 'ผ่านการตรวจสอบ', 'to');
  assertEqual(t.from, 'SUBMITTED', 'from = previousStatus (raw enum จาก DB)');
});

test('E2: ไม่มี status ใน payload → null (ไม่เดา)', () => {
  const payload = JSON.stringify({ changes: [], summary: '' });
  assertEqual(
    getStatusTransition(ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 24), payload)),
    null,
    'transition',
  );
});

test('E3: payload null → null', () => {
  assertEqual(getStatusTransition(ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 24), null)), null, 'transition');
});

test('E4: legacy payload ที่มี status ตรง ๆ ยังอ่านได้ (to เท่านั้น)', () => {
  const t = getStatusTransition(
    ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 24), JSON.stringify({ status: 'QUALIFIED' })),
  );
  assertEqual(t.to, 'QUALIFIED', 'to');
  assertEqual(t.from, null, 'from ต้องเป็น null ไม่ใช่เดา');
});

test('E5: getStatusReason อ่านจาก changes[statusReason]', () => {
  const payload = JSON.stringify({
    changes: [{ field: 'statusReason', fieldLabel: 'เหตุผล', oldValue: null, newValue: 'เอกสารไม่ชัดเจน' }],
  });
  assertEqual(getStatusReason(ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 24), payload)), 'เอกสารไม่ชัดเจน', 'reason');
});

console.log('\n[A] จัดกลุ่มตามวัน');

test('A1: 12 รายการ (ข้อมูลจริง) → 5 วัน ตามลำดับใหม่ → เก่า', () => {
  const events = [
    ev('12', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 27, 10, 13)),
    ev('11', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 27, 2, 0)),
    ev('10', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 26, 0, 21)),
    ev('9', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('8', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 11)),
    ev('7', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 4)),
    ev('6', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 22, 38)),
    ev('5', 'UPDATE', ACTOR_A, localTs(2026, 10, 24, 1, 26), JSON.stringify({ previousStatus: 'SUBMITTED' })),
    ev('4', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 23, 20, 47)),
    ev('3', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 23, 20, 32)),
    ev('2', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 22, 18, 10)),
    ev('1', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 20, 10, 16)),
  ];

  const days = groupHistory(events);
  assertEqual(days.length, 7, 'จำนวนวัน (20,22,23,24,25,26,27 = 7 วัน)');
  assertEqual(days[0].label, formatDayLabel(days[0].date), 'label วันที่');
  assert(days[0].label.includes('ตุลาคม'), `label ต้องเป็นภาษาไทย: ${days[0].label}`);
  assert(days[0].label.includes('2569'), `label ต้องเป็น พ.ศ.: ${days[0].label}`);
  assertEqual(days[0].count, 2, 'วันแรก (27 ต.ค.) มี 2 เหตุการณ์');
});

test('A2: วันเรียงใหม่ → เก่า', () => {
  const events = [
    ev('b', 'DELETE', ACTOR_A, localTs(2026, 10, 27)),
    ev('a', 'DELETE', ACTOR_A, localTs(2026, 10, 20)),
  ];
  const days = groupHistory(events);
  assert(days[0].date.getTime() > days[1].date.getTime(), 'วันแรกต้องใหม่กว่า');
});

console.log('\n[B] ยุบ PDF_DOWNLOAD ซ้ำในวันเดียวกัน');

test('B1: 4 รายการวันเดียว actor เดียว → 1 กลุ่ม + 4 events', () => {
  const events = [
    ev('9', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('8', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 11)),
    ev('7', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 4)),
    ev('6', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 22, 38)),
  ];
  const days = groupHistory(events);
  assertEqual(days.length, 1, 'วันเดียว');
  assertEqual(days[0].rows.length, 1, 'แถวเดียว');
  assertEqual(days[0].rows[0].kind, 'group', 'kind');
  assertEqual(days[0].rows[0].events.length, 4, 'จำนวนเหตุการณ์ในกลุ่ม');
  assertEqual(formatTimeRange(days[0].rows[0].events), '22:38 - 23:18', 'ช่วงเวลา');
});

test('B2: กลุ่มยังผูกกลับไปที่เหตุการณ์ดิบได้ครบ (audit ต้องไม่หาย)', () => {
  const events = [
    ev('9', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('6', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 22, 38)),
  ];
  const days = groupHistory(events);
  const ids = days[0].rows[0].events.map((e) => e.id);
  assertEqual(ids.join(','), '9,6', 'id ครบ ไม่มีอะไรถูกทิ้ง');
});

console.log('\n[C] ห้ามยุบข้ามวัน / actor / action');

test('C1: ห้ามยุบข้ามวัน', () => {
  const events = [
    ev('2', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 26, 0, 21)),
    ev('1', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
  ];
  const days = groupHistory(events);
  assertEqual(days.length, 2, 'สองวัน');
  assertEqual(days[0].rows[0].kind, 'single', 'วันละรายการ');
  assertEqual(days[1].rows[0].kind, 'single', 'วันละรายการ');
});

test('C2: ห้ามยุบข้าม actor', () => {
  const events = [
    ev('2', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('1', 'PDF_DOWNLOAD', ACTOR_B, localTs(2026, 10, 25, 22, 38)),
  ];
  const days = groupHistory(events);
  assertEqual(days[0].rows.length, 2, 'ต้องแยกคนละแถว');
});

test('C3: ห้ามยุบข้าม action (UPDATE ไม่ถูกยุบ)', () => {
  const events = [
    ev('2', 'UPDATE', ACTOR_A, localTs(2026, 10, 25, 23, 18), JSON.stringify({ previousStatus: 'SUBMITTED' })),
    ev('1', 'UPDATE', ACTOR_A, localTs(2026, 10, 25, 22, 38), JSON.stringify({ previousStatus: 'DRAFT' })),
  ];
  const days = groupHistory(events);
  assertEqual(days[0].rows.length, 2, 'UPDATE ต้องไม่ถูกยุบ');
  assertEqual(days[0].rows[0].kind, 'single', 'kind');
});

test('C4: PDF 2 ครั้ง + UPDATE 1 ครั้ง วันเดียว → 2 แถว (กลุ่ม + เดี่ยว)', () => {
  const events = [
    ev('3', 'UPDATE', ACTOR_A, localTs(2026, 10, 25, 23, 30), JSON.stringify({ previousStatus: 'SUBMITTED' })),
    ev('2', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('1', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 22, 38)),
  ];
  const days = groupHistory(events);
  assertEqual(days[0].rows.length, 2, 'แถว');
  assertEqual(days[0].rows[0].kind, 'single', 'แถวแรก = UPDATE (ใหม่สุด)');
  assertEqual(days[0].rows[1].kind, 'group', 'แถวที่สอง = PDF group');
});

console.log('\n[D] กลุ่มเดียวไม่ควรมีปุ่มขยายว่าง');

test('D1: PDF ครั้งเดียวในวัน → single ไม่ใช่ group', () => {
  const events = [ev('1', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 20, 10, 16))];
  const days = groupHistory(events);
  assertEqual(days[0].rows[0].kind, 'single', 'kind');
});

console.log('\n[G] helper เวลา');

test('G1: formatTime เป็น 24 ชม.', () => {
  assertEqual(formatTime(localTs(2026, 10, 25, 23, 4)), '23:04', 'time');
});

test('G2: chronological พลิกเป็นเก่า → ใหม่', () => {
  const events = [
    ev('2', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 23, 18)),
    ev('1', 'PDF_DOWNLOAD', ACTOR_A, localTs(2026, 10, 25, 22, 38)),
  ];
  const sorted = chronological(events);
  assertEqual(sorted[0].id, '1', 'ตัวแรก');
  assertEqual(sorted[1].id, '2', 'ตัวหลัง');
});

test('G3: createdAt null → ยังไม่ crash และจัดกลุ่มเป็น "ไม่ระบุวันที่"', () => {
  const days = groupHistory([ev('1', 'PDF_DOWNLOAD', ACTOR_A, null)]);
  assertEqual(days.length, 1, '1 วัน');
  assertEqual(days[0].label, 'ไม่ระบุวันที่', 'label');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}