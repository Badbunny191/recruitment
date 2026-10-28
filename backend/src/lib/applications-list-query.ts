/**
 * Shared query helpers — รายชื่อใบสมัคร (Admin list endpoints)
 * ============================================================================
 * ใช้ร่วมกันระหว่าง:
 *   - GET /admin/applications       (รายชื่อ + optional pagination)
 *   - GET /admin/applications/ids   (id ล้วน — สำหรับ select-all ข้ามหน้า)
 *
 * หลักการ (Phase 1-3, branch feature/applications-server-pagination):
 *   1. ไม่ select formData — คอลัมน์ form_data เป็น JSON ก้อนใหญ่ที่หน้ารายชื่อ
 *      ไม่ได้ใช้ (frontend ใช้แค่ id/applicationNo/fullname/email/nationalId/
 *      status/submittedAt) การตัดออกช่วยลด payload ต่อแถวลงมาก
 *   2. where builder กลาง — filter semantics (roundId/status/search +
 *      deletedAt IS NULL) เหมือน handler เดิมทุกประการ เพื่อไม่ให้สอง endpoint
 *      ตอบไม่ตรงกัน
 *   3. pagination แบบ optional — ไม่ส่ง page = behavior เดิม (คืนทุกแถว,
 *      ไม่มี pagination ใน response) → backward compatible
 *   4. sort default = submittedAt DESC, tie-break ด้วย id ASC เพื่อให้
 *      ลำดับนิ่ง (deterministic) ระหว่างหน้า
 *
 * หมายเหตุ: endpoint นี้ "ไม่มี" DRAFT default แบบ excel-export
 * (buildExportWhere) — semantics เดิมของ GET /admin/applications ไม่กรอง
 * status นอกจากส่ง ?status มา จึงคงไว้ตามเดิม
 */
import { and, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { applications } from '../db/schema';

// ── Filters + where builder ────────────────────────────────────────────────

export interface ApplicationsListFilters {
  roundId?: string | null;
  status?: string | null;
  search?: string | null;
}

/**
 * Build where clause สำหรับรายชื่อใบสมัคร
 * semantics ตรงกับ handler เดิมของ GET /admin/applications:
 *   - deletedAt IS NULL เสมอ
 *   - roundId / status: eq เมื่อส่งมา
 *   - search: LIKE (lowercase) บน applicationNo / fullname / email
 */
export function buildApplicationsListWhere(filters: ApplicationsListFilters): SQL {
  const conditions: SQL[] = [isNull(applications.deletedAt)];

  if (filters.roundId) {
    conditions.push(eq(applications.roundId, filters.roundId));
  }

  if (filters.status) {
    conditions.push(eq(applications.status, filters.status));
  }

  if (filters.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      or(
        like(applications.applicationNo, q),
        like(applications.fullname, q),
        like(applications.email, q),
      )!,
    );
  }

  return and(...conditions)!;
}

// ── Column projection (ไม่มี formData) ─────────────────────────────────────

/**
 * คอลัมน์ที่หน้ารายชื่อใช้จริง — 7 ตัว (ตัดตาม review 2026-10-28)
 *
 * เหตุผลที่แต่ละตัวอยู่:
 *   id            → key ของแถว, checkbox selection, routing, bulk ทุกตัว
 *   applicationNo → คอลัมน์แรกของตาราง, aria-label, fallback ชื่อไฟล์ PDF
 *   fullname      → คอลัมน์ชื่อ, sort "ชื่อ A-Z/Z-A" ฝั่ง client, หัว modal
 *   email         → คอลัมน์อีเมล
 *   status        → badge, filterByStatus() ฝั่ง client, ค่าเริ่มต้น modal
 *   submittedAt   → คอลัมน์วันที่, sort หลัก
 *   roundId       → FK ระบุรอบที่แถวสังกัด (ไม่ render แต่คงไว้เป็น provenance)
 *
 * ที่ตัดออก (ไม่ถูกอ่านจาก row ไหนเลยในหน้ารายชื่อ — ข้อมูลชุดนี้ยังได้จาก
 * GET /admin/applications/:id ซึ่ง select() เต็ม):
 *   nationalId, statusReason, verifiedBy, verifiedAt, deletedAt, year,
 *   roundCode, seqInRound
 *   — nationalId เป็น PII ที่ไม่เคยถูก render จึงตัดด้วยเหตุผลด้าน security ด้วย
 */
export const APPLICATION_LIST_COLUMNS = {
  id: applications.id,
  applicationNo: applications.applicationNo,
  fullname: applications.fullname,
  email: applications.email,
  status: applications.status,
  submittedAt: applications.submittedAt,
  roundId: applications.roundId,
} as const;

// ── Optional pagination ────────────────────────────────────────────────────

export const APPLICATIONS_LIST_PAGE_SIZE_DEFAULT = 50;
export const APPLICATIONS_LIST_PAGE_SIZE_MAX = 200;

export type ListPagination =
  | { paginated: false }
  | { paginated: true; page: number; pageSize: number; offset: number }
  | { paginated: false; error: string };

/**
 * แปลง query string page/pageSize → pagination
 * - ไม่ส่ง page (undefined หรือ '') → { paginated: false } = behavior เดิม
 * - page/pageSize ไม่ใช่จำนวนเต็มบวก หรือ pageSize เกิน max → error (400)
 * - ส่ง pageSize อย่างเดียวโดยไม่ส่ง page → ไม่ paginate (page เป็นตัวเปิดโหมด)
 */
export function parseApplicationsListPagination(
  rawPage?: string | null,
  rawPageSize?: string | null,
): ListPagination {
  if (rawPage === undefined || rawPage === null || rawPage === '') {
    return { paginated: false };
  }

  if (!/^\d+$/.test(rawPage)) {
    return { paginated: false, error: 'page must be a positive integer' };
  }
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1) {
    return { paginated: false, error: 'page must be a positive integer' };
  }

  let pageSize = APPLICATIONS_LIST_PAGE_SIZE_DEFAULT;
  if (rawPageSize !== undefined && rawPageSize !== null && rawPageSize !== '') {
    if (!/^\d+$/.test(rawPageSize)) {
      return { paginated: false, error: 'pageSize must be a positive integer' };
    }
    pageSize = Number(rawPageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      return { paginated: false, error: 'pageSize must be a positive integer' };
    }
    if (pageSize > APPLICATIONS_LIST_PAGE_SIZE_MAX) {
      return {
        paginated: false,
        error: `pageSize must not exceed ${APPLICATIONS_LIST_PAGE_SIZE_MAX}`,
      };
    }
  }

  return { paginated: true, page, pageSize, offset: (page - 1) * pageSize };
}
