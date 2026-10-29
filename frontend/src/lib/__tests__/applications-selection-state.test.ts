/**
 * Phase 4: ApplicationsSelector Foundation — state model tests
 * =======================================================================
 *
 * สิ่งที่ต้องพิสูจน์:
 *   P4-1.  explicit        — ติ๊ก/ยกเลิกทีละใบ, เหลือ 0 → idle
 *   P4-2.  all-filtered    — เลือกทั้งหมดตามตัวกรอง (ไม่ต้องมี id ครบในมือ)
 *   P4-3.  excludeIds      — เอาบางใบออกจาก "ทั้งหมด", เอาออกครบ → idle
 *   P4-4.  selectedCount   — นับถูกทุกสถานะ (all-filtered ใช้ยอดจาก server)
 *   P4-5.  header checked  — checked เฉพาะเมื่อครบจริง
 *   P4-6.  header indeterminate — บางส่วนแต่ไม่ครบ
 *   P4-7.  normalize        — state ที่ไม่สอดคล้องถูกซ่อม
 *   P4-8.  selector         — fail closed เมื่อยังส่งขึ้น server ไม่ได้
 *
 * รัน: node --import tsx src/lib/__tests__/applications-selection-state.test.ts
 */

// @ts-nocheck — tsx run-time
import {
  buildApplicationsSelector,
  buildBulkStatusPayload,
  buildExportSelectedPayload,
  buildSelectionSelector,
  canSubmitSelection,
  clearSelection,
  createSelection,
  describeSelectionBlocker,
  describeSelectionCount,
  isHeaderChecked,
  isHeaderIndeterminate,
  isRowSelected,
  MAX_SELECTION_EXCLUDE_IDS,
  normalizeSelection,
  resolveSelectedCount,
  selectAllFiltered,
  toggleHeader,
  toggleRow,
} from '../applications-selection-state';

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

function assertEqual(actual: any, expected: any, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function assertTrue(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const FILTER = { roundId: 'round-1', statusFilter: 'ALL', search: '' };
const TOTAL = 13; // ยอดรวมตามตัวกรองจาก server
const PAGE_IDS = Array.from({ length: 10 }, (_, i) => `app-${i + 1}`); // หน้า 1

console.log('=================================================');
console.log('Phase 4: ApplicationsSelector Foundation — Tests');
console.log('=================================================\n');

// ── P4-1 explicit ──────────────────────────────────────────────────────────
test('P4-1a: เริ่มต้น = idle, ไม่มีอะไรถูกเลือก', () => {
  const sel = createSelection();
  assertEqual(sel, { state: 'idle', ids: [], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 0);
});

test('P4-1b: ติ๊กแถวแรก → explicit พร้อม id เดียว', () => {
  const sel = toggleRow(createSelection(), 'app-1');
  assertEqual(sel, { state: 'explicit', ids: ['app-1'], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 1);
});

test('P4-1c: ติ๊กเพิ่มหลายใบ → explicit สะสมตามลำดับที่ติ๊ก', () => {
  let sel = createSelection();
  sel = toggleRow(sel, 'app-1');
  sel = toggleRow(sel, 'app-3');
  sel = toggleRow(sel, 'app-2');
  assertEqual(sel.ids, ['app-1', 'app-3', 'app-2']);
  assertEqual(resolveSelectedCount(sel, TOTAL), 3);
});

test('P4-1d: ยกเลิกติ๊กทีละใบ จนเหลือ 0 → กลับเป็น idle', () => {
  let sel = toggleRow(createSelection(), 'app-1');
  sel = toggleRow(sel, 'app-2');
  sel = toggleRow(sel, 'app-1');
  assertEqual(sel, { state: 'explicit', ids: ['app-2'], excludeIds: [] });
  sel = toggleRow(sel, 'app-2');
  assertEqual(sel, { state: 'idle', ids: [], excludeIds: [] }, 'เหลือ 0 → idle');
});

test('P4-1e: ติ๊กซ้ำ id เดิมไม่ทำให้เกิด id ซ้ำ', () => {
  let sel = toggleRow(createSelection(), 'app-1');
  sel = toggleRow(sel, 'app-1'); // ยกเลิก
  sel = toggleRow(sel, 'app-1'); // ติ๊กใหม่
  assertEqual(sel.ids, ['app-1']);
});

test('P4-1f: explicit เก็บ id ข้ามหน้าได้ (id นอกหน้าปัจจุบัน)', () => {
  let sel = toggleRow(createSelection(), 'app-99');
  assertEqual(isRowSelected(sel, 'app-99'), true, 'id นอกหน้าถูกเลือกอยู่');
  assertEqual(isRowSelected(sel, 'app-1'), false);
});

// ── P4-2 all-filtered ──────────────────────────────────────────────────────
test('P4-2a: selectAllFiltered → all-filtered ไม่มี excludeIds', () => {
  const sel = selectAllFiltered(TOTAL);
  assertEqual(sel, { state: 'all-filtered', ids: [], excludeIds: [] });
});

test('P4-2b: all-filtered นับจากยอด server ไม่ใช่จำนวนแถวที่โหลดมา', () => {
  const sel = selectAllFiltered(TOTAL);
  assertEqual(resolveSelectedCount(sel, TOTAL), 13, '13 จาก server');
  assertTrue(
    resolveSelectedCount(sel, TOTAL) !== PAGE_IDS.length,
    'ต้องไม่ใช่ 10 (จำนวนแถวหน้าปัจจุบัน)',
  );
});

test('P4-2c: all-filtered → ทุกแถวบนหน้าถูกเลือก', () => {
  const sel = selectAllFiltered(TOTAL);
  assertTrue(PAGE_IDS.every((id) => isRowSelected(sel, id)), 'ทั้งหน้า checked');
});

test('P4-2d: selectAllFiltered ตอนยอดรวม 0 → idle (ไม่มีอะไรให้เลือก)', () => {
  assertEqual(selectAllFiltered(0), { state: 'idle', ids: [], excludeIds: [] });
});

test('P4-2e: clearSelection ล้างทุกอย่างกลับ idle', () => {
  const sel = clearSelection();
  assertEqual(sel, { state: 'idle', ids: [], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 0);
});

// ── P4-3 excludeIds ────────────────────────────────────────────────────────
test('P4-3a: all-filtered แล้วยกเลิกติ๊ก 1 แถว → เข้า excludeIds', () => {
  const sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  assertEqual(sel, { state: 'all-filtered', ids: [], excludeIds: ['app-2'] });
});

test('P4-3b: excludeIds ลดจำนวนที่เลือกจริง', () => {
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);
  sel = toggleRow(sel, 'app-5', TOTAL);
  assertEqual(resolveSelectedCount(sel, TOTAL), 11, '13 - 2');
});

test('P4-3c: แถวที่อยู่ใน excludeIds ต้องไม่ถูกเลือก', () => {
  const sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  assertEqual(isRowSelected(sel, 'app-2'), false, 'ถูกเอาออก');
  assertEqual(isRowSelected(sel, 'app-1'), true, 'ใบอื่นยังเลือกอยู่');
});

test('P4-3d: ติ๊กกลับแถวที่เคยเอาออก → หลุดจาก excludeIds', () => {
  let sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);
  assertEqual(sel, { state: 'all-filtered', ids: [], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 13);
});

test('P4-3e: เอาออกครบทุกใบ (13/13) → กลับเป็น idle ไม่ใช่ all-filtered ว่าง', () => {
  let sel = selectAllFiltered(TOTAL);
  for (let i = 1; i <= TOTAL; i++) sel = toggleRow(sel, `app-${i}`, TOTAL);
  assertEqual(sel, { state: 'idle', ids: [], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 0);
});

test('P4-3f: excludeIds ไม่มี id ซ้ำ', () => {
  let sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL); // ติ๊กกลับ
  sel = toggleRow(sel, 'app-2', TOTAL); // เอาออกอีกครั้ง
  assertEqual(sel.excludeIds, ['app-2']);
});

test('P4-3g: excludeIds มากกว่ายอดรวม → count ไม่ติดลบ', () => {
  const sel = { state: 'all-filtered', ids: [], excludeIds: ['a', 'b', 'c'] };
  assertEqual(resolveSelectedCount(sel, 2), 0, 'clamp ที่ 0');
});

// ── P4-4 selectedCount ─────────────────────────────────────────────────────
test('P4-4a: count ครบทุกสถานะ', () => {
  assertEqual(resolveSelectedCount(createSelection(), TOTAL), 0, 'idle');
  assertEqual(resolveSelectedCount(toggleRow(createSelection(), 'app-1'), TOTAL), 1, 'explicit 1');
  assertEqual(resolveSelectedCount(selectAllFiltered(TOTAL), TOTAL), 13, 'all-filtered');
  assertEqual(
    resolveSelectedCount(toggleRow(selectAllFiltered(TOTAL), 'app-1', TOTAL), TOTAL),
    12,
    'all-filtered - 1',
  );
});

test('P4-4b: filteredTotal ที่ไม่ valid → ถือเป็น 0', () => {
  const sel = selectAllFiltered(TOTAL);
  assertEqual(resolveSelectedCount(sel, NaN), 0);
  assertEqual(resolveSelectedCount(sel, -5), 0);
});

test('P4-4c: describeSelectionCount อ่านรู้เรื่องทุกสถานะ', () => {
  assertEqual(describeSelectionCount(createSelection(), TOTAL), 'ยังไม่ได้เลือก');
  assertEqual(
    describeSelectionCount(toggleRow(toggleRow(createSelection(), 'a'), 'b'), TOTAL),
    'เลือกไว้ 2 รายการ',
  );
  assertEqual(
    describeSelectionCount(selectAllFiltered(TOTAL), TOTAL),
    'เลือกทั้งหมด 13 รายการตามตัวกรอง',
  );
  assertEqual(
    describeSelectionCount(toggleRow(selectAllFiltered(TOTAL), 'a', TOTAL), TOTAL),
    'เลือกทั้งหมด 12 รายการตามตัวกรอง (ยกเว้น 1)',
  );
});

// ── P4-5 header checked ────────────────────────────────────────────────────
test('P4-5a: idle → header ไม่ checked', () => {
  assertEqual(isHeaderChecked(createSelection(), PAGE_IDS, TOTAL), false);
});

test('P4-5b: all-filtered ไม่มี excludeIds → checked', () => {
  assertEqual(isHeaderChecked(selectAllFiltered(TOTAL), PAGE_IDS, TOTAL), true);
});

test('P4-5c: all-filtered ที่มี excludeIds → ไม่ checked', () => {
  const sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  assertEqual(isHeaderChecked(sel, PAGE_IDS, TOTAL), false);
});

test('P4-5d: explicit ที่เลือกครบเท่ายอดรวม → checked', () => {
  let sel = createSelection();
  for (let i = 1; i <= TOTAL; i++) sel = toggleRow(sel, `app-${i}`);
  assertEqual(sel.state, 'explicit');
  assertEqual(isHeaderChecked(sel, PAGE_IDS, TOTAL), true, 'ครบ 13 → checked');
});

test('P4-5e: explicit ที่ยังไม่ครบ → ไม่ checked', () => {
  const sel = toggleRow(toggleRow(createSelection(), 'app-1'), 'app-2');
  assertEqual(isHeaderChecked(sel, PAGE_IDS, TOTAL), false);
});

test('P4-5f: ยอดรวม 0 → ไม่ checked แม้ state จะเป็น all-filtered', () => {
  assertEqual(
    isHeaderChecked({ state: 'all-filtered', ids: [], excludeIds: [] }, [], 0),
    false,
  );
});

// ── P4-6 header indeterminate ──────────────────────────────────────────────
test('P4-6a: idle → ไม่ indeterminate', () => {
  assertEqual(isHeaderIndeterminate(createSelection(), PAGE_IDS, TOTAL), false);
});

test('P4-6b: explicit บางส่วน → indeterminate', () => {
  const sel = toggleRow(createSelection(), 'app-1');
  assertEqual(isHeaderIndeterminate(sel, PAGE_IDS, TOTAL), true);
});

test('P4-6c: all-filtered ที่มี excludeIds (ยังเหลือบางใบ) → indeterminate', () => {
  const sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  assertEqual(isHeaderIndeterminate(sel, PAGE_IDS, TOTAL), true);
});

test('P4-6d: checked ชนะ indeterminate — ทั้งคู่ไม่เป็น true พร้อมกัน', () => {
  const cases = [
    createSelection(),
    toggleRow(createSelection(), 'app-1'),
    selectAllFiltered(TOTAL),
    toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL),
  ];
  for (const sel of cases) {
    const checked = isHeaderChecked(sel, PAGE_IDS, TOTAL);
    const indet = isHeaderIndeterminate(sel, PAGE_IDS, TOTAL);
    assertTrue(!(checked && indet), `ห้าม checked+indeterminate พร้อมกัน: ${JSON.stringify(sel)}`);
  }
});

test('P4-6e: toggleHeader — จาก idle → all-filtered, จาก checked → idle', () => {
  const first = toggleHeader(createSelection(), PAGE_IDS, TOTAL);
  assertEqual(first, { state: 'all-filtered', ids: [], excludeIds: [] });
  const second = toggleHeader(first, PAGE_IDS, TOTAL);
  assertEqual(second, { state: 'idle', ids: [], excludeIds: [] });
});

test('P4-6f: toggleHeader จาก explicit บางส่วน → all-filtered (ชุดที่กว้างกว่า)', () => {
  const partial = toggleRow(createSelection(), 'app-1');
  const sel = toggleHeader(partial, PAGE_IDS, TOTAL);
  assertEqual(sel, { state: 'all-filtered', ids: [], excludeIds: [] });
  assertEqual(resolveSelectedCount(sel, TOTAL), 13);
});

// ── P4-7 normalize ─────────────────────────────────────────────────────────
test('P4-7a: idle ที่มี ids ค้าง → ล้างทิ้ง', () => {
  assertEqual(
    normalizeSelection({ state: 'idle', ids: ['a'], excludeIds: ['b'] }),
    { state: 'idle', ids: [], excludeIds: [] },
  );
});

test('P4-7b: explicit ที่ไม่มี id → idle', () => {
  assertEqual(
    normalizeSelection({ state: 'explicit', ids: [] }),
    { state: 'idle', ids: [], excludeIds: [] },
  );
});

test('P4-7c: all-filtered ทิ้ง ids ที่ไม่ควรมี', () => {
  assertEqual(
    normalizeSelection({ state: 'all-filtered', ids: ['x'], excludeIds: ['y'] }),
    { state: 'all-filtered', ids: [], excludeIds: ['y'] },
  );
});

test('P4-7d: state ที่ไม่รู้จัก / null → idle', () => {
  assertEqual(normalizeSelection(null), { state: 'idle', ids: [], excludeIds: [] });
  assertEqual(normalizeSelection({ state: 'bogus' }), { state: 'idle', ids: [], excludeIds: [] });
});

test('P4-7e: id ว่าง/ไม่ใช่ string ถูกตัดออก', () => {
  assertEqual(
    normalizeSelection({ state: 'explicit', ids: ['a', '', 'a', null] }),
    { state: 'explicit', ids: ['a'], excludeIds: [] },
  );
});

// ── P4-8 selector (fail closed) ────────────────────────────────────────────
test('P4-8a: idle → ไม่มี selector, ปุ่ม disable', () => {
  assertEqual(buildSelectionSelector(createSelection(), FILTER), null);
  assertEqual(canSubmitSelection(createSelection(), FILTER), false);
  assertEqual(describeSelectionBlocker(createSelection(), FILTER), 'ยังไม่ได้เลือกรายการ');
});

test('P4-8b: explicit → selector kind ids', () => {
  const sel = toggleRow(toggleRow(createSelection(), 'a1'), 'a2');
  assertEqual(buildSelectionSelector(sel, FILTER), { kind: 'ids', ids: ['a1', 'a2'] });
  assertEqual(canSubmitSelection(sel, FILTER), true);
});

test('P4-8c: all-filtered ไม่มี excludeIds → selector kind filter', () => {
  const sel = selectAllFiltered(TOTAL);
  assertEqual(buildSelectionSelector(sel, { ...FILTER, statusFilter: 'QUALIFIED', search: 'สมชาย' }), {
    kind: 'filter',
    roundId: 'round-1',
    status: 'QUALIFIED',
    search: 'สมชาย',
  });
});

test('P4-8d: all-filtered ที่ไม่มี roundId → null (ยิงไม่ได้)', () => {
  const sel = selectAllFiltered(TOTAL);
  assertEqual(buildSelectionSelector(sel, { ...FILTER, roundId: '' }), null);
  assertEqual(
    describeSelectionBlocker(sel, { ...FILTER, roundId: '  ' }),
    'ยังไม่ได้เลือกรอบรับสมัคร',
  );
});

test('P4-8e: all-filtered ที่มี excludeIds → ส่ง selector พร้อม excludeIds (backend รองรับแล้ว)', () => {
  const sel = toggleRow(selectAllFiltered(TOTAL), 'app-2', TOTAL);
  // Phase 1.1: ถอด gate เดิมออก — backend รองรับ excludeIds (NOT IN, cap 80)
  assertEqual(buildSelectionSelector(sel, FILTER), {
    kind: 'filter',
    roundId: 'round-1',
    status: null,
    search: null,
    excludeIds: ['app-2'],
  });
  assertEqual(canSubmitSelection(sel, FILTER), true, 'ต้องกดได้');
  assertEqual(describeSelectionBlocker(sel, FILTER), null, 'ไม่มี blocker');
});

test('P4-8e2: excludeIds เกิน cap → fail closed พร้อมเหตุผล', () => {
  // 81 ใบ (TOTAL ต้องมากพอให้ไม่กลายเป็น idle ก่อน)
  let sel = selectAllFiltered(200);
  for (let i = 0; i < MAX_SELECTION_EXCLUDE_IDS + 1; i++) {
    sel = toggleRow(sel, `x-${i}`, 200);
  }
  assertEqual(buildSelectionSelector(sel, FILTER), null, 'fail closed');
  assertEqual(canSubmitSelection(sel, FILTER), false);
  const reason = describeSelectionBlocker(sel, FILTER);
  assertTrue(reason && reason.includes(String(MAX_SELECTION_EXCLUDE_IDS)), `ต้องบอกเพดาน: ${reason}`);
});

test('P4-8e3: excludeIds ไม่เกิน cap → ส่งได้ตามปกติ', () => {
  let sel = selectAllFiltered(200);
  for (let i = 0; i < MAX_SELECTION_EXCLUDE_IDS; i++) {
    sel = toggleRow(sel, `x-${i}`, 200);
  }
  const built = buildSelectionSelector(sel, FILTER);
  assertTrue(built !== null, 'ที่เพดานพอดีต้องยังส่งได้');
  assertEqual(built.excludeIds.length, MAX_SELECTION_EXCLUDE_IDS);
});

test('P4-8f: buildSelectionSelector ใช้ buildApplicationsSelector ตัวเดียวกัน (ไม่มีรูปที่สอง)', () => {
  // ยืนยันว่า Phase 4 ไม่ได้สร้างรูป payload ใหม่ที่เพี้ยนจากตัวกลาง
  const sel = toggleRow(createSelection(), 'a1');
  assertEqual(buildSelectionSelector(sel, FILTER), { kind: 'ids', ids: ['a1'] });
  assertEqual(buildSelectionSelector(sel, FILTER), buildApplicationsSelector(sel, FILTER));
  assertEqual(
    buildSelectionSelector(selectAllFiltered(TOTAL), FILTER),
    { kind: 'filter', roundId: 'round-1', status: null, search: null },
  );
});

console.log('');
if (failed > 0) {
  console.log(`FAILED: ${failed}/${passed + failed}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED: ${passed}/${passed + failed}`);
