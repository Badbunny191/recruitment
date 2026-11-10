/**
 * Round Audit Trail — CREATE payload + date/time precision
 * =======================================================================
 *
 * ปัญหาเดิม (production audit):
 *   1. POST /admin/rounds
 *      path คือ '/rounds' ไม่มี :id → auditMiddleware ตั้ง entityId = 'BULK/NEW'
 *      และ route ไม่ได้ setAuditPayload เลย → payload = NULL
 *      ⇒ audit log บอกได้แค่ว่า "มีคนสร้างอะไรบางอย่าง"
 *        ไม่มีชื่อรอบ ไม่มีรหัส ไม่มีช่วงเวลาเปิด/ปิด
 *
 *   2. PATCH /admin/rounds/:id
 *      ใช้ toLocaleDateString('th-TH') → เก็บแค่วันที่ (ไม่มีนาที)
 *      ⇒ เลื่อนปิดรับสมัคร 16:29 → 16:31 ในวันเดียวกัน
 *        oldValue === newValue → computeChanges ข้าม → ไม่มี diff เลย
 *        (เหตุการณ์ที่สำคัญที่สุดของรอบหนึ่ง ๆ หายไปจาก log)
 *
 * เทสชุดนี้ล็อกสัญญา 3 ข้อ:
 *   A. formatAuditDateTime เก็บเวลาไทยพร้อมนาที ไม่ขึ้นกับ timezone เครื่อง
 *   B. computeChanges ของ RECRUITMENT_ROUND เห็น diff 16:29 → 16:31
 *      (fail-when-no-fix: ด้วย toLocaleDateString เดิมจะได้ 0 diff)
 *   C. buildRoundCreatePayload ระบุตัวรอบได้ครบ (id/title/roundCode/ช่วงเวลา)
 *
 * รัน: node --import tsx src/lib/__tests__/audit-round-datetime.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import assert from 'node:assert';
import {
  computeChanges,
  formatAuditDateTime,
  formatValue,
  buildRoundCreatePayload,
} from '../change-tracking';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  FAIL ${name}: ${e?.message ?? e}`);
  }
}

const BKK = 7 * 60 * 60 * 1000;

/** เวลาไทย (Asia/Bangkok) → epoch ms */
function bkk(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min) - BKK;
}

function changeOf(changes: any[], field: string) {
  return changes.find((c) => c.field === field);
}

async function runAllTests() {
  console.log('\n=== Round audit: CREATE payload + datetime precision ===\n');

  // ---------------------------------------------------------------- A
  await test('A1: formatAuditDateTime เก็บเวลาไทยพร้อมนาที (16:29 ไม่ใช่แค่วันที่)', () => {
    const ms = bkk(2026, 11, 6, 16, 29);
    assert.strictEqual(formatAuditDateTime(ms), '6 พ.ย. 2569 16:29');
  });

  await test('A2: รับ Date object (ค่าที่ drizzle mode:timestamp คืนมา)', () => {
    const d = new Date(bkk(2026, 11, 6, 16, 31));
    assert.strictEqual(formatAuditDateTime(d), '6 พ.ย. 2569 16:31');
  });

  await test('A3: รับ unix seconds (ค่าที่ request ส่งมา)', () => {
    const sec = Math.floor(bkk(2026, 11, 6, 16, 31) / 1000);
    assert.strictEqual(formatAuditDateTime(sec), '6 พ.ย. 2569 16:31');
  });

  await test('A4: ต่างกันแค่นาที → ข้อความต่างกัน (หัวใจของ fix)', () => {
    const a = formatAuditDateTime(bkk(2026, 11, 6, 16, 29));
    const b = formatAuditDateTime(bkk(2026, 11, 6, 16, 31));
    assert.notStrictEqual(a, b, '16:29 กับ 16:31 ต้องไม่เท่ากัน');
  });

  await test('A5: ค่าเพี้ยน (null / "" / ขยะ) → null (ไม่ใช่ค่าว่างที่กลายเป็น diff ปลอม)', () => {
    assert.strictEqual(formatAuditDateTime(null), null);
    assert.strictEqual(formatAuditDateTime(undefined), null);
    assert.strictEqual(formatAuditDateTime(''), null);
    assert.strictEqual(formatAuditDateTime('abc'), null);
  });

  await test('A6: formatValue จัดรูป openDate/closeDate เป็นวันเวลาไทยอัตโนมัติ', () => {
    assert.strictEqual(formatValue('openDate', bkk(2026, 11, 1, 9, 0)), '1 พ.ย. 2569 09:00');
    assert.strictEqual(formatValue('closeDate', bkk(2026, 11, 30, 16, 30)), '30 พ.ย. 2569 16:30');
  });

  await test('A7: formatValue ไม่แตะ field อื่น (พฤติกรรมเดิมคงอยู่)', () => {
    assert.strictEqual(formatValue('title', 'รอบทดสอบ'), 'รอบทดสอบ');
    assert.strictEqual(formatValue('displayOrder', 5), '5');
  });

  // ---------------------------------------------------------------- B
  await test('B1 (fail-when-no-fix): closeDate 16:29 → 16:31 วันเดียวกัน ต้องมี diff', () => {
    const changes = computeChanges(
      {
        title: 'รอบเดิม',
        positionLevel: 'ปฏิบัติการ',
        status: 'ACTIVE',
        openDate: new Date(bkk(2026, 11, 1, 9, 0)),
        closeDate: new Date(bkk(2026, 11, 30, 16, 29)),
      },
      {
        title: 'รอบเดิม',
        positionLevel: 'ปฏิบัติการ',
        status: 'ACTIVE',
        openDate: undefined,
        closeDate: new Date(bkk(2026, 11, 30, 16, 31)),
      },
      'RECRUITMENT_ROUND'
    );

    assert.strictEqual(
      changes.length,
      1,
      `ต้องมี diff เดียวคือ closeDate (ได้ ${changes.length}: ${changes.map((c) => c.field).join(',')})`
    );
    const c = changeOf(changes, 'closeDate');
    assert.ok(c, 'ต้องมี diff ของ closeDate');
    assert.strictEqual(c.oldValue, '30 พ.ย. 2569 16:29');
    assert.strictEqual(c.newValue, '30 พ.ย. 2569 16:31');
    assert.strictEqual(c.fieldLabel, 'วันปิดรับสมัคร');
  });

  await test('B2: openDate 09:00 → 09:15 วันเดียวกัน ต้องมี diff', () => {
    const changes = computeChanges(
      { openDate: new Date(bkk(2026, 11, 1, 9, 0)) },
      { openDate: new Date(bkk(2026, 11, 1, 9, 15)) },
      'RECRUITMENT_ROUND'
    );
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assert.strictEqual(changeOf(changes, 'openDate').oldValue, '1 พ.ย. 2569 09:00');
    assert.strictEqual(changeOf(changes, 'openDate').newValue, '1 พ.ย. 2569 09:15');
  });

  await test('B3: วันที่ไม่เปลี่ยน (นาทีเท่าเดิม) → ไม่มี diff', () => {
    const changes = computeChanges(
      { closeDate: new Date(bkk(2026, 11, 30, 16, 30)) },
      { closeDate: new Date(bkk(2026, 11, 30, 16, 30)) },
      'RECRUITMENT_ROUND'
    );
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  await test('B4: PATCH ไม่ส่งวันที่ (undefined) → ไม่มี false diff', () => {
    const changes = computeChanges(
      { openDate: new Date(bkk(2026, 11, 1, 9, 0)), closeDate: new Date(bkk(2026, 11, 30, 16, 30)) },
      { openDate: undefined, closeDate: undefined },
      'RECRUITMENT_ROUND'
    );
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  await test('B5: เปลี่ยนวันข้ามวัน → diff ยังถูกต้อง', () => {
    const changes = computeChanges(
      { closeDate: new Date(bkk(2026, 11, 30, 16, 30)) },
      { closeDate: new Date(bkk(2026, 12, 1, 16, 30)) },
      'RECRUITMENT_ROUND'
    );
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changeOf(changes, 'closeDate').oldValue, '30 พ.ย. 2569 16:30');
    assert.strictEqual(changeOf(changes, 'closeDate').newValue, '1 ธ.ค. 2569 16:30');
  });

  // ---------------------------------------------------------------- C
  await test('C1: buildRoundCreatePayload ระบุตัวรอบได้ครบ', () => {
    const payload = buildRoundCreatePayload({
      id: 'round-uuid-0001',
      title: 'เชี่ยวชาญ 2569',
      roundCode: 'CHM01',
      positionLevel: 'เชี่ยวชาญ',
      openDate: Math.floor(bkk(2026, 11, 1, 9, 0) / 1000),
      closeDate: Math.floor(bkk(2026, 11, 30, 16, 30) / 1000),
      status: 'ACTIVE',
    });

    assert.strictEqual(payload.roundId, 'round-uuid-0001', 'roundId');
    assert.strictEqual(payload.title, 'เชี่ยวชาญ 2569', 'title');
    assert.strictEqual(payload.roundCode, 'CHM01', 'roundCode');
    assert.strictEqual(payload.positionLevel, 'เชี่ยวชาญ', 'positionLevel');
    assert.strictEqual(payload.openDate, '1 พ.ย. 2569 09:00', 'openDate');
    assert.strictEqual(payload.closeDate, '30 พ.ย. 2569 16:30', 'closeDate');
    assert.strictEqual(payload.status, 'ACTIVE', 'status');
  });

  await test('C2: payload ไม่มีค่า undefined ค้าง (JSON เก็บได้สะอาด)', () => {
    const payload = buildRoundCreatePayload({
      id: 'r1',
      title: 'รอบ',
      roundCode: null,
      positionLevel: 'ทั่วไป',
      openDate: null,
      closeDate: null,
      status: 'DRAFT',
    });
    // ค่าที่อ่านไม่ได้ → null (ไม่ใช่ undefined ที่ JSON.stringify ตัดทิ้งเงียบ ๆ)
    assert.strictEqual(payload.openDate, null);
    assert.strictEqual(payload.closeDate, null);
    assert.strictEqual(payload.roundCode, null);
    assert.strictEqual(JSON.parse(JSON.stringify(payload)).roundId, 'r1');
  });

  console.log('');
  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
