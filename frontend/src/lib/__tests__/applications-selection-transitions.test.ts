/**
 * Applications Selection — transitions across list-state changes (Phase 2)
 * ========================================================================
 *
 * ทำไมต้องมีไฟล์นี้
 *   `applications-selection-state.test.ts` (Phase 4) พิสูจน์ "รูปทรง" ของ
 *   selection (explicit / all-filtered / excludeIds / count / header) แต่ไม่เคย
 *   ผูกกับ "การเปลี่ยน state ของหน้ารายชื่อ" เลย
 *   `applications-list-state.test.ts` (Phase 3) พิสูจน์กฎ page-reset /
 *   selection-clear แต่断言แค่ boolean จาก shouldClearSelection() —
 *   ไม่ได้ตรวจว่า selection "ยังอยู่ครบ" จริงหลังเปลี่ยนหน้า
 *
 *   ไฟล์นี้ปิดช่องว่างนั้น: ประกอบสองโมดูลเข้าด้วยกันแล้ว断言ว่า selection
 *   object ยังคงเนื้อเดิม (ids / excludeIds / count / selector) หลัง
 *   page / pageSize / sort เปลี่ยน และถูกล้างจริงเมื่อ filter เปลี่ยน
 *
 * ขอบเขต Phase 2 — 8 กรณีที่สเปกบังคับ
 *   T1  explicit selection
 *   T2  all-filtered selection
 *   T3  excludeIds
 *   T4  selectedCount
 *   T5  page change
 *   T6  pageSize change
 *   T7  sort change
 *   T8  filter change
 *
 * รัน: node --import tsx src/lib/__tests__/applications-selection-transitions.test.ts
 */

// @ts-nocheck — tsx run-time
import {
  applyListStatePatch,
  shouldClearSelection,
  type ApplicationsListState,
} from '../applications-list-state';
import {
  buildSelectionSelector,
  clearSelection,
  createSelection,
  describeSelectionCount,
  isHeaderChecked,
  isHeaderIndeterminate,
  isRowSelected,
  resolveSelectedCount,
  selectAllFiltered,
  toggleHeader,
  toggleRow,
  type ApplicationsSelection,
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

function eq(actual: any, expected: any, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function ok(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/** state ตั้งต้นของหน้ารายชื่อ */
function listState(over: Partial<ApplicationsListState> = {}): ApplicationsListState {
  return {
    roundId: 'round-1',
    search: '',
    status: 'ALL',
    sort: 'submittedAt-desc',
    page: 1,
    pageSize: 10,
    ...over,
  };
}

/** filter context ที่ selector ใช้ (ไม่มี page/pageSize/sort โดยเจตนา) */
function filterOf(state: ApplicationsListState) {
  return { roundId: state.roundId, statusFilter: state.status, search: state.search };
}

// ยอดรวมตามตัวกรองจาก server (pagination.total) — ไม่ขึ้นกับหน้าปัจจุบัน
const TOTAL = 13;
// แถวของแต่ละหน้า (pageSize 10 → หน้า 1 มี 10, หน้า 2 มี 3)
const PAGE_1 = Array.from({ length: 10 }, (_, i) => `app-${i + 1}`);
const PAGE_2 = ['app-11', 'app-12', 'app-13'];

/**
 * จำลอง "ผู้ใช้เปลี่ยน state ของหน้ารายชื่อ" แล้วคืน selection ที่ควรเป็น
 * ตรงกับที่ component ทำ: ถ้า shouldClearSelection → clearSelection()
 * ไม่อย่างนั้น selection คงเดิม (ไม่ถูกแตะเลย)
 */
function afterListChange(
  selection: ApplicationsSelection,
  prev: ApplicationsListState,
  patch: Partial<ApplicationsListState>,
): ApplicationsSelection {
  const next = applyListStatePatch(prev, patch);
  return shouldClearSelection(prev, next) ? clearSelection() : selection;
}

console.log('=================================================');
console.log('Phase 2: Applications Selection — Transitions');
console.log('=================================================\n');

// ============================================================
// T1 — explicit selection
// ============================================================

test('T1: explicit — ติ๊ก 3 ใบ → state/ids/count ถูกต้อง', () => {
  let sel = createSelection();
  for (const id of ['app-1', 'app-2', 'app-3']) sel = toggleRow(sel, id, TOTAL);

  eq(sel.state, 'explicit');
  eq(sel.ids, ['app-1', 'app-2', 'app-3']);
  eq(sel.excludeIds, []);
  eq(resolveSelectedCount(sel, TOTAL), 3);
});

test('T1: explicit — selector เป็น kind ids ตามลำดับที่ติ๊ก', () => {
  let sel = createSelection();
  for (const id of ['app-3', 'app-1']) sel = toggleRow(sel, id, TOTAL);

  eq(buildSelectionSelector(sel, filterOf(listState())), {
    kind: 'ids',
    ids: ['app-3', 'app-1'],
  });
});

test('T1: explicit — ติ๊กครบทุกใบ (13) → header checked', () => {
  let sel = createSelection();
  for (const id of [...PAGE_1, ...PAGE_2]) sel = toggleRow(sel, id, TOTAL);

  eq(sel.ids.length, TOTAL);
  ok(isHeaderChecked(sel, PAGE_1, TOTAL), 'หน้า 1 ต้อง checked');
  ok(isHeaderChecked(sel, PAGE_2, TOTAL), 'หน้า 2 ต้อง checked');
});

// ============================================================
// T2 — all-filtered selection
// ============================================================

test('T2: all-filtered — selectAllFiltered ไม่ materialize id ทั้งชุด', () => {
  const sel = selectAllFiltered(TOTAL);

  eq(sel.state, 'all-filtered');
  eq(sel.ids, [], 'ต้องไม่เก็บ id ทั้ง 13 ใบ');
  eq(sel.excludeIds, []);
  eq(resolveSelectedCount(sel, TOTAL), TOTAL, 'count มาจาก total ของ server');
});

test('T2: all-filtered — selector เป็น kind filter ตามตัวกรองปัจจุบัน', () => {
  const state = listState({ status: 'QUALIFIED', search: '  สมชาย  ' });
  const sel = selectAllFiltered(TOTAL);

  eq(buildSelectionSelector(sel, filterOf(state)), {
    kind: 'filter',
    roundId: 'round-1',
    status: 'QUALIFIED',
    search: 'สมชาย',
  });
});

test('T2: all-filtered — ทุกแถวบนหน้าถูกเลือก และ header checked', () => {
  const sel = selectAllFiltered(TOTAL);

  ok(PAGE_1.every((id) => isRowSelected(sel, id)), 'หน้า 1 ต้องถูกเลือกครบ');
  ok(PAGE_2.every((id) => isRowSelected(sel, id)), 'หน้า 2 ต้องถูกเลือกครบ');
  ok(isHeaderChecked(sel, PAGE_1, TOTAL));
  ok(!isHeaderIndeterminate(sel, PAGE_1, TOTAL));
});

test('T2: all-filtered — total 0 → idle (ไม่มีอะไรให้เลือก)', () => {
  eq(selectAllFiltered(0), createSelection());
});

// ============================================================
// T3 — excludeIds
// ============================================================

test('T3: excludeIds — เอาออก 1 ใบ → count ลด, แถวนั้นไม่ถูกเลือก', () => {
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);

  eq(sel.state, 'all-filtered');
  eq(sel.excludeIds, ['app-2']);
  eq(resolveSelectedCount(sel, TOTAL), TOTAL - 1);
  ok(!isRowSelected(sel, 'app-2'), 'แถวที่เอาออกต้องไม่ถูกเลือก');
  ok(isRowSelected(sel, 'app-1'), 'แถวอื่นยังถูกเลือก');
});

test('T3: excludeIds — ส่งขึ้น server พร้อม filter (backend รองรับแล้ว)', () => {
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);
  sel = toggleRow(sel, 'app-5', TOTAL);

  eq(buildSelectionSelector(sel, filterOf(listState())), {
    kind: 'filter',
    roundId: 'round-1',
    status: null,
    search: null,
    excludeIds: ['app-2', 'app-5'],
  });
});

test('T3: excludeIds — header indeterminate ไม่ใช่ checked', () => {
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);

  ok(!isHeaderChecked(sel, PAGE_1, TOTAL), 'ยังไม่ครบ → ไม่ checked');
  ok(isHeaderIndeterminate(sel, PAGE_1, TOTAL), 'บางส่วน → indeterminate');
});

test('T3: excludeIds — ติ๊กกลับ → หลุดจาก excludeIds', () => {
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);

  eq(sel.excludeIds, []);
  eq(resolveSelectedCount(sel, TOTAL), TOTAL);
});

test('T3: excludeIds — เอาออกครบทุกใบ → idle ไม่ใช่ all-filtered ว่าง', () => {
  let sel = selectAllFiltered(TOTAL);
  for (const id of [...PAGE_1, ...PAGE_2]) sel = toggleRow(sel, id, TOTAL);

  eq(sel, createSelection());
  eq(resolveSelectedCount(sel, TOTAL), 0);
});

// ============================================================
// T4 — selectedCount
// ============================================================

test('T4: selectedCount — ครบทุกสถานะ', () => {
  eq(resolveSelectedCount(createSelection(), TOTAL), 0, 'idle = 0');
  eq(resolveSelectedCount(toggleRow(createSelection(), 'app-1', TOTAL), TOTAL), 1, 'explicit = ids.length');
  eq(resolveSelectedCount(selectAllFiltered(TOTAL), TOTAL), TOTAL, 'all-filtered = total');

  const excl = toggleRow(selectAllFiltered(TOTAL), 'app-1', TOTAL);
  eq(resolveSelectedCount(excl, TOTAL), TOTAL - 1, 'all-filtered หัก excludeIds');
});

test('T4: selectedCount — ไม่ติดลบเมื่อ excludeIds มากกว่ายอดรวม', () => {
  let sel = selectAllFiltered(TOTAL);
  for (const id of [...PAGE_1, ...PAGE_2]) sel = toggleRow(sel, id, TOTAL);
  // toggleRow คืน idle เมื่อครบ แต่ถ้ามี excludeIds ค้างจากที่อื่น count ต้องไม่ติดลบ
  const bogus = { state: 'all-filtered', ids: [], excludeIds: ['x', 'y', 'z'] } as ApplicationsSelection;
  eq(resolveSelectedCount(bogus, 2), 0);
});

test('T4: selectedCount — ข้อความสรุปอ่านรู้เรื่องทุกสถานะ', () => {
  eq(describeSelectionCount(createSelection(), TOTAL), 'ยังไม่ได้เลือก');
  eq(describeSelectionCount(toggleRow(createSelection(), 'app-1', TOTAL), TOTAL), 'เลือกไว้ 1 รายการ');
  eq(
    describeSelectionCount(selectAllFiltered(TOTAL), TOTAL),
    `เลือกทั้งหมด ${TOTAL} รายการตามตัวกรอง`,
  );
  const excl = toggleRow(selectAllFiltered(TOTAL), 'app-1', TOTAL);
  eq(
    describeSelectionCount(excl, TOTAL),
    `เลือกทั้งหมด ${TOTAL - 1} รายการตามตัวกรอง (ยกเว้น 1)`,
  );
});

// ============================================================
// T5 — page change
// ============================================================

test('T5: page change — explicit selection คงอยู่ครบ (ids ไม่หาย)', () => {
  const prev = listState({ page: 1 });
  let sel = createSelection();
  for (const id of ['app-1', 'app-2', 'app-11']) sel = toggleRow(sel, id, TOTAL);

  const after = afterListChange(sel, prev, { page: 2 });

  eq(after, sel, 'selection object ต้องไม่ถูกแตะ');
  eq(after.ids, ['app-1', 'app-2', 'app-11'], 'id ข้ามหน้ายังอยู่');
  eq(resolveSelectedCount(after, TOTAL), 3);
});

test('T5: page change — all-filtered คงอยู่ และ count ยังอิง total ไม่ใช่จำนวนแถวบนหน้า', () => {
  const prev = listState({ page: 1 });
  const sel = selectAllFiltered(TOTAL);

  const after = afterListChange(sel, prev, { page: 2 });

  eq(after.state, 'all-filtered');
  eq(resolveSelectedCount(after, TOTAL), TOTAL, 'count = 13 ไม่ใช่ 3 ของหน้า 2');
  ok(PAGE_2.every((id) => isRowSelected(after, id)), 'แถวหน้า 2 ต้องถูกเลือก');
});

test('T5: page change — excludeIds คงอยู่ และแถวที่เอาออกยังไม่ถูกเลือกบนหน้าถัดไป', () => {
  const prev = listState({ page: 1 });
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-11', TOTAL); // เอาออกใบที่อยู่หน้า 2

  const after = afterListChange(sel, prev, { page: 2 });

  eq(after.excludeIds, ['app-11']);
  ok(!isRowSelected(after, 'app-11'), 'แถวที่เอาออกต้องไม่ถูกเลือกหลังเปลี่ยนหน้า');
  ok(isRowSelected(after, 'app-12'), 'แถวอื่นบนหน้า 2 ยังถูกเลือก');
  eq(resolveSelectedCount(after, TOTAL), TOTAL - 1);
});

test('T5: page change — selector ไม่เปลี่ยน (page ไม่ใช่ส่วนหนึ่งของ selector)', () => {
  const prev = listState({ page: 1 });
  const sel = selectAllFiltered(TOTAL);
  const before = buildSelectionSelector(sel, filterOf(prev));

  const next = applyListStatePatch(prev, { page: 3 });
  const after = buildSelectionSelector(sel, filterOf(next));

  eq(after, before, 'selector ต้องเหมือนเดิมทุก field');
  ok(!JSON.stringify(after).includes('page'), 'selector ต้องไม่มี page');
});

test('T5: page change — header state คำนวณจากแถวของหน้าปัจจุบัน', () => {
  const sel = selectAllFiltered(TOTAL);
  ok(isHeaderChecked(sel, PAGE_1, TOTAL));
  ok(isHeaderChecked(sel, PAGE_2, TOTAL), 'หน้า 2 ก็ checked เพราะทั้งชุดถูกเลือก');
});

// ============================================================
// T6 — pageSize change
// ============================================================

test('T6: pageSize change — selection คงอยู่ครบ', () => {
  const prev = listState({ page: 3, pageSize: 10 });
  let sel = createSelection();
  for (const id of ['app-1', 'app-2']) sel = toggleRow(sel, id, TOTAL);

  const after = afterListChange(sel, prev, { pageSize: 50 });

  eq(after, sel, 'selection object ต้องไม่ถูกแตะ');
  eq(resolveSelectedCount(after, TOTAL), 2);
});

test('T6: pageSize change — all-filtered + excludeIds คงอยู่ครบ', () => {
  const prev = listState({ page: 2, pageSize: 10 });
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-3', TOTAL);

  const after = afterListChange(sel, prev, { pageSize: 100 });

  eq(after.state, 'all-filtered');
  eq(after.excludeIds, ['app-3']);
  eq(resolveSelectedCount(after, TOTAL), TOTAL - 1);
});

test('T6: pageSize change — page ถูกรีเซ็ตเป็น 1 แต่ selection ไม่ถูกล้าง', () => {
  const prev = listState({ page: 7, pageSize: 10 });
  const sel = selectAllFiltered(TOTAL);

  const next = applyListStatePatch(prev, { pageSize: 50 });
  eq(next.page, 1, 'pageSize เปลี่ยน → page = 1');
  ok(!shouldClearSelection(prev, next), 'pageSize ไม่ใช่เหตุล้าง selection');
});

test('T6: pageSize change — selector ไม่เปลี่ยน', () => {
  const prev = listState({ pageSize: 10 });
  const sel = selectAllFiltered(TOTAL);
  const before = buildSelectionSelector(sel, filterOf(prev));

  const next = applyListStatePatch(prev, { pageSize: 100 });
  eq(buildSelectionSelector(sel, filterOf(next)), before);
});

// ============================================================
// T7 — sort change
// ============================================================

test('T7: sort change — explicit selection คงอยู่ครบ', () => {
  const prev = listState({ sort: 'submittedAt-desc' });
  let sel = createSelection();
  for (const id of ['app-1', 'app-5']) sel = toggleRow(sel, id, TOTAL);

  const after = afterListChange(sel, prev, { sort: 'fullname-asc' });

  eq(after, sel);
  eq(after.ids, ['app-1', 'app-5'], 'ลำดับที่ติ๊กต้องไม่ถูกเรียงใหม่');
});

test('T7: sort change — all-filtered + excludeIds คงอยู่ครบ', () => {
  const prev = listState({ sort: 'submittedAt-desc' });
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-4', TOTAL);

  const after = afterListChange(sel, prev, { sort: 'fullname-desc' });

  eq(after.excludeIds, ['app-4']);
  eq(resolveSelectedCount(after, TOTAL), TOTAL - 1);
});

test('T7: sort change — selector ไม่เปลี่ยน (selector นิยามชุด ไม่ใช่ลำดับ)', () => {
  const prev = listState({ sort: 'submittedAt-desc' });
  const sel = selectAllFiltered(TOTAL);
  const before = buildSelectionSelector(sel, filterOf(prev));

  const next = applyListStatePatch(prev, { sort: 'fullname-asc' });
  const after = buildSelectionSelector(sel, filterOf(next));

  eq(after, before);
  ok(!JSON.stringify(after).includes('sort'), 'selector ต้องไม่มี sort');
});

test('T7: sort change — page ถูกรีเซ็ตเป็น 1 แต่ selection ไม่ถูกล้าง', () => {
  const prev = listState({ page: 4 });
  const next = applyListStatePatch(prev, { sort: 'fullname-asc' });

  eq(next.page, 1);
  ok(!shouldClearSelection(prev, next));
});

// ============================================================
// T8 — filter change
// ============================================================

test('T8: filter change (status) — selection ถูกล้างเป็น idle', () => {
  const prev = listState({ status: 'ALL' });
  let sel = createSelection();
  for (const id of ['app-1', 'app-2']) sel = toggleRow(sel, id, TOTAL);

  const after = afterListChange(sel, prev, { status: 'QUALIFIED' });

  eq(after, createSelection(), 'ต้องกลับเป็น idle');
  eq(resolveSelectedCount(after, TOTAL), 0);
  eq(buildSelectionSelector(after, filterOf(listState({ status: 'QUALIFIED' }))), null,
    'selector ต้องเป็น null → ปุ่ม disable');
});

test('T8: filter change (search) — selection ถูกล้าง', () => {
  const prev = listState({ search: '' });
  const sel = selectAllFiltered(TOTAL);

  const after = afterListChange(sel, prev, { search: 'สมชาย' });

  eq(after, createSelection());
  ok(!isHeaderChecked(after, PAGE_1, TOTAL));
  ok(!isHeaderIndeterminate(after, PAGE_1, TOTAL));
});

test('T8: filter change (round) — selection ถูกล้าง', () => {
  const prev = listState({ roundId: 'round-1' });
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-1', TOTAL);

  const after = afterListChange(sel, prev, { roundId: 'round-2' });

  eq(after, createSelection(), 'all-filtered + excludeIds ต้องถูกล้างทั้งก้อน');
});

test('T8: filter change — หลังล้างแล้วเริ่มเลือกใหม่ได้ปกติ (ไม่มี residue)', () => {
  const prev = listState({ status: 'ALL' });
  const cleared = afterListChange(selectAllFiltered(TOTAL), prev, { status: 'REJECTED' });

  const fresh = toggleRow(cleared, 'app-7', TOTAL);
  eq(fresh.state, 'explicit');
  eq(fresh.ids, ['app-7'], 'ต้องไม่มี excludeIds ค้างจากชุดเดิม');
  eq(fresh.excludeIds, []);
});

test('T8: filter change — page ถูกรีเซ็ตเป็น 1 ด้วย', () => {
  const prev = listState({ page: 6 });
  eq(applyListStatePatch(prev, { status: 'QUALIFIED' }).page, 1);
  eq(applyListStatePatch(prev, { search: 'x' }).page, 1);
  eq(applyListStatePatch(prev, { roundId: 'round-2' }).page, 1);
});

// ============================================================
// T9 — ลำดับต่อเนื่อง (page → pageSize → sort) ไม่สะสมความเพี้ยน
// ============================================================

test('T9: เปลี่ยน page → pageSize → sort ต่อกัน — selection ยังเหมือนเดิมเป๊ะ', () => {
  let state = listState({ page: 1, pageSize: 10, sort: 'submittedAt-desc' });
  let sel = selectAllFiltered(TOTAL);
  sel = toggleRow(sel, 'app-2', TOTAL);
  const original = JSON.parse(JSON.stringify(sel));

  for (const patch of [{ page: 2 }, { pageSize: 50 }, { sort: 'fullname-asc' }]) {
    sel = afterListChange(sel, state, patch);
    state = applyListStatePatch(state, patch);
  }

  eq(sel, original, 'selection ต้องไม่เปลี่ยนเลยตลอดสามครั้ง');
  eq(resolveSelectedCount(sel, TOTAL), TOTAL - 1);
});

test('T9: เปลี่ยน page หลายรอบ — count ไม่ขึ้นกับหน้าปัจจุบัน', () => {
  const sel = selectAllFiltered(TOTAL);
  let state = listState({ page: 1 });

  for (const page of [2, 1, 2, 1]) {
    state = applyListStatePatch(state, { page });
    eq(resolveSelectedCount(sel, TOTAL), TOTAL, `หน้า ${page}: count ต้องคงเป็น ${TOTAL}`);
  }
});

console.log('\n=================================================');
console.log(`ผลการทดสอบ: ผ่าน ${passed} / FAIL ${failed}`);
if (failed > 0) {
  console.log('รายการที่ล้ม:');
  for (const f of failures) console.log(`  - ${f}`);
  console.log('มีกรณีที่ไม่ผ่าน ❌');
  process.exit(1);
}
console.log('ทุกกรณีผ่าน ✅');
