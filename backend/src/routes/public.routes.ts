import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema, CORE_FIELD_IDS } from '../schemas/validators';
import { recruitmentRounds, templateFields, templateSections, fieldMaster, applications, applicationAttachments, organizations } from '../db/schema';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const publicRoutes = new Hono<{ Bindings: Bindings }>();

// =============================================================
//  Timezone source of truth: Asia/Bangkok (UTC+7)
//
//  The `openDate` / `closeDate` columns are stored as `integer` in
//  `unixepoch()` seconds. The admin form saves these values as wall-clock
//  times in THAI time (Asia/Bangkok). That means the integer is *already*
//  offset by -7h relative to true UTC — i.e. the stored value represents
//  "what the wall clock in Bangkok would show at that UTC instant".
//
//  Because we are forbidden from using the client's local timezone, we
//  compute the *current* "Bangkok wall-clock" as: Date.now() + 7h.
//  Comparing against `round.openDate` / `round.closeDate` in the same
//  Bangkok wall-clock scale gives us a correct comparison that is
//  independent of the client machine's timezone.
//
//  Notes:
//  - `Date` arithmetic is in UTC ms; we only convert to a Bangkok offset
//    at the comparison boundary.
//  - This keeps the policy enforced server-side. The client can lie
//    about its clock and the gate still works.
// =============================================================
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const nowBangkokMs = (): number => Date.now() + BANGKOK_OFFSET_MS;

type DateLike = Date | number | string | null | undefined;

const toDate = (d: DateLike): Date | null => {
  if (d === null || d === undefined || d === '') return null;
  if (d instanceof Date) return d;
  if (typeof d === 'number') {
    // drizzle mode:'timestamp' returns Date already, but be defensive.
    return new Date(d < 1e12 ? d * 1000 : d);
  }
  return new Date(d);
};

/**
 * Evaluate a round's lifecycle for the public API.
 * Returns a structured gate result. `ok: true` means "open for application".
 */
type GateReason = 'DRAFT' | 'CLOSED' | 'NOT_OPEN_YET' | 'ALREADY_CLOSED';
type GateResult =
  | { ok: true }
  | { ok: false; message: string; reason: GateReason };

const evaluateRound = (round: {
  status: string | null;
  openDate: DateLike;
  closeDate: DateLike;
}): GateResult => {
  const status = (round.status ?? 'DRAFT').toUpperCase();
  // 1. DRAFT and CLOSED short-circuit before any date comparison.
  if (status === 'DRAFT') {
    return { ok: false, reason: 'DRAFT', message: 'ขณะนี้ยังไม่เปิดรับสมัคร' };
  }
  if (status === 'CLOSED') {
    return { ok: false, reason: 'CLOSED', message: 'ปิดรับสมัครแล้ว' };
  }

  // 2. status === 'ACTIVE' → enforce the open/close window in Bangkok time.
  const open = toDate(round.openDate);
  const close = toDate(round.closeDate);
  if (!open || !close) {
    return { ok: false, reason: 'ALREADY_CLOSED', message: 'ปิดรับสมัครแล้ว' };
  }

  const now = nowBangkokMs();

  // `open`/`close` are UTC instants. To compare in the Bangkok wall-clock
  // scale, shift the round endpoints by +7h so they line up with the
  // shifted-now value.
  const openBkk = open.getTime() + BANGKOK_OFFSET_MS;
  const closeBkk = close.getTime() + BANGKOK_OFFSET_MS;

  if (now < openBkk) {
    return { ok: false, reason: 'NOT_OPEN_YET', message: 'ยังไม่ถึงวันเปิดรับสมัคร' };
  }
  if (now > closeBkk) {
    return { ok: false, reason: 'ALREADY_CLOSED', message: 'ปิดรับสมัครแล้ว' };
  }

  return { ok: true };
};

// =============================================================================
// MASTER DATA - Phase 1 (organizations only)
// =============================================================================
// Public, unauthenticated. Only active records, ordered by displayOrder.
publicRoutes.get('/master-data/organizations', async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.isActive, true))
    .orderBy(asc(organizations.displayOrder));

  return c.json({ data: rows });
});

publicRoutes.get('/rounds/active', async (c) => {
  const db = drizzle(c.env.DB);
  const rounds = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.status, 'ACTIVE'));
  return c.json({ data: rounds });
});

publicRoutes.get('/rounds/:id/schema', async (c) => {
  const db = drizzle(c.env.DB);
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, c.req.param('id'))).get();
  if (!round) return c.json({ error: 'Not found' }, 404);

  // ✅ Business rule: gate by status (DRAFT/CLOSED) AND by Asia/Bangkok time
  // window when status is ACTIVE. See the evaluateRound() helper above for
  // the timezone math.
  const gate = evaluateRound(round);
  if (!gate.ok) {
    return c.json({ success: false, error: gate.message, reason: gate.reason, status: round.status }, 403);
  }

  // Sprint 4: Fetch sections (ordered) for sectioned layout
  const sections = await db.select().from(templateSections)
    .where(eq(templateSections.templateVersionId, round.templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  const schema = await db.select({
    fieldId: templateFields.fieldId,
    sectionId: templateFields.sectionId, // Sprint 4: ref to section
    type: fieldMaster.fieldType,
    label: fieldMaster.labelTh,
    overrideLabel: templateFields.overrideLabelTh,
    options: fieldMaster.defaultOptions,
    overrideOptions: templateFields.overrideOptions,
    isRequired: templateFields.isRequired,
    helpText: sql`COALESCE(${templateFields.helpText}, ${fieldMaster.helpText})`,
    placeholder: sql`COALESCE(${templateFields.placeholder}, ${fieldMaster.placeholder})`,
    section: fieldMaster.section, // Legacy: ใช้สำหรับ fallback (Sprint 3 behavior)
    fileConfig: fieldMaster.fileConfig,
    validationType: fieldMaster.validationType,
    validationMessage: fieldMaster.validationMessage,
    order: templateFields.displayOrder
  })
  .from(templateFields)
  .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
  .where(eq(templateFields.templateVersionId, round.templateVersionId))
  .orderBy(templateFields.displayOrder);

  // Normalize MASTER_DATA fields:
  // defaultOptions for MASTER_DATA is { source: 'organizations' }, not string[].
  // Send it as a separate `masterDataSource` field so the frontend does not have
  // to guess, and drop the object from `options`.
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

  // Hybrid Mode: return sections + fields (Sprint 4)
  // Frontend จะ fallback ไปใช้ fieldMaster.section ถ้า sections ว่าง
  return c.json({
    data: {
      sections: sections.filter(s => s.isActive), // only active sections
      fields: normalized,
    }
  });
});

// ✅ Public round detail endpoint for the apply-page error state (DRAFT / CLOSED).
// Returns the same shape as /public/rounds/active rows, plus the parsed
// announcement fields, so the frontend can render an informative Error Page
// when /schema is blocked by the 403 status gate. The shape is intentionally
// minimal — it MUST NOT include schema fields, pdf mappings, or anything
// reserved for the application form.
publicRoutes.get('/rounds/:id/detail', async (c) => {
  const db = drizzle(c.env.DB);
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
    })
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, c.req.param('id')))
    .get();

  if (!round) return c.json({ success: false, error: 'ไม่พบรอบรับสมัคร' }, 404);

  return c.json({ success: true, data: round });
});

publicRoutes.post('/applications/submit', zValidator('json', ApplicationSubmitSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json');

  // Get template mapping for pdf_mapping_key
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, data.roundId)).get();
  if (!round) {
    return c.json({ success: false, error: 'รอบรับสมัครไม่พบ' }, 404);
  }

  // ✅ Business rule: same gate as /schema — DRAFT/CLOSED short-circuit, and
  // ACTIVE rounds enforce the open/close window in Asia/Bangkok time. The
  // gate is server-side so a malicious client cannot bypass it by spoofing
  // the system clock.
  const gate = evaluateRound(round);
  if (!gate.ok) {
    return c.json({ success: false, error: gate.message, reason: gate.reason, status: round.status }, 403);
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