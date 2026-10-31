import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema, ApplicationLookupSchema, CORE_FIELD_IDS } from '../schemas/validators';
import { recruitmentRounds, templateFields, templateSections, fieldMaster, applications, applicationAttachments, organizations } from '../db/schema';
import { eq, and, isNull, asc, sql, like, desc, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentBangkokYear, buildApplicationNo, parseApplicationNo } from '../utils/application-no';
import { sanitizeOriginalFilenameOrNull } from '../utils/filename';
import {
  buildApplicationPdfFilename,
  buildPdfContentDisposition,
} from '../utils/application-pdf-filename';
import { loadPdfFilenameContext } from '../services/application-pdf-context';
import {
  OTHER_OPTION_LABEL,
  extractOtherText,
  isOtherValue,
  appendOtherOption,
  parseOptionsArray,
} from '../lib/other-option';
import { buildApplicationNumber } from '../services/application-number.service';
import { buildPromoteAttachmentsStatements } from '../lib/attachment-ledger';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import { honeypotMiddleware } from '../middlewares/honeypot.middleware';
import { turnstileMiddleware } from '../middlewares/turnstile.middleware';
import { lookupApplication, getLookupRoundOptions } from '../services/applicant-lookup.service';
import { getApplicationPdf } from '../lib/pdf.service';
import { validateTextareaAnswer } from '../lib/textarea-validation';

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

/**
 * Public field schema loader (shared ระหว่าง GET /rounds/:id/schema กับ tests)
 * -----------------------------------------------------------------------------
 * คืน sections + normalized fields ของ template version
 * รวม Rich Field Metadata ของ TEXT/TEXTAREA: rows / minLength / maxLength
 * (null = ผู้ดูแลไม่ได้กำหนด — ห้ามแปลงค่าให้เป็น default ที่นี่
 *  เพื่อให้ client แยกแยะ "ไม่ได้ตั้ง" กับค่าจริงได้)
 *
 * ห้ามเพิ่ม admin-only columns (เช่น pdfMappingKey) ลงใน select นี้
 */
export async function loadPublicRoundSchemaFields(db: any, templateVersionId: string) {
  const sections = await db.select().from(templateSections)
    .where(eq(templateSections.templateVersionId, templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  const schema = await db.select({
    fieldId: templateFields.fieldId,
    sectionId: templateFields.sectionId, // Sprint 4: ref to section
    type: fieldMaster.fieldType,
    label: fieldMaster.labelTh,
    overrideLabel: templateFields.overrideLabelTh,
    options: fieldMaster.defaultOptions,
    overrideOptions: templateFields.overrideOptions,
    // Other Option Support — effective value (override ?? master)
    allowOther: sql`COALESCE(${templateFields.allowOther}, ${fieldMaster.allowOther})`,
    isRequired: templateFields.isRequired,
    helpText: sql`COALESCE(${templateFields.helpText}, ${fieldMaster.helpText})`,
    placeholder: sql`COALESCE(${templateFields.placeholder}, ${fieldMaster.placeholder})`,
    validationMessage: sql`COALESCE(${templateFields.validationMessage}, ${fieldMaster.validationMessage})`,
    // Rich Field Metadata (TEXT/TEXTAREA) — null = ไม่ได้กำหนด
    // rows = ความสูงเริ่มต้นของช่องกรอกบนหน้าจอ (ไม่มีผลต่อ PDF)
    // min/max = ความยาวคำตอบที่ผู้ดูแลกำหนด (maxlength ฝั่ง applicant ใช้ cap 5000 เอง)
    rows: templateFields.rows,
    minLength: templateFields.minLength,
    maxLength: templateFields.maxLength,
    section: fieldMaster.section, // Legacy: ใช้สำหรับ fallback (Sprint 3 behavior)
    fileConfig: fieldMaster.fileConfig,
    validationType: fieldMaster.validationType,
    order: templateFields.displayOrder
  })
  .from(templateFields)
  .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
  .where(eq(templateFields.templateVersionId, templateVersionId))
  .orderBy(templateFields.displayOrder);

  // Normalize MASTER_DATA fields:
  // defaultOptions for MASTER_DATA is { source: 'organizations' }, not string[].
  // Send it as a separate `masterDataSource` field so the frontend does not have
  // to guess, and drop the object from `options`.
  const normalized = schema.map((f: any) => {
    // ✅ Other Option Support — เติม option "อื่นๆ (โปรดระบุ)" ให้ฟิลด์ที่เปิด
    // allowOther (ผู้ดูแลไม่ต้องพิมพ์ label เอง) — idempotent
    //
    // ⚠️ Backward compatible: ถ้า field ไม่ได้เปิด allowOther → คืนค่าเดิม
    //    (ไม่แตะ options / overrideOptions เลย → แบบฟอร์มเดิมเหมือนเดิม 100%)
    const allowOtherEnabled = f.allowOther ? true : null;
    const parsedMasterOptions = parseOptionsArray(f.options);
    const parsedOverrideOptions = parseOptionsArray(f.overrideOptions);
    const effectiveOptions = allowOtherEnabled
      ? appendOtherOption(
          parsedOverrideOptions ?? parsedMasterOptions,
          allowOtherEnabled
        )
      : null;
    const effectiveOverrideOptions =
      allowOtherEnabled && f.overrideOptions
        ? appendOtherOption(parsedOverrideOptions, allowOtherEnabled)
        : null;

    if (f.type !== 'MASTER_DATA') {
      return {
        ...f,
        ...(allowOtherEnabled
          ? { options: effectiveOptions, overrideOptions: effectiveOverrideOptions }
          : {}),
        masterDataSource: null,
      };
    }

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

  return { sections, fields: normalized };
}

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
  // Hybrid Mode: return sections + fields (Sprint 4)
  // Frontend จะ fallback ไปใช้ fieldMaster.section ถ้า sections ว่าง
  const { sections, fields: normalized } = await loadPublicRoundSchemaFields(db, round.templateVersionId);

  return c.json({
    data: {
      sections: sections.filter((s: any) => s.isActive), // only active sections
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
    attachments?: Array<{ fieldId: string; fileUrl: string; filename?: string }>;
  },
): Promise<{ ok: true; applicationNo: string } | { ok: false; reason: 'UNIQUE_COLLISION' | 'DB_ERROR' | 'ROUND_ERROR' | 'INVALID_PATTERN' | 'DUPLICATE_EMAIL' }> {
  // =========================================================================
  // Migration 019 - ตรวจสอบว่า round ใช้ pattern แบบไหน
  // - application_pattern = NULL  → ใช้ format เดิม (APP-YYYY-NNNN)
  // - application_pattern != NULL → ใช้ pattern ใหม่
  // =========================================================================
  const round = await db
    .select({
      id: recruitmentRounds.id,
      applicationPattern: recruitmentRounds.applicationPattern,
    })
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, args.roundId))
    .get();

  if (!round) {
    return { ok: false, reason: 'ROUND_ERROR' };
  }

  // === Strategy B: Pattern ใหม่ — ใช้ buildApplicationNumber service ===
  if (round.applicationPattern) {
    const buildResult = await buildApplicationNumber(db, { roundId: args.roundId, applicationId: args.id });
    if (!buildResult.ok) {
      return {
        ok: false,
        reason: buildResult.reason === 'INVALID_PATTERN' ? 'INVALID_PATTERN' : 'ROUND_ERROR',
      };
    }
    const { applicationNo, snapshot } = buildResult;
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
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
            // Migration 019 - snapshot
            year: snapshot.year,
            roundCode: snapshot.roundCode,
            seqInRound: snapshot.seqInRound,
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
                // Migration 027 — sanitize ซ้ำฝั่ง backend ก่อนเก็บ ไม่เชื่อ client ตรงๆ
                originalFilename: sanitizeOriginalFilenameOrNull(att.filename),
              }),
            );
          }
          // ── Attachment Lifecycle (Migration 029) ──
          // TEMP → ACTIVE ใน batch เดียวกับ insert — submit สำเร็จ/ล้มพร้อมกัน
          // ไฟล์ที่ promote แล้วจึงไม่ถูก cron cleanup เก็บ
          statements.push(
            ...buildPromoteAttachmentsStatements(db, {
              applicationId: args.id,
              fileUrls: args.attachments.map((att) => att.fileUrl),
            }),
          );
        }
        await db.batch(statements as [any, ...any[]]);
        return { ok: true, applicationNo };
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        // TOCTOU backstop (Migration 030): duplicate check กับ insert ไม่ได้อยู่
        // ใน lock เดียวกัน — submit คู่ขนานที่แทรกผ่านมาได้จะชน idx_apps_round_email
        // ตอน insert ตรงนี้ ต้องคืน 400 ข้อความเดิม ไม่ใช่ปล่อยเป็น 500
        if (/UNIQUE constraint failed/i.test(msg) && /idx_apps_round_email/i.test(msg)) {
          return { ok: false, reason: 'DUPLICATE_EMAIL' };
        }
        if (/UNIQUE constraint failed: applications\.application_no/.test(msg) && attempt < maxRetries - 1) {
          // Pattern service already issued the number — collision shouldn't happen normally
          // but if it does (rare race), fail
          return { ok: false, reason: 'UNIQUE_COLLISION' };
        }
        return { ok: false, reason: 'DB_ERROR' };
      }
    }
    return { ok: false, reason: 'UNIQUE_COLLISION' };
  }

  // === Strategy A: Format เดิม (APP-YYYY-NNNN) — per-year global ===
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
              // Migration 027 — sanitize ซ้ำฝั่ง backend ก่อนเก็บ ไม่เชื่อ client ตรงๆ
              originalFilename: sanitizeOriginalFilenameOrNull(att.filename),
            }),
          );
        }
        // ── Attachment Lifecycle (Migration 029) ──
        // TEMP → ACTIVE ใน batch เดียวกับ insert — ดู path Strategy B
        statements.push(
          ...buildPromoteAttachmentsStatements(db, {
            applicationId: args.id,
            fileUrls: args.attachments.map((att) => att.fileUrl),
          }),
        );
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
      // TOCTOU backstop (Migration 030) — ดูคำอธิบายที่ catch ของ Strategy B:
      // unique จาก idx_apps_round_email = duplicate email จริง คืน DUPLICATE_EMAIL
      // (400) ไม่ retry และไม่ใช่ DB_ERROR/500
      if (/UNIQUE constraint failed/i.test(message) && /idx_apps_round_email/i.test(message)) {
        return { ok: false, reason: 'DUPLICATE_EMAIL' };
      }
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
  // PR #3: Cloudflare Turnstile verification. Sits AFTER the cheap,
  // fast layers (honeypot, rate-limit, idempotency) so most bot traffic
  // is rejected without making a siteverify round-trip. The middleware
  // is a no-op when TURNSTILE_ENABLED=false — see
  // `middlewares/turnstile.middleware.ts` for the full state machine.
  turnstileMiddleware(),
  zValidator('json', ApplicationSubmitSchema),
  async (c) => {
  const db = drizzle(c.env.DB);
  const data = c.req.valid('json');

  // Get template mapping for pdf_mapping_key
  const round = await db.select().from(recruitmentRounds).where(eq(recruitmentRounds.id, data.roundId)).get();
  if (!round) {
    return c.json({ success: false, error: 'รอบรับสมัครไม่พบ' }, 404);
  }

  // ✅ Block archived rounds (parity with /schema): deletedAt IS NOT NULL.
  // /schema blocks archived rounds, but submit did not — an admin archiving
  // a round before closeDate removed it from every page while a direct API
  // call could still create a real application. Checked BEFORE evaluateRound
  // (same order as /schema) so an archived DRAFT round reports ARCHIVED,
  // not DRAFT.
  if (round.deletedAt) {
    return c.json({
      success: false,
      error: 'Round นี้ถูก archive แล้ว ไม่สามารถรับสมัครได้',
      reason: 'ARCHIVED',
      status: round.status,
    }, 403);
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
      allowOther: sql`COALESCE(${templateFields.allowOther}, ${fieldMaster.allowOther})`,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(
      and(
        eq(templateFields.templateVersionId, round.templateVersionId),
        eq(templateFields.isRequired, true)
      )
    );

  // ✅ TEXTAREA answer validation — ตรวจความยาวคำตอบทุก field TEXTAREA ของรอบ
  // (required + optional), fallback ข้อมูลเก่า: minLength=null → ไม่บังคับ,
  // maxLength=null → Global Hard Cap 5000. ห้ามเชื่อ client validation อย่างเดียว
  const textareaFields = await db
    .select({
      fieldId: templateFields.fieldId,
      isRequired: templateFields.isRequired,
      minLength: templateFields.minLength,
      maxLength: templateFields.maxLength,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(
      and(
        eq(templateFields.templateVersionId, round.templateVersionId),
        eq(fieldMaster.fieldType, 'TEXTAREA')
      )
    );

  for (const textareaField of textareaFields) {
    const result = validateTextareaAnswer(data.formData?.[textareaField.fieldId], {
      fieldId: textareaField.fieldId,
      // คอลัมน์ is_required ไม่มี notNull → null เทียบเท่า default (true)
      isRequired: textareaField.isRequired ?? true,
      minLength: textareaField.minLength,
      maxLength: textareaField.maxLength,
    });
    if (!result.ok) {
      return c.json({
        success: false,
        error: result.code === 'REQUIRED_FIELD_EMPTY'
          ? `กรุณากรอกข้อมูลที่จำเป็น: ${result.fieldId}`
          : result.message,
        fieldId: result.fieldId,
        code: result.code,
      }, 400);
    }
  }

  // Validate required fields from template schema
  for (const requiredField of templateRequiredFields) {
    // ✅ Required FILE — คำตอบของ FILE field ไม่เคยอยู่ใน formData (ฝั่ง client
    // serialize ลง attachments เท่านั้น) จึงต้องตรวจจาก attachments: ผ่านเมื่อมี
    // attachment ≥ 1 รายการของ field นี้ (ครอบคลุมทั้ง single-file และ multi-file)
    // ค่าใน formData ยังยอมรับเหมือนเดิมเพื่อรองรับ payload รูปแบบเก่า
    const hasFileAttachment = requiredField.fieldType === 'FILE'
      ? (data.attachments ?? []).some((att) => att.fieldId === requiredField.fieldId)
      : false;
    const fieldValue = data.formData?.[requiredField.fieldId];
    if (!fieldValue && fieldValue !== 0 && !hasFileAttachment) { // Allow 0 as valid value
      return c.json({
        success: false,
        error: `กรุณากรอกข้อมูลที่จำเป็น: ${requiredField.fieldId}`
      }, 400);
    }

    // ✅ Other Option Support — ถ้าผู้สมัครเลือก "อื่นๆ (โปรดระบุ)"
    // และ field เป็น Required → ต้องกรอกข้อความเพิ่มเติม
    if (requiredField.allowOther && isOtherValue(fieldValue)) {
      const otherText = extractOtherText(data.formData, requiredField.fieldId);
      if (!otherText) {
        return c.json({
          success: false,
          error: `กรุณาระบุรายละเอียดเพิ่มเติมสำหรับตัวเลือก "${OTHER_OPTION_LABEL}"`
        }, 400);
      }
    }
  }

  // Check for duplicate application — Business Rule (Migration 030):
  // - ผู้สมัครมี active application ได้ 1 ใบต่อรอบ (active = ทุกสถานะยกเว้น CANCELED)
  // - CANCELED สมัครใหม่ได้ / ARCHIVED (เก็บเข้าคลัง) สมัครใหม่ไม่ได้ / คนละรอบอิสระกัน
  // - email เทียบ case-insensitive ด้วย lower() ให้ตรงกับ predicate ของ
  //   idx_apps_round_email (migration 030) — ทั้งสองชั้นบังคับกฎเดียวกัน
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
        sql`lower(${applications.email}) = lower(${email})`,
        isNull(applications.deletedAt),
        ne(applications.status, 'CANCELED')
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
    // TOCTOU backstop (Migration 030): duplicate รอดจาก check มาโดยแข่งเวลา →
    // ติด unique index ตอน insert — ตอบ 400 ข้อความเดียวกับ duplicate check
    if (insertResult.reason === 'DUPLICATE_EMAIL') {
      return c.json({
        success: false,
        error: 'ท่านได้สมัครรอบนี้แล้ว'
      }, 400);
    }
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

/**
 * GET /api/v1/public/rounds/lookup-options
 * -----------------------------------------------------------------------------
 * Returns active and closed recruitment rounds for applicant lookup dropdown.
 */
publicRoutes.get('/rounds/lookup-options', async (c) => {
  const db = drizzle(c.env.DB);
  const rounds = await getLookupRoundOptions(db);
  return c.json({ data: rounds });
});

/**
 * POST /api/v1/public/applications/lookup
 * -----------------------------------------------------------------------------
 * Applicant Lookup (Phase 1):
 * Finds an application by Round + Email + Phone only.
 * Returns applicationNo, positionTitle, roundTitle, submittedAt, status.
 */
publicRoutes.post(
  '/applications/lookup',
  rateLimitMiddleware({ keyPrefix: 'lookup', perMinute: 30 }),
  zValidator('json', ApplicationLookupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues?.[0]?.message || 'ข้อมูลที่ระบุไม่ถูกต้อง',
        },
        400
      );
    }
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const data = c.req.valid('json');
    const result = await lookupApplication(db, data);

    if (!result.ok) {
      return c.json(
        {
          success: false,
          error: result.message,
        },
        404
      );
    }

    return c.json({
      success: true,
      data: result.data,
    });
  }
);

/**
 * POST /api/v1/public/applications/download-pdf
 * -----------------------------------------------------------------------------
 * Public PDF download endpoint for applicant lookup.
 * Verifies roundId + email + phone to strictly ensure authorized download.
 * Returns the application PDF binary stream.
 */
publicRoutes.post(
  '/applications/download-pdf',
  rateLimitMiddleware({ keyPrefix: 'lookup-pdf', perMinute: 20 }),
  zValidator('json', ApplicationLookupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues?.[0]?.message || 'ข้อมูลที่ระบุไม่ถูกต้อง',
        },
        400
      );
    }
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const data = c.req.valid('json');
    const lookupResult = await lookupApplication(db, data);

    if (!lookupResult.ok) {
      return c.json(
        {
          success: false,
          error: lookupResult.message,
        },
        404
      );
    }

    try {
      const pdfResult = await getApplicationPdf(db, c.env.R2_BUCKET, lookupResult.data.applicationId);

      if (!pdfResult) {
        return c.json({ success: false, error: 'ไม่พบไฟล์ใบสมัครหรือเกิดข้อผิดพลาดในการสร้าง PDF' }, 500);
      }

      // ── Configurable PDF Filename (Migration 028) ──
      // ใช้ helper เดียวกับ Admin download (pattern จาก template version ของ round)
      // เพื่อให้ชื่อไฟล์เหมือนกันทุกตัวอักษร — ไม่เปิดเผย pattern/fullname เพิ่มใน error
      const filenameContext = await loadPdfFilenameContext(db, lookupResult.data.applicationId);
      const filename = buildApplicationPdfFilename(filenameContext ?? { applicationId: lookupResult.data.applicationId });
      const contentDisposition = buildPdfContentDisposition(filename, {
        applicationNo: filenameContext?.applicationNo,
        applicationId: lookupResult.data.applicationId,
      });

      return new Response(pdfResult.bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': contentDisposition,
          'Content-Length': String(pdfResult.bytes.length),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    } catch (err: any) {
      console.error('[Public PDF Download] Failed to generate PDF:', err);
      return c.json(
        {
          success: false,
          error: 'เกิดข้อผิดพลาดในการสร้างใบสมัคร PDF กรุณาลองใหม่อีกครั้ง',
        },
        500
      );
    }
  }
);

export { publicRoutes };