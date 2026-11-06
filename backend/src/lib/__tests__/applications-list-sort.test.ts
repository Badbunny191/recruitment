/**
 * Applications List Sort — pure function tests
 * =============================================================================
 * branch: feature/applications-sort-export-wysiwyg
 *
 * ครอบคลุม (ระดับ unit — พฤติกรรม end-to-end มี route tests ครอบแล้ว):
 *   SF1. whitelist 6 sort ids ตรงกับ SortDropdown ฝั่ง FE ทุกตัว
 *   SF2. default = applicationNo-desc (เลขที่ใบสมัคร ใหม่ → เก่า)
 *   SF3. parseApplicationsListSort: ทุก id + ค่าไม่รู้จัก/ว่าง/ไม่ส่ง → default
 *   SF4. applicationsListSortId: round-trip ครบทุก whitelist
 *   SF5. extractRunningNumber (JS mirror ของ SQL expr): seq มาก่อน parse,
 *        APP-/pattern/เลขเกิน 9999, ไม่มีเลข → null, 0 → null
 *
 * รัน: node --import tsx src/lib/__tests__/applications-list-sort.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import {
  APPLICATIONS_LIST_SORT_IDS,
  APPLICATIONS_LIST_SORT_DEFAULT,
  parseApplicationsListSort,
  applicationsListSortId,
} from '../applications-list-query';
import { extractRunningNumber } from '../../utils/application-no';

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

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runAllTests() {
  console.log('=================================================');
  console.log('Applications List Sort — pure function tests');
  console.log('=================================================\n');

  // ---- SF1: whitelist 6 ตัว ----
  test('SF1: whitelist ครบ 6 sort ids (ตรงกับ FE SortDropdown)', () => {
    assertDeepEqual([...APPLICATIONS_LIST_SORT_IDS], [
      'applicationNo-desc',
      'applicationNo-asc',
      'submittedAt-desc',
      'submittedAt-asc',
      'fullname-asc',
      'fullname-desc',
    ]);
  });

  // ---- SF2: default ----
  test('SF2: default = applicationNo-desc', () => {
    assertEqual(APPLICATIONS_LIST_SORT_DEFAULT, 'applicationNo-desc');
  });

  // ---- SF3: parse ทุก id + fallback ----
  test('SF3: parseApplicationsListSort ทุก id ตรง + ค่าไม่รู้จัก/ว่าง/ไม่ส่ง → default', () => {
    assertDeepEqual(parseApplicationsListSort('applicationNo-desc'), { field: 'applicationNo', direction: 'desc' });
    assertDeepEqual(parseApplicationsListSort('applicationNo-asc'), { field: 'applicationNo', direction: 'asc' });
    assertDeepEqual(parseApplicationsListSort('submittedAt-asc'), { field: 'submittedAt', direction: 'asc' });
    assertDeepEqual(parseApplicationsListSort('fullname-desc'), { field: 'fullname', direction: 'desc' });

    const def = { field: 'applicationNo', direction: 'desc' };
    assertDeepEqual(parseApplicationsListSort('junk'), def, 'ค่าไม่รู้จัก → default');
    assertDeepEqual(parseApplicationsListSort(''), def, 'ว่าง → default');
    assertDeepEqual(parseApplicationsListSort(null), def, 'null → default');
    assertDeepEqual(parseApplicationsListSort(undefined), def, 'undefined → default');
    assertDeepEqual(parseApplicationsListSort('  applicationNo-asc  '), { field: 'applicationNo', direction: 'asc' }, 'trim รอบ ๆ');
  });

  // ---- SF4: round-trip ----
  test('SF4: applicationsListSortId round-trip ครบทุก whitelist', () => {
    for (const id of APPLICATIONS_LIST_SORT_IDS) {
      assertEqual(applicationsListSortId(parseApplicationsListSort(id)), id, `round-trip ${id}`);
    }
  });

  // ---- SF5: extractRunningNumber ----
  test('SF5: extractRunningNumber — seq มาก่อน parse เสมอ', () => {
    assertEqual(extractRunningNumber('APP-2569-0100', 50), 50, 'seq ชนะ parse');
    assertEqual(extractRunningNumber('APP-2569-0100', null), 100, 'ไม่มี seq → parse เลขท้าย');
    assertEqual(extractRunningNumber(null, 7), 7, 'ไม่มีเลขที่แต่มี seq');
    assertEqual(extractRunningNumber('SAO-0002', null), 2, 'pattern ไม่ใช่ APP- ก็ parse ได้');
    assertEqual(extractRunningNumber('APP-2569-12345', null), 12345, 'เลขเกิน 9999 ไม่ถูกตัด');
    assertEqual(extractRunningNumber('APP-2569-0000', null), null, 'parse ได้ 0 → null (ตรง NULLIF ฝั่ง SQL)');
    assertEqual(extractRunningNumber('SPECIAL', null), null, 'ไม่ลงท้ายเลข → null');
    assertEqual(extractRunningNumber('', null), null, 'เลขที่ว่าง → null');
    assertEqual(extractRunningNumber(null, null), null, 'ทั้งคู่ null');
    assertEqual(extractRunningNumber('APP-2569-0007', 0), 0, 'seq = 0 → ใช้ 0 ตรง COALESCE ฝั่ง SQL (ไม่มีใครผลิต แต่ mirror เป๊ะ)');
  });

  // ── สรุป ──
  console.log('\n=================================================');
  console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nที่ล้มเหลว:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('=================================================');

  if (failed > 0) process.exit(1);
}

runAllTests();
