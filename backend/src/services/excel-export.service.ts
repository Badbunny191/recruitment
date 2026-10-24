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
import { toUnixTimestamp } from '../utils/timestamp';
import type { Bindings } from '../types';

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

// ── Filename from attachment URL ───────────────────────────────────────────
// fileUrl รูปแบบ `.../files/<uuid>-<sanitizedName>` — ตัด uuid ทั้งก้อน
// (uuid มี dash ภายใน 4 ตัว การตัดที่ dash แรกจะได้ชื่อไม่ครบ)
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;
function attachmentFileName(fileUrl: string): string {
  try {
    const clean = fileUrl.split('?')[0].split('#')[0];
    const last = clean.split('/').pop() || '';
    const uuidMatch = last.match(UUID_PREFIX_RE);
    if (uuidMatch) return uuidMatch[1];
    return last || fileUrl;
  } catch {
    return fileUrl;
  }
}

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
  if (type === 'FILE') {
    const names = attachmentsByFieldId?.get(fieldId) ?? [];
    return names.join('\n'); // หลายไฟล์ → บรรทัดใหม่ในเซลล์เดียว
  }

  const raw = formData ? formData[fieldId] : undefined;
  if (raw === null || raw === undefined || raw === '') return ''; // missing → ช่องว่าง

  switch (type) {
    case 'CHECKBOX': {
      // ✅ Other Option — checkbox กลุ่ม (allowOther) เก็บ string[]
      if (Array.isArray(raw)) {
        const joined = raw.map((v) => toStringSafe(v)).join(', ');
        return replaceOtherInDisplay(joined, otherTextOf(formData, fieldId));
      }
      if (typeof raw === 'boolean') return raw ? 'ใช่' : 'ไม่ใช่';
      return sanitizeCell(toStringSafe(raw));
    }
    case 'MASTER_DATA': {
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return objectDisplayLabel(raw as Record<string, unknown>); // name/label เท่านั้น
      }
      if (Array.isArray(raw)) {
        return raw.map((v) => toStringSafe(v)).join(', ');
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
      return formatFieldValueWithOther(fieldId, display, formData);
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
    conditions.push(inArray(applications.status, statusList));
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
  filename: string;
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
  code: 'ROUND_NOT_FOUND' | 'TOO_MANY_ROWS';
  message: string;
  httpStatus: number;
}

export type ExcelExportResult = ExcelExportSuccess | ExcelExportFailure;

// ── Main entry ──────────────────────────────────────────────────────────────
export async function exportApplicationsExcel(
  env: Bindings,
  filters: ExportFilters,
  adminId: string,
  ipAddress: string | null,
): Promise<ExcelExportResult> {
  const startedAt = Date.now();
  const db = getDb(env);

  // ── 1) Round + template version ───────────────────────────────────────
  const round = await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      roundCode: recruitmentRounds.roundCode,
      templateVersionId: recruitmentRounds.templateVersionId,
    })
    .from(recruitmentRounds)
    .where(and(eq(recruitmentRounds.id, filters.roundId), isNull(recruitmentRounds.deletedAt)))
    .get();

  if (!round) {
    return {
      ok: false,
      code: 'ROUND_NOT_FOUND',
      message: 'ไม่พบรอบรับสมัครที่ระบุ',
      httpStatus: 404,
    };
  }

  // ── 2) Template fields → dynamic columns ──────────────────────────────
  const fieldRows = await loadFieldRows(db, round.templateVersionId);
  const fieldColumns = buildFieldColumns(fieldRows);
  const columns: ExportColumn[] = [...SYSTEM_COLUMNS, ...fieldColumns];

  // ── 3) Applications ตาม filters (ไม่มี DRAFT โดย default) ─────────────
  const appRows = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      fullname: applications.fullname,
      email: applications.email,
      status: applications.status,
      statusReason: applications.statusReason,
      formData: applications.formData,
      submittedAt: applications.submittedAt,
    })
    .from(applications)
    .where(buildExportWhere(filters))
    .orderBy(desc(applications.submittedAt));

  // ── 4) Cap 1,000 แถว ─────────────────────────────────────────────────
  if (appRows.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      code: 'TOO_MANY_ROWS',
      message: `จำนวนใบสมัคร ${appRows.length} รายการ เกินขีดจำกัด ${MAX_EXPORT_ROWS} รายการต่อการ export หนึ่งครั้ง กรุณากรองสถานะ ช่วงวันที่ หรือคำค้นเพื่อลดจำนวนก่อน export`,
      httpStatus: 422,
    };
  }

  // ── 5) Attachments ทั้ง round ใน query เดียว (ไม่ loop N+1) ───────────
  const attachmentsByApp = new Map<string, Map<string, string[]>>();
  if (appRows.length > 0) {
    const attRows = await db
      .select({
        applicationId: applicationAttachments.applicationId,
        fieldId: applicationAttachments.fieldId,
        fileUrl: applicationAttachments.fileUrl,
      })
      .from(applicationAttachments)
      .where(inArray(applicationAttachments.applicationId, appRows.map((a: { id: string }) => a.id)));

    for (const att of attRows) {
      let byField = attachmentsByApp.get(att.applicationId);
      if (!byField) {
        byField = new Map();
        attachmentsByApp.set(att.applicationId, byField);
      }
      const names = byField.get(att.fieldId) ?? [];
      names.push(attachmentFileName(att.fileUrl));
      byField.set(att.fieldId, names);
    }
  }

  // ── 6) Build workbook ────────────────────────────────────────────────
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
    values.forEach((v, idx) => {
      if (typeof v === 'string' && v.includes('\n')) {
        row.getCell(idx + 1).alignment = { wrapText: true, vertical: 'top' };
      }
    });
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ── 7) writeBuffer ───────────────────────────────────────────────────
  const rawBuffer = await wb.xlsx.writeBuffer();
  const buffer = rawBuffer instanceof Uint8Array
    ? rawBuffer
    : new Uint8Array(rawBuffer as ArrayBuffer);

  const durationMs = Date.now() - startedAt;
  const generatedAt = new Date().toISOString();
  const filename = `applications-${round.roundCode || round.id.slice(0, 8)}-${bangkokStampNow()}.xlsx`;

  // ── 8) Audit log 1 รายการ (ไม่มี PII — search redact เป็นความยาว) ────
  const auditPayload = {
    roundId: filters.roundId,
    filters: {
      status: parseStatusList(filters.status),
      search: filters.search?.trim()
        ? `[redacted length=${filters.search.trim().length}]`
        : null,
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
    },
    rowCount: appRows.length,
    columnCount: columns.length,
    bytes: buffer.byteLength,
    filename,
    durationMs,
    generatedAt,
  };

  try {
    await db.insert(auditLogs).values({
      id: uuidv4(),
      adminId,
      action: 'EXPORT_EXCEL',
      entityType: 'APPLICATION',
      entityId: filters.roundId,
      payload: JSON.stringify(auditPayload),
      ipAddress: ipAddress ?? 'unknown',
    });
  } catch (auditErr) {
    // Audit ล้มไม่ блок response — ตาม pattern PDF_DOWNLOAD
    console.error('[EXCEL_EXPORT] Failed to log audit:', auditErr);
  }

  return {
    ok: true,
    buffer,
    filename,
    rowCount: appRows.length,
    columnCount: columns.length,
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
