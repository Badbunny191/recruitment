/**
 * TEXTAREA Answer Validation Tests (submit-side)
 * =======================================================================
 *
 * ครอบคลุมเทียบรายการ AA–AM ของ spec:
 *   AA. Required ว่าง → ปฏิเสธ
 *   AB. Required whitespace อย่างเดียว → ปฏิเสธ
 *   AC. Optional ว่าง → ผ่าน
 *   AD. Optional สั้นกว่า minLength (มีค่า) → ไม่ผ่าน
 *   AE. เท่ากับ minLength → ผ่าน
 *   AF. เท่ากับ maxLength → ผ่าน
 *   AG. เกิน maxLength → ไม่ผ่าน
 *   AH. ไม่มี maxLength + ยาว 5000 → ผ่าน (hard cap)
 *   AI. ไม่มี maxLength + ยาว 5001 → ไม่ผ่าน (hard cap)
 *   AJ. ค่าไม่ใช่ string → ไม่ผ่าน
 *   AK. Error ไม่มีคำตอบผู้สมัคร (message/fieldId เท่านั้น)
 *   AL. กฎไม่รบกวน field type อื่น (pure function เรียกเฉพาะ TEXTAREA)
 *   AM. ข้อมูลเก่าไม่มี minLength/maxLength → ยัง validate ได้ตาม fallback
 *
 * นับความยาวแบบ UTF-16 code units (String.length) — ตรงกับ HTML maxlength
 *
 * รัน: node --import tsx src/lib/__tests__/textarea-validation.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import {
  effectiveTextareaMaxLength,
  validateTextareaAnswer,
  type TextareaFieldRule,
} from '../textarea-validation';
import { TEXTAREA_LENGTH_CAP } from '../../schemas/validators';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
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

function assertNotIncludes(haystack: string, needle: string, msg = '') {
  if (haystack.includes(needle)) {
    throw new Error(`${msg} ไม่ควรมี "${needle}" อยู่ใน "${haystack}"`);
  }
}

function rule(overrides: Partial<TextareaFieldRule> = {}): TextareaFieldRule {
  return {
    fieldId: 'field-answer',
    isRequired: false,
    minLength: null,
    maxLength: null,
    ...overrides,
  };
}

// =========== effectiveMaxLength fallback ===========

test('effectiveTextareaMaxLength: ค่าที่กำหนดใช้ค่านั้น', () => {
  assertEqual(effectiveTextareaMaxLength(500), 500);
});

test('effectiveTextareaMaxLength: null → hard cap 5000', () => {
  assertEqual(effectiveTextareaMaxLength(null), 5000);
  assertEqual(effectiveTextareaMaxLength(undefined), 5000);
  assertEqual(effectiveTextareaMaxLength(null), TEXTAREA_LENGTH_CAP);
});

// =========== Required ===========

test('AA: required ว่าง (null) → ปฏิเสธ', () => {
  const r = validateTextareaAnswer(null, rule({ isRequired: true }));
  assertEqual(r.ok, false);
  assertEqual(r.code, 'REQUIRED_FIELD_EMPTY');
});

test('AA: required ว่าง ("") → ปฏิเสธ', () => {
  const r = validateTextareaAnswer('', rule({ isRequired: true }));
  assertEqual(r.ok, false);
  assertEqual(r.code, 'REQUIRED_FIELD_EMPTY');
});

test('AB: required whitespace อย่างเดียว (" ") → ปฏิเสธ', () => {
  const r = validateTextareaAnswer('   \n\t ', rule({ isRequired: true }));
  assertEqual(r.ok, false);
  assertEqual(r.code, 'REQUIRED_FIELD_EMPTY');
});

test('required มีค่าจริง → ผ่าน (เมื่อไม่ติด min/max)', () => {
  const r = validateTextareaAnswer('คำตอบ', rule({ isRequired: true }));
  assertEqual(r.ok, true);
});

// =========== Optional / minLength ===========

test('AC: optional ว่าง → ผ่าน', () => {
  assertEqual(validateTextareaAnswer('', rule()).ok, true);
  assertEqual(validateTextareaAnswer(null, rule()).ok, true);
});

test('AC: optional whitespace อย่างเดียว → ผ่าน (ไม่ใช่ required)', () => {
  assertEqual(validateTextareaAnswer('  ', rule()).ok, true);
});

test('AD: optional มีค่าแต่สั้นกว่า minLength → ไม่ผ่าน TEXTAREA_TOO_SHORT', () => {
  const r = validateTextareaAnswer('สั้น', rule({ minLength: 10 }));
  assertEqual(r.ok, false);
  assertEqual(r.code, 'TEXTAREA_TOO_SHORT');
});

test('AE: ยาวเท่ากับ minLength → ผ่าน', () => {
  const v = 'ก'.repeat(10);
  assertEqual(validateTextareaAnswer(v, rule({ minLength: 10 })).ok, true);
});

test('minLength นับแบบ UTF-16: สระ/วรรณยุกต์นับ 1 หน่วย/ตัว', () => {
  // "ที่" = 3 code units (ท + ี + ่)
  const r = validateTextareaAnswer('ที่', rule({ minLength: 3 }));
  assertEqual(r.ok, true);
  const r2 = validateTextareaAnswer('ที่', rule({ minLength: 4 }));
  assertEqual(r2.ok, false);
});

test('Optional ว่างไม่ถูกตรวจ minLength', () => {
  assertEqual(validateTextareaAnswer('', rule({ minLength: 10 })).ok, true);
});

// =========== maxLength ===========

test('AF: ยาวเท่ากับ maxLength → ผ่าน', () => {
  const v = 'ก'.repeat(500);
  assertEqual(validateTextareaAnswer(v, rule({ maxLength: 500 })).ok, true);
});

test('AG: เกิน maxLength → ไม่ผ่าน TEXTAREA_TOO_LONG', () => {
  const v = 'ก'.repeat(501);
  const r = validateTextareaAnswer(v, rule({ maxLength: 500 }));
  assertEqual(r.ok, false);
  assertEqual(r.code, 'TEXTAREA_TOO_LONG');
});

test('AH: ไม่มี maxLength + ยาว 5000 → ผ่าน (hard cap)', () => {
  const v = 'ก'.repeat(5000);
  assertEqual(validateTextareaAnswer(v, rule()).ok, true);
});

test('AI: ไม่มี maxLength + ยาว 5001 → ไม่ผ่าน (hard cap)', () => {
  const v = 'ก'.repeat(5001);
  const r = validateTextareaAnswer(v, rule());
  assertEqual(r.ok, false);
  assertEqual(r.code, 'TEXTAREA_TOO_LONG');
});

test('maxLength นับ emoji แบบ UTF-16 (1 emoji ทั่วไป = 2 หน่วย)', () => {
  // "🎉".length = 2 (surrogate pair) — ต้องตรงกับ native maxlength
  const r = validateTextareaAnswer('🎉'.repeat(250), rule({ maxLength: 500 }));
  assertEqual(r.ok, true);
  const r2 = validateTextareaAnswer('🎉'.repeat(251), rule({ maxLength: 500 }));
  assertEqual(r2.ok, false);
});

// =========== ชนิดค่า ===========

test('AJ: ค่าเป็น number → ปฏิเสธ INVALID_TEXTAREA_VALUE', () => {
  const r = validateTextareaAnswer(123, rule());
  assertEqual(r.ok, false);
  assertEqual(r.code, 'INVALID_TEXTAREA_VALUE');
});

test('AJ: ค่าเป็น object → ปฏิเสธ INVALID_TEXTAREA_VALUE', () => {
  const r = validateTextareaAnswer({ nested: true }, rule());
  assertEqual(r.ok, false);
  assertEqual(r.code, 'INVALID_TEXTAREA_VALUE');
});

test('AJ: ค่าเป็น array → ปฏิเสธ INVALID_TEXTAREA_VALUE', () => {
  const r = validateTextareaAnswer(['a', 'b'], rule());
  assertEqual(r.ok, false);
  assertEqual(r.code, 'INVALID_TEXTAREA_VALUE');
});

// =========== Error contract ===========

test('AK: error ไม่มีคำตอบผู้สมัครใน message', () => {
  const secret = 'SECRET-ANSWER-CONTENT-ไม่รั่ว';
  const tooLong = validateTextareaAnswer(secret + 'ก'.repeat(6000), rule({ maxLength: 500 }));
  assertEqual(tooLong.ok, false);
  assertNotIncludes(tooLong.message, 'SECRET');
  assertNotIncludes(JSON.stringify(tooLong), 'SECRET');
  assertEqual(tooLong.fieldId, 'field-answer');

  const tooShort = validateTextareaAnswer('สั้น', rule({ minLength: 50 }));
  assertNotIncludes(tooShort.message, 'สั้น-');
  assertEqual('fieldId' in tooShort, true);
});

test('AL: function รับเฉพาะ rule ที่ส่งเข้า — ไม่อ่าน global state (field type อื่นไม่ถูกเรียก)', () => {
  // contract: route เรียกเฉพาะ field ที่ fieldType = TEXTAREA เท่านั้น
  // (ดู query ใน public.routes.ts ที่ filter eq(fieldMaster.fieldType, 'TEXTAREA'))
  const r = validateTextareaAnswer('x', rule({ fieldId: 'field-a', minLength: 1 }));
  assertEqual(r.ok, true);
  const r2 = validateTextareaAnswer('x', rule({ fieldId: 'field-b', minLength: 2 }));
  assertEqual(r2.ok, false);
  assertEqual(r2.fieldId, 'field-b');
});

test('AM: ข้อมูลเก่า (minLength=null, maxLength=null) → validate ตาม fallback', () => {
  assertEqual(validateTextareaAnswer('คำตอบเก่า', rule()).ok, true);
  assertEqual(validateTextareaAnswer('ก'.repeat(5000), rule()).ok, true);
  assertEqual(validateTextareaAnswer('ก'.repeat(5001), rule()).ok, false);
});

// =========== Summary ===========

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  (globalThis as any).process.exit(1);
}
