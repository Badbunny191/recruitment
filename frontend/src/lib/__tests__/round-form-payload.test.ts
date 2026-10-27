/**
 * R10: buildRoundPatchPayload — Numbering settings payload regression
 * =======================================================================
 *
 * ปัญหาเดิม: หน้า Rounds โหมดแก้ไขไม่เคยส่ง roundCode/applicationPattern ใน PATCH
 * (คอมเมนต์เดิม: "เมื่อ editing mode - ไม่ส่ง roundCode และ applicationPattern")
 * ทั้งที่เมื่อรอบยังไม่มีผู้สมัคร UI แสดงช่องกรอกเป็นแก้ไขได้
 * → admin กดบันทึก "สำเร็จ" แต่ backend ไม่เคยได้ค่า → ไม่ save เงียบ ๆ
 *
 * กติกา (source of truth = backend PATCH /admin/rounds/:id):
 *   RP1. ยังไม่ล็อก (ไม่มีผู้สมัคร) + กรอก roundCode/pattern → ต้องส่งค่าจริง
 *        (fail-when-no-fix: เดิมไม่มี key ทั้งคู่)
 *   RP2. ล็อก (มีผู้สมัคร) → ไม่ส่ง field ทั้งสอง (UI เป็น read-only)
 *   RP3. legacy round (roundCode ว่าง / pattern null) → ไม่ส่ง field นั้น
 *        (สำคัญ: ส่ง roundCode: '' จะโดน Zod min(3) ปฏิเสธ → 400 โดยไม่จำเป็น)
 *   RP4. payload พื้นฐานครบ (title/dates/status/announcement/templateVersionId)
 *   RP5. templateVersionId ว่าง → ไม่ส่ง (กติกาเดิม)
 *
 * รัน: node --import tsx src/lib/__tests__/round-form-payload.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import { buildRoundPatchPayload } from '../round-form-payload';

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

function assertDeepEqual(actual: any, expected: any, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}

// ========== FIXTURES ==========

const baseForm = {
  title: 'รอบสมัคร 2569',
  positionLevel: 'ปฏิบัติการ',
  templateVersionId: 'ver-1',
  status: 'DRAFT',
  announcementTitle: 'หัวข้อประกาศ',
  announcementDescription: 'รายละเอียด',
  contactInformation: 'ติดต่อ 02-xxx',
  remark: 'หมายเหตุ',
  applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  roundCode: 'CHM01',
};

// ========== TESTS ==========

test('RP1 (fail-when-no-fix): ไม่ล็อก + กรอกครบ → ส่ง roundCode + applicationPattern จริง', () => {
  const payload = buildRoundPatchPayload(baseForm, {
    isRoundLocked: false,
    openDateUnix: 1780000000,
    closeDateUnix: 1780300000,
  });
  assertEqual(payload.roundCode, 'CHM01', 'roundCode ต้องถูกส่ง (เดิมไม่เคยส่ง)');
  assertEqual(payload.applicationPattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'pattern ต้องถูกส่ง');
});

test('RP2: ล็อก (มีผู้สมัคร) → ไม่ส่ง roundCode/applicationPattern', () => {
  const payload = buildRoundPatchPayload(baseForm, {
    isRoundLocked: true,
    openDateUnix: 1780000000,
    closeDateUnix: 1780300000,
  });
  assertEqual('roundCode' in payload, false, 'ห้ามส่ง roundCode เมื่อล็อก');
  assertEqual('applicationPattern' in payload, false, 'ห้ามส่ง pattern เมื่อล็อก');
});

test('RP3a: legacy round (roundCode ว่าง) ไม่ล็อก → ส่ง pattern แต่ไม่ส่ง roundCode', () => {
  const payload = buildRoundPatchPayload(
    { ...baseForm, roundCode: '', applicationPattern: null },
    { isRoundLocked: false, openDateUnix: 1780000000, closeDateUnix: 1780300000 }
  );
  assertEqual('roundCode' in payload, false, 'roundCode ว่างห้ามส่ง (กัน Zod 400)');
  assertEqual('applicationPattern' in payload, false, 'pattern null ห้ามส่ง');
});

test('RP3b: legacy round แต่ไม่ล็อก + มี pattern ใหม่ → ส่ง pattern อย่างเดียว', () => {
  const payload = buildRoundPatchPayload(
    { ...baseForm, roundCode: '', applicationPattern: '{YEAR}-{RUNNING:4}' },
    { isRoundLocked: false, openDateUnix: 1780000000, closeDateUnix: 1780300000 }
  );
  assertEqual('roundCode' in payload, false);
  assertEqual(payload.applicationPattern, '{YEAR}-{RUNNING:4}');
});

test('RP4: payload พื้นฐานครบและแปลงวันที่เป็น unix แล้ว', () => {
  const payload = buildRoundPatchPayload(baseForm, {
    isRoundLocked: false,
    openDateUnix: 1780000000,
    closeDateUnix: 1780300000,
  });
  assertDeepEqual(payload, {
    title: 'รอบสมัคร 2569',
    positionLevel: 'ปฏิบัติการ',
    openDate: 1780000000,
    closeDate: 1780300000,
    status: 'DRAFT',
    announcementTitle: 'หัวข้อประกาศ',
    announcementDescription: 'รายละเอียด',
    contactInformation: 'ติดต่อ 02-xxx',
    remark: 'หมายเหตุ',
    templateVersionId: 'ver-1',
    roundCode: 'CHM01',
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  });
});

test('RP5: templateVersionId ว่าง → ไม่ส่ง (กติกาเดิมคงอยู่)', () => {
  const payload = buildRoundPatchPayload(
    { ...baseForm, templateVersionId: '' },
    { isRoundLocked: false, openDateUnix: 1780000000, closeDateUnix: 1780300000 }
  );
  assertEqual('templateVersionId' in payload, false);
});

// ========== SUMMARY ==========

console.log(`\n=== round-form-payload: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
