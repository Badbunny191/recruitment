/**
 * Applications Selector — Phase 5 foundation
 * ============================================================================
 * แปลง "สิ่งที่ผู้ใช้เลือก" เป็นเงื่อนไข query ก้อนเดียว ใช้ร่วมกันระหว่าง:
 *   - POST /admin/applications/bulk-status
 *   - POST /admin/applications/export-selected
 *   - (future) pdf-targets
 *
 * ── Contract (Phase 5) ────────────────────────────────────────────────────
 *
 *   type ApplicationsSelector =
 *     | { kind: 'ids'; ids: string[] }
 *     | {
 *         kind: 'filter';
 *         filter: { roundId: string; search?: string; status?: string };
 *         excludeIds?: string[];
 *       }
 *
 * หลักการ:
 *   1. Selector มีความหมายเดียว (single meaning) — ไม่ว่า endpoint ไหนอ่าน
 *      selector เดียวกัน ต้องได้ชุดใบสมัครชุดเดียวกันเป๊ะ
 *   2. kind 'filter' ใช้ buildApplicationsListWhere (roundId + search +
 *      deletedAt IS NULL) เป็นฐาน แล้วเติมเฉพาะส่วนที่ selector มีเพิ่ม:
 *      status list, excludeDraft, excludeIds → logic ไม่ถูก copy ไปที่อื่น
 *   3. kind 'ids' = รายการที่ระบุชัดเจน — ยังต้องกรอง deletedAt IS NULL
 *      เหมือนเดิม (behavior เดิมของ bulk-status / export-selected)
 *   4. backward compatible: payload เดิมทุกรูปยังทำงานเหมือนเดิม
 *        { ids }                          → kind 'ids'
 *        { applicationIds }               → kind 'ids'
 *        { selector: { kind:'filter', roundId, status?, search? } }  (flat, Phase 2)
 *                                         → kind 'filter' แบบ nested
 *      normalizeSelectorInput แปลงให้เป็น canonical form โดยไม่เปลี่ยน semantics
 *
 * ⚠️ Selector ไม่มี sort — selector นิยาม "ชุด" ไม่ใช่ "ลำดับ"
 *    ลำดับของผลลัพธ์เป็นเรื่องของแต่ละ endpoint (bulk ไม่มีลำดับ,
 *    export เรียง submittedAt DESC, id DESC ตาม contract เดิม)
 */

import { and, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { applications } from '../db/schema';
import { buildApplicationsListWhere } from './applications-list-query';

// ── Selection state (ฝั่ง UI) ──────────────────────────────────────────────
/**
 * สถานะการเลือกของผู้ใช้ — 3 ค่าเท่านั้น
 *   idle         = ยังไม่เลือกอะไร
 *   explicit     = เลือกเป็นรายใบ (รายการ id ชัดเจน)
 *   all-filtered = เลือกทั้งหมดตามตัวกรองปัจจุบัน (ไม่ต้องส่ง id ทั้งชุด)
 */
export type SelectionState = 'idle' | 'explicit' | 'all-filtered';

// ── Selector (payload ที่ส่งขึ้น server) ───────────────────────────────────
export interface ApplicationsSelectorIds {
  kind: 'ids';
  ids: string[];
}

/** ตัวกรองของ kind 'filter' — roundId บังคับเสมอ */
export interface ApplicationsSelectorFilterCriteria {
  /** บังคับ — ตัวกรองต้องผูกกับรอบเดียวเสมอ (กันการเลือกข้ามรอบโดยไม่ตั้งใจ) */
  roundId: string;
  /** คำค้น (applicationNo / fullname / email) */
  search?: string | null;
  /** สถานะเดียว หรือ comma-separated (เหมือน export GET) */
  status?: string | null;
}

export interface ApplicationsSelectorFilter {
  kind: 'filter';
  filter: ApplicationsSelectorFilterCriteria;
  /**
   * id ที่ผู้ใช้ "เอาออก" จากทั้งชุด (ติ๊กทั้งหมดแล้วยกเลิกบางใบ)
   * ใช้เฉพาะ kind 'filter' — ต้องเป็น subset ของชุดที่ filter ตรงอยู่แล้ว
   */
  excludeIds?: string[];
}

export type ApplicationsSelector = ApplicationsSelectorIds | ApplicationsSelectorFilter;

/**
 * จำนวน excludeIds สูงสุดที่ยอมรับ
 *
 * เหตุผล: excludeIds กลายเป็น bind parameter ของ `NOT IN (...)` ใน D1 ซึ่ง
 * จำกัด ~100 bind ต่อ statement — เกินกว่านี้ query จะล้มทั้งก้อน
 * เลือก 80 เพื่อเหลือที่ให้ bind อื่น (roundId/status/search/date)
 *
 * เกิน cap → reject (fail closed) ไม่ใช่ตัดทิ้งเงียบ ๆ
 */
export const MAX_SELECTOR_EXCLUDE_IDS = 80;

/**
 * สถานะที่ "ไม่ใช่ DRAFT" — ใช้เมื่อ selector ต้องตัด DRAFT ออก
 * (export semantics เดิม: buildExportWhere ตัด DRAFT โดย default)
 *
 * หมายเหตุ: excel-export.service มี ALL_APPLICATION_STATUSES ของตัวเอง
 * (ค่าตรงกัน) — ยังไม่รวมเป็นตัวเดียวเพื่อไม่ให้เกิด import cycle
 */
export const SELECTABLE_APPLICATION_STATUSES = [
  'SUBMITTED',
  'QUALIFIED',
  'REJECTED',
  'CANCELED',
  'ARCHIVED',
] as const;

// ── Normalize: payload หลายรูป → selector เดียว ────────────────────────────

export interface NormalizeSelectorResult {
  ok: boolean;
  selector?: ApplicationsSelector;
  error?: string;
}

/**
 * แปลง payload ที่รับมารูปใดก็ได้ให้เป็น ApplicationsSelector
 *
 * รูปที่รับ:
 *   { selector: { kind: 'ids',    ids: [...] } }
 *   { selector: { kind: 'filter', filter: { roundId, status?, search? }, excludeIds? } }  ← canonical
 *   { selector: { kind: 'filter', roundId, status?, search? } }                            ← flat (Phase 2)
 *   { ids: [...] }            ← legacy ของ bulk-status
 *   { applicationIds: [...] } ← legacy ของ export-selected
 *
 * กฎ:
 *   - ถ้ามี selector → ใช้ selector (ห้ามผสมกับ ids เดิม)
 *   - ถ้าไม่มี selector → ใช้ ids/applicationIds เดิม (backward compatible)
 *   - ไม่มีทั้งสอง → error
 */
export function normalizeSelectorInput(
  body: unknown,
  legacyIdsKey: 'ids' | 'applicationIds',
): NormalizeSelectorResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'payload ไม่ถูกต้อง' };
  }
  const raw = body as Record<string, unknown>;

  const hasSelector = raw.selector !== undefined && raw.selector !== null;
  const hasLegacyIds = raw[legacyIdsKey] !== undefined && raw[legacyIdsKey] !== null;

  // ห้ามส่งทั้งสองแบบพร้อมกัน — กำกวมว่าใช้ชุดไหน (fail closed)
  if (hasSelector && hasLegacyIds) {
    return {
      ok: false,
      error: `ห้ามส่ง selector พร้อมกับ ${legacyIdsKey} ในคำขอเดียวกัน`,
    };
  }

  if (hasSelector) {
    return normalizeSelectorObject(raw.selector);
  }

  if (hasLegacyIds) {
    const ids = raw[legacyIdsKey];
    if (!Array.isArray(ids)) {
      return { ok: false, error: `${legacyIdsKey} ต้องเป็น array` };
    }
    return { ok: true, selector: { kind: 'ids', ids: ids as string[] } };
  }

  return { ok: false, error: `กรุณาระบุ selector หรือ ${legacyIdsKey}` };
}

/** string ที่ trim แล้วไม่ว่าง → ค่านั้น, ไม่อย่างนั้น → null */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
}

/**
 * แปลง selector ที่ "อาจจะ" ยังเป็นรูป flat ของ Phase 2 → canonical form
 *
 * ใช้ที่ขอบของ service ที่ถูกเรียกด้วย object ตรง ๆ (ไม่ผ่าน HTTP/zod) เช่น
 * exportSelectedApplicationsExcel — เพื่อให้รูป flat เดิมยังทำงานได้
 * โดยไม่ต้องพึ่ง caller ทุกที่ให้แปลงเอง
 *
 * kind 'ids' และรูป nested อยู่แล้ว → คืนค่าเดิม (ไม่มี side effect)
 */
export function canonicalizeSelector(selector: ApplicationsSelector): ApplicationsSelector {
  if (selector.kind !== 'filter') return selector;

  const raw = selector as unknown as Record<string, unknown>;
  const nested =
    raw.filter && typeof raw.filter === 'object' && !Array.isArray(raw.filter)
      ? (raw.filter as Record<string, unknown>)
      : raw;

  const roundId = trimmedOrNull(nested.roundId) ?? '';
  const canonical: ApplicationsSelectorFilter = {
    kind: 'filter',
    filter: {
      roundId,
      status: trimmedOrNull(nested.status),
      search: trimmedOrNull(nested.search),
    },
  };

  const excludeIds = Array.isArray(raw.excludeIds)
    ? dedupeIds(raw.excludeIds as string[])
    : [];
  if (excludeIds.length > 0) canonical.excludeIds = excludeIds;

  return canonical;
}

/** ตรวจ selector object ที่ client ส่งมาตรง ๆ */
function normalizeSelectorObject(raw: unknown): NormalizeSelectorResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'selector ต้องเป็น object' };
  }
  const sel = raw as Record<string, unknown>;
  const kind = sel.kind;

  if (kind === 'ids') {
    if (!Array.isArray(sel.ids)) {
      return { ok: false, error: 'selector.ids ต้องเป็น array' };
    }
    return { ok: true, selector: { kind: 'ids', ids: sel.ids as string[] } };
  }

  if (kind === 'filter') {
    // canonical = { filter: {...} } — ถ้าไม่มี ให้ถอยไปอ่านรูป flat ของ Phase 2
    const nested =
      sel.filter && typeof sel.filter === 'object' && !Array.isArray(sel.filter)
        ? (sel.filter as Record<string, unknown>)
        : sel;

    const roundId = trimmedOrNull(nested.roundId) ?? '';
    if (!roundId) {
      return { ok: false, error: 'selector.filter.roundId จำเป็นสำหรับ kind = filter' };
    }

    const filter: ApplicationsSelectorFilterCriteria = {
      roundId,
      status: trimmedOrNull(nested.status),
      search: trimmedOrNull(nested.search),
    };

    // excludeIds: ไม่ส่ง/ว่าง → ไม่มี key (ไม่ใช่ array ว่างที่ต้อง bind)
    const rawExclude = sel.excludeIds;
    let excludeIds: string[] | undefined;
    if (rawExclude !== undefined && rawExclude !== null) {
      if (!Array.isArray(rawExclude)) {
        return { ok: false, error: 'selector.excludeIds ต้องเป็น array' };
      }
      const cleaned = dedupeIds(rawExclude as string[]);
      if (cleaned.length > MAX_SELECTOR_EXCLUDE_IDS) {
        return {
          ok: false,
          error: `selector.excludeIds ยกเลิกได้สูงสุด ${MAX_SELECTOR_EXCLUDE_IDS} รายการต่อครั้ง`,
        };
      }
      if (cleaned.length > 0) excludeIds = cleaned;
    }

    const selector: ApplicationsSelectorFilter = { kind: 'filter', filter };
    if (excludeIds) selector.excludeIds = excludeIds;
    return { ok: true, selector };
  }

  return { ok: false, error: "selector.kind ต้องเป็น 'ids' หรือ 'filter'" };
}

// ── Resolve: selector → where clause ───────────────────────────────────────

export interface ResolveSelectorOptions {
  /**
   * ตัด DRAFT ออก (export semantics เดิม — buildExportWhere ทำแบบนี้)
   * ใช้เฉพาะ kind 'filter'; kind 'ids' ไม่สนใจ flag นี้
   */
  excludeDraft?: boolean;
}

/** status ที่รู้จัก — ค่าที่ไม่รู้จักไม่ match แถวไหน (เหมือน buildExportWhere) */
const KNOWN_STATUSES = SELECTABLE_APPLICATION_STATUSES as readonly string[];

/** "SUBMITTED,QUALIFIED" → ['SUBMITTED','QUALIFIED'] ; ว่าง → null */
function parseStatusList(status?: string | null): string[] | null {
  if (!status || !status.trim()) return null;
  const list = status
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * แปลง selector เป็น SQL where clause
 *
 * - kind 'ids'    → deletedAt IS NULL AND id IN (...)
 *                   (id ว่าง → 1 = 0 คือไม่มีแถวใดตรง — ไม่ใช่ "ทั้งหมด")
 * - kind 'filter' → buildApplicationsListWhere (roundId + search + deletedAt)
 *                   + status (เดี่ยว หรือ comma-separated)
 *                   + [excludeDraft] status ∈ SELECTABLE_APPLICATION_STATUSES
 *                   + [excludeIds]   id NOT IN (...)
 *
 * ผลลัพธ์ทั้งสองแบบเป็น SQL ที่ใช้ได้กับ SELECT และ UPDATE เหมือนกัน
 */
export function resolveSelectorWhere(
  selector: ApplicationsSelector,
  options: ResolveSelectorOptions = {},
): SQL {
  if (selector.kind === 'filter') {
    const { filter } = selector;

    // ฐาน: roundId + search + deletedAt IS NULL (ตัวเดียวกับหน้ารายชื่อ)
    // status ไม่ส่งเข้าไป เพราะ selector รองรับ comma-separated ซึ่ง eq ไม่ได้
    const conditions: SQL[] = [
      buildApplicationsListWhere({
        roundId: filter.roundId,
        search: filter.search ?? null,
      }),
    ];

    const statusList = parseStatusList(filter.status);
    if (statusList) {
      const known = statusList.filter((s) => KNOWN_STATUSES.includes(s));
      // ค่าที่ไม่รู้จักไม่ match แถวไหน — เหลือแต่ค่าไม่รู้จัก → 0 แถว
      conditions.push(
        known.length === 0
          ? sql`1 = 0`
          : inArray(applications.status, known),
      );
    } else if (options.excludeDraft) {
      conditions.push(inArray(applications.status, [...SELECTABLE_APPLICATION_STATUSES]));
    }

    if (selector.excludeIds && selector.excludeIds.length > 0) {
      conditions.push(notInArray(applications.id, dedupeIds(selector.excludeIds)));
    }

    return and(...conditions)!;
  }

  // kind 'ids'
  const uniqueIds = dedupeIds(selector.ids);
  if (uniqueIds.length === 0) {
    // ไม่มี id = ไม่มีแถวใดตรง (ห้ามตีความเป็น "ทั้งหมด")
    return and(isNull(applications.deletedAt), sql`1 = 0`)!;
  }
  return and(isNull(applications.deletedAt), inArray(applications.id, uniqueIds))!;
}

/** id ซ้ำถูกรวบเป็นรายการเดียว (contract เดิมของ export-selected) */
export function dedupeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

/**
 * จำนวน id สูงสุดที่ยอมให้ resolve เป็นรายการ (ใช้กับ endpoint ที่ต้องมี id จริง)
 * export ใช้ MAX_EXPORT_ROWS ของตัวเอง — ฟังก์ชันนี้ไม่บังคับ cap เอง
 */
export async function resolveSelectorIds(
  db: any,
  selector: ApplicationsSelector,
  options: ResolveSelectorOptions = {},
): Promise<string[]> {
  if (selector.kind === 'ids') {
    return dedupeIds(selector.ids);
  }

  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(resolveSelectorWhere(selector, options))
    .orderBy(applications.id);

  return rows.map((r: { id: string }) => r.id);
}

/** นับจำนวนแถวที่ selector ตรง (ใช้ตรวจ "เลือกไว้ 0 รายการ" ก่อนเขียน DB) */
export async function countSelectorRows(
  db: any,
  selector: ApplicationsSelector,
  options: ResolveSelectorOptions = {},
): Promise<number> {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(resolveSelectorWhere(selector, options));
  return rows.length;
}

// ── Describe (สำหรับ audit) ────────────────────────────────────────────────

/**
 * คำอธิบาย selector แบบไม่มี PII — เก็บลง audit payload
 * kind 'ids' ไม่เก็บ id ทั้งก้อน (เหมือน contract เดิมของ export-selected)
 * kind 'filter' ไม่เก็บ excludeIds ทั้งก้อน — เก็บแค่จำนวน
 */
export function describeSelector(selector: ApplicationsSelector): Record<string, unknown> {
  if (selector.kind === 'filter') {
    return {
      kind: 'filter',
      roundId: selector.filter.roundId,
      status: selector.filter.status ?? null,
      search: selector.filter.search ?? null,
      excludeCount: selector.excludeIds?.length ?? 0,
    };
  }
  return { kind: 'ids', requestedCount: dedupeIds(selector.ids).length };
}
