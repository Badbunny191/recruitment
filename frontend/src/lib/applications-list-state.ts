/**
 * Applications List — list state machine (Phase 3: server-side pagination)
 * ============================================================================
 * แยก "กฎการเปลี่ยน state ของหน้ารายชื่อ" ออกจาก ApplicationsClient เพื่อให้
 * ทดสอบได้โดยไม่ต้อง render React (โปรเจกต์นี้ไม่มี jsdom/testing-library)
 *
 * กฎที่ย้ายมาอยู่ที่นี่ (ตรงกับ behavior เดิมของ component เป๊ะ):
 *   1. round/search/status/sort เปลี่ยน → page = 1
 *   2. pageSize เปลี่ยน → page = 1
 *   3. page เปลี่ยน → ไม่แตะ pageSize และ "ไม่ล้าง selection"
 *   4. selection ถูกล้างเฉพาะเมื่อ round/search/status เปลี่ยน
 *      (sort/page/pageSize ไม่ล้าง — ผู้ใช้ติ๊กข้ามหน้า/ข้ามการเรียงได้)
 *   5. request key = { roundId, q, status, sort, page, pageSize }
 *      ใช้ตัดสินว่า response ที่กลับมาเป็นของ request ล่าสุดหรือเป็นของเก่า
 *
 * หลักการ: ทุกฟังก์ชันเป็น pure — ไม่มี fetch, ไม่มี React, ไม่มี side effect
 */

import {
  APPLICATIONS_PAGE_SIZE_DEFAULT,
  APPLICATIONS_SORT_DEFAULT,
  clampPage,
  normalizeSortId,
  parsePage,
  parsePageSize,
  type ApplicationsSortId,
} from './applications-list-params';
import {
  parseStatusFilter,
  statusFilterToParam,
  type StatusFilterValue,
} from './applications-status-filter';

// ── State ───────────────────────────────────────────────────────────────────

/** state ทั้งหมดที่กำหนดว่า request ไหนจะถูกยิง และหน้าไหนถูกแสดง */
export interface ApplicationsListState {
  roundId: string;
  search: string;
  status: StatusFilterValue;
  sort: ApplicationsSortId;
  page: number;
  pageSize: number;
}

/** ค่าที่อนุญาตให้แก้ทีละครั้ง (undefined = ไม่แก้) */
export interface ApplicationsListStatePatch {
  roundId?: string;
  search?: string;
  status?: StatusFilterValue;
  sort?: ApplicationsSortId;
  page?: number;
  pageSize?: number;
}

// ── URL hydrate ─────────────────────────────────────────────────────────────

/**
 * อ่าน state ทั้งหมดจาก URL
 * - roundId: ?round=
 * - search:  ?q=
 * - status:  ?status= (legacy ?view= ยังอ่านได้ ผ่าน parseStatusFilter)
 * - sort:    ?sort= (ไม่รู้จัก → default)
 * - page:    ?page= (ไม่ valid → 1)
 * - pageSize:?pageSize= (นอกชุดที่ UI เสนอ → 10)
 */
export function hydrateListState(params: URLSearchParams): ApplicationsListState {
  return {
    roundId: params.get('round') || '',
    search: params.get('q') || '',
    status: parseStatusFilter(params.get('status'), params.get('view')),
    sort: normalizeSortId(params.get('sort')),
    page: parsePage(params.get('page')),
    pageSize: parsePageSize(params.get('pageSize')),
  };
}

// ── Page reset rules ────────────────────────────────────────────────────────

/**
 * เปลี่ยนอะไรแล้วต้องกลับหน้า 1
 * round / search / status / sort — ตามสเปก Phase 3
 */
export function isPageResettingChange(
  prev: ApplicationsListState,
  next: ApplicationsListState,
): boolean {
  return (
    prev.roundId !== next.roundId ||
    prev.search !== next.search ||
    prev.status !== next.status ||
    prev.sort !== next.sort
  );
}

/**
 * เปลี่ยนอะไรแล้วต้องล้าง selection
 * เฉพาะ round / search / status — sort/page/pageSize ต้องคง selection ไว้
 */
export function shouldClearSelection(
  prev: ApplicationsListState,
  next: ApplicationsListState,
): boolean {
  return (
    prev.roundId !== next.roundId ||
    prev.search !== next.search ||
    prev.status !== next.status
  );
}

/** roundId '' → ค่าแรก (init หลัง restore จาก URL) — ห้ามถือเป็นการเปลี่ยนรอบ */
export function isInitialRoundHydration(
  prev: ApplicationsListState,
  next: ApplicationsListState,
): boolean {
  return prev.roundId === '' && next.roundId !== '';
}

/**
 * คำนวณ state ถัดไปจาก patch + บังคับกฎ page reset
 *
 * options.preservePage = true → ไม่ reset page (ใช้ตอน init หลัง hydrate จาก URL
 * ซึ่ง page เพิ่งถูก restore มา และไม่ใช่การเปลี่ยนตัวกรองของผู้ใช้)
 */
export function applyListStatePatch(
  prev: ApplicationsListState,
  patch: ApplicationsListStatePatch,
  options: { preservePage?: boolean } = {},
): ApplicationsListState {
  const next: ApplicationsListState = { ...prev, ...patch };
  if (options.preservePage) return next;

  const pageSizeChanged =
    patch.pageSize !== undefined && patch.pageSize !== prev.pageSize;

  // pageSize เปลี่ยน → กลับหน้า 1 เสมอ (พฤติกรรมเดิม)
  // ตัวกรอง/รอบ/การเรียงเปลี่ยน → กลับหน้า 1 เสมอ (ทับ patch.page ถ้าส่งมาด้วยกัน)
  if (pageSizeChanged || isPageResettingChange(prev, next)) {
    next.page = 1;
  }

  return next;
}

// ── URL patch ───────────────────────────────────────────────────────────────

/**
 * แปลง state → URL patch (ค่า default ไม่เขียนลง URL)
 * ใช้คู่กับ hydrateListState — เขียนแล้วอ่านกลับต้องได้ state เดิม
 */
export function buildListStateUrlPatch(
  state: ApplicationsListState,
): Record<string, string | null> {
  return {
    round: state.roundId || null,
    q: state.search.trim() ? state.search : null,
    status: statusFilterToParam(state.status),
    sort: state.sort === APPLICATIONS_SORT_DEFAULT ? null : state.sort,
    page: state.page <= 1 ? null : String(state.page),
    pageSize:
      state.pageSize === APPLICATIONS_PAGE_SIZE_DEFAULT ? null : String(state.pageSize),
  };
}

// ── Request key + stale guard ───────────────────────────────────────────────

/**
 * คีย์ระบุ request — ใช้เทียบว่า response ที่กลับมาเป็นของ state ปัจจุบันหรือไม่
 * ครอบทั้ง 6 มิติ: roundId, q, status, sort, page, pageSize
 */
export function buildRequestKey(state: ApplicationsListState): string {
  return [
    state.roundId,
    state.search.trim(),
    state.status,
    state.sort,
    state.page,
    state.pageSize,
  ].join('|');
}

export interface RequestGuard {
  /** เริ่ม request ใหม่ — คืน key และทำให้ key เก่าทั้งหมดกลายเป็น stale */
  begin(state: ApplicationsListState): string;
  /** response ของ key นี้ยังเป็นของล่าสุดอยู่ไหม */
  isCurrent(key: string): boolean;
  /** key ล่าสุดที่เริ่มไป (null = ยังไม่เคยเริ่ม) */
  current(): string | null;
}

/**
 * ตัวกัน response เก่าทับ response ใหม่
 * ทำงานคู่กับ AbortController ใน component: guard ตัดสินว่า "จะเขียน state ไหม"
 * ส่วน abort ตัดสินว่า "จะยกเลิก network ไหม"
 */
export function createRequestGuard(): RequestGuard {
  let latest: string | null = null;
  return {
    begin(state) {
      latest = buildRequestKey(state);
      return latest;
    },
    isCurrent(key) {
      return latest !== null && key === latest;
    },
    current() {
      return latest;
    },
  };
}

// ── Response → page ─────────────────────────────────────────────────────────

/**
 * หน้าเป้าหมายหลังได้ totalPages จาก server
 * คืน null = หน้าเดิมยังอยู่ในช่วง ไม่ต้องแก้
 * (เช่น page=999 แต่ server บอกมี 3 หน้า → คืน 3)
 */
export function resolvePageAfterResponse(
  page: number,
  totalPages: number,
): number | null {
  return clampPage(page, totalPages);
}
