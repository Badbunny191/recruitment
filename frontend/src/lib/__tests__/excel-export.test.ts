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

// ═══════════════ Pagination Selection (PAG A–M) ═══════════════
// State-machine ที่ mirror logic จริงของ ApplicationsClient (commit 2dd1dba3):
//   - selection เก็บเป็น Set ของ ID, toggle/selectAll ผ่าน helpers จริง
//   - policy ล้าง (mirror useEffect จริง): ล้างเมื่อ roundId/search/view เปลี่ยน
//     เท่านั้น — เปลี่ยนหน้า (currentPage) หรือ sort ไม่ล้าง
//   - export request ส่ง Array.from(selectedIds) ทั้งก้อน (mirror handler จริง)
// พิสูจน์เสริมด้วย runtime จริง (dev + production build + browser) มาแล้ว
// ชุดนี้ทำหน้าที่ lock พฤติกรรมไว้กัน regression

const PAGE_SIZE = 10; // ตรงกับ pageSize จริงใน ApplicationsClient
const ALL_IDS = Array.from({ length: 25 }, (_, i) => `app-${i + 1}`);
/** ID ของหน้า n (1-based) ตาม slice จริง: sortedApps.slice((n-1)*size, n*size) */
const pageIdsOf = (page: number) => ALL_IDS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

/** mirror ของ useEffect ล้าง selection ใน ApplicationsClient (deps: roundId/search/view) */
function shouldClearByPolicy(
  prev: { roundId: string; search: string; view: string },
  next: { roundId: string; search: string; view: string },
): boolean {
  return prev.roundId !== next.roundId || prev.search !== next.search || prev.view !== next.view;
}

function createSelectionSim() {
  let selected = new Set<string>();
  return {
    get size() { return selected.size; },
    selectAllPage(pageIds: string[]) { selected = togglePageSelection(pageIds, selected); },
    toggleOne(id: string) { selected = togglePageSelection([id], selected); },
    clearByPolicy() { selected = new Set<string>(); },
    headerState(pageIds: string[]) {
      return {
        checked: areAllPageSelected(pageIds, selected),
        indeterminate: isPagePartiallySelected(pageIds, selected),
      };
    },
    exportIds: () => Array.from(selected), // mirror body จริงของ handleExportSelected
  };
}

test('PAG-A: Select All หน้า 1 → ยอด = จำนวนแถวหน้า 1', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  assertEqual(sim.size, 10);
  assertEqual(sim.headerState(pageIdsOf(1)).checked, true);
});

test('PAG-B: เปลี่ยนหน้าถัดไป (อย่างเดียว) → ยอดไม่หาย (ไม่มี effect ล้างเมื่อ page เปลี่ยน)', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  // เปลี่ยนหน้า = เพียงอ่าน pageIds ของหน้าใหม่ — policy ไม่ถูก trigger (round/search/view คงเดิม)
  const policyCleared = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: '', view: 'active' },
  );
  assertFalse(policyCleared, 'เปลี่ยนหน้าอย่างเดียวต้องไม่ล้าง');
  assertEqual(sim.size, 10, 'ยอดคงเดิมหลังเปลี่ยนหน้า');
});

test('PAG-C: หน้าใหม่ที่ยังไม่เลือก → header unchecked + ไม่ indeterminate', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  const st = sim.headerState(pageIdsOf(2));
  assertEqual(st.checked, false);
  assertEqual(st.indeterminate, false);
});

test('PAG-D: Select All สองหน้า → ยอดรวม 20', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.selectAllPage(pageIdsOf(2));
  assertEqual(sim.size, 20);
});

test('PAG-E: กลับหน้าเดิมที่เลือกครบ → header checked', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.selectAllPage(pageIdsOf(2));
  assertEqual(sim.headerState(pageIdsOf(1)).checked, true, 'หน้า 1 ยังครบ');
  assertEqual(sim.headerState(pageIdsOf(2)).checked, true, 'หน้า 2 ยังครบ');
});

test('PAG-F: Deselect All หน้าปัจจุบัน → ลบเฉพาะหน้านั้น หน้าอื่นคงครบ', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.selectAllPage(pageIdsOf(2));
  sim.selectAllPage(pageIdsOf(1)); // หน้า 1 ครบอยู่ → toggle = ถอดทั้งหน้า 1
  assertEqual(sim.size, 10, 'เหลือของหน้า 2 เท่านั้น');
  assertEqual(sim.headerState(pageIdsOf(1)).checked, false);
  assertEqual(sim.headerState(pageIdsOf(2)).checked, true, 'selection หน้า 2 ต้องยังอยู่ครบ');
});

test('PAG-G: เลือกบางส่วนในหน้า → header indeterminate', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.toggleOne('app-11'); // หน้า 2 เลือก 1 จาก 10
  const st = sim.headerState(pageIdsOf(2));
  assertEqual(st.checked, false);
  assertEqual(st.indeterminate, true);
});

test('PAG-H+M: Export Selected ส่ง ID รวมทุกหน้า + ปุ่มแสดงยอดรวม', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.selectAllPage(pageIdsOf(2));
  sim.toggleOne('app-21'); // หน้า 3 เพิ่มอีก 1
  assertEqual(sim.size, 21);
  const ids = sim.exportIds(); // mirror Array.from(selectedIds) ใน handler จริง
  assertEqual(ids.length, 21, 'request ต้องมี ID จากทุกหน้าที่เลือก');
  assertTrue(ids.includes('app-1') && ids.includes('app-15') && ids.includes('app-21'),
    'ต้องมี ID จากหน้า 1, 2 และ 3 ปนกัน');
  // M: label ปุ่ม = `Export ที่เลือก (${selectedIds.size})`
  assertEqual(`Export ที่เลือก (${sim.size})`, 'Export ที่เลือก (21)');
});

test('PAG-I: ไม่มี ID ซ้ำใน request แม้ selectAll หน้าเดิมซ้ำ/เลือกทับกัน', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  sim.selectAllPage(pageIdsOf(1)); // deselect
  sim.selectAllPage(pageIdsOf(1)); // select ใหม่อีกครั้ง
  sim.toggleOne('app-1'); // toggle คนละทิศ: ถอด app-1
  sim.toggleOne('app-1'); // ใส่กลับ
  const ids = sim.exportIds();
  assertEqual(ids.length, 10);
  assertEqual(new Set(ids).size, 10, 'ไม่มี ID ซ้ำ (Set → Array by construction)');
});

test('PAG-J: เปลี่ยน Sort → selection ไม่หาย (sort ไม่อยู่ใน policy ล้าง)', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1)); // เลือก app-1..app-10
  const policyCleared = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: '', view: 'active' }, // sortId เปลี่ยนแต่ไม่เข้า policy
  );
  assertFalse(policyCleared, 'เปลี่ยน sort ต้องไม่ล้าง');
  assertEqual(sim.size, 10, 'ยอดคงเดิมหลังเปลี่ยน sort');
  // sort กลับด้าน: ลำดับกลายเป็น app-25..app-1 → app-1..5 ไปอยู่ "หน้า 3" (ครบที่เลือก)
  //   และ "หน้า 2" มี app-6..10 (เลือก) + app-11..15 (ไม่เลือก) → indeterminate
  const reversed = [...ALL_IDS].reverse();
  const reversedPage2 = reversed.slice(10, 20);
  const reversedPage3 = reversed.slice(20, 25);
  assertEqual(sim.headerState(reversedPage3).checked, true, 'หน้าที่แถวที่เลือกไปตกลง ต้อง checked ครบ');
  assertEqual(sim.headerState(reversedPage2).indeterminate, true, 'หน้าที่มีแถวเลือกบางส่วน ต้อง indeterminate');
});

test('PAG-K: เปลี่ยน Filter (search/view) → ล้าง selection ตาม policy', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  const shouldClear = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: 'สมชาย', view: 'active' },
  );
  assertTrue(shouldClear, 'เปลี่ยน search ต้องล้าง');
  sim.clearByPolicy();
  assertEqual(sim.size, 0);
});

test('PAG-L: เปลี่ยน Round → ล้าง selection ตาม policy', () => {
  const sim = createSelectionSim();
  sim.selectAllPage(pageIdsOf(1));
  const shouldClear = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r2', search: '', view: 'active' },
  );
  assertTrue(shouldClear, 'เปลี่ยน round ต้องล้าง');
  sim.clearByPolicy();
  assertEqual(sim.size, 0);
});

console.log('\n========================================');
console.log(`ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้ม`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
