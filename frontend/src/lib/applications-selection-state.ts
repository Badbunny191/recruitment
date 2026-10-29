/**
 * Applications Selection — state model (Phase 4: ApplicationsSelector Foundation)
 * ============================================================================
 * เปลี่ยน "selection" จาก Set<string> ล้วน ๆ เป็น state model ที่มี 3 สถานะ
 * และรองรับ excludeIds (ติ๊กถูกทั้งหมดแล้วเอารายการบางใบออก)
 *
 * ทำไมต้องมี excludeIds
 *   หลัง Phase 3 หน้ารายชื่อเห็นแค่แถวของหน้าปัจจุบัน (server-side pagination)
 *   "เลือกทั้งหมดตามตัวกรอง" จึงเป็นชุดที่ client ไม่มี id ครบในมือ → เก็บเป็น
 *   "ทั้งหมด ยกเว้นบางใบ" แทนการไล่เก็บ id ทุกใบ (ซึ่งจะระเบิดเมื่อรอบมีหลักหมื่น)
 *
 * 3 สถานะ (ตรงกับ SelectionState ของ Phase 2 / backend)
 *   idle         = ไม่ได้เลือกอะไร            → ไม่มี selector
 *   explicit     = เลือกเป็นรายใบ (ids)        → { kind: 'ids', ids }
 *   all-filtered = ทั้งหมดตามตัวกรอง ยกเว้น excludeIds
 *                                            → { kind: 'filter', ... } เมื่อไม่มี excludeIds
 *
 * หลักการ
 *   1. ทุกฟังก์ชันเป็น pure — ไม่มี fetch, ไม่มี React, ไม่มี side effect
 *   2. state ที่ไม่สอดคล้องกัน (เช่น idle แต่มี ids) ถูกซ่อมให้ถูกเสมอ
 *      ผ่าน normalizeSelection() — ไม่ปล่อยให้ invariant พังเงียบ ๆ
 *   3. จำนวนที่เลือกของ all-filtered ต้องมาจาก "ยอดรวมจริงจาก server"
 *      (pagination.total) ไม่ใช่จำนวนแถวที่โหลดมา — client ไม่มีทางรู้เอง
 *   4. selector ที่ยังส่งขึ้น server ไม่ได้ (all-filtered + excludeIds) → null
 *      พร้อมเหตุผล (fail closed) ไม่ใช่ส่งชุดที่ผิด
 *
 * อ้างอิง: docs/PHASE_3_APPLICATIONS_PAGINATION.md, docs/PHASE_2_APPLICATIONS_SELECTOR.md
 */

import {
  buildApplicationsSelector,
  type ApplicationsSelector,
  type SelectionFilterContext,
  type SelectionState,
} from './applications-selection';

export type { ApplicationsSelector, SelectionFilterContext, SelectionState };

// ── Model ───────────────────────────────────────────────────────────────────

/**
 * สถานะการเลือกทั้งหมดของหน้ารายชื่อ
 *
 * invariant (บังคับโดย normalizeSelection):
 *   idle         → ids = [], excludeIds = []
 *   explicit     → ids ไม่ว่าง, excludeIds = []
 *   all-filtered → ids = [], excludeIds = id ที่ถูก "เอาออก" จากทั้งชุด
 */
export interface ApplicationsSelection {
  state: SelectionState;
  /** ใช้เมื่อ state = 'explicit' — id ที่ผู้ใช้ติ๊กเลือกไว้ */
  ids: readonly string[];
  /** ใช้เมื่อ state = 'all-filtered' — id ที่ผู้ใช้เอาออกจากการเลือกทั้งหมด */
  excludeIds: readonly string[];
}

/** ค่าเริ่มต้น — ไม่ได้เลือกอะไร */
export function createSelection(): ApplicationsSelection {
  return { state: 'idle', ids: [], excludeIds: [] };
}

/** id ซ้ำ/ค่าว่างถูกตัดออก — ลำดับแรกที่พบถูกคงไว้ */
function dedupeNonEmpty(ids: readonly string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

/**
 * ซ่อม state ให้ตรง invariant
 * - state ที่ไม่รู้จัก → idle
 * - idle → ทิ้ง ids/excludeIds ทั้งหมด
 * - explicit ที่ไม่มี id เหลือ → idle (ไม่ใช่ explicit ว่าง)
 * - all-filtered → ทิ้ง ids (ไม่ได้ใช้) และ dedupe excludeIds
 */
export function normalizeSelection(
  selection: Partial<ApplicationsSelection> | null | undefined,
): ApplicationsSelection {
  const state = selection?.state;
  if (state === 'explicit') {
    const ids = dedupeNonEmpty(selection?.ids);
    return ids.length > 0
      ? { state: 'explicit', ids, excludeIds: [] }
      : createSelection();
  }
  if (state === 'all-filtered') {
    return {
      state: 'all-filtered',
      ids: [],
      excludeIds: dedupeNonEmpty(selection?.excludeIds),
    };
  }
  return createSelection();
}

// ── Count ───────────────────────────────────────────────────────────────────

/**
 * จำนวนรายการที่เลือกจริง
 *
 * @param filteredTotal ยอดรวมแถวที่ตรงตัวกรองจาก server (pagination.total)
 *                      จำเป็นสำหรับ all-filtered — client ไม่มี id ครบในมือ
 *
 * idle → 0
 * explicit → ids.length
 * all-filtered → filteredTotal - excludeIds.length (ไม่ติดลบ)
 */
export function resolveSelectedCount(
  selection: ApplicationsSelection,
  filteredTotal = 0,
): number {
  const sel = normalizeSelection(selection);
  if (sel.state === 'idle') return 0;
  if (sel.state === 'explicit') return sel.ids.length;

  const total = Number.isFinite(filteredTotal) ? Math.max(0, filteredTotal) : 0;
  // excludeIds ที่ไม่ตรงกับชุดจริงจะทำให้ติดลบได้ → clamp ไว้
  return Math.max(0, total - sel.excludeIds.length);
}

// ── Row state ───────────────────────────────────────────────────────────────

/** แถวนี้ถูกเลือกอยู่ไหม (ใช้กับ checkbox ของแต่ละแถว) */
export function isRowSelected(selection: ApplicationsSelection, id: string): boolean {
  const sel = normalizeSelection(selection);
  if (!id) return false;
  if (sel.state === 'explicit') return sel.ids.includes(id);
  if (sel.state === 'all-filtered') return !sel.excludeIds.includes(id);
  return false;
}

// ── Header state ────────────────────────────────────────────────────────────

/**
 * Header checkbox ต้อง checked ไหม — หมายถึง "ทุกแถวที่ตรงตัวกรองถูกเลือกครบ"
 *
 * idle         → false
 * all-filtered → checked เมื่อไม่มี excludeIds เลย (และมีแถวให้เลือก)
 * explicit     → checked เมื่อจำนวนที่เลือกครบเท่ายอดรวม และแถวบนหน้านี้
 *                ถูกเลือกครบ (กันกรณี ids ค้างจากชุดอื่น)
 *
 * filteredTotal = 0 → false เสมอ (ไม่มีอะไรให้เลือก)
 */
export function isHeaderChecked(
  selection: ApplicationsSelection,
  pageIds: readonly string[] = [],
  filteredTotal = 0,
): boolean {
  const total = Number.isFinite(filteredTotal) ? Math.max(0, filteredTotal) : 0;
  if (total === 0) return false;

  const sel = normalizeSelection(selection);
  if (sel.state === 'idle') return false;
  if (sel.state === 'all-filtered') return sel.excludeIds.length === 0;

  // explicit: ครบทั้งชุดหรือยัง
  if (sel.ids.length < total) return false;
  return pageIds.every((id) => sel.ids.includes(id));
}

/**
 * Header checkbox ต้อง indeterminate ไหม — "เลือกบางส่วน แต่ยังไม่ครบ"
 * checked ชนะ indeterminate เสมอ (ทั้งคู่ true พร้อมกันไม่ได้)
 */
export function isHeaderIndeterminate(
  selection: ApplicationsSelection,
  pageIds: readonly string[] = [],
  filteredTotal = 0,
): boolean {
  const total = Number.isFinite(filteredTotal) ? Math.max(0, filteredTotal) : 0;
  if (total === 0) return false;

  const sel = normalizeSelection(selection);
  if (sel.state === 'idle') return false;
  if (isHeaderChecked(sel, pageIds, total)) return false;

  if (sel.state === 'all-filtered') {
    // เอาออกบางใบ แต่ยังเหลืออย่างน้อย 1 ใบ
    return sel.excludeIds.length > 0 && resolveSelectedCount(sel, total) > 0;
  }
  return sel.ids.length > 0;
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * ติ๊ก/ยกเลิกติ๊กแถวเดียว
 *
 * idle         → explicit [id]
 * explicit     → เพิ่ม/ลบ id (เหลือ 0 → idle)
 * all-filtered → สลับ id ใน excludeIds (เอาออกครบทุกใบ → idle)
 *
 * @param filteredTotal ใช้ตัดสินว่า all-filtered ถูกเอาออกจนหมดหรือยัง
 */
export function toggleRow(
  selection: ApplicationsSelection,
  id: string,
  filteredTotal = 0,
): ApplicationsSelection {
  if (!id) return normalizeSelection(selection);
  const sel = normalizeSelection(selection);

  if (sel.state === 'all-filtered') {
    const excluded = sel.excludeIds.includes(id);
    const excludeIds = excluded
      ? sel.excludeIds.filter((x) => x !== id)
      : [...sel.excludeIds, id];

    const total = Number.isFinite(filteredTotal) ? Math.max(0, filteredTotal) : 0;
    // เอาออกจนไม่เหลืออะไรเลย → กลับเป็น idle (ไม่ใช่ all-filtered ที่ว่าง)
    if (total > 0 && excludeIds.length >= total) return createSelection();
    return { state: 'all-filtered', ids: [], excludeIds };
  }

  const has = sel.ids.includes(id);
  const ids = has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
  return ids.length > 0
    ? { state: 'explicit', ids, excludeIds: [] }
    : createSelection();
}

/** เลือกทั้งหมดตามตัวกรอง (ล้าง excludeIds เดิม) */
export function selectAllFiltered(
  filteredTotal = 0,
): ApplicationsSelection {
  const total = Number.isFinite(filteredTotal) ? Math.max(0, filteredTotal) : 0;
  if (total === 0) return createSelection();
  return { state: 'all-filtered', ids: [], excludeIds: [] };
}

/** ยกเลิกการเลือกทั้งหมด */
export function clearSelection(): ApplicationsSelection {
  return createSelection();
}

/**
 * กด Header checkbox
 * - checked อยู่แล้ว → ยกเลิกทั้งหมด (idle)
 * - ยังไม่ครบ        → เลือกทั้งหมดตามตัวกรอง (all-filtered, ไม่มี excludeIds)
 */
export function toggleHeader(
  selection: ApplicationsSelection,
  pageIds: readonly string[] = [],
  filteredTotal = 0,
): ApplicationsSelection {
  if (isHeaderChecked(selection, pageIds, filteredTotal)) return clearSelection();
  return selectAllFiltered(filteredTotal);
}

// ── Selector (ส่งขึ้น server) ───────────────────────────────────────────────

/**
 * เหตุผลที่ selection นี้ยังแปลงเป็น selector ไม่ได้ (null = แปลงได้)
 *
 * ข้อจำกัดที่รู้อยู่: backend ยังไม่มีแนวคิด excludeIds ใน selector
 * (Phase 2 รองรับแค่ kind 'ids' และ kind 'filter') → all-filtered ที่มี
 * excludeIds ต้องรอ Phase ถัดไป ห้ามเดาส่งชุดที่ผิด
 */
export function describeSelectionBlocker(
  selection: ApplicationsSelection,
  filter: SelectionFilterContext,
): string | null {
  const sel = normalizeSelection(selection);
  if (sel.state === 'idle') return 'ยังไม่ได้เลือกรายการ';
  if (sel.state === 'all-filtered') {
    if (!(filter.roundId ?? '').trim()) return 'ยังไม่ได้เลือกรอบรับสมัคร';
    if (sel.excludeIds.length > 0) {
      return 'ลบรายการออกจาก "เลือกทั้งหมด" แล้ว — backend ยังไม่รองรับ excludeIds';
    }
  }
  return null;
}

/**
 * แปลง selection → ApplicationsSelector ที่ส่งขึ้น server ได้
 * คืน null เมื่อยังไม่พร้อม (idle / all-filtered ที่ไม่มี roundId /
 * all-filtered ที่มี excludeIds) — caller ต้อง disable ปุ่ม
 *
 * ใช้ buildApplicationsSelector ของ Phase 2 เป็นตัวสร้างจริง เพื่อไม่ให้
 * รูป payload สองที่เพี้ยนจากกัน
 */
export function buildSelectionSelector(
  selection: ApplicationsSelection,
  filter: SelectionFilterContext,
): ApplicationsSelector | null {
  if (describeSelectionBlocker(selection, filter) !== null) return null;
  const sel = normalizeSelection(selection);
  return buildApplicationsSelector(sel.state, new Set(sel.ids), filter);
}

/** ปุ่มที่เกี่ยวกับ selection ควรกดได้ไหม */
export function canSubmitSelection(
  selection: ApplicationsSelection,
  filter: SelectionFilterContext,
): boolean {
  return buildSelectionSelector(selection, filter) !== null;
}

// ── Display ─────────────────────────────────────────────────────────────────

/**
 * ข้อความสรุปจำนวนที่เลือก — ใช้บนปุ่ม/แถบ bulk action
 * all-filtered ใช้ยอดรวมจาก server และบอกจำนวนที่ถูกเอาออกให้เห็นชัด
 */
export function describeSelectionCount(
  selection: ApplicationsSelection,
  filteredTotal = 0,
): string {
  const sel = normalizeSelection(selection);
  if (sel.state === 'idle') return 'ยังไม่ได้เลือก';

  const count = resolveSelectedCount(sel, filteredTotal);
  if (sel.state === 'all-filtered') {
    if (sel.excludeIds.length === 0) return `เลือกทั้งหมด ${count} รายการตามตัวกรอง`;
    return `เลือกทั้งหมด ${count} รายการตามตัวกรอง (ยกเว้น ${sel.excludeIds.length})`;
  }
  return `เลือกไว้ ${count} รายการ`;
}
