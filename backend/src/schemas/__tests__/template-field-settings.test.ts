/**
 * Template Field Settings Validation Tests (Builder-side, Zod)
 * =======================================================================
 *
 * ครอบคลุมเทียบรายการ E–N ของ spec:
 *   E. rows = 1 ผ่าน
 *   F. rows = 20 ผ่าน
 *   G. rows = 0 ไม่ผ่าน
 *   H. rows = 21 ไม่ผ่าน
 *   I. maxLength = 1 ผ่าน
 *   J. maxLength = 5000 ผ่าน
 *   K. maxLength = 5001 ไม่ผ่าน
 *   L. minLength > maxLength ไม่ผ่าน
 *   M. minLength <= maxLength ผ่าน
 *   N. ค่า null/undefined ผ่านตาม contract
 *
 * รัน: node --import tsx src/schemas/__tests__/template-field-settings.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import {
  TemplateFieldCreateSchema,
  TemplateVersionCreateSchema,
  TEXTAREA_ROWS_MIN,
  TEXTAREA_ROWS_MAX,
  TEXTAREA_LENGTH_CAP,
} from '../validators';

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

function field(overrides = {}) {
  return {
    fieldId: 'field-1',
    displayOrder: 1,
    ...overrides,
  };
}

function issuesOf(schema, data) {
  const r = schema.safeParse(data);
  return r.success ? [] : r.error.issues;
}

function hasMessage(issues, needle) {
  return issues.some((i) => (i.message || '').includes(needle));
}

// =========== rows ===========

test(`E: rows = ${TEXTAREA_ROWS_MIN} ผ่าน`, () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ rows: 1 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test(`F: rows = ${TEXTAREA_ROWS_MAX} ผ่าน`, () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ rows: 20 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test('G: rows = 0 ไม่ผ่าน + ข้อความไทยระบุช่วง', () => {
  const issues = issuesOf(TemplateFieldCreateSchema, field({ rows: 0 }));
  assertEqual(issues.length > 0, true);
  assertEqual(hasMessage(issues, 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด'), true);
});

test('H: rows = 21 ไม่ผ่าน + ข้อความไทยระบุช่วง', () => {
  const issues = issuesOf(TemplateFieldCreateSchema, field({ rows: 21 }));
  assertEqual(issues.length > 0, true);
  assertEqual(hasMessage(issues, 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด'), true);
});

test('rows ทศนิยมไม่ผ่าน', () => {
  assertEqual(TemplateFieldCreateSchema.safeParse(field({ rows: 2.5 })).success, false);
});

// =========== maxLength ===========

test('I: maxLength = 1 ผ่าน', () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ maxLength: 1 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test(`J: maxLength = ${TEXTAREA_LENGTH_CAP} ผ่าน`, () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ maxLength: 5000 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test('K: maxLength = 5001 ไม่ผ่าน + ข้อความไทยระบุ cap', () => {
  const issues = issuesOf(TemplateFieldCreateSchema, field({ maxLength: 5001 }));
  assertEqual(issues.length > 0, true);
  assertEqual(hasMessage(issues, 'ความยาวสูงสุดต้องไม่เกิน 5,000 ตัวอักษร'), true);
});

// =========== minLength + consistency ===========

test('M: minLength <= maxLength ผ่าน', () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ minLength: 10, maxLength: 500 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test('M: minLength == maxLength ผ่าน', () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ minLength: 500, maxLength: 500 }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test('L: minLength > maxLength ไม่ผ่าน + ข้อความไทย', () => {
  const issues = issuesOf(TemplateFieldCreateSchema, field({ minLength: 600, maxLength: 500 }));
  assertEqual(issues.length > 0, true);
  assertEqual(hasMessage(issues, 'ความยาวขั้นต่ำต้องไม่มากกว่าความยาวสูงสุด'), true);
});

test('minLength ไม่มี maxLength → เทียบกับ hard cap 5000', () => {
  assertEqual(TemplateFieldCreateSchema.safeParse(field({ minLength: 5000 })).success, true);
  const issues = issuesOf(TemplateFieldCreateSchema, field({ minLength: 5001 }));
  assertEqual(issues.length > 0, true);
});

test('minLength = 0 ผ่าน', () => {
  assertEqual(TemplateFieldCreateSchema.safeParse(field({ minLength: 0 })).success, true);
});

// =========== null/undefined contract ===========

test('N: ค่า null ผ่าน (contract เดิม)', () => {
  const r = TemplateFieldCreateSchema.safeParse(field({ rows: null, minLength: null, maxLength: null }));
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

test('N: ไม่ส่งค่า (undefined) ผ่าน (ข้อมูลเก่า)', () => {
  const r = TemplateFieldCreateSchema.safeParse(field());
  assertEqual(r.success, true, JSON.stringify(r.error?.issues));
});

// =========== .extend variant (TemplateVersionCreateSchema) — regression ===========

test('TemplateVersionCreateSchema (extend variant) ยัง enforce settings เดียวกัน', () => {
  const bad = TemplateVersionCreateSchema.safeParse({
    templateId: 't1',
    fields: [field({ rows: 999 })],
  });
  assertEqual(bad.success, false);

  const good = TemplateVersionCreateSchema.safeParse({
    templateId: 't1',
    fields: [field({ rows: 5, minLength: 10, maxLength: 500 })],
  });
  assertEqual(good.success, true, JSON.stringify(good.error?.issues));
});

test('TemplateVersionCreateSchema (extend variant) ยัง cross-check min<=max', () => {
  const bad = TemplateVersionCreateSchema.safeParse({
    templateId: 't1',
    fields: [field({ minLength: 999, maxLength: 100 })],
  });
  assertEqual(bad.success, false);
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
