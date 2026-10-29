/**
 * Applications Selector — Phase 2 foundation
 * ============================================================================
 * แปลง "สิ่งที่ผู้ใช้เลือก" เป็นเงื่อนไข query ก้อนเดียว ใช้ร่วมกันระหว่าง:
 *   - POST /admin/applications/bulk-status
 *   - POST /admin/applications/export-selected
 *
 * หลักการ:
 *   1. Selector มีความหมายเดียว (single meaning) — ไม่ว่า endpoint ไหนอ่าน
 *      selector เดียวกัน ต้องได้ชุดใบสมัครชุดเดียวกันเป๊ะ
 *   2. kind 'filter' ใช้ buildApplicationsListWhere ตัวเดียวกับ
 *      GET /admin/applications และ GET /admin/applications/ids
 *      → "เลือกทั้งหมดตามตัวกรอง" = ชุดเดียวกับที่ผู้ใช้เห็นในหน้ารายชื่อ
 *        และชุดเดียวกับที่ /ids คืนมา (ทดสอบ equivalence ได้ตรง ๆ)
 *   3. kind 'ids' = รายการที่ระบุชัดเจน — ยังต้องกรอง deletedAt IS NULL
 *      เหมือนเดิม (behavior เดิมของ bulk-status / export-selected)
 *   4. backward compatible: payload เดิม { ids } / { applicationIds }
 *      ยังทำงานเหมือนเดิมทุกประการ — normalizeSelectorInput แปลงให้เป็น
 *      kind 'ids' โดยไม่เปลี่ยน semantics
 *
 * ⚠️ Selector ไม่มี sort — selector นิยาม "ชุด" ไม่ใช่ "ลำดับ"
 *    ลำดับของผลลัพธ์เป็นเรื่องของแต่ละ endpoint (bulk ไม่มีลำดับ,
 *    export เรียง submittedAt DESC, id DESC ตาม contract เดิม)
 */

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
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

export interface ApplicationsSelectorFilter {
  kind: 'filter';
  /** บังคับ — ตัวกรองต้องผูกกับรอบเดียวเสมอ (กันการเลือกข้ามรอบโดยไม่ตั้งใจ) */
  roundId: string;
  status?: string | null;
  search?: string | null;
}

export type ApplicationsSelector = ApplicationsSelectorIds | ApplicationsSelectorFilter;

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
 *   { selector: { kind: 'filter', roundId, status?, search? } }
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
    const roundId = typeof sel.roundId === 'string' ? sel.roundId.trim() : '';
    if (!roundId) {
      return { ok: false, error: 'selector.roundId จำเป็นสำหรับ kind = filter' };
    }
    return {
      ok: true,
      selector: {
        kind: 'filter',
        roundId,
        status: typeof sel.status === 'string' && sel.status.trim() ? sel.status.trim() : null,
        search: typeof sel.search === 'string' && sel.search.trim() ? sel.search.trim() : null,
      },
    };
  }

  return { ok: false, error: "selector.kind ต้องเป็น 'ids' หรือ 'filter'" };
}

// ── Resolve: selector → where clause ───────────────────────────────────────

/**
 * แปลง selector เป็น SQL where clause
 *
 * - kind 'ids'    → deletedAt IS NULL AND id IN (...)
 *                   (id ว่าง → 1 = 0 คือไม่มีแถวใดตรง — ไม่ใช่ "ทั้งหมด")
 * - kind 'filter' → buildApplicationsListWhere ตัวเดียวกับหน้ารายชื่อ
 *                   (roundId + status + search + deletedAt IS NULL)
 *
 * ผลลัพธ์ทั้งสองแบบเป็น SQL ที่ใช้ได้กับ SELECT และ UPDATE เหมือนกัน
 */
export function resolveSelectorWhere(selector: ApplicationsSelector): SQL {
  if (selector.kind === 'filter') {
    return buildApplicationsListWhere({
      roundId: selector.roundId,
      status: selector.status,
      search: selector.search,
    });
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
): Promise<string[]> {
  if (selector.kind === 'ids') {
    return dedupeIds(selector.ids);
  }

  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(resolveSelectorWhere(selector))
    .orderBy(applications.id);

  return rows.map((r: { id: string }) => r.id);
}

/** นับจำนวนแถวที่ selector ตรง (ใช้ตรวจ "เลือกไว้ 0 รายการ" ก่อนเขียน DB) */
export async function countSelectorRows(
  db: any,
  selector: ApplicationsSelector,
): Promise<number> {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(resolveSelectorWhere(selector));
  return rows.length;
}

// ── Describe (สำหรับ audit) ────────────────────────────────────────────────

/**
 * คำอธิบาย selector แบบไม่มี PII — เก็บลง audit payload
 * kind 'ids' ไม่เก็บ id ทั้งก้อน (เหมือน contract เดิมของ export-selected)
 */
export function describeSelector(selector: ApplicationsSelector): Record<string, unknown> {
  if (selector.kind === 'filter') {
    return {
      kind: 'filter',
      roundId: selector.roundId,
      status: selector.status ?? null,
      search: selector.search ?? null,
    };
  }
  return { kind: 'ids', requestedCount: dedupeIds(selector.ids).length };
}
