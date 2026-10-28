/**
 * Dashboard Overview Service — รวม KPI ของ Executive Dashboard เป็น response เดียว
 * ============================================================================
 * แทน fan-out 5 endpoint ของ Dashboard V1:
 *   GET /admin/applications/summary
 *   GET /admin/applications?status=SUBMITTED&...   (fetch 200 แถวมานับฝั่ง client)
 *   GET /admin/rounds?view=active
 *   GET /admin/rounds/comparison                   (N+1: count fields ต่อ 1 version)
 *   GET /admin/audit-logs?page=1&pageSize=10       (SUPER_ADMIN เท่านั้น)
 *
 * หลักการ:
 *   1. นับ/รวมฝั่ง server ให้จบ — โดยเฉพาะ "งานค้าง" ที่ V1 fetch แถวมากถึง
 *      200 แถวเพื่อเอาไปนับ/หาอายุฝั่ง client; ที่นี่ COUNT + MIN ใน 1 query
 *      แล้วส่งเฉพาะ 5 แถวแรกที่ UI ใช้แสดงตัวอย่าง
 *   2. summary จาก GROUP BY ครั้งเดียว (total = ผลบวกทุก group) — semantics
 *      ตรงกับ endpoint เดิมทุกประการ: byStatus มีเฉพาะ 5 สถานะที่รู้จัก
 *      (ไม่มี DRAFT) ส่วน total นับทุกแถว → ถ้ามีสถานะแปลก ผลต่างจะโผล่เป็น
 *      `unaccounted` ที่ UI เตือนอยู่แล้ว
 *   3. comparison คำนวณจาก rounds + versions ด้วย map ใน JS — semantics ตรงกับ
 *      /rounds/comparison เดิม (isOutdated / needsUpdate / เลข version) แต่ตัด
 *      field-count loop ทิ้ง เพราะ dashboard ไม่ได้อ่านค่านั้น; รวมรอบที่ถูกลบ
 *      (soft-deleted) ด้วย เพื่อ parity กับ endpoint เดิมที่ไม่ filter deletedAt
 *   4. activities เฉพาะ SUPER_ADMIN (policy เดียวกับ GET /admin/audit-logs)
 *      และ select เฉพาะ 5 คอลัมน์ที่ UI อ่าน — payload (email/IP) ไม่ออกจาก DB
 *   5. fail-soft ต่อ section: section ใด query ล้ม จะเป็น null + ชื่อ section
 *      อยู่ใน errors[] — ส่วนอื่นยังแสดงได้ (คุณสมบัติ Promise.allSettled ของ V1)
 *
 * ห้ามแตะ: ไม่มี migration / schema change — อ่านตารางเดิมเท่านั้น
 */

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { applications, auditLogs, recruitmentRounds, templateVersions } from '../db/schema';
import { resolveAuditEntityDisplays } from './audit-display.service';

type DB = ReturnType<typeof drizzleFn<any>>;

/** เกณฑ์ SLA งานค้าง (วัน) — ต้องตรงกับ DEFAULT_SLA_DAYS ฝั่ง frontend (dashboard-overview.ts) */
export const DASHBOARD_SLA_DAYS = 7;

/** จำนวนแถวงานค้างที่ส่งไปให้ UI แสดงตัวอย่าง (UI slice ที่ 5 เท่ากันอยู่แล้ว) */
export const PENDING_ITEMS_LIMIT = 5;

/** จำนวนกิจกรรมล่าสุด (ตรงกับ activityLimit=10 ของ V1) */
export const ACTIVITIES_LIMIT = 10;

/** สถานะ "รอการตัดสิน" — ค่าเดียวกับ PENDING_STATUSES ฝั่ง frontend */
const PENDING_STATUS = 'SUBMITTED';

/**
 * byStatus เริ่มต้น — 5 สถานะเดียวกับ GET /admin/applications/summary เดิม
 * (ไม่มี DRAFT ตาม contract เดิม — frontend normalize ครบ 6 สถานะเองอยู่แล้ว)
 */
const SUMMARY_KNOWN_STATUSES = ['SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'] as const;

// ── Response contract ───────────────────────────────────────────────────────

export interface DashboardSummaryData {
  total: number;
  byStatus: Record<string, number>;
}

export interface DashboardPendingItem {
  id: string;
  applicationNo: string | null;
  fullname: string | null;
  /** ISO string หลัง serialize (drizzle timestamp → Date → JSON) */
  submittedAt: Date | string | null;
}

export interface DashboardPendingData {
  /** จำนวนงานค้างทั้งระบบ (COUNT จริง — ไม่ใช่จำนวน items ที่ส่งกลับ) */
  total: number;
  /** จำนวนใบที่ค้างเกิน slaDays (คำนวณฝั่ง DB จากชุดเต็ม) */
  overdueCount: number;
  /** submittedAt ของใบที่ค้างนานที่สุด (ISO) — null เมื่อไม่มีงานค้าง */
  oldestSubmittedAt: string | null;
  slaDays: number;
  /** แถวตัวอย่างล่าสุด ≤ PENDING_ITEMS_LIMIT (UI แสดง 5 แถวเท่านั้น) */
  items: DashboardPendingItem[];
}

export interface DashboardRoundRow {
  id: string;
  title: string;
  status: string | null;
  roundCode: string | null;
  positionLevel: string | null;
  /** ISO string หลัง serialize */
  openDate: Date | string | null;
  closeDate: Date | string | null;
  deletedAt: Date | string | null;
}

export interface DashboardComparisonItem {
  roundId: string;
  roundTitle: string;
  roundStatus: string | null;
  isOutdated: boolean;
  needsUpdate: boolean;
  currentVersionNumber: number;
  latestVersionNumber: number;
}

export interface DashboardActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** ISO string หลัง serialize */
  createdAt: Date | string | null;
  display: { name: string | null; secondary: string | null } | null;
}

export interface DashboardActivitiesData {
  items: DashboardActivityItem[];
}

export interface DashboardOverviewData {
  summary: DashboardSummaryData | null;
  pending: DashboardPendingData | null;
  rounds: DashboardRoundRow[] | null;
  comparison: DashboardComparisonItem[] | null;
  /** null เมื่อผู้ขอไม่ใช่ SUPER_ADMIN (ไม่นับเป็น error) หรือเมื่อ section ล้ม */
  activities: DashboardActivitiesData | null;
  /** ชื่อ section ที่ query ล้ม — [] เมื่อทุกส่วนปกติ */
  errors: string[];
}

// ── Section builders (แต่ละอัน throw ได้ — caller ครอบด้วย try/catch) ────────

async function buildSummary(db: DB): Promise<DashboardSummaryData> {
  // GROUP BY ครั้งเดียว: total = ผลบวกทุก group (เท่ากับ COUNT(*) เพราะทุกแถว
  // มีค่า status หรือเป็น group NULL ที่นับรวมเหมือน COUNT(*) ของ endpoint เดิม)
  const statusGroups = await db
    .select({ status: applications.status, count: count() })
    .from(applications)
    .where(isNull(applications.deletedAt))
    .groupBy(applications.status);

  const byStatus: Record<string, number> = {};
  for (const s of SUMMARY_KNOWN_STATUSES) byStatus[s] = 0;

  let total = 0;
  for (const group of statusGroups) {
    const n = Number(group.count ?? 0);
    total += n;
    if (group.status && Object.prototype.hasOwnProperty.call(byStatus, group.status)) {
      byStatus[group.status] = n;
    }
  }

  return { total, byStatus };
}

async function buildPending(db: DB, now: Date): Promise<DashboardPendingData> {
  // overdue ตรงนิยาม ageInDays ฝั่ง client: floor((now - submittedAt) / วัน) > slaDays
  // ⟺ (now - submittedAt) ≥ (slaDays + 1) วัน ⟺ submittedAt ≤ now - (slaDays+1) วัน
  const cutoffSec = Math.floor((now.getTime() - (DASHBOARD_SLA_DAYS + 1) * 86_400_000) / 1000);

  const [agg] = await db
    .select({
      total: sql<number>`count(*)`,
      overdue: sql<number>`count(case when ${applications.submittedAt} <= ${cutoffSec} then 1 end)`,
      oldest: sql<number | null>`min(${applications.submittedAt})`,
    })
    .from(applications)
    .where(and(isNull(applications.deletedAt), eq(applications.status, PENDING_STATUS)));

  const items = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      fullname: applications.fullname,
      submittedAt: applications.submittedAt,
    })
    .from(applications)
    .where(and(isNull(applications.deletedAt), eq(applications.status, PENDING_STATUS)))
    .orderBy(desc(applications.submittedAt), asc(applications.id))
    .limit(PENDING_ITEMS_LIMIT);

  const oldestSec = Number(agg?.oldest ?? 0);
  const oldestSubmittedAt =
    agg?.oldest != null && Number.isFinite(oldestSec) && oldestSec > 0
      ? new Date(oldestSec * 1000).toISOString()
      : null;

  return {
    total: Number(agg?.total ?? 0),
    overdueCount: Number(agg?.overdue ?? 0),
    oldestSubmittedAt,
    slaDays: DASHBOARD_SLA_DAYS,
    items,
  };
}

async function buildRounds(db: DB): Promise<DashboardRoundRow[]> {
  // set เดียวกับ GET /admin/rounds?view=active (deletedAt IS NULL) แต่เลือก
  // เฉพาะคอลัมน์ที่ dashboard อ่าน — ไม่ต้อง JOIN versions/templates
  return db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      status: recruitmentRounds.status,
      roundCode: recruitmentRounds.roundCode,
      positionLevel: recruitmentRounds.positionLevel,
      openDate: recruitmentRounds.openDate,
      closeDate: recruitmentRounds.closeDate,
      deletedAt: recruitmentRounds.deletedAt,
    })
    .from(recruitmentRounds)
    .where(isNull(recruitmentRounds.deletedAt))
    .orderBy(asc(recruitmentRounds.closeDate));
}

async function buildComparison(db: DB): Promise<DashboardComparisonItem[]> {
  // parity กับ /rounds/comparison เดิม: ไม่ filter deletedAt (รวมรอบที่ถูกลบ)
  const [allRounds, allVersions] = await Promise.all([
    db
      .select({
        id: recruitmentRounds.id,
        title: recruitmentRounds.title,
        status: recruitmentRounds.status,
        templateVersionId: recruitmentRounds.templateVersionId,
      })
      .from(recruitmentRounds),
    db
      .select({
        id: templateVersions.id,
        templateId: templateVersions.templateId,
        versionNumber: templateVersions.versionNumber,
        status: templateVersions.status,
      })
      .from(templateVersions),
  ]);

  // latest PUBLISHED version ต่อ template — แทน N+1 field-count loop ของ endpoint เดิม
  const latestPublishedByTemplate = new Map<string, { id: string; versionNumber: number }>();
  for (const v of allVersions) {
    if (v.status !== 'PUBLISHED') continue;
    const cur = latestPublishedByTemplate.get(v.templateId);
    if (!cur || v.versionNumber > cur.versionNumber) {
      latestPublishedByTemplate.set(v.templateId, { id: v.id, versionNumber: v.versionNumber });
    }
  }
  const versionById = new Map(allVersions.map((v) => [v.id, v]));

  const comparison: DashboardComparisonItem[] = [];
  for (const round of allRounds) {
    const current = versionById.get(round.templateVersionId);
    const latest = current ? latestPublishedByTemplate.get(current.templateId) : undefined;

    // สูตรเดียวกับ endpoint เดิม (รวมกรณี template ไม่มี PUBLISHED เลย → outdated)
    const isOutdated = current?.id !== latest?.id;
    const needsUpdate = isOutdated && round.status === 'ACTIVE';

    // ส่งเฉพาะแถวที่ governance สนใจ — buildGovernanceAlerts ฝั่ง client
    // กรองแถวที่ไม่ outdated ทิ้งอยู่แล้ว จึงได้ alerts ชุดเดิมทุกประการ
    if (!isOutdated && !needsUpdate) continue;

    comparison.push({
      roundId: round.id,
      roundTitle: round.title,
      roundStatus: round.status,
      isOutdated,
      needsUpdate,
      currentVersionNumber: current?.versionNumber ?? 0,
      latestVersionNumber: latest?.versionNumber ?? 0,
    });
  }

  return comparison;
}

async function buildActivities(db: DB): Promise<DashboardActivitiesData> {
  // select เฉพาะ 5 คอลัมน์ที่ UI อ่าน — payload/ipAddress (มี email/IP) ไม่ออกจาก DB
  const items = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(ACTIVITIES_LIMIT);

  // resolver ล้ม → ไม่มี display → frontend fallback UUID ย่อ (fail-open เดิม)
  let displays: Record<string, { name: string | null; secondary: string | null }> = {};
  try {
    displays = await resolveAuditEntityDisplays(db, items);
  } catch (displayErr) {
    console.error('[DASHBOARD_OVERVIEW] Failed to resolve entity displays:', displayErr);
  }

  return {
    items: items.map((log) => ({ ...log, display: displays[log.id] ?? null })),
  };
}

// ── Aggregate ────────────────────────────────────────────────────────────────

function logSectionError(section: string, err: unknown): void {
  console.error(`[DASHBOARD_OVERVIEW] section "${section}" failed:`, err);
}

/**
 * รวม KPI ทั้งหมดของ Executive Dashboard — section ใดล้ม = null + รายชื่อใน errors[]
 * (Promise.all ที่แต่ละ section catch เอง → section อื่นไม่กระทบ)
 */
export async function buildDashboardOverview(
  db: DB,
  opts: { isSuperAdmin: boolean; now?: Date },
): Promise<DashboardOverviewData> {
  const now = opts.now ?? new Date();
  const errors: string[] = [];

  const catchSection = <T,>(section: string, work: () => Promise<T>): Promise<T | null> =>
    work().catch((err: unknown) => {
      logSectionError(section, err);
      errors.push(section);
      return null;
    });

  const [summary, pending, rounds, comparison, activities] = await Promise.all([
    catchSection('summary', () => buildSummary(db)),
    catchSection('pending', () => buildPending(db, now)),
    catchSection('rounds', () => buildRounds(db)),
    catchSection('comparison', () => buildComparison(db)),
    // policy เดียวกับ GET /admin/audit-logs: ไม่ใช่ SUPER_ADMIN → ไม่ query เลย
    // (ไม่นับเป็น error — ผู้ขอไม่มีสิทธิ์อ่าน audit log ตั้งแต่ต้น)
    opts.isSuperAdmin ? catchSection('activities', () => buildActivities(db)) : Promise.resolve(null),
  ]);

  return { summary, pending, rounds, comparison, activities, errors };
}
