/**
 * Dashboard Overview — pure logic layer
 * -------------------------------------
 * ตรรกะทั้งหมดของ Executive Dashboard ที่ไม่ต้องใช้ React
 * แยกออกมาเพื่อให้เทสได้ด้วย node --import tsx (แบบเดียวกับ lib อื่นในระบบ)
 *
 * V2 (single endpoint): หน้า dashboard เรียก GET /admin/dashboard/overview
 * เพียง request เดียว — backend aggregate ครบทุก section ให้ (นับ/หางานค้าง
 * ที่ server แทนการ fetch แถวมานับฝั่ง client) แล้วหน้านี้ map ผลลัพธ์เข้า
 * DashboardSnapshot รูปทรงเดิมผ่าน buildDashboardSnapshotFromOverview
 *
 * ฟังก์ชันชุด buildDashboardSnapshot เดิม (จาก 5 endpoint) คงไว้เพื่อ
 * backward compatibility และเป็นตัวอ้างอิง semantics ของแต่ละ KPI
 *
 * Endpoint แบบเก่า (คงใช้งานได้จากหน้าอื่น):
 *   GET /admin/applications/summary?roundId=      → { data: { total, byStatus } }
 *   GET /admin/applications?status=&page=&pageSize= → { data, pagination }
 *   GET /admin/rounds?view=active                 → { data: Round[] }
 *   GET /admin/audit-logs?pageSize=               → { items, total, ... }
 *   GET /admin/rounds/comparison                  → { data: Comparison[] }
 */

// =============================================================================
// Types
// =============================================================================

/** สถานะใบสมัครตาม CHECK constraint ของตาราง applications (6 ค่า) */
export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'QUALIFIED',
  'REJECTED',
  'CANCELED',
  'ARCHIVED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * สถานะที่ "รอการตัดสิน" — งานค้างของผู้ดูแล
 * SUBMITTED = ยื่นแล้วยังไม่มีใครตัดสิน
 * (DRAFT ไม่นับ: ผู้สมัครยังไม่ส่ง, QUALIFIED/REJECTED = ตัดสินแล้ว,
 *  CANCELED = ยกเลิก, ARCHIVED = เก็บเข้าคลัง)
 */
export const PENDING_STATUSES: readonly ApplicationStatus[] = ['SUBMITTED'];

export interface ApplicationSummary {
  total: number;
  byStatus: Record<string, number>;
}

export interface ApplicationListItem {
  id: string;
  applicationNo?: string | null;
  fullname?: string | null;
  email?: string | null;
  status?: string | null;
  submittedAt?: number | string | Date | null;
  roundId?: string | null;
}

export interface RoundItem {
  id: string;
  title: string;
  status?: string | null;
  roundCode?: string | null;
  openDate?: number | string | Date | null;
  closeDate?: number | string | Date | null;
  deletedAt?: number | string | Date | null;
  positionLevel?: string | null;
}

export interface RoundComparisonItem {
  roundId: string;
  roundTitle: string;
  roundStatus?: string | null;
  isOutdated?: boolean;
  needsUpdate?: boolean;
  currentVersionNumber?: number;
  latestVersionNumber?: number;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt?: number | string | Date | null;
  display?: { name: string | null; secondary: string | null } | null;
}

// =============================================================================
// Date helpers
// =============================================================================

const SECONDS_THRESHOLD = 10_000_000_000;

/**
 * แปลงค่าที่ API ส่งมาเป็น Date — รองรับ Date / ISO string / unix seconds / unix ms
 * (backend ส่ง timestamp เป็นวินาทีในหลาย endpoint แต่ D1/drizzle อาจคืน Date)
 */
export function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const ms = value < SECONDS_THRESHOLD ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const ms = numeric < SECONDS_THRESHOLD ? numeric * 1000 : numeric;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const MS_PER_DAY = 86_400_000;

/** จำนวนวันเต็มระหว่างสองช่วงเวลา (ปัดลง) — null ถ้าข้อมูลไม่พอ */
export function daysBetween(from: unknown, to: unknown): number | null {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** อายุเป็นวันของวันที่หนึ่งเทียบกับ "ตอนนี้" — null ถ้าอนาคตหรือข้อมูลเสีย */
export function ageInDays(value: unknown, now: Date = new Date()): number | null {
  const d = toDate(value);
  if (!d) return null;
  const diff = Math.floor((now.getTime() - d.getTime()) / MS_PER_DAY);
  return diff < 0 ? null : diff;
}

/** เหลืออีกกี่วันถึงวันปิดรับ (ติดลบ = เลยกำหนดแล้ว) */
export function daysUntil(value: unknown, now: Date = new Date()): number | null {
  const d = toDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / MS_PER_DAY);
}

// =============================================================================
// KPI: Application status cards
// =============================================================================

export interface StatusCard {
  status: ApplicationStatus;
  label: string;
  count: number;
  /** สัดส่วนต่อ total (0–1) — 0 เมื่อ total = 0 */
  share: number;
  className: string;
}

const STATUS_CARD_META: Record<ApplicationStatus, { label: string; className: string }> = {
  DRAFT: { label: 'ฉบับร่าง', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  SUBMITTED: { label: 'รอการตรวจสอบ', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  QUALIFIED: { label: 'ผ่านการตรวจสอบ', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  REJECTED: { label: 'ข้อมูลไม่ครบถ้วน', className: 'bg-red-100 text-red-800 border-red-200' },
  CANCELED: { label: 'ยกเลิกใบสมัคร', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  ARCHIVED: { label: 'เก็บเข้าคลัง', className: 'bg-purple-100 text-purple-800 border-purple-200' },
};

/**
 * สร้างการ์ด KPI จาก /admin/applications/summary
 *
 * ⚠️ เหตุผลที่ต้องมีฟังก์ชันนี้: backend สร้าง byStatus ไว้แค่ 5 สถานะ
 * (ไม่มี DRAFT — admin.routes.ts ~L2262) ถ้ามีแถว DRAFT จริง ผลบวกของ
 * byStatus จะไม่เท่ากับ total และการ์ดจะดูเหมือนข้อมูลหาย
 * ฟังก์ชันนี้จึง normalize ครบ 6 สถานะ และคืน `unaccounted` ให้ UI เตือนได้
 */
export function buildStatusCards(summary: ApplicationSummary | null | undefined): {
  total: number;
  cards: StatusCard[];
  /** ผลต่างระหว่าง total กับผลบวก byStatus — ควรเป็น 0 */
  unaccounted: number;
} {
  const total = Number(summary?.total ?? 0) || 0;
  const byStatus = summary?.byStatus ?? {};

  const cards: StatusCard[] = APPLICATION_STATUSES.map((status) => {
    const count = Number(byStatus[status] ?? 0) || 0;
    return {
      status,
      label: STATUS_CARD_META[status].label,
      count,
      share: total > 0 ? count / total : 0,
      className: STATUS_CARD_META[status].className,
    };
  });

  const accounted = cards.reduce((sum, c) => sum + c.count, 0);

  return { total, cards, unaccounted: total - accounted };
}

/** จำนวนที่รอการตัดสิน (SUBMITTED) จาก summary */
export function pendingCount(summary: ApplicationSummary | null | undefined): number {
  const byStatus = summary?.byStatus ?? {};
  return PENDING_STATUSES.reduce((sum, s) => sum + (Number(byStatus[s] ?? 0) || 0), 0);
}

// =============================================================================
// KPI: Pending decisions (งานค้าง)
// =============================================================================

export interface PendingDecision {
  /**
   * จำนวนงานค้างทั้งหมด — มาจาก `pagination.total` ของ backend เมื่อมี
   * (ไม่ใช่จำนวนแถวที่โหลดมา ซึ่งถูกจำกัดด้วย pageSize)
   */
  count: number;
  /** จำนวนแถวที่โหลดมาจริงในหน้านี้ (≤ pageSize) */
  fetchedCount: number;
  /**
   * true เมื่อ count > fetchedCount — ข้อมูลที่โหลดมาไม่ครบทั้งชุด
   * อายุ/overdue ที่คำนวณได้จึงเป็นค่าจาก subset เท่านั้น (ต้องบอกผู้ใช้)
   */
  truncated: boolean;
  /** อายุของใบที่ค้างนานที่สุด (วัน) — null เมื่อไม่มีใบค้าง */
  oldestAgeDays: number | null;
  /** ใบที่ค้างนานที่สุด (ใช้โชว์ตัวอย่าง) */
  oldest: ApplicationListItem | null;
  /** จำนวนใบที่ค้างเกินเกณฑ์ SLA */
  overdueCount: number;
  /** เกณฑ์ที่ใช้ตัดสินว่า "เกินกำหนด" (วัน) */
  slaDays: number;
}

/** เกณฑ์ SLA เริ่มต้นสำหรับการพิจารณาใบสมัคร */
export const DEFAULT_SLA_DAYS = 7;

/**
 * สรุปงานค้างจากรายการใบสมัคร (กรอง SUBMITTED ฝั่ง client)
 * ใช้ endpoint /admin/applications?status=SUBMITTED&pageSize=200 ที่มีอยู่แล้ว
 *
 * ⚠️ count ต้องมาจาก `pagination.total` ของ backend ไม่ใช่ items.length
 * เพราะ items ถูกจำกัดด้วย pageSize — ถ้าใบค้างเกิน 200 ใบ การนับจาก items
 * จะรายงานต่ำกว่าความจริง (และ KPI จะดู "เขียว" ทั้งที่มีงานค้างค้างอยู่)
 */
export function buildPendingDecisions(
  items: readonly ApplicationListItem[] | null | undefined,
  now: Date = new Date(),
  slaDays: number = DEFAULT_SLA_DAYS,
  total?: number | null,
): PendingDecision {
  const pending = (items ?? []).filter(
    (a) => a && typeof a.status === 'string' && PENDING_STATUSES.includes(a.status as ApplicationStatus),
  );

  let oldest: ApplicationListItem | null = null;
  let oldestAgeDays: number | null = null;
  let overdueCount = 0;

  for (const item of pending) {
    const age = ageInDays(item.submittedAt, now);
    if (age == null) continue;
    if (oldestAgeDays == null || age > oldestAgeDays) {
      oldestAgeDays = age;
      oldest = item;
    }
    if (age > slaDays) overdueCount += 1;
  }

  const fetchedCount = pending.length;
  // total จาก backend เป็น source of truth; ไม่มี/ค่าเสีย → ใช้จำนวนที่โหลดมา
  const parsedTotal = Number(total);
  const count =
    total != null && Number.isFinite(parsedTotal) && parsedTotal >= fetchedCount
      ? parsedTotal
      : fetchedCount;

  return {
    count,
    fetchedCount,
    truncated: count > fetchedCount,
    oldestAgeDays,
    oldest,
    overdueCount,
    slaDays,
  };
}

// =============================================================================
// KPI: Active recruitment rounds
// =============================================================================

export type RoundUrgency = 'overdue' | 'closing-soon' | 'open' | 'not-open' | 'closed' | 'unknown';

export interface ActiveRoundRow {
  id: string;
  title: string;
  roundCode: string | null;
  status: string;
  openDate: Date | null;
  closeDate: Date | null;
  /** เหลืออีกกี่วันถึงปิดรับ (ติดลบ = เลยกำหนด) */
  daysLeft: number | null;
  urgency: RoundUrgency;
  urgencyLabel: string;
  urgencyClassName: string;
}

/** เกณฑ์ "ใกล้ปิด" (วัน) */
export const CLOSING_SOON_DAYS = 7;

const URGENCY_META: Record<RoundUrgency, { label: string; className: string }> = {
  overdue: { label: 'เลยกำหนดแต่ยังเปิด', className: 'bg-red-100 text-red-800 border-red-200' },
  'closing-soon': { label: 'ใกล้ปิดรับ', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  open: { label: 'เปิดรับอยู่', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  'not-open': { label: 'ยังไม่เปิด', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  closed: { label: 'ปิดรับแล้ว', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  unknown: { label: 'ไม่ทราบช่วงเวลา', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/**
 * จัดเรียงรอบที่เปิดรับ + คำนวณความเร่งด่วน
 *
 * กติกา:
 * - ตัดรอบที่ถูกลบ (deletedAt) ออก
 * - รอบ ACTIVE ที่เลย closeDate แล้ว → "overdue" (ต้องปิดหรือขยายเวลา)
 * - เรียงตาม closeDate จากใกล้สุดไปไกลสุด (งานที่ต้องจัดการก่อนอยู่บน)
 */
export function buildActiveRounds(
  rounds: readonly RoundItem[] | null | undefined,
  now: Date = new Date(),
): ActiveRoundRow[] {
  const rows: ActiveRoundRow[] = [];

  for (const round of rounds ?? []) {
    if (!round || round.deletedAt) continue;

    const status = (round.status ?? '').toUpperCase();
    const openDate = toDate(round.openDate);
    const closeDate = toDate(round.closeDate);
    const daysLeft = daysUntil(round.closeDate, now);

    let urgency: RoundUrgency;
    if (status === 'CLOSED') {
      urgency = 'closed';
    } else if (status === 'DRAFT') {
      urgency = 'not-open';
    } else if (daysLeft == null) {
      urgency = 'unknown';
    } else if (daysLeft < 0) {
      urgency = 'overdue';
    } else if (daysLeft <= CLOSING_SOON_DAYS) {
      urgency = 'closing-soon';
    } else {
      urgency = 'open';
    }

    rows.push({
      id: round.id,
      title: round.title,
      roundCode: round.roundCode ?? null,
      status,
      openDate,
      closeDate,
      daysLeft,
      urgency,
      urgencyLabel: URGENCY_META[urgency].label,
      urgencyClassName: URGENCY_META[urgency].className,
    });
  }

  // เรียง: overdue ก่อน → ใกล้ปิด → เปิดอยู่ → อื่น ๆ; ภายในกลุ่มใช้ closeDate
  const rank: Record<RoundUrgency, number> = {
    overdue: 0,
    'closing-soon': 1,
    open: 2,
    'not-open': 3,
    closed: 4,
    unknown: 5,
  };

  return rows.sort((a, b) => {
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
    const at = a.closeDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.closeDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}

/** นับรอบที่เลยกำหนดแต่ยัง ACTIVE — ใช้ทั้งการ์ด KPI และ governance alert */
export function countOverdueRounds(rows: readonly ActiveRoundRow[]): number {
  return rows.filter((r) => r.urgency === 'overdue').length;
}

// =============================================================================
// KPI: Template governance alerts
// =============================================================================

export interface GovernanceAlert {
  roundId: string;
  roundTitle: string;
  roundStatus: string;
  currentVersionNumber: number;
  latestVersionNumber: number;
  severity: 'high' | 'medium';
  message: string;
}

/**
 * รอบที่ใช้ template version เก่ากว่าที่ publish ล่าสุด
 * source: /admin/rounds/comparison (มี isOutdated / needsUpdate อยู่แล้ว)
 *
 * needsUpdate = true → รอบ ACTIVE ที่ควรอัปเดต (severity high)
 * isOutdated = true แต่ไม่ needsUpdate → รอบที่ไม่ได้ ACTIVE (medium)
 */
export function buildGovernanceAlerts(
  comparison: readonly RoundComparisonItem[] | null | undefined,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  for (const row of comparison ?? []) {
    if (!row) continue;
    if (!row.isOutdated && !row.needsUpdate) continue;

    const current = Number(row.currentVersionNumber ?? 0);
    const latest = Number(row.latestVersionNumber ?? 0);
    const severity: 'high' | 'medium' = row.needsUpdate ? 'high' : 'medium';

    alerts.push({
      roundId: row.roundId,
      roundTitle: row.roundTitle,
      roundStatus: (row.roundStatus ?? '').toUpperCase(),
      currentVersionNumber: current,
      latestVersionNumber: latest,
      severity,
      message:
        latest > current
          ? `ใช้ v${current} แต่มี v${latest} ที่ publish แล้ว`
          : `ใช้ template version ที่ไม่ใช่ล่าสุด`,
    });
  }

  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return a.roundTitle.localeCompare(b.roundTitle, 'th');
  });
}

// =============================================================================
// KPI: Recent activities
// =============================================================================

export interface RecentActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** ชื่อที่ resolve ได้จาก backend (display) — null ถ้าไม่มี */
  primary: string | null;
  secondary: string | null;
  createdAt: Date | null;
  /** เวลาที่ผ่านมาเป็นภาษาคน เช่น "3 ชั่วโมงที่แล้ว" */
  relative: string;
}

/** แปลงระยะเวลาเป็นข้อความไทยแบบสั้น */
export function formatRelativeTime(value: unknown, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '-';

  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return 'เมื่อสักครู่';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;

  return `${Math.floor(months / 12)} ปีที่แล้ว`;
}

/**
 * เตรียมแถวกิจกรรมล่าสุดจาก /admin/audit-logs
 * ใช้ display ที่ backend resolve มาให้แล้ว (ชื่อ entity) — ไม่ต้องยิงเพิ่ม
 */
export function buildRecentActivities(
  items: readonly AuditLogItem[] | null | undefined,
  now: Date = new Date(),
  limit = 10,
): RecentActivityRow[] {
  return (items ?? [])
    .filter((log) => log && log.id)
    .slice(0, limit)
    .map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      primary: log.display?.name ?? null,
      secondary: log.display?.secondary ?? null,
      createdAt: toDate(log.createdAt),
      relative: formatRelativeTime(log.createdAt, now),
    }));
}

// =============================================================================
// Aggregate — ใช้ใน UI เพื่อลดการคำนวณซ้ำ
// =============================================================================

export interface DashboardSnapshot {
  statusCards: ReturnType<typeof buildStatusCards>;
  pending: PendingDecision;
  rounds: ActiveRoundRow[];
  overdueRounds: number;
  alerts: GovernanceAlert[];
  activities: RecentActivityRow[];
}

export function buildDashboardSnapshot(input: {
  summary?: ApplicationSummary | null;
  pendingItems?: readonly ApplicationListItem[] | null;
  /** จำนวนงานค้างทั้งหมดจาก pagination.total (ไม่ใช่จำนวนแถวที่โหลดมา) */
  pendingTotal?: number | null;
  rounds?: readonly RoundItem[] | null;
  comparison?: readonly RoundComparisonItem[] | null;
  activities?: readonly AuditLogItem[] | null;
  now?: Date;
  slaDays?: number;
  activityLimit?: number;
}): DashboardSnapshot {
  const now = input.now ?? new Date();
  const rounds = buildActiveRounds(input.rounds, now);

  return {
    statusCards: buildStatusCards(input.summary),
    pending: buildPendingDecisions(
      input.pendingItems,
      now,
      input.slaDays ?? DEFAULT_SLA_DAYS,
      input.pendingTotal,
    ),
    rounds,
    overdueRounds: countOverdueRounds(rounds),
    alerts: buildGovernanceAlerts(input.comparison),
    activities: buildRecentActivities(input.activities, now, input.activityLimit ?? 10),
  };
}

// =============================================================================
// V2 — single endpoint: GET /admin/dashboard/overview
// =============================================================================
// Backend aggregate ครบทุก section ใน request เดียว (fail-soft ต่อ section —
// section ใดล้ม = null + ชื่อ section ใน errors[]) แล้ว map เข้า
// DashboardSnapshot รูปทรงเดิม เพื่อให้ UI คงเดิมทุกอย่าง

/** งานค้างที่ backend คำนวณจากชุดเต็มแล้ว — UI ไม่ต้อง fetch แถวมานับเอง */
export interface PendingOverview {
  /** จำนวนงานค้างทั้งระบบ (COUNT จริงจาก backend) */
  total: number;
  /** จำนวนใบที่ค้างเกิน slaDays (คำนวณที่ backend จากชุดเต็ม) */
  overdueCount: number;
  /** submittedAt ของใบที่ค้างนานที่สุด — null เมื่อไม่มีงานค้าง */
  oldestSubmittedAt: string | number | Date | null;
  /** เกณฑ์ SLA ที่ backend ใช้คำนวณ overdueCount */
  slaDays: number;
  /** แถวตัวอย่าง ≤ 5 แถวล่าสุด (UI แสดง 5 แถวเท่านั้น) */
  items: ApplicationListItem[];
}

/** รูปทรง response ของ GET /admin/dashboard/overview */
export interface DashboardOverviewPayload {
  summary: ApplicationSummary | null;
  pending: PendingOverview | null;
  rounds: RoundItem[] | null;
  comparison: RoundComparisonItem[] | null;
  /** null เมื่อผู้ขอไม่ใช่ SUPER_ADMIN (policy เดียวกับ /admin/audit-logs) */
  activities: { items: AuditLogItem[] } | null;
  /** ชื่อ section ที่ query ล้ม — [] เมื่อทุกส่วนปกติ */
  errors: string[];
}

/**
 * สรุปงานค้างจากค่าที่ backend aggregate มาแล้ว (แทน buildPendingDecisions)
 *
 * ต่างจาก V1: ไม่มี `truncated` — V1 ต้อง fetch ได้ถึง 200 แถวมาคำนวณ subset
 * แล้วเตือนว่า "คำนวณจาก N ใบแรก"; V2 นับ/หาอายุที่ server จากชุดเต็มทั้งหมด
 * จึงถูกต้องเสมอ (truncated = false ตลอด)
 */
export function pendingFromOverview(
  pending: PendingOverview | null | undefined,
  now: Date = new Date(),
): PendingDecision {
  const items = pending?.items ?? [];

  const rawSla = Number(pending?.slaDays);
  const slaDays = Number.isFinite(rawSla) && rawSla > 0 ? rawSla : DEFAULT_SLA_DAYS;

  const parsedTotal = Number(pending?.total);
  const total = pending != null && Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : 0;

  const rawOverdue = Number(pending?.overdueCount);
  const overdueCount = Number.isFinite(rawOverdue) && rawOverdue >= 0 ? rawOverdue : 0;

  return {
    count: Math.max(total, items.length),
    fetchedCount: items.length,
    truncated: false,
    oldestAgeDays: ageInDays(pending?.oldestSubmittedAt ?? null, now),
    oldest: null,
    overdueCount,
    slaDays,
  };
}

/**
 * สร้าง DashboardSnapshot (รูปทรงเดิมที่ UI ใช้) จาก response ของ
 * GET /admin/dashboard/overview — reuse helper เดิมทุกตัว
 * (buildStatusCards / buildActiveRounds / buildGovernanceAlerts /
 * buildRecentActivities) จึงได้ผลลัพธ์เหมือน V1 ยกเว้น pending ที่แม่นกว่า
 */
export function buildDashboardSnapshotFromOverview(
  overview: DashboardOverviewPayload | null | undefined,
  now: Date = new Date(),
): DashboardSnapshot {
  const rounds = buildActiveRounds(overview?.rounds, now);

  return {
    statusCards: buildStatusCards(overview?.summary),
    pending: pendingFromOverview(overview?.pending, now),
    rounds,
    overdueRounds: countOverdueRounds(rounds),
    alerts: buildGovernanceAlerts(overview?.comparison),
    activities: buildRecentActivities(overview?.activities?.items, now, 10),
  };
}
