/**
 * Tests: PDF filename pattern helpers ฝั่ง Admin UI (Migration 028)
 * --------------------------------------------
 * รัน: node --import tsx src/lib/__tests__/pdf-filename-pattern.test.ts
 *
 * ทดสอบ validatePdfFilenamePattern (mirror ของ backend) และ
 * buildPdfFilenamePreview (ข้อมูลสังเคราะห์ APP-2026-5025 / นายทดสอบ ระบบ)
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import {
  validatePdfFilenamePattern,
  buildPdfFilenamePreview,
  DEFAULT_PDF_FILENAME_PATTERN,
  PDF_PREVIEW_SAMPLE,
} from '../pdf-filename-pattern';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assert(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertOk(pattern: unknown, msg = '') {
  const result = validatePdfFilenamePattern(pattern);
  assert(result.ok, `${msg} expected ok, got ${'message' in result ? result.message : ''}`);
}

function assertFail(pattern: unknown, expectedMessage?: string, msg = '') {
  const result = validatePdfFilenamePattern(pattern);
  assert(!result.ok, `${msg} expected fail`);
  if (expectedMessage) assertEqual(result.message, expectedMessage, `${msg} message`);
}

console.log('\n========================================');
console.log('PDF Filename Pattern (Admin UI) Tests');
console.log('========================================\n');

test('U1: ค่าเริ่มต้น / null / ว่าง ผ่าน', () => {
  assertOk(DEFAULT_PDF_FILENAME_PATTERN);
  assertOk(null);
  assertOk('');
  assertOk('   ');
});

test('U2: ไม่มี {applicationNo} ไม่ผ่าน', () => {
  assertFail('ใบสมัคร_{fullname}', 'รูปแบบชื่อไฟล์ต้องมี {applicationNo}');
});

test('U3: Token นอก allowlist ไม่ผ่าน — email/phone/nationalId', () => {
  assertFail('a_{applicationNo}_{email}', 'พบตัวแปรที่ระบบไม่รองรับ: {email}');
  assertFail('a_{applicationNo}_{phone}', 'พบตัวแปรที่ระบบไม่รองรับ: {phone}');
  assertFail('a_{applicationNo}_{nationalId}', 'พบตัวแปรที่ระบบไม่รองรับ: {nationalId}');
});

test('U4: .pdf / slash / CR-LF / เกิน 200 ไม่ผ่าน', () => {
  assertFail('x_{applicationNo}.pdf', 'ไม่ต้องระบุนามสกุล .pdf ระบบจะเพิ่มให้อัตโนมัติ');
  assertFail('x/y_{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\');
  assertFail('x\\y_{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\');
  assertFail('x_{applicationNo}\n', 'รูปแบบชื่อไฟล์ต้องไม่มีตัวอักษรควบคุมหรือการขึ้นบรรทัดใหม่');
  assertFail(`x${'x'.repeat(185)}{applicationNo}`, 'รูปแบบชื่อไฟล์ต้องมีความยาวไม่เกิน 200 ตัวอักษร');
});

test('U5: Token อนุญาตครบทั้ง 4 ผ่าน', () => {
  assertOk('ใบสมัคร_{applicationNo}_{fullname}_{roundCode}_{year}');
});

test('U6: Preview ค่าเริ่มต้นด้วยข้อมูลสังเคราะห์ — ตรงสเปก UAT', () => {
  assertEqual(
    buildPdfFilenamePreview(DEFAULT_PDF_FILENAME_PATTERN),
    'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
  );
  assertEqual(
    buildPdfFilenamePreview(null),
    'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
  );
});

test('U7: Preview custom pattern + roundCode/year', () => {
  assertEqual(
    buildPdfFilenamePreview('{roundCode}_{year}_{applicationNo}_{fullname}'),
    'TEST_2026_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
  );
});

test('U8: Preview พิมพ์ระหว่างทาง (pattern ผิด) ไม่ throw และเติม .pdf ครั้งเดียว', () => {
  const result = buildPdfFilenamePreview('ใบสมัคร_{applicationNo}');
  assertEqual(result, 'ใบสมัคร_APP-2026-5025.pdf');
  assert(!result.includes('.pdf.pdf'), 'no .pdf.pdf');
});

test('U9: Preview ข้อมูลสังเคราะห์เท่านั้น — ไม่มีข้อมูลจริง', () => {
  assertEqual(PDF_PREVIEW_SAMPLE.fullname, 'นายทดสอบ ระบบ');
  assertEqual(PDF_PREVIEW_SAMPLE.applicationNo, 'APP-2026-5025');
});

console.log('\n----------------------------------------');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
