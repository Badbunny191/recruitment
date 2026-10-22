/**
 * Template Descriptor Route Handlers
 * --------------------------------------------
 * Feature: Document Composer V1 — Admin API Layer
 *
 * Route สำหรับ Frontend เรียกใช้ Document Composer Engine:
 *   GET    /admin/template-versions/:id/descriptor
 *   PUT    /admin/template-versions/:id/descriptor
 *   POST   /admin/template-versions/:id/descriptor/preview
 *   POST   /admin/template-versions/:id/descriptor/generate
 *
 * Design Principles:
 *   - Thin HTTP layer — ไม่มี business logic
 *   - ทุก operation reuse function จาก services + document-composer core
 *   - validation ผ่าน Zod (request shape) + validateDescriptor (descriptor shape)
 *   - error mapping consistent กับ existing admin.routes.ts pattern
 *
 * Reuse:
 *   - loadTemplateDescriptor()     — template-descriptor.service.ts
 *   - saveTemplateDescriptor()     — template-descriptor.service.ts
 *   - generateDescriptorFromTemplate() — document-composer/descriptor-generator.ts
 *   - renderDescriptorToPreview()  — document-composer/preview-renderer.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';

import { Bindings, AppVariables } from '../types';
import { adminOnlyMiddleware } from '../middlewares/auth.middleware';
import { auditMiddleware } from '../middlewares/audit.middleware';
import { templateVersions, templateSections, templateFields, fieldMaster } from '../db/schema';

import {
  loadTemplateDescriptor,
  saveTemplateDescriptor,
} from '../services/template-descriptor.service';
import { buildPreviewContext } from '../services/template-descriptor-preview.service';
import {
  loadApplicationContext,
  ApplicationContextError,
} from '../services/application-context.service';

import {
  generateDescriptorFromTemplate,
  type GeneratorSectionInput,
  type GeneratorFieldInput,
  type GeneratorFieldType,
} from '../lib/document-composer';
import { PageSettingsSchema } from '../lib/document-composer/page-settings';
import { renderDescriptorToPreview } from '../lib/document-composer';
import type { DocumentDescriptor } from '../lib/document-composer/types';

const descriptorRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Schema สำหรับ PUT /admin/template-versions/:id/descriptor
 *
 * รับ descriptor แบบ { version, blocks, pageSettings? }
 * - blocks: array ของ block (zod discriminated union)
 * - version: literal 1
 * - pageSettings: optional (ขอบกระดาษ) — **ต้อง .passthrough()/กำหนดไว้**
 *   มิฉะนั้น Zod จะ strip ค่าทิ้ง → การบันทึกจะไม่เก็บค่า
 */
const SaveDescriptorRequestSchema = z.object({
  descriptor: z.object({
    version: z.literal(1),
    blocks: z
      .array(z.any()) // ปล่อยให้ validateDescriptor() ตรวจ block-level เอง
      .min(1, 'Descriptor must have at least one block'),
    pageSettings: PageSettingsSchema.optional(),
  }),
  /**
   * Optional optimistic lock — ถ้าใส่ จะตรวจกับ schema version ใน DB
   */
  expectedSchemaVersion: z.number().int().nonnegative().optional(),
});

/**
 * Schema สำหรับ POST /admin/template-versions/:id/descriptor/preview
 *
 * รับ descriptor เพื่อ preview (ไม่บันทึก)
 *
 * ── [Live Preview with Real Applicant Data] ──────────────────────────────────
 * applicationId: optional — ถ้าไม่ใส่ใช้ sample preview context (เดิม)
 *               ถ้าใส่ → โหลด ApplicationContext จริง
 *               ถ้าไม่ตรง template version → คืน validation error ภาษาไทย
 */
const PreviewDescriptorRequestSchema = z.object({
  descriptor: z.object({
    version: z.literal(1),
    blocks: z.array(z.any()).min(1),
    pageSettings: PageSettingsSchema.optional(),
  }),
  // ── [Live Preview UX] options (optional)
  // - mode: 'form' | 'document' — body field rendering
  // - includeHeader: boolean — render logo + title + tokens header
  options: z
    .object({
      mode: z.enum(["form", "document"]).optional(),
      includeHeader: z.boolean().optional(),
      title: z.string().optional(),
    })
    .optional(),
  // ── [Live Preview] Real applicant data ───────────────────────────────
  // optional — backward compatible (ถ้าไม่ใส่ใช้ sample context)
  applicationId: z.string().min(1).optional(),
});

/**
 * Schema สำหรับ POST /admin/template-versions/:id/descriptor/generate
 *
 * รับ optional tableFieldIds (ระบุว่า field ไหนเป็น table)
 * ไม่ต้องส่ง sections/fields — service จะ query ให้
 */
const GenerateDescriptorRequestSchema = z
  .object({
    tableFieldIds: z.array(z.string().min(1)).optional(),
  })
  .optional()
  .default({});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Verify template version exists
 *
 * Returns:
 *   - { exists: true, version } เมื่อเจอ
 *   - { exists: false } เมื่อไม่เจอ
 */
async function findTemplateVersion(
  db: ReturnType<typeof drizzle<any>>,
  id: string
): Promise<{ exists: true; version: typeof templateVersions.$inferSelect } | { exists: false }> {
  const version = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, id))
    .get();
  if (!version) return { exists: false };
  return { exists: true, version };
}

/**
 * Load sections + fields (joined with field_master) สำหรับ generator
 */
async function loadSectionsAndFieldsForGenerator(
  db: ReturnType<typeof drizzle<any>>,
  templateVersionId: string
): Promise<{
  sections: GeneratorSectionInput[];
  fields: GeneratorFieldInput[];
} | null> {
  // Sections
  const sectionsRaw = await db
    .select({
      id: templateSections.id,
      name: templateSections.name,
      displayOrder: templateSections.displayOrder,
      isActive: templateSections.isActive,
    })
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  // Fields + field_master
  const fieldsRaw = await db
    .select({
      templateFieldId: templateFields.id,
      fieldId: templateFields.fieldId,
      sectionId: templateFields.sectionId,
      displayOrder: templateFields.displayOrder,
      type: fieldMaster.fieldType,
      overrideLabelTh: templateFields.overrideLabelTh,
      labelTh: fieldMaster.labelTh,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, templateVersionId))
    .orderBy(asc(templateFields.displayOrder));

  const sections: GeneratorSectionInput[] = sectionsRaw.map((s) => ({
    id: s.id,
    name: s.name,
    displayOrder: s.displayOrder,
    isActive: s.isActive ?? true,
  }));

  const fields: GeneratorFieldInput[] = fieldsRaw.map((f) => ({
    id: f.templateFieldId,
    fieldId: f.fieldId,
    sectionId: f.sectionId,
    displayOrder: f.displayOrder,
    type: f.type as GeneratorFieldType,
    overrideLabelTh: f.overrideLabelTh,
    labelTh: f.labelTh,
  }));

  return { sections, fields };
}

// =============================================================================
// Route 1: GET /admin/template-versions/:id/descriptor
//
// Load descriptor จาก template version
// Fallback: ถ้า descriptor_json = null → return default empty descriptor
// =============================================================================

descriptorRouter.get(
  '/:id/descriptor',
  async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');

    // 1. Verify template version exists
    const found = await findTemplateVersion(db, id);
    if (!found.exists) {
      return c.json({ error: 'Template version not found' }, 404);
    }

    // 2. Load descriptor (reuse service)
    const result = await loadTemplateDescriptor(db, id);

    if (!result.ok) {
      // loadTemplateDescriptor() always returns ok=true (fallback design)
      // This branch is unreachable but kept for type safety
      return c.json({ error: 'Failed to load descriptor' }, 500);
    }

    // 3. Return descriptor + meta
    return c.json({
      data: {
        descriptor: result.descriptor,
        schemaVersion: result.schemaVersion,
        meta: result.meta,
      },
    });
  }
);

// =============================================================================
// Route 2: PUT /admin/template-versions/:id/descriptor
//
// Save descriptor เข้า template version
// Validate: Zod request shape + validateDescriptor()
// Audit: descriptor changes
// =============================================================================

descriptorRouter.put(
  '/:id/descriptor',
  adminOnlyMiddleware,
  auditMiddleware('TEMPLATE_VERSION_DESCRIPTOR'),
  zValidator('json', SaveDescriptorRequestSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const payload = c.req.valid('json');
    const user = c.get('jwtPayload');

    // 1. Verify template version exists
    const found = await findTemplateVersion(db, id);
    if (!found.exists) {
      return c.json({ error: 'Template version not found' }, 404);
    }

    // 2. Save descriptor (reuse service — internal validation pipeline)
    const result = await saveTemplateDescriptor(db, id, payload.descriptor, {
      adminUserId: user.id,
      expectedVersion: payload.expectedSchemaVersion,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'NOT_FOUND':
          return c.json({ error: 'Template version not found' }, 404);
        case 'VALIDATION_FAILED':
          return c.json(
            {
              error: 'Descriptor validation failed',
              issues: result.issues,
            },
            400
          );
        case 'VERSION_MISMATCH':
          return c.json(
            {
              error: 'Version mismatch — descriptor may have been updated',
              detail: result.error,
            },
            409
          );
        case 'DB_ERROR':
        default:
          return c.json(
            {
              error: 'Failed to save descriptor',
              detail: result.error,
            },
            500
          );
      }
    }

    return c.json({
      success: true,
      schemaVersion: result.schemaVersion,
      savedAt: result.savedAt,
    });
  }
);

// =============================================================================
// Route 3: POST /admin/template-versions/:id/descriptor/preview
//
// รับ descriptor (จาก request body) + optional applicationId
// → ถ้าไม่มี applicationId → ใช้ buildPreviewContext() (sample data)
// → ถ้ามี applicationId → ใช้ loadApplicationContext() (real data)
// → renderDescriptorToPreview() → คืน HTML preview
//
// ไม่บันทึก — แค่ preview ดูผลลัพธ์
// =============================================================================

descriptorRouter.post(
  '/:id/descriptor/preview',
  zValidator('json', PreviewDescriptorRequestSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const payload = c.req.valid('json');

    // 1. Verify template version exists
    const found = await findTemplateVersion(db, id);
    if (!found.exists) {
      return c.json({ error: 'Template version not found' }, 404);
    }

    // 2. Build preview context
    //    - ถ้าไม่มี applicationId → ใช้ sample context (backward compatible)
    //    - ถ้ามี applicationId → โหลด real application context
    let ctx;
    if (payload.applicationId) {
      try {
        ctx = await loadApplicationContext(db, payload.applicationId, id);
      } catch (err) {
        if (err instanceof ApplicationContextError) {
          // NOT_FOUND or TEMPLATE_MISMATCH → friendly Thai error
          return c.json({ error: err.message, code: err.code }, 400);
        }
        // Unexpected error
        return c.json(
          { error: 'ไม่สามารถโหลดข้อมูลผู้สมัคร กรุณาลองใหม่หรือกลับไปใช้ข้อมูลตัวอย่าง' },
          500
        );
      }
    } else {
      // Backward compatible: ใช้ sample preview context
      ctx = await buildPreviewContext(db, id);
      if (!ctx) {
        return c.json({ error: 'Failed to build preview context' }, 500);
      }
    }

    // 3. Cast to DocumentDescriptor (zValidator already checked shape basics,
    //    renderDescriptorToPreview will fail gracefully if invalid)
    const descriptor = payload.descriptor as DocumentDescriptor;

    // 4. Render preview (reuse core)
    const preview = renderDescriptorToPreview(
      descriptor,
      ctx,
      payload.options ?? {}
    );

    return c.json({
      data: {
        html: preview.html,
        body: preview.body,
        header: preview.header,
        styles: preview.styles,
        meta: preview.meta,
        mode: preview.mode,
        tokens: preview.tokens,
        page: preview.page,
      },
    });
  }
);

// =============================================================================
// Route 4: POST /admin/template-versions/:id/descriptor/generate
//
// Generate descriptor จาก template version's sections + fields
// → ใช้ generateDescriptorFromTemplate() (pure function)
// → คืน descriptor ใหม่ (ไม่บันทึก)
//
// Frontend สามารถ:
//   - เอาไป preview ทันที
//   - เอาไป edit แล้ว PUT กลับ
// =============================================================================

descriptorRouter.post(
  '/:id/descriptor/generate',
  zValidator('json', GenerateDescriptorRequestSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const payload = c.req.valid('json');

    // 1. Verify template version exists
    const found = await findTemplateVersion(db, id);
    if (!found.exists) {
      return c.json({ error: 'Template version not found' }, 404);
    }

    // 2. Load sections + fields from DB
    const data = await loadSectionsAndFieldsForGenerator(db, id);
    if (!data) {
      return c.json({ error: 'Failed to load template data' }, 500);
    }

    // 3. Generate descriptor (reuse core pure function)
    const result = generateDescriptorFromTemplate({
      sections: data.sections,
      fields: data.fields,
      tableFieldIds: payload.tableFieldIds,
    });

    if (!result.ok) {
      return c.json(
        {
          error: 'Descriptor generation failed',
          issues: result.issues,
        },
        400
      );
    }

    return c.json({
      data: {
        descriptor: result.descriptor,
        meta: result.meta,
      },
    });
  }
);

export default descriptorRouter;
