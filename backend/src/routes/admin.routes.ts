import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { sign } from 'hono/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, ne, isNull, count, or, like, inArray } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { authMiddleware } from '../middlewares/auth.middleware';
import { auditMiddleware } from '../middlewares/audit.middleware';
import { adminUsers, fieldMaster, templates, templateVersions, templateFields, recruitmentRounds, applications, applicationAttachments, auditLogs } from '../db/schema';
import { LoginRequestSchema, FieldMasterCreateSchema, FieldMasterUpdateSchema, TemplateCreateSchema, TemplateUpdateSchema, TemplateVersionCreateSchema, RecruitmentRoundCreateSchema, RecruitmentRoundUpdateSchema, ApplicationStatusUpdateSchema } from '../schemas/validators';

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
adminRoutes.post('/fields', auditMiddleware('FIELD_MASTER'), zValidator('json', FieldMasterCreateSchema), async (c) => {
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

adminRoutes.patch('/fields/:id', auditMiddleware('FIELD_MASTER'), zValidator('json', FieldMasterUpdateSchema), async (c) => {
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
  
  await db.update(fieldMaster).set(updateValues).where(eq(fieldMaster.id, id));
  return c.json({ success: true });
});

// Soft delete: ตั้ง isActive=false (ห้าม hard delete เพราะ field อาจถูกใช้ใน template version แล้ว)
adminRoutes.delete('/fields/:id', auditMiddleware('FIELD_MASTER'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  await db.update(fieldMaster).set({ isActive: false }).where(eq(fieldMaster.id, id));
  return c.json({ success: true });
});

adminRoutes.get('/templates', async (c) => {
  const db = drizzle(c.env.DB);
  
  // Get all templates
  const allTemplates = await db.select().from(templates);
  
  // Get all versions
  const allVersions = await db.select().from(templateVersions);
  
  // Get all rounds
  const allRounds = await db.select().from(recruitmentRounds);
  
  // Build enriched data
  const enrichedTemplates = allTemplates.map(tpl => {
    const tplVersions = allVersions.filter(v => v.templateId === tpl.id);
    const publishedVersion = tplVersions
      .filter(v => v.status === 'PUBLISHED')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    
    // Count rounds using published version
    const roundsCount = publishedVersion
      ? allRounds.filter(r => r.templateVersionId === publishedVersion.id).length
      : 0;
    
    return {
      ...tpl,
      versionCount: tplVersions.length,
      currentVersion: publishedVersion,
      roundsCount
    };
  });
  
  return c.json({ data: enrichedTemplates });
});
adminRoutes.post('/templates', auditMiddleware('TEMPLATE'), zValidator('json', TemplateCreateSchema), async (c) => {
  const id = uuidv4();
  await drizzle(c.env.DB).insert(templates).values({ id, ...c.req.valid('json') });
  return c.json({ success: true, id }, 201);
});

adminRoutes.patch('/templates/:id', auditMiddleware('TEMPLATE'), zValidator('json', TemplateUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  await db.update(templates).set(data).where(eq(templates.id, id));
  return c.json({ success: true });
});

adminRoutes.get('/templates/:id/versions', async (c) => {
  const data = await drizzle(c.env.DB).select().from(templateVersions).where(eq(templateVersions.templateId, c.req.param('id')));
  return c.json({ data });
});

// GET /admin/template-fields/:versionId - Get fields for a specific template version
adminRoutes.get('/template-fields/:versionId', async (c) => {
  const db = drizzle(c.env.DB);
  const versionId = c.req.param('versionId');
  
  const fields = await db.select({
    id: templateFields.id,
    fieldId: templateFields.fieldId,
    displayOrder: templateFields.displayOrder,
    isRequired: templateFields.isRequired,
    overrideLabelTh: templateFields.overrideLabelTh,
    overrideOptions: templateFields.overrideOptions,
    helpText: templateFields.helpText,
    placeholder: templateFields.placeholder,
    validationRules: templateFields.validationRules,
  } as any)
  .from(templateFields)
  .where(eq(templateFields.templateVersionId, versionId))
  .orderBy(templateFields.displayOrder);
  
  return c.json({ data: fields });
});

// Create new version as DRAFT (not PUBLISHED)
adminRoutes.post('/templates/:id/versions', auditMiddleware('TEMPLATE_VERSION'), zValidator('json', TemplateVersionCreateSchema), async (c) => {
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

  // Insert each field
  for (const f of payload.fields) {
    const fieldValues: any = {
      id: uuidv4(),
      templateVersionId: versionId,
      fieldId: f.fieldId,
      displayOrder: f.displayOrder,
      isRequired: f.isRequired,
      overrideOptions: f.overrideOptions ? JSON.stringify(f.overrideOptions) : null,
      overrideLabelTh: f.overrideLabelTh,
    };
    // Include new fields if present
    if (f.helpText) fieldValues.helpText = f.helpText;
    if (f.placeholder) fieldValues.placeholder = f.placeholder;
    if (f.validationRules) fieldValues.validationRules = JSON.stringify(f.validationRules);
    
    await db.insert(templateFields).values(fieldValues as any);
  }

  return c.json({ success: true, versionId }, 201);
});

// PATCH /admin/template-versions/:id/publish - DRAFT → PUBLISHED
adminRoutes.patch('/template-versions/:id/publish', auditMiddleware('TEMPLATE_VERSION'), async (c) => {
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
  
  await db.update(templateVersions).set({ status: 'PUBLISHED' }).where(eq(templateVersions.id, id));
  return c.json({ success: true });
});

// PATCH /admin/template-versions/:id/archive - PUBLISHED → ARCHIVED
adminRoutes.patch('/template-versions/:id/archive', auditMiddleware('TEMPLATE_VERSION'), async (c) => {
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
  
  // Check if any active rounds are using this version
  const activeRounds = await db.select()
    .from(recruitmentRounds)
    .where(and(
      eq(recruitmentRounds.templateVersionId, id),
      eq(recruitmentRounds.status, 'ACTIVE')
    ));
  
  if (activeRounds.length > 0) {
    return c.json({ error: 'Cannot archive version that is used by active rounds', activeRounds: activeRounds.length }, 400);
  }
  
  await db.update(templateVersions).set({ status: 'ARCHIVED' }).where(eq(templateVersions.id, id));
  return c.json({ success: true });
});

// DELETE /admin/template-versions/:id - Delete DRAFT version only
adminRoutes.delete('/template-versions/:id', auditMiddleware('TEMPLATE_VERSION'), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  
  // Get current version
  const version = await db.select().from(templateVersions).where(eq(templateVersions.id, id)).get();
  if (!version) {
    return c.json({ error: 'Version not found' }, 404);
  }
  
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

adminRoutes.get('/rounds', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(recruitmentRounds) }));
adminRoutes.post('/rounds', auditMiddleware('RECRUITMENT_ROUND'), zValidator('json', RecruitmentRoundCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json');
  const id = uuidv4();

  await db.insert(recruitmentRounds).values({
    id,
    templateVersionId: data.templateVersionId,
    title: data.title,
    positionLevel: data.positionLevel,
    openDate: new Date(data.openDate * 1000), // Convert Unix timestamp to Date
    closeDate: new Date(data.closeDate * 1000), // Convert Unix timestamp to Date
    status: data.status,
  });
  return c.json({ success: true, id }, 201);
});

// PATCH round: แก้ได้เฉพาะ metadata เท่านั้น (title, positionLevel, openDate, closeDate, status)
// ห้ามเปลี่ยน templateVersionId ทุกสถานะ (DRAFT, ACTIVE, CLOSED)
adminRoutes.patch('/rounds/:id', auditMiddleware('RECRUITMENT_ROUND'), zValidator('json', RecruitmentRoundUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json');

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

  const updateValues: any = { ...data };
  if (data.openDate !== undefined) updateValues.openDate = new Date(data.openDate * 1000);
  if (data.closeDate !== undefined) updateValues.closeDate = new Date(data.closeDate * 1000);
  await db.update(recruitmentRounds).set(updateValues).where(eq(recruitmentRounds.id, id));
  return c.json({ success: true });
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
adminRoutes.patch('/applications/:id/status', auditMiddleware('APPLICATION'), zValidator('json', ApplicationStatusUpdateSchema), async (c) => {
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

  const now = new Date();
  
  try {
    await db
      .update(applications)
      .set({
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: now
      })
      .where(eq(applications.id, id));

    return c.json({
      success: true,
      data: {
        id,
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: Math.floor(now.getTime() / 1000)
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
      verifiedAt: app.verifiedAt ? Math.floor(new Date(app.verifiedAt).getTime() / 1000) : null,
      formData: app.formData,
      submittedAt: app.submittedAt ? Math.floor(new Date(app.submittedAt).getTime() / 1000) : null,
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
    createdAt: log.createdAt ? Math.floor(new Date(log.createdAt).getTime() / 1000) : null
  }));

  return c.json({ data: history });
});

// POST /admin/applications/bulk-status - Bulk update application status
adminRoutes.post('/applications/bulk-status', auditMiddleware('APPLICATION'), async (c) => {
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

  const now = new Date();
  
  try {
    // Update all applications with matching IDs (not deleted)
    await db
      .update(applications)
      .set({
        status,
        statusReason: reason || null,
        verifiedBy: adminId,
        verifiedAt: now
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
        verifiedAt: Math.floor(now.getTime() / 1000)
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
    })
    .from(templateFields)
    .where(eq(templateFields.templateVersionId, fromId)),
    db.select({
      fieldId: templateFields.fieldId,
      isRequired: templateFields.isRequired,
    })
    .from(templateFields)
    .where(eq(templateFields.templateVersionId, toId)),
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
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
      },
    }
  });
});

// =============================================================================
// FEATURE 3: Clone Round API
// POST /admin/rounds/:id/clone
// =============================================================================
adminRoutes.post('/rounds/:id/clone', auditMiddleware('ROUND_CLONED'), async (c) => {
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
      }),
    });
  }
  
  return c.json({ 
    success: true, 
    id: newRoundId,
    message: `Cloned round "${newTitle}" with ${appCount} applications (not copied)`
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

adminRoutes.get('/audit-logs', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(auditLogs) }));

export { adminRoutes };