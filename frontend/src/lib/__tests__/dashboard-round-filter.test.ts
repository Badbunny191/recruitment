/**
 * Dashboard Round Filter — pure helper tests
 * -------------------------------------------
 * ครอบคลุม logic ของ dropdown filter รอบบน Executive Dashboard:
 *
 *   - parseDashboardRoundParam: ไม่มี param / มีค่า / ค่าว่าง → null
 *   - dashboardOverviewApiPath: path เดิมเมื่อไม่เลือก + ?roundId= (encode)
 *     เมื่อเลือก — ยังเป็น endpoint เดียว ไม่มี request ต่อ widget เพิ่ม
 *   - isRoundSelectable: self-heal predicate ของ URL ที่ชี้รอบที่ถูกลบ
 *     (rounds=null = ตัดสินไม่ได้ ห้ามล้าง)
 *
 * Run: node --import tsx src/lib/__tests__/dashboard-round-filter.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  parseDashboardRoundParam,
  dashboardOverviewApiPath,
  isRoundSelectable,
  buildActiveRounds,
  groupRoundsByStatus,
  roundOptionMeta,
  roundStatusBadge,
  roundTitleForScope,
  type RoundItem,
} from '../dashboard-overview';

// ========== TEST RUNNER ==========

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

// ========== FIXTURES ==========

const ROUNDS: RoundItem[] = [
  { id: 'r-1', title: 'รอบ A', roundCode: 'RC-A' },
  { id: 'r-2', title: 'รอบ B' },
];

function paramsOf(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

// ========== TESTS ==========

console.log('=== parseDashboardRoundParam ===');

test('F1a: ไม่มี param → null (default = ทั้งหมด, ไม่เขียนลง URL)', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('')), null);
  assertEqual(parseDashboardRoundParam(paramsOf('status=SUBMITTED')), null);
});

test('F1b: มีค่า → ค่าตรงตาม URL', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('roundId=r-1')), 'r-1');
  assertEqual(parseDashboardRoundParam(paramsOf('status=SUBMITTED&roundId=r-2')), 'r-2');
});

test('F1c: ค่าว่าง (?roundId=) → null ≡ ทั้งหมด', () => {
  assertEqual(parseDashboardRoundParam(paramsOf('roundId=')), null);
});

console.log('=== dashboardOverviewApiPath ===');

test('F2a: ไม่เลือก → path เดิม ไม่มี query (1 request เท่าเดิม)', () => {
  assertEqual(dashboardOverviewApiPath(null), '/admin/dashboard/overview');
});

test('F2b: เลือกรอบ → endpoint เดียวกัน + ?roundId= แนบท้าย', () => {
  assertEqual(dashboardOverviewApiPath('r-1'), '/admin/dashboard/overview?roundId=r-1');
});

test('F2c: id มีอักขระพิเศษ → encodeURIComponent กัน URL พัง', () => {
  assertEqual(
    dashboardOverviewApiPath('a&b=c'),
    '/admin/dashboard/overview?roundId=a%26b%3Dc',
  );
});

console.log('=== isRoundSelectable (self-heal predicate) ===');

test('F3a: ไม่มีการเลือก → true (ไม่มีอะไรต้อง heal)', () => {
  assertEqual(isRoundSelectable(null, ROUNDS), true);
  assertEqual(isRoundSelectable(null, null), true);
});

test('F3b: id อยู่ในรายการรอบ → true (คงการเลือก)', () => {
  assertEqual(isRoundSelectable('r-1', ROUNDS), true);
  assertEqual(isRoundSelectable('r-2', ROUNDS), true);
});

test('F3c: id ไม่อยู่ในรายการ → false (ต้องล้างกลับทั้งหมด)', () => {
  assertEqual(isRoundSelectable('r-deleted', ROUNDS), false);
  assertEqual(isRoundSelectable('r-1 ', ROUNDS), false, 'ค่าที่มีช่องว่างก็ไม่ match');
});

test('F3d: rounds = null (section ล้ม) → true (ตัดสินไม่ได้ ห้ามล้าง filter)', () => {
  assertEqual(isRoundSelectable('r-1', null), true);
  assertEqual(isRoundSelectable('r-1', undefined), true);
});

// ========== V4: จัดกลุ่มตามสถานะ + RoundSelect option meta + Scope Banner ==========

console.log('=== groupRoundsByStatus / roundOptionMeta / roundTitleForScope (V4) ===');

const NOW = new Date('2026-11-01T00:00:00Z');
const DAY_MS = 86_400_000;
const d = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY_MS);

const G_ITEMS: RoundItem[] = [
  { id: 'r-open', title: 'รอบเปิดปกติ', roundCode: 'OP1', status: 'ACTIVE', openDate: d(-10), closeDate: d(20) },
  { id: 'r-closing', title: 'รอบใกล้ปิด', roundCode: 'CL2', status: 'ACTIVE', openDate: d(-10), closeDate: d(3) },
  { id: 'r-overdue', title: 'รอบเลยกำหนด', status: 'ACTIVE', openDate: d(-40), closeDate: d(-2) },
  { id: 'r-draft', title: 'รอบร่าง', roundCode: 'DR9', status: 'DRAFT', openDate: d(10), closeDate: d(40) },
  { id: 'r-closed', title: 'รอบปิดแล้ว', roundCode: 'CS8', status: 'CLOSED', openDate: d(-60), closeDate: d(-10) },
  { id: 'r-weird', title: 'รอบสถานะแปลก', status: 'WEIRD', openDate: d(-1), closeDate: d(30) },
];

// ผ่าน buildActiveRounds จริง — ลำดับภายในกลุ่มสืบจาก sort urgency → closeDate
const G_ROWS = buildActiveRounds(G_ITEMS, NOW);

// formatter stub — ตรวจรูปร่างข้อความ ไม่ผูกกับ formatDateThai
const fmt = (v: unknown) => (v instanceof Date ? 'FORMATTED' : 'NULL');

test('G1: ลำดับกลุ่ม = ใช้งานอยู่ → ร่าง → ปิดแล้ว → อื่น ๆ (คืนครบ 4 กลุ่มเสมอ)', () => {
  assertEqual(
    groupRoundsByStatus(G_ROWS)
      .map((g) => g.key)
      .join(','),
    'active,draft,closed,unknown',
  );
});

test('G2: สมาชิกกลุ่มถูกต้อง (ACTIVE/DRAFT/CLOSED/แปลก แยกครบ + label ไทย)', () => {
  const groups = groupRoundsByStatus(G_ROWS);
  const active = groups.find((g) => g.key === 'active');
  const draft = groups.find((g) => g.key === 'draft');
  const closed = groups.find((g) => g.key === 'closed');
  const unknown = groups.find((g) => g.key === 'unknown');
  assertEqual(active && active.rows.map((r) => r.id).join(','), 'r-overdue,r-closing,r-open');
  assertEqual(draft && draft.rows.map((r) => r.id).join(','), 'r-draft');
  assertEqual(closed && closed.rows.map((r) => r.id).join(','), 'r-closed');
  assertEqual(unknown && unknown.rows.map((r) => r.id).join(','), 'r-weird');
  assertEqual(active && active.label, 'ใช้งานอยู่');
  assertEqual(draft && draft.label, 'ร่าง');
  assertEqual(closed && closed.label, 'ปิดแล้ว');
});

test('G3: overdue (ACTIVE เลยกำหนด) อยู่กลุ่ม "ใช้งานอยู่" และเรียงบนสุดของกลุ่ม', () => {
  const active = groupRoundsByStatus(G_ROWS).find((g) => g.key === 'active');
  assertEqual(active && active.rows[0].id, 'r-overdue');
  assertEqual(active && active.rows[0].urgency, 'overdue');
});

test('G4: rows ว่าง/undefined → คืน 4 กลุ่มว่าง (caller โชว์ "ไม่มี" หรือซ่อนเอง)', () => {
  const empty = groupRoundsByStatus([]);
  assertEqual(empty.length, 4);
  assertEqual(empty.every((g) => g.rows.length === 0), true);
  assertEqual(groupRoundsByStatus(undefined as any).length, 4);
});

test('G5: status null → กลุ่ม "อื่น ๆ" (defensive เดียวกับ roundStatusBadge)', () => {
  const rows = buildActiveRounds(
    [{ id: 'r-x', title: 'ไม่มีสถานะ', openDate: d(-1), closeDate: d(1) }],
    NOW,
  );
  const unknown = groupRoundsByStatus(rows).find((g) => g.key === 'unknown');
  assertEqual(unknown && unknown.rows.map((r) => r.id).join(','), 'r-x');
});

test('G6: roundOptionMeta มีรหัสรอบ → secondary = "รหัส · ปิด <วันที่>"', () => {
  const meta = roundOptionMeta(G_ROWS.find((r) => r.id === 'r-open')!, fmt);
  assertEqual(meta.primary, 'รอบเปิดปกติ');
  assertEqual(meta.secondary, 'OP1 · ปิด FORMATTED');
});

test('G7: roundOptionMeta ไม่มีรหัสรอบ → secondary เหลือเฉพาะวันปิด (รองรับ roundCode null)', () => {
  const meta = roundOptionMeta(G_ROWS.find((r) => r.id === 'r-overdue')!, fmt);
  assertEqual(meta.secondary, 'ปิด FORMATTED');
});

test('G8: roundOptionMeta badge สถานะ reuse roundStatusBadge (ข้ามหน้าเหมือนทุกคำทุกสี)', () => {
  assertEqual(roundOptionMeta(G_ROWS.find((r) => r.id === 'r-open')!, fmt).badgeLabel, 'ใช้งาน');
  assertEqual(roundOptionMeta(G_ROWS.find((r) => r.id === 'r-draft')!, fmt).badgeLabel, 'ร่าง');
  assertEqual(roundOptionMeta(G_ROWS.find((r) => r.id === 'r-closed')!, fmt).badgeLabel, 'ปิดแล้ว');
  assertEqual(
    roundOptionMeta(G_ROWS.find((r) => r.id === 'r-draft')!, fmt).badgeClassName,
    roundStatusBadge('DRAFT').className,
  );
});

test('G9: roundOptionMeta closeDate null → ไม่มีส่วน "ปิด" (มีรหัส = เฉพาะรหัส, ไม่มีทั้งคู่ = ว่าง)', () => {
  const withCode = buildActiveRounds(
    [{ id: 'r-nodates', title: 'ไม่มีวันปิด', roundCode: 'ND1', status: 'ACTIVE', openDate: null, closeDate: null }],
    NOW,
  );
  assertEqual(roundOptionMeta(withCode[0], fmt).secondary, 'ND1');
  const noCode = buildActiveRounds(
    [{ id: 'r-nodates2', title: 'ไม่มีรหัสและวันปิด', status: 'ACTIVE', openDate: null, closeDate: null }],
    NOW,
  );
  assertEqual(roundOptionMeta(noCode[0], fmt).secondary, '');
});

test('G10: roundTitleForScope — ไม่เลือก/ไม่พบ/section ล้ม → null, พบ → ชื่อเต็ม', () => {
  assertEqual(roundTitleForScope(null, G_ITEMS), null);
  assertEqual(roundTitleForScope('r-open', G_ITEMS), 'รอบเปิดปกติ');
  assertEqual(roundTitleForScope('r-gone', G_ITEMS), null);
  assertEqual(roundTitleForScope('r-open', null), null);
});

// ========== SUMMARY ==========

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
if (failed > 0) {
  (globalThis as any).process.exit(1);
}
