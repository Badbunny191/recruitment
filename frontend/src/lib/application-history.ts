/**
 * Application History — grouping / transition resolver
 * -----------------------------------------------------
 * ตรรกะล้วน (pure) สำหรับส่วน "ประวัติการดำเนินการ" ในหน้าใบสมัคร:
 *
 *   1. parseAuditPayload    — audit_logs.payload เป็น TEXT (mode 'json') ที่
 *                             backend เขียนด้วย JSON.stringify → response ส่งมา
 *                             เป็น string หรือ object ก็ได้ ทั้งคู่ต้องอ่านได้
 *   2. getStatusTransition  — ดึง "เดิม → ใหม่" จาก payload จริงเท่านั้น
 *                             (previousStatus + changes[field='status'])
 *                             ไม่มีข้อมูล → คืน null แล้ว UI แสดงแบบเดิม
 *   3. groupHistory         — จัดกลุ่มตามวัน (local date) + ยุบ
 *                             PDF_DOWNLOAD ซ้ำของ actor เดียวกันในวันเดียวกัน
 *
 * กติกาการยุบ (ตามสเปก):
 *   grouping key = date + action + actor
 *   - ห้ามยุบข้ามวัน
 *   - ห้ามยุบข้าม actor
 *   - ห้ามยุบข้าม action (เฉพาะ action ที่อยู่ใน AGGREGATABLE_ACTIONS)
 *   - กลุ่มที่มีเหตุการณ์เดียว → แสดงเป็นรายการเดี่ยวตามปกติ
 *
 * ไม่แตะ API: input คือ array ที่ endpoint เดิมส่งมาอยู่แล้ว
 */

/** เหตุการณ์ 1 แถวจาก GET /admin/applications/:id/history */
export interface HistoryEvent {
  id: string;
  action: string;
  adminId: string;
  adminEmail: string;
  /** payload ดิบจาก DB — string (JSON) หรือ object หรือ null */
  payload: unknown;
  /** unix seconds (backend แปลงด้วย toUnixTimestamp) */
  createdAt: number | null;
}

/** 1 รายการใน payload.changes ที่ backend สร้าง (change-tracking.ts) */
export interface AuditFieldChange {
  field?: string;
  fieldLabel?: string;
  oldValue?: string | null;
  newValue?: string | null;
}

export interface ParsedAuditPayload {
  changes?: AuditFieldChange[];
  summary?: string;
  /** UPDATE สถานะใบสมัคร — admin.routes.ts ใส่ app.status เดิมไว้ที่นี่ */
  previousStatus?: string | null;
  /** legacy: บาง payload เก่าอาจเก็บสถานะใหม่ตรง ๆ */
  status?: string | null;
  /** legacy: เหตุผลที่เก็บแบบ flat */
  reason?: string | null;
}

/**
 * แปลง payload ให้เป็น object — คืน null เมื่อไม่มี/อ่านไม่ได้
 * (ห้าม throw: payload เก่าใน DB อาจไม่ใช่ JSON ที่ถูกต้อง)
 */
export function parseAuditPayload(payload: unknown): ParsedAuditPayload | null {
  if (payload == null) return null;
  if (typeof payload === 'object') return payload as ParsedAuditPayload;
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (trimmed === '') return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as ParsedAuditPayload) : null;
  } catch {
    return null;
  }
}

function findStatusChange(payload: ParsedAuditPayload | null): AuditFieldChange | null {
  if (!payload || !Array.isArray(payload.changes)) return null;
  return payload.changes.find((c) => c && c.field === 'status') || null;
}

export interface StatusTransition {
  /** สถานะเดิม (raw enum) — null เมื่อ payload ไม่ได้บันทึกไว้ */
  from: string | null;
  /** สถานะใหม่ (raw enum) */
  to: string;
}

/**
 * การเปลี่ยนสถานะใบสมัคร — ใช้เฉพาะข้อมูลที่ payload มีจริง
 * ลำดับความเชื่อถือ: changes[field='status'] (backend สร้างจาก handleApplicationStatusChange)
 * → previousStatus (enrichment) → legacy payload.status
 * คืน null เมื่อไม่มีสถานะใหม่ให้แสดง
 */
export function getStatusTransition(event: HistoryEvent): StatusTransition | null {
  const payload = parseAuditPayload(event.payload);
  if (!payload) return null;

  const change = findStatusChange(payload);

  const to = change?.newValue ?? payload.status ?? null;
  if (!to) return null;

  const from = payload.previousStatus ?? change?.oldValue ?? null;

  return { from: from || null, to };
}

/** เหตุผลการเปลี่ยนสถานะ (ถ้า payload บันทึกไว้) — ใช้แทน payload.reason เดิม */
export function getStatusReason(event: HistoryEvent): string | null {
  const payload = parseAuditPayload(event.payload);
  if (!payload) return null;
  if (Array.isArray(payload.changes)) {
    const change = payload.changes.find((c) => c && c.field === 'statusReason');
    if (change && change.newValue) return change.newValue;
  }
  return typeof payload.reason === 'string' && payload.reason ? payload.reason : null;
}

// =============================================================================
// Grouping
// =============================================================================

/** action ที่อนุญาตให้ยุบเมื่อเกิดซ้ำในวันเดียวกัน — ตอนนี้มี PDF_DOWNLOAD เท่านั้น */
export const AGGREGATABLE_ACTIONS: readonly string[] = ['PDF_DOWNLOAD'];

export function isAggregatableAction(action: string): boolean {
  return AGGREGATABLE_ACTIONS.includes(action);
}

export type HistoryRow =
  | { kind: 'single'; key: string; event: HistoryEvent }
  | {
      kind: 'group';
      key: string;
      action: string;
      actor: string;
      /** เรียงจากใหม่ → เก่า (ตรงกับลำดับที่ backend ส่งมา) */
      events: HistoryEvent[];
    };

export interface HistoryDay {
  /** คีย์ภายใน เช่น "2026-9-25" หรือ "unknown" */
  key: string;
  /** null = วันที่อ่านไม่ได้ (createdAt หาย) */
  date: Date | null;
  /** หัวข้อวันภาษาไทย เช่น "25 ตุลาคม 2569" */
  label: string;
  rows: HistoryRow[];
  /** จำนวนเหตุการณ์ดิบในวันนี้ (ไม่ใช่จำนวนแถวที่แสดง) */
  count: number;
}

/** แปลง timestamp (unix seconds หรือ ms) เป็น Date — null เมื่ออ่านไม่ได้ */
export function toDate(timestamp: number | null | undefined): Date | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** คีย์วันตาม timezone ของผู้ใช้ (ไม่ใช่ UTC) เพื่อให้ "วัน" ตรงกับที่ HR ทำงาน */
function dayKey(date: Date | null): string {
  if (!date) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "25 ตุลาคม 2569" (พ.ศ. มาจาก locale th-TH) */
export function formatDayLabel(date: Date | null): string {
  if (!date) return 'ไม่ระบุวันที่';
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "22:38" — 24 ชั่วโมง, ไม่มีวินาที */
export function formatTime(timestamp: number | null): string {
  const date = toDate(timestamp);
  if (!date) return '-';
  return date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function actorKey(event: HistoryEvent): string {
  return event.adminEmail || event.adminId || '';
}

function rowKey(dayKeyStr: string, action: string, actor: string): string {
  return `${dayKeyStr}|${action}|${actor}`;
}

/**
 * จัดกลุ่มเหตุการณ์เป็นรายวัน แล้วยุบ action ที่อนุญาตให้ยุบ
 *
 * input: array ที่ backend ส่งมา (เรียงใหม่ → เก่าแล้ว)
 * output: วันเรียงใหม่ → เก่า, ในแต่ละวันแถวเรียงตาม anchor (เหตุการณ์ล่าสุด
 *         ของแต่ละกลุ่ม) — ลำดับรวมจึงยังเป็นใหม่ → เก่าเหมือนเดิม
 */
export function groupHistory(events: HistoryEvent[]): HistoryDay[] {
  const days = new Map<string, { date: Date | null; rows: HistoryRow[]; index: Map<string, number>; count: number }>();

  for (const event of events) {
    const date = toDate(event.createdAt);
    const dKey = dayKey(date);

    let day = days.get(dKey);
    if (!day) {
      day = { date, rows: [], index: new Map(), count: 0 };
      days.set(dKey, day);
    }
    day.count += 1;

    if (!isAggregatableAction(event.action)) {
      day.rows.push({ kind: 'single', key: `s|${event.id}`, event });
      continue;
    }

    const actor = actorKey(event);
    const gKey = rowKey(dKey, event.action, actor);
    const existingIndex = day.index.get(gKey);

    if (existingIndex === undefined) {
      day.rows.push({
        kind: 'group',
        key: gKey,
        action: event.action,
        actor,
        events: [event],
      });
      day.index.set(gKey, day.rows.length - 1);
      continue;
    }

    const row = day.rows[existingIndex];
    if (row.kind === 'group') {
      row.events.push(event);
    }
  }

  // กลุ่มที่มีเหตุการณ์เดียวไม่ใช่ "การยุบ" — คืนเป็นรายการเดี่ยว
  // (ให้ผู้ใช้เห็น 1 แถวเสมอ ไม่มีปุ่มขยายที่กดแล้วไม่มีอะไรเพิ่ม)
  const result: HistoryDay[] = [];
  Array.from(days.entries()).forEach(([key, day]) => {
    const rows = day.rows.map<HistoryRow>((row) =>
      row.kind === 'group' && row.events.length === 1
        ? { kind: 'single', key: `s|${row.events[0].id}`, event: row.events[0] }
        : row,
    );
    result.push({
      key,
      date: day.date,
      label: formatDayLabel(day.date),
      rows,
      count: day.count,
    });
  });

  return result;
}

/** ช่วงเวลา "22:38 - 23:18" (เก่า → ใหม่ ตามที่ผู้ใช้กดดู) */
export function formatTimeRange(events: HistoryEvent[]): string {
  if (events.length === 0) return '-';
  const latest = events[0];
  const earliest = events[events.length - 1];
  if (events.length === 1) return formatTime(earliest.createdAt);
  return `${formatTime(earliest.createdAt)} - ${formatTime(latest.createdAt)}`;
}

/** เหตุการณ์ในกลุ่มเรียงเก่า → ใหม่ (ใช้ตอนกดขยาย) */
export function chronological(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].reverse();
}