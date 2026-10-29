/**
 * Applications Selection — Phase 2 foundation (ฝั่ง client)
 * ============================================================================
 * แปลง "สถานะการเลือกของผู้ใช้" เป็น selector ที่ส่งขึ้น server
 * โดยไม่ต้องส่ง id ทั้งชุด (ซึ่งจะเกิน limit เมื่อเลือกทั้งรอบ)
 *
 * 3 สถานะ (ตรงกับ SelectionState ฝั่ง backend):
 *   idle         = ไม่ได้เลือกอะไร        → ไม่มี selector (ปุ่ม disabled)
 *   explicit     = เลือกเป็นรายใบ          → { kind: 'ids', ids }
 *   all-filtered = เลือกทั้งหมดตามตัวกรอง  → { kind: 'filter', roundId, status?, search? }
 *
 * หลักการ:
 *   1. selector ต้องอธิบาย "ชุดเดียวกับที่ผู้ใช้เห็น" — filter ที่ส่งไปคือ
 *      filter เดียวกับที่ใช้ยิง GET /admin/applications (roundId/status/search)
 *      ไม่ใช่ page/pageSize (selector ไม่มีแนวคิดเรื่องหน้า)
 *   2. sort ไม่ถูกส่ง — selector นิยามชุด ไม่ใช่ลำดับ
 *   3. ถ้าผู้ใช้เลือก explicit ไว้แล้วกด "เลือกทั้งหมด" → all-filtered ชนะ
 *      (ชุดที่กว้างกว่า) และถ้าเลือกใบใดใบหนึ่งหลังจากนั้น → กลับเป็น explicit
 */

import type { StatusFilterValue } from './applications-status-filter';
import { statusFilterToExportStatusParam } from './applications-status-filter';

// ── Types ──────────────────────────────────────────────────────────────────

export type SelectionState = 'idle' | 'explicit' | 'all-filtered';

export interface ApplicationsSelectorIds {
  kind: 'ids';
  ids: string[];
}

export interface ApplicationsSelectorFilter {
  kind: 'filter';
  roundId: string;
  status?: string | null;
  search?: string | null;
}

export type ApplicationsSelector = ApplicationsSelectorIds | ApplicationsSelectorFilter;

/** ตัวกรองปัจจุบันของหน้ารายชื่อ (เฉพาะส่วนที่ selector ต้องใช้) */
export interface SelectionFilterContext {
  roundId: string;
  statusFilter: StatusFilterValue;
  search: string;
}

// ── State helpers ──────────────────────────────────────────────────────────

/**
 * หา SelectionState จากข้อมูลที่ component มีอยู่
 * - allFiltered = true → 'all-filtered' (ผู้ใช้กดเลือกทั้งหมดตามตัวกรอง)
 * - มี id อย่างน้อย 1 → 'explicit'
 * - ไม่มีอะไรเลย → 'idle'
 */
export function resolveSelectionState(
  selectedIds: ReadonlySet<string>,
  allFiltered: boolean,
): SelectionState {
  if (allFiltered) return 'all-filtered';
  return selectedIds.size > 0 ? 'explicit' : 'idle';
}

/**
 * สร้าง selector จาก state + ตัวกรองปัจจุบัน
 * คืน null เมื่อ state = 'idle' (ไม่มีอะไรจะทำ — caller ต้อง disable ปุ่ม)
 *
 * all-filtered: ต้องมี roundId เสมอ ถ้าไม่มี → คืน null (ยิง request ไม่ได้)
 */
export function buildApplicationsSelector(
  state: SelectionState,
  selectedIds: ReadonlySet<string>,
  filter: SelectionFilterContext,
): ApplicationsSelector | null {
  if (state === 'idle') return null;

  if (state === 'all-filtered') {
    const roundId = (filter.roundId ?? '').trim();
    if (!roundId) return null;
    return {
      kind: 'filter',
      roundId,
      status: statusFilterToExportStatusParam(filter.statusFilter),
      search: filter.search.trim() ? filter.search.trim() : null,
    };
  }

  const ids = Array.from(selectedIds);
  if (ids.length === 0) return null;
  return { kind: 'ids', ids };
}

// ── Payload builders ───────────────────────────────────────────────────────

/**
 * Body ของ POST /admin/applications/bulk-status
 *
 * - explicit     → { selector: { kind: 'ids', ids }, status, reason? }
 * - all-filtered → { selector: { kind: 'filter', ... }, status, reason? }
 *
 * คืน null เมื่อไม่มีอะไรจะอัปเดต (state idle)
 */
export function buildBulkStatusPayload(
  state: SelectionState,
  selectedIds: ReadonlySet<string>,
  filter: SelectionFilterContext,
  status: string,
  reason?: string,
): Record<string, unknown> | null {
  const selector = buildApplicationsSelector(state, selectedIds, filter);
  if (!selector) return null;

  const payload: Record<string, unknown> = { selector, status };
  if (reason && reason.trim()) payload.reason = reason.trim();
  return payload;
}

/**
 * Body ของ POST /admin/applications/export-selected
 * roundId ส่งเสมอ (ใช้สร้างชื่อไฟล์) — selector.filter.roundId ต้องตรงกัน
 */
export function buildExportSelectedPayload(
  state: SelectionState,
  selectedIds: ReadonlySet<string>,
  filter: SelectionFilterContext,
): Record<string, unknown> | null {
  const selector = buildApplicationsSelector(state, selectedIds, filter);
  if (!selector) return null;

  const roundId = (filter.roundId ?? '').trim();
  if (!roundId) return null;

  return { roundId, selector };
}

// ── Display helpers ────────────────────────────────────────────────────────

/**
 * ข้อความสรุปจำนวนที่เลือก — ใช้บนปุ่ม/ยืนยัน
 * all-filtered ไม่รู้จำนวนจริงจนกว่า server จะตอบ → ใช้ข้อความเชิงคุณภาพ
 */
export function describeSelection(
  state: SelectionState,
  selectedIds: ReadonlySet<string>,
): string {
  if (state === 'all-filtered') return 'ทุกใบที่ตรงกับตัวกรอง';
  if (state === 'idle') return 'ยังไม่ได้เลือก';
  return `เลือกไว้ ${selectedIds.size} รายการ`;
}

/**
 * ปุ่มที่ต้อง disable — all-filtered ต้องมี roundId, explicit ต้องมี id
 */
export function canSubmitSelection(
  state: SelectionState,
  selectedIds: ReadonlySet<string>,
  filter: SelectionFilterContext,
): boolean {
  return buildApplicationsSelector(state, selectedIds, filter) !== null;
}
