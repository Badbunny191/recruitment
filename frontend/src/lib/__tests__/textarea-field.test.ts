// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * TEXTAREA Field Settings Tests (applicant-side helpers + builder validation)
 * =======================================================================
 *
 * ใช้ pure logic tests ตามรูปแบบเดิมของ repo (ไม่มี jsdom / testing-library)
 *
 * ครอบคลุมเทียบรายการของ spec:
 *   O. rows จาก Field ถูกใช้              → getTextareaRows
 *   P. rows ไม่มีค่า → fallback 4          → getTextareaRows(null)
 *   Q. maxLength จาก Field ถูกใช้          → getTextareaMaxLength
 *   R. maxLength ไม่มีค่า → fallback 5000   → getTextareaMaxLength(null)
 *   S. minLength ถูกใช้                    → textareaMinLengthValidator
 *   T. Character Counter ถูกต้อง           → formatCounter + counterLevel
 *   U. Draft Rehydration                   → counter อ่านจาก RHF state เดียวกับ
 *                                            textarea (useWatch) — contract ที่
 *                                            page.tsx ทำให้ (ดูคอมเมนต์ใน page)
 *   V. Paste เกิน maxLength                → native maxlength + RHF rule
 *   W. ภาษาไทยนับตรงกับ String.length      → countUtf16Units
 *   X. Emoji นับแบบ UTF-16                 → countUtf16Units
 *   Z. Validation message ภาษาไทย          → validators คืนข้อความไทย
 *   Builder: validateFieldSettings (mirror backend zod)
 *
 * Run: node --import tsx src/lib/__tests__/textarea-field.test.ts
 */

import {
  countUtf16Units,
  counterLevel,
  formatCounter,
  getTextareaMaxLength,
  getTextareaMinLength,
  getTextareaRows,
  textareaMaxLengthValidator,
  textareaMinLengthValidator,
  textareaNotBlankValidator,
  TEXTAREA_FALLBACK_ROWS,
  TEXTAREA_HARD_CAP,
} from '../textareaField';
import { validateFieldSettings, FIELD_LENGTH_CAP } from '../fieldSettings';

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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// =========== O/P: rows ===========

test('O: rows จาก field ถูกใช้', () => {
  assertEqual(getTextareaRows({ rows: 5 }), 5);
  assertEqual(getTextareaRows({ rows: 1 }), 1);
  assertEqual(getTextareaRows({ rows: 20 }), 20);
});

test('P: rows null/undefined → fallback 4 (เท่าค่า hardcode เดิม)', () => {
  assertEqual(getTextareaRows({ rows: null }), TEXTAREA_FALLBACK_ROWS);
  assertEqual(getTextareaRows({}), TEXTAREA_FALLBACK_ROWS);
  assertEqual(TEXTAREA_FALLBACK_ROWS, 4);
});

// =========== Q/R: maxLength ===========

test('Q: maxLength จาก field ถูกใช้', () => {
  assertEqual(getTextareaMaxLength({ maxLength: 500 }), 500);
  assertEqual(getTextareaMaxLength({ maxLength: 1 }), 1);
});

test('R: maxLength null/undefined → fallback hard cap 5000', () => {
  assertEqual(getTextareaMaxLength({ maxLength: null }), TEXTAREA_HARD_CAP);
  assertEqual(getTextareaMaxLength({}), TEXTAREA_HARD_CAP);
  assertEqual(TEXTAREA_HARD_CAP, 5000);
});

// =========== S: minLength validator ===========

test('S: สั้นกว่า minLength → ข้อความไทย; ถึง minLength → true', () => {
  const v = textareaMinLengthValidator(10);
  assertEqual(v('สั้น'), 'กรุณากรอกให้ครบอย่างน้อย 10 ตัวอักษร');
  assertEqual(v('ก'.repeat(10)), true);
  assertEqual(v('ก'.repeat(11)), true);
});

test('S: optional ค่าว่าง → ผ่าน (ให้ required จัดการ)', () => {
  const v = textareaMinLengthValidator(10);
  assertEqual(v(''), true);
  assertEqual(v(null), true);
  assertEqual(v(undefined), true);
});

test('S: minLength null → ไม่บังคับขั้นต่ำ', () => {
  const v = textareaMinLengthValidator(null);
  assertEqual(v('a'), true);
});

// =========== T: counter ===========

test('T: formatCounter "N / max ตัวอักษร" (thousands separator)', () => {
  assertEqual(formatCounter(0, 500), '0 / 500 ตัวอักษร');
  assertEqual(formatCounter(123, 5000), '123 / 5,000 ตัวอักษร');
});

test('T: counterLevel — normal / warning (เหลือ ≤10%) / max', () => {
  assertEqual(counterLevel(0, 500), 'normal');
  assertEqual(counterLevel(449, 500), 'normal');
  assertEqual(counterLevel(450, 500), 'warning'); // 90%
  assertEqual(counterLevel(499, 500), 'warning');
  assertEqual(counterLevel(500, 500), 'max');
  assertEqual(counterLevel(501, 500), 'max');
});

// =========== W/X: UTF-16 counting ===========

test('W: ภาษาไทยนับตรงกับ String.length (สระ/วรรณยุกต์ = 1 หน่วย/ตัว)', () => {
  assertEqual(countUtf16Units('ที่'), 'ที่'.length);
  assertEqual('ที่'.length, 3); // ท + ี + ่
  assertEqual(countUtf16Units('สวัสดีครับ'), 'สวัสดีครับ'.length);
});

test('X: emoji นับแบบ UTF-16 (surrogate pair = 2 หน่วย) ตรงกับ native maxlength', () => {
  assertEqual(countUtf16Units('🎉'), '🎉'.length);
  assertEqual('🎉'.length, 2);
  assertEqual(countUtf16Units('🎉'.repeat(250)), 500);
  // ZWJ family emoji นับตาม code units เหมือน native
  assertEqual(countUtf16Units('👨‍👩‍👧‍👦'), '👨‍👩‍👧‍👦'.length);
});

test('countUtf16Units: ค่าที่ไม่ใช่ string → 0', () => {
  assertEqual(countUtf16Units(null), 0);
  assertEqual(countUtf16Units(undefined), 0);
  assertEqual(countUtf16Units(123), 0);
});

// =========== maxLength / notBlank validators ===========

test('maxLength validator: เกิน → ข้อความไทย; พอดี → true', () => {
  const v = textareaMaxLengthValidator(500);
  assertEqual(v('ก'.repeat(500)), true);
  assertEqual(v('ก'.repeat(501)), 'คำตอบยาวเกินกำหนด (สูงสุด 500 ตัวอักษร)');
});

test('maxLength validator: ไม่ใช่ string → ผ่าน (ให้ INVALID_TEXTAREA_VALUE ฝั่ง backend จัดการ)', () => {
  assertEqual(textareaMaxLengthValidator(500)(null), true);
});

test('notBlank validator: required whitespace ล้วน → ไม่ผ่าน', () => {
  const v = textareaNotBlankValidator(true);
  assertEqual(v('   '), 'กรุณากรอกข้อมูล');
  assertEqual(v(''), 'กรุณากรอกข้อมูล');
  assertEqual(v(' คำตอบ '), true);
});

test('notBlank validator: optional → ผ่านทุกกรณี', () => {
  const v = textareaNotBlankValidator(false);
  assertEqual(v('   '), true);
  assertEqual(v(''), true);
});

// =========== Builder: validateFieldSettings ===========

test('Builder: rows 1 และ 20 ผ่าน', () => {
  assertEqual(validateFieldSettings({ rows: '1' }), null);
  assertEqual(validateFieldSettings({ rows: '20' }), null);
});

test('Builder: rows 0 และ 21 ไม่ผ่าน (ข้อความไทยระบุช่วง)', () => {
  assertEqual(validateFieldSettings({ rows: '0' }), 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด');
  assertEqual(validateFieldSettings({ rows: '21' }), 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด');
});

test('Builder: maxLength 1 และ 5000 ผ่าน, 5001 ไม่ผ่าน', () => {
  assertEqual(validateFieldSettings({ maxLength: '1' }), null);
  assertEqual(validateFieldSettings({ maxLength: '5000' }), null);
  assertEqual(validateFieldSettings({ maxLength: '5001' }), 'ความยาวสูงสุดต้องไม่เกิน 5,000 ตัวอักษร');
});

test('Builder: minLength > maxLength ไม่ผ่าน, minLength <= maxLength ผ่าน', () => {
  assertEqual(
    validateFieldSettings({ minLength: '600', maxLength: '500' }),
    'ความยาวขั้นต่ำต้องไม่มากกว่าความยาวสูงสุด'
  );
  assertEqual(validateFieldSettings({ minLength: '500', maxLength: '500' }), null);
});

test('Builder: ค่าว่างทั้งหมด = ไม่กำหนด → ผ่าน (ข้อมูลเก่า)', () => {
  assertEqual(validateFieldSettings({}), null);
  assertEqual(validateFieldSettings({ rows: '', minLength: '', maxLength: '' }), null);
});

test(`Builder: minLength เทียบ hard cap ${FIELD_LENGTH_CAP} เมื่อไม่มี maxLength`, () => {
  assertEqual(validateFieldSettings({ minLength: '5000' }), null);
  assertEqual(validateFieldSettings({ minLength: '5001' }), 'ความยาวขั้นต่ำต้องไม่เกิน 5,000 ตัวอักษร');
});

// =========== Summary ===========

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
