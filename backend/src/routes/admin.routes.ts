import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { sign } from 'hono/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, ne, isNull, count } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { authMiddleware } from '../middlewares/auth.middleware';
import { auditMiddleware } from '../middlewares/audit.middleware';
import { adminUsers, fieldMaster, templates, templateVersions, templateFields, recruitmentRounds, applications, auditLogs } from '../db/schema';
import { LoginRequestSchema, FieldMasterCreateSchema, FieldMasterUpdateSchema, TemplateCreateSchema, TemplateUpdateSchema, TemplateVersionCreateSchema, RecruitmentRoundCreateSchema, RecruitmentRoundUpdateSchema } from '../schemas/validators';

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

adminRoutes.get('/applications', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(applications) }));
adminRoutes.get('/audit-logs', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(auditLogs) }));

export { adminRoutes };