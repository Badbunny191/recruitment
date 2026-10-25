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
  areAllFilteredSelected,
  isFilteredPartiallySelected,
  toggleAllFilteredSelection,
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

// ═══════════════ Select All ตามตัวกรอง (SEL A–Q) ═══════════════
// Requirement: Header Checkbox "เลือกทั้งหมด" เลือกผู้สมัครทั้งหมดตามตัวกรอง
// ปัจจุบัน "ทุกหน้า" (filtered result ก่อน pagination) ไม่ใช่เฉพาะหน้าปัจจุบัน
// State-machine นี้ mirror logic จริงของ ApplicationsClient:
//   - allFilteredIds มาจาก sortedApps.map(id) (หลัง round + search + view + sort ก่อน slice)
//   - selectAll / headerState ผ่าน helpers จริง
//   - policy ล้าง (mirror useEffect จริง): ล้างเมื่อ roundId/search/view เปลี่ยน
//     เท่านั้น — เปลี่ยนหน้า (currentPage) หรือ sort ไม่ล้าง
//   - export request ส่ง Array.from(selectedIds) ทั้งก้อน (mirror handler จริง)

const TOTAL = 13; // ผลลัพธ์ตามตัวกรอง 13 รายการ
const PAGE_SIZE = 10; // ตรงกับ pageSize จริงใน ApplicationsClient
const ALL_IDS = Array.from({ length: TOTAL }, (_, i) => `app-${i + 1}`);
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
    has: (id: string) => selected.has(id),
    selectAll(allFilteredIds: string[]) { selected = toggleAllFilteredSelection(allFilteredIds, selected); },
    toggleOne(id: string) { selected = toggleAllFilteredSelection([id], selected); },
    clearByPolicy() { selected = new Set<string>(); },
    headerState(allFilteredIds: string[]) {
      return {
        checked: areAllFilteredSelected(allFilteredIds, selected),
        indeterminate: isFilteredPartiallySelected(allFilteredIds, selected),
      };
    },
    exportIds: () => Array.from(selected), // mirror body จริงของ handleExportSelected
  };
}

test('A: โลก 13 รายการ หน้าละ 10 → หน้า 1 = 10, หน้า 2 = 3, รวม 13', () => {
  assertEqual(pageIdsOf(1).length, 10, 'หน้า 1 แสดง 10');
  assertEqual(pageIdsOf(2).length, 3, 'หน้า 2 เหลือ 3');
  assertEqual(ALL_IDS.length, 13);
});

test('B: กด Header Checkbox หน้าแรก → selectedIds มีครบ 13 IDs (ทุกหน้า)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS); // component ส่ง allFilteredIds ทั้งชุด ไม่ใช่ pageIds
  assertEqual(sim.size, 13, 'ต้องเลือก 13 ไม่ใช่ 10 เฉพาะหน้า');
});

test('C: ปุ่มแสดง "Export ที่เลือก (13)"', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  assertEqual(`Export ที่เลือก (${sim.size})`, 'Export ที่เลือก (13)');
});

test('D: ไปหน้าที่ 2 → อีก 3 รายการ (app-11..13) ต้องถูกเลือก (checked)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  const page2 = pageIdsOf(2);
  assertTrue(page2.every((id) => sim.has(id)), 'ทั้ง 3 รายการหน้า 2 ต้อง checked');
});

test('E: เลือกครบ 13 แล้ว Header Checkbox ต้อง checked (ทุกหน้าที่เปิด)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  const st = sim.headerState(ALL_IDS);
  assertEqual(st.checked, true, 'ครบทั้ง filtered result → checked');
  assertEqual(st.indeterminate, false);
});

test('F: กด Header ซ้ำ → selectedIds ว่าง + ปุ่ม Export ที่เลือก Disabled (N=0)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  sim.selectAll(ALL_IDS); // ครบแล้ว → toggle = ลบทั้งชุด
  assertEqual(sim.size, 0, 'ต้องว่างสนิท');
  const disabled = sim.size === 0; // mirror เงื่อนไข disabled จริงของปุ่ม
  assertEqual(disabled, true, 'N=0 ปุ่มต้อง Disabled');
  assertEqual(`Export ที่เลือก (${sim.size})`, 'Export ที่เลือก (0)');
});

test('G: เลือกทีละรายการ 5 ตัว → Header indeterminate (ยังไม่ครบ 13)', () => {
  const sim = createSelectionSim();
  for (let i = 0; i < 5; i++) sim.toggleOne(`app-${i + 1}`);
  const st = sim.headerState(ALL_IDS);
  assertEqual(st.checked, false, 'ยังไม่ครบ → ไม่ checked');
  assertEqual(st.indeterminate, true, 'เลือกบางส่วน → indeterminate');
});

test('H: Export Selected ส่ง 13 IDs ครบทุกหน้า', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  const ids = sim.exportIds();
  assertEqual(ids.length, 13);
  assertTrue(ALL_IDS.every((id) => ids.includes(id)), 'ครบทั้งหน้า 1 และหน้า 2');
});

test('I: IDs ใน Request ไม่ซ้ำ (แม้กด selectAll ซ้ำหลายรอบ)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  sim.selectAll(ALL_IDS); // deselect
  sim.selectAll(ALL_IDS); // select ใหม่
  const ids = sim.exportIds();
  assertEqual(ids.length, 13);
  assertEqual(new Set(ids).size, 13, 'ไม่มี ID ซ้ำ (Set → Array by construction)');
});

test('J: Search เหลือ 4 รายการ → Select All ต้องเลือก 4 เท่านั้น', () => {
  const sim = createSelectionSim();
  // mirror ลำดับจริง: เปลี่ยน search → policy ล้าง selection ก่อน แล้ว filtered เหลือ 4
  assertTrue(shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: 'สมชาย', view: 'active' },
  ), 'เปลี่ยน search ต้องล้างก่อน');
  sim.clearByPolicy();
  const filtered4 = ALL_IDS.slice(0, 4); // ผล search เหลือ 4
  sim.selectAll(filtered4);
  assertEqual(sim.size, 4, 'เลือกเท่าผลตามตัวกรองใหม่');
  assertTrue(filtered4.every((id) => sim.has(id)));
});

test('K: เปลี่ยน Search → ล้าง Selection ตาม policy', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  const st = sim.headerState(ALL_IDS);
  assertEqual(st.checked, true, 'ก่อนเปลี่ยน: ครบ');
  assertTrue(shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: 'สมชาย', view: 'active' },
  ));
  sim.clearByPolicy();
  assertEqual(sim.size, 0);
});

test('L: เปลี่ยน View/Status → ล้าง Selection ตาม policy', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  assertTrue(shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: '', view: 'archived' },
  ));
  sim.clearByPolicy();
  assertEqual(sim.size, 0);
});

test('M: เปลี่ยน Round → ล้าง Selection ตาม policy', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  assertTrue(shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r2', search: '', view: 'active' },
  ));
  sim.clearByPolicy();
  assertEqual(sim.size, 0);
});

test('N: เปลี่ยน Pagination (อย่างเดียว) → ห้ามล้าง Selection', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  // เปลี่ยนหน้า = เพียงเปลี่ยนมุมมอง slice — policy ไม่ถูก trigger
  const policyCleared = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: '', view: 'active' },
  );
  assertFalse(policyCleared, 'เปลี่ยนหน้าต้องไม่ล้าง');
  assertEqual(sim.size, 13, 'ยอดคงเดิม');
  // และ header ของทุกหน้ายัง checked เพราะคำนวณกับ filtered ทั้งชุด
  assertEqual(sim.headerState(pageIdsOf(2)).checked, true);
});

test('O: เปลี่ยน Sort → ห้ามล้าง Selection (ID ชุดเดิม เพียงเรียงใหม่)', () => {
  const sim = createSelectionSim();
  sim.selectAll(ALL_IDS);
  const policyCleared = shouldClearByPolicy(
    { roundId: 'r1', search: '', view: 'active' },
    { roundId: 'r1', search: '', view: 'active' }, // sort เปลี่ยนแต่ไม่เข้า policy
  );
  assertFalse(policyCleared, 'เปลี่ยน sort ต้องไม่ล้าง');
  assertEqual(sim.size, 13);
  // sortedIds เรียงกลับด้าน = ชุด ID เดียวกัน → header ยัง checked
  const reversed = [...ALL_IDS].reverse();
  assertEqual(sim.headerState(reversed).checked, true);
});

test('P: เลือกทีละแถวข้ามหน้าได้ (หน้า 1 และหน้า 2 ปนกัน)', () => {
  const sim = createSelectionSim();
  sim.toggleOne('app-1');   // หน้า 1
  sim.toggleOne('app-13');  // หน้า 2
  sim.toggleOne('app-7');   // หน้า 1
  assertEqual(sim.size, 3);
  const st = sim.headerState(ALL_IDS);
  assertEqual(st.indeterminate, true, 'บางส่วน → indeterminate');
  const ids = sim.exportIds();
  assertTrue(ids.includes('app-1') && ids.includes('app-13') && ids.includes('app-7'));
  assertEqual(new Set(ids).size, 3, 'ไม่ซ้ำ');
});

test('Q: Empty result → Header unchecked + ไม่ indeterminate + ปุ่ม Disabled', () => {
  const sim = createSelectionSim();
  const st = sim.headerState([]);
  assertEqual(st.checked, false, 'ไม่มีรายการ → ห้าม checked');
  assertEqual(st.indeterminate, false);
  sim.selectAll([]); // toggle บนชุดว่าง → ไม่มีอะไรถูกเพิ่ม
  assertEqual(sim.size, 0, 'ยังว่าง');
  assertEqual(sim.size === 0, true, 'ปุ่ม Export ที่เลือก Disabled (N=0)');
});

test('helpers: ไม่แก้ Set เดิม (คืน Set ใหม่เสมอ)', () => {
  const original = new Set(['a']);
  const next = toggleAllFilteredSelection(['a', 'b', 'c'], original);
  assertEqual(original.size, 1, 'ต้นฉบับต้องไม่ถูกแก้');
  assertEqual(next.size, 3);
});

test('helpers: เลือกครบแล้ว toggle ลบเฉพาะ ID ใน filtered (นอกชุดคงเดิม)', () => {
  // กรณี selection มี ID นอก filtered result ตกค้าง (ปกติไม่เกิดเพราะ policy ล้าง
  // เมื่อ filter เปลี่ยน — แต่ helper ต้อง "ห้ามลบ Selection อื่นโดยไม่จำเป็น")
  const selected = new Set(['in-1', 'in-2', 'out-x']);
  const next = toggleAllFilteredSelection(['in-1', 'in-2'], selected); // ครบ → ลบเฉพาะในชุด
  assertEqual(next.has('out-x'), true, 'ID นอก filtered ต้องคงเดิม');
  assertEqual(next.size, 1);
});

console.log('\n========================================');
console.log(`ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้ม`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
