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

import { eq, sql } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { recruitmentRounds } from '../db/schema';
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

  // ใช้ max query แบบเดิม (LIKE 'APP-YYYY-%')
  const row = await db
    .select({ applicationNo: sql<string>`application_no` })
    .from(sql`applications`)
    .where(sql`application_no LIKE ${`APP-${year}-%`}`)
    .orderBy(sql`application_no DESC`)
    .limit(1)
    .get();

  let nextSequence = 1;
  if (row?.applicationNo) {
    const m = row.applicationNo.match(/^APP-(\d{4})-(\d+)$/);
    if (m && parseInt(m[1], 10) === year) {
      nextSequence = parseInt(m[2], 10) + 1;
    }
  }

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
