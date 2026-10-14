import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema, CORE_FIELD_IDS } from '../schemas/validators';
import { recruitmentRounds, templateFields, templateSections, fieldMaster, applications, applicationAttachments, organizations } from '../db/schema';
import { eq, and, isNull, asc, sql, like, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentBangkokYear, buildApplicationNo, parseApplicationNo } from '../utils/application-no';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import { honeypotMiddleware } from '../middlewares/honeypot.middleware';

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
  // Exclude archived rounds (deletedAt IS NOT NULL)
  const rounds = await db.select().from(recruitmentRounds)
    .where(and(eq(recruitmentRounds.status, 'ACTIVE'), isNull(recruitmentRounds.deletedAt)));
  return c.json({ data: rounds });
});

publicRoutes.get('/rounds/:id/schema', async (c) => {
  const db = drizzle(c.env.DB);
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, c.req.param('id'))).get();
  if (!round) return c.json({ error: 'Not found' }, 404);

  // ✅ Block archived rounds: deletedAt IS NOT NULL
  if (round.deletedAt) {
    return c.json({
      success: false,
      error: 'Round นี้ถูก archive แล้ว ไม่สามารถรับสมัครได้',
      reason: 'ARCHIVED',
      status: round.status,
    }, 403);
  }

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
    validationMessage: sql`COALESCE(${templateFields.validationMessage}, ${fieldMaster.validationMessage})`,
    section: fieldMaster.section, // Legacy: ใช้สำหรับ fallback (Sprint 3 behavior)
    fileConfig: fieldMaster.fileConfig,
    validationType: fieldMaster.validationType,
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
    .where(and(eq(recruitmentRounds.id, c.req.param('id')), isNull(recruitmentRounds.deletedAt)))
    .get();

  if (!round) return c.json({ success: false, error: 'ไม่พบรอบรับสมัคร' }, 404);

  return c.json({ success: true, data: round });
});

/**
 * =============================================================================
 * Application No Generation (PR #1 hardening)
 * =============================================================================
 * The legacy generator used `Math.random()` against `new Date().getFullYear()`.
 * That has two problems:
 *   1. Random collisions: under load, two concurrent submissions can produce
 *      the same number and the `UNIQUE` constraint on `applications.application_no`
 *      will reject one of them, surfacing as a 500 to the user.
 *   2. UTC drift: `new Date().getFullYear()` uses UTC, so on 1 Jan 00:30
 *      Thailand time the generator emits last year's number (e.g. APP-2026
 *      instead of APP-2027).
 *
 * The replacement:
 *   - Reads the current Bangkok year from a single helper.
 *   - Queries D1 for the highest existing sequence in that year using
 *     `application_no LIKE 'APP-YYYY-%'`, ordered descending.
 *   - Increments by 1, formats via `buildApplicationNo`.
 *   - If the UNIQUE constraint still trips (extremely rare race: two isolates
 *     both computed the same MAX at the same instant), retry up to 5 times.
 *   - After 5 attempts, return 503 so the client can retry.
 *
 * IMPORTANT: this preserves the existing public format
 * (`APP-YYYY-NNNN`) and is fully backward-compatible with the admin UI.
 */

/**
 * Find the highest sequence number in D1 for the given Bangkok year.
 * Returns 0 if no applications exist for the year.
 *
 * The query is a single-row scan that asks D1 for the max applicationNo
 * whose prefix matches `APP-YYYY-`. We use `like` + `desc()` + `limit(1)`
 * to keep the read cheap even as the table grows.
 */
async function getMaxSequenceForYear(
  db: ReturnType<typeof drizzle<any>>,
  year: number,
): Promise<number> {
  const prefix = `APP-${year}-`;
  const row = await db
    .select({ applicationNo: applications.applicationNo })
    .from(applications)
    .where(like(applications.applicationNo, `${prefix}%`))
    .orderBy(desc(applications.applicationNo))
    .limit(1)
    .get();

  if (!row || !row.applicationNo) return 0;
  const parsed = parseApplicationNo(row.applicationNo);
  if (!parsed || parsed.year !== year) return 0;
  return parsed.sequence;
}

/**
 * Attempts to insert a new application with a unique applicationNo.
 * Retries up to `maxRetries` times if a UNIQUE constraint is tripped.
 * Returns either the inserted applicationNo (success) or an error code.
 */
async function insertApplicationWithRetry(
  db: ReturnType<typeof drizzle<any>>,
  args: {
    id: string;
    roundId: string;
    email: string;
    fullname: string;
    nationalId: string | null;
    formData: Record<string, unknown>;
    attachments?: Array<{ fieldId: string; fileUrl: string }>;
  },
): Promise<{ ok: true; applicationNo: string } | { ok: false; reason: 'UNIQUE_COLLISION' | 'DB_ERROR' }> {
  const year = getCurrentBangkokYear();
  let nextSequence = (await getMaxSequenceForYear(db, year)) + 1;
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const applicationNo = buildApplicationNo(year, nextSequence);
    try {
      // Drizzle's `db.batch` requires a tuple type which doesn't naturally
      // come out of an array with conditional `.push()`. The runtime
      // accepts the `any[]` and D1's batch() implementation is correct
      // for all SQLite insert builders, so we type this as `any[]` and
      // trust the integration.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statements: any[] = [
        db.insert(applications).values({
          id: args.id,
          applicationNo,
          roundId: args.roundId,
          email: args.email,
          fullname: args.fullname,
          nationalId: args.nationalId,
          formData: args.formData,
          status: 'SUBMITTED',
        }),
      ];
      if (args.attachments && args.attachments.length) {
        for (const att of args.attachments) {
          statements.push(
            db.insert(applicationAttachments).values({
              id: uuidv4(),
              applicationId: args.id,
              fieldId: att.fieldId,
              fileUrl: att.fileUrl,
            }),
          );
        }
      }
      await db.batch(statements as [any, ...any[]]);
      return { ok: true, applicationNo };
    } catch (err: any) {
      // =========================================================================
      //  UNIQUE-collision detection (narrow)
      // =========================================================================
      // We only retry when the failure is a *real* `applicationNo` collision.
      // Any other constraint failure (CHECK, FOREIGN KEY, NOT NULL) or generic
      // DB error (timeout, network, syntax) is propagated as `DB_ERROR` and
      // surfaced to the client as HTTP 500 / 503 — retrying those would just
      // burn quota without changing the outcome.
      //
      // Why narrow the regex: the previous pattern `/UNIQUE|constraint failed/i`
      // also matched `CHECK constraint failed` and `FOREIGN KEY constraint
      // failed`, causing 5 wasted retries on failures that can never succeed
      // (e.g. invalid `status` enum → `chk_app_status`).
      //
      // D1/SQLite error formats we recognize (any of these triggers retry):
      //
      //   1. `D1_ERROR: UNIQUE constraint failed: applications.application_no`
      //   2. `SqliteError: UNIQUE constraint failed: applications.application_no`
      //   3. `SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: applications.application_no`
      //   4. `D1_EXEC_ERROR: UNIQUE constraint failed: applications.application_no`
      //      (or any other prefix; what matters is the literal substring
      //      `UNIQUE constraint failed` and the table name `applications`)
      //   5. The narrow `applications` table check protects us from
      //      accidentally retrying on a UNIQUE violation from a *different*
      //      table (e.g. `admin_users.email`) where MAX+1 wouldn't help.
      //
      // D1 error formats we explicitly DO NOT retry:
      //
      //   - `D1_ERROR: Network connection lost`        → DB_ERROR
      //   - `Error: Request timeout`                   → DB_ERROR
      //   - `SqliteError: near "FROM": syntax error`   → DB_ERROR
      //   - `SqliteError: FOREIGN KEY constraint failed` → DB_ERROR
      //   - `SqliteError: CHECK constraint failed: chk_app_status` → DB_ERROR
      //   - `SqliteError: NOT NULL constraint failed: applications.email` → DB_ERROR
      // =========================================================================
      const message = String(err?.message ?? err);
      const isApplicationNoUniqueViolation =
        /UNIQUE constraint failed/i.test(message) &&
        /applications/i.test(message);
      if (!isApplicationNoUniqueViolation) {
        console.error('insertApplicationWithRetry: non-unique error', err);
        return { ok: false, reason: 'DB_ERROR' };
      }
      // Re-read the current MAX in case another request raced us.
      nextSequence = (await getMaxSequenceForYear(db, year)) + 1;
    }
  }

  return { ok: false, reason: 'UNIQUE_COLLISION' };
}

publicRoutes.post('/applications/submit',
  honeypotMiddleware(),
  rateLimitMiddleware(),
  idempotencyMiddleware(),
  zValidator('json', ApplicationSubmitSchema),
  async (c) => {
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
    // Fallback to legacy root fields (backward compatibility only)
    if (fieldId === 'field-email' && data.email) return data.email;
    if (fieldId === 'field-fullname' && data.fullname) return data.fullname;
    return fallback || '';
  };

  const email = getCoreValue('field-email');
  const fullname = getCoreValue('field-fullname');

  // Validate email and fullname are present
  if (!email) {
    return c.json({ success: false, error: 'อีเมลไม่พบในข้อมูล (field-email)' }, 400);
  }
  if (!fullname) {
    return c.json({ success: false, error: 'ชื่อ-นามสกุลไม่พบในข้อมูล (field-fullname)' }, 400);
  }

  // ✅ Dynamic validation: only validate fields that exist in template schema
  // Get required fields from template
  const templateRequiredFields = await db
    .select({
      fieldId: templateFields.fieldId,
      fieldType: fieldMaster.fieldType,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(
      and(
        eq(templateFields.templateVersionId, round.templateVersionId),
        eq(templateFields.isRequired, true)
      )
    );

  // Validate required fields from template schema
  for (const requiredField of templateRequiredFields) {
    const fieldValue = data.formData?.[requiredField.fieldId];
    if (!fieldValue && fieldValue !== 0) { // Allow 0 as valid value
      return c.json({ 
        success: false, 
        error: `กรุณากรอกข้อมูลที่จำเป็น: ${requiredField.fieldId}` 
      }, 400);
    }
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

  // Resolve nationalId from the template mapping (if the template has it).
  // Mirrors the legacy behavior: only set when a field is mapped to the
  // `national_id` core column. Otherwise null.
  const nationalIdFieldId = Object.entries(fieldToColumnMap).find(
    ([, col]) => col === 'national_id',
  )?.[0];
  const nationalId = nationalIdFieldId ? getCoreValue(nationalIdFieldId) : null;

  // Generate a unique application number (Bangkok year, MAX+1, with
  // UNIQUE-collision retry). See `insertApplicationWithRetry` for the
  // full retry/limit policy. The legacy `Math.random()` path is gone.
  const applicationId = uuidv4();
  const insertResult = await insertApplicationWithRetry(db, {
    id: applicationId,
    roundId: data.roundId,
    email,
    fullname,
    nationalId,
    formData: data.formData as Record<string, unknown>,
    attachments: data.attachments,
  });

  if (!insertResult.ok) {
    if (insertResult.reason === 'UNIQUE_COLLISION') {
      return c.json({
        success: false,
        error: 'ไม่สามารถสร้างเลขที่ใบสมัครได้ในขณะนี้ กรุณาลองอีกครั้ง',
        reason: 'APP_NO_COLLISION',
      }, 503);
    }
    return c.json({ success: false, error: 'ไม่สามารถบันทึกใบสมัครได้' }, 500);
  }

  return c.json({ success: true, data: { applicationNo: insertResult.applicationNo } }, 201);
});

/**
 * GET /api/v1/public/config
 * -----------------------------------------------------------------------------
 * Public, cache-friendly runtime config endpoint. Returns non-secret
 * environment values the frontend needs to bootstrap anti-bot protection
 * (e.g. the Turnstile site key) without bundling them at build time.
 *
 * Cache strategy:
 *   - We send `Cache-Control: public, max-age=60` so a CDN/edge can
 *     coalesce calls. The values are not user-specific and change
 *     rarely, so a short cache is safe.
 *   - No auth required. This is the "public" surface.
 *
 * Backward compatibility:
 *   - The `data.turnstile` object always exists. `enabled` is always
 *     a boolean. `siteKey` is always a string (empty when disabled).
 *     Clients can safely read these without null checks.
 */
publicRoutes.get('/config', (c) => {
  const enabled = String(c.env.TURNSTILE_ENABLED ?? 'false').toLowerCase() === 'true';
  const siteKey = c.env.TURNSTILE_SITE_KEY ?? '';

  // If Turnstile is enabled but the site key is missing, fail soft
  // (return disabled) so the frontend treats the form as unprotected
  // rather than breaking the page.
  const effectiveEnabled = enabled && siteKey.trim().length > 0;

  c.header('Cache-Control', 'public, max-age=60');

  return c.json({
    success: true,
    data: {
      turnstile: {
        enabled: effectiveEnabled,
        siteKey: effectiveEnabled ? siteKey : '',
      },
    },
  });
});

export { publicRoutes };