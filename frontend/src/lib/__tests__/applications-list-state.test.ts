/**
 * Applications List — list state machine (Phase 3) tests
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/applications-list-state.test.ts
 *
 * ครอบคลุม 6 ข้อที่สเปก Phase 3 บังคับ:
 *   LS1. page change        — เปลี่ยนหน้าได้, pageSize คงเดิม, selection ไม่หาย
 *   LS2. pageSize change    — กลับหน้า 1 เสมอ, selection ไม่หาย
 *   LS3. sort change        — กลับหน้า 1, selection ไม่หาย
 *   LS4. URL hydrate        — อ่านครบ 6 มิติ + เขียนกลับแล้วอ่านได้เท่าเดิม
 *   LS5. page=999 clamp     — หน้าเกินช่วงถูกลดเป็นหน้าสุดท้าย
 *   LS6. selection survives — selection คงอยู่ข้าม page/pageSize/sort
 *                             และถูกล้างเฉพาะ round/search/status
 *
 * เพิ่มเติม: request key + stale guard (กัน response เก่าทับใหม่)
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  applyListStatePatch,
  buildListStateUrlPatch,
  buildRequestKey,
  createRequestGuard,
  hydrateListState,
  isInitialRoundHydration,
  isPageResettingChange,
  resolvePageAfterResponse,
  shouldClearSelection,
  type ApplicationsListState,
} from '../applications-list-state';

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

/** state ตั้งต้นที่ใช้บ่อย */
function base(over: Partial<ApplicationsListState> = {}): ApplicationsListState {
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

console.log('=================================================');
console.log('Phase 3: Applications List state — Tests');
console.log('=================================================\n');

// ============================================================
// LS1 — page change
// ============================================================

test('LS1: เปลี่ยนหน้า → page ใหม่, pageSize/sort/ตัวกรองคงเดิม', () => {
  const prev = base({ page: 1, pageSize: 25, sort: 'fullname-asc' });
  const next = applyListStatePatch(prev, { page: 3 });
  eq(next.page, 3);
  eq(next.pageSize, 25, 'pageSize ต้องไม่เปลี่ยน');
  eq(next.sort, 'fullname-asc', 'sort ต้องไม่เปลี่ยน');
  eq(next.roundId, 'round-1');
});

test('LS1: เปลี่ยนหน้าไม่ใช่เหตุให้ reset page (ไม่วนกลับหน้า 1)', () => {
  const prev = base({ page: 2 });
  const next = applyListStatePatch(prev, { page: 5 });
  eq(next.page, 5);
  ok(!isPageResettingChange(prev, next), 'page change ไม่ควรนับเป็น page-resetting');
});

test('LS1: page change ไม่ล้าง selection', () => {
  const prev = base({ page: 1 });
  const next = applyListStatePatch(prev, { page: 2 });
  ok(!shouldClearSelection(prev, next), 'selection ต้องคงอยู่ข้ามหน้า');
});

// ============================================================
// LS2 — pageSize change
// ============================================================

test('LS2: เปลี่ยน pageSize → กลับหน้า 1 เสมอ', () => {
  const prev = base({ page: 7, pageSize: 10 });
  const next = applyListStatePatch(prev, { pageSize: 50 });
  eq(next.pageSize, 50);
  eq(next.page, 1, 'pageSize เปลี่ยน → page = 1');
});

test('LS2: pageSize เท่าเดิม → ไม่ reset page', () => {
  const prev = base({ page: 4, pageSize: 25 });
  const next = applyListStatePatch(prev, { pageSize: 25 });
  eq(next.page, 4, 'pageSize ไม่เปลี่ยน → page คงเดิม');
});

test('LS2: pageSize change ไม่ล้าง selection', () => {
  const prev = base({ page: 3, pageSize: 10 });
  const next = applyListStatePatch(prev, { pageSize: 100 });
  ok(!shouldClearSelection(prev, next), 'selection ต้องคงอยู่เมื่อเปลี่ยน pageSize');
});

test('LS2: pageSize เปลี่ยนพร้อมส่ง page มาด้วย → page = 1 ชนะ', () => {
  const prev = base({ page: 5, pageSize: 10 });
  const next = applyListStatePatch(prev, { pageSize: 25, page: 9 });
  eq(next.page, 1, 'pageSize เปลี่ยนทับ page ที่ส่งมา');
  eq(next.pageSize, 25);
});

// ============================================================
// LS3 — sort change
// ============================================================

test('LS3: เปลี่ยน sort → กลับหน้า 1', () => {
  const prev = base({ page: 6 });
  const next = applyListStatePatch(prev, { sort: 'fullname-asc' });
  eq(next.sort, 'fullname-asc');
  eq(next.page, 1, 'sort เปลี่ยน → page = 1');
});

test('LS3: sort change ไม่ล้าง selection', () => {
  const prev = base({ page: 2 });
  const next = applyListStatePatch(prev, { sort: 'submittedAt-asc' });
  ok(!shouldClearSelection(prev, next), 'selection ต้องคงอยู่เมื่อเปลี่ยน sort');
});

test('LS3: sort ทุกค่าเป็น page-resetting change', () => {
  // เริ่มจาก sort ที่ "ไม่ใช่" ค่าที่จะเปลี่ยนไป เพื่อให้ทุกกรณีเป็นการเปลี่ยนจริง
  const prev = base({ page: 3, sort: 'submittedAt-desc' });
  for (const sort of ['submittedAt-asc', 'fullname-asc', 'fullname-desc', 'submittedAt-desc']) {
    const next = applyListStatePatch(prev, { sort });
    eq(next.page, 1, `sort=${sort} → page 1`);
    ok(isPageResettingChange(prev, next), `sort=${sort} ต้องนับเป็น page-resetting`);
    // ค่าถัดไปต้องต่างจากรอบก่อน ไม่งั้นรอบถัดไปจะไม่ใช่การเปลี่ยน
    prev.sort = sort;
  }
});

// ============================================================
// LS4 — URL hydrate
// ============================================================

test('LS4: hydrate ครบทั้ง 6 มิติจาก URL', () => {
  const params = new URLSearchParams(
    'round=r9&q=สมชาย&status=approved&sort=fullname-desc&page=4&pageSize=25',
  );
  eq(hydrateListState(params), {
    roundId: 'r9',
    search: 'สมชาย',
    status: 'QUALIFIED',
    sort: 'fullname-desc',
    page: 4,
    pageSize: 25,
  });
});

test('LS4: hydrate URL ว่าง → ค่า default ทั้งหมด', () => {
  eq(hydrateListState(new URLSearchParams('')), {
    roundId: '',
    search: '',
    status: 'ALL',
    sort: 'submittedAt-desc',
    page: 1,
    pageSize: 10,
  });
});

test('LS4: hydrate ค่าเพี้ยน → fallback ไม่ throw', () => {
  const params = new URLSearchParams(
    'sort=bogus&page=abc&pageSize=999&status=nonsense',
  );
  const s = hydrateListState(params);
  eq(s.sort, 'submittedAt-desc', 'sort เพี้ยน → default');
  eq(s.page, 1, 'page เพี้ยน → 1');
  eq(s.pageSize, 10, 'pageSize นอกชุด → 10');
  eq(s.status, 'ALL', 'status เพี้ยน → ALL');
});

test('LS4: hydrate legacy ?view=archived ได้ (backward compatible)', () => {
  eq(hydrateListState(new URLSearchParams('view=archived')).status, 'ARCHIVED');
});

test('LS4: เขียน URL แล้วอ่านกลับ ได้ state เดิม (round-trip)', () => {
  const cases: ApplicationsListState[] = [
    base(),
    base({ page: 3, pageSize: 50 }),
    base({ roundId: 'r2', search: 'สมชาย', status: 'QUALIFIED', sort: 'fullname-asc', page: 2, pageSize: 25 }),
    base({ status: 'ARCHIVED', sort: 'submittedAt-asc', page: 9, pageSize: 100 }),
  ];
  for (const state of cases) {
    const patch = buildListStateUrlPatch(state);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(patch)) {
      if (v !== null && v !== '') params.set(k, v);
    }
    eq(hydrateListState(params), state, `round-trip ${JSON.stringify(state)}`);
  }
});

test('LS4: ค่า default ไม่ถูกเขียนลง URL', () => {
  const patch = buildListStateUrlPatch(base());
  eq(patch.page, null, 'page=1 ไม่เขียน');
  eq(patch.pageSize, null, 'pageSize=10 ไม่เขียน');
  eq(patch.sort, null, 'sort default ไม่เขียน');
  eq(patch.status, null, 'status ALL ไม่เขียน');
  eq(patch.q, null, 'search ว่างไม่เขียน');
});

// ============================================================
// LS5 — page=999 clamp
// ============================================================

test('LS5: page=999 แต่มี 3 หน้า → ลดเป็นหน้า 3', () => {
  eq(resolvePageAfterResponse(999, 3), 3);
});

test('LS5: page อยู่ในช่วง → null (ไม่ต้องแก้)', () => {
  eq(resolvePageAfterResponse(1, 3), null);
  eq(resolvePageAfterResponse(3, 3), null);
});

test('LS5: totalPages = 0 (ไม่มีข้อมูล) → ลดเป็นหน้า 1', () => {
  eq(resolvePageAfterResponse(5, 0), 1);
});

test('LS5: hydrate page=999 จาก URL แล้ว clamp ด้วย totalPages จาก server', () => {
  const state = hydrateListState(new URLSearchParams('page=999&pageSize=10'));
  eq(state.page, 999, 'hydrate เก็บค่าตาม URL');
  const target = resolvePageAfterResponse(state.page, 3);
  eq(target, 3, 'หลังได้ totalPages จาก server → clamp');
});

// ============================================================
// LS6 — selection survives page change
// ============================================================

test('LS6: selection คงอยู่ข้าม page / pageSize / sort', () => {
  const prev = base({ page: 1 });
  const changes: Array<[string, any]> = [
    ['page', { page: 2 }],
    ['pageSize', { pageSize: 50 }],
    ['sort', { sort: 'fullname-desc' }],
  ];
  for (const [label, patch] of changes) {
    const next = applyListStatePatch(prev, patch);
    ok(!shouldClearSelection(prev, next), `เปลี่ยน ${label} ต้องไม่ล้าง selection`);
  }
});

test('LS6: selection ถูกล้างเมื่อเปลี่ยน round / search / status', () => {
  const prev = base();
  ok(shouldClearSelection(prev, applyListStatePatch(prev, { roundId: 'round-2' })), 'round เปลี่ยน → ล้าง');
  ok(shouldClearSelection(prev, applyListStatePatch(prev, { search: 'สมชาย' })), 'search เปลี่ยน → ล้าง');
  ok(shouldClearSelection(prev, applyListStatePatch(prev, { status: 'QUALIFIED' })), 'status เปลี่ยน → ล้าง');
});

test('LS6: เปลี่ยน round/search/status → page = 1 ด้วย', () => {
  const prev = base({ page: 5 });
  for (const patch of [{ roundId: 'round-2' }, { search: 'x' }, { status: 'REJECTED' as const }]) {
    eq(applyListStatePatch(prev, patch).page, 1, `patch ${JSON.stringify(patch)} → page 1`);
  }
});

test('LS6: init หลัง restore จาก URL (roundId "" → ค่าแรก) ไม่ถือเป็นการเปลี่ยนรอบ', () => {
  const prev = base({ roundId: '', page: 4 });
  const next = applyListStatePatch(prev, { roundId: 'round-1' });
  ok(isInitialRoundHydration(prev, next), 'ต้องตรวจได้ว่าเป็นการ init');
  // caller ใช้ preservePage เพื่อคงหน้าที่ restore มา
  const preserved = applyListStatePatch(prev, { roundId: 'round-1' }, { preservePage: true });
  eq(preserved.page, 4, 'page ที่ restore จาก URL ต้องไม่ถูก reset');
});

// ============================================================
// Request key + stale guard
// ============================================================

test('key: ครบ 6 มิติ — เปลี่ยนมิติใดมิติหนึ่ง key ต้องเปลี่ยน', () => {
  const baseKey = buildRequestKey(base());
  const variants: Array<[string, any]> = [
    ['roundId', { roundId: 'round-2' }],
    ['search', { search: 'abc' }],
    ['status', { status: 'QUALIFIED' }],
    ['sort', { sort: 'fullname-asc' }],
    ['page', { page: 2 }],
    ['pageSize', { pageSize: 50 }],
  ];
  for (const [label, patch] of variants) {
    ok(buildRequestKey(base(patch)) !== baseKey, `เปลี่ยน ${label} → key ต้องต่าง`);
  }
  eq(buildRequestKey(base()), baseKey, 'state เดิม → key เดิม');
});

test('key: search ถูก trim ก่อนเทียบ (ช่องว่างหัวท้ายไม่ทำให้ยิงซ้ำ)', () => {
  eq(buildRequestKey(base({ search: '  abc  ' })), buildRequestKey(base({ search: 'abc' })));
});

test('guard: response ของ request เก่าถูกทิ้ง', () => {
  const guard = createRequestGuard();
  const k1 = guard.begin(base({ page: 1 }));
  const k2 = guard.begin(base({ page: 2 }));
  ok(!guard.isCurrent(k1), 'key เก่าต้องไม่ current');
  ok(guard.isCurrent(k2), 'key ใหม่ต้อง current');
});

test('guard: request เดียวกัน (ยิงซ้ำ) ยังถือว่า current', () => {
  const guard = createRequestGuard();
  const k = guard.begin(base({ page: 1 }));
  ok(guard.isCurrent(k), 'key ที่เพิ่งเริ่มต้อง current');
  eq(guard.current(), k);
});

test('guard: ยังไม่เริ่ม request → ไม่มี key ใด current', () => {
  const guard = createRequestGuard();
  eq(guard.current(), null);
  ok(!guard.isCurrent('anything'), 'ก่อนเริ่ม ต้องไม่มี key current');
});

test('guard: จำลอง race — filter เปลี่ยนแล้ว page reset ทำให้มี 2 request', () => {
  const guard = createRequestGuard();
  // ผู้ใช้เปลี่ยน status (หน้า 3) → effect reset page เป็น 1
  const stale = guard.begin(base({ page: 3, status: 'QUALIFIED' }));
  const fresh = guard.begin(base({ page: 1, status: 'QUALIFIED' }));
  ok(!guard.isCurrent(stale), 'response ของหน้า 3 ต้องถูกทิ้ง');
  ok(guard.isCurrent(fresh), 'response ของหน้า 1 ต้องถูกใช้');
});

console.log('\n=================================================');
console.log(`ผลการทดสอบ: ผ่าน ${passed} / FAIL ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('ทุกกรณีผ่าน ✅');
