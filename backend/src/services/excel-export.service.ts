/**
 * Excel Export Service
 * ============================================================================
 *
 * Feature: Export ใบสมัครทั้งรอบเป็นไฟล์ Excel (.xlsx)
 *
 * หลักการ:
 *   - Export ทีละ Recruitment Round (roundId บังคับ)
 *   - 1 ใบสมัคร = 1 แถว, ทุก field ของ Template Version ของรอบ = 1 คอลัมน์
 *   - คอลัมน์ dynamic ตามลำดับ sections (displayOrder) → fields (displayOrder)
 *   - ไม่ hardcode field ตามประเภทตำแหน่ง — โครงสร้างมาจาก template เท่านั้น
 *   - Generate ใหม่ทุกครั้ง ไม่เก็บไฟล์ใน D1 / R2
 *   - Cap 1,000 แถวต่อครั้ง (เกิน → TOO_MANY_ROWS → HTTP 422)
 *   - D1 limit: ทุก query ที่รับ array (IN (...)) แบ่ง chunk ≤ 90 bind
 *     ต่อ statement (D1 จำกัด 100 bound parameters ต่อ statement)
 *   - ไม่รวมสถานะ DRAFT โดยค่าเริ่มต้น
 *   - Audit log 1 รายการต่อการ export (ไม่รวม PII ใน payload)
 *
 * System columns ที่แสดงก่อน dynamic fields:
 *   ลำดับ | เลขที่ใบสมัคร | วันที่สมัคร | สถานะ | เหตุผลสถานะ |
 *   ชื่อ-นามสกุล | อีเมล | เบอร์โทรศัพท์
 *
 * Dedupe: field-fullname / field-email / field-phone เป็น core contract ของ
 *   ระบบ (public.routes.ts getCoreValue + applicant-lookup.service.ts
 *   directKeys) — ถ้า template มี field เหล่านี้ จะไม่สร้าง dynamic column
 *   ซ้ำ (อ้างอิง Field ID ที่แน่นอน ไม่ใช่ label)
 *
 * Security:
 *   - Excel Formula Injection: string cell ทุกช่องผ่าน sanitizeCell()
 *     (ค่าที่ขึ้นต้น = + - @ Tab CR ได้ prefix "'")
 *   - ตัวเลขที่เป็นรหัส/เลขที่ตำแหน่ง (leading zero / ยาวเกิน precision)
 *     เก็บเป็น text เพื่อไม่ให้ Excel ตัดค่า
 */

import { eq, and, isNull, or, like, desc, sql, inArray, gte, lte } from 'drizzle-orm';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import {
  applications,
  recruitmentRounds,
  templateVersions,
  templateSections,
  templateFields,
  fieldMaster,
  applicationAttachments,
  auditLogs,
} from '../db/schema';
import {
  formatFieldValueWithOther,
  replaceOtherInDisplay,
  OTHER_KEY_SUFFIX,
} from '../lib/other-option';
import {
  attachmentDisplayFileName,
  attachmentDisplayName,
  buildExportFilename,
  buildExportFilenameAscii,
} from '../utils/filename';
import { toUnixTimestamp } from '../utils/timestamp';
import type { Bindings } from '../types';
import {
  canonicalizeSelector,
  describeSelector,
  resolveSelectorWhere,
  type ApplicationsSelector,
} from '../lib/applications-selector';

type DB = ReturnType<typeof drizzleFn<any>>;

// ── Test seam (pattern เดียวกับ rbac.service.ts) ─────────────────────────
let __drizzleOverride: ((env: Bindings) => any) | null = null;
export function __setDrizzleForTests(factory: ((env: Bindings) => any) | null) {
  __drizzleOverride = factory;
}
function getDb(env: Bindings) {
  return __drizzleOverride ? __drizzleOverride(env) : drizzleD1(env.DB as any);
}

// ── Constants ───────────────────────────────────────────────────────────────
export const MAX_EXPORT_ROWS = 1000;

/**
 * Cloudflare D1 จำกัด bound parameters 100 ตัวต่อ statement
 * (https://developers.cloudflare.com/d1/platform/limits/) — ทุก query ที่รับ
 * array (IN (...)) ต้องแบ่งเป็น chunk ก่อน
 *
 * Chunk size 90 (ไม่ใช้ 100 ตรง ๆ):
 *   - selected application query มี bind อื่นอีก 6 ตัวใน WHERE เดียวกัน
 *     (roundId 1 + status IN 5) → ชุดละ 90 = 96/100 เหลือ safety margin
 *   - attachment query ไม่มี bind อื่น (90/100) — ใช้ค่าเดียวกันทั้งสองจุด
 */
export const D1_MAX_BIND_PARAMS = 100;
export const IN_CLAUSE_CHUNK_SIZE = 90;

/** แบ่ง array เป็น chunk ขนาดเท่า ๆ กัน (ตัวสุดท้ายอาจสั้นกว่า) */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Timezone source of truth: Asia/Bangkok (UTC+7) — เดียวกับ public.routes.ts */
const BANGKOK_OFFSET_SECONDS = 7 * 60 * 60;

export const EXPORT_STATUS_LABELS_TH: Record<string, string> = {
  SUBMITTED: 'รอการตรวจสอบ',
  QUALIFIED: 'ผ่านการตรวจสอบ',
  REJECTED: 'ข้อมูลไม่ครบถ้วน',
  CANCELED: 'ยกเลิกใบสมัคร',
  ARCHIVED: 'เก็บเข้าคลัง',
  DRAFT: 'ร่าง',
};

/**
 * Field IDs ที่ระบบใช้เป็น core column (contract เดิมของระบบ):
 *   - public.routes.ts getCoreValue(): 'field-email', 'field-fullname'
 *   - applicant-lookup.service.ts directKeys: 'field-phone'
 * ใช้สำหรับ (1) dedupe dynamic column ซ้ำกับ system column
 *          (2) ดึงค่าเบอร์โทรศัพท์จาก formData ของ field นี้
 */
export const SYSTEM_FIELD_IDS = {
  fullname: 'field-fullname',
  email: 'field-email',
  phone: 'field-phone',
} as const;
const DEDUPED_FIELD_IDS = new Set<string>(Object.values(SYSTEM_FIELD_IDS));

const ALL_APPLICATION_STATUSES = [
  'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED',
] as const;

// ── Formula Injection Sanitizer (OWASP) ────────────────────────────────────
export function sanitizeCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

// ── Bangkok datetime helpers ────────────────────────────────────────────────
function bangkokDateTimeString(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '';
  const shifted = new Date((unixSeconds + BANGKOK_OFFSET_SECONDS) * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:mm
}

function bangkokStampNow(): string {
  return bangkokDateTimeString(Math.floor(Date.now() / 1000))
    .replace(/[-:]/g, '')
    .replace(' ', '-'); // YYYYMMDD-HHmm
}

// ── Filename display ────────────────────────────────────────────────────────
// ลำดับการเลือกชื่อ: (1) original_filename จาก attachment record ถ้ามีค่า
// (2) fallback ถอดจาก fileUrl/object key — logic ทั้งหมดอยู่ที่
// src/utils/filename.ts (ใช้ร่วมกับ submit + admin detail)
// re-export เพื่อให้ consumer เดิมที่ import จาก service ยังทำงาน
export { attachmentDisplayFileName };

// ── Column model ────────────────────────────────────────────────────────────
type FieldType =
  | 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE'
  | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';

interface ExportColumn {
  header: string;
  width: number;
  kind: 'SYSTEM' | 'FIELD';
  /** เฉพาะ kind=FIELD */
  fieldId?: string;
  type?: FieldType;
  /** บังคับ Text format ('@') ทั้งคอลัมน์ */
  forceTextFormat?: boolean;
}

interface FieldRow {
  fieldId: string;
  type: FieldType;
  label: string;
  sectionId: string | null;
  displayOrder: number;
  sectionName: string | null;
  sectionOrder: number | null;
}

const SYSTEM_COLUMNS: ExportColumn[] = [
  { header: 'ลำดับ', width: 8, kind: 'SYSTEM' },
  { header: 'เลขที่ใบสมัคร', width: 22, kind: 'SYSTEM', forceTextFormat: true },
  { header: 'วันที่สมัคร', width: 20, kind: 'SYSTEM' },
  { header: 'สถานะ', width: 18, kind: 'SYSTEM' },
  { header: 'เหตุผลสถานะ', width: 24, kind: 'SYSTEM' },
  { header: 'ชื่อ-นามสกุล', width: 28, kind: 'SYSTEM' },
  { header: 'อีเมล', width: 28, kind: 'SYSTEM' },
  { header: 'เบอร์โทรศัพท์', width: 18, kind: 'SYSTEM', forceTextFormat: true },
];

/** คอลัมน์ dynamic จาก template — เรียงตาม section.displayOrder แล้ว field.displayOrder */
export function buildFieldColumns(fields: FieldRow[]): ExportColumn[] {
  const usable = fields.filter((f) => !DEDUPED_FIELD_IDS.has(f.fieldId));
  // เรียง: มี section ตาม sectionOrder → field.displayOrder;
  //         field ไร้ section ต่อท้ายตาม field.displayOrder
  const inSection = usable
    .filter((f) => f.sectionId !== null)
    .sort((a, b) =>
      (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0) ||
      a.displayOrder - b.displayOrder,
    );
  const noSection = usable
    .filter((f) => f.sectionId === null)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return [...inSection, ...noSection].map((f) => ({
    header: f.label,
    width: f.type === 'TEXTAREA' || f.type === 'FILE' ? 42 : 30,
    kind: 'FIELD' as const,
    fieldId: f.fieldId,
    type: f.type,
    forceTextFormat: f.type === 'TEXT' || f.type === 'DATE'
      || f.type === 'RADIO' || f.type === 'DROPDOWN',
  }));
}

// ── Field value transformation ──────────────────────────────────────────────
type CellValue = string | number;

function isNumericString(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

/** เลขที่มีความหมายเป็นรหัส/เลขที่ตำแหน่ง → เก็บเป็น text (leading zero / เกิน precision) */
function numericLikeToCell(v: string): CellValue {
  if (!isNumericString(v)) return v; // ไม่ใช่เลข → string ตรงๆ
  const isIntegerLike = !v.includes('.');
  if (isIntegerLike && (v.length > 15 || /^-?0\d/.test(v))) return v; // รหัส
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function objectDisplayLabel(value: Record<string, unknown>): string {
  // มาตรฐาน MASTER_DATA: name → label (ห้าม JSON / ID ดิบ)
  if (typeof value.name === 'string' && value.name.trim()) return value.name;
  if (typeof value.label === 'string' && value.label.trim()) return value.label;
  return '';
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const label = objectDisplayLabel(value as Record<string, unknown>);
    return label || JSON.stringify(value); // กัน [object Object] เสมอ
  }
  return String(value);
}

export function transformFieldValue(
  type: FieldType | undefined,
  fieldId: string,
  formData: Record<string, unknown> | null | undefined,
  attachmentsByFieldId: Map<string, string[]> | null,
): CellValue {
  // ── FILE: ชื่อไฟล์จากตาราง attachments (ไม่อยู่ใน formData) ─────────────
  // ค่าใน map เป็น display name แล้ว (original_filename ก่อน → fallback จาก
  // fileUrl) เหลือเพียงกัน formula injection + fallback ชื่อว่าง
  if (type === 'FILE') {
    const displays = attachmentsByFieldId?.get(fieldId) ?? [];
    if (displays.length === 0) return '';
    return displays.map((d) => sanitizeCell(d || 'ไฟล์แนบ')).join('\n'); // หลายไฟล์ → บรรทัดใหม่
  }

  const raw = formData ? formData[fieldId] : undefined;
  if (raw === null || raw === undefined || raw === '') return ''; // missing → ช่องว่าง

  switch (type) {
    case 'CHECKBOX': {
      // ✅ Other Option — checkbox กลุ่ม (allowOther) เก็บ string[]
      if (Array.isArray(raw)) {
        const joined = raw.map((v) => toStringSafe(v)).join(', ');
        // formData เก็บค่าจากผู้สมัครแบบไม่ whitelist — ทุก string cell ต้องผ่าน
        // sanitizeCell (ปิด formula injection ผ่านทาง other-text ด้วย)
        return sanitizeCell(replaceOtherInDisplay(joined, otherTextOf(formData, fieldId)));
      }
      if (typeof raw === 'boolean') return raw ? 'ใช่' : 'ไม่ใช่';
      return sanitizeCell(toStringSafe(raw));
    }
    case 'MASTER_DATA': {
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return sanitizeCell(objectDisplayLabel(raw as Record<string, unknown>)); // name/label เท่านั้น
      }
      if (Array.isArray(raw)) {
        return sanitizeCell(raw.map((v) => toStringSafe(v)).join(', '));
      }
      return sanitizeCell(String(raw)); // legacy string
    }
    case 'DATE': {
      const s = String(raw);
      // เก็บรูปแบบ YYYY-MM-DD ตามที่ฟอร์มบันทึก (input type="date")
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : sanitizeCell(s);
    }
    case 'NUMBER': {
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const cell = numericLikeToCell(raw);
        return typeof cell === 'string' ? sanitizeCell(cell) : cell;
      }
      return sanitizeCell(toStringSafe(raw));
    }
    case 'RADIO':
    case 'DROPDOWN': {
      const display = Array.isArray(raw)
        ? raw.map((v) => toStringSafe(v)).join(', ')
        : toStringSafe(raw);
      // ✅ Other Option: "อื่นๆ (โปรดระบุ)" → "อื่นๆ: <ข้อความ>"
      return sanitizeCell(formatFieldValueWithOther(fieldId, display, formData));
    }
    case 'TEXTAREA':
    case 'TEXT':
    default: {
      // TEXT แสดงข้อมูลทั้งหมด / TEXTAREA คงบรรทัดใหม่ (wrapText จัดการตอนเขียน cell)
      if (Array.isArray(raw)) {
        return sanitizeCell(raw.map((v) => toStringSafe(v)).join(', '));
      }
      return sanitizeCell(toStringSafe(raw));
    }
  }
}

function otherTextOf(
  formData: Record<string, unknown> | null | undefined,
  fieldId: string,
): string {
  const raw = formData ? formData[`${fieldId}${OTHER_KEY_SUFFIX}`] : undefined;
  return typeof raw === 'string' ? raw : '';
}

// ── Query helpers ───────────────────────────────────────────────────────────
export interface ExportFilters {
  roundId: string;
  /** comma-separated statuses เช่น "QUALIFIED,REJECTED" */
  status?: string;
  search?: string;
  /** YYYY-MM-DD (ตีความตามเวลา Asia/Bangkok) */
  dateFrom?: string;
  dateTo?: string;
}

function parseStatusList(status?: string): string[] | null {
  if (!status || !status.trim()) return null;
  const list = status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length > 0 ? list : null;
}

/** dateFrom/dateTo (YYYY-MM-DD) → unix seconds ตามเขตเวลา Bangkok */
function dateRangeToUnix(dateFrom?: string, dateTo?: string): { from?: number; to?: number } {
  const result: { from?: number; to?: number } = {};
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    result.from = Math.floor(Date.parse(`${dateFrom}T00:00:00+07:00`) / 1000);
  }
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    result.to = Math.floor(Date.parse(`${dateTo}T23:59:59+07:00`) / 1000);
  }
  return result;
}

/** Build where clause — semantics ตรงกับ GET /admin/applications + DRAFT default */
export function buildExportWhere(filters: ExportFilters) {
  const conditions = [
    eq(applications.roundId, filters.roundId),
    isNull(applications.deletedAt),
  ];

  const statusList = parseStatusList(filters.status);
  if (statusList) {
    // D1 guard: กรองเฉพาะ status ที่รู้จัก (≤ 5 bind) — status จาก query string
    // ยาวเท่าไรก็ได้และไม่มี cap ที่ไหน จะกลายเป็น bind ตามจำนวนค่า
    // semantics เดิม: ค่าที่ไม่รู้จักไม่ match แถวไหน (เหลือแต่ค่าไม่รู้จัก → 0 แถว)
    const known = statusList.filter((s) =>
      (ALL_APPLICATION_STATUSES as readonly string[]).includes(s as any),
    );
    if (known.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(inArray(applications.status, known));
    }
  } else {
    // ✅ Default: ไม่รวม DRAFT (spec) — ครอบทุก status ที่หน้ารายชื่อใช้
    conditions.push(inArray(applications.status, [...ALL_APPLICATION_STATUSES]));
  }

  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      or(
        like(applications.applicationNo, q),
        like(applications.fullname, q),
        like(applications.email, q),
      )!,
    );
  }

  const { from, to } = dateRangeToUnix(filters.dateFrom, filters.dateTo);
  if (from !== undefined) conditions.push(gte(applications.submittedAt, new Date(from * 1000)));
  if (to !== undefined) conditions.push(lte(applications.submittedAt, new Date(to * 1000)));

  return and(...conditions)!;
}

// ── Load template structure ────────────────────────────────────────────────
async function loadFieldRows(db: DB, templateVersionId: string): Promise<FieldRow[]> {
  const rows = await db
    .select({
      fieldId: templateFields.fieldId,
      type: fieldMaster.fieldType,
      label: sql<string>`COALESCE(${templateFields.overrideLabelTh}, ${fieldMaster.labelTh})`,
      sectionId: templateFields.sectionId,
      displayOrder: templateFields.displayOrder,
      sectionName: templateSections.name,
      sectionOrder: templateSections.displayOrder,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .leftJoin(templateSections, eq(templateFields.sectionId, templateSections.id))
    .where(eq(templateFields.templateVersionId, templateVersionId));

  return rows
    .filter((r) => !r.fieldId.endsWith(OTHER_KEY_SUFFIX)) // กัน fieldId ที่ลงท้าย __other (defensive)
    .map((r) => ({
      fieldId: r.fieldId,
      type: r.type as FieldType,
      label: r.label,
      sectionId: r.sectionId,
      displayOrder: r.displayOrder,
      sectionName: r.sectionName,
      sectionOrder: r.sectionOrder,
    }));
}

// ── Result types ────────────────────────────────────────────────────────────
export interface ExcelExportSuccess {
  ok: true;
  buffer: Uint8Array;
  /** ชื่อไฟล์ Unicode ที่ผู้ใช้เห็น (จาก filename*) */
  filename: string;
  /** ASCII fallback สำหรับ filename= ใน Content-Disposition */
  filenameAscii: string;
  rowCount: number;
  columnCount: number;
  bytes: number;
  durationMs: number;
  generatedAt: string;
  /** audit payload ที่ route ใช้บันทึก (ไม่มี PII) */
  auditPayload: Record<string, unknown>;
}

export interface ExcelExportFailure {
  ok: false;
  code: 'ROUND_NOT_FOUND' | 'TOO_MANY_ROWS' | 'APPLICATIONS_NOT_EXPORTABLE';
  message: string;
  httpStatus: number;
  /** เฉพาะ APPLICATIONS_NOT_EXPORTABLE: จำนวน ID ที่ export ไม่ได้ */
  missingCount?: number;
}

export type ExcelExportResult = ExcelExportSuccess | ExcelExportFailure;

// ── Round loader (ใช้ร่วมทุกโหมด export) ─────────────────────────────────────
async function loadExportRound(db: DB, roundId: string) {
  return db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      roundCode: recruitmentRounds.roundCode,
      templateVersionId: recruitmentRounds.templateVersionId,
    })
    .from(recruitmentRounds)
    .where(and(eq(recruitmentRounds.id, roundId), isNull(recruitmentRounds.deletedAt)))
    .get();
}

/** Columns ที่ทุกโหมด export เลือกจากตาราง applications */
const EXPORT_APP_COLUMNS = {
  id: applications.id,
  applicationNo: applications.applicationNo,
  fullname: applications.fullname,
  email: applications.email,
  status: applications.status,
  statusReason: applications.statusReason,
  formData: applications.formData,
  submittedAt: applications.submittedAt,
};

/** แถวใบสมัครที่เข้า workbook builder (filtered / selected ใช้ type เดียวกัน) */
interface ExportAppRow {
  id: string;
  applicationNo: string | null;
  fullname: string | null;
  email: string | null;
  status: string | null;
  statusReason: string | null;
  formData: unknown;
  submittedAt: number | Date | null;
}

/**
 * Shared Workbook Builder — Filtered / Selected export ใช้ตัวเดียวกัน
 * (ห้ามสร้าง logic แปลง field ซ้ำอีกชุดสำหรับโหมดใดโหมดหนึ่ง)
 */
async function buildWorkbookBuffer(
  db: DB,
  templateVersionId: string,
  appRows: ExportAppRow[],
): Promise<{ buffer: Uint8Array; columnCount: number }> {
  // ── Template fields → dynamic columns ──────────────────────────────────
  const fieldRows = await loadFieldRows(db, templateVersionId);
  const columns: ExportColumn[] = [...SYSTEM_COLUMNS, ...buildFieldColumns(fieldRows)];

  // ── Attachments ทั้งชุด (ไม่ loop N+1) — แบ่ง chunk ตาม D1 limit ────────
  // applicationId IN (...) bind ตามจำนวนแถว export (สูงสุด 1,000) → ต้อง
  // แบ่ง chunk ≤ IN_CLAUSE_CHUNK_SIZE; 1,000 แถว = 12 query (bounded ไม่ใช่ N+1)
  const attachmentsByApp = new Map<string, Map<string, string[]>>();
  if (appRows.length > 0) {
    const appIds = appRows.map((a) => a.id);
    const attRows: Array<{
      applicationId: string;
      fieldId: string;
      fileUrl: string;
      originalFilename: string | null;
    }> = [];
    for (const chunk of chunkArray(appIds, IN_CLAUSE_CHUNK_SIZE)) {
      const rows = await db
        .select({
          applicationId: applicationAttachments.applicationId,
          fieldId: applicationAttachments.fieldId,
          fileUrl: applicationAttachments.fileUrl,
          originalFilename: applicationAttachments.originalFilename,
        })
        .from(applicationAttachments)
        .where(inArray(applicationAttachments.applicationId, chunk));
      attRows.push(...rows);
    }

    for (const att of attRows) {
      let byField = attachmentsByApp.get(att.applicationId);
      if (!byField) {
        byField = new Map();
        attachmentsByApp.set(att.applicationId, byField);
      }
      const names = byField.get(att.fieldId) ?? [];
      // ลำดับชื่อ: original_filename ก่อน → fallback ถอดจาก fileUrl
      // (การ sanitize formula injection + fallback "ไฟล์แนบ" ทำใน transformFieldValue)
      names.push(attachmentDisplayName(att));
      byField.set(att.fieldId, names);
    }
  }

  // ── Build workbook ────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SAO Recruitment — Excel Export';
  wb.created = new Date();
  const ws = wb.addWorksheet('ใบสมัคร');

  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true };

  // ความกว้าง + text format ต่อคอลัมน์
  columns.forEach((col, idx) => {
    const column = ws.getColumn(idx + 1);
    column.width = col.width;
    if (col.forceTextFormat) column.numFmt = '@';
  });

  let seq = 0;
  for (const app of appRows) {
    seq += 1;
    const formData = parseFormDataRecord(app.formData);
    const attByField = attachmentsByApp.get(app.id) ?? null;
    const submittedUnix = toUnixTimestamp(app.submittedAt);
    const status = app.status ?? 'SUBMITTED';

    const values: (string | number)[] = columns.map((col) => {
      if (col.kind === 'SYSTEM') {
        switch (col.header) {
          case 'ลำดับ': return seq;
          case 'เลขที่ใบสมัคร': return sanitizeCell(app.applicationNo ?? '');
          case 'วันที่สมัคร': return bangkokDateTimeString(submittedUnix);
          case 'สถานะ': return EXPORT_STATUS_LABELS_TH[status] ?? status;
          case 'เหตุผลสถานะ': return sanitizeCell(app.statusReason ?? '');
          case 'ชื่อ-นามสกุล': return sanitizeCell(app.fullname ?? '');
          case 'อีเมล': return sanitizeCell(app.email ?? '');
          case 'เบอร์โทรศัพท์': {
            const phone = formData ? formData[SYSTEM_FIELD_IDS.phone] : undefined;
            const s = typeof phone === 'string' ? phone : '';
            return sanitizeCell(s);
          }
          default: return '';
        }
      }
      return transformFieldValue(col.type, col.fieldId!, formData, attByField);
    });

    const row = ws.addRow(values);
    // wrapText สำหรับค่าหลายบรรทัด (TEXTAREA / FILE หลายไฟล์)
    // และเซลล์ FILE ทุกช่อง (รวมไฟล์เดียว) ตาม spec
    values.forEach((v, idx) => {
      const col = columns[idx];
      const isMultiLine = typeof v === 'string' && v.includes('\n');
      if (isMultiLine || col?.type === 'FILE') {
        row.getCell(idx + 1).alignment = { wrapText: true, vertical: 'top' };
      }
    });
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ── writeBuffer ───────────────────────────────────────────────────────
  const rawBuffer = await wb.xlsx.writeBuffer();
  const buffer = rawBuffer instanceof Uint8Array
    ? rawBuffer
    : new Uint8Array(rawBuffer as ArrayBuffer);

  return { buffer, columnCount: columns.length };
}

/** Audit 1 รายการต่อการ export สำเร็จ — ล้มไม่ block response */
async function writeExportAudit(
  db: DB,
  adminId: string,
  ipAddress: string | null,
  auditPayload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: uuidv4(),
      adminId,
      action: 'EXPORT_EXCEL',
      // entityId = roundId จึงต้องเป็น RECRUITMENT_ROUND (log เก่าที่เขียนไว้
      // เป็น APPLICATION + roundId ไม่แก้ย้อนหลัง — resolver ใน
      // audit-display.service.ts รองรับทั้งสองรูปแบบ)
      entityType: 'RECRUITMENT_ROUND',
      entityId: auditPayload.roundId as string,
      payload: JSON.stringify(auditPayload),
      ipAddress: ipAddress ?? 'unknown',
    });
  } catch (auditErr) {
    // Audit ล้มไม่ block response — ตาม pattern PDF_DOWNLOAD
    console.error('[EXCEL_EXPORT] Failed to log audit:', auditErr);
  }
}

// ── Main entry: Filtered export (GET) ──────────────────────────────────────
export async function exportApplicationsExcel(
  env: Bindings,
  filters: ExportFilters,
  adminId: string,
  ipAddress: string | null,
): Promise<ExcelExportResult> {
  const startedAt = Date.now();
  const db = getDb(env);

  // ── 1) Round + template version ───────────────────────────────────────
  const round = await loadExportRound(db, filters.roundId);
  if (!round) {
    return {
      ok: false,
      code: 'ROUND_NOT_FOUND',
      message: 'ไม่พบรอบรับสมัครที่ระบุ',
      httpStatus: 404,
    };
  }

  // ── 2) Applications ตาม filters (ไม่มี DRAFT โดย default) ─────────────
  // orderBy แบบ deterministic: submittedAt desc แล้ว id desc เป็น tie-breaker
  const appRows = await db
    .select(EXPORT_APP_COLUMNS)
    .from(applications)
    .where(buildExportWhere(filters))
    .orderBy(desc(applications.submittedAt), desc(applications.id));

  // ── 3) Cap 1,000 แถว ─────────────────────────────────────────────────
  if (appRows.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      code: 'TOO_MANY_ROWS',
      message: `จำนวนใบสมัคร ${appRows.length} รายการ เกินขีดจำกัด ${MAX_EXPORT_ROWS} รายการต่อการ export หนึ่งครั้ง กรุณากรองสถานะ ช่วงวันที่ หรือคำค้นเพื่อลดจำนวนก่อน export`,
      httpStatus: 422,
    };
  }

  // ── 4) Build workbook (shared builder) ────────────────────────────────
  const { buffer, columnCount } = await buildWorkbookBuffer(db, round.templateVersionId, appRows);

  const durationMs = Date.now() - startedAt;
  const generatedAt = new Date().toISOString();
  const stamp = bangkokStampNow();
  const filename = buildExportFilename(round, stamp);
  const filenameAscii = buildExportFilenameAscii(round, stamp);

  // ── 5) Audit log 1 รายการ (ไม่มี PII — search redact เป็นความยาว) ────
  const auditPayload = {
    roundId: filters.roundId,
    exportMode: 'FILTERED' as const,
    filters: {
      status: parseStatusList(filters.status),
      search: filters.search?.trim()
        ? `[redacted length=${filters.search.trim().length}]`
        : null,
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
    },
    rowCount: appRows.length,
    columnCount,
    bytes: buffer.byteLength,
    filename,
    durationMs,
    generatedAt,
  };
  await writeExportAudit(db, adminId, ipAddress, auditPayload);

  return {
    ok: true,
    buffer,
    filename,
    filenameAscii,
    rowCount: appRows.length,
    columnCount,
    bytes: buffer.byteLength,
    durationMs,
    generatedAt,
    auditPayload,
  };
}

// ── Main entry: Selected export (POST) ─────────────────────────────────────
export interface SelectedExportRequest {
  roundId: string;
  /** legacy: รายการ id ที่เลือกชัดเจน (ยังใช้ได้เหมือนเดิม) */
  applicationIds?: string[];
  /** Phase 2: selector (ids | filter) — ใช้แทน applicationIds ได้ */
  selector?: ApplicationsSelector;
}

/**
 * Export เฉพาะใบสมัครที่เลือก:
 *   - ทุก ID ต้องอยู่ใน roundId ที่ระบุ (ห้ามข้ามรอบ) + ไม่ถูกลบ + ไม่ใช่ DRAFT
 *   - ID ซ้ำถูก deduplicate (contract: รวบเป็นรายการเดียว ไม่ reject)
 *   - มี ID ใด export ไม่ได้ → reject ทั้งชุด (422) ไม่ export บางส่วน
 *   - ลำดับแถว deterministic เหมือน filtered: submittedAt desc, id desc
 *
 * Phase 2 — selector:
 *   - kind 'ids'    → เส้นทางเดียวกับ applicationIds เดิมเป๊ะ (กฎ reject ทั้งชุดคงอยู่)
 *   - kind 'filter' → ชุดเดียวกับ export ตามตัวกรอง (buildExportWhere):
 *                     ตัด DRAFT โดย default, ไม่มีแนวคิด "missing" เพราะชุด
 *                     มาจากตัวกรอง ไม่ใช่รายการที่ผู้ใช้ระบุทีละใบ
 *                     → cap 1,000 แถวเหมือน filtered
 */
export async function exportSelectedApplicationsExcel(
  env: Bindings,
  request: SelectedExportRequest,
  adminId: string,
  ipAddress: string | null,
): Promise<ExcelExportResult> {
  const startedAt = Date.now();
  const db = getDb(env);

  // ── 0) แปลง request → selector เดียว (backward compatible) ────────────
  // canonicalizeSelector: รองรับทั้งรูป nested (Phase 5) และ flat (Phase 2)
  // เพราะ service นี้ถูกเรียกได้ตรง ๆ โดยไม่ผ่าน zod
  const selector: ApplicationsSelector = canonicalizeSelector(
    request.selector
      ? request.selector
      : { kind: 'ids', ids: request.applicationIds ?? [] },
  );

  // filter ต้องผูกกับรอบเดียวกับที่ขอ export (filename สร้างจากรอบนี้)
  if (selector.kind === 'filter' && selector.filter.roundId !== request.roundId) {
    return {
      ok: false,
      code: 'APPLICATIONS_NOT_EXPORTABLE',
      message: 'ตัวกรองที่เลือกไม่ตรงกับรอบที่ระบุ',
      httpStatus: 422,
    };
  }

  // ── 0.1) kind 'filter' — เส้นทางของ "เลือกทั้งหมดตามตัวกรอง" ──────────
  if (selector.kind === 'filter') {
    const round = await loadExportRound(db, request.roundId);
    if (!round) {
      return {
        ok: false,
        code: 'ROUND_NOT_FOUND',
        message: 'ไม่พบรอบรับสมัครที่ระบุ',
        httpStatus: 404,
      };
    }

    // where จาก selector กลาง (roundId + status list + search + deletedAt
    // + excludeIds) และตัด DRAFT ตาม semantics เดิมของ export
    // → logic ไม่ถูก copy ไว้ที่นี่ ใช้ resolveSelectorWhere ตัวเดียว
    const appRows = await db
      .select(EXPORT_APP_COLUMNS)
      .from(applications)
      .where(resolveSelectorWhere(selector, { excludeDraft: true }))
      .orderBy(desc(applications.submittedAt), desc(applications.id));

    if (appRows.length === 0) {
      return {
        ok: false,
        code: 'APPLICATIONS_NOT_EXPORTABLE',
        message: 'ไม่พบใบสมัครที่ตรงกับตัวกรองที่เลือก',
        httpStatus: 422,
        missingCount: 0,
      };
    }

    if (appRows.length > MAX_EXPORT_ROWS) {
      return {
        ok: false,
        code: 'TOO_MANY_ROWS',
        message: `จำนวนใบสมัคร ${appRows.length} รายการ เกินขีดจำกัด ${MAX_EXPORT_ROWS} รายการต่อการ export หนึ่งครั้ง กรุณากรองสถานะหรือคำค้นเพื่อลดจำนวนก่อน export`,
        httpStatus: 422,
      };
    }

    const { buffer, columnCount } = await buildWorkbookBuffer(db, round.templateVersionId, appRows);

    const durationMs = Date.now() - startedAt;
    const generatedAt = new Date().toISOString();
    const stamp = bangkokStampNow();
    const filename = buildExportFilename(round, stamp);
    const filenameAscii = buildExportFilenameAscii(round, stamp);

    const auditPayload = {
      roundId: request.roundId,
      exportMode: 'SELECTED' as const,
      selector: describeSelector(selector),
      selectedCount: appRows.length,
      rowCount: appRows.length,
      columnCount,
      bytes: buffer.byteLength,
      filename,
      durationMs,
      generatedAt,
    };
    await writeExportAudit(db, adminId, ipAddress, auditPayload);

    return {
      ok: true,
      buffer,
      filename,
      filenameAscii,
      rowCount: appRows.length,
      columnCount,
      bytes: buffer.byteLength,
      durationMs,
      generatedAt,
      auditPayload,
    };
  }

  // ── 1) kind 'ids' — contract เดิมทั้งหมด ─────────────────────────────
  const uniqueIds = Array.from(new Set(selector.ids));
  if (uniqueIds.length === 0) {
    return {
      ok: false,
      code: 'APPLICATIONS_NOT_EXPORTABLE',
      message: 'ต้องเลือกใบสมัครอย่างน้อย 1 รายการ',
      httpStatus: 422,
      missingCount: 0,
    };
  }
  if (uniqueIds.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      code: 'TOO_MANY_ROWS',
      message: `จำนวนใบสมัคร ${uniqueIds.length} รายการ เกินขีดจำกัด ${MAX_EXPORT_ROWS} รายการต่อการ export หนึ่งครั้ง`,
      httpStatus: 422,
    };
  }

  // ── 1) Round (roundId บังคับ — filename สร้างจากข้อมูลรอบใน D1) ────────
  const round = await loadExportRound(db, request.roundId);
  if (!round) {
    return {
      ok: false,
      code: 'ROUND_NOT_FOUND',
      message: 'ไม่พบรอบรับสมัครที่ระบุ',
      httpStatus: 404,
    };
  }

  // ── 2) เฉพาะ ID ที่เลือก ในรอบที่ระบุเท่านั้น (กฎ status เดียวกับ filtered) ─
  // D1 limit: id IN (...) bind ตามจำนวน ID → แบ่ง chunk ≤ IN_CLAUSE_CHUNK_SIZE
  // (query มี bind อื่น 6 ตัว: roundId 1 + status 5 → ชุดละ 90 = 96/100)
  const foundRows: ExportAppRow[] = [];
  for (const chunk of chunkArray(uniqueIds, IN_CLAUSE_CHUNK_SIZE)) {
    const rows = await db
      .select(EXPORT_APP_COLUMNS)
      .from(applications)
      .where(and(
        eq(applications.roundId, request.roundId),
        isNull(applications.deletedAt),
        inArray(applications.id, chunk),
        inArray(applications.status, [...ALL_APPLICATION_STATUSES]),
      ));
    foundRows.push(...rows);
  }

  // หลังรวมหลาย chunk: dedupe ซ้ำอีกชั้นแบบ defensive (chunk ตัดจาก uniqueIds
  // ที่ไม่ซ้ำกันอยู่แล้ว แต่กัน query layer คืนแถวซ้ำในอนาคต)
  const seenIds = new Set<string>();
  const appRows = foundRows.filter((row) => {
    if (seenIds.has(row.id)) return false;
    seenIds.add(row.id);
    return true;
  });

  // ลำดับ deterministic เหมือน filtered (submittedAt DESC, id DESC) —
  // ORDER BY ต่อ chunk รวมกันไม่ได้ลำดับ global จึงเรียงใน JS ชุดเดียวจบ
  appRows.sort((a, b) => {
    const at = toUnixTimestamp(a.submittedAt) ?? 0;
    const bt = toUnixTimestamp(b.submittedAt) ?? 0;
    if (at !== bt) return bt - at;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });

  // ── 3) ID ใดไม่พบ / ถูกลบ / คนละรอบ / DRAFT → reject ทั้งชุด ──────────
  const missingCount = uniqueIds.length - appRows.length;
  if (missingCount > 0) {
    return {
      ok: false,
      code: 'APPLICATIONS_NOT_EXPORTABLE',
      message: `มีใบสมัคร ${missingCount} รายการจากที่เลือกที่ export ไม่ได้ (ไม่พบ ถูกลบ อยู่คนละรอบ หรือยังเป็นร่าง) กรุณารีเฟรชรายการแล้วเลือกใหม่`,
      httpStatus: 422,
      missingCount,
    };
  }

  // ── 4) Build workbook (shared builder เดียวกับ filtered) ──────────────
  const { buffer, columnCount } = await buildWorkbookBuffer(db, round.templateVersionId, appRows);

  const durationMs = Date.now() - startedAt;
  const generatedAt = new Date().toISOString();
  const stamp = bangkokStampNow();
  const filename = buildExportFilename(round, stamp);
  const filenameAscii = buildExportFilenameAscii(round, stamp);

  // ── 5) Audit — เก็บเฉพาะ selectedCount ไม่เก็บ applicationIds ทั้งก้อน ──
  const auditPayload = {
    roundId: request.roundId,
    exportMode: 'SELECTED' as const,
    selectedCount: uniqueIds.length,
    rowCount: appRows.length,
    columnCount,
    bytes: buffer.byteLength,
    filename,
    durationMs,
    generatedAt,
  };
  await writeExportAudit(db, adminId, ipAddress, auditPayload);

  return {
    ok: true,
    buffer,
    filename,
    filenameAscii,
    rowCount: appRows.length,
    columnCount,
    bytes: buffer.byteLength,
    durationMs,
    generatedAt,
    auditPayload,
  };
}

/** formData อาจเป็น object หรือ JSON string (รวมถึง legacy double-encoded) */
function parseFormDataRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // legacy double-encoded: string ที่ parse แล้วได้ string อีกชั้น
        if (typeof parsed === 'string') {
          const second = JSON.parse(parsed);
          if (second && typeof second === 'object' && !Array.isArray(second)) {
            return second as Record<string, unknown>;
          }
        }
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}
