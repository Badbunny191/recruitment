/**
 * Status filter ของหน้า Applications (admin)
 * ============================================================================
 * URL param: ?status=pending|approved|incomplete|cancelled|archived
 * ค่า default "ทั้งหมด" ไม่เขียนลง URL (เหมือน page/pageSize ที่ default ไม่ลง URL)
 *
 * Mapping param ( lowercase ตาม spec ) ↔ enum ในระบบ:
 *   pending   → SUBMITTED  (รอการตรวจสอบ)
 *   approved  → QUALIFIED  (ผ่านการตรวจสอบ)
 *   incomplete→ REJECTED   (ข้อมูลไม่ครบ)
 *   cancelled → CANCELED   (ยกเลิก)
 *   archived  → ARCHIVED   (เก็บเข้าคลัง)
 *
 * ยังอ่าน legacy ?view= (filter 3 ปุ่มเดิม: all|active|archived) เป็น fallback:
 *   archived → ARCHIVED, all → ทั้งหมด,
 *   active ("กำลังดำเนินการ" = ไม่รวม ARCHIVED) → ทั้งหมด เพราะชุดใหม่ไม่มีค่านี้
 */

export type ApplicationStatus = 'SUBMITTED' | 'QUALIFIED' | 'REJECTED' | 'CANCELED' | 'ARCHIVED';

export type StatusFilterValue = 'ALL' | ApplicationStatus;

export interface StatusFilterOption {
  value: StatusFilterValue;
  /** ค่า URL param (null = ค่า default ไม่เขียนลง URL) */
  param: string | null;
  label: string;
}

export const STATUS_FILTER_OPTIONS: readonly StatusFilterOption[] = [
  { value: 'ALL', param: null, label: 'ทั้งหมด' },
  { value: 'SUBMITTED', param: 'pending', label: 'รอการตรวจสอบ' },
  { value: 'QUALIFIED', param: 'approved', label: 'ผ่านการตรวจสอบ' },
  { value: 'REJECTED', param: 'incomplete', label: 'ข้อมูลไม่ครบ' },
  { value: 'CANCELED', param: 'cancelled', label: 'ยกเลิก' },
  { value: 'ARCHIVED', param: 'archived', label: 'เก็บเข้าคลัง' },
];

const PARAM_TO_VALUE: Record<string, StatusFilterValue> = {
  pending: 'SUBMITTED',
  approved: 'QUALIFIED',
  incomplete: 'REJECTED',
  cancelled: 'CANCELED',
  archived: 'ARCHIVED',
};

/**
 * อ่านค่า filter จาก URL params
 * @param urlStatus ค่า ?status= ปัจจุบัน (null ได้)
 * @param legacyUrlView ค่า ?view= เดิม ใช้เมื่อไม่มี ?status= (null ได้)
 * @returns ค่า valid เสมอ — ค่าที่ไม่รู้จัก/ว่าง → ALL (ทั้งหมด)
 */
export function parseStatusFilter(
  urlStatus: string | null,
  legacyUrlView: string | null = null,
): StatusFilterValue {
  if (urlStatus) {
    if (urlStatus === 'all') return 'ALL';
    if (PARAM_TO_VALUE[urlStatus]) return PARAM_TO_VALUE[urlStatus];
  }
  if (legacyUrlView === 'archived') return 'ARCHIVED';
  if (legacyUrlView === 'all') return 'ALL';
  return 'ALL';
}

/** ค่า filter → ค่า URL param (ALL = null คือไม่เขียนลง URL) */
export function statusFilterToParam(value: StatusFilterValue): string | null {
  return STATUS_FILTER_OPTIONS.find((o) => o.value === value)?.param ?? null;
}

/** กรองรายการตามสถานะ (ALL = คืนทั้งหมด) — ใช้กับ list จาก API ก่อนเข้า sort/paginate */
export function filterByStatus<T extends { status: string }>(
  items: readonly T[],
  filter: StatusFilterValue,
): T[] {
  if (filter === 'ALL') return [...items];
  return items.filter((item) => item.status === filter);
}

/** ค่า filter → status param สำหรับ Export Excel (backend รับ enum ตรง ๆ / comma-separated) */
export function statusFilterToExportStatusParam(value: StatusFilterValue): string | null {
  return value === 'ALL' ? null : value;
}
