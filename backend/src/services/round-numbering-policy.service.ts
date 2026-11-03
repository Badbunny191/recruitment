/**
 * Round Numbering Policy Service
 * --------------------------------------------
 * Feature: Application Number Governance
 *
 * แหล่งตัดสินเดียว (single source of truth) ว่า "จำนวนนับของรอบนี้ถูกล็อกหรือไม่"
 * ทั้ง GET /admin/rounds, GET /admin/rounds/:id/clone-options และ
 * PATCH /admin/rounds/:id ต้องเรียกใช้ฟังก์ชันในไฟล์นี้เท่านั้น
 *
 * Business Rule (อนุมัติ 2026-11-03):
 *   locked = activeApplicationCount > 0
 *
 *   - activeApplicationCount = applications ที่ roundId ตรง และ deletedAt IS NULL
 *   - ไม่ขึ้นกับ status ของรอบ (DRAFT / ACTIVE / CLOSED ให้ผลเหมือนกัน)
 *   - legacy (application_pattern = NULL) เป็น "state" ไม่ใช่ "lock"
 *     → legacy ที่ยังไม่มีผู้สมัคร ต้องแก้ applicationPattern + roundCode ได้
 *
 * ยังไม่รวม issuedSequence (round_sequences.current_value) ในเงื่อนไขล็อก
 * ตามขอบเขตที่อนุมัติ — ถ้าจะเพิ่มต้องขออนุมัติก่อน
 *
 * Fail-closed:
 *   ถ้าอ่านจำนวนผู้สมัครไม่สำเร็จ ฟังก์ชันจะ throw — caller ต้องตอบ error
 *   ห้ามตีความเป็น 0 (= ปลดล็อก) เด็ดขาด
 */

import { and, count, eq, isNull } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { applications } from '../db/schema';

type DB = ReturnType<typeof drizzleFn<any>>;

/**
 * เหตุผลที่ล็อก / สถานะของ numbering settings
 *
 * - HAS_APPLICATIONS : มีผู้สมัคร (active) แล้ว → ล็อกทั้ง pattern และ roundCode
 * - LEGACY_NO_PATTERN: ยังไม่มีผู้สมัคร + ยังไม่เคยตั้ง pattern (legacy round)
 *                      → แก้ได้ แต่ UI ต้องบอกว่า "ยังใช้รูปแบบเดิม"
 * - EDITABLE         : ยังไม่มีผู้สมัคร + มี pattern แล้ว → แก้ได้ตามปกติ
 */
export type NumberingPolicyReason =
  | 'HAS_APPLICATIONS'
  | 'LEGACY_NO_PATTERN'
  | 'EDITABLE';

export interface NumberingPolicy {
  /** true = ห้ามแก้ applicationPattern และ roundCode */
  locked: boolean;
  reason: NumberingPolicyReason;
  /** จำนวนผู้สมัครที่นับจริง (ไม่รวม soft-deleted) */
  activeApplicationCount: number;
  /** true = รอบนี้ยังไม่มี application_pattern (legacy state) */
  isLegacy: boolean;
  /** สิทธิ์แก้ราย field — UI ใช้ค่านี้เท่านั้น ห้าม derive เอง */
  editable: {
    applicationPattern: boolean;
    roundCode: boolean;
  };
}

/**
 * นับผู้สมัครที่ยังไม่ถูกลบของรอบนี้
 *
 * throw เมื่อ query ล้ม — caller ต้องจัดการเป็น error (fail-closed)
 * ไม่คืน 0 แทน เพราะ 0 = ปลดล็อก
 */
export async function countActiveApplications(
  db: DB,
  roundId: string,
): Promise<number> {
  const row = await db
    .select({ count: count() })
    .from(applications)
    .where(and(eq(applications.roundId, roundId), isNull(applications.deletedAt)))
    .get();

  const value = Number(row?.count ?? 0);
  if (!Number.isFinite(value)) {
    throw new Error('round-numbering-policy: application count is not a finite number');
  }
  return value;
}

/**
 * ตัดสิน policy ของรอบหนึ่งจาก (applicationPattern, activeApplicationCount)
 *
 * เป็น pure function — ใช้ทั้งใน route และใน test โดยไม่ต้องมี DB
 */
export function decideNumberingPolicy(input: {
  applicationPattern: string | null | undefined;
  activeApplicationCount: number;
}): NumberingPolicy {
  const activeApplicationCount = Number(input.activeApplicationCount ?? 0);
  const isLegacy = !input.applicationPattern;
  const locked = activeApplicationCount > 0;

  let reason: NumberingPolicyReason;
  if (locked) {
    reason = 'HAS_APPLICATIONS';
  } else if (isLegacy) {
    reason = 'LEGACY_NO_PATTERN';
  } else {
    reason = 'EDITABLE';
  }

  return {
    locked,
    reason,
    activeApplicationCount,
    isLegacy,
    editable: {
      applicationPattern: !locked,
      roundCode: !locked,
    },
  };
}

/**
 * โหลด policy ของรอบจาก DB
 *
 * throw เมื่ออ่าน count ไม่สำเร็จ (fail-closed)
 */
export async function resolveNumberingPolicy(
  db: DB,
  round: { id: string; applicationPattern: string | null | undefined },
): Promise<NumberingPolicy> {
  const activeApplicationCount = await countActiveApplications(db, round.id);
  return decideNumberingPolicy({
    applicationPattern: round.applicationPattern,
    activeApplicationCount,
  });
}
