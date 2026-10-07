import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { sign } from 'hono/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { authMiddleware } from '../middlewares/auth.middleware';
import { auditMiddleware } from '../middlewares/audit.middleware';
import { adminUsers, fieldMaster, templates, templateVersions, templateFields, recruitmentRounds, applications, auditLogs } from '../db/schema';
import { LoginRequestSchema, FieldMasterCreateSchema, TemplateCreateSchema, TemplateVersionCreateSchema, RecruitmentRoundCreateSchema } from '../schemas/validators';

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

adminRoutes.get('/templates', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(templates) }));
adminRoutes.post('/templates', auditMiddleware('TEMPLATE'), zValidator('json', TemplateCreateSchema), async (c) => {
  const id = uuidv4();
  await drizzle(c.env.DB).insert(templates).values({ id, ...c.req.valid('json') });
  return c.json({ success: true, id }, 201);
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
  const id = uuidv4();
  await drizzle(c.env.DB).insert(recruitmentRounds).values({ id, ...c.req.valid('json') });
  return c.json({ success: true, id }, 201);
});

adminRoutes.get('/applications', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(applications) }));
adminRoutes.get('/audit-logs', async (c) => c.json({ data: await drizzle(c.env.DB).select().from(auditLogs) }));

export { adminRoutes };