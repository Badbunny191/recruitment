/**
 * Dashboard Overview V2 — single endpoint mapping tests
 * ------------------------------------------------------
 * ทดสอบ mapping ของ response จาก GET /admin/dashboard/overview
 * เข้า DashboardSnapshot รูปทรงเดิม (buildDashboardSnapshotFromOverview
 * + pendingFromOverview) รวมถึง parity กับ logic V1:
 *
 *   - statusCards / rounds / alerts ต้องเหมือน buildDashboardSnapshot (V1)
 *     เมื่อข้อมูลชุดเดียวกัน (reuse helper เดิม — ต้องไม่ diverge)
 *   - pending ต่างเฉพาะจุดที่ตั้งใจ: ค่าจาก backend (ชุดเต็ม) และ
 *     truncated = false เสมอ (ไม่มี subset warning อีกต่อไป)
 *
 * Run: node --import tsx src/lib/__tests__/dashboard-overview-endpoint.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromOverview,
  pendingFromOverview,
  DEFAULT_SLA_DAYS,
  type DashboardOverviewPayload,
  type PendingOverview,
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

function assertDeepEqual(actual: any, expected: any, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg} expected ${b}, got ${a}`);
  }
}

// ========== FIXTURES ==========

const NOW = new Date('2026-10-28T10:00:00Z');
const DAY = 86_400_000;

function overviewPayload(overrides: Partial<DashboardOverviewPayload> = {}): DashboardOverviewPayload {
  return {
    summary: { total: 10, byStatus: { SUBMITTED: 3, QUALIFIED: 4, REJECTED: 1, CANCELED: 1, ARCHIVED: 1 } },
    pending: {
      total: 3,
      overdueCount: 1,
      oldestSubmittedAt: NOW.getTime() / 1000 - 8 * DAY / 1000, // unix seconds — 8 วันก่อน
      slaDays: 7,
      items: [{ id: 'a1', applicationNo: 'APP-1', fullname: 'สมชาย', status: 'SUBMITTED', submittedAt: NOW.getTime() / 1000 - 8 * DAY / 1000 }],
    },
    rounds: [
      {
        id: 'r-overdue',
        title: 'รอบเลยกำหนด',
        status: 'ACTIVE',
        roundCode: 'RO1',
        openDate: NOW.getTime() / 1000 - 40 * DAY / 1000,
        closeDate: NOW.getTime() / 1000 - 2 * DAY / 1000, // เลยปิด 2 วันแต่ยัง ACTIVE
        deletedAt: null,
      },
      {
        id: 'r-open',
        title: 'รอบปกติ',
        status: 'ACTIVE',
        roundCode: 'RO2',
        openDate: NOW.getTime() / 1000 - 10 * DAY / 1000,
        closeDate: NOW.getTime() / 1000 + 30 * DAY / 1000,
        deletedAt: null,
      },
      {
        id: 'r-closing',
        title: 'รอบใกล้ปิด',
        status: 'ACTIVE',
        roundCode: 'RO3',
        openDate: NOW.getTime() / 1000 - 10 * DAY / 1000,
        closeDate: NOW.getTime() / 1000 + 3 * DAY / 1000,
        deletedAt: null,
      },
    ],
    comparison: [
      { roundId: 'r-open', roundTitle: 'รอบปกติ', roundStatus: 'ACTIVE', isOutdated: true, needsUpdate: true, currentVersionNumber: 1, latestVersionNumber: 2 },
    ],
    activities: {
      items: [
        { id: 'l1', action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: 'e1', createdAt: NOW.getTime() / 1000 - 3600, display: { name: 'APP-2026-5012', secondary: 'นายสมชาย' } },
      ],
    },
    errors: [],
    ...overrides,
  };
}

// ========== pendingFromOverview ==========

console.log('\n── pendingFromOverview ──');

test('ค่าจาก backend ผ่านตรง ๆ: total/overdueCount/slaDays + อายุเก่าสุดคำนวณจาก oldestSubmittedAt', () => {
  const d = pendingFromOverview(overviewPayload().pending, NOW);
  assertEqual(d.count, 3);
  assertEqual(d.overdueCount, 1);
  assertEqual(d.slaDays, 7);
  assertEqual(d.oldestAgeDays, 8, 'oldest 8 วันก่อน → ageInDays = 8');
  assertEqual(d.truncated, false, 'server aggregate จากชุดเต็ม — ไม่มี subset');
  assertEqual(d.fetchedCount, 1, 'items คือแถวตัวอย่าง ≤ 5');
  assertEqual(d.oldest, null, 'ไม่ใช้แล้ว (UI ไม่ render)');
});

test('truncated = false เสมอ แม้ items น้อยกว่า total มาก', () => {
  const pending: PendingOverview = { total: 250, overdueCount: 12, oldestSubmittedAt: null, slaDays: 7, items: [{ id: 'a1' }] };
  const d = pendingFromOverview(pending, NOW);
  assertEqual(d.count, 250);
  assertEqual(d.truncated, false);
  assertEqual(d.oldestAgeDays, null, 'ไม่ส่ง oldest มา → null (UI แสดง "ไม่มีงานค้าง"? ไม่ — แสดงตาม count)');
});

test('slaDays ไม่ส่งมา → fallback DEFAULT_SLA_DAYS', () => {
  const d = pendingFromOverview({ total: 1, overdueCount: 0, oldestSubmittedAt: null, slaDays: undefined as any, items: [] }, NOW);
  assertEqual(d.slaDays, DEFAULT_SLA_DAYS);
});

test('null / ค่าเสีย → ค่ากลาง 0 ไม่ throw', () => {
  const d = pendingFromOverview(null, NOW);
  assertEqual(d.count, 0);
  assertEqual(d.overdueCount, 0);
  assertEqual(d.oldestAgeDays, null);
  const bad = pendingFromOverview({ total: NaN, overdueCount: -5, oldestSubmittedAt: 'garbage', slaDays: 0, items: [] } as any, NOW);
  assertEqual(bad.count, 0);
  assertEqual(bad.overdueCount, 0);
  assertEqual(bad.slaDays, DEFAULT_SLA_DAYS, 'slaDays 0 → ไม่เอา → fallback');
});

// ========== buildDashboardSnapshotFromOverview ==========

console.log('\n── buildDashboardSnapshotFromOverview ──');

test('full payload → snapshot ครบ: cards/pending/rounds/alerts/activities', () => {
  const s = buildDashboardSnapshotFromOverview(overviewPayload(), NOW);

  assertEqual(s.statusCards.total, 10);
  assertEqual(s.statusCards.cards.find((c) => c.status === 'SUBMITTED')!.count, 3);
  assertEqual(s.statusCards.unaccounted, 0);

  assertEqual(s.pending.count, 3);
  assertEqual(s.pending.overdueCount, 1);

  // เรียง urgency: overdue → closing-soon → open
  assertDeepEqual(s.rounds.map((r) => r.id), ['r-overdue', 'r-closing', 'r-open']);
  assertEqual(s.overdueRounds, 1);

  assertEqual(s.alerts.length, 1);
  assertEqual(s.alerts[0].severity, 'high');
  assertEqual(s.alerts[0].message, 'ใช้ v1 แต่มี v2 ที่ publish แล้ว');

  assertEqual(s.activities.length, 1);
  assertEqual(s.activities[0].primary, 'APP-2026-5012');
  assertEqual(s.activities[0].relative, '1 ชั่วโมงที่แล้ว');
});

test('PARITY: cards/rounds/alerts ตรงกับ V1 (buildDashboardSnapshot) เมื่อข้อมูลชุดเดียวกัน', () => {
  const o = overviewPayload();
  const v2 = buildDashboardSnapshotFromOverview(o, NOW);
  const v1 = buildDashboardSnapshot(
    {
      summary: o.summary,
      pendingItems: o.pending!.items,
      pendingTotal: o.pending!.total,
      rounds: o.rounds,
      comparison: o.comparison,
      activities: o.activities!.items,
      now: NOW,
    },
  );

  assertDeepEqual(v2.statusCards, v1.statusCards, 'statusCards ต้องเหมือน V1');
  assertDeepEqual(v2.rounds, v1.rounds, 'rounds ต้องเหมือน V1');
  assertDeepEqual(v2.overdueRounds, v1.overdueRounds, 'overdueRounds ต้องเหมือน V1');
  assertDeepEqual(v2.alerts, v1.alerts, 'alerts ต้องเหมือน V1');

  // pending ต่างเฉพาะจุดที่ตั้งใจ: V2 ไม่มี subset warning
  assertEqual(v1.pending.truncated, true, 'V1 คำนวณจาก subset จึง truncated');
  assertEqual(v2.pending.truncated, false, 'V2 ได้ค่าจากชุดเต็มจาก backend');
  assertEqual(v1.pending.count, v2.pending.count, 'count ทั้งคู่มาจาก backend.total');
});

test('PARITY: comparison แบบ pre-filter (server ส่งเฉพาะ flagged) ให้ alerts ชุดเดียวกับส่งครบทุกแถว', () => {
  // server ส่งเฉพาะแถว isOutdated/needsUpdate — แถวปกติถูกตัดไปแล้ว
  const flaggedOnly: DashboardOverviewPayload = overviewPayload({
    comparison: [
      { roundId: 'r-1', roundTitle: 'อ', roundStatus: 'ACTIVE', isOutdated: true, needsUpdate: true, currentVersionNumber: 1, latestVersionNumber: 3 },
      { roundId: 'r-2', roundTitle: 'บ', roundStatus: 'CLOSED', isOutdated: true, needsUpdate: false, currentVersionNumber: 2, latestVersionNumber: 3 },
    ],
  });
  // สมมุติ V1 ได้รายการเต็ม (รวมแถวที่ไม่ outdated)
  const fullList = [
    ...flaggedOnly.comparison!,
    { roundId: 'r-3', roundTitle: 'ก', roundStatus: 'ACTIVE', isOutdated: false, needsUpdate: false, currentVersionNumber: 3, latestVersionNumber: 3 },
  ] as any;

  const fromFlagged = buildDashboardSnapshotFromOverview(flaggedOnly, NOW).alerts;
  const fromFull = buildDashboardSnapshot({ comparison: fullList, now: NOW }).alerts;

  assertDeepEqual(fromFlagged, fromFull, 'alerts ต้องชุดเดียวกัน (buildGovernanceAlerts กรองเองอยู่แล้ว)');
});

test('section เป็น null (fail-soft) → zero snapshot ไม่ throw (UI แสดง error ตาม section state)', () => {
  const s = buildDashboardSnapshotFromOverview(
    { summary: null, pending: null, rounds: null, comparison: null, activities: null, errors: ['summary', 'pending'] },
    NOW,
  );
  assertEqual(s.statusCards.total, 0);
  assertEqual(s.statusCards.unaccounted, 0);
  assertEqual(s.pending.count, 0);
  assertEqual(s.rounds.length, 0);
  assertEqual(s.alerts.length, 0);
  assertEqual(s.activities.length, 0);
});

test('overview ทั้งก้อน null/undefined (ยังโหลดไม่เสร็จ) → zero snapshot ไม่ throw', () => {
  const s = buildDashboardSnapshotFromOverview(null, NOW);
  assertEqual(s.statusCards.total, 0);
  assertEqual(s.activities.length, 0);
});

// ========== Summary ==========

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
if (failed > 0) {
  process.exit(1);
}
console.log('All dashboard-overview-endpoint tests passed ✓');
