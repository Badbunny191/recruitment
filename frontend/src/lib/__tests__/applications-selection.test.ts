/**
 * Phase 2: Applications Selection (client) — tests
 * =======================================================================
 *
 * สิ่งที่ต้องพิสูจน์:
 *   AS1.  resolveSelectionState: idle / explicit / all-filtered
 *   AS2.  all-filtered ชนะ explicit (ชุดที่กว้างกว่า)
 *   AS3.  buildApplicationsSelector: idle → null
 *   AS4.  buildApplicationsSelector: explicit → kind ids
 *   AS5.  buildApplicationsSelector: all-filtered → kind filter + status/search
 *   AS6.  all-filtered ที่ไม่มี roundId → null (ยิงไม่ได้)
 *   AS7.  status ALL → status = null (ไม่ส่ง status ที่ไม่มีความหมาย)
 *   AS8.  search ว่าง/whitespace → null
 *   AS9.  buildBulkStatusPayload: รูป payload ถูกต้อง + reason
 *   AS10. buildExportSelectedPayload: มี roundId + selector
 *   AS11. canSubmitSelection / describeSelection
 *   AS12. EQUIVALENCE: explicit กับ all-filtered ที่ชุดเดียวกัน → ชุด id ตรงกัน
 *         (ยืนยันว่า selector สองแบบอธิบาย "ชุด" เดียวกันได้)
 *
 * รัน: node --import tsx src/lib/__tests__/applications-selection.test.ts
 */

// @ts-nocheck — tsx run-time
import {
  buildApplicationsSelector,
  buildBulkStatusPayload,
  buildExportSelectedPayload,
  canSubmitSelection,
  describeSelection,
  resolveSelectionState,
} from '../applications-selection';

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

console.log('=================================================');
console.log('Phase 2: Applications Selection (client) — Tests');
console.log('=================================================\n');

// ── AS1 ────────────────────────────────────────────────────────────────────
test('AS1: resolveSelectionState — idle / explicit / all-filtered', () => {
  assertEqual(resolveSelectionState(new Set(), false), 'idle');
  assertEqual(resolveSelectionState(new Set(['a']), false), 'explicit');
  assertEqual(resolveSelectionState(new Set(), true), 'all-filtered');
});

// ── AS2 ────────────────────────────────────────────────────────────────────
test('AS2: all-filtered ชนะ explicit (ชุดที่กว้างกว่า)', () => {
  assertEqual(resolveSelectionState(new Set(['a', 'b']), true), 'all-filtered');
});

// ── AS3 ────────────────────────────────────────────────────────────────────
test('AS3: idle → selector null', () => {
  assertEqual(buildApplicationsSelector('idle', new Set(), FILTER), null);
});

// ── AS4 ────────────────────────────────────────────────────────────────────
test('AS4: explicit → kind ids', () => {
  const sel = buildApplicationsSelector('explicit', new Set(['a1', 'a2']), FILTER);
  assertEqual(sel, { kind: 'ids', ids: ['a1', 'a2'] });
});

// ── AS5 ────────────────────────────────────────────────────────────────────
test('AS5: all-filtered → kind filter + status/search', () => {
  const sel = buildApplicationsSelector('all-filtered', new Set(), {
    roundId: 'round-1',
    statusFilter: 'QUALIFIED',
    search: 'สมชาย',
  });
  assertEqual(sel, {
    kind: 'filter',
    roundId: 'round-1',
    status: 'QUALIFIED',
    search: 'สมชาย',
  });
});

// ── AS6 ────────────────────────────────────────────────────────────────────
test('AS6: all-filtered ที่ไม่มี roundId → null', () => {
  assertEqual(
    buildApplicationsSelector('all-filtered', new Set(), { ...FILTER, roundId: '' }),
    null,
  );
  assertEqual(
    buildApplicationsSelector('all-filtered', new Set(), { ...FILTER, roundId: '   ' }),
    null,
    'roundId whitespace ต้อง null',
  );
});

// ── AS7 ────────────────────────────────────────────────────────────────────
test('AS7: status ALL → status null (ไม่ส่งค่าที่ไม่มีความหมาย)', () => {
  const sel = buildApplicationsSelector('all-filtered', new Set(), FILTER);
  assertEqual(sel.status, null);
});

// ── AS8 ────────────────────────────────────────────────────────────────────
test('AS8: search ว่าง/whitespace → null', () => {
  const empty = buildApplicationsSelector('all-filtered', new Set(), { ...FILTER, search: '' });
  assertEqual(empty.search, null);
  const spaces = buildApplicationsSelector('all-filtered', new Set(), { ...FILTER, search: '   ' });
  assertEqual(spaces.search, null);
});

// ── AS9 ────────────────────────────────────────────────────────────────────
test('AS9: buildBulkStatusPayload — payload ถูกต้อง + reason', () => {
  const p = buildBulkStatusPayload('explicit', new Set(['a1']), FILTER, 'REJECTED', ' เอกสารไม่ครบ ');
  assertEqual(p, {
    selector: { kind: 'ids', ids: ['a1'] },
    status: 'REJECTED',
    reason: 'เอกสารไม่ครบ',
  });

  // ไม่มี reason → ไม่มี key reason
  const noReason = buildBulkStatusPayload('explicit', new Set(['a1']), FILTER, 'QUALIFIED');
  assertTrue(!('reason' in noReason), 'ไม่ส่ง reason เมื่อว่าง');

  // idle → null
  assertEqual(buildBulkStatusPayload('idle', new Set(), FILTER, 'QUALIFIED'), null);
});

// ── AS10 ───────────────────────────────────────────────────────────────────
test('AS10: buildExportSelectedPayload — มี roundId + selector', () => {
  const p = buildExportSelectedPayload('all-filtered', new Set(), {
    roundId: 'round-9',
    statusFilter: 'SUBMITTED',
    search: '',
  });
  assertEqual(p, {
    roundId: 'round-9',
    selector: { kind: 'filter', roundId: 'round-9', status: 'SUBMITTED', search: null },
  });

  assertEqual(buildExportSelectedPayload('idle', new Set(), FILTER), null);
});

// ── AS11 ───────────────────────────────────────────────────────────────────
test('AS11: canSubmitSelection / describeSelection', () => {
  assertEqual(canSubmitSelection('idle', new Set(), FILTER), false);
  assertEqual(canSubmitSelection('explicit', new Set(['a']), FILTER), true);
  assertEqual(canSubmitSelection('all-filtered', new Set(), FILTER), true);
  assertEqual(
    canSubmitSelection('all-filtered', new Set(), { ...FILTER, roundId: '' }),
    false,
    'all-filtered ไม่มี roundId → ยิงไม่ได้',
  );

  assertEqual(describeSelection('idle', new Set()), 'ยังไม่ได้เลือก');
  assertEqual(describeSelection('explicit', new Set(['a', 'b'])), 'เลือกไว้ 2 รายการ');
  assertEqual(describeSelection('all-filtered', new Set()), 'ทุกใบที่ตรงกับตัวกรอง');
});

// ── AS12 ───────────────────────────────────────────────────────────────────
test('AS12: EQUIVALENCE — explicit กับ all-filtered อธิบายชุดเดียวกันได้', () => {
  // สมมติ server ตอบว่า filter ตรงกับ a1,a2 → client สร้าง selector สองแบบ
  const explicit = buildApplicationsSelector('explicit', new Set(['a1', 'a2']), FILTER);
  const allFiltered = buildApplicationsSelector('all-filtered', new Set(), FILTER);

  assertEqual(explicit.kind, 'ids', 'explicit = ids');
  assertEqual(allFiltered.kind, 'filter', 'all-filtered = filter');

  // ทั้งสองต้องผูกกับรอบเดียวกัน (selector ไม่มีแนวคิดเรื่องหน้า)
  assertEqual(allFiltered.roundId, FILTER.roundId, 'filter ผูกกับรอบปัจจุบัน');
  assertEqual(explicit.ids.length, 2, 'ids ครบตามที่เลือก');
});

console.log('');
if (failed > 0) {
  console.log(`FAILED: ${failed}/${passed + failed}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED: ${passed}/${passed + failed}`);
