/**
 * Applications List — query params + pagination state (Phase 1) tests
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/applications-list-params.test.ts
 *
 * ครอบคลุม:
 *   - sort: 4 ตัวเลือกเดิม, parse/normalize, fallback ค่าที่ไม่รู้จัก
 *   - page/pageSize: parse จาก URL, ค่าที่ไม่ valid → default, pageSize นอกชุด → 10
 *   - buildApplicationsListParams: ส่ง page/pageSize/sort ทุกครั้ง (ห้ามพึ่ง default
 *     ของ backend), search/status ส่งเมื่อมีค่า
 *   - readPagination: ใช้ค่าจาก server, fallback เมื่อไม่มี pagination
 *   - clampPage: หน้าเกินช่วง → หน้าสุดท้าย, ไม่เกิน → null
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  APPLICATIONS_PAGE_SIZE_DEFAULT,
  APPLICATIONS_PAGE_SIZE_OPTIONS,
  APPLICATIONS_SORT_DEFAULT,
  APPLICATIONS_SORT_OPTIONS,
  buildApplicationsListParams,
  clampPage,
  normalizeSortId,
  parsePage,
  parsePageSize,
  parseSortId,
  readPagination,
} from '../applications-list-params';

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

console.log('=================================================');
console.log('Phase 1: Applications List params — Tests');
console.log('=================================================\n');

// ============================================================
// sort options — 4 ตัวเดิมต้องไม่เปลี่ยน
// ============================================================

test('sort: มี 4 ตัวเลือกตามที่ UI เดิมมี', () => {
  eq(APPLICATIONS_SORT_OPTIONS.map((o) => o.id), [
    'submittedAt-desc',
    'submittedAt-asc',
    'fullname-asc',
    'fullname-desc',
  ]);
});

test('sort: label/direction ตรงกับของเดิม', () => {
  eq(
    APPLICATIONS_SORT_OPTIONS.map((o) => [o.label, o.field, o.direction]),
    [
      ['ล่าสุด', 'submittedAt', 'desc'],
      ['เก่าสุด', 'submittedAt', 'asc'],
      ['ชื่อ A-Z', 'fullname', 'asc'],
      ['ชื่อ Z-A', 'fullname', 'desc'],
    ],
  );
});

test('sort: default = submittedAt-desc', () => {
  eq(APPLICATIONS_SORT_DEFAULT, 'submittedAt-desc');
});

test('sort: parseSortId แยก field/direction ถูกทุกค่า', () => {
  eq(parseSortId('submittedAt-desc'), { field: 'submittedAt', direction: 'desc' });
  eq(parseSortId('submittedAt-asc'), { field: 'submittedAt', direction: 'asc' });
  eq(parseSortId('fullname-asc'), { field: 'fullname', direction: 'asc' });
  eq(parseSortId('fullname-desc'), { field: 'fullname', direction: 'desc' });
});

test('sort: parseSortId ค่าที่ไม่รู้จัก → submittedAt-desc', () => {
  for (const bad of ['', 'unknown', 'fullname', 'id-asc', 'submittedAt-up', '-desc']) {
    eq(parseSortId(bad), { field: 'submittedAt', direction: 'desc' }, `"${bad}"`);
  }
});

test('sort: normalizeSortId คืนค่าเดิมถ้ารู้จัก, default ถ้าไม่', () => {
  for (const o of APPLICATIONS_SORT_OPTIONS) {
    eq(normalizeSortId(o.id), o.id);
  }
  for (const bad of [null, undefined, '', 'bogus', 'fullname-up']) {
    eq(normalizeSortId(bad), APPLICATIONS_SORT_DEFAULT, `"${bad}"`);
  }
});

// ============================================================
// page / pageSize
// ============================================================

test('page: parse ค่าปกติ', () => {
  eq(parsePage('1'), 1);
  eq(parsePage('2'), 2);
  eq(parsePage('99'), 99);
});

test('page: ค่าที่ไม่ valid → 1', () => {
  for (const bad of [null, undefined, '', '0', '-3', 'abc', '1.5']) {
    eq(parsePage(bad), 1, `"${bad}"`);
  }
});

test('pageSize: รับเฉพาะค่าที่ UI เสนอ', () => {
  for (const size of APPLICATIONS_PAGE_SIZE_OPTIONS) {
    eq(parsePageSize(String(size)), size);
  }
});

test('pageSize: ค่าที่ไม่อยู่ในชุด/ไม่ valid → default 10', () => {
  for (const bad of [null, undefined, '', '0', '5', '20', '1000', 'abc']) {
    eq(parsePageSize(bad), APPLICATIONS_PAGE_SIZE_DEFAULT, `"${bad}"`);
  }
});

test('pageSize: default = 10 (ตรงกับ UI เดิม)', () => {
  eq(APPLICATIONS_PAGE_SIZE_DEFAULT, 10);
});

// ============================================================
// buildApplicationsListParams
// ============================================================

test('params: ส่ง page/pageSize/sort ทุกครั้ง (ห้ามพึ่ง default ของ backend)', () => {
  const p = buildApplicationsListParams({
    roundId: 'round-1',
    sort: 'submittedAt-desc',
    page: 1,
    pageSize: 10,
  });
  eq(p.get('roundId'), 'round-1');
  eq(p.get('page'), '1');
  eq(p.get('pageSize'), '10');
  eq(p.get('sort'), 'submittedAt-desc');
});

test('params: ไม่ส่ง search/status เมื่อไม่มีค่า', () => {
  const p = buildApplicationsListParams({
    roundId: 'r',
    search: '',
    status: null,
    sort: 'fullname-asc',
    page: 3,
    pageSize: 25,
  });
  eq(p.has('search'), false);
  eq(p.has('status'), false);
  eq(p.get('page'), '3');
  eq(p.get('pageSize'), '25');
});

test('params: ส่ง search (trim) และ status เมื่อมีค่า', () => {
  const p = buildApplicationsListParams({
    roundId: 'r',
    search: '  สมชาย  ',
    status: 'QUALIFIED',
    sort: 'fullname-desc',
    page: 2,
    pageSize: 50,
  });
  eq(p.get('search'), 'สมชาย');
  eq(p.get('status'), 'QUALIFIED');
});

test('params: search ที่เป็นช่องว่างล้วน → ไม่ส่ง', () => {
  const p = buildApplicationsListParams({
    roundId: 'r',
    search: '   ',
    sort: 'submittedAt-asc',
    page: 1,
    pageSize: 10,
  });
  eq(p.has('search'), false);
});

test('params: page/pageSize เป็น string ที่ parse กลับได้ตรง', () => {
  const p = buildApplicationsListParams({
    roundId: 'r',
    sort: 'submittedAt-desc',
    page: 7,
    pageSize: 100,
  });
  eq(parsePage(p.get('page')), 7);
  eq(parsePageSize(p.get('pageSize')), 100);
  eq(normalizeSortId(p.get('sort')), 'submittedAt-desc');
});

// ============================================================
// readPagination
// ============================================================

test('pagination: ใช้ค่าจาก server ตรง ๆ', () => {
  const out = readPagination(
    { data: [{}, {}], pagination: { page: 2, pageSize: 10, total: 137, totalPages: 14 } },
    1,
    10,
  );
  eq(out, { page: 2, pageSize: 10, total: 137, totalPages: 14 });
});

test('pagination: total เป็น 0 และ data ว่าง → totalPages = 1', () => {
  const out = readPagination(
    { data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } },
    1,
    10,
  );
  eq(out, { page: 1, pageSize: 10, total: 0, totalPages: 1 });
});

test('pagination: totalPages หายไป → คำนวณจาก total/pageSize', () => {
  const out = readPagination(
    { data: [], pagination: { page: 1, pageSize: 25, total: 51 } },
    1,
    25,
  );
  eq(out.totalPages, 3);
});

test('pagination: response ไม่มี pagination → fallback จากจำนวนแถว', () => {
  const out = readPagination({ data: [{}, {}, {}] }, 2, 10);
  eq(out, { page: 2, pageSize: 10, total: 3, totalPages: 1 });
});

test('pagination: response เพี้ยน (null) → fallback ไม่ throw', () => {
  eq(readPagination(null, 1, 10), { page: 1, pageSize: 10, total: 0, totalPages: 1 });
  eq(readPagination({}, 1, 10), { page: 1, pageSize: 10, total: 0, totalPages: 1 });
});

test('pagination: total มาจาก server ไม่ใช่ apps.length', () => {
  // หน้าปัจจุบันมี 10 แถว แต่ทั้งหมด 137 → total ต้องเป็น 137
  const out = readPagination(
    { data: new Array(10).fill({}), pagination: { page: 1, pageSize: 10, total: 137, totalPages: 14 } },
    1,
    10,
  );
  eq(out.total, 137);
  ok(out.total !== 10, 'total ต้องไม่ใช่จำนวนแถวที่โหลดมา');
});

// ============================================================
// clampPage
// ============================================================

test('clamp: หน้าเกินช่วง → หน้าสุดท้าย', () => {
  eq(clampPage(99, 3), 3);
  eq(clampPage(4, 3), 3);
});

test('clamp: หน้าอยู่ใน range → null (ไม่ต้องแก้)', () => {
  eq(clampPage(1, 3), null);
  eq(clampPage(3, 3), null);
});

test('clamp: totalPages เป็น 0/ติดลบ → 1', () => {
  eq(clampPage(2, 0), 1);
  eq(clampPage(2, -5), 1);
});

console.log('\n=================================================');
console.log(`ผลการทดสอบ: ผ่าน ${passed} / FAIL ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('ทุกกรณีผ่าน ✅');
