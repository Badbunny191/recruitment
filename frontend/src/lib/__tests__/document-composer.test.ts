/**
 * Document Composer — Frontend Logic Tests
 * -----------------------------------------
 * ครอบคลุม pure logic ฝั่ง Frontend ที่เพิ่มในรอบนี้:
 *   1. field-capabilities (Table Picker filter + MASTER_DATA display)
 *   2. Block factories (ค่าเริ่มต้นของแต่ละ block type)
 *   3. insertAtCursor (แทรก token ณ ตำแหน่งเคอร์เซอร์)
 *   4. buildSystemToken / buildFieldToken (รูปแบบ token)
 *   5. normalizeDateSource (BC ของ legacy dateSource)
 *   6. parseDescriptor (client-side validation รองรับ block type ใหม่)
 *
 * Run: node --import tsx src/lib/__tests__/document-composer.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  getFieldCapability,
  isArrayOfObjects,
  isSingleValueObject,
  isRepeatableField,
  isRepeatableType,
  isScalarFieldType,
  getFieldValueShape,
  getObjectDisplayLabel,
  normalizeFieldType,
} from '../document-composer/field-capabilities';

import {
  INSERTABLE_TOKENS,
  INSERTABLE_TOKEN_LABELS,
  SYSTEM_DATA_LABELS,
  SYSTEM_DATE_KEYS,
  NO_LOGO_TEXT,
  createHeadingBlock,
  createSystemDataBlock,
  createFieldBlock,
  createTableBlock,
  createLogoBlock,
  createSignatureBlock,
  createEmptyDescriptor,
  parseDescriptor,
} from '../api/template-descriptor';

import {
  insertAtCursor,
  buildSystemToken,
  buildFieldToken,
} from '../../app/(admin)/admin/templates/composer/components/InsertDataMenu';

import { normalizeDateSource } from '../../app/(admin)/admin/templates/composer/components/SignatureEditor';

import { NO_REPEATABLE_FIELDS_MESSAGE } from '../../app/(admin)/admin/templates/composer/components/FieldPicker';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg} expected ${e}, got ${a}`);
  }
}

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${v}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg} expected falsy, got ${v}`);
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(`${msg} expected to contain ${JSON.stringify(needle)}`);
  }
}

function assertNotContains(haystack, needle, msg = '') {
  if (typeof haystack === 'string' && haystack.includes(needle)) {
    throw new Error(`${msg} expected NOT to contain ${JSON.stringify(needle)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ============================================================== [1]
console.log('========================================');
console.log('Document Composer — Frontend Logic Tests');
console.log('========================================');

section('[1] field-capabilities — repeatable filter (Table Picker)');

test('REPEATER เป็น repeatable', () => {
  assertTrue(getFieldCapability('REPEATER').isRepeatable, 'REPEATER');
  assertEqual(getFieldCapability('REPEATER').valueShape, 'array');
});

test('TABLE เป็น repeatable', () => {
  assertTrue(getFieldCapability('TABLE').isRepeatable, 'TABLE');
  assertEqual(getFieldCapability('TABLE').valueShape, 'array');
});

test('scalar fields ทั้งหมดไม่ repeatable', () => {
  for (const type of [
    'TEXT',
    'EMAIL',
    'PHONE',
    'NUMBER',
    'TEXTAREA',
    'DATE',
    'FILE',
    'CHECKBOX',
    'DROPDOWN',
    'RADIO',
  ]) {
    const cap = getFieldCapability(type);
    assertFalse(cap.isRepeatable, `${type} must not be repeatable`);
    assertEqual(cap.valueShape, 'scalar', `${type} valueShape`);
  }
});

test('MASTER_DATA แบบค่าเดียวไม่ repeatable (ห้ามเป็น Table)', () => {
  const cap = getFieldCapability('MASTER_DATA');
  assertFalse(cap.isRepeatable, 'MASTER_DATA single must not be repeatable');
  assertEqual(cap.valueShape, 'scalar');
});

test('MASTER_DATA ที่มี object value → valueShape = object, ไม่ repeatable', () => {
  const cap = getFieldCapability('MASTER_DATA', { id: 'x', name: 'สังกัด ก' });
  assertFalse(cap.isRepeatable, 'object value must not be repeatable');
  assertEqual(cap.valueShape, 'object');
  assertContains(String(cap.reason), 'object');
});

test('MASTER_DATA ที่มี array value → repeatable (multi-select)', () => {
  const cap = getFieldCapability('MASTER_DATA', [
    { id: 'a', name: 'ก' },
    { id: 'b', name: 'ข' },
  ]);
  assertTrue(cap.isRepeatable, 'array value should be repeatable');
  assertEqual(cap.valueShape, 'array');
});

test('unknown type → safe default scalar', () => {
  const cap = getFieldCapability('SOMETHING_NEW');
  assertFalse(cap.isRepeatable, 'unknown should default to scalar');
  assertEqual(cap.valueShape, 'scalar');
  assertTrue(!!cap.reason, 'should have reason');
});

test('type เป็น null/undefined → scalar', () => {
  assertFalse(getFieldCapability(null).isRepeatable, 'null');
  assertFalse(getFieldCapability(undefined).isRepeatable, 'undefined');
});

test('normalizeFieldType maps lowercase / unknown', () => {
  assertEqual(normalizeFieldType('repeater'), 'REPEATER');
  assertEqual(normalizeFieldType('master_data'), 'MASTER_DATA');
  assertEqual(normalizeFieldType('???'), 'UNKNOWN');
  assertEqual(normalizeFieldType(null), 'UNKNOWN');
});

test('isRepeatableType / isScalarFieldType helpers', () => {
  assertTrue(isRepeatableType('TABLE'));
  assertFalse(isRepeatableType('TEXT'));
  assertTrue(isScalarFieldType('MASTER_DATA'));
  assertFalse(isScalarFieldType('REPEATER'));
});

test('isRepeatableField ใช้ value เป็น override', () => {
  assertTrue(isRepeatableField('TEXT', [{ a: 1 }]));
  assertFalse(isRepeatableField('REPEATER', { a: 1 }) === false);
});

section('[2] field-capabilities — MASTER_DATA display (ไม่ JSON ดิบ)');

test('getObjectDisplayLabel ใช้ name ก่อน', () => {
  assertEqual(
    getObjectDisplayLabel({ id: 'x', name: 'สังกัดปัจจุบัน', label: 'LABEL' }),
    'สังกัดปัจจุบัน'
  );
});

test('getObjectDisplayLabel fallback ไป label', () => {
  assertEqual(getObjectDisplayLabel({ id: 'x', label: 'LABEL' }), 'LABEL');
});

test('getObjectDisplayLabel fallback ไป id', () => {
  assertEqual(getObjectDisplayLabel({ id: 'x-42' }), 'x-42');
});

test('getObjectDisplayLabel ไม่ stringify object (คืน "—" เมื่อไม่มี field ที่อ่านได้)', () => {
  const result = getObjectDisplayLabel({ foo: 'bar', baz: 1 });
  assertEqual(result, '—');
  assertNotContains(result, '{');
  assertNotContains(result, 'foo');
});

test('getObjectDisplayLabel ตัดช่องว่าง', () => {
  assertEqual(getObjectDisplayLabel({ name: '  สังกัด  ' }), 'สังกัด');
});

test('isSingleValueObject / isArrayOfObjects', () => {
  assertTrue(isSingleValueObject({ id: 1 }), 'object');
  assertFalse(isSingleValueObject([1]), 'array');
  assertFalse(isSingleValueObject(null), 'null');
  assertTrue(isArrayOfObjects([{ a: 1 }, { b: 2 }]), 'array of objects');
  assertFalse(isArrayOfObjects(['a', 'b']), 'array of primitives');
  assertFalse(isArrayOfObjects([]), 'empty array');
});

test('getFieldValueShape', () => {
  assertEqual(getFieldValueShape([1]), 'array');
  assertEqual(getFieldValueShape({ a: 1 }), 'object');
  assertEqual(getFieldValueShape('x'), 'scalar');
  assertEqual(getFieldValueShape(null), 'scalar');
});

section('[3] Token vocabulary (mirror backend)');

test('INSERTABLE_TOKENS ตรงกับ backend (ไม่มี POSITION_LEVEL / ROUND_CODE)', () => {
  assertDeepEqual([...INSERTABLE_TOKENS], [
    'APPLICATION_NO',
    'ROUND_NAME',
    'APPLICATION_DATE',
    'PRINT_DATE',
    'POSITION_NAME',
  ]);
  assertFalse(INSERTABLE_TOKENS.includes('POSITION_LEVEL'), 'no POSITION_LEVEL');
  assertFalse(INSERTABLE_TOKENS.includes('ROUND_CODE'), 'no ROUND_CODE');
});

test('ทุก insertable token มี label', () => {
  for (const t of INSERTABLE_TOKENS) {
    assertTrue(!!INSERTABLE_TOKEN_LABELS[t], `label for ${t}`);
  }
});

test('SYSTEM_DATA_LABELS ครอบคลุมทุก key', () => {
  assertEqual(SYSTEM_DATA_LABELS.APPLICATION_NO, 'เลขที่ใบสมัคร');
  assertEqual(SYSTEM_DATA_LABELS.ROUND_NAME, 'ชื่อรอบการสมัคร');
  assertEqual(SYSTEM_DATE_KEYS.length, 2);
  assertTrue(SYSTEM_DATE_KEYS.includes('APPLICATION_DATE'));
  assertTrue(SYSTEM_DATE_KEYS.includes('PRINT_DATE'));
});

test('NO_LOGO_TEXT ตรงตาม Requirement D', () => {
  assertEqual(NO_LOGO_TEXT, 'ยังไม่มีโลโก้');
});

section('[4] Token builders + insertAtCursor');

test('buildSystemToken สร้างรูป {TOKEN}', () => {
  assertEqual(buildSystemToken('ROUND_NAME'), '{ROUND_NAME}');
  assertEqual(buildSystemToken('APPLICATION_NO'), '{APPLICATION_NO}');
});

test('buildFieldToken ใช้ fieldId (stable mapping key) ไม่ใช่ label', () => {
  assertEqual(buildFieldToken('abc-123'), '{FIELD:abc-123}');
});

test('insertAtCursor แทรกท้ายเมื่อ cursor = ความยาว', () => {
  const before = 'รอบการสมัคร';
  const r = insertAtCursor(before, before.length, '{ROUND_NAME}');
  assertEqual(r.text, 'รอบการสมัคร{ROUND_NAME}');
  assertEqual(r.caret, before.length + '{ROUND_NAME}'.length);
});

test('insertAtCursor แทรกกลางข้อความ ณ ตำแหน่งเคอร์เซอร์', () => {
  const before = 'ใบสมัครรอบ';
  const r = insertAtCursor(before, before.length, '{ROUND_NAME}');
  assertEqual(r.text, 'ใบสมัครรอบ{ROUND_NAME}');
  assertEqual(r.caret, before.length + '{ROUND_NAME}'.length);

  // แทรกกลางจริง ๆ (ก่อนคำสุดท้าย)
  const mid = before.length - 1;
  const r2 = insertAtCursor(before, mid, '{ROUND_NAME}');
  assertEqual(r2.text, `ใบสมัครรอ{ROUND_NAME}บ`);
  assertEqual(r2.caret, mid + '{ROUND_NAME}'.length);
});

test('insertAtCursor รักษาหลายบรรทัดเดิม', () => {
  const before = 'บรรทัดแรก\nบรรทัดสอง\nบรรทัดสาม';
  // วางเคอร์เซอร์ท้ายบรรทัดแรก (ก่อน newline)
  const r = insertAtCursor(before, before.indexOf('\n'), '{APPLICATION_NO}');
  assertEqual(r.text, 'บรรทัดแรก{APPLICATION_NO}\nบรรทัดสอง\nบรรทัดสาม');
  assertEqual(r.text.split(/\r?\n/).length, 3, 'ต้องยังมี 3 บรรทัด');
  assertEqual(r.caret, before.indexOf('\n') + '{APPLICATION_NO}'.length);
});

test('insertAtCursor ข้อความว่าง', () => {
  const r = insertAtCursor('', 0, '{ROUND_NAME}');
  assertEqual(r.text, '{ROUND_NAME}');
  assertEqual(r.caret, 12);
});

test('insertAtCursor ป้องกัน cursor เพี้ยน (เกินความยาว / NaN / ติดลบ)', () => {
  // เกินความยาว → clamp ท้ายสุด
  assertEqual(insertAtCursor('abc', 999, 'X').text, 'abcX');
  assertEqual(insertAtCursor('abc', 999, 'X').caret, 4);
  // NaN → ถือว่าท้ายสุด (ปลอดภัย ไม่ทำให้ข้อความหาย)
  assertEqual(insertAtCursor('abc', NaN, 'X').text, 'abcX');
  // ติดลบ → ถือว่าท้ายสุด
  assertEqual(insertAtCursor('abc', -5, 'X').text, 'abcX');
  // เลขทศนิยม → floor
  assertEqual(insertAtCursor('abc', 1.7, 'X').text, 'aXbc');
  // undefined
  assertEqual(insertAtCursor('abc', undefined, 'X').text, 'abcX');
});

test('insertAtCursor ข้อความผสม token + ข้อความธรรมดา', () => {
  const text = 'ใบสมัครรอบ {ROUND_NAME}\nชื่อ {FIELD:abc}';
  const r = insertAtCursor(text, text.length, ' เพิ่มเติม');
  assertContains(r.text, '{ROUND_NAME}');
  assertContains(r.text, '{FIELD:abc}');
  assertTrue(r.text.endsWith(' เพิ่มเติม'));
});

section('[5] Block factories (default values)');

test('createHeadingBlock มี textarea-compatible text + defaults', () => {
  const b = createHeadingBlock();
  assertEqual(b.type, 'heading');
  assertEqual(typeof b.text, 'string');
  assertEqual(b.size, 'medium');
  assertEqual(b.bold, false);
  assertEqual(b.italic, false);
  assertTrue(!!b.id, 'ต้องมี id');
});

test('createHeadingBlock overrides ได้', () => {
  const b = createHeadingBlock({ text: 'X', size: 'large', italic: true });
  assertEqual(b.text, 'X');
  assertEqual(b.size, 'large');
  assertEqual(b.italic, true);
});

test('createSystemDataBlock มี key + layout + dateFormat เฉพาะ key วันที่', () => {
  const no = createSystemDataBlock('APPLICATION_NO');
  assertEqual(no.type, 'systemData');
  assertEqual(no.key, 'APPLICATION_NO');
  assertEqual(no.layout, 'inline');
  assertEqual(no.dateFormat, undefined, 'ไม่ใช่ key วันที่ → ไม่ต้องมี dateFormat');

  const date = createSystemDataBlock('APPLICATION_DATE');
  assertEqual(date.dateFormat, 'thai_long', 'key วันที่ → ต้องมี dateFormat');
});

test('createFieldBlock / createTableBlock ใช้ fieldId', () => {
  const f = createFieldBlock('fld-1');
  assertEqual(f.type, 'field');
  assertEqual(f.fieldId, 'fld-1');
  assertEqual(f.showLabel, true);
  assertEqual(f.showRequired, true);
  assertEqual(f.layout, 'stacked');
  assertEqual(f.valueStyle, 'medium');

  const t = createTableBlock('fld-2');
  assertEqual(t.type, 'table');
  assertEqual(t.fieldId, 'fld-2');
  assertEqual(t.showLabel, true);
});

test('createLogoBlock default = organization + width 70', () => {
  const l = createLogoBlock();
  assertEqual(l.type, 'logo');
  assertEqual(l.source, 'organization');
  assertEqual(l.width, 70);
  assertEqual(l.height, undefined, 'height default = auto');
});

test('createLogoBlock รองรับ none / upload', () => {
  assertEqual(createLogoBlock({ source: 'none' }).source, 'none');
  assertEqual(createLogoBlock({ source: 'upload' }).source, 'upload');
});

test('createSignatureBlock มี option ครบตาม Requirement C', () => {
  const s = createSignatureBlock();
  assertEqual(s.type, 'signature');
  assertEqual(s.lineLabel, 'ลงลายมือชื่อ');
  assertEqual(s.roleLabel, 'ผู้สมัคร');
  assertEqual(s.dateLabel, 'วันที่');
  assertEqual(s.dateSource, 'APPLICATION_DATE');
  assertEqual(s.showName, true);
  assertEqual(s.showParentheses, true);
  assertEqual(s.showDate, true);
  assertEqual(s.showTime, false);
  assertContains(s.lineStyle, '.');
  assertEqual(s.nameFieldId, undefined, 'ไม่บังคับต้องระบุ');
});

test('createSignatureBlock รองรับ nameFieldId + dateSource variants', () => {
  assertEqual(createSignatureBlock({ nameFieldId: 'f-9' }).nameFieldId, 'f-9');
  assertEqual(createSignatureBlock({ dateSource: 'PRINT_DATE' }).dateSource, 'PRINT_DATE');
  assertEqual(createSignatureBlock({ dateSource: 'none' }).dateSource, 'none');
});

test('block id ไม่ซ้ำกัน', () => {
  const ids = new Set(
    Array.from({ length: 30 }, () => createHeadingBlock().id)
  );
  assertEqual(ids.size, 30, 'id ต้อง unique');
});

section('[6] normalizeDateSource (backward compatibility)');

test('undefined → APPLICATION_DATE (ค่า default)', () => {
  assertEqual(normalizeDateSource(undefined), 'APPLICATION_DATE');
});

test('legacy "application" → APPLICATION_DATE', () => {
  assertEqual(normalizeDateSource('application'), 'APPLICATION_DATE');
});

test('ค่าใหม่ผ่านตามเดิม', () => {
  assertEqual(normalizeDateSource('APPLICATION_DATE'), 'APPLICATION_DATE');
  assertEqual(normalizeDateSource('PRINT_DATE'), 'PRINT_DATE');
  assertEqual(normalizeDateSource('none'), 'none');
});

section('[7] Table Picker empty state');

test('ข้อความ empty state ตรงตาม Requirement G', () => {
  assertEqual(
    NO_REPEATABLE_FIELDS_MESSAGE,
    'Template Version นี้ยังไม่มีฟิลด์แบบหลายรายการ'
  );
});

section('[8] parseDescriptor (client validation)');

test('descriptor เก่า (block พื้นฐาน) ยังผ่าน', () => {
  const r = parseDescriptor(
    JSON.stringify({
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'T', size: 'medium' },
        { id: 'l1', type: 'logo' },
        { id: 's1', type: 'signature' },
      ],
    })
  );
  assertTrue(r.ok, 'descriptor เก่าต้องผ่าน');
});

test('block type ใหม่ (systemData) ผ่าน', () => {
  const r = parseDescriptor(
    JSON.stringify({
      version: 1,
      blocks: [
        {
          id: 'sd1',
          type: 'systemData',
          key: 'ROUND_NAME',
          layout: 'inline',
        },
      ],
    })
  );
  assertTrue(r.ok, 'systemData ต้องผ่าน: ' + JSON.stringify(r.issues));
});

test('descriptor ครบ 6 block type ใหม่ ผ่าน', () => {
  const r = parseDescriptor(
    JSON.stringify({
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'T', size: 'medium', italic: true },
        { id: 'sd1', type: 'systemData', key: 'APPLICATION_NO' },
        { id: 'f1', type: 'field', fieldId: 'fld', showLabel: false },
        { id: 't1', type: 'table', fieldId: 'rep', emptyText: 'ยังไม่มี' },
        { id: 'l1', type: 'logo', source: 'none', width: 70 },
        {
          id: 's1',
          type: 'signature',
          lineLabel: 'ลงชื่อ',
          dateSource: 'PRINT_DATE',
          showParentheses: false,
        },
      ],
    })
  );
  assertTrue(r.ok, 'ทุก block type ต้องผ่าน: ' + JSON.stringify(r.issues));
});

test('block type ไม่รู้จัก → ต้อง fail', () => {
  const r = parseDescriptor(
    JSON.stringify({
      version: 1,
      blocks: [{ id: 'x1', type: 'wat', text: 'T', size: 'medium' }],
    })
  );
  assertFalse(r.ok, 'block type แปลกต้องต้อง fail');
});

test('version ผิด → ต้อง fail', () => {
  const r = parseDescriptor(
    JSON.stringify({ version: 2, blocks: [{ id: 'h1', type: 'heading', text: 'T', size: 'medium' }] })
  );
  assertFalse(r.ok, 'version 2 ต้อง fail');
});

test('createEmptyDescriptor ใช้ได้', () => {
  assertEqual(createEmptyDescriptor().version, 1);
  assertEqual(createEmptyDescriptor().blocks.length, 0);
});

// ========== SUMMARY ==========

console.log('\n=== Summary ===\n');
console.log(`Total: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}

if (failed > 0) {
  process.exit(1);
}