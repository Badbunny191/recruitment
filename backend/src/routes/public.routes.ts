import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema } from '../schemas/validators';
import { recruitmentRounds, templateFields, fieldMaster, applications, applicationAttachments } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const publicRoutes = new Hono<{ Bindings: Bindings }>();

publicRoutes.get('/rounds/active', async (c) => {
  const db = drizzle(c.env.DB);
  const rounds = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.status, 'ACTIVE'));
  return c.json({ data: rounds });
});

publicRoutes.get('/rounds/:id/schema', async (c) => {
  const db = drizzle(c.env.DB);
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, c.req.param('id'))).get();
  if (!round) return c.json({ error: 'Not found' }, 404);

  const schema = await db.select({
    fieldId: templateFields.fieldId,
    type: fieldMaster.fieldType,
    label: fieldMaster.labelTh,
    overrideLabel: templateFields.overrideLabelTh,
    options: fieldMaster.defaultOptions,
    overrideOptions: templateFields.overrideOptions,
    isRequired: templateFields.isRequired,
    order: templateFields.displayOrder
  })
  .from(templateFields)
  .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
  .where(eq(templateFields.templateVersionId, round.templateVersionId))
  .orderBy(templateFields.displayOrder);

  return c.json({ data: schema });
});

publicRoutes.post('/applications/submit', zValidator('json', ApplicationSubmitSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json');
  const applicationId = uuidv4();
  const applicationNo = `APP-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  await db.batch([
    db.insert(applications).values({
      id: applicationId,
      applicationNo,
      roundId: data.roundId,
      email: data.email,
      fullname: data.fullname,
      nationalId: data.nationalId,
      formData: data.formData, // data.formData เป็น parsed object แล้ว (Zod parse) - Drizzle จะจัดการ JSON conversion เอง
      status: 'SUBMITTED',
    }),
    ...(data.attachments?.length ? data.attachments.map(att => 
      db.insert(applicationAttachments).values({
        id: uuidv4(),
        applicationId,
        fieldId: att.fieldId,
        fileUrl: att.fileUrl
      })
    ) : [])
  ]);

  // ส่งงานไปเข้าคิวทำ PDF เบื้องหลัง (ปิดชั่วคราวสำหรับ Demo)
  // TODO: เปิดใช้งานเมื่อพร้อม PDF Queue
  // await c.env.PDF_QUEUE.send({ applicationId, roundId: data.roundId });

  return c.json({ success: true, data: { applicationNo } }, 201);
});

export { publicRoutes };