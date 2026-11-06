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
 *   4. sort default = applicationNo DESC (เลขที่ใบสมัคร ใหม่ → เก่า), tie-break
 *      ด้วย id ASC เพื่อให้ลำดับนิ่ง (deterministic) ระหว่างหน้า
 *   5. sort whitelist 6 ค่า — ตรงกับ SortDropdown ของ ApplicationsClient
 *      ทุกประการ (applicationNo / submittedAt / fullname × asc/desc) และ
 *      tie-break ถูกออกแบบให้ลำดับนิ่งข้ามหน้า (แถวไม่สลับ/ไม่ซ้ำ)
 *   6. ORDER BY ตัวเดียวเป็น source of truth ร่วมกับ excel-export
 *      (WYSIWYE — หน้าเรียงแบบไหน Excel เรียงแบบเดียวกัน)
 *
 * หมายเหตุ: endpoint นี้ "ไม่มี" DRAFT default แบบ excel-export
 * (buildExportWhere) — semantics เดิมของ GET /admin/applications ไม่กรอง
 * status นอกจากส่ง ?status มา จึงคงไว้ตามเดิม
 */
import { and, asc, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';
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

/** sort object → id canonical เช่น 'applicationNo-desc' (ใช้ใน audit/test) */
export function applicationsListSortId(sort: ApplicationsListSort): ApplicationsListSortId {
  return `${sort.field}-${sort.direction}` as ApplicationsListSortId;
}

// ── Optional pagination ────────────────────────────────────────────────────

export const APPLICATIONS_LIST_PAGE_SIZE_DEFAULT = 50;
export const APPLICATIONS_LIST_PAGE_SIZE_MAX = 200;

/**
 * เพดานความปลอดภัยของ path "ไม่ส่ง page = คืนทุกแถว" (Sprint 3 — CPU
 * hotspot H2): response + JSON.stringify โต linear ตามจำนวนใบ เมื่อรอบโต
 * จึงต้องมีเพดานกัน accidental large fetch
 *
 * การ implement เลือก fetch แบบ `.limit(cap + 1)` แล้วตรวจความยาว (ไม่ใช่
 * COUNT แยก) เพราะ:
 *   - 1 query เท่าเดิม — fetch ไม่เกิน cap+1 แถวเสมอ (bounded ตามที่ตั้งใจ)
 *   - เกิน cap → 422 ชัดเจน ไม่ตัดข้อมูลส่งเงียบ ๆ (silent truncation ทำให้
 *     bulk operation คิดว่าครบทั้งชุด)
 *   - ใต้ cap พฤติกรรมเหมือนเดิมทุกประการ (backward compatible)
 *
 * ค่า 2,000: รอบจริงปัจจุบันหลักสิบใบ (headroom ~20-100x) และ FE ทุกจุดใช้
 * paginated path อยู่แล้ว — caller เดียวที่ยังใช้ path ไม่ส่ง page คือ
 * /ids เพื่อ bulk download ซึ่งจะได้ error ชัดเจนแทนการดึงชุดยักษ์
 */
export const APPLICATIONS_LIST_UNPAGINATED_MAX = 2000;

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

// ── Sort (Phase 1: server-side sort) ───────────────────────────────────────

/**
 * Sort id ที่รับได้ — ตรงกับ SortDropdown ของ ApplicationsClient:
 *   applicationNo-desc (default) | applicationNo-asc |
 *   submittedAt-desc | submittedAt-asc | fullname-asc | fullname-desc
 */
export const APPLICATIONS_LIST_SORT_IDS = [
  'applicationNo-desc',
  'applicationNo-asc',
  'submittedAt-desc',
  'submittedAt-asc',
  'fullname-asc',
  'fullname-desc',
] as const;

export type ApplicationsListSortId = (typeof APPLICATIONS_LIST_SORT_IDS)[number];

export const APPLICATIONS_LIST_SORT_DEFAULT: ApplicationsListSortId = 'applicationNo-desc';

export interface ApplicationsListSort {
  field: 'applicationNo' | 'submittedAt' | 'fullname';
  direction: 'asc' | 'desc';
}

/**
 * แปลง sort id → field/direction
 * ค่าที่ไม่รู้จัก/ไม่ส่งมา → default (applicationNo-desc) ตรงกับ parseSortId
 * ฝั่ง client — ไม่ throw เพื่อให้ endpoint ยัง backward compatible
 * กับ caller เก่าที่ไม่ส่ง sort เลย
 */
export function parseApplicationsListSort(rawSort?: string | null): ApplicationsListSort {
  const id = (rawSort ?? '').trim();
  if (!(APPLICATIONS_LIST_SORT_IDS as readonly string[]).includes(id)) {
    return { field: 'applicationNo', direction: 'desc' };
  }
  const idx = id.lastIndexOf('-');
  return {
    field: id.slice(0, idx) as 'applicationNo' | 'submittedAt' | 'fullname',
    direction: id.slice(idx + 1) as 'asc' | 'desc',
  };
}

/**
 * SQL expression ของ "เลขรันนิ่ง" จากใบสมัคร — ใช้เรียง applicationNo ตามตัวเลข
 * ไม่ใช่ string (string sort พังทันที: APP-2026-9999 > APP-2026-12345, รอบ
 * pattern เช่น SAO-2 > SAO-10)
 *
 * 2 ชั้นตาม migration 019:
 *   1. seq_in_round — ใบที่สมัครหลัง 019 มี snapshot ครบ (integer)
 *   2. ใบเก่ากว่านั้น seq_in_round = NULL → ตัดเลขท้ายจาก application_no
 *      ด้วย rtrim(s, '0123456789') (ตัด trailing digits ออกเหลือ prefix แล้ว
 *      substr ตั้งแต่ตำแหน่งถัดไป) — ครอบทั้ง APP-YYYY-NNNN และรอบ pattern
 *      เช่น SAO-0001
 * ค่าที่ "ไม่มีเลข" (application_no NULL, ไม่ลงท้ายเลข, seq=0 ซึ่งไม่มีใครผลิต)
 * → NULL ทั้งหมด (NULLIF กลืน 0) → ORDER BY จับด้วย key `IS NULL` แยกต่างหาก
 * (จัดไว้ท้ายเสมอ) — semantics เดียวกับ extractRunningNumber() ฝั่ง JS
 * ใน utils/application-no.ts ซึ่งใช้โดย export เส้นทาง ids (เรียงใน JS)
 *
 * บริบทการใช้จริงเป็นรอบเดียว (roundId บังคับทั้งหน้ารายชื่อและ export)
 * จึงเป็นลำดับรันนิ่งที่ผู้ใช้เข้าใจ — ไม่ต้องผสม year ลงใน key
 */
export function buildApplicationRunningNoExpr(): SQL {
  return sql`COALESCE(${applications.seqInRound}, NULLIF(CAST(substr(${applications.applicationNo}, LENGTH(rtrim(${applications.applicationNo}, '0123456789')) + 1) AS INTEGER), 0))`;
}

/**
 * ORDER BY ตาม sort ที่เลือก — tie-break หลายชั้นเพื่อให้ลำดับ deterministic
 * ระหว่างหน้า (ถ้า tie-break ไม่ครบ แถวจะสลับ/ซ้ำเมื่อข้ามหน้า)
 *
 * applicationNo: เรียงด้วย buildApplicationRunningNoExpr() (เลขรันนิ่ง ไม่ใช่
 * string), ใบไม่มีเลขที่จัดไว้ท้ายเสมอทั้งสองทิศทาง, tie-break id ASC
 *
 * submittedAt / fullname: คง semantics เดิมทุกประการ —
 *   NULL: client เดิมคำนวณ submittedAt เป็น NaN แล้วจัดไว้ท้ายเสมอทั้ง asc/desc
 *   → ใส่ `submitted_at IS NULL` เป็น key (0 มาก่อน 1) ให้ null อยู่ท้าย
 * COLLATE NOCASE: แทน toLowerCase() เดิมของ client — พับเฉพาะ ASCII
 * (อักษรไทยไม่ถูกพับทั้งสองฝั่ง) จึงได้ลำดับอักษรไทยแบบ code-point เหมือนเดิม
 */
export function buildApplicationsListOrderBy(sort: ApplicationsListSort): SQL[] {
  if (sort.field === 'applicationNo') {
    // guard "ไม่มีเลข" ต้องชี้ที่ expression (COALESCE(seq, parse)) ไม่ใช่คอลัมน์
    // application_no — แถวที่มีเลขที่แต่ไม่ลงท้ายเลข (เช่น 'SPECIAL') ก็ต้องไปท้าย
    const runningNo = buildApplicationRunningNoExpr();
    const nullsLast = sql`(${runningNo}) IS NULL ASC`;
    return [
      nullsLast,
      sort.direction === 'asc' ? asc(runningNo) : desc(runningNo),
      asc(applications.id),
    ];
  }

  if (sort.field === 'fullname') {
    const nameExpr =
      sort.direction === 'asc'
        ? sql`${applications.fullname} COLLATE NOCASE ASC`
        : sql`${applications.fullname} COLLATE NOCASE DESC`;
    return [
      nameExpr,
      sql`${applications.submittedAt} IS NULL ASC`,
      desc(applications.submittedAt),
      asc(applications.id),
    ];
  }

  const nullsLast = sql`${applications.submittedAt} IS NULL ASC`;
  return sort.direction === 'asc'
    ? [nullsLast, asc(applications.submittedAt), asc(applications.id)]
    : [nullsLast, desc(applications.submittedAt), asc(applications.id)];
}

