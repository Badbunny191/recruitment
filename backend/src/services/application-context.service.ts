/**
 * Application Context Service
 * --------------------------------------------
 * Feature: Document Composer V1 — Real Application Data for Preview
 *
 * Load full ApplicationContext from a real application for preview purposes.
 * This is the "real data" path vs buildPreviewContext() which uses sample data.
 *
 * Design:
 *   - Throws descriptive errors (not silent fallbacks) when data is missing
 *   - Verifies that the application belongs to the requested template version
 *   - Returns ApplicationContext compatible with preview-renderer.ts
 *   - Read-only — never modifies application data
 *
 * Security:
 *   - Uses existing RBAC from caller (adminOnlyMiddleware in routes)
 *   - Does NOT expose nationalId or sensitive fields beyond what's needed for preview
 */

import { eq, and, isNull, or, like, desc } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import {
  applications,
  recruitmentRounds,
  templateVersions,
  templateSections,
  templateFields,
  fieldMaster,
  applicationAttachments,
} from '../db/schema';
import type { ApplicationContext, FieldData, FieldObjectValue } from '../lib/pdf-types';

type DB = ReturnType<typeof drizzleFn<any>>;

// =============================================================================
// Error types
// =============================================================================

export class ApplicationContextError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'TEMPLATE_MISMATCH' | 'DB_ERROR'
  ) {
    super(message);
    this.name = 'ApplicationContextError';
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load full ApplicationContext for a real application
 *
 * Used by preview API when applicationId is provided.
 *
 * @param db - Drizzle instance
 * @param applicationId - applications.id
 * @param templateVersionId - template version ID to verify against
 * @returns ApplicationContext with real application data
 * @throws ApplicationContextError on failure
 */
export async function loadApplicationContext(
  db: DB,
  applicationId: string,
  templateVersionId: string
): Promise<ApplicationContext> {
  // ── 1) Load application with round ───────────────────────────────
  const appRow = await loadApplicationRow(db, applicationId);

  if (!appRow) {
    throw new ApplicationContextError(
      'ไม่พบข้อมูลผู้สมัครที่ระบุ กรุณาเลือกผู้สมัครใหม่หรือกลับไปใช้ข้อมูลตัวอย่าง',
      'NOT_FOUND'
    );
  }

  // ── 2) Verify application belongs to the requested template version ──
  // Application is linked to round, which is linked to template version.
  // We must verify this chain matches what the admin is trying to preview.
  const round = appRow.round;

  if (!round) {
    throw new ApplicationContextError(
      'ไม่พบข้อมูลรอบรับสมัครที่ผูกกับใบสมัครนี้ กรุณาเลือกผู้สมัครใหม่หรือกลับไปใช้ข้อมูลตัวอย่าง',
      'NOT_FOUND'
    );
  }

  if (round.templateVersionId !== templateVersionId) {
    // Get round title for friendly error
    throw new ApplicationContextError(
      `ผู้สมัคร "${appRow.applicationNo} ${appRow.fullname}" สมัครในรอบ "${round.title}" ซึ่งไม่ตรงกับ Template Version ที่กำลังจัดหน้าเอกสาร กรุณาเลือกผู้สมัครที่สมัครในรอบที่ถูกต้อง หรือกลับไปใช้ข้อมูลตัวอย่าง`,
      'TEMPLATE_MISMATCH'
    );
  }

  // ── 3) Load template version info ────────────────────────────────
  const tvRow = await db
    .select({
      id: templateVersions.id,
      versionNumber: templateVersions.versionNumber,
    })
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId))
    .get();

  // ── 4) Load sections ──────────────────────────────────────────
  const sectionsRaw = await db
    .select({
      id: templateSections.id,
      name: templateSections.name,
      displayOrder: templateSections.displayOrder,
    })
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, templateVersionId))
    .orderBy(templateSections.displayOrder);

  const sections = sectionsRaw.map((s) => ({
    id: s.id,
    name: s.name,
    displayOrder: s.displayOrder,
  }));

  // ── 5) Load fields ─────────────────────────────────────────────
  const fields = await loadTemplateFields(db, templateVersionId);

  // ── 6) Load attachments ────────────────────────────────────────
  const attachmentsRaw = await db
    .select({
      id: applicationAttachments.id,
      fieldId: applicationAttachments.fieldId,
      fileUrl: applicationAttachments.fileUrl,
      originalFilename: applicationAttachments.originalFilename,
      uploadedAt: applicationAttachments.uploadedAt,
    })
    .from(applicationAttachments)
    .where(eq(applicationAttachments.applicationId, applicationId));

  const attachments = attachmentsRaw.map((a) => ({
    id: a.id,
    fieldId: a.fieldId,
    fileUrl: a.fileUrl,
    originalFilename: a.originalFilename ?? null,
    uploadedAt: Math.floor(
      (a.uploadedAt ? new Date(a.uploadedAt).getTime() : Date.now()) / 1000
    ),
  }));

  // ── 7) Build ApplicationContext ────────────────────────────────
  // applicationNo/email/fullname are NOT NULL in schema, use non-null assertions
  return {
    application: {
      id: appRow.id,
      applicationNo: appRow.applicationNo!,
      email: appRow.email!,
      fullname: appRow.fullname!,
      nationalId: null, // Never expose nationalId in preview
      status: appRow.status ?? 'SUBMITTED',
      statusReason: appRow.statusReason,
      submittedAt: appRow.submittedAtUnix,
      formData: appRow.formData,
    },
    round: {
      id: round.id,
      title: round.title,
      positionLevel: round.positionLevel,
      announcementTitle: round.announcementTitle,
      announcementDescription: round.announcementDescription,
      applicationPattern: round.applicationPattern,
      roundCode: round.roundCode,
    },
    templateVersion: {
      id: tvRow?.id ?? templateVersionId,
      versionNumber: tvRow?.versionNumber ?? 0,
    },
    sections,
    fields,
    attachments,
  };
}

// =============================================================================
// Application Search (for frontend picker)
// =============================================================================

export interface ApplicationSearchResult {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
  status: string;
  submittedAt: number;
}

/**
 * Search applications by round with pagination
 *
 * Used by frontend ApplicationPicker component.
 *
 * @param db - Drizzle instance
 * @param roundId - recruitment rounds id
 * @param searchQuery - search by applicationNo, fullname, or email
 * @param limit - max results (default 20)
 * @returns array of application summaries
 */
export async function searchApplicationsByRound(
  db: DB,
  roundId: string,
  searchQuery?: string,
  limit: number = 20
): Promise<ApplicationSearchResult[]> {
  let whereClause = and(
    eq(applications.roundId, roundId),
    isNull(applications.deletedAt)
  );

  if (searchQuery && searchQuery.trim().length > 0) {
    const q = `%${searchQuery.trim().toLowerCase()}%`;
    whereClause = and(
      eq(applications.roundId, roundId),
      isNull(applications.deletedAt),
      or(
        like(applications.applicationNo, q),
        like(applications.fullname, q),
        like(applications.email, q)
      )
    )!;
  }

  const rows = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      fullname: applications.fullname,
      email: applications.email,
      status: applications.status,
      submittedAt: applications.submittedAt,
    })
    .from(applications)
    .where(whereClause)
    .orderBy(desc(applications.submittedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    applicationNo: r.applicationNo ?? 'N/A',
    fullname: r.fullname ?? '',
    email: r.email ?? '',
    status: r.status ?? 'SUBMITTED',
    submittedAt: r.submittedAt
      ? Math.floor(new Date(r.submittedAt).getTime() / 1000)
      : 0,
  }));
}

// =============================================================================
// Internal helpers
// =============================================================================

interface ApplicationRow {
  id: string;
  applicationNo: string | null;
  email: string | null;
  fullname: string | null;
  status: string | null;
  statusReason: string | null;
  formData: Record<string, unknown> | null;
  submittedAt: Date | null;
  submittedAtUnix: number;
  roundId: string;
  round?: {
    id: string;
    title: string;
    positionLevel: string;
    templateVersionId: string;
    announcementTitle: string | null;
    announcementDescription: string | null;
    applicationPattern: string | null;
    roundCode: string | null;
  } | null;
}

async function loadApplicationRow(
  db: DB,
  applicationId: string
): Promise<ApplicationRow | null> {
  const row = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      email: applications.email,
      fullname: applications.fullname,
      status: applications.status,
      statusReason: applications.statusReason,
      formData: applications.formData,
      submittedAt: applications.submittedAt,
      roundId: applications.roundId,
    })
    .from(applications)
    .where(and(eq(applications.id, applicationId), isNull(applications.deletedAt)))
    .get();

  if (!row) return null;

  // Load round
  const round = await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      positionLevel: recruitmentRounds.positionLevel,
      templateVersionId: recruitmentRounds.templateVersionId,
      announcementTitle: recruitmentRounds.announcementTitle,
      announcementDescription: recruitmentRounds.announcementDescription,
      applicationPattern: recruitmentRounds.applicationPattern,
      roundCode: recruitmentRounds.roundCode,
    })
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, row.roundId))
    .get();

  const submittedAtUnix = row.submittedAt
    ? Math.floor(new Date(row.submittedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    id: row.id,
    applicationNo: row.applicationNo,
    email: row.email,
    fullname: row.fullname,
    status: row.status,
    statusReason: row.statusReason,
    formData: row.formData as Record<string, unknown> | null,
    submittedAt: row.submittedAt,
    submittedAtUnix,
    roundId: row.roundId,
    round: round ?? null,
  };
}

async function loadTemplateFields(
  db: DB,
  templateVersionId: string
): Promise<FieldData[]> {
  const fieldsRaw = await db
    .select({
      templateFieldId: templateFields.id,
      fieldId: templateFields.fieldId,
      sectionId: templateFields.sectionId,
      displayOrder: templateFields.displayOrder,
      isRequired: templateFields.isRequired,
      type: fieldMaster.fieldType,
      label: fieldMaster.labelTh,
      pdfMappingKey: fieldMaster.pdfMappingKey,
      options: fieldMaster.defaultOptions,
      overrideOptions: templateFields.overrideOptions,
      rows: templateFields.rows,
      helpText: fieldMaster.helpText,
      placeholder: fieldMaster.placeholder,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, templateVersionId))
    .orderBy(templateFields.displayOrder);

  return fieldsRaw.map((f) => {
    let options: string[] | null = null;
    if (f.options) {
      try {
        const parsed =
          typeof f.options === 'string' ? JSON.parse(f.options) : f.options;
        if (Array.isArray(parsed)) {
          options = parsed.map((o: unknown) =>
            typeof o === 'string' ? o : ((o as { label?: string; value?: string })?.label ?? (o as { value?: string })?.value ?? String(o))
          );
        }
      } catch {
        // ignore parse error
      }
    }

    let overrideOptions: string[] | null = null;
    if (f.overrideOptions) {
      try {
        const parsed =
          typeof f.overrideOptions === 'string'
            ? JSON.parse(f.overrideOptions)
            : f.overrideOptions;
        if (Array.isArray(parsed)) {
          overrideOptions = parsed.map((o: unknown) =>
            typeof o === 'string' ? o : ((o as { label?: string; value?: string })?.label ?? (o as { value?: string })?.value ?? String(o))
          );
        }
      } catch {
        // ignore parse error
      }
    }

    return {
      id: f.templateFieldId,
      fieldId: f.fieldId,
      sectionId: f.sectionId,
      displayOrder: f.displayOrder,
      type: f.type as FieldData['type'],
      label: f.label,
      pdfMappingKey: f.pdfMappingKey,
      options,
      overrideOptions,
      isRequired: !!f.isRequired,
      rows: f.rows,
      helpText: f.helpText,
      placeholder: f.placeholder,
    };
  });
}
