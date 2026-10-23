/**
 * PDF V1 — Service Layer
 *
 * เชื่อมต่อระหว่าง:
 *   - admin.routes.ts (HTTP layer)
 *   - pdf-renderer.service.ts (PDF generation)
 *   - D1 (Drizzle query)
 *   - R2 (cache layer)
 *
 * Flow:
 *   1. Get application + round + templateVersion
 *   2. Load sections + fields
 *   3. Check R2 cache → if hit, return cached
 *   4. Else render → upload to R2 → return bytes
 *
 * เก็บ PDF ไว้แม้ application ARCHIVED/CANCELED
 * ลบเฉพาะกรณี hard delete (ยังไม่ implement ใน V1)
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, asc } from 'drizzle-orm';
import {
  applications,
  applicationAttachments,
  recruitmentRounds,
  templateVersions,
  templateSections,
  templateFields,
  fieldMaster,
} from '../db/schema';
import { buildPdfCacheKey, ApplicationContext } from './pdf-types';
import { loadTemplateDescriptor } from '../services/template-descriptor.service';
import {
  buildRenderPlan,
  renderPlanToPdf,
  generateDescriptorFromTemplate,
  type DocumentDescriptor,
  type GeneratorFieldType,
} from './document-composer';
import type { Bindings } from '../types';

// =============================================================================
// Public API
// =============================================================================

export interface PdfResult {
  bytes: Uint8Array;
  pageCount: number;
  generatedAt: number;
  cacheHit: boolean;
}

/**
 * Get PDF for an application (with R2 cache)
 *
 * Returns null if application not found
 */
export async function getApplicationPdf(
  db: ReturnType<typeof drizzle<any>>,
  r2: R2Bucket | undefined,
  applicationId: string
): Promise<PdfResult | null> {
  // 1. Build context from D1
  const ctx = await buildApplicationContext(db, applicationId);
  if (!ctx) return null;

  const cacheKey = buildPdfCacheKey(applicationId);

  // 2. Check R2 cache
  if (r2) {
    const cached = await r2.get(cacheKey);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      // Read generatedAt from custom metadata (preferred) — fallback to httpMetadata
      const customMeta = (cached as any).customMetadata?.['x-generated-at'];
      const generatedAt = customMeta
        ? parseInt(String(customMeta))
        : 0;
      return {
        bytes,
        pageCount: 1, // Unknown without parsing; will be 1 by default
        generatedAt,
        cacheHit: true,
      };
    }
  }

  // 3. Render fresh via Document Composer
  // ใช้ Document Composer PDF renderer เสมอ (ตัวเดียวกับ Composer)
  // หาก template version ไม่มี descriptor ใน DB ให้ generate descriptor แบบเดียวกับ Composer
  const descResult = await loadTemplateDescriptor(db, ctx.templateVersion.id);
  let descriptor: DocumentDescriptor;
  if (descResult.ok && descResult.meta.source === 'db') {
    descriptor = descResult.descriptor;
  } else {
    const genResult = generateDescriptorFromTemplate({
      sections: ctx.sections.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
      })),
      fields: ctx.fields.map((f) => ({
        id: f.id,
        fieldId: f.fieldId,
        sectionId: f.sectionId,
        displayOrder: f.displayOrder,
        type: f.type as GeneratorFieldType,
        overrideLabelTh: null,
        labelTh: f.label,
      })),
    });
    descriptor = genResult.ok ? genResult.descriptor : descResult.descriptor;
  }

  const plan = buildRenderPlan(descriptor, ctx);
  const rendered = await renderPlanToPdf(plan, ctx);

  // 4. Upload to R2 (best-effort, don't fail request if R2 unavailable)
  if (r2) {
    try {
      await r2.put(cacheKey, rendered.bytes, {
        httpMetadata: {
          contentType: 'application/pdf',
        },
        customMetadata: {
          'x-generated-at': String(rendered.generatedAt),
          'x-page-count': String(rendered.pageCount),
          'x-application-id': applicationId,
        },
      });
    } catch (err) {
      // Log but don't fail — client still gets PDF
      console.error(`[PDF] Failed to cache to R2: ${err}`);
    }
  }

  return {
    bytes: rendered.bytes,
    pageCount: rendered.pageCount,
    generatedAt: rendered.generatedAt,
    cacheHit: false,
  };
}

// =============================================================================
// Context Builder
// =============================================================================

/**
 * Build ApplicationContext from D1
 *
 * Returns null if application not found
 *
 * Critical: use round.templateVersionId (not latest version) to ensure
 * application renders from the template version that existed at submission time
 */
export async function buildApplicationContext(
  db: ReturnType<typeof drizzle<any>>,
  applicationId: string
): Promise<ApplicationContext | null> {
  // Application
  const app = await db.select().from(applications).where(eq(applications.id, applicationId)).get();
  if (!app) return null;

  // Round
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, app.roundId)).get();
  if (!round) {
    throw new Error(`Round not found for application ${applicationId}`);
  }

  // Template Version (snapshot — round.templateVersionId at submission time)
  const tv = await db.select().from(templateVersions).where(eq(templateVersions.id, round.templateVersionId)).get();
  if (!tv) {
    throw new Error(`Template version not found: ${round.templateVersionId}`);
  }

  // Sections
  const sectionsRaw = await db
    .select({
      id: templateSections.id,
      name: templateSections.name,
      displayOrder: templateSections.displayOrder,
    })
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, round.templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  const sections = sectionsRaw.map(s => ({
    id: s.id,
    name: s.name,
    displayOrder: s.displayOrder,
  }));

  // Fields (joined with field_master)
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
    .where(eq(templateFields.templateVersionId, round.templateVersionId))
    .orderBy(asc(templateFields.displayOrder));

  const fields = fieldsRaw.map(f => {
    // Parse options (JSON)
    let options: string[] | null = null;
    if (f.options) {
      try {
        const parsed = typeof f.options === 'string' ? JSON.parse(f.options) : f.options;
        if (Array.isArray(parsed)) {
          options = parsed.map((o: any) => typeof o === 'string' ? o : (o?.label ?? o?.value ?? String(o)));
        }
      } catch {}
    }
    let overrideOptions: string[] | null = null;
    if (f.overrideOptions) {
      try {
        const parsed = typeof f.overrideOptions === 'string' ? JSON.parse(f.overrideOptions) : f.overrideOptions;
        if (Array.isArray(parsed)) {
          overrideOptions = parsed.map((o: any) => typeof o === 'string' ? o : (o?.label ?? o?.value ?? String(o)));
        }
      } catch {}
    }

    return {
      id: f.templateFieldId,
      fieldId: f.fieldId,
      sectionId: f.sectionId,
      displayOrder: f.displayOrder,
      type: f.type as any,
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

  // Attachments
  const attachmentsRaw = await db
    .select({
      id: applicationAttachments.id,
      fieldId: applicationAttachments.fieldId,
      fileUrl: applicationAttachments.fileUrl,
      uploadedAt: applicationAttachments.uploadedAt,
    })
    .from(applicationAttachments)
    .where(eq(applicationAttachments.applicationId, applicationId));

  const attachments = attachmentsRaw
    .filter(a => a.uploadedAt !== null)
    .map(a => ({
      id: a.id,
      fieldId: a.fieldId,
      fileUrl: a.fileUrl,
      uploadedAt: typeof a.uploadedAt === 'number' ? a.uploadedAt : Math.floor((a.uploadedAt as Date).getTime() / 1000),
    }));

  // Parse formData (it's stored as JSON)
  let formData: Record<string, unknown> = {};
  if (app.formData) {
    try {
      formData = typeof app.formData === 'string' ? JSON.parse(app.formData) : (app.formData as any);
    } catch (err) {
      console.error(`[PDF] Failed to parse formData for app ${applicationId}: ${err}`);
    }
  }

  const submittedAt = typeof app.submittedAt === 'number'
    ? app.submittedAt
    : Math.floor((app.submittedAt as Date).getTime() / 1000);

  return {
    application: {
      id: app.id,
      applicationNo: app.applicationNo ?? '',
      email: app.email,
      fullname: app.fullname,
      nationalId: app.nationalId,
      status: app.status ?? 'SUBMITTED',
      statusReason: app.statusReason,
      submittedAt,
      formData,
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
      id: tv.id,
      versionNumber: tv.versionNumber,
    },
    sections,
    fields,
    attachments,
  };
}
