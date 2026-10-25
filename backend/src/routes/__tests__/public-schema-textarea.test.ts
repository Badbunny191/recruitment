/**
 * Public Round Schema — Rich Field Metadata Contract Tests
 * =======================================================================
 *
 * ตรวจว่า loadPublicRoundSchemaFields (query เดียวกับ GET /public/rounds/:id/schema)
 * ส่ง rows / minLength / maxLength ของ TEXT/TEXTAREA ครบและคง nullability
 *
 * ครอบคลุมเทียบรายการ A–D ของ spec:
 *   A. TEXTAREA ที่มี rows/minLength/maxLength → ถูกส่งครบ
 *   B. ค่า null → ส่งเป็น null (ไม่แปลงเป็น default — client เป็นคน fallback)
 *   C. Field type อื่น (TEXT/FILE/DROPDOWN) → ไม่ regression (property ยังครบเดิม)
 *   D. ไม่เปิดเผยข้อมูล Admin-only (pdfMappingKey, validationRules ฯลฯ)
 *
 * รัน: node --import tsx src/routes/__tests__/public-schema-textarea.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { loadPublicRoundSchemaFields } from '../public.routes';

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

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg);
}

// ── Setup: in-memory sqlite + ตารางที่ query นี้ใช้ (โครงสร้างตรงตาม schema.ts) ──
const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE field_master (
    id TEXT PRIMARY KEY,
    field_type TEXT NOT NULL,
    label_th TEXT NOT NULL,
    default_options TEXT,
    pdf_mapping_key TEXT,
    section TEXT,
    help_text TEXT,
    placeholder TEXT,
    validation_type TEXT,
    validation_message TEXT,
    file_config TEXT,
    allow_other INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    section_id TEXT,
    display_order INTEGER NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 1,
    override_options TEXT,
    override_label_th TEXT,
    help_text TEXT,
    placeholder TEXT,
    validation_rules TEXT,
    rows INTEGER,
    min_length INTEGER,
    max_length INTEGER,
    validation_message TEXT,
    allow_other INTEGER
  );
  CREATE TABLE template_sections (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  );
`);

const db = drizzle(sqlite, { schema });
const VERSION_ID = 'tv-1';

let fields: any[] = [];

const insertMaster = sqlite.prepare(`
  INSERT INTO field_master (id, field_type, label_th, allow_other)
  VALUES (?, ?, ?, 0)
`);
const insertField = sqlite.prepare(`
  INSERT INTO template_fields (
    id, template_version_id, field_id, display_order, is_required,
    rows, min_length, max_length
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// Field settings เต็ม: TEXTAREA rows=5, min=10, max=500
insertMaster.run('f-textarea', 'TEXTAREA', 'คำตอบ TEXTAREA');
insertField.run('tf-1', VERSION_ID, 'f-textarea', 1, 1, 5, 10, 500);
// Field เก่า: ไม่มี settings (null ทั้งแถว)
insertMaster.run('f-textarea-old', 'TEXTAREA', 'คำตอบ TEXTAREA เก่า');
insertField.run('tf-2', VERSION_ID, 'f-textarea-old', 2, 1, null, null, null);
// Field type อื่น
insertMaster.run('f-text', 'TEXT', 'ชื่อเล่น');
insertField.run('tf-3', VERSION_ID, 'f-text', 3, 1, null, null, null);
insertMaster.run('f-file', 'FILE', 'ไฟล์แนบ');
insertField.run('tf-4', VERSION_ID, 'f-file', 4, 0, null, null, null);
insertMaster.run('f-dropdown', 'DROPDOWN', 'ระดับการศึกษา');
insertField.run('tf-5', VERSION_ID, 'f-dropdown', 5, 1, null, null, null);

sqlite.prepare(`
  INSERT INTO template_sections (id, template_version_id, name, display_order, is_active)
  VALUES ('sec-1', ?, 'ข้อมูลทั่วไป', 1, 1)
`).run(VERSION_ID);

// ทั้ง run block ครอบด้วย async IIFE (repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {
const { fields: loadedFields } = await loadPublicRoundSchemaFields(db, VERSION_ID);
fields = loadedFields;

function byFieldId(id) {
  return fields.find((f) => f.fieldId === id);
}

// =========== A: settings ถูกส่งครบ ===========

test('A: TEXTAREA ที่ตั้งค่าครบ → rows/minLength/maxLength ถูกส่งถูกค่า', () => {
  const f = byFieldId('f-textarea');
  assertTrue(f, 'field หาย');
  assertEqual(f.rows, 5);
  assertEqual(f.minLength, 10);
  assertEqual(f.maxLength, 500);
});

// =========== B: null คง null ===========

test('B: ค่าที่ไม่ได้ตั้ง → ส่ง null (ไม่แปลงเป็น default ฝั่ง server)', () => {
  const f = byFieldId('f-textarea-old');
  assertTrue(f, 'field หาย');
  assertEqual(f.rows, null);
  assertEqual(f.minLength, null);
  assertEqual(f.maxLength, null);
});

// =========== C: field type อื่นไม่ regression ===========

test('C: property เดิมยังครบทุก field (label/options/isRequired/helpText ฯลฯ)', () => {
  const legacyKeys = [
    'fieldId', 'sectionId', 'type', 'label', 'overrideLabel', 'options',
    'overrideOptions', 'allowOther', 'isRequired', 'helpText', 'placeholder',
    'validationMessage', 'section', 'fileConfig', 'validationType', 'order',
  ];
  for (const f of fields) {
    for (const k of legacyKeys) {
      assertTrue(k in f, `field ${f.fieldId} ขาด property "${k}"`);
    }
  }
});

test('C: TEXT/FILE/DROPDOWN ยังส่งปกติ (type/label/isRequired)', () => {
  const text = byFieldId('f-text');
  assertEqual(text.type, 'TEXT');
  assertEqual(text.label, 'ชื่อเล่น');
  assertEqual(text.isRequired, true);

  const file = byFieldId('f-file');
  assertEqual(file.type, 'FILE');
  assertEqual(file.isRequired, false);

  const dropdown = byFieldId('f-dropdown');
  assertEqual(dropdown.type, 'DROPDOWN');
});

test('C: field type อื่นก็ส่ง rows/min/maxLength = null ได้ (ไม่พัง)', () => {
  const text = byFieldId('f-text');
  assertEqual(text.rows, null);
  assertEqual(text.minLength, null);
  assertEqual(text.maxLength, null);
});

// =========== D: ไม่เปิดเผย admin-only data ===========

test('D: ไม่มี admin-only keys ใน response (pdfMappingKey, validationRules ฯลฯ)', () => {
  const adminOnlyKeys = [
    'pdfMappingKey', 'pdf_mapping_key', 'validationRules', 'validation_rules',
    'isActive', 'defaultOptionsRaw',
  ];
  for (const f of fields) {
    for (const k of adminOnlyKeys) {
      assertTrue(!(k in f), `field ${f.fieldId} เปิดเผย admin-only key "${k}"`);
    }
  }
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
})();
