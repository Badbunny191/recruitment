/**
 * Applications List — query params + pagination state (Phase 1: server-side)
 * ============================================================================
 * แยกตรรกะ "แปลง state → query string" และ "อ่าน response → state" ออกจาก
 * ApplicationsClient เพื่อให้ทดสอบได้โดยไม่ต้อง render React
 *
 * หลักการ:
 *   1. page/pageSize/sort "ต้องส่งขึ้น server ทุกครั้ง" — ห้ามพึ่ง default
 *      ของ backend (pageSize default 50 ไม่ตรงกับ UI default 10; ไม่ส่ง page
 *      = backend คืนทุกแถว)
 *   2. sort id 4 ตัวตรงกับ SortDropdown เดิม — parse/format อยู่ที่เดียว
 *   3. total/totalPages มาจาก response เท่านั้น ไม่คำนวณจาก array ที่โหลดมา
 */

// ── Sort ────────────────────────────────────────────────────────────────────

/** 4 ตัวเลือกเดิมของ SortDropdown — ห้ามเพิ่ม/ลดใน Phase 1 */
export const APPLICATIONS_SORT_OPTIONS = [
  { id: 'submittedAt-desc', field: 'submittedAt', label: 'ล่าสุด', direction: 'desc' as const },
  { id: 'submittedAt-asc', field: 'submittedAt', label: 'เก่าสุด', direction: 'asc' as const },
  { id: 'fullname-asc', field: 'fullname', label: 'ชื่อ A-Z', direction: 'asc' as const },
  { id: 'fullname-desc', field: 'fullname', label: 'ชื่อ Z-A', direction: 'desc' as const },
] as const;

export type ApplicationsSortId = (typeof APPLICATIONS_SORT_OPTIONS)[number]['id'];

export const APPLICATIONS_SORT_DEFAULT: ApplicationsSortId = 'submittedAt-desc';

/** ตัวเลือกจำนวนรายการต่อหน้า — ค่า default คือ 10 (ไม่เขียนลง URL) */
export const APPLICATIONS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const APPLICATIONS_PAGE_SIZE_DEFAULT = 10;

/**
 * แยก sortId (format "<field>-<direction>") เป็น field/direction
 * ค่าที่ไม่รู้จัก → fallback submittedAt-desc (ตรงกับ sortOptions)
 */
export function parseSortId(sortId: string): {
  field: 'submittedAt' | 'fullname';
  direction: 'asc' | 'desc';
} {
  const idx = sortId.lastIndexOf('-');
  if (idx <= 0) return { field: 'submittedAt', direction: 'desc' };
  const field = sortId.slice(0, idx);
  const direction = sortId.slice(idx + 1);
  if (
    (field === 'submittedAt' || field === 'fullname') &&
    (direction === 'asc' || direction === 'desc')
  ) {
    return { field, direction };
  }
  return { field: 'submittedAt', direction: 'desc' };
}

/** sortId ที่รู้จัก → ตัวเอง, ค่าอื่น → default */
export function normalizeSortId(raw: string | null | undefined): ApplicationsSortId {
  const id = (raw ?? '').trim();
  return (APPLICATIONS_SORT_OPTIONS.some((o) => o.id === id)
    ? id
    : APPLICATIONS_SORT_DEFAULT) as ApplicationsSortId;
}

// ── Page / PageSize ─────────────────────────────────────────────────────────

/** page จาก URL — 1-based, ค่าที่ไม่ valid → 1 */
export function parsePage(raw: string | null | undefined): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** pageSize จาก URL — ต้องอยู่ในตัวเลือกที่ UI เสนอ, ค่าอื่น → default 10 */
export function parsePageSize(raw: string | null | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return (APPLICATIONS_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : APPLICATIONS_PAGE_SIZE_DEFAULT;
}

// ── Query string ────────────────────────────────────────────────────────────

export interface ApplicationsListQuery {
  roundId: string;
  search?: string;
  status?: string | null;
  sort: string;
  page: number;
  pageSize: number;
}

/**
 * สร้าง query params ของ GET /admin/applications
 * - roundId บังคับ (ถ้าว่าง caller ต้องไม่ยิง request)
 * - search/status ส่งเมื่อมีค่า
 * - page/pageSize/sort ส่งเสมอ (ดูหลักการข้อ 1)
 */
export function buildApplicationsListParams(q: ApplicationsListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.append('roundId', q.roundId);
  if (q.search && q.search.trim()) params.append('search', q.search.trim());
  if (q.status) params.append('status', q.status);
  params.append('sort', q.sort);
  params.append('page', String(q.page));
  params.append('pageSize', String(q.pageSize));
  return params;
}

// ── Response → state ────────────────────────────────────────────────────────

export interface ApplicationsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * อ่าน pagination จาก response
 * - โหมด paginated: ใช้ค่าจาก server ตรง ๆ (server เป็น source of truth)
 * - ถ้า response ไม่มี pagination (caller เก่า/ไม่ส่ง page) → fallback คำนวณ
 *   จากจำนวนแถวที่ได้ เพื่อไม่ให้ UI พัง
 */
export function readPagination(
  body: any,
  fallbackPage: number,
  fallbackPageSize: number,
): ApplicationsPagination {
  const p = body?.pagination;
  if (
    p &&
    Number.isFinite(p.page) &&
    Number.isFinite(p.pageSize) &&
    Number.isFinite(p.total)
  ) {
    return {
      page: p.page,
      pageSize: p.pageSize,
      total: p.total,
      totalPages: Number.isFinite(p.totalPages)
        ? p.totalPages
        : Math.max(1, Math.ceil(p.total / Math.max(1, p.pageSize))),
    };
  }
  const rows = Array.isArray(body?.data) ? body.data.length : 0;
  return {
    page: fallbackPage,
    pageSize: fallbackPageSize,
    total: rows,
    totalPages: Math.max(1, Math.ceil(rows / Math.max(1, fallbackPageSize))),
  };
}

/**
 * หน้าเป้าหมายเมื่อ page ปัจจุบันเกินช่วง (เช่น filter เปลี่ยนแล้วข้อมูลสั้นลง)
 * คืน null = ไม่ต้องแก้
 */
export function clampPage(currentPage: number, totalPages: number): number | null {
  const max = Math.max(1, totalPages);
  return currentPage > max ? max : null;
}
