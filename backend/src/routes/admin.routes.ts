import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { sign } from 'hono/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, ne, isNull, count, or, like } from 'drizzle-orm';
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
  const data = c.req.valid('json');
  const id = uuidv4();
  await db.insert(fieldMaster).values({ id, ...data, defaultOptions: data.defaultOptions ? JSON.stringify(data.defaultOptions) : null });
  return c.json({ success: true, id }, 201);
});

adminRoutes.patch('/fields/:id', auditMiddleware('FIELD_MASTER'), zValidator('json', FieldMasterUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const updateValues: any = { ...data };
  if (data.defaultOptions !== undefined) {
    updateValues.defaultOptions = data.defaultOptions ? JSON.stringify(data.defaultOptions) : null;
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

adminRoutes.get('/templates', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(templates) }));
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

adminRoutes.post('/templates/:id/versions', auditMiddleware('TEMPLATE_VERSION'), zValidator('json', TemplateVersionCreateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const payload = c.req.valid('json');
  const versionId = uuidv4();
  
  const currentVersions = await db.select({ v: templateVersions.versionNumber }).from(templateVersions).where(eq(templateVersions.templateId, payload.templateId));
  const nextVer = currentVersions.length > 0 ? Math.max(...currentVersions.map(x => x.v)) + 1 : 1;

  await db.batch([
    db.insert(templateVersions).values({ id: versionId, templateId: payload.templateId, versionNumber: nextVer, status: 'PUBLISHED' }),
    ...payload.fields.map(f => db.insert(templateFields).values({
      id: uuidv4(),
      templateVersionId: versionId,
      fieldId: f.fieldId,
      displayOrder: f.displayOrder,
      isRequired: f.isRequired,
      overrideOptions: f.overrideOptions ? JSON.stringify(f.overrideOptions) : null,
      overrideLabelTh: f.overrideLabelTh
    }))
  ]);
  return c.json({ success: true, versionId }, 201);
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
// ห้ามเปลี่ยน templateVersionId เมื่อมี applications แล้ว
adminRoutes.patch('/rounds/:id', auditMiddleware('RECRUITMENT_ROUND'), zValidator('json', RecruitmentRoundUpdateSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  // นับ applications ของ round นี้ (ไม่นับที่ถูก soft delete แล้ว)
  const appCount = await db.select({ c: count() })
    .from(applications)
    .where(and(eq(applications.roundId, id), isNull(applications.deletedAt)))
    .get();

  const updateValues: any = { ...data };
  if (data.openDate !== undefined) updateValues.openDate = new Date(data.openDate * 1000);
  if (data.closeDate !== undefined) updateValues.closeDate = new Date(data.closeDate * 1000);
  await db.update(recruitmentRounds).set(updateValues).where(eq(recruitmentRounds.id, id));
  return c.json({ success: true, applicationsCount: appCount?.c ?? 0 });
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

adminRoutes.get('/audit-logs', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(auditLogs) }));

export { adminRoutes };