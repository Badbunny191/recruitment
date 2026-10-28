/**
 * Dashboard Overview Tests
 * ------------------------
 * ทดสอบตรรกะของ Executive Dashboard Level 1 (ไม่ต้องใช้ React / browser)
 *
 * Run: node --import tsx src/lib/__tests__/dashboard-overview.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  toDate,
  daysBetween,
  ageInDays,
  daysUntil,
  buildStatusCards,
  pendingCount,
  buildPendingDecisions,
  buildActiveRounds,
  countOverdueRounds,
  buildGovernanceAlerts,
  formatRelativeTime,
  buildRecentActivities,
  buildDashboardSnapshot,
  DEFAULT_SLA_DAYS,
  APPLICATION_STATUSES,
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

function assertTrue(value: any, msg = '') {
  if (!value) throw new Error(`${msg} expected truthy, got ${JSON.stringify(value)}`);
}

function assertNull(value: any, msg = '') {
  if (value !== null) throw new Error(`${msg} expected null, got ${JSON.stringify(value)}`);
}

// ========== FIXED CLOCK ==========
// ใช้เวลาคงที่เพื่อให้ผลไม่ขึ้นกับวันที่รันจริง
// 2026-10-28T12:00:00Z
const NOW = new Date('2026-10-28T12:00:00Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

// ========== toDate ==========

test('toDate: unix seconds → Date', () => {
  const d = toDate(NOW_SEC);
  assertEqual(d?.toISOString(), '2026-10-28T12:00:00.000Z');
});

test('toDate: unix milliseconds → Date', () => {
  const d = toDate(NOW.getTime());
  assertEqual(d?.toISOString(), '2026-10-28T12:00:00.000Z');
});

test('toDate: ISO string → Date', () => {
  const d = toDate('2026-10-28T12:00:00.000Z');
  assertEqual(d?.toISOString(), '2026-10-28T12:00:00.000Z');
});

test('toDate: numeric string (seconds) → Date', () => {
  const d = toDate(String(NOW_SEC));
  assertEqual(d?.toISOString(), '2026-10-28T12:00:00.000Z');
});

test('toDate: Date object passes through', () => {
  const d = toDate(NOW);
  assertEqual(d?.getTime(), NOW.getTime());
});

test('toDate: null / undefined / empty → null', () => {
  assertNull(toDate(null));
  assertNull(toDate(undefined));
  assertNull(toDate(''));
  assertNull(toDate('   '));
});

test('toDate: invalid string → null', () => {
  assertNull(toDate('not-a-date'));
});

test('toDate: invalid Date object → null', () => {
  assertNull(toDate(new Date('invalid')));
});

// ========== daysBetween / ageInDays / daysUntil ==========

test('daysBetween: 10 วัน', () => {
  const from = new Date('2026-10-18T12:00:00Z');
  assertEqual(daysBetween(from, NOW), 10);
});

test('daysBetween: ข้อมูลไม่พอ → null', () => {
  assertNull(daysBetween(null, NOW));
  assertNull(daysBetween(NOW, null));
});

test('ageInDays: 5 วันก่อน', () => {
  const fiveDaysAgo = new Date(NOW.getTime() - 5 * 86400000);
  assertEqual(ageInDays(fiveDaysAgo, NOW), 5);
});

test('ageInDays: อนาคต → null (ไม่ติดลบ)', () => {
  const future = new Date(NOW.getTime() + 3 * 86400000);
  assertNull(ageInDays(future, NOW));
});

test('daysUntil: เหลือ 3 วัน', () => {
  const inThreeDays = new Date(NOW.getTime() + 3 * 86400000);
  assertEqual(daysUntil(inThreeDays, NOW), 3);
});

test('daysUntil: เลยกำหนด → ติดลบ', () => {
  const twoDaysAgo = new Date(NOW.getTime() - 2 * 86400000);
  assertEqual(daysUntil(twoDaysAgo, NOW), -2);
});

// ========== buildStatusCards ==========

test('buildStatusCards: ครบ 6 สถานะเสมอ (รวม DRAFT ที่ backend ไม่ส่งมา)', () => {
  const { cards } = buildStatusCards({
    total: 20,
    byStatus: { SUBMITTED: 5, QUALIFIED: 13, ARCHIVED: 1, REJECTED: 1 },
  });
  assertEqual(cards.length, 6, 'card count');
  assertDeepEqual(
    cards.map((c) => c.status),
    [...APPLICATION_STATUSES],
  );
});

test('buildStatusCards: ตัวเลขตรงกับ prod (20 ใบ)', () => {
  const { total, cards, unaccounted } = buildStatusCards({
    total: 20,
    byStatus: { SUBMITTED: 5, QUALIFIED: 13, ARCHIVED: 1, REJECTED: 1 },
  });
  assertEqual(total, 20);
  assertEqual(cards.find((c) => c.status === 'QUALIFIED')?.count, 13);
  assertEqual(cards.find((c) => c.status === 'SUBMITTED')?.count, 5);
  assertEqual(cards.find((c) => c.status === 'DRAFT')?.count, 0);
  assertEqual(unaccounted, 0, 'ผลบวกต้องเท่ากับ total');
});

test('buildStatusCards: ตรวจเจอ DRAFT ที่ backend ไม่นับ (unaccounted)', () => {
  // backend byStatus ไม่มีคีย์ DRAFT → ถ้ามีแถว DRAFT จริง total จะมากกว่าผลบวก
  const { total, cards, unaccounted } = buildStatusCards({
    total: 21,
    byStatus: { SUBMITTED: 5, QUALIFIED: 13, ARCHIVED: 1, REJECTED: 1 },
  });
  assertEqual(total, 21);
  assertEqual(cards.reduce((s, c) => s + c.count, 0), 20);
  assertEqual(unaccounted, 1, 'ต้องรายงานส่วนที่ยังไม่ถูกนับ');
});

test('buildStatusCards: share คำนวณถูก', () => {
  const { cards } = buildStatusCards({
    total: 20,
    byStatus: { QUALIFIED: 10, SUBMITTED: 10 },
  });
  assertEqual(cards.find((c) => c.status === 'QUALIFIED')?.share, 0.5);
});

test('buildStatusCards: total = 0 → share 0 (ไม่หารศูนย์)', () => {
  const { cards, total } = buildStatusCards({ total: 0, byStatus: {} });
  assertEqual(total, 0);
  assertTrue(cards.every((c) => c.share === 0), 'share ต้องเป็น 0 ทั้งหมด');
});

test('buildStatusCards: input null → โครงสร้างว่างที่ปลอดภัย', () => {
  const { total, cards, unaccounted } = buildStatusCards(null);
  assertEqual(total, 0);
  assertEqual(cards.length, 6);
  assertEqual(unaccounted, 0);
});

test('buildStatusCards: byStatus ที่มีค่าแปลก (string) ถูกแปลงเป็นตัวเลข', () => {
  const { cards } = buildStatusCards({ total: 5, byStatus: { SUBMITTED: '5' } });
  assertEqual(cards.find((c) => c.status === 'SUBMITTED')?.count, 5);
});

// ========== pendingCount ==========

test('pendingCount: นับเฉพาะ SUBMITTED', () => {
  assertEqual(pendingCount({ total: 20, byStatus: { SUBMITTED: 5, QUALIFIED: 13 } }), 5);
});

test('pendingCount: ไม่มีข้อมูล → 0', () => {
  assertEqual(pendingCount(null), 0);
});

// ========== buildPendingDecisions ==========

const app = (over: any = {}) => ({
  id: 'a1',
  status: 'SUBMITTED',
  submittedAt: NOW_SEC,
  ...over,
});

test('buildPendingDecisions: นับเฉพาะ SUBMITTED และหาอายุมากสุด', () => {
  const items = [
    app({ id: 'a', submittedAt: NOW_SEC - 2 * 86400 }), // 2 วัน
    app({ id: 'b', submittedAt: NOW_SEC - 12 * 86400 }), // 12 วัน ← เก่าสุด
    app({ id: 'c', status: 'QUALIFIED', submittedAt: NOW_SEC - 30 * 86400 }),
    app({ id: 'd', status: 'REJECTED', submittedAt: NOW_SEC - 40 * 86400 }),
  ];
  const result = buildPendingDecisions(items, NOW);
  assertEqual(result.count, 2, 'เฉพาะ SUBMITTED');
  assertEqual(result.oldestAgeDays, 12);
  assertEqual(result.oldest?.id, 'b');
});

test('buildPendingDecisions: นับ overdue ตาม SLA', () => {
  const items = [
    app({ id: 'a', submittedAt: NOW_SEC - 3 * 86400 }), // 3 วัน — ไม่ overdue
    app({ id: 'b', submittedAt: NOW_SEC - 8 * 86400 }), // 8 วัน — overdue
    app({ id: 'c', submittedAt: NOW_SEC - 20 * 86400 }), // 20 วัน — overdue
  ];
  const result = buildPendingDecisions(items, NOW, 7);
  assertEqual(result.overdueCount, 2);
  assertEqual(result.slaDays, 7);
});

test('buildPendingDecisions: ไม่มีใบค้าง → null ปลอดภัย', () => {
  const result = buildPendingDecisions([], NOW);
  assertEqual(result.count, 0);
  assertNull(result.oldestAgeDays);
  assertNull(result.oldest);
  assertEqual(result.overdueCount, 0);
});

test('buildPendingDecisions: input null → ไม่ throw', () => {
  const result = buildPendingDecisions(null, NOW);
  assertEqual(result.count, 0);
  assertEqual(result.slaDays, DEFAULT_SLA_DAYS);
});

test('buildPendingDecisions: ใบที่ไม่มี submittedAt ถูกข้าม (ไม่ทำให้อายุเพี้ยน)', () => {
  const items = [app({ id: 'a', submittedAt: null }), app({ id: 'b', submittedAt: NOW_SEC - 5 * 86400 })];
  const result = buildPendingDecisions(items, NOW);
  assertEqual(result.count, 2, 'ยังนับเป็นงานค้าง');
  assertEqual(result.oldestAgeDays, 5, 'แต่อายุคำนวณจากใบที่มีข้อมูล');
  assertEqual(result.oldest?.id, 'b');
});

// ========== buildActiveRounds ==========

const round = (over: any = {}) => ({
  id: 'r1',
  title: 'รอบทดสอบ',
  status: 'ACTIVE',
  openDate: Math.floor(NOW.getTime() / 1000) - 10 * 86400,
  closeDate: Math.floor(NOW.getTime() / 1000) + 20 * 86400,
  ...over,
});

test('buildActiveRounds: รอบเปิดปกติ → urgency open', () => {
  const rows = buildActiveRounds([round()], NOW);
  assertEqual(rows.length, 1);
  assertEqual(rows[0].urgency, 'open');
  assertEqual(rows[0].daysLeft, 20);
});

test('buildActiveRounds: ใกล้ปิด (≤7 วัน) → closing-soon', () => {
  const rows = buildActiveRounds(
    [round({ closeDate: Math.floor(NOW.getTime() / 1000) + 3 * 86400 })],
    NOW,
  );
  assertEqual(rows[0].urgency, 'closing-soon');
});

test('buildActiveRounds: เลยกำหนดแต่ยัง ACTIVE → overdue', () => {
  const rows = buildActiveRounds(
    [round({ closeDate: Math.floor(NOW.getTime() / 1000) - 2 * 86400 })],
    NOW,
  );
  assertEqual(rows[0].urgency, 'overdue');
  assertTrue(rows[0].daysLeft < 0, 'daysLeft ต้องติดลบ');
});

test('buildActiveRounds: ตัดรอบที่ถูกลบออก', () => {
  const rows = buildActiveRounds([round({ deletedAt: NOW_SEC })], NOW);
  assertEqual(rows.length, 0);
});

test('buildActiveRounds: รอบ CLOSED → closed (ไม่ถูกฟ้องว่า overdue)', () => {
  const rows = buildActiveRounds(
    [round({ status: 'CLOSED', closeDate: Math.floor(NOW.getTime() / 1000) - 5 * 86400 })],
    NOW,
  );
  assertEqual(rows[0].urgency, 'closed');
});

test('buildActiveRounds: รอบ DRAFT → not-open', () => {
  const rows = buildActiveRounds([round({ status: 'DRAFT' })], NOW);
  assertEqual(rows[0].urgency, 'not-open');
});

test('buildActiveRounds: เรียง overdue ก่อน แล้วค่อยใกล้ปิด', () => {
  const rows = buildActiveRounds(
    [
      round({ id: 'open', closeDate: Math.floor(NOW.getTime() / 1000) + 30 * 86400 }),
      round({ id: 'overdue', closeDate: Math.floor(NOW.getTime() / 1000) - 3 * 86400 }),
      round({ id: 'soon', closeDate: Math.floor(NOW.getTime() / 1000) + 2 * 86400 }),
    ],
    NOW,
  );
  assertDeepEqual(
    rows.map((r) => r.id),
    ['overdue', 'soon', 'open'],
  );
});

test('buildActiveRounds: วันที่หาย → unknown ไม่ throw', () => {
  const rows = buildActiveRounds([round({ closeDate: null })], NOW);
  assertEqual(rows[0].urgency, 'unknown');
  assertNull(rows[0].daysLeft);
});

test('buildActiveRounds: input null → array ว่าง', () => {
  assertDeepEqual(buildActiveRounds(null, NOW), []);
});

test('countOverdueRounds: นับเฉพาะ overdue', () => {
  const rows = buildActiveRounds(
    [
      round({ id: 'a', closeDate: Math.floor(NOW.getTime() / 1000) - 1 * 86400 }),
      round({ id: 'b', closeDate: Math.floor(NOW.getTime() / 1000) - 9 * 86400 }),
      round({ id: 'c', closeDate: Math.floor(NOW.getTime() / 1000) + 40 * 86400 }),
    ],
    NOW,
  );
  assertEqual(countOverdueRounds(rows), 2);
});

// ========== buildGovernanceAlerts ==========

test('buildGovernanceAlerts: needsUpdate → severity high', () => {
  const alerts = buildGovernanceAlerts([
    {
      roundId: 'r1',
      roundTitle: 'รอบ ก',
      roundStatus: 'ACTIVE',
      isOutdated: true,
      needsUpdate: true,
      currentVersionNumber: 1,
      latestVersionNumber: 3,
    },
  ]);
  assertEqual(alerts.length, 1);
  assertEqual(alerts[0].severity, 'high');
  assertTrue(alerts[0].message.includes('v1'), 'ข้อความต้องบอก version ปัจจุบัน');
  assertTrue(alerts[0].message.includes('v3'), 'ข้อความต้องบอก version ล่าสุด');
});

test('buildGovernanceAlerts: outdated แต่ไม่ needsUpdate → medium', () => {
  const alerts = buildGovernanceAlerts([
    {
      roundId: 'r2',
      roundTitle: 'รอบ ข',
      roundStatus: 'CLOSED',
      isOutdated: true,
      needsUpdate: false,
      currentVersionNumber: 1,
      latestVersionNumber: 2,
    },
  ]);
  assertEqual(alerts[0].severity, 'medium');
});

test('buildGovernanceAlerts: รอบที่ทันสมัย → ไม่มี alert', () => {
  const alerts = buildGovernanceAlerts([
    {
      roundId: 'r3',
      roundTitle: 'รอบ ค',
      roundStatus: 'ACTIVE',
      isOutdated: false,
      needsUpdate: false,
      currentVersionNumber: 2,
      latestVersionNumber: 2,
    },
  ]);
  assertEqual(alerts.length, 0);
});

test('buildGovernanceAlerts: เรียง high ก่อน medium', () => {
  const alerts = buildGovernanceAlerts([
    {
      roundId: 'm',
      roundTitle: 'medium',
      roundStatus: 'CLOSED',
      isOutdated: true,
      needsUpdate: false,
      currentVersionNumber: 1,
      latestVersionNumber: 2,
    },
    {
      roundId: 'h',
      roundTitle: 'high',
      roundStatus: 'ACTIVE',
      isOutdated: true,
      needsUpdate: true,
      currentVersionNumber: 1,
      latestVersionNumber: 2,
    },
  ]);
  assertDeepEqual(
    alerts.map((a) => a.severity),
    ['high', 'medium'],
  );
});

test('buildGovernanceAlerts: input null → array ว่าง', () => {
  assertDeepEqual(buildGovernanceAlerts(null), []);
});

// ========== formatRelativeTime ==========

test('formatRelativeTime: ไม่ถึง 1 นาที', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW), 'เมื่อสักครู่');
});

test('formatRelativeTime: นาที', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW), '5 นาทีที่แล้ว');
});

test('formatRelativeTime: ชั่วโมง', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000), NOW), '3 ชั่วโมงที่แล้ว');
});

test('formatRelativeTime: วัน', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() - 4 * 86_400_000), NOW), '4 วันที่แล้ว');
});

test('formatRelativeTime: เดือน', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() - 65 * 86_400_000), NOW), '2 เดือนที่แล้ว');
});

test('formatRelativeTime: อนาคต → เมื่อสักครู่ (ไม่ติดลบ)', () => {
  assertEqual(formatRelativeTime(new Date(NOW.getTime() + 60_000), NOW), 'เมื่อสักครู่');
});

test('formatRelativeTime: ค่าเสีย → "-"', () => {
  assertEqual(formatRelativeTime(null, NOW), '-');
  assertEqual(formatRelativeTime('bad', NOW), '-');
});

// ========== buildRecentActivities ==========

test('buildRecentActivities: map display จาก backend', () => {
  const rows = buildRecentActivities(
    [
      {
        id: 'l1',
        action: 'PDF_DOWNLOAD',
        entityType: 'APPLICATION',
        entityId: 'e1',
        createdAt: NOW_SEC - 3600,
        display: { name: 'APP-2026-5012', secondary: 'นายสมชาย' },
      },
    ],
    NOW,
  );
  assertEqual(rows.length, 1);
  assertEqual(rows[0].primary, 'APP-2026-5012');
  assertEqual(rows[0].secondary, 'นายสมชาย');
  assertEqual(rows[0].relative, '1 ชั่วโมงที่แล้ว');
});

test('buildRecentActivities: display เป็น null → primary null (ให้ UI fallback)', () => {
  const rows = buildRecentActivities(
    [{ id: 'l1', action: 'CREATE', entityType: 'TEMPLATE', entityId: 'e1', createdAt: NOW_SEC }],
    NOW,
  );
  assertNull(rows[0].primary);
});

test('buildRecentActivities: จำกัดจำนวนตาม limit', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `l${i}`,
    action: 'UPDATE',
    entityType: 'APPLICATION',
    entityId: `e${i}`,
    createdAt: NOW_SEC,
  }));
  assertEqual(buildRecentActivities(items, NOW, 10).length, 10);
});

test('buildRecentActivities: input null → array ว่าง', () => {
  assertDeepEqual(buildRecentActivities(null, NOW), []);
});

// ========== buildDashboardSnapshot ==========

test('buildDashboardSnapshot: ประกอบทุกส่วนได้ครบ', () => {
  const snap = buildDashboardSnapshot({
    summary: { total: 20, byStatus: { SUBMITTED: 5, QUALIFIED: 13, ARCHIVED: 1, REJECTED: 1 } },
    pendingItems: [app({ id: 'p1', submittedAt: NOW_SEC - 9 * 86400 })],
    rounds: [round()],
    comparison: [
      {
        roundId: 'r1',
        roundTitle: 'รอบ ก',
        roundStatus: 'ACTIVE',
        isOutdated: true,
        needsUpdate: true,
        currentVersionNumber: 1,
        latestVersionNumber: 2,
      },
    ],
    activities: [
      { id: 'l1', action: 'CREATE', entityType: 'TEMPLATE', entityId: 'e1', createdAt: NOW_SEC },
    ],
    now: NOW,
  });

  assertEqual(snap.statusCards.total, 20);
  assertEqual(snap.pending.count, 1);
  assertEqual(snap.pending.overdueCount, 1, '9 วัน > SLA 7');
  assertEqual(snap.rounds.length, 1);
  assertEqual(snap.overdueRounds, 0);
  assertEqual(snap.alerts.length, 1);
  assertEqual(snap.activities.length, 1);
});

test('buildDashboardSnapshot: input ว่างทั้งหมด → ไม่ throw', () => {
  const snap = buildDashboardSnapshot({ now: NOW });
  assertEqual(snap.statusCards.total, 0);
  assertEqual(snap.pending.count, 0);
  assertDeepEqual(snap.rounds, []);
  assertEqual(snap.overdueRounds, 0);
  assertDeepEqual(snap.alerts, []);
  assertDeepEqual(snap.activities, []);
});

// ========== SUMMARY ==========

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('All tests passed ✓');
