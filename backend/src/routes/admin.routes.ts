import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { sign } from 'hono/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, ne, isNull, count, or, like, inArray, sql, asc, desc } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/auth.middleware';
import { auditMiddleware } from '../middlewares/audit.middleware';
import { toUnixTimestamp, nowUnix } from '../utils/timestamp';
import { adminUsers, fieldMaster, templates, templateVersions, templateFields, templateSections, recruitmentRounds, applications, applicationAttachments, auditLogs, organizations, jobFamilies, positionLevels, positions, roundSequences } from '../db/schema';
import { LoginRequestSchema, FieldMasterCreateSchema, FieldMasterUpdateSchema, TemplateCreateSchema, TemplateUpdateSchema, TemplateVersionCreateSchema, TemplateVersionUpdateSchema, TemplateSectionCreateSchema, TemplateSectionUpdateSchema, TemplateSectionReorderSchema, TemplateFieldReorderSchema, TemplateFieldSectionAssignSchema, RecruitmentRoundCreateSchema, RecruitmentRoundUpdateSchema, ApplicationStatusUpdateSchema } from '../schemas/validators';
import {
  validateApplicationPattern,
  validateRoundCode,
  DEFAULT_APPLICATION_PATTERN,
} from '../utils/application-pattern';

const adminRoutes = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

adminRoutes.post('/auth/login', zValidator('json', LoginRequestSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = drizzle(c.env.DB);
  const user = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
  
  if (!user || user.passwordHash !== password) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await sign({ id: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 28800 }, c.env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

adminRoutes.use('/*', authMiddleware);

adminRoutes.get('/fields', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(fieldMaster) }));
adminRoutes.post('/fields', adminOnlyMiddleware, auditMiddleware('FIELD_MASTER'), zValidator('json', FieldMasterCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json') as any;
  const id = uuidv4();
  
  const insertValues: any = { id, ...data };
  // Parse defaultOptions to JSON string
  if (data.defaultOptions) {
    insertValues.defaultOptions = JSON.stringify(data.defaultOptions);
  }
  // Parse fileConfig to JSON string
  if (data.fileConfig) {
    insertValues.fileConfig = JSON.stringify(data.fileConfig);
  }
  
  await db.insert(fieldMaster).values(insertValues);
  return c.json({ success: true, id }, 201);
});

adminRoutes.patch('/fields/:id', adminOnlyMiddleware, auditMiddleware('FIELD_MASTER'), zValidator('json', FieldMasterUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json') as any;
  const updateValues: any = { ...data };

  // Parse defaultOptions to JSON string (or null to clear)
  if (data.defaultOptions !== undefined) {
    updateValues.defaultOptions = data.defaultOptions ? JSON.stringify(data.defaultOptions) : null;
  }
  // Parse fileConfig to JSON string (or null to clear)
  if (data.fileConfig !== undefined) {
    updateValues.fileConfig = data.fileConfig ? JSON.stringify(data.fileConfig) : null;
  }
  // Convert empty strings to null for nullable fields
  const nullableStringFields = ['section', 'helpText', 'placeholder', 'validationType', 'validationMessage', 'pdfMappingKey'];
  for (const field of nullableStringFields) {
    if (updateValues[field] === '') {
      updateValues[field] = null;
    }
  }

  await db.update(fieldMaster).set(updateValues).where(eq(fieldMaster.id, id));
  return c.json({ success: true });
});

// Soft delete: ตั้ง isActive=false (ห้าม hard delete เพราะ field อาจถูกใช้ใน template version แล้ว)
adminRoutes.delete('/fields/:id', adminOnlyMiddleware, auditMiddleware('FIELD_MASTER'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  await db.update(fieldMaster).set({ isActive: false }).where(eq(fieldMaster.id, id));
  return c.json({ success: true });
});

// =============================================================================
// FEATURE: Field Delete Impact Analysis
// GET /admin/fields/:id/usage - ตรวจสอบว่า field ถูกใช้งานที่ไหนบ้าง
// =============================================================================
adminRoutes.get('/fields/:id/usage', async (c) => {
  const db = drizzle(c.env.DB);
  const fieldId = c.req.param('id');

  // 1. ตรวจสอบ field มีอยู่จริงหรือไม่
  const field = await db.select().from(fieldMaster).where(eq(fieldMaster.id, fieldId)).get();
  if (!field) {
    return c.json({ error: 'Field not found' }, 404);
  }

  // 2. หา templates ที่ใช้ field นี้ (ผ่าน template_versions)
  const usingTemplateFields = await db
    .select({
      templateFieldId: templateFields.id,
      templateVersionId: templateFields.templateVersionId,
      displayOrder: templateFields.displayOrder,
      isRequired: templateFields.isRequired,
    })
    .from(templateFields)
    .where(eq(templateFields.fieldId, fieldId));

  if (usingTemplateFields.length === 0) {
    return c.json({
      data: {
        fieldId,
        fieldName: field.labelTh,
        isActive: field.isActive,
        canDelete: true,
        usage: {
          templateCount: 0,
          versionCount: 0,
          roundCount: 0,
          templates: [],
          versions: [],
          rounds: [],
        },
        message: 'Field นี้ไม่ถูกใช้งานใน template ใดๆ สามารถลบได้ทันที',
      }
    });
  }

  // 3. หา template versions ที่ใช้ field นี้
  const versionIds = [...new Set(usingTemplateFields.map(f => f.templateVersionId))];
  
  // Fetch all versions and templates at once
  const allVersionsList = await db.select().from(templateVersions);
  const allTemplatesList = await db.select().from(templates);
  
  // 4. หา rounds ที่ใช้ versions เหล่านั้น
  const allRoundsList = await db.select().from(recruitmentRounds);
  const relevantRounds = allRoundsList.filter(r => versionIds.includes(r.templateVersionId));

  // 5. Build response
  const relevantVersions = allVersionsList.filter(v => versionIds.includes(v.id));
  const relevantTemplatesList = [...new Map(
    relevantVersions
      .map(v => allTemplatesList.find(t => t.id === v.templateId))
      .filter((t): t is typeof allTemplatesList[number] => t !== undefined)
      .map(t => [t.id, t])
  ).values()];

  const versionList = relevantVersions.map(v => {
    const tmpl = allTemplatesList.find(t => t.id === v.templateId);
    return {
      id: v.id,
      templateId: v.templateId,
      templateName: tmpl?.name || 'Unknown',
      versionNumber: v.versionNumber,
      status: v.status || 'DRAFT',
    };
  });

  const templateList = relevantTemplatesList.map(t => ({
    id: t.id,
    name: t.name,
  }));

  return c.json({
    data: {
      fieldId,
      fieldName: field.labelTh,
      isActive: field.isActive,
      canDelete: false, // มี usage ต้องแจ้งผู้ใช้ก่อน
      usage: {
        templateCount: templateList.length,
        versionCount: versionList.length,
        roundCount: relevantRounds.length,
        templates: templateList,
        versions: versionList,
        rounds: relevantRounds.map(r => ({
          id: r.id,
          title: r.title,
          status: r.status,
        })),
      },
      message: `Field นี้ถูกใช้งานใน ${templateList.length} template(s), ${versionList.length} version(s), ${relevantRounds.length} round(s) ไม่สามารถลบได้โดยตรง`,
    }
  });
});

adminRoutes.get('/templates', async (c) => {
  const db = drizzle(c.env.DB);
  const view = c.req.query('view') || 'active'; // all | active | archived

  // Filter templates by view
  let filteredTemplates;
  if (view === 'archived') {
    filteredTemplates = await db.select().from(templates).where(sql`${templates.deletedAt} IS NOT NULL`);
  } else if (view === 'all') {
    filteredTemplates = await db.select().from(templates);
  } else {
    filteredTemplates = await db.select().from(templates).where(isNull(templates.deletedAt));
  }

  // Get all versions
  const allVersions = await db.select().from(templateVersions);

  // Get all rounds (including archived) for accurate count
  const allRounds = await db.select().from(recruitmentRounds);

  // Build enriched data
  const enrichedTemplates = filteredTemplates.map(tpl => {
    const tplVersions = allVersions.filter(v => v.templateId === tpl.id);
    const publishedVersion = tplVersions
      .filter(v => v.status === 'PUBLISHED')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];

    // Count rounds (active + archived + total) for UI display
    const versionRounds = publishedVersion
      ? allRounds.filter(r => r.templateVersionId === publishedVersion.id)
      : [];
    const activeRoundsCount = versionRounds.filter(r => !r.deletedAt).length;
    const archivedRoundsCount = versionRounds.filter(r => r.deletedAt).length;
    const totalRoundsCount = versionRounds.length;

    return {
      ...tpl,
      versionCount: tplVersions.length,
      currentVersion: publishedVersion,
      activeRoundsCount,
      archivedRoundsCount,
      totalRoundsCount,
    };
  });

  return c.json({ data: enrichedTemplates });
});
adminRoutes.post('/templates', adminOnlyMiddleware, auditMiddleware('TEMPLATE'), zValidator('json', TemplateCreateSchema), async (c) => {
  const id = uuidv4();
  await drizzle(c.env.DB).insert(templates).values({ id, ...c.req.valid('json') });
  return c.json({ success: true, id }, 201);
});

adminRoutes.patch('/templates/:id', adminOnlyMiddleware, auditMiddleware('TEMPLATE'), zValidator('json', TemplateUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  await db.update(templates).set(data).where(eq(templates.id, id));
  return c.json({ success: true });
});

// =============================================================================
// FEATURE: Archive / Restore / Permanent Delete - Template
// =============================================================================

// PATCH /admin/templates/:id/archive - Soft delete
adminRoutes.patch('/templates/:id/archive', adminOnlyMiddleware, auditMiddleware('TEMPLATE'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const tpl = await db.select().from(templates).where(eq(templates.id, id)).get();
  if (!tpl) {
    return c.json({ error: 'Template not found' }, 404);
  }

  if (tpl.deletedAt) {
    return c.json({ error: 'Template is already archived' }, 400);
  }

  await db.update(templates)
    .set({ deletedAt: new Date() })
    .where(eq(templates.id, id));

  return c.json({ success: true, archivedAt: Math.floor(Date.now() / 1000) });
});

// PATCH /admin/templates/:id/restore - Restore
adminRoutes.patch('/templates/:id/restore', adminOnlyMiddleware, auditMiddleware('TEMPLATE'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const tpl = await db.select().from(templates).where(eq(templates.id, id)).get();
  if (!tpl) {
    return c.json({ error: 'Template not found' }, 404);
  }

  if (!tpl.deletedAt) {
    return c.json({ error: 'Template is not archived' }, 400);
  }

  await db.update(templates)
    .set({ deletedAt: null })
    .where(eq(templates.id, id));

  return c.json({ success: true });
});

// GET /admin/templates/:id/usage - Check round usage (with list of rounds)
adminRoutes.get('/templates/:id/usage', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const tpl = await db.select().from(templates).where(eq(templates.id, id)).get();
  if (!tpl) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Get all version IDs of this template
  const versions = await db.select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, id));
  const versionIds = versions.map(v => v.id);

  // Get all rounds referencing any version of this template
  let rounds: Array<{
    roundId: string;
    roundName: string;
    roundStatus: string;
    deletedAt: Date | null;
  }> = [];

  if (versionIds.length > 0) {
    const allRounds = await db
      .select({
        id: recruitmentRounds.id,
        title: recruitmentRounds.title,
        status: recruitmentRounds.status,
        deletedAt: recruitmentRounds.deletedAt,
      })
      .from(recruitmentRounds)
      .where(inArray(recruitmentRounds.templateVersionId, versionIds));

    rounds = allRounds.map(r => ({
      roundId: r.id,
      roundName: r.title,
      roundStatus: r.status ?? 'DRAFT',
      deletedAt: r.deletedAt ?? null,
    }));
  }

  const activeRounds = rounds.filter(r => r.deletedAt === null).length;
  const archivedRounds = rounds.filter(r => r.deletedAt !== null).length;
  const totalRounds = rounds.length;

  return c.json({
    data: {
      templateId: id,
      name: tpl.name,
      versionCount: versions.length,
      isArchived: !!tpl.deletedAt,
      activeRounds,
      archivedRounds,
      totalRounds,
      roundCount: totalRounds, // backward-compat
      rounds, // full list: [{ roundId, roundName, roundStatus, deletedAt }]
    }
  });
});

// DELETE /admin/templates/:id - Hard delete (admin only, blocked if rounds reference it)
adminRoutes.delete('/templates/:id', adminOnlyMiddleware, auditMiddleware('TEMPLATE'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const tpl = await db.select().from(templates).where(eq(templates.id, id)).get();
  if (!tpl) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Check if any rounds reference versions of this template
  const versions = await db.select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, id));
  const versionIds = versions.map(v => v.id);

  if (versionIds.length > 0) {
    const result = await db
      .select({ count: count() })
      .from(recruitmentRounds)
      .where(inArray(recruitmentRounds.templateVersionId, versionIds))
      .get();
    const roundCount = result?.count || 0;

    if (roundCount > 0) {
      return c.json({
        error: 'ไม่สามารถลบแม่แบบฟอร์มได้ เนื่องจากยังมีรอบรับสมัครที่อ้างอิงแม่แบบนี้อยู่',
        reason: 'PERMANENT_DELETE_BLOCKED',
        roundCount,
        message: `ไม่สามารถลบถาวรได้ เนื่องจากแม่แบบนี้ยังถูกอ้างอิงโดยรอบรับสมัคร ${roundCount} รอบ (จัดเก็บได้ แต่ลบถาวรไม่ได้)`,
      }, 409);
    }
  }

  // Safe to hard delete: cascade will remove versions, sections, fields
  await db.delete(templates).where(eq(templates.id, id));

  return c.json({ success: true, deletedId: id });
});

adminRoutes.get('/templates/:id/versions', async (c) => {
  const data = await drizzle(c.env.DB).select().from(templateVersions).where(eq(templateVersions.templateId, c.req.param('id')));
  return c.json({ data });
});

// =============================================================================
// FEATURE: List Published Template Versions
// GET /admin/template-versions/published
//
// คืน template versions ที่ status = 'PUBLISHED' พร้อม template name
// ใช้สำหรับ dropdown ในหน้า Create/Edit Round (แทนการ fetch /admin/templates + /admin/templates/:id/versions)
// คืนเฉพาะ template ที่ยังไม่ถูก archive (deletedAt IS NULL)
// =============================================================================
adminRoutes.get('/template-versions/published', async (c) => {
  const db = drizzle(c.env.DB);
  const data = await db
    .select({
      id: templateVersions.id,
      versionNumber: templateVersions.versionNumber,
      status: templateVersions.status,
      createdAt: templateVersions.createdAt,
      templateId: templates.id,
      templateName: templates.name,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(and(
      eq(templateVersions.status, 'PUBLISHED'),
      isNull(templates.deletedAt)
    ))
    .orderBy(asc(templates.name), asc(templateVersions.versionNumber));
  return c.json({ data });
});

// =============================================================================
// FEATURE: Template Preview Schema
// GET /admin/templates/:templateId/preview-schema
//
// Returns the form schema for preview without creating a Round.
// Accepts ?versionId=<id> to preview a specific version, or defaults to
// the latest Draft (if exists) or latest Published.
// =============================================================================
adminRoutes.get('/templates/:templateId/preview-schema', async (c) => {
  const db = drizzle(c.env.DB);
  const templateId = c.req.param('templateId');
  const requestedVersionId = c.req.query('versionId');

  // 1. Verify template exists
  const template = await db.select().from(templates).where(eq(templates.id, templateId)).get();
  if (!template) {
    return c.json({ success: false, error: 'ไม่พบ Template' }, 404);
  }

  // 2. Get all versions for this template
  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(templateVersions.versionNumber));

  if (versions.length === 0) {
    return c.json({ success: false, error: 'Template นี้ยังไม่มี Version' }, 404);
  }

  // 3. Determine which version to preview
  let targetVersion: typeof versions[0] | null = null;

  if (requestedVersionId) {
    targetVersion = versions.find(v => v.id === requestedVersionId) || null;
    if (!targetVersion) {
      return c.json({ success: false, error: 'ไม่พบ Version ที่ระบุ' }, 404);
    }
  } else {
    // Default: Draft > Published
    const draftVersions = versions.filter(v => v.status === 'DRAFT');
    const publishedVersions = versions.filter(v => v.status === 'PUBLISHED');
    const archivedVersions = versions.filter(v => v.status === 'ARCHIVED');

    if (draftVersions.length > 0) {
      targetVersion = draftVersions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
    } else if (publishedVersions.length > 0) {
      targetVersion = publishedVersions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
    } else if (archivedVersions.length > 0) {
      targetVersion = archivedVersions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
    }
  }

  // 4. Fetch sections
  const sections = await db
    .select()
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, targetVersion!.id))
    .orderBy(asc(templateSections.displayOrder));

  // 5. Fetch fields with fieldMaster join
  const schema = await db
    .select({
      fieldId: templateFields.fieldId,
      sectionId: templateFields.sectionId,
      type: fieldMaster.fieldType,
      label: fieldMaster.labelTh,
      overrideLabel: templateFields.overrideLabelTh,
      options: fieldMaster.defaultOptions,
      overrideOptions: templateFields.overrideOptions,
      isRequired: templateFields.isRequired,
      helpText: sql`COALESCE(${templateFields.helpText}, ${fieldMaster.helpText})`,
      placeholder: sql`COALESCE(${templateFields.placeholder}, ${fieldMaster.placeholder})`,
      validationMessage: sql`COALESCE(${templateFields.validationMessage}, ${fieldMaster.validationMessage})`,
      section: fieldMaster.section,
      fileConfig: fieldMaster.fileConfig,
      validationType: fieldMaster.validationType,
      order: templateFields.displayOrder,
      // Sprint 4: Additional fields
      rows: templateFields.rows,
      minLength: templateFields.minLength,
      maxLength: templateFields.maxLength,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, targetVersion!.id))
    .orderBy(templateFields.displayOrder);

  // 6. Normalize MASTER_DATA fields
  const normalized = schema.map((f) => {
    if (f.type !== 'MASTER_DATA') return { ...f, masterDataSource: null };

    const raw: unknown = f.options;
    let source: string | null = null;

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          source = (parsed as { source?: string }).source ?? null;
        }
      } catch {
        source = null;
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      source = (raw as { source?: string }).source ?? null;
    }

    return { ...f, options: null, masterDataSource: source };
  });

  // 7. Build available versions list (for UI tabs)
  const availableVersions = versions.map(v => ({
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    createdAt: v.createdAt,
  }));

  return c.json({
    success: true,
    isPreview: true,
    data: {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
      },
      version: {
        id: targetVersion!.id,
        versionNumber: targetVersion!.versionNumber,
        status: targetVersion!.status,
      },
      sections: sections.filter(s => s.isActive),
      fields: normalized,
      availableVersions,
    },
  });
});

// GET /admin/template-fields/:versionId - Get fields for a specific template version
adminRoutes.get('/template-fields/:versionId', async (c) => {
  const db = drizzle(c.env.DB);
  const versionId = c.req.param('versionId');

  const fields = await db.select({
    id: templateFields.id,
    fieldId: templateFields.fieldId,
    sectionId: templateFields.sectionId,
    displayOrder: templateFields.displayOrder,
    isRequired: templateFields.isRequired,
    overrideLabelTh: templateFields.overrideLabelTh,
    overrideOptions: templateFields.overrideOptions,
    // Effective values (override ?? master) — used by Template Builder
    helpText: sql`COALESCE(${templateFields.helpText}, ${fieldMaster.helpText})`,
    placeholder: sql`COALESCE(${templateFields.placeholder}, ${fieldMaster.placeholder})`,
    validationMessage: sql`COALESCE(${templateFields.validationMessage}, ${fieldMaster.validationMessage})`,
    validationRules: templateFields.validationRules,
    // Raw override values (so Builder can detect "differs from master")
    helpTextOverride: templateFields.helpText,
    placeholderOverride: templateFields.placeholder,
    validationMessageOverride: templateFields.validationMessage,
    // Master values (for Builder to compare)
    helpTextMaster: fieldMaster.helpText,
    placeholderMaster: fieldMaster.placeholder,
    validationMessageMaster: fieldMaster.validationMessage,
    validationType: fieldMaster.validationType,
    // Rich Field Metadata
    rows: templateFields.rows,
    minLength: templateFields.minLength,
    maxLength: templateFields.maxLength,
    // Get label from fieldMaster, fallback to overrideLabelTh if set
    labelTh: sql<string>`COALESCE(${templateFields.overrideLabelTh}, ${fieldMaster.labelTh})`,
  } as any)
  .from(templateFields)
  .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
  .where(eq(templateFields.templateVersionId, versionId))
  .orderBy(templateFields.displayOrder);

  return c.json({ data: fields });
});

// Create new version as DRAFT (not PUBLISHED)
// Sprint 4: Supports THREE modes:
//   Mode A (Editor): payload has sections[] + fields[] (with sectionId as tempId)
//   Mode B (Clone): payload has cloneFromVersionId (clone sections+fields from source)
//   Mode C (Legacy): payload has only fields[] — auto-create default section "ข้อมูลทั่วไป"
adminRoutes.post('/templates/:id/versions', adminOnlyMiddleware, auditMiddleware('TEMPLATE_VERSION'), zValidator('json', TemplateVersionCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const payload = c.req.valid('json') as any;
  const versionId = uuidv4();

  const currentVersions = await db.select({ v: templateVersions.versionNumber }).from(templateVersions).where(eq(templateVersions.templateId, payload.templateId));
  const nextVer = currentVersions.length > 0 ? Math.max(...currentVersions.map(x => x.v)) + 1 : 1;

  // Insert version as DRAFT (user must publish manually)
  await db.insert(templateVersions).values({
    id: versionId,
    templateId: payload.templateId,
    versionNumber: nextVer,
    status: 'DRAFT'
  });

  // Map from source sectionId (tempId or original uuid) -> new sectionId (uuid)
  const sectionIdMap = new Map<string, string>();

  if (payload.cloneFromVersionId) {
    // === Mode B: Clone from source version ===
    const srcVersionId = payload.cloneFromVersionId;

    // Verify source version exists
    const srcVersion = await db.select().from(templateVersions)
      .where(eq(templateVersions.id, srcVersionId)).get();
    if (!srcVersion) {
      return c.json({ error: 'Source version not found' }, 404);
    }

    // Clone sections (skip is_active=false)
    const srcSections = await db.select().from(templateSections)
      .where(eq(templateSections.templateVersionId, srcVersionId))
      .orderBy(asc(templateSections.displayOrder));

    for (const src of srcSections.filter(s => s.isActive)) {
      const newSectionId = uuidv4();
      sectionIdMap.set(src.id, newSectionId);
      await db.insert(templateSections).values({
        id: newSectionId,
        templateVersionId: versionId,
        name: src.name,
        displayOrder: src.displayOrder,
        isActive: true,
        createdAt: sql`(unixepoch())`,
        updatedAt: sql`(unixepoch())`,
      });
    }

    // Clone fields (remap sectionId)
    const srcFields = await db.select().from(templateFields)
      .where(eq(templateFields.templateVersionId, srcVersionId))
      .orderBy(asc(templateFields.displayOrder));

    for (const f of srcFields) {
      const newSectionId = f.sectionId ? sectionIdMap.get(f.sectionId) : null;
      await db.insert(templateFields).values({
        id: uuidv4(),
        templateVersionId: versionId,
        fieldId: f.fieldId,
        sectionId: newSectionId ?? null,
        displayOrder: f.displayOrder,
        isRequired: f.isRequired,
        overrideOptions: f.overrideOptions,
        overrideLabelTh: f.overrideLabelTh,
        helpText: f.helpText,
        placeholder: f.placeholder,
        validationRules: f.validationRules,
        rows: f.rows,
        minLength: f.minLength,
        maxLength: f.maxLength,
      } as any);
    }
  } else if (payload.sections && payload.sections.length > 0) {
    // === Mode A: Editor (sections + fields from payload) ===
    for (const s of payload.sections) {
      const newSectionId = uuidv4();
      sectionIdMap.set(s.tempId, newSectionId);
      await db.insert(templateSections).values({
        id: newSectionId,
        templateVersionId: versionId,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
        createdAt: sql`(unixepoch())`,
        updatedAt: sql`(unixepoch())`,
      });
    }

    // Insert each field (remap sectionId tempId -> real uuid)
    for (const f of payload.fields) {
      const realSectionId = f.sectionId ? (sectionIdMap.get(f.sectionId) ?? null) : null;
      const fieldValues: any = {
        id: uuidv4(),
        templateVersionId: versionId,
        fieldId: f.fieldId,
        sectionId: realSectionId,
        displayOrder: f.displayOrder,
        isRequired: f.isRequired ?? true,
        // Defensive normalization: undefined / "" / [] => null
        overrideOptions:
          Array.isArray(f.overrideOptions) && f.overrideOptions.length > 0
            ? JSON.stringify(f.overrideOptions)
            : null,
        overrideLabelTh: (typeof f.overrideLabelTh === 'string' && f.overrideLabelTh.trim().length > 0)
          ? f.overrideLabelTh.trim()
          : null,
        helpText: (typeof f.helpText === 'string' && f.helpText.trim().length > 0)
          ? f.helpText.trim()
          : null,
        placeholder: (typeof f.placeholder === 'string' && f.placeholder.trim().length > 0)
          ? f.placeholder.trim()
          : null,
        validationMessage: (typeof f.validationMessage === 'string' && f.validationMessage.trim().length > 0)
          ? f.validationMessage.trim()
          : null,
        validationRules:
          f.validationRules && typeof f.validationRules === 'object' && Object.keys(f.validationRules).length > 0
            ? JSON.stringify(f.validationRules)
            : null,
        rows: Number.isFinite(f.rows) && f.rows !== null ? Number(f.rows) : null,
        minLength: Number.isFinite(f.minLength) && f.minLength !== null ? Number(f.minLength) : null,
        maxLength: Number.isFinite(f.maxLength) && f.maxLength !== null ? Number(f.maxLength) : null,
      };

      await db.insert(templateFields).values(fieldValues as any);
    }
  } else {
    // === Mode C: Legacy (fields only) — auto-create default section ===
    const defaultSectionId = uuidv4();
    await db.insert(templateSections).values({
      id: defaultSectionId,
      templateVersionId: versionId,
      name: 'ข้อมูลทั่วไป',
      displayOrder: 1,
      isActive: true,
      createdAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    });

    // Insert each field assigned to default section
    for (const f of payload.fields) {
      const fieldValues: any = {
        id: uuidv4(),
        templateVersionId: versionId,
        fieldId: f.fieldId,
        sectionId: defaultSectionId, // assign to default section
        displayOrder: f.displayOrder,
        isRequired: f.isRequired ?? true,
        // Defensive normalization: undefined / "" / [] => null
        overrideOptions:
          Array.isArray(f.overrideOptions) && f.overrideOptions.length > 0
            ? JSON.stringify(f.overrideOptions)
            : null,
        overrideLabelTh: (typeof f.overrideLabelTh === 'string' && f.overrideLabelTh.trim().length > 0)
          ? f.overrideLabelTh.trim()
          : null,
        helpText: (typeof f.helpText === 'string' && f.helpText.trim().length > 0)
          ? f.helpText.trim()
          : null,
        placeholder: (typeof f.placeholder === 'string' && f.placeholder.trim().length > 0)
          ? f.placeholder.trim()
          : null,
        validationMessage: (typeof f.validationMessage === 'string' && f.validationMessage.trim().length > 0)
          ? f.validationMessage.trim()
          : null,
        validationRules:
          f.validationRules && typeof f.validationRules === 'object' && Object.keys(f.validationRules).length > 0
            ? JSON.stringify(f.validationRules)
            : null,
        rows: Number.isFinite(f.rows) && f.rows !== null ? Number(f.rows) : null,
        minLength: Number.isFinite(f.minLength) && f.minLength !== null ? Number(f.minLength) : null,
        maxLength: Number.isFinite(f.maxLength) && f.maxLength !== null ? Number(f.maxLength) : null,
      };

      await db.insert(templateFields).values(fieldValues as any);
    }
  }

  return c.json({ success: true, versionId }, 201);
});

// =============================================================================
// Sprint 4 - Template Version Update API (Phase 1)
// PUT /admin/template-versions/:versionId - UPDATE Draft เดิม (ไม่สร้าง Version ใหม่)
// =============================================================================
adminRoutes.put('/template-versions/:versionId', adminOnlyMiddleware,
  auditMiddleware('TEMPLATE_VERSION'),
  zValidator('json', TemplateVersionUpdateSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const versionId = c.req.param('versionId');
    const payload = c.req.valid('json') as any;

    // 1. Verify version exists
    const version = await db.select()
      .from(templateVersions)
      .where(eq(templateVersions.id, versionId))
      .get();
    
    if (!version) {
      return c.json({ error: 'Version not found' }, 404);
    }

    // 2. Validate: เฉพาะ DRAFT เท่านั้นที่อัปเดตได้
    if (version.status !== 'DRAFT') {
      return c.json({ 
        error: `Can only update DRAFT version. Current status: ${version.status}` 
      }, 400);
    }

    // 3. Atomic rebuild of fields+sections via D1 batch.
    // ⚠️ Schema note: templateFields.sectionId uses ON DELETE SET NULL (not CASCADE),
    // so deleting sections first would leave orphan field rows behind and cause duplicates
    // on the next save. Always delete FIELDS first, then sections, then INSERT sections,
    // then INSERT fields — all in one D1 batch so we either get a consistent new state
    // or D1 aborts before any statement runs.
    // Note: D1 does not support SQL BEGIN/COMMIT (transaction()), so we use db.batch().
    const sectionIdMap = new Map<string, string>();
    for (const s of payload.sections) {
      sectionIdMap.set(s.tempId, uuidv4());
    }

    const stmts: any[] = [
      // 3a. Delete fields first (children of sections via SET NULL)
      db.delete(templateFields)
        .where(eq(templateFields.templateVersionId, versionId)),
      // 3b. Then delete sections (no remaining FK references after fields are gone)
      db.delete(templateSections)
        .where(eq(templateSections.templateVersionId, versionId)),
      // 3c. Insert new sections
      ...payload.sections.map((s: any) =>
        db.insert(templateSections).values({
          id: sectionIdMap.get(s.tempId)!,
          templateVersionId: versionId,
          name: s.name,
          displayOrder: s.displayOrder,
          isActive: true,
          createdAt: sql`(unixepoch())`,
          updatedAt: sql`(unixepoch())`,
        })
      ),
      // 3d. Insert new fields with remapped sectionId
      ...payload.fields.map((f: any) => {
        const realSectionId = f.sectionId ? (sectionIdMap.get(f.sectionId) ?? null) : null;
        const fieldValues: any = {
          id: uuidv4(),
          templateVersionId: versionId,
          fieldId: f.fieldId,
          sectionId: realSectionId,
          displayOrder: f.displayOrder,
          isRequired: f.isRequired ?? true,
          // Defensive normalization: undefined / "" / [] => null
          overrideOptions:
            Array.isArray(f.overrideOptions) && f.overrideOptions.length > 0
              ? JSON.stringify(f.overrideOptions)
              : null,
          overrideLabelTh: (typeof f.overrideLabelTh === 'string' && f.overrideLabelTh.trim().length > 0)
            ? f.overrideLabelTh.trim()
            : null,
          helpText: (typeof f.helpText === 'string' && f.helpText.trim().length > 0)
            ? f.helpText.trim()
            : null,
          placeholder: (typeof f.placeholder === 'string' && f.placeholder.trim().length > 0)
            ? f.placeholder.trim()
            : null,
          validationMessage: (typeof f.validationMessage === 'string' && f.validationMessage.trim().length > 0)
            ? f.validationMessage.trim()
            : null,
          validationRules:
            f.validationRules && typeof f.validationRules === 'object' && Object.keys(f.validationRules).length > 0
              ? JSON.stringify(f.validationRules)
              : null,
          rows: Number.isFinite(f.rows) && f.rows !== null ? Number(f.rows) : null,
          minLength: Number.isFinite(f.minLength) && f.minLength !== null ? Number(f.minLength) : null,
          maxLength: Number.isFinite(f.maxLength) && f.maxLength !== null ? Number(f.maxLength) : null,
        };
        return db.insert(templateFields).values(fieldValues as any);
      }),
    ];

    await (db.batch as any)(stmts);

    return c.json({
      success: true,
      versionId,
      versionNumber: version.versionNumber,
      message: 'Draft updated successfully'
    });
  }
);

// =============================================================================
// Sprint 4 - Template Sections API
// =============================================================================

// GET /admin/template-sections/:versionId - List sections in a version (ordered)
adminRoutes.get('/template-sections/:versionId', async (c) => {
  const db = drizzle(c.env.DB);
  const versionId = c.req.param('versionId');
  const sections = await db.select().from(templateSections)
    .where(eq(templateSections.templateVersionId, versionId))
    .orderBy(asc(templateSections.displayOrder));
  return c.json({ data: sections });
});

// POST /admin/template-sections - Create new section
adminRoutes.post('/template-sections', adminOnlyMiddleware, auditMiddleware('TEMPLATE_SECTION'), zValidator('json', TemplateSectionCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const payload = c.req.valid('json') as any;

  // Verify version exists and is DRAFT
  const version = await db.select().from(templateVersions)
    .where(eq(templateVersions.id, payload.templateVersionId)).get();
  if (!version) return c.json({ error: 'Version not found' }, 404);
  if (version.status !== 'DRAFT') {
    return c.json({ error: 'Can only create sections in DRAFT version' }, 400);
  }

  const newId = uuidv4();
  try {
    await db.insert(templateSections).values({
      id: newId,
      templateVersionId: payload.templateVersionId,
      name: payload.name,
      displayOrder: payload.displayOrder,
      isActive: true,
      createdAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    });
  } catch (err) {
    return c.json({ error: 'Create failed (displayOrder conflict?): ' + (err as Error).message }, 400);
  }
  return c.json({ success: true, id: newId }, 201);
});

// PUT /admin/template-sections/:id - Update name/displayOrder/isActive
adminRoutes.put('/template-sections/:id', adminOnlyMiddleware, auditMiddleware('TEMPLATE_SECTION'), zValidator('json', TemplateSectionUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const payload = c.req.valid('json') as any;

  // Verify section exists
  const section = await db.select().from(templateSections)
    .where(eq(templateSections.id, id)).get();
  if (!section) return c.json({ error: 'Section not found' }, 404);

  // Verify version is DRAFT
  const version = await db.select().from(templateVersions)
    .where(eq(templateVersions.id, section.templateVersionId)).get();
  if (version?.status !== 'DRAFT') {
    return c.json({ error: 'Can only update sections in DRAFT version' }, 400);
  }

  const updates: any = { updatedAt: sql`(unixepoch())` };
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.displayOrder !== undefined) updates.displayOrder = payload.displayOrder;
  if (payload.isActive !== undefined) updates.isActive = payload.isActive;

  try {
    await db.update(templateSections).set(updates).where(eq(templateSections.id, id));
  } catch (err) {
    return c.json({ error: 'Update failed: ' + (err as Error).message }, 400);
  }
  return c.json({ success: true });
});

// DELETE /admin/template-sections/:id - Soft delete (isActive=false)
adminRoutes.delete('/template-sections/:id', adminOnlyMiddleware, auditMiddleware('TEMPLATE_SECTION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const section = await db.select().from(templateSections)
    .where(eq(templateSections.id, id)).get();
  if (!section) return c.json({ error: 'Section not found' }, 404);

  const version = await db.select().from(templateVersions)
    .where(eq(templateVersions.id, section.templateVersionId)).get();
  if (version?.status !== 'DRAFT') {
    return c.json({ error: 'Can only delete sections in DRAFT version' }, 400);
  }

  // Soft delete: isActive=false. fields.section_id will become NULL (ON DELETE SET NULL is for hard delete,
  // but soft delete keeps the FK. We need to manually null section_id for fields in this section.)
  await (db.batch as any)([
    db.update(templateFields).set({ sectionId: null }).where(eq(templateFields.sectionId, id)),
    db.update(templateSections).set({ isActive: false, updatedAt: sql`(unixepoch())` }).where(eq(templateSections.id, id)),
  ]);

  return c.json({ success: true });
});

// PATCH /admin/template-sections/:id/toggle - Toggle isActive
adminRoutes.patch('/template-sections/:id/toggle', adminOnlyMiddleware, auditMiddleware('TEMPLATE_SECTION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const section = await db.select().from(templateSections)
    .where(eq(templateSections.id, id)).get();
  if (!section) return c.json({ error: 'Section not found' }, 404);

  await db.update(templateSections)
    .set({ isActive: !section.isActive, updatedAt: sql`(unixepoch())` })
    .where(eq(templateSections.id, id));

  return c.json({ success: true, isActive: !section.isActive });
});

// PATCH /admin/template-sections/reorder - Bulk reorder sections
// Sprint 4: ใช้ negative displayOrder trick เพื่อหลีกเลี่ยง unique constraint conflict
adminRoutes.patch('/template-sections/reorder', adminOnlyMiddleware, auditMiddleware('TEMPLATE_SECTION'), zValidator('json', TemplateSectionReorderSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const { items } = c.req.valid('json') as any;

  if (!items || items.length === 0) {
    return c.json({ error: 'items is required' }, 400);
  }

  // Validate: no duplicate displayOrder in payload
  const orders = items.map((i: any) => i.displayOrder);
  if (new Set(orders).size !== orders.length) {
    return c.json({ error: 'displayOrder must be unique' }, 400);
  }
  // Validate: sequential 1, 2, 3, ...
  const sorted = [...orders].sort((a: number, b: number) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      return c.json({ error: 'displayOrder must be sequential (1, 2, 3, ...)' }, 400);
    }
  }

  // Verify all sections exist and belong to the same version
  const ids = items.map((i: any) => i.id);
  const sections = await db.select().from(templateSections).where(inArray(templateSections.id, ids));
  if (sections.length !== items.length) {
    return c.json({ error: 'Some sections not found' }, 404);
  }
  const versionIds = new Set(sections.map(s => s.templateVersionId));
  if (versionIds.size > 1) {
    return c.json({ error: 'All sections must belong to the same version' }, 400);
  }

  const versionId = sections[0].templateVersionId;
  // Verify DRAFT
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId)).get();
  if (version?.status !== 'DRAFT') {
    return c.json({ error: 'Can only reorder sections in DRAFT version' }, 400);
  }

  // Step 1: Move all sections in version to negative (avoid unique conflict)
  const allSections = await db.select().from(templateSections)
    .where(eq(templateSections.templateVersionId, versionId));
  const negUpdates = allSections.map(s =>
    db.update(templateSections)
      .set({ displayOrder: -s.displayOrder, updatedAt: sql`(unixepoch())` })
      .where(eq(templateSections.id, s.id))
  );
  await (db.batch as any)(negUpdates);

  // Step 2: Apply new orders
  const newOrderUpdates = items.map((item: any) =>
    db.update(templateSections)
      .set({ displayOrder: item.displayOrder, updatedAt: sql`(unixepoch())` })
      .where(eq(templateSections.id, item.id))
  );
  await (db.batch as any)(newOrderUpdates);

  return c.json({ success: true });
});

// PATCH /admin/template-fields/reorder - Bulk reorder fields (with optional section change)
adminRoutes.patch('/template-fields/reorder', adminOnlyMiddleware, auditMiddleware('TEMPLATE_FIELD'), zValidator('json', TemplateFieldReorderSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const { items } = c.req.valid('json') as any;

  if (!items || items.length === 0) {
    return c.json({ error: 'items is required' }, 400);
  }

  // Validate: no duplicate displayOrder in payload
  const orders = items.map((i: any) => i.displayOrder);
  if (new Set(orders).size !== orders.length) {
    return c.json({ error: 'displayOrder must be unique' }, 400);
  }

  // Verify all fields exist and belong to the same version
  const ids = items.map((i: any) => i.id);
  const fields = await db.select().from(templateFields).where(inArray(templateFields.id, ids));
  if (fields.length !== items.length) {
    return c.json({ error: 'Some fields not found' }, 404);
  }
  const versionIds = new Set(fields.map(f => f.templateVersionId));
  if (versionIds.size > 1) {
    return c.json({ error: 'All fields must belong to the same version' }, 400);
  }

  const versionId = fields[0].templateVersionId;
  // Verify DRAFT
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId)).get();
  if (version?.status !== 'DRAFT') {
    return c.json({ error: 'Can only reorder fields in DRAFT version' }, 400);
  }

  // Step 1: Move all fields in version to negative (avoid unique conflict on displayOrder)
  const allFields = await db.select().from(templateFields)
    .where(eq(templateFields.templateVersionId, versionId));
  const negUpdates = allFields.map(f =>
    db.update(templateFields)
      .set({ displayOrder: -f.displayOrder })
      .where(eq(templateFields.id, f.id))
  );
  await (db.batch as any)(negUpdates);

  // Step 2: Apply new orders + section assignment
  const updates = items.map((item: any) =>
    db.update(templateFields)
      .set({
        displayOrder: item.displayOrder,
        sectionId: item.sectionId === undefined ? undefined : item.sectionId,
      })
      .where(eq(templateFields.id, item.id))
  );
  await (db.batch as any)(updates);

  return c.json({ success: true });
});

// PUT /admin/template-fields/:id/section - Assign field to section
adminRoutes.put('/template-fields/:id/section', adminOnlyMiddleware, auditMiddleware('TEMPLATE_FIELD'), zValidator('json', TemplateFieldSectionAssignSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const { sectionId } = c.req.valid('json') as any;

  const field = await db.select().from(templateFields).where(eq(templateFields.id, id)).get();
  if (!field) return c.json({ error: 'Field not found' }, 404);

  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, field.templateVersionId)).get();
  if (version?.status !== 'DRAFT') {
    return c.json({ error: 'Can only update field in DRAFT version' }, 400);
  }

  // If sectionId provided, verify it exists
  if (sectionId) {
    const section = await db.select().from(templateSections).where(eq(templateSections.id, sectionId)).get();
    if (!section) return c.json({ error: 'Section not found' }, 404);
    if (section.templateVersionId !== field.templateVersionId) {
      return c.json({ error: 'Section does not belong to field version' }, 400);
    }
  }

  await db.update(templateFields).set({ sectionId }).where(eq(templateFields.id, id));
  return c.json({ success: true });
});

// PATCH /admin/template-versions/:id/publish - DRAFT → PUBLISHED
// RFC Policy: Only 1 Published version at a time. Old Published → Auto Archive
adminRoutes.patch('/template-versions/:id/publish', adminOnlyMiddleware, auditMiddleware('TEMPLATE_VERSION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  
  // Get current version
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, id)).get();
  if (!version) {
    return c.json({ error: 'Version not found' }, 404);
  }
  
  if (version.status !== 'DRAFT') {
    return c.json({ error: 'Only DRAFT version can be published' }, 400);
  }
  
  // RFC Policy: Auto-archive old Published version
  // Find current Published version for this template
  const currentPublished = await db.select().from(templateVersions)
    .where(and(
      eq(templateVersions.templateId, version.templateId),
      eq(templateVersions.status, 'PUBLISHED')
    )).get();

  // Set new version as PUBLISHED
  await db.update(templateVersions)
    .set({ status: 'PUBLISHED' })
    .where(eq(templateVersions.id, id));

  // If there's an existing Published version, archive it
  if (currentPublished) {
    await db.update(templateVersions)
      .set({ status: 'ARCHIVED' })
      .where(eq(templateVersions.id, currentPublished.id));
  }
  
  return c.json({ 
    success: true,
    previousPublishedArchived: !!currentPublished,
    previousPublishedId: currentPublished?.id || null
  });
});

// PATCH /admin/template-versions/:id/archive - PUBLISHED → ARCHIVED
adminRoutes.patch('/template-versions/:id/archive', adminOnlyMiddleware, auditMiddleware('TEMPLATE_VERSION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  
  // Get current version
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, id)).get();
  if (!version) {
    return c.json({ error: 'Version not found' }, 404);
  }
  
  if (version.status !== 'PUBLISHED') {
    return c.json({ error: 'Only PUBLISHED version can be archived' }, 400);
  }
  
  // RFC Policy: Cannot archive if any rounds reference this version (snapshot)
  const roundsUsing = await db.select()
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.templateVersionId, id));
  
  if (roundsUsing.length > 0) {
    return c.json({ 
      error: 'Cannot archive version that is referenced by rounds (snapshot policy)',
      roundsCount: roundsUsing.length
    }, 400);
  }
  
  await db.update(templateVersions).set({ status: 'ARCHIVED' }).where(eq(templateVersions.id, id));
  return c.json({ success: true });
});

// DELETE /admin/template-versions/:id - Delete DRAFT version only
adminRoutes.delete('/template-versions/:id', adminOnlyMiddleware, auditMiddleware('TEMPLATE_VERSION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  
  // Get current version
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, id)).get();
  if (!version) {
    return c.json({ error: 'Version not found' }, 404);
  }
  
  // RFC Policy: Only DRAFT can be deleted
  if (version.status !== 'DRAFT') {
    return c.json({ error: 'Only DRAFT version can be deleted', status: version.status }, 400);
  }
  
  // Check if any rounds are using this version
  const roundsUsing = await db.select()
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.templateVersionId, id));
  
  if (roundsUsing.length > 0) {
    return c.json({ error: 'Cannot delete version that is used by rounds', roundsCount: roundsUsing.length }, 400);
  }
  
  // Delete version (templateFields will cascade delete)
  await db.delete(templateVersions).where(eq(templateVersions.id, id));
  return c.json({ success: true });
});

adminRoutes.get('/rounds', async (c) => {
  const db = drizzle(c.env.DB);
  const view = c.req.query('view') || 'active'; // all | active | archived

  let whereClause;
  if (view === 'archived') {
    whereClause = sql`${recruitmentRounds.deletedAt} IS NOT NULL`;
  } else if (view === 'all') {
    // No filter - return both
    whereClause = sql`1=1`;
  } else {
    whereClause = isNull(recruitmentRounds.deletedAt);
  }

  // JOIN template_versions + templates เพื่อส่งชื่อ template/version กลับมา
  // ใช้ LEFT JOIN เพื่อรองรับกรณี template version ถูก archive/ลบ (ป้องกัน row หาย)
  const data = await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      positionLevel: recruitmentRounds.positionLevel,
      templateVersionId: recruitmentRounds.templateVersionId,
      templateId: templateVersions.templateId,
      templateName: templates.name,
      versionNumber: templateVersions.versionNumber,
      versionStatus: templateVersions.status,
      openDate: recruitmentRounds.openDate,
      closeDate: recruitmentRounds.closeDate,
      status: recruitmentRounds.status,
      createdAt: recruitmentRounds.createdAt,
      deletedAt: recruitmentRounds.deletedAt,
      announcementTitle: recruitmentRounds.announcementTitle,
      announcementDescription: recruitmentRounds.announcementDescription,
      contactInformation: recruitmentRounds.contactInformation,
      remark: recruitmentRounds.remark,
      // Migration 019 - Application Number Pattern
      applicationPattern: recruitmentRounds.applicationPattern,
      roundCode: recruitmentRounds.roundCode,
    })
    .from(recruitmentRounds)
    .leftJoin(templateVersions, eq(templateVersions.id, recruitmentRounds.templateVersionId))
    .leftJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(whereClause);

  return c.json({ data });
});
adminRoutes.post('/rounds', adminOnlyMiddleware, auditMiddleware('RECRUITMENT_ROUND'), zValidator('json', RecruitmentRoundCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json') as any;
  const id = uuidv4();

  // Migration 019 - Validate application_pattern
  // ถ้าส่งมา: validate
  // ถ้าไม่ส่ง: ใช้ default pattern
  // ถ้าส่ง null explicit: เก็บ null (ใช้ format เดิม APP-YYYY-NNNN)
  let applicationPattern: string | null;
  if (data.applicationPattern === undefined) {
    // ไม่ได้ส่ง field มา → ใช้ default
    applicationPattern = DEFAULT_APPLICATION_PATTERN;
  } else if (data.applicationPattern === null) {
    // ส่ง null explicit → ใช้ format เดิม
    applicationPattern = null;
  } else {
    // ส่ง string → validate
    const validation = validateApplicationPattern(data.applicationPattern);
    if (!validation.valid) {
      return c.json({
        error: 'รูปแบบเลขที่ใบสมัครไม่ถูกต้อง',
        reason: 'INVALID_PATTERN',
        details: validation.error,
        field: validation.errorField,
      }, 400);
    }
    applicationPattern = data.applicationPattern;
  }

  // Migration 019 - Validate round_code (required)
  const roundCodeResult = validateRoundCode(data.roundCode);
  if (!roundCodeResult.valid) {
    return c.json({
      error: 'รหัสรอบไม่ถูกต้อง',
      reason: 'INVALID_ROUND_CODE',
      details: roundCodeResult.error,
      field: 'roundCode',
    }, 400);
  }
  const roundCode = roundCodeResult.normalized;

  // ตรวจ unique: round_code ซ้ำ (active + draft ในปีเดียวกัน)
  const year = new Date(data.openDate * 1000).getUTCFullYear();
  const conflict = await db
    .select({ id: recruitmentRounds.id, openDate: recruitmentRounds.openDate })
    .from(recruitmentRounds)
    .where(
      and(
        eq(recruitmentRounds.roundCode, roundCode),
        isNull(recruitmentRounds.deletedAt),
      ),
    )
    .get();
  if (conflict) {
    const conflictYear = new Date(conflict.openDate as any).getUTCFullYear();
    if (conflictYear === year) {
      return c.json({
        error: `รหัสรอบ "${roundCode}" ปี ${year + 543} ถูกใช้แล้ว`,
        reason: 'ROUND_CODE_CONFLICT',
        existingRoundId: conflict.id,
      }, 409);
    }
  }

  await db.insert(recruitmentRounds).values({
    id,
    templateVersionId: data.templateVersionId,
    title: data.title,
    positionLevel: data.positionLevel,
    openDate: new Date(data.openDate * 1000), // Convert Unix timestamp to Date
    closeDate: new Date(data.closeDate * 1000), // Convert Unix timestamp to Date
    status: data.status,
    // Form Header / Announcement
    announcementTitle: data.announcementTitle || null,
    announcementDescription: data.announcementDescription || null,
    contactInformation: data.contactInformation || null,
    remark: data.remark || null,
    // Migration 019
    applicationPattern,
    roundCode,
  });
  return c.json({ success: true, id }, 201);
});

// PATCH round: แก้ได้เฉพาะ metadata เท่านั้น (title, positionLevel, openDate, closeDate, status)
// ห้ามเปลี่ยน templateVersionId ทุกสถานะ (DRAFT, ACTIVE, CLOSED)
adminRoutes.patch('/rounds/:id', adminOnlyMiddleware, auditMiddleware('RECRUITMENT_ROUND'), zValidator('json', RecruitmentRoundUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json') as any;

  // Get current round
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, id)).get();
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }

  // Block templateVersionId change for ACTIVE and CLOSED rounds only
  // DRAFT round: can change version
  if (data.templateVersionId !== undefined && data.templateVersionId !== round.templateVersionId) {
    if (round.status !== 'DRAFT') {
      return c.json({ error: 'Cannot change template version after round creation', currentStatus: round.status }, 400);
    }
  }

  // ========================================================================
  // Migration 019 - Lock application_pattern เมื่อมี application
  // round_code ล็อกเสมอ (Business Data) — ห้ามเปลี่ยนเมื่อมี application
  // ========================================================================
  const appCountResult = await db
    .select({ count: count() })
    .from(applications)
    .where(and(eq(applications.roundId, id), isNull(applications.deletedAt)))
    .get();
  const hasApplications = (appCountResult?.count ?? 0) > 0;

  // Lock check: ถ้ามี application แล้ว ห้ามเปลี่ยน application_pattern หรือ round_code
  if (hasApplications) {
    if (data.applicationPattern !== undefined && data.applicationPattern !== round.applicationPattern) {
      return c.json({
        error: 'ไม่สามารถแก้ไขรูปแบบเลขที่ใบสมัครได้ เนื่องจากมีผู้สมัครในรอบนี้แล้ว',
        reason: 'PATTERN_LOCKED',
        applicationCount: appCountResult?.count ?? 0,
        message: 'หากต้องการรูปแบบใหม่ กรุณา Clone Round หรือสร้าง Round ใหม่',
      }, 409);
    }
    if (data.roundCode !== undefined && data.roundCode !== round.roundCode) {
      return c.json({
        error: 'ไม่สามารถแก้ไขรหัสรอบได้ เนื่องจากมีผู้สมัครในรอบนี้แล้ว',
        reason: 'ROUND_CODE_LOCKED',
        applicationCount: appCountResult?.count ?? 0,
        message: 'หากต้องการรหัสใหม่ กรุณา Clone Round หรือสร้าง Round ใหม่',
      }, 409);
    }
  }

  // Validate application_pattern ถ้ามีการเปลี่ยน
  if (data.applicationPattern !== undefined && data.applicationPattern !== null && data.applicationPattern !== round.applicationPattern) {
    const validation = validateApplicationPattern(data.applicationPattern);
    if (!validation.valid) {
      return c.json({
        error: 'รูปแบบเลขที่ใบสมัครไม่ถูกต้อง',
        reason: 'INVALID_PATTERN',
        details: validation.error,
        field: validation.errorField,
      }, 400);
    }
  }

  // Validate round_code ถ้ามีการเปลี่ยน
  if (data.roundCode !== undefined && data.roundCode !== round.roundCode) {
    const codeResult = validateRoundCode(data.roundCode);
    if (!codeResult.valid) {
      return c.json({
        error: 'รหัสรอบไม่ถูกต้อง',
        reason: 'INVALID_ROUND_CODE',
        details: codeResult.error,
        field: 'roundCode',
      }, 400);
    }

    // ตรวจ unique: round_code ซ้ำในปีเดียวกัน
    const year = new Date(round.openDate as any).getUTCFullYear();
    const conflict = await db
      .select({ id: recruitmentRounds.id, openDate: recruitmentRounds.openDate })
      .from(recruitmentRounds)
      .where(
        and(
          eq(recruitmentRounds.roundCode, codeResult.normalized),
          isNull(recruitmentRounds.deletedAt),
          ne(recruitmentRounds.id, id),
        ),
      )
      .get();
    if (conflict) {
      const conflictYear = new Date(conflict.openDate as any).getUTCFullYear();
      if (conflictYear === year) {
        return c.json({
          error: `รหัสรอบ "${codeResult.normalized}" ปี ${year + 543} ถูกใช้แล้ว`,
          reason: 'ROUND_CODE_CONFLICT',
          existingRoundId: conflict.id,
        }, 409);
      }
    }
  }

  const updateValues: any = {
    // Form Header / Announcement
    announcementTitle: data.announcementTitle !== undefined ? (data.announcementTitle || null) : undefined,
    announcementDescription: data.announcementDescription !== undefined ? (data.announcementDescription || null) : undefined,
    contactInformation: data.contactInformation !== undefined ? (data.contactInformation || null) : undefined,
    remark: data.remark !== undefined ? (data.remark || null) : undefined,
  };

  // Only update fields that are provided
  if (data.title !== undefined) updateValues.title = data.title;
  if (data.positionLevel !== undefined) updateValues.positionLevel = data.positionLevel;
  if (data.status !== undefined) updateValues.status = data.status;
  if (data.templateVersionId !== undefined) updateValues.templateVersionId = data.templateVersionId;
  if (data.openDate !== undefined) updateValues.openDate = new Date(data.openDate * 1000);
  if (data.closeDate !== undefined) updateValues.closeDate = new Date(data.closeDate * 1000);
  if (data.applicationPattern !== undefined) updateValues.applicationPattern = data.applicationPattern;
  if (data.roundCode !== undefined) {
    // ใช้ normalized (uppercase + validated)
    const codeResult = validateRoundCode(data.roundCode);
    updateValues.roundCode = codeResult.valid ? codeResult.normalized : data.roundCode;
  }

  await db.update(recruitmentRounds).set(updateValues).where(eq(recruitmentRounds.id, id));
  return c.json({ success: true });
});

// =============================================================================
// FEATURE: Archive / Restore / Permanent Delete - Recruitment Round
// =============================================================================

// PATCH /admin/rounds/:id/archive - Soft delete (set deletedAt = now)
adminRoutes.patch('/rounds/:id/archive', adminOnlyMiddleware, auditMiddleware('RECRUITMENT_ROUND'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, id)).get();
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }

  if (round.deletedAt) {
    return c.json({ error: 'Round is already archived' }, 400);
  }

  await db.update(recruitmentRounds)
    .set({ deletedAt: new Date() })
    .where(eq(recruitmentRounds.id, id));

  return c.json({ success: true, archivedAt: Math.floor(Date.now() / 1000) });
});

// PATCH /admin/rounds/:id/restore - Restore archived round
adminRoutes.patch('/rounds/:id/restore', adminOnlyMiddleware, auditMiddleware('RECRUITMENT_ROUND'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, id)).get();
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }

  if (!round.deletedAt) {
    return c.json({ error: 'Round is not archived' }, 400);
  }

  await db.update(recruitmentRounds)
    .set({ deletedAt: null })
    .where(eq(recruitmentRounds.id, id));

  return c.json({ success: true });
});

// GET /admin/rounds/:id/usage - Check how many applications exist
adminRoutes.get('/rounds/:id/usage', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, id)).get();
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }

  const appCount = await db
    .select({ count: count() })
    .from(applications)
    .where(and(eq(applications.roundId, id), isNull(applications.deletedAt)))
    .get();

  return c.json({
    data: {
      roundId: id,
      title: round.title,
      status: round.status,
      isArchived: !!round.deletedAt,
      applicationCount: appCount?.count || 0,
    }
  });
});

// DELETE /admin/rounds/:id - Hard delete (admin only, blocked if has applications)
adminRoutes.delete('/rounds/:id', adminOnlyMiddleware, auditMiddleware('RECRUITMENT_ROUND'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, id)).get();
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }

  // Check if round has any applications
  const appCount = await db
    .select({ count: count() })
    .from(applications)
    .where(and(eq(applications.roundId, id), isNull(applications.deletedAt)))
    .get();

  if ((appCount?.count || 0) > 0) {
    return c.json({
      error: 'ไม่สามารถลบรอบรับสมัครได้ เนื่องจากมีผู้สมัครอยู่ในรอบนี้',
      reason: 'PERMANENT_DELETE_BLOCKED',
      applicationCount: appCount?.count || 0,
      message: `ไม่สามารถลบถาวรได้ เนื่องจากรอบนี้มีผู้สมัคร ${appCount?.count || 0} คน (จัดเก็บได้ แต่ลบถาวรไม่ได้)`,
    }, 409);
  }

  // Hard delete (safe - no applications to lose)
  await db.delete(recruitmentRounds).where(eq(recruitmentRounds.id, id));

  return c.json({ success: true, deletedId: id });
});

adminRoutes.get('/applications', async (c) => {
  const db = drizzle(c.env.DB);
  const roundId = c.req.query('roundId');
  const status = c.req.query('status');
  const search = c.req.query('search');

  let whereClause = isNull(applications.deletedAt);

  if (roundId) {
    whereClause = and(whereClause, eq(applications.roundId, roundId))!;
  }

  if (status) {
    whereClause = and(whereClause, eq(applications.status, status))!;
  }

  if (search) {
    const searchLower = `%${search.toLowerCase()}%`;
    whereClause = and(
      whereClause,
      or(
        like(applications.applicationNo, searchLower),
        like(applications.fullname, searchLower),
        like(applications.email, searchLower)
      )
    )!;
  }

  const results = await db
    .select()
    .from(applications)
    .where(whereClause)
    .orderBy(applications.submittedAt);

  return c.json({ data: results });
});

// GET /admin/applications/summary - Get application counts by status
adminRoutes.get('/applications/summary', async (c) => {
  const db = drizzle(c.env.DB);
  const roundId = c.req.query('roundId');

  const whereClause = roundId
    ? and(isNull(applications.deletedAt), eq(applications.roundId, roundId))
    : isNull(applications.deletedAt);

  const [totalResult] = await db
    .select({ count: count() })
    .from(applications)
    .where(whereClause);

  const statusGroups = await db
    .select({
      status: applications.status,
      count: count()
    })
    .from(applications)
    .where(whereClause)
    .groupBy(applications.status);

  const byStatus: Record<string, number> = {
    SUBMITTED: 0,
    UNDER_REVIEW: 0,
    QUALIFIED: 0,
    REJECTED: 0,
    CANCELED: 0,
    ARCHIVED: 0
  };

  statusGroups.forEach(group => {
    if (group.status && byStatus.hasOwnProperty(group.status)) {
      byStatus[group.status] = Number(group.count);
    }
  });

  return c.json({
    data: {
      total: Number(totalResult?.count ?? 0),
      byStatus
    }
  });
});

// PATCH /admin/applications/:id/status - Update application status
adminRoutes.patch('/applications/:id/status', adminOnlyMiddleware, auditMiddleware('APPLICATION'), zValidator('json', ApplicationStatusUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const { status, reason } = c.req.valid('json');
  const adminId = c.get('jwtPayload').id;

  // Check if application exists
  const app = await db.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) {
    return c.json({ error: 'Application not found' }, 404);
  }

  // Require reason for REJECTED status
  if (status === 'REJECTED' && !reason) {
    return c.json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' }, 400);
  }
  
  // Drizzle expects Date object for timestamp fields
  const verifiedAtDate = new Date();
  
  try {
    await db
      .update(applications)
      .set({
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: verifiedAtDate
      })
      .where(eq(applications.id, id));

    return c.json({
      success: true,
      data: {
        id,
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: nowUnix()
      }
    });
  } catch (error: any) {
    console.error('Status update error:', error);
    return c.json({ 
      error: error?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ',
      details: error?.cause?.message || null
    }, 500);
  }
});

// GET /admin/applications/:id - Get full application detail with attachments
adminRoutes.get('/applications/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  // Get application
  const app = await db.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) {
    return c.json({ error: 'Application not found' }, 404);
  }

  // Get attachments
  const attachments = await db.select().from(applicationAttachments).where(eq(applicationAttachments.applicationId, id));

  // Get round info for schema
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, app.roundId)).get();
  let schema: any[] = [];
  if (round) {
    const fields = await db.select({
      fieldId: templateFields.fieldId,
      type: fieldMaster.fieldType,
      label: fieldMaster.labelTh,
      overrideLabel: templateFields.overrideLabelTh,
      isRequired: templateFields.isRequired,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, round.templateVersionId));

    schema = fields;
  }

  // Get reviewer email
  let reviewerEmail: string | null = null;
  if (app.verifiedBy) {
    const reviewer = await db
      .select({ email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.id, app.verifiedBy))
      .get();
    reviewerEmail = reviewer?.email || null;
  }

  return c.json({
    data: {
      id: app.id,
      applicationNo: app.applicationNo,
      roundId: app.roundId,
      email: app.email,
      fullname: app.fullname,
      nationalId: app.nationalId,
      status: app.status,
      statusReason: app.statusReason,
      verifiedBy: app.verifiedBy,
      verifiedByEmail: reviewerEmail,
      verifiedAt: toUnixTimestamp(app.verifiedAt),
      formData: app.formData,
      submittedAt: toUnixTimestamp(app.submittedAt),
      attachments,
      schema
    }
  });
});

// GET /admin/applications/:id/history - Get status change history
adminRoutes.get('/applications/:id/history', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  // Check application exists
  const app = await db.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) {
    return c.json({ error: 'Application not found' }, 404);
  }

  // Get audit logs for this application
  const logs = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      adminId: auditLogs.adminId,
      payload: auditLogs.payload,
      createdAt: auditLogs.createdAt
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'APPLICATION'),
        eq(auditLogs.entityId, id)
      )
    )
    .orderBy(auditLogs.createdAt);

  // Get admin emails
  const adminIds = [...new Set(logs.map(l => l.adminId).filter(Boolean))];
  const admins = adminIds.length > 0 
    ? await db
        .select({ id: adminUsers.id, email: adminUsers.email })
        .from(adminUsers)
        .where(
          adminIds.length === 1 
            ? eq(adminUsers.id, adminIds[0])
            : eq(adminUsers.id, adminIds[0]) // Drizzle limitation, we'll map manually
        )
    : [];

  const adminMap = new Map(admins.map(a => [a.id, a.email]));

  const history = logs.map(log => ({
    id: log.id,
    action: log.action,
    adminId: log.adminId,
    adminEmail: adminMap.get(log.adminId) || log.adminId,
    payload: log.payload,
    createdAt: toUnixTimestamp(log.createdAt)
  }));

  return c.json({ data: history });
});

// POST /admin/applications/bulk-status - Bulk update application status
adminRoutes.post('/applications/bulk-status', adminOnlyMiddleware, auditMiddleware('APPLICATION'), async (c) => {
  const db = drizzle(c.env.DB);
  const { ids, status, reason } = await c.req.json();
  const adminId = c.get('jwtPayload').id;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'กรุณาเลือกอย่างน้อย 1 รายการ' }, 400);
  }

  if (!status) {
    return c.json({ error: 'กรุณาเลือกสถานะ' }, 400);
  }

  // Require reason for REJECTED status
  if (status === 'REJECTED' && !reason) {
    return c.json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' }, 400);
  }

  // Drizzle expects Date object for timestamp fields
  const verifiedAtDate = new Date();
  
  try {
    // Update all applications with matching IDs (not deleted)
    await db
      .update(applications)
      .set({
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: verifiedAtDate
      })
      .where(
        and(
          isNull(applications.deletedAt),
          inArray(applications.id, ids)
        )
      );

    return c.json({
      success: true,
      updated: ids.length,
      data: {
        status,
        reason: reason || null,
        verifiedBy: adminId,
        verifiedAt: nowUnix()
      }
    });
  } catch (error: any) {
    console.error('Bulk status update error:', error);
    return c.json({ 
      error: error?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ',
      details: error?.cause?.message || null
    }, 500);
  }
});

// GET /admin/rounds/comparison - Compare rounds with their template versions
adminRoutes.get('/rounds/comparison', async (c) => {
  const db = drizzle(c.env.DB);
  
  // Get all rounds
  const allRounds = await db.select().from(recruitmentRounds);
  
  // Get all templates
  const allTemplates = await db.select().from(templates);
  
  // Get all versions
  const allVersions = await db.select().from(templateVersions);
  
  // Pre-fetch field counts for all versions
  const versionIds = allVersions.map(v => v.id);
  const versionFieldCounts: Record<string, number> = {};
  
  for (const vid of versionIds) {
    const result = await db.select({ c: count() })
      .from(templateFields)
      .where(eq(templateFields.templateVersionId, vid))
      .get();
    versionFieldCounts[vid] = Number(result?.c ?? 0);
  }
  
  // Build comparison data
  const comparison = allRounds.map(round => {
    const currentVersion = allVersions.find(v => v.id === round.templateVersionId);
    
    // Find latest published version for this template
    const templateVersions = allVersions
      .filter(v => v.templateId === currentVersion?.templateId && v.status === 'PUBLISHED')
      .sort((a, b) => b.versionNumber - a.versionNumber);
    
    const latestVersion = templateVersions[0];
    
    const template = allTemplates.find(t => t.id === currentVersion?.templateId);
    
    return {
      roundId: round.id,
      roundTitle: round.title,
      roundStatus: round.status,
      templateId: currentVersion?.templateId || null,
      templateName: template?.name || 'Unknown',
      currentVersionId: round.templateVersionId,
      currentVersionNumber: currentVersion?.versionNumber || 0,
      currentFieldCount: versionFieldCounts[round.templateVersionId] || 0,
      latestVersionId: latestVersion?.id || null,
      latestVersionNumber: latestVersion?.versionNumber || 0,
      latestFieldCount: versionFieldCounts[latestVersion?.id] || 0,
      isOutdated: currentVersion?.id !== latestVersion?.id,
      needsUpdate: (currentVersion?.id !== latestVersion?.id) && round.status === 'ACTIVE'
    };
  });
  
  return c.json({ data: comparison });
});

// =============================================================================
// FEATURE 1: Version Update Warning - Get round with version comparison data
// =============================================================================
adminRoutes.get('/rounds-with-version-info', async (c) => {
  const db = drizzle(c.env.DB);
  
  // Get all rounds with their template versions
  const allRounds = await db.select({
    roundId: recruitmentRounds.id,
    roundTitle: recruitmentRounds.title,
    roundStatus: recruitmentRounds.status,
    templateVersionId: recruitmentRounds.templateVersionId,
  }).from(recruitmentRounds);
  
  // Get all templates
  const allTemplates = await db.select().from(templates);
  
  // Get all versions
  const allVersions = await db.select().from(templateVersions);
  
  // Get all field master for field names
  const allFields = await db.select().from(fieldMaster);
  
  // Get field counts and field details for all versions
  const versionFieldDetails: Record<string, any[]> = {};
  
  for (const ver of allVersions) {
    const fields = await db.select({
      id: templateFields.id,
      fieldId: templateFields.fieldId,
      isRequired: templateFields.isRequired,
    })
    .from(templateFields)
    .where(eq(templateFields.templateVersionId, ver.id));
    
    versionFieldDetails[ver.id] = fields.map(f => {
      const fieldMaster = allFields.find(fm => fm.id === f.fieldId);
      return {
        fieldId: f.fieldId,
        labelTh: fieldMaster?.labelTh || f.fieldId,
        isRequired: f.isRequired,
      };
    });
  }
  
  // Build enriched round data
  const enrichedRounds = allRounds.map(round => {
    const currentVersion = allVersions.find(v => v.id === round.templateVersionId);
    const template = currentVersion ? allTemplates.find(t => t.id === currentVersion.templateId) : null;
    
    // Find latest published version for this template
    const publishedVersions = allVersions
      .filter(v => v.templateId === currentVersion?.templateId && v.status === 'PUBLISHED')
      .sort((a, b) => b.versionNumber - a.versionNumber);
    
    const latestPublished = publishedVersions[0];
    
    return {
      roundId: round.roundId,
      roundTitle: round.roundTitle,
      roundStatus: round.roundStatus,
      currentVersion: currentVersion ? {
        id: currentVersion.id,
        versionNumber: currentVersion.versionNumber,
        status: currentVersion.status,
        fields: versionFieldDetails[currentVersion.id] || [],
      } : null,
      latestPublishedVersion: latestPublished && latestPublished.id !== currentVersion?.id ? {
        id: latestPublished.id,
        versionNumber: latestPublished.versionNumber,
        status: latestPublished.status,
        fields: versionFieldDetails[latestPublished.id] || [],
      } : null,
      hasNewerVersion: latestPublished && currentVersion && latestPublished.versionNumber > currentVersion.versionNumber,
      template: template ? {
        id: template.id,
        name: template.name,
      } : null,
    };
  });
  
  return c.json({ data: enrichedRounds });
});

// =============================================================================
// FEATURE 2: Compare Version API
// GET /admin/template-versions/:fromId/compare/:toId
// =============================================================================
adminRoutes.get('/template-versions/:fromId/compare/:toId', async (c) => {
  const db = drizzle(c.env.DB);
  const fromId = c.req.param('fromId');
  const toId = c.req.param('toId');

  // Get both versions
  const [fromVersion, toVersion] = await Promise.all([
    db.select().from(templateVersions).where(eq(templateVersions.id, fromId)).get(),
    db.select().from(templateVersions).where(eq(templateVersions.id, toId)).get(),
  ]);

  if (!fromVersion || !toVersion) {
    return c.json({ error: 'Version not found' }, 404);
  }

  // Get fields for both versions
  const [fromFields, toFields] = await Promise.all([
    db.select({
      fieldId: templateFields.fieldId,
      isRequired: templateFields.isRequired,
      sectionId: templateFields.sectionId,
    })
    .from(templateFields)
    .where(eq(templateFields.templateVersionId, fromId)),
    db.select({
      fieldId: templateFields.fieldId,
      isRequired: templateFields.isRequired,
      sectionId: templateFields.sectionId,
    })
    .from(templateFields)
    .where(eq(templateFields.templateVersionId, toId)),
  ]);

  // Get sections for both versions (Sprint 4)
  const [fromSections, toSections] = await Promise.all([
    db.select().from(templateSections)
      .where(eq(templateSections.templateVersionId, fromId))
      .orderBy(asc(templateSections.displayOrder)),
    db.select().from(templateSections)
      .where(eq(templateSections.templateVersionId, toId))
      .orderBy(asc(templateSections.displayOrder)),
  ]);

  // Get all field master for labels
  const allFields = await db.select().from(fieldMaster);
  const getLabel = (fieldId: string) => allFields.find(f => f.id === fieldId)?.labelTh || fieldId;

  const fromFieldIds = new Set(fromFields.map(f => f.fieldId));
  const toFieldIds = new Set(toFields.map(f => f.fieldId));

  // Calculate differences
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // Fields in toVersion but not in fromVersion = added
  for (const fieldId of toFieldIds) {
    if (!fromFieldIds.has(fieldId)) {
      added.push(getLabel(fieldId));
    }
  }

  // Fields in fromVersion but not in toVersion = removed
  for (const fieldId of fromFieldIds) {
    if (!toFieldIds.has(fieldId)) {
      removed.push(getLabel(fieldId));
    }
  }

  // Fields in both - check for required field changes
  for (const fieldId of fromFieldIds) {
    if (toFieldIds.has(fieldId)) {
      const fromReq = fromFields.find(f => f.fieldId === fieldId)?.isRequired;
      const toReq = toFields.find(f => f.fieldId === fieldId)?.isRequired;
      if (fromReq !== toReq) {
        modified.push(getLabel(fieldId));
      }
    }
  }

  // Sprint 4: Section diff + field-section change diff
  // Match sections by name (since IDs are UUIDs and different per version)
  const fromSectionByName = new Map(fromSections.filter(s => s.isActive).map(s => [s.name, s]));
  const toSectionByName = new Map(toSections.filter(s => s.isActive).map(s => [s.name, s]));

  const sectionsAdded: string[] = [];
  const sectionsRemoved: string[] = [];
  const sectionsModified: string[] = [];

  for (const [name, s] of toSectionByName) {
    if (!fromSectionByName.has(name)) {
      sectionsAdded.push(name);
    } else {
      const fromS = fromSectionByName.get(name)!;
      if (fromS.displayOrder !== s.displayOrder) {
        sectionsModified.push(name);
      }
    }
  }
  for (const name of fromSectionByName.keys()) {
    if (!toSectionByName.has(name)) {
      sectionsRemoved.push(name);
    }
  }

  // Field section change: fields that exist in both but have different section
  const fieldSectionChanged: string[] = [];
  for (const fieldId of fromFieldIds) {
    if (toFieldIds.has(fieldId)) {
      const fromF = fromFields.find(f => f.fieldId === fieldId);
      const toF = toFields.find(f => f.fieldId === fieldId);
      if (fromF && toF && (fromF.sectionId || null) !== (toF.sectionId || null)) {
        fieldSectionChanged.push(getLabel(fieldId));
      }
    }
  }

  return c.json({
    data: {
      fromVersion: {
        id: fromVersion.id,
        versionNumber: fromVersion.versionNumber,
      },
      toVersion: {
        id: toVersion.id,
        versionNumber: toVersion.versionNumber,
      },
      added,
      removed,
      modified,
      // Sprint 4: section diff
      sections: {
        added: sectionsAdded,
        removed: sectionsRemoved,
        modified: sectionsModified,
        fieldSectionChanged,
      },
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        sectionsAdded: sectionsAdded.length,
        sectionsRemoved: sectionsRemoved.length,
        sectionsModified: sectionsModified.length,
        fieldSectionChanged: fieldSectionChanged.length,
      },
    }
  });
});

// =============================================================================
// FEATURE 3: Clone Round API
// POST /admin/rounds/:id/clone
// =============================================================================
adminRoutes.post('/rounds/:id/clone', adminOnlyMiddleware, auditMiddleware('ROUND_CLONED'), async (c) => {
  const db = drizzle(c.env.DB);
  const roundId = c.req.param('id');
  const { templateVersionId, title } = await c.req.json();
  
  // Get original round
  const originalRound = await db
    .select()
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, roundId))
    .get();
    
  if (!originalRound) {
    return c.json({ error: 'Round not found' }, 404);
  }
  
  // Validate new template version if provided
  let newTemplateVersionId = templateVersionId || originalRound.templateVersionId;
  
  if (templateVersionId) {
    const newVersion = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.id, templateVersionId))
      .get();
      
    if (!newVersion) {
      return c.json({ error: 'Template version not found' }, 404);
    }
    
    if (newVersion.status !== 'PUBLISHED') {
      return c.json({ error: 'Can only clone with PUBLISHED version' }, 400);
    }
  }
  
  // Count applications in original round
  const appCountResult = await db
    .select({ count: count() })
    .from(applications)
    .where(eq(applications.roundId, roundId))
    .get();
  const appCount = Number(appCountResult?.count ?? 0);

  // ========================================================================
  // Migration 019 - Clone round ใช้ round_code เดิม (Admin จะต้องเปลี่ยนเองทีหลังถ้าต้องการ)
  // (Round code เป็น business data — clone ไม่ generate ใหม่)
  // ========================================================================

  // Create new round with DRAFT status
  const newRoundId = uuidv4();
  const newTitle = title || `${originalRound.title} (Copy)`;

  await db.insert(recruitmentRounds).values({
    id: newRoundId,
    templateVersionId: newTemplateVersionId,
    title: newTitle,
    positionLevel: originalRound.positionLevel,
    openDate: originalRound.openDate,
    closeDate: originalRound.closeDate,
    status: 'DRAFT', // Always DRAFT for cloned round
    // Migration 019 - inherit pattern (ใช้ format เดียวกัน)
    applicationPattern: originalRound.applicationPattern,
    roundCode: originalRound.roundCode,
  });

  // Log the clone action with audit details
  const adminId = c.get('jwtPayload')?.id;
  if (adminId) {
    await db.insert(auditLogs).values({
      id: uuidv4(),
      adminId,
      action: 'CREATE',
      entityType: 'ROUND_CLONED',
      entityId: newRoundId,
      payload: JSON.stringify({
        originalRoundId: roundId,
        newRoundId,
        originalVersionId: originalRound.templateVersionId,
        newVersionId: newTemplateVersionId,
        originalVersionNumber: originalRound.templateVersionId,
        applicationCount: appCount,
        // Migration 019
        applicationPattern: originalRound.applicationPattern,
        roundCode: originalRound.roundCode,
      }),
    });
  }

  return c.json({
    success: true,
    id: newRoundId,
    message: `Cloned round "${newTitle}" with ${appCount} applications (not copied)`,
    // Migration 019
    roundCode: originalRound.roundCode,
    applicationPattern: originalRound.applicationPattern,
  }, 201);
});

// =============================================================================
// FEATURE 4: Get available versions for cloning (for UI dropdown)
// =============================================================================
adminRoutes.get('/rounds/:id/clone-options', async (c) => {
  const db = drizzle(c.env.DB);
  const roundId = c.req.param('id');
  
  // Get original round
  const round = await db
    .select()
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, roundId))
    .get();
    
  if (!round) {
    return c.json({ error: 'Round not found' }, 404);
  }
  
  // Get current version info
  const currentVersion = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, round.templateVersionId))
    .get();
  
  // Get template and all published versions
  const template = currentVersion 
    ? await db.select().from(templates).where(eq(templates.id, currentVersion.templateId)).get()
    : null;
  
  const publishedVersions = template
    ? await db.select()
        .from(templateVersions)
        .where(and(
          eq(templateVersions.templateId, template.id),
          eq(templateVersions.status, 'PUBLISHED')
        ))
    : [];
  
  // Get application count for protection message
  const appCountResult = await db
    .select({ count: count() })
    .from(applications)
    .where(eq(applications.roundId, roundId))
    .get();
  const appCount = Number(appCountResult?.count ?? 0);
  
  // Get comparison data for each version option
  const versionOptions = await Promise.all(
    publishedVersions.map(async (ver) => {
      const [currentFields, newFields] = await Promise.all([
        db.select({ fieldId: templateFields.fieldId })
          .from(templateFields)
          .where(eq(templateFields.templateVersionId, round.templateVersionId)),
        db.select({ fieldId: templateFields.fieldId })
          .from(templateFields)
          .where(eq(templateFields.templateVersionId, ver.id)),
      ]);
      
      const currentFieldIds = new Set(currentFields.map(f => f.fieldId));
      const newFieldIds = new Set(newFields.map(f => f.fieldId));
      
      let added = 0, removed = 0;
      for (const fid of newFieldIds) if (!currentFieldIds.has(fid)) added++;
      for (const fid of currentFieldIds) if (!newFieldIds.has(fid)) removed++;
      
      return {
        versionId: ver.id,
        versionNumber: ver.versionNumber,
        isCurrentVersion: ver.id === round.templateVersionId,
        isRecommended: ver.versionNumber > (currentVersion?.versionNumber || 0),
        fieldChanges: {
          added,
          removed,
        },
      };
    })
  );
  
  return c.json({
    data: {
      originalRound: {
        id: round.id,
        title: round.title,
        status: round.status,
        currentVersionId: round.templateVersionId,
        currentVersionNumber: currentVersion?.versionNumber || 0,
      },
      template: template ? {
        id: template.id,
        name: template.name,
      } : null,
      applicationCount: appCount,
      needsProtection: round.status === 'ACTIVE' && appCount > 0,
      versionOptions,
    }
  });
});

adminRoutes.get('/audit-logs', async (c) => {
  const db = drizzle(c.env.DB);

  // ---------- Pagination params ----------
  const rawPage = Number(c.req.query('page') ?? '1');
  const rawPageSize = Number(c.req.query('pageSize') ?? '50');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  // Whitelist pageSize เพื่อกัน client ขอ pageSize=99999 → ทำลาย DB
  const allowedPageSizes = [10, 25, 50, 100] as const;
  const pageSize = (allowedPageSizes as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : 50;

  // ---------- Filter params ----------
  const action = c.req.query('action')?.trim() || '';
  const entity = c.req.query('entity')?.trim() || '';
  const search = c.req.query('search')?.trim() || '';

  // ---------- Build WHERE ----------
  const filters: ReturnType<typeof eq>[] = [];
  if (action) filters.push(eq(auditLogs.action, action));
  if (entity) filters.push(eq(auditLogs.entityType, entity));

  // Search: ค้นหาใน adminId / entityId / ipAddress (ใช้ index บน entity_id ร่วมกับ prefix LIKE ได้)
  if (search) {
    const likePattern = `%${search}%`;
    const searchOr = or(
      like(auditLogs.adminId, likePattern),
      like(auditLogs.entityId, likePattern),
      like(auditLogs.ipAddress, likePattern)
    );
    if (searchOr) filters.push(searchOr);
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  // ---------- Total count ----------
  const totalRow = await db
    .select({ value: count() })
    .from(auditLogs)
    .where(whereClause)
    .get();
  const total = totalRow?.value ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  // ---------- Page items ----------
  // ถ้า page > totalPages ให้ clamp กลับมาที่หน้าสุดท้าย (กันหน้าว่างหลอก)
  const safePage = totalPages > 0 && page > totalPages ? totalPages : page;
  const offset = (safePage - 1) * pageSize;

  const items = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pageSize)
    .offset(offset);

  return c.json({
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
  });
});

// ============ Organization Master ============

// GET /admin/organizations - List all organizations
adminRoutes.get('/organizations', async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query('search') || '';
  const isActive = c.req.query('isActive');

  let query = db.select().from(organizations);

  if (search) {
    query = query.where(like(organizations.name, `%${search}%`)) as any;
  }

  if (isActive === 'true') {
    query = query.where(eq(organizations.isActive, true)) as any;
  } else if (isActive === 'false') {
    query = query.where(eq(organizations.isActive, false)) as any;
  }

  const result = await query.orderBy(asc(organizations.displayOrder));
  return c.json({ data: result });
});

// GET /admin/organizations/:id - Get single organization
adminRoutes.get('/organizations/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const org = await db.select().from(organizations).where(eq(organizations.id, c.req.param('id'))).get();
  
  if (!org) {
    return c.json({ error: 'Organization not found' }, 404);
  }
  
  return c.json({ data: org });
});

// POST /admin/organizations - Create organization
adminRoutes.post('/organizations', adminOnlyMiddleware, auditMiddleware('ORGANIZATION'), async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  // Auto-assign displayOrder = MAX + 1 (ต่อท้าย)
  const maxRow = await db
    .select({ max: sql<number>`COALESCE(MAX(${organizations.displayOrder}), 0)` })
    .from(organizations)
    .get();
  const nextDisplayOrder = (maxRow?.max ?? 0) + 1;

  const id = uuidv4();
  await db.insert(organizations).values({
    id,
    name: body.name.trim(),
    displayOrder: nextDisplayOrder,
    isActive: body.isActive !== false,
  });

  const created = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  return c.json({ data: created }, 201);
});

// PUT /admin/organizations/:id - Update organization
adminRoutes.put('/organizations/:id', adminOnlyMiddleware, auditMiddleware('ORGANIZATION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Organization not found' }, 404);
  }

  const updateData: any = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return c.json({ error: 'Name cannot be empty' }, 400);
    }
    updateData.name = body.name.trim();
  }
  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 1) {
      return c.json({ error: 'displayOrder must be a positive integer' }, 400);
    }
    updateData.displayOrder = body.displayOrder;
  }
  if (body.isActive !== undefined) {
    updateData.isActive = body.isActive;
  }
  // Drizzle expects Date object for timestamp fields, not Unix timestamp number
  updateData.updatedAt = new Date();

  await db.update(organizations).set(updateData).where(eq(organizations.id, id));
  
  const updated = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  return c.json({ data: updated });
});

// DELETE /admin/organizations/:id - Soft delete (set isActive = false)
adminRoutes.delete('/organizations/:id', adminOnlyMiddleware, auditMiddleware('ORGANIZATION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  
  const existing = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Organization not found' }, 404);
  }
  
  await db.update(organizations).set({ 
    isActive: false,
    updatedAt: sql`(unixepoch())`
  }).where(eq(organizations.id, id));
  
  return c.json({ success: true });
});

// PATCH /admin/organizations/:id/toggle - Toggle isActive
adminRoutes.patch('/organizations/:id/toggle', adminOnlyMiddleware, auditMiddleware('ORGANIZATION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Organization not found' }, 404);
  }

  await db.update(organizations).set({
    isActive: !existing.isActive,
    updatedAt: sql`(unixepoch())`
  }).where(eq(organizations.id, id));

  const updated = await db.select().from(organizations).where(eq(organizations.id, id)).get();
  return c.json({ data: updated });
});

// ============ Job Family Master ============

// GET /admin/job-families - List all
adminRoutes.get('/job-families', async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query('search') || '';
  const isActive = c.req.query('isActive');

  let query = db.select().from(jobFamilies);

  if (search) {
    query = query.where(like(jobFamilies.name, `%${search}%`)) as any;
  }

  if (isActive === 'true') {
    query = query.where(eq(jobFamilies.isActive, true)) as any;
  } else if (isActive === 'false') {
    query = query.where(eq(jobFamilies.isActive, false)) as any;
  }

  const result = await query.orderBy(asc(jobFamilies.displayOrder));
  return c.json({ data: result });
});

// GET /admin/job-families/:id
adminRoutes.get('/job-families/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const item = await db.select().from(jobFamilies).where(eq(jobFamilies.id, c.req.param('id'))).get();
  if (!item) return c.json({ error: 'Job Family not found' }, 404);
  return c.json({ data: item });
});

// POST /admin/job-families
adminRoutes.post('/job-families', adminOnlyMiddleware, auditMiddleware('JOB_FAMILY'), async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const maxRow = await db
    .select({ max: sql<number>`COALESCE(MAX(${jobFamilies.displayOrder}), 0)` })
    .from(jobFamilies)
    .get();
  const nextDisplayOrder = (maxRow?.max ?? 0) + 1;

  const id = uuidv4();
  await db.insert(jobFamilies).values({
    id,
    name: body.name.trim(),
    displayOrder: nextDisplayOrder,
    isActive: body.isActive !== false,
  });

  const created = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  return c.json({ data: created }, 201);
});

// PUT /admin/job-families/:id
adminRoutes.put('/job-families/:id', adminOnlyMiddleware, auditMiddleware('JOB_FAMILY'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  if (!existing) return c.json({ error: 'Job Family not found' }, 404);

  const updateData: any = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ error: 'Name cannot be empty' }, 400);
    updateData.name = body.name.trim();
  }
  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 1) {
      return c.json({ error: 'displayOrder must be a positive integer' }, 400);
    }
    updateData.displayOrder = body.displayOrder;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  // Drizzle expects Date object for timestamp fields, not Unix timestamp number
  updateData.updatedAt = new Date();

  await db.update(jobFamilies).set(updateData).where(eq(jobFamilies.id, id));
  const updated = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  return c.json({ data: updated });
});

// DELETE /admin/job-families/:id - Hard delete (ตรวจสอบ FK จาก positions ก่อน)
adminRoutes.delete('/job-families/:id', adminOnlyMiddleware, auditMiddleware('JOB_FAMILY'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  if (!existing) return c.json({ error: 'Job Family not found' }, 404);

  // ตรวจสอบว่ามี Position ที่ใช้ Job Family นี้หรือไม่
  const positionsUsingJobFamily = await db
    .select({ count: count() })
    .from(positions)
    .where(eq(positions.jobFamilyId, id))
    .get();

  if (positionsUsingJobFamily && Number(positionsUsingJobFamily.count) > 0) {
    return c.json({
      error: `ไม่สามารถลบ Job Family "${existing.name}" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ ${Number(positionsUsingJobFamily.count)} รายการ`,
      referenceCount: Number(positionsUsingJobFamily.count),
      references: 'positions'
    }, 400);
  }

  // Hard delete
  await db.delete(jobFamilies).where(eq(jobFamilies.id, id));
  return c.json({ success: true });
});

// PATCH /admin/job-families/:id/toggle
adminRoutes.patch('/job-families/:id/toggle', adminOnlyMiddleware, auditMiddleware('JOB_FAMILY'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  if (!existing) return c.json({ error: 'Job Family not found' }, 404);

  await db.update(jobFamilies).set({
    isActive: !existing.isActive,
    updatedAt: sql`(unixepoch())`
  }).where(eq(jobFamilies.id, id));

  const updated = await db.select().from(jobFamilies).where(eq(jobFamilies.id, id)).get();
  return c.json({ data: updated });
});

// ============ Position Level Master ============

// GET /admin/position-levels - List all
adminRoutes.get('/position-levels', async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query('search') || '';
  const isActive = c.req.query('isActive');

  let query = db.select().from(positionLevels);

  if (search) {
    query = query.where(like(positionLevels.name, `%${search}%`)) as any;
  }

  if (isActive === 'true') {
    query = query.where(eq(positionLevels.isActive, true)) as any;
  } else if (isActive === 'false') {
    query = query.where(eq(positionLevels.isActive, false)) as any;
  }

  const result = await query.orderBy(asc(positionLevels.displayOrder));
  return c.json({ data: result });
});

// GET /admin/position-levels/:id
adminRoutes.get('/position-levels/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const item = await db.select().from(positionLevels).where(eq(positionLevels.id, c.req.param('id'))).get();
  if (!item) return c.json({ error: 'Position Level not found' }, 404);
  return c.json({ data: item });
});

// POST /admin/position-levels
adminRoutes.post('/position-levels', adminOnlyMiddleware, auditMiddleware('POSITION_LEVEL'), async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const maxRow = await db
    .select({ max: sql<number>`COALESCE(MAX(${positionLevels.displayOrder}), 0)` })
    .from(positionLevels)
    .get();
  const nextDisplayOrder = (maxRow?.max ?? 0) + 1;

  const id = uuidv4();
  await db.insert(positionLevels).values({
    id,
    name: body.name.trim(),
    displayOrder: nextDisplayOrder,
    isActive: body.isActive !== false,
  });

  const created = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  return c.json({ data: created }, 201);
});

// PUT /admin/position-levels/:id
adminRoutes.put('/position-levels/:id', adminOnlyMiddleware, auditMiddleware('POSITION_LEVEL'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  if (!existing) return c.json({ error: 'Position Level not found' }, 404);

  const updateData: any = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ error: 'Name cannot be empty' }, 400);
    updateData.name = body.name.trim();
  }
  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 1) {
      return c.json({ error: 'displayOrder must be a positive integer' }, 400);
    }
    updateData.displayOrder = body.displayOrder;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  // Drizzle expects Date object for timestamp fields, not Unix timestamp number
  updateData.updatedAt = new Date();

  await db.update(positionLevels).set(updateData).where(eq(positionLevels.id, id));
  const updated = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  return c.json({ data: updated });
});

// DELETE /admin/position-levels/:id - Hard delete (ตรวจสอบ FK จาก positions ก่อน)
adminRoutes.delete('/position-levels/:id', adminOnlyMiddleware, auditMiddleware('POSITION_LEVEL'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  if (!existing) return c.json({ error: 'Position Level not found' }, 404);

  // ตรวจสอบว่ามี Position ที่ใช้ Position Level นี้หรือไม่
  const positionsUsingLevel = await db
    .select({ count: count() })
    .from(positions)
    .where(eq(positions.positionLevelId, id))
    .get();

  if (positionsUsingLevel && Number(positionsUsingLevel.count) > 0) {
    return c.json({
      error: `ไม่สามารถลบ Position Level "${existing.name}" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ ${Number(positionsUsingLevel.count)} รายการ`,
      referenceCount: Number(positionsUsingLevel.count),
      references: 'positions'
    }, 400);
  }

  // Hard delete
  await db.delete(positionLevels).where(eq(positionLevels.id, id));
  return c.json({ success: true });
});

// PATCH /admin/position-levels/:id/toggle
adminRoutes.patch('/position-levels/:id/toggle', adminOnlyMiddleware, auditMiddleware('POSITION_LEVEL'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  if (!existing) return c.json({ error: 'Position Level not found' }, 404);

  await db.update(positionLevels).set({
    isActive: !existing.isActive,
    updatedAt: sql`(unixepoch())`
  }).where(eq(positionLevels.id, id));

  const updated = await db.select().from(positionLevels).where(eq(positionLevels.id, id)).get();
  return c.json({ data: updated });
});

// ============ Position Master (uses SearchableDropdown for jobFamily/level) ============

// GET /admin/positions - List all positions
adminRoutes.get('/positions', async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query('search') || '';
  const isActive = c.req.query('isActive');

  let query = db.select().from(positions);

  if (search) {
    query = query.where(like(positions.title, `%${search}%`)) as any;
  }

  if (isActive === 'true') {
    query = query.where(eq(positions.isActive, true)) as any;
  } else if (isActive === 'false') {
    query = query.where(eq(positions.isActive, false)) as any;
  }

  const result = await query.orderBy(asc(positions.displayOrder));
  return c.json({ data: result });
});

// GET /admin/positions/:id
adminRoutes.get('/positions/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const item = await db.select().from(positions).where(eq(positions.id, c.req.param('id'))).get();
  if (!item) return c.json({ error: 'Position not found' }, 404);
  return c.json({ data: item });
});

// POST /admin/positions
adminRoutes.post('/positions', adminOnlyMiddleware, auditMiddleware('POSITION'), async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();

  if (!body.title || !body.title.trim()) return c.json({ error: 'Title is required' }, 400);
  if (!body.jobFamilyId) return c.json({ error: 'jobFamilyId is required' }, 400);
  if (!body.positionLevelId) return c.json({ error: 'positionLevelId is required' }, 400);

  const maxRow = await db
    .select({ max: sql<number>`COALESCE(MAX(${positions.displayOrder}), 0)` })
    .from(positions)
    .get();
  const nextDisplayOrder = (maxRow?.max ?? 0) + 1;

  const id = uuidv4();
  await db.insert(positions).values({
    id,
    title: body.title.trim(),
    jobFamilyId: body.jobFamilyId,
    positionLevelId: body.positionLevelId,
    displayOrder: nextDisplayOrder,
    isActive: body.isActive !== false,
  });

  const created = await db.select().from(positions).where(eq(positions.id, id)).get();
  return c.json({ data: created }, 201);
});

// PUT /admin/positions/:id
adminRoutes.put('/positions/:id', adminOnlyMiddleware, auditMiddleware('POSITION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.select().from(positions).where(eq(positions.id, id)).get();
  if (!existing) return c.json({ error: 'Position not found' }, 404);

  const updateData: any = {};
  if (body.title !== undefined) {
    if (!body.title.trim()) return c.json({ error: 'Title cannot be empty' }, 400);
    updateData.title = body.title.trim();
  }
  if (body.jobFamilyId !== undefined) updateData.jobFamilyId = body.jobFamilyId;
  if (body.positionLevelId !== undefined) updateData.positionLevelId = body.positionLevelId;
  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 1) {
      return c.json({ error: 'displayOrder must be a positive integer' }, 400);
    }
    updateData.displayOrder = body.displayOrder;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  // Drizzle expects Date object for timestamp fields, not Unix timestamp number
  updateData.updatedAt = new Date();

  await db.update(positions).set(updateData).where(eq(positions.id, id));
  const updated = await db.select().from(positions).where(eq(positions.id, id)).get();
  return c.json({ data: updated });
});

// DELETE /admin/positions/:id - Hard delete
adminRoutes.delete('/positions/:id', adminOnlyMiddleware, auditMiddleware('POSITION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(positions).where(eq(positions.id, id)).get();
  if (!existing) return c.json({ error: 'Position not found' }, 404);

  // Hard delete (positions table has no FK from other tables)
  await db.delete(positions).where(eq(positions.id, id));

  return c.json({ success: true });
});

// PATCH /admin/positions/:id/toggle
adminRoutes.patch('/positions/:id/toggle', adminOnlyMiddleware, auditMiddleware('POSITION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const existing = await db.select().from(positions).where(eq(positions.id, id)).get();
  if (!existing) return c.json({ error: 'Position not found' }, 404);

  await db.update(positions).set({
    isActive: !existing.isActive,
    updatedAt: sql`(unixepoch())`
  }).where(eq(positions.id, id));

  const updated = await db.select().from(positions).where(eq(positions.id, id)).get();
  return c.json({ data: updated });
});

// =============================================================================
// FEATURE: Admin Preview Form (Sprint 5)
// =============================================================
// GET /admin/rounds/:id/preview-schema
//
// Bypasses the public round lifecycle gate (evaluateRound) so that an
// authenticated Admin can preview the schema of a DRAFT or CLOSED round
// before publishing. The response shape mirrors /public/rounds/:id/schema
// (sections + fields with MASTER_DATA normalization) and adds:
//   - isPreview: true            (frontend marker to switch to Preview UX)
//   - round.{status, dates...}  (so the Preview page can render banners
//     without an extra round-detail call)
//
// Security: protected by `adminRoutes.use('/*', authMiddleware)` above.
// This endpoint does NOT call evaluateRound() and does NOT expose any
// application or attachment data.
// =============================================================================
adminRoutes.get('/rounds/:id/preview-schema', async (c) => {
  const db = drizzle(c.env.DB);
  const roundId = c.req.param('id');

  // 1. Fetch the round (any status, no gate)
  const round = await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      positionLevel: recruitmentRounds.positionLevel,
      status: recruitmentRounds.status,
      openDate: recruitmentRounds.openDate,
      closeDate: recruitmentRounds.closeDate,
      announcementTitle: recruitmentRounds.announcementTitle,
      announcementDescription: recruitmentRounds.announcementDescription,
      contactInformation: recruitmentRounds.contactInformation,
      remark: recruitmentRounds.remark,
      templateVersionId: recruitmentRounds.templateVersionId,
    })
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, roundId))
    .get();

  if (!round) {
    return c.json({ success: false, error: 'ไม่พบรอบรับสมัคร' }, 404);
  }

  // 2. Fetch sections (same query shape as public schema)
  const sections = await db
    .select()
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, round.templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  // 3. Fetch fields with fieldMaster join (same as public schema)
  const schema = await db
    .select({
      fieldId: templateFields.fieldId,
      sectionId: templateFields.sectionId,
      type: fieldMaster.fieldType,
      label: fieldMaster.labelTh,
      overrideLabel: templateFields.overrideLabelTh,
      options: fieldMaster.defaultOptions,
      overrideOptions: templateFields.overrideOptions,
      isRequired: templateFields.isRequired,
      helpText: sql`COALESCE(${templateFields.helpText}, ${fieldMaster.helpText})`,
      placeholder: sql`COALESCE(${templateFields.placeholder}, ${fieldMaster.placeholder})`,
      validationMessage: sql`COALESCE(${templateFields.validationMessage}, ${fieldMaster.validationMessage})`,
      section: fieldMaster.section, // legacy fallback
      fileConfig: fieldMaster.fileConfig,
      validationType: fieldMaster.validationType,
      order: templateFields.displayOrder,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, round.templateVersionId))
    .orderBy(templateFields.displayOrder);

  // 4. Normalize MASTER_DATA fields (same logic as public schema)
  const normalized = schema.map((f) => {
    if (f.type !== 'MASTER_DATA') return { ...f, masterDataSource: null };

    const raw: unknown = f.options;
    let source: string | null = null;

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          source = (parsed as { source?: string }).source ?? null;
        }
      } catch {
        source = null;
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      source = (raw as { source?: string }).source ?? null;
    }

    return { ...f, options: null, masterDataSource: source };
  });

  return c.json({
    success: true,
    isPreview: true,
    data: {
      sections: sections.filter((s) => s.isActive),
      fields: normalized,
      round: {
        id: round.id,
        title: round.title,
        positionLevel: round.positionLevel,
        status: round.status,
        openDate: round.openDate,
        closeDate: round.closeDate,
        announcementTitle: round.announcementTitle,
        announcementDescription: round.announcementDescription,
        contactInformation: round.contactInformation,
        remark: round.remark,
      },
    },
  });
});

export { adminRoutes };