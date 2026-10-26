/**
 * Template Version dropdown (Create/Edit Round) tests
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/template-version-options.test.ts
 *
 * ครอบคลุม:
 *   - pickLatestPublishedPerTemplate: เลือก Published ล่าสุดของแต่ละ template
 *     + ตัด version เก่าของ template เดียวกันออก
 *     + template คนละตัวยังอยู่ครบ
 *     + ไม่แก้ array ต้นฉบับ
 *     + array ว่าง → ว่าง
 *     + tie-break versionNumber เท่ากัน → createdAt ใหม่กว่าชนะ
 *   - buildTemplateVersionOptions: โหมด Edit คง version ที่รอบใช้อยู่ไว้
 *     + version ปัจจุบันถูก unpublish → ยังแสดง (fallback จากข้อมูลรอบ)
 *   - formatTemplateVersionOptionLabel
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  pickLatestPublishedPerTemplate,
  buildTemplateVersionOptions,
  formatTemplateVersionOptionLabel,
} from '../template-version-options';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err && err.message ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.error(`✗ ${name}`);
    console.error(`  ${msg}`);
  }
}

function eq(actual, expected, note = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${note} expected ${e}, got ${a}`);
  }
}

const v = (
  id: string,
  templateId: string,
  templateName: string,
  versionNumber: number,
  extra: any = {}
) => ({
  id,
  versionNumber,
  status: 'PUBLISHED',
  templateId,
  templateName,
  ...extra,
});

// ─────────────────────────────────────────────────────────────
// pickLatestPublishedPerTemplate
// ─────────────────────────────────────────────────────────────

test('เลือก Published ล่าสุดของแต่ละ template — ตัด v2/v3/v4 ทิ้ง', () => {
  const input = [
    v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2),
    v('a3', 'tpl-a', 'เชี่ยวชาญ 2569', 3),
    v('a4', 'tpl-a', 'เชี่ยวชาญ 2569', 4),
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
    v('b3', 'tpl-b', 'ชำนาญการพิเศษ 2569', 3),
  ];

  const result = pickLatestPublishedPerTemplate(input);
  eq(result.map((x) => x.id), ['b3', 'a5'], 'เรียงตาม templateName');
  eq(result.map((x) => x.versionNumber), [3, 5]);
});

test('template คนละตัวยังอยู่ครบทุกตัว', () => {
  const input = [
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
    v('b3', 'tpl-b', 'ชำนาญการพิเศษ 2569', 3),
    v('c1', 'tpl-c', 'ปฏิบัติการ 2569', 1),
  ];
  eq(pickLatestPublishedPerTemplate(input).length, 3);
});

test('ไม่แก้ array ต้นฉบับ (pure function)', () => {
  const input = [
    v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2),
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
  ];
  const snapshot = JSON.stringify(input);
  pickLatestPublishedPerTemplate(input);
  eq(JSON.stringify(input), snapshot);
});

test('array ว่าง → ผลลัพธ์ว่าง', () => {
  eq(pickLatestPublishedPerTemplate([]), []);
});

test('versionNumber เท่ากัน → createdAt ใหม่กว่าชนะ', () => {
  const input = [
    v('x1', 'tpl-a', 'เชี่ยวชาญ 2569', 5, { createdAt: 1000 }),
    v('x2', 'tpl-a', 'เชี่ยวชาญ 2569', 5, { createdAt: 2000 }),
  ];
  eq(pickLatestPublishedPerTemplate(input).map((x) => x.id), ['x2']);
});

test('versionNumber เท่ากันและไม่มี createdAt → id มากกว่าชนะ (deterministic)', () => {
  const input = [
    v('x1', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
    v('x2', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
  ];
  eq(pickLatestPublishedPerTemplate(input).map((x) => x.id), ['x2']);
});

test('ข้ามรายการที่ข้อมูลไม่ครบ (ไม่มี templateId / id)', () => {
  const input = [
    { id: '', versionNumber: 9, status: 'PUBLISHED', templateId: 'tpl-a', templateName: 'X' },
    { id: 'z', versionNumber: 9, status: 'PUBLISHED', templateId: '', templateName: 'X' },
    v('ok', 'tpl-b', 'ชำนาญการพิเศษ 2569', 3),
  ];
  eq(pickLatestPublishedPerTemplate(input).map((x) => x.id), ['ok']);
});

// ─────────────────────────────────────────────────────────────
// buildTemplateVersionOptions
// ─────────────────────────────────────────────────────────────

test('โหมด Create (ไม่มี selected) → เฉพาะตัวล่าสุดของแต่ละ template', () => {
  const input = [
    v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2),
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
    v('b3', 'tpl-b', 'ชำนาญการพิเศษ 2569', 3),
  ];
  eq(buildTemplateVersionOptions(input, null).map((x) => x.id), ['b3', 'a5']);
});

test('โหมด Edit: version ที่รอบใช้อยู่คือตัวล่าสุด → ไม่เพิ่มซ้ำ', () => {
  const input = [
    v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2),
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
  ];
  eq(buildTemplateVersionOptions(input, 'a5').map((x) => x.id), ['a5']);
});

test('โหมด Edit: รอบเก่าผูกกับ v2 → v2 ยังอยู่ใน dropdown (กัน submit เปลี่ยน template เงียบ ๆ)', () => {
  const input = [
    v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2),
    v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5),
  ];
  const result = buildTemplateVersionOptions(input, 'a2');
  eq(result.map((x) => x.id), ['a2', 'a5']);
  eq(result[0].templateName, 'เชี่ยวชาญ 2569');
});

test('โหมด Edit: version ปัจจุบันถูก unpublish → ยังแสดงจากข้อมูลรอบ', () => {
  const input = [v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5)];
  const result = buildTemplateVersionOptions(input, 'a2', {
    templateName: 'เชี่ยวชาญ 2569',
    versionNumber: 2,
  });
  eq(result.map((x) => x.id), ['a2', 'a5']);
  eq(result[0].versionNumber, 2);
});

test('โหมด Edit: version ปัจจุบันถูก unpublish และไม่มี metadata → ไม่เพิ่ม option ปลอม', () => {
  const input = [v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5)];
  const result = buildTemplateVersionOptions(input, 'a2', null);
  eq(result.map((x) => x.id), ['a5']);
});

test('โหมด Edit: version ปัจจุบันไม่มีในรายการเลย → ไม่ crash', () => {
  const input = [v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5)];
  const result = buildTemplateVersionOptions(input, 'missing-id');
  eq(result.map((x) => x.id), ['a5']);
});

// ─────────────────────────────────────────────────────────────
// formatTemplateVersionOptionLabel
// ─────────────────────────────────────────────────────────────

test('label ปกติ → "ชื่อ template vN"', () => {
  eq(
    formatTemplateVersionOptionLabel(v('a5', 'tpl-a', 'เชี่ยวชาญ 2569', 5)),
    'เชี่ยวชาญ 2569 v5'
  );
});

test('label เวลารอบใช้ version ที่ไม่ใช่ตัวล่าสุด → เติมกำกับ', () => {
  eq(
    formatTemplateVersionOptionLabel(v('a2', 'tpl-a', 'เชี่ยวชาญ 2569', 2), true),
    'เชี่ยวชาญ 2569 v2 (เวอร์ชันที่รอบใช้อยู่)'
  );
});

// ─────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`ผ่าน ${passed} | ไม่ผ่าน ${failed}`);
if (failed > 0) {
  console.error('\nรายการที่ไม่ผ่าน:');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('✅ ผ่านทั้งหมด');
