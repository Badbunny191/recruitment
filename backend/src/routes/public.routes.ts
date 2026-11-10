import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings } from '../types';
import { ApplicationSubmitSchema, ApplicationLookupSchema, CORE_FIELD_IDS } from '../schemas/validators';
import { recruitmentRounds, templateFields, templateSections, fieldMaster, applications, applicationAttachments, attachmentUploads, organizations } from '../db/schema';
import { eq, and, isNull, asc, sql, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentBangkokYear, buildApplicationNo } from '../utils/application-no';
import { sanitizeOriginalFilenameOrNull, extractR2KeyFromFileUrl } from '../utils/filename';
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
import { buildApplicationNumber, getMaxSequenceForYear } from '../services/application-number.service';
import { buildPromoteAttachmentsStatements } from '../lib/attachment-ledger';
import { SYSTEM_ADMIN_ID, writeAudit, writeAuditBatch } from '../services/audit.service';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import { honeypotMiddleware } from '../middlewares/honeypot.middleware';
import { turnstileMiddleware } from '../middlewares/turnstile.middleware';
import { submitFailureLoggerMiddleware } from '../middlewares/submit-failure.middleware';
import { lookupApplication, getLookupRoundOptions } from '../services/applicant-lookup.service';
import { getApplicationPdf } from '../lib/pdf.service';
import { validateTextareaAnswer } from '../lib/textarea-validation';
import {
  groupRounds,
  resolveRoundPhase,
  type RoundVisibilityInput,
} from '../lib/round-visibility';

const publicRoutes = new Hono<{ Bindings: Bindings }>();

// =============================================================
//  Timezone: Asia/Bangkok (UTC+7)
//
//  `open_date` / `close_date` เป็น integer (unixepoch) ของค่าที่แอดมินกรอก
//  ผ่าน <input type="datetime-local"> ซึ่งเบราว์เซอร์ตีความเป็นเวลาไทย
//  → ค่าที่เก็บจึงเป็น UTC instant ที่ถูกต้องอยู่แล้ว
//  การเทียบทำบน UTC ms ตรง ๆ ไม่ต้องบวก offset
//
//  ⚠️ กติกาเปิด/ปิด **ไม่ได้อยู่ที่ไฟล์นี้แล้ว**
//  ย้ายไปที่ backend/src/lib/round-visibility.ts (resolveRoundPhase)
//  เพื่อให้ endpoint /rounds/active, gate ตอน submit และ unit test
//  ใช้กติกาเดียวกัน — แก้ที่เดียว
// =============================================================

type DateLike = Date | number | string | null | undefined;

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
  // กติกาเปิด/ปิดอยู่ที่ lib/round-visibility.ts ที่เดียว — ไฟล์นี้ไม่คำนวณเวลาเอง
  // (เดิมมี BANGKOK_OFFSET_MS สองฝั่งที่ตัดกันเอง เก็บไว้เป็น dead code ไม่มีประโยชน์)
  const phase = resolveRoundPhase(round, Date.now());

  switch (phase) {
    case 'OPEN':
      return { ok: true };
    case 'DRAFT':
      return { ok: false, reason: 'DRAFT', message: 'ขณะนี้ยังไม่เปิดรับสมัคร' };
    case 'UPCOMING':
      return { ok: false, reason: 'NOT_OPEN_YET', message: 'ยังไม่ถึงวันเปิดรับสมัคร' };
    case 'CLOSED':
    default:
      return { ok: false, reason: 'ALREADY_CLOSED', message: 'ปิดรับสมัครแล้ว' };
  }
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

/**
 * GET /api/v1/public/rounds/active
 * -----------------------------------------------------------------------------
 * รอบรับสมัครสำหรับหน้าแรก — backend เป็น source of truth ของ "สถานะที่ผู้ใช้เห็น"
 *
 * ปัญหาเดิม: endpoint นี้กรองแค่ status = 'ACTIVE' ไม่ได้เทียบ closeDate
 * ทำให้รอบที่เลยกำหนดปิดไปแล้วยังถูกส่งขึ้นหน้าแรก และไปโผล่ใต้หัวข้อ
 * "รอบรับสมัครที่เปิดอยู่" — frontend ต้องเดาเองว่าอันไหนปิดแล้ว
 *
 * Response ใหม่ (ไม่มี migration / ไม่เพิ่ม column):
 *   {
 *     data: {
 *       open:     [...],   // ACTIVE + openDate <= now <= closeDate  (closeDate ASC)
 *       upcoming: [...],   // ACTIVE + now < openDate               (openDate ASC)
 *       closed:   [...],   // CLOSED หรือ ACTIVE ที่เลย closeDate   (closeDate DESC)
 *       serverTime: 1762...  // epoch ms ฝั่งเซิร์ฟเวอร์ ใช้ทำ countdown
 *     }
 *   }
 *
 * กติกาอยู่ที่ backend/src/lib/round-visibility.ts (ใช้ร่วมกับ unit test)
 *
 * ⚠️ Backward compatibility
 *   `data` เดิมเป็น array — ผู้ใช้รายเดิมมี /lookup ที่เรียก endpoint นี้เป็น
 *   fallback จึงคงรูป array ไว้ที่ `data` เหมือนเดิม (แต่กรองเฉพาะที่ยังเปิดจริง)
 *   และเพิ่ม `groups` เป็นก้อนใหม่สำหรับหน้าแรก
 *   → ไม่มีใครพัง และหน้าแรกอ่าน `groups` ได้ตรง ๆ
 */
publicRoutes.get('/rounds/active', async (c) => {
  const db = drizzle(c.env.DB);

  // DRAFT ไม่ถูกดึงมาเลย (ยังไม่ประกาศ) — ที่เหลือปล่อยให้ groupRounds จัดกลุ่ม
  const rounds = await db.select().from(recruitmentRounds)
    .where(
      and(
        ne(recruitmentRounds.status, 'DRAFT'),
        isNull(recruitmentRounds.deletedAt),
      ),
    );

  const nowMs = Date.now();
  const groups = groupRounds(
    rounds as unknown as Array<RoundVisibilityInput & Record<string, unknown>>,
    nowMs,
  );

  return c.json({
    // legacy shape — array ของรอบที่สมัครได้จริงตอนนี้
    data: groups.open,
    // shape ใหม่สำหรับหน้าแรก
    groups: {
      open: groups.open,
      upcoming: groups.upcoming,
      closed: groups.closed,
    },
    serverTime: nowMs,
  });
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
    // serverTime = เวลาเซิร์ฟเวอร์ ณ ขณะรับคำขอ / closeDate = กำหนดปิดของรอบ
    // หน้า error state ของ /apply ใช้แสดงหลักฐานเวลาเมื่อถูกปฏิเสธเพราะปิดรับสมัคร
    // (ข้อมูล public อยู่แล้ว — closeDate แสดงบนหน้าแรกทุกการ์ด)
    return c.json({
      success: false,
      error: gate.message,
      reason: gate.reason,
      status: round.status,
      serverTime: Date.now(),
      closeDate: round.closeDate,
    }, 403);
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

  // serverTime — epoch ms ของเซิร์ฟเวอร์ ณ ขณะสร้าง response
  // หน้า /apply ใช้คำนวณ offset กับนาฬิกาเครื่อง (แบบเดียวกับ /rounds/active)
  // เพื่อแสดง banner "เหลือเวลารับสมัครอีก" ที่อิงเวลา server แม้เครื่องผู้ใช้เพี้ยน
  return c.json({ success: true, data: round, serverTime: Date.now() });
});

/**
 * =============================================================================
 * Application No Generation (PR #1 hardening + race fix)
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
 * The replacement (Strategy A — format เดิม APP-YYYY-NNNN, per-year global):
 *   - Reads the current Bangkok year from a single helper.
 *   - Queries D1 for the highest existing sequence in that year using
 *     `application_no LIKE 'APP-YYYY-%'` with a NUMERIC max
 *     (`MAX(CAST(SUBSTR(...)))` — application_no เป็น TEXT ห้ามเทียบ lexical
 *     เพราะ 'APP-2026-9999' > 'APP-2026-10000').
 *   - Increments by 1, formats via `buildApplicationNo` (padStart ไม่ truncate —
 *     เลขเกิน 9,999 ออกเป็น APP-2026-10000 ได้).
 *   - If the UNIQUE constraint trips (race: two requests computed the same
 *     MAX), re-read the MAX and retry up to 5 times — bounded, never infinite.
 *   - After 5 attempts, return 503 so the client can retry.
 *
 * Strategy B (round มี application_pattern) ใช้ atomic claim จาก
 * round_sequences (UPSERT ... RETURNING ใน round-sequence.service.ts) —
 * ดู insertApplicationWithRetry ด้านล่าง
 *
 * IMPORTANT: this preserves the existing public format
 * (`APP-YYYY-NNNN`) and is fully backward-compatible with the admin UI.
 */

/**
 * Find the highest sequence number in D1 for the given Bangkok year.
 * Returns 0 if no applications exist for the year.
 *
 * Canonical implementation: `getMaxSequenceForYear` จาก
 * application-number.service.ts (import ด้านบน) — numeric MAX ผ่าน
 * MAX(CAST(SUBSTR(application_no, 10))) ไม่ใช่ lexical ORDER BY DESC
 * (application_no เป็น TEXT: 'APP-2026-9999' > 'APP-2026-10000' แบบ
 * lexical ทำให้ submit หลังข้าม 9,999 ชน UNIQUE ครบ retry → 503 ถาวร)
 *
 * ยังเป็น SELECT-MAX+1 คู่กับ bounded retry ด้านล่าง: เมื่อ concurrent
 * submit ได้ candidate เดียวกัน ตัวที่ชน applications.application_no
 * UNIQUE จะ re-read MAX ใหม่แล้วลองอีกครั้ง (bounded 5 ครั้ง) — UNIQUE
 * constraint เป็นตัวชี้ขาด ไม่ใช่กลไกหลักเหมือน Strategy B
 */

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
    // claim ต้องอยู่ใน loop: เลขที่ claim ต้อง render เป็น string ก่อน bind
    // ลง INSERT (pattern render เป็นฝั่ง TS) claim กับ insert จึงคนละ
    // statement — claim เอง atomic แล้ว (round_sequences UPSERT RETURNING
    // ใน round-sequence.service) ถ้ายังชน application_no UNIQUE (เช่น
    // sequence ถูก reset ต่ำกว่าเลขเดิม หรือ pattern ไม่ unique) ให้ claim
    // เลขใหม่แบบ bounded — ห้าม retry ไม่จำกัด
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const buildResult = await buildApplicationNumber(db, { roundId: args.roundId, applicationId: args.id });
      if (!buildResult.ok) {
        return {
          ok: false,
          reason: buildResult.reason === 'INVALID_PATTERN' ? 'INVALID_PATTERN' : 'ROUND_ERROR',
        };
      }
      const { applicationNo, snapshot } = buildResult;
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
        if (/UNIQUE constraint failed: applications\.application_no/.test(msg)) {
          // เลขซ้ำจริง — claim เลขใหม่ในรอบถัดไป (bounded โดย maxRetries)
          continue;
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
  submitFailureLoggerMiddleware(),
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
    // serverTime = เวลาเซิร์ฟเวอร์ ณ ขณะรับคำขอ (หลักฐาน "ขณะได้รับคำขอ" ที่
    // หน้า review แสดงเมื่อ submit โดนปฏิเสธเพราะปิดรับสมัคร) + closeDate
    // เพื่อไม่ให้ฝั่ง client ต้อง fetch เพิ่ม — ข้อมูล public อยู่แล้ว
    return c.json({
      success: false,
      error: gate.message,
      reason: gate.reason,
      status: round.status,
      serverTime: Date.now(),
      closeDate: round.closeDate,
    }, 403);
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

  // ── APPLICATION_SUBMIT (Audit Log Foundation Phase 1) ──
  // เหตุการณ์ฝั่งผู้สมัคร: actor = SYSTEM row (Migration 032 — admin_id เป็น
  // NOT NULL FK จึงใช้ actor เสมือน) / fail-soft ใน writeAudit — audit ล้ม
  // ไม่กระทบผล submit แล้วคืน 201 ตามเดิม
  // payload ไม่ใส่ PII (ชื่อ/email อ่านย้อนได้จากตาราง applications ผ่าน
  // display resolver ตอนแสดงผล — หน้า audit logs เข้าถึง SUPER_ADMIN เท่านั้น)
  await writeAudit({
    db,
    action: 'APPLICATION_SUBMIT',
    entityType: 'APPLICATION',
    entityId: applicationId,
    actorId: SYSTEM_ADMIN_ID,
    payload: {
      applicationNo: insertResult.applicationNo,
      roundId: data.roundId,
      roundTitle: round.title,
      attachmentCount: data.attachments?.length ?? 0,
    },
    ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
  });

  // ── ATTACHMENT_LINK (canonical event ของไฟล์แนบ — C-attach) ──
  // ไฟล์แนบถูกอัปโหลดก่อนมีใบสมัคร (TEMP) จึงเขียน audit ตอนนั้นด้วย
  // entityType='ATTACHMENT', entityId=ledger id ซึ่ง timeline ของใบสมัคร
  // (entityType='APPLICATION' AND entityId=app.id) มองไม่เห็น
  //
  // ตอน submit คือจุดที่รู้ความจริงว่า "ไฟล์นี้เป็นของใบนี้" → เขียน 1 แถวต่อไฟล์
  // ด้วย entityId = applicationId (เข้า timeline ได้ด้วย query เดิม ไม่ต้อง join)
  // และ ledgerId ใน payload ให้ read path กันการแสดงซ้ำกับ ATTACHMENT_UPLOAD
  //
  // อ่านจาก ledger (source of truth) ไม่ใช่จาก statements: UPDATE ที่ promote
  // แล้วไม่ match จะเงียบ ๆ 0 แถว (legacy/ถูก cron เก็บไปแล้ว) จึงต้องดูของจริง
  // ว่าไฟล์ไหน ACTIVE และผูกกับใบนี้จริง
  const linkedAttachments = await db
    .select({
      id: attachmentUploads.id,
      r2Key: attachmentUploads.r2Key,
      originalFilename: attachmentUploads.originalFilename,
    })
    .from(attachmentUploads)
    .where(
      and(
        eq(attachmentUploads.applicationId, applicationId),
        eq(attachmentUploads.status, 'ACTIVE'),
      ),
    );

  if (linkedAttachments.length > 0) {
    // fieldId ของแต่ละไฟล์มาจาก client (application_attachments) — ledger ไม่ได้
    // เก็บ fieldId จึง map ด้วย r2_key ที่สกัดจาก fileUrl
    const fieldIdByR2Key = new Map<string, string>();
    for (const att of data.attachments ?? []) {
      const r2Key = extractR2KeyFromFileUrl(att.fileUrl);
      if (r2Key) fieldIdByR2Key.set(r2Key, att.fieldId);
    }

    await writeAuditBatch({
      db,
      entries: linkedAttachments.map((att) => ({
        action: 'ATTACHMENT_LINK',
        entityType: 'APPLICATION',
        entityId: applicationId,
        actorId: SYSTEM_ADMIN_ID,
        payload: {
          ledgerId: att.id,
          fileKey: att.r2Key,
          filename: att.originalFilename ?? null,
          fieldId: fieldIdByR2Key.get(att.r2Key) ?? null,
        },
        ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
      })),
    });
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