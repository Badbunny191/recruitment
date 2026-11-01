/**
 * Application Number Builder
 * --------------------------------------------
 * Feature: Per-Round Application Number Pattern (MVP)
 *
 * รวม logic การ generate application number ทั้งหมด:
 *   1. เลือก strategy:
 *      - ถ้า round.application_pattern = NULL  → ใช้ format เดิม (APP-YYYY-NNNN)
 *      - ถ้า round.application_pattern != NULL → ใช้ pattern ใหม่
 *   2. Resolve tokens
 *   3. ขอ running number (per-round หรือ per-year)
 *   4. Build application_no
 *   5. คืน snapshot fields สำหรับ INSERT applications
 *
 * Backward compatibility:
 *   - Round เก่า (application_pattern = NULL) ใช้ APP-YYYY-NNNN ตามเดิม
 *   - insertApplicationWithRetry ใน public.routes.ts ยังคง logic เดิม
 *   - ใบสมัครเก่าไม่ถูกแตะ
 */

import { eq, like, sql } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { recruitmentRounds, applications } from '../db/schema';
import {
  renderPattern,
  validateApplicationPattern,
  type ParsedToken,
  type PatternRenderContext,
} from '../utils/application-pattern';
import { getNextRunningNumber } from './round-sequence.service';
import { getCurrentBangkokYear } from '../utils/application-no';
import { buildApplicationNo } from '../utils/application-no';

type DB = ReturnType<typeof drizzleFn<any>>;

/**
 * หา sequence สูงสุดของปี (Bangkok) จาก application_no ที่มีอยู่ — canonical
 * implementation ที่ทั้ง submit route (Strategy A) และ buildLegacyNumber ใช้ร่วมกัน
 *
 * ต้องเป็น numeric MAX ไม่ใช่ lexical: application_no เป็น TEXT ทำให้
 * 'APP-2026-9999' > 'APP-2026-10000' แบบ lexical — ORDER BY DESC จะมอง
 * 9,999 มากกว่า 10,000 แล้ว deadlock ทุก submit หลังข้าม 9,999
 * LIKE filter pin prefix 'APP-YYYY-' (9 ตัวอักษรคงที่) จึงตัด sequence
 * ด้วย SUBSTR จากตำแหน่ง prefix.length + 1 แล้ว CAST เทียบเป็นจำนวนเต็ม
 *
 * ยังคงเป็น SELECT-MAX+1 คู่กับ bounded retry บน UNIQUE ของ submit route —
 * DB (UNIQUE constraint) เป็นตัวชี้ขาดเมื่อแข่งกัน ไม่ใช่กลไกหลักของ Strategy B
 * (ซึ่ง claim atomically จาก round_sequences)
 */
export async function getMaxSequenceForYear(db: DB, year: number): Promise<number> {
  const prefix = `APP-${year}-`;
  const row = await db
    .select({
      maxSeq: sql<number | null>`MAX(CAST(SUBSTR(${applications.applicationNo}, ${prefix.length + 1}) AS INTEGER))`,
    })
    .from(applications)
    .where(like(applications.applicationNo, `${prefix}%`))
    .get();

  if (!row || row.maxSeq == null) return 0;
  return row.maxSeq;
}

export interface BuildNumberInput {
  roundId: string;
  /** Override id (สำหรับ caller ที่ generate id ก่อน) */
  applicationId: string;
}

export interface BuildNumberResult {
  ok: true;
  applicationNo: string;
  snapshot: {
    year: number;
    roundCode: string | null;
    seqInRound: number | null;
  };
}

export interface BuildNumberFailure {
  ok: false;
  reason:
    | 'ROUND_NOT_FOUND'
    | 'ROUND_ARCHIVED'
    | 'INVALID_PATTERN'
    | 'SEQUENCE_ERROR'
    | 'DB_ERROR';
  error?: string;
}

/**
 * Build application number สำหรับ round ที่ระบุ
 *
 * Strategy:
 * - ถ้า round.application_pattern = NULL  → ใช้ format เดิม
 * - ถ้า round.application_pattern != NULL → parse pattern, render
 *
 * Returns: applicationNo + snapshot fields สำหรับ INSERT applications
 */
export async function buildApplicationNumber(
  db: DB,
  input: BuildNumberInput,
): Promise<BuildNumberResult | BuildNumberFailure> {
  // 1. โหลด round
  const round = await db
    .select()
    .from(recruitmentRounds)
    .where(eq(recruitmentRounds.id, input.roundId))
    .get();

  if (!round) {
    return { ok: false, reason: 'ROUND_NOT_FOUND' };
  }

  if (round.deletedAt) {
    return { ok: false, reason: 'ROUND_ARCHIVED' };
  }

  // 2. เลือก strategy
  if (!round.applicationPattern) {
    // === STRATEGY A: Format เดิม (APP-YYYY-NNNN) — per-year global ===
    return buildLegacyNumber(db, round);
  }

  // === STRATEGY B: Pattern ใหม่ — per-round ===
  return buildPatternNumber(db, round);
}

/**
 * Strategy A: Format เดิม APP-YYYY-NNNN (per-year global running)
 * ใช้ logic เดิมจาก public.routes.ts เพื่อ backwards compat
 */
async function buildLegacyNumber(
  db: DB,
  round: typeof recruitmentRounds.$inferSelect,
): Promise<BuildNumberResult | BuildNumberFailure> {
  const year = getCurrentBangkokYear();

  // numeric MAX ผ่าน getMaxSequenceForYear (ห้าม lexical ORDER BY DESC —
  // เลขข้าม 9,999 จะย้อนกลับ ดู comment ที่ getMaxSequenceForYear)
  const nextSequence = (await getMaxSequenceForYear(db, year)) + 1;

  const applicationNo = buildApplicationNo(year, nextSequence);

  return {
    ok: true,
    applicationNo,
    snapshot: {
      year,
      roundCode: round.roundCode ?? null,
      seqInRound: null, // legacy format ไม่มี per-round seq
    },
  };
}

/**
 * Strategy B: Pattern ใหม่ — per-round running
 */
async function buildPatternNumber(
  db: DB,
  round: typeof recruitmentRounds.$inferSelect,
): Promise<BuildNumberResult | BuildNumberFailure> {
  // 1. Validate pattern (defensive — ควร validate ตอนสร้าง round แล้ว)
  const validation = validateApplicationPattern(round.applicationPattern!);
  if (!validation.valid) {
    return { ok: false, reason: 'INVALID_PATTERN', error: validation.error };
  }

  // 2. ขอ running number
  const runningResult = await getNextRunningNumber(db, round.id);
  if (!runningResult.ok) {
    return { ok: false, reason: 'SEQUENCE_ERROR', error: runningResult.error };
  }

  // 3. Build context
  const year = round.openDate instanceof Date
    ? round.openDate.getUTCFullYear()
    : new Date(round.openDate as any).getUTCFullYear();

  const context = {
    year,
    roundCode: round.roundCode ?? '',
    running: runningResult.running,
  };

  // 4. Render
  let applicationNo: string;
  try {
    applicationNo = renderPattern(validation.tokens, context);
  } catch (err: any) {
    return { ok: false, reason: 'DB_ERROR', error: err?.message ?? String(err) };
  }

  return {
    ok: true,
    applicationNo,
    snapshot: {
      year,
      roundCode: round.roundCode ?? null,
      seqInRound: runningResult.running,
    },
  };
}
