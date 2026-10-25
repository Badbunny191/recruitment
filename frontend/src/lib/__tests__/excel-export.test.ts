/**
 * Excel Export helper tests (frontend)
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/excel-export.test.ts
 *
 * ครอบคลุม:
 *   - parseContentDispositionFilename: ถอดชื่อไฟล์จาก header ที่ backend
 *     สร้างจริง (filename= ASCII fallback + filename*=UTF-8'' ชื่อไทย)
 *   - Selection helpers: checkbox ระดับหน้าปัจจุบัน + selection ข้ามหน้า
 *
 * พฤติกรรม header ต้องสอดคล้องกับ backend/src/routes/excel-export.routes.ts
 * (contentDispositionAttachment) และชุด test excel-export.service.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  parseContentDispositionFilename,
  DEFAULT_EXPORT_FILENAME,
  areAllPageSelected,
  isPagePartiallySelected,
  togglePageSelection,
} from '../excel-export';

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
function assertTrue(cond: any, msg = '') { if (!cond) throw new Error(msg || 'Expected true'); }
function assertFalse(cond: any, msg = '') { assertTrue(!cond, msg || 'Expected false'); }

// ตัวอย่าง header ที่ backend สร้างจริง (จาก excel-export.service.test.ts)
const THAI_NAME = 'ใบสมัคร-รอบทดสอบ export-20261025-1155.xlsx';
const THAI_DISPOSITION =
  `attachment; filename="TST01-20261025-1155.xlsx"; filename*=UTF-8''${encodeURIComponent(THAI_NAME)}`;

// ═══════════════ Parser: Content-Disposition ═══════════════

test('AL/I: filename* (UTF-8 RFC 5987) ชนะ — ได้ชื่อไทยเต็ม', () => {
  assertEqual(parseContentDispositionFilename(THAI_DISPOSITION), THAI_NAME);
});

test('AL: filename= ASCII fallback ใช้เมื่อไม่มี filename*', () => {
  assertEqual(
    parseContentDispositionFilename('attachment; filename="TST01-20261025-1155.xlsx"'),
    'TST01-20261025-1155.xlsx',
  );
});

test('AL: filename ไม่มี quote ก็อ่านได้', () => {
  assertEqual(parseContentDispositionFilename('attachment; filename=applications.xlsx'), 'applications.xlsx');
});

test('AL: filename* อยู่หลัง filename= ก็ยังชนะ (parse ทั้งบรรทัด)', () => {
  const reversed = `attachment; filename*=UTF-8''${encodeURIComponent('ใบสมัคร-รอบ.xlsx')}; filename="fallback.xlsx"`;
  assertEqual(parseContentDispositionFilename(reversed), 'ใบสมัคร-รอบ.xlsx');
});

test('H: CR/LF หลุดเข้ามาในค่า header ต้องถูกตัดออก (กัน header injection)', () => {
  const dirty = 'attachment; filename="bad\r\nSet-Cookie: x=1.xlsx"';
  const parsed = parseContentDispositionFilename(dirty);
  assertTrue(!!parsed);
  assertFalse(/[\r\n]/.test(parsed), `ห้ามมี CR/LF: ${JSON.stringify(parsed)}`);
});

test('parser: percent encoding เสียใน filename* → fallback ไป filename=', () => {
  const broken = "attachment; filename*=UTF-8''%E0%B9%83%E0%B8%9A%(bad; filename=\"safe.xlsx\"";
  assertEqual(parseContentDispositionFilename(broken), 'safe.xlsx');
});

test('parser: ไม่มีชื่อเลย → null (caller ใช้ DEFAULT_EXPORT_FILENAME)', () => {
  assertEqual(parseContentDispositionFilename(''), null);
  assertEqual(parseContentDispositionFilename('attachment'), null);
  assertEqual(DEFAULT_EXPORT_FILENAME, 'ใบสมัคร.xlsx');
});

test('parser: ชื่อว่าง/เว้นวรรคจาก filename= → null ไม่ใช่ string ว่าง', () => {
  assertEqual(parseContentDispositionFilename('attachment; filename=""'), null);
  assertEqual(parseContentDispositionFilename('attachment; filename="   "'), null);
});

// ═══════════════ Selection helpers (page-based, ข้ามหน้า) ═══════════════

test('AB: เลือกทั้งหน้าปัจจุบัน — เพิ่ม ID ทั้งหน้า คง ID หน้าอื่นที่เลือกไว้', () => {
  const selected = new Set(['p1-a', 'p1-b']);
  const pageIds = ['p1-b', 'p1-c', 'p1-d'];
  const next = togglePageSelection(pageIds, selected);
  assertEqual(next.size, 4, 'เดิม 2 + เพิ่ม p1-c, p1-d (p1-b ซ้ำไม่นับซ้ำ)');
  assertTrue(next.has('p1-a'), 'ID จากการเลือกก่อนหน้า (หน้าอื่น) ต้องคงอยู่');
  assertTrue(next.has('p1-c') && next.has('p1-d'));
});

test('AC: หน้าเลือกครบแล้วกด header อีกครั้ง → ถอดเฉพาะหน้านี้ คงหน้าอื่น', () => {
  const selected = new Set(['p1-a', 'p1-b', 'p1-c']);
  const pageIds = ['p1-a', 'p1-b'];
  const next = togglePageSelection(pageIds, selected);
  assertEqual(next.size, 1);
  assertTrue(next.has('p1-c'), 'ID นอกหน้าปัจจุบันต้องไม่ถูกถอด');
});

test('AA/AD: checked + indeterminate ถูกต้องทุกกรณี', () => {
  const pageIds = ['a', 'b', 'c'];
  // ว่าง
  assertFalse(areAllPageSelected(pageIds, new Set()));
  assertFalse(isPagePartiallySelected(pageIds, new Set()));
  // เลือกบางส่วน
  assertFalse(areAllPageSelected(pageIds, new Set(['a'])));
  assertTrue(isPagePartiallySelected(pageIds, new Set(['a'])));
  // ครบหน้า
  assertTrue(areAllPageSelected(pageIds, new Set(['a', 'b', 'c'])));
  assertFalse(isPagePartiallySelected(pageIds, new Set(['a', 'b', 'c'])));
  // ครบหน้า + เกิน (เลือกจากหน้าอื่นปน)
  assertTrue(areAllPageSelected(pageIds, new Set(['a', 'b', 'c', 'x'])));
});

test('AD: หน้าไม่มีรายการ → checked=false (ไม่ tick ปลอม)', () => {
  assertFalse(areAllPageSelected([], new Set(['x'])));
  assertFalse(isPagePartiallySelected([], new Set(['x'])));
});

test('helpers: ไม่แก้ Set เดิม (คืน Set ใหม่เสมอ)', () => {
  const original = new Set(['a']);
  const next = togglePageSelection(['a', 'b'], original);
  assertEqual(original.size, 1, 'ต้นฉบับต้องไม่ถูกแก้');
  assertEqual(next.size, 2);
});

console.log('\n========================================');
console.log(`ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้ม`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
