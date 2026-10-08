import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema, CORE_FIELD_IDS } from '../schemas/validators';
import { recruitmentRounds, templateFields, fieldMaster, applications, applicationAttachments } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
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
    helpText: fieldMaster.helpText,
    placeholder: fieldMaster.placeholder,
    section: fieldMaster.section,
    fileConfig: fieldMaster.fileConfig,
    validationType: fieldMaster.validationType,
    validationMessage: fieldMaster.validationMessage,
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

  // Get template mapping for pdf_mapping_key
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, data.roundId)).get();
  if (!round) {
    return c.json({ success: false, error: 'รอบรับสมัครไม่พบ' }, 404);
  }

  // Get template field mappings (fieldId -> pdfMappingKey)
  const templateMappings = await db
    .select({
      fieldId: templateFields.fieldId,
      pdfMappingKey: fieldMaster.pdfMappingKey,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, round.templateVersionId));

  // Build mapping: fieldId -> core column name
  const fieldToColumnMap: Record<string, string> = {};
  templateMappings.forEach(m => {
    if (m.pdfMappingKey) {
      fieldToColumnMap[m.fieldId] = m.pdfMappingKey;
    }
  });

  // Extract core values from formData using mapping
  const getCoreValue = (fieldId: string, fallback?: string): string => {
    // Try from formData first
    if (data.formData && data.formData[fieldId]) {
      return String(data.formData[fieldId]);
    }
    // Fallback to legacy root fields
    if (fieldId === 'field-email' && data.email) return data.email;
    if (fieldId === 'field-fullname' && data.fullname) return data.fullname;
    if (fieldId === 'field-national-id' && data.nationalId) return data.nationalId;
    return fallback || '';
  };

  const email = getCoreValue('field-email');
  const fullname = getCoreValue('field-fullname');
  const nationalId = getCoreValue('field-national-id');

  // Validate core fields are present
  if (!email) {
    return c.json({ success: false, error: 'อีเมลไม่พบในข้อมูล (field-email)' }, 400);
  }
  if (!fullname) {
    return c.json({ success: false, error: 'ชื่อ-นามสกุลไม่พบในข้อมูล (field-fullname)' }, 400);
  }
  if (!nationalId) {
    return c.json({ success: false, error: 'เลขประจำตัวประชาชนไม่พบในข้อมูล (field-national-id)' }, 400);
  }

  // Check for duplicate application (same email + same round, not deleted)
  const existingApp = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      status: applications.status
    })
    .from(applications)
    .where(
      and(
        eq(applications.roundId, data.roundId),
        eq(applications.email, email),
        isNull(applications.deletedAt)
      )
    )
    .get();

  if (existingApp) {
    return c.json({
      success: false,
      error: 'ท่านได้สมัครรอบนี้แล้ว',
      applicationNo: existingApp.applicationNo
    }, 400);
  }

  // Generate unique application number
  const applicationId = uuidv4();
  const applicationNo = `APP-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  await db.batch([
    db.insert(applications).values({
      id: applicationId,
      applicationNo,
      roundId: data.roundId,
      email,
      fullname,
      nationalId,
      formData: data.formData,
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

  return c.json({ success: true, data: { applicationNo } }, 201);
});

export { publicRoutes };