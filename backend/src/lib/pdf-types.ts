/**
 * PDF V1 — ApplicationContext
 *
 * TypeScript interfaces สำหรับ PDF Renderer
 *
 * ใช้เป็น data contract ระหว่าง:
 *   - admin.routes.ts (HTTP layer → รวบรวม data จาก D1)
 *   - pdf-renderer.service.ts (Pure function → render PDF)
 *
 * Design Principles:
 *   - ไม่ผูกกับ Drizzle schema โดยตรง (decouple)
 *   - ไม่ hardcode field names (ใช้ pdfMappingKey)
 *   - ไม่มี template engine (ไม่มี {{placeholder}})
 */

// =============================================================================
// Field Types
// =============================================================================

export type FieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'DATE'
  | 'DROPDOWN'
  | 'RADIO'
  | 'CHECKBOX'
  | 'FILE'
  | 'MASTER_DATA';

// =============================================================================
// Application Status
// =============================================================================

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ฉบับร่าง',
  SUBMITTED: 'ยื่นแล้ว',
  UNDER_REVIEW: 'กำลังตรวจสอบ',
  QUALIFIED: 'ผ่านคุณสมบัติ',
  REJECTED: 'ไม่ผ่าน',
  CANCELED: 'ยกเลิก',
  ARCHIVED: 'เก็บถาวร',
};

// =============================================================================
// Application
// =============================================================================

export interface ApplicationData {
  id: string;
  applicationNo: string;
  email: string;
  fullname: string;
  nationalId: string | null;
  status: string;
  statusReason: string | null;
  submittedAt: number; // unix timestamp
  formData: Record<string, unknown> | null;
}

// =============================================================================
// Recruitment Round
// =============================================================================

export interface RoundData {
  id: string;
  title: string;
  positionLevel: string;
  announcementTitle: string | null;
  announcementDescription: string | null;
  applicationPattern: string | null;
  roundCode: string | null;
}

// =============================================================================
// Template Version Snapshot
// =============================================================================

export interface TemplateVersionData {
  id: string;
  versionNumber: number;
}

// =============================================================================
// Template Section (Dynamic Body)
// =============================================================================

export interface SectionData {
  id: string;
  name: string;
  displayOrder: number;
}

// =============================================================================
// Template Field (Dynamic Body — joined with field_master)
// =============================================================================

export interface FieldData {
  /** templateFields.id */
  id: string;
  /** field_master.id */
  fieldId: string;
  /** templateSections.id (nullable for fields without section) */
  sectionId: string | null;
  displayOrder: number;
  type: FieldType;
  /** COALESCE(overrideLabelTh, labelTh) — already resolved */
  label: string;
  /** field_master.pdf_mapping_key — nullable (null = not mapped to PDF) */
  pdfMappingKey: string | null;
  /** field_master.default_options (parsed) */
  options: string[] | null;
  /** template_fields.override_options (parsed) */
  overrideOptions: string[] | null;
  isRequired: boolean;
  rows: number | null;
  helpText: string | null;
  placeholder: string | null;
}

// =============================================================================
// Attachment
// =============================================================================

export interface AttachmentData {
  id: string;
  fieldId: string;
  fileUrl: string;
  uploadedAt: number;
}

// =============================================================================
// Application Context — รวมทุกอย่างที่ renderer ต้องการ
// =============================================================================

export interface ApplicationContext {
  application: ApplicationData;
  round: RoundData;
  templateVersion: TemplateVersionData;
  sections: SectionData[];
  fields: FieldData[];
  attachments: AttachmentData[];
}

// =============================================================================
// Renderer Output
// =============================================================================

export interface RenderedPdf {
  bytes: Uint8Array;
  pageCount: number;
  generatedAt: number;
}

// =============================================================================
// PDF Cache
// =============================================================================

export const PDF_CACHE_PREFIX = 'pdf/applications';
export const PDF_CACHE_VERSION = 'v1';

export function buildPdfCacheKey(applicationId: string): string {
  return `${PDF_CACHE_PREFIX}/${applicationId}/${PDF_CACHE_VERSION}.pdf`;
}
