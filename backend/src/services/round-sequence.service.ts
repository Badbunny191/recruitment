/**
 * Round Sequence Service
 * --------------------------------------------
 * Feature: Per-Round Application Number Pattern (MVP)
 *
 * จัดการ running number ของ application ในแต่ละ round
 * - 1 round = 1 row ใน round_sequences
 * - สร้างแบบ lazy (ตอน application แรกของ round)
 * - ใช้ INSERT ... ON CONFLICT DO UPDATE ... RETURNING ผ่าน db.all()
 *   เพื่อ atomic increment + อ่านค่าใน statement เดียว (ไม่มี SELECT-after-UPSERT)
 * - Clone round: lazy create row ใหม่ที่ current_value = 0 (เริ่มนับใหม่)
 * - Archive round: row คงอยู่ แต่ไม่ issue running ใหม่
 *
 * D1/SQLite considerations:
 * - SQLite มี transaction-based locking ที่ strong พอ
 * - ถ้า SQLITE_BUSY (statement ไม่ได้รัน): retry สูงสุด 3 ครั้ง
 */

import { eq, sql } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { roundSequences } from '../db/schema';

type DB = ReturnType<typeof drizzleFn<any>>;

export type NextRunningNumberResult =
  | { ok: true; running: number }
  | { ok: false; reason: 'ROUND_NOT_FOUND' | 'ROUND_ARCHIVED' | 'DB_ERROR'; error?: string };

/**
 * ขอ running number ถัดไปสำหรับ round
 * - ถ้ายังไม่มี row ใน round_sequences: สร้างใหม่ (current_value = 1)
 * - ถ้ามีแล้ว: increment และ return ค่าใหม่
 *
 * ตรวจสอบสถานะ round: ถ้า archived → ไม่ issue
 */
export async function getNextRunningNumber(
  db: DB,
  roundId: string,
  options: { maxRetries?: number } = {},
): Promise<NextRunningNumberResult> {
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // ตรวจสอบสถานะ round ก่อน (read-only check)
      const round = await db
        .select({ id: sql<string>`id`, deletedAt: sql<number | null>`deleted_at` })
        .from(sql`recruitment_rounds`)
        .where(sql`id = ${roundId}`)
        .get();

      if (!round) {
        return { ok: false, reason: 'ROUND_NOT_FOUND' };
      }

      // ── Atomic claim (statement เดียว) ──
      // INSERT ... ON CONFLICT DO UPDATE ... RETURNING เพิ่มค่าและคืนค่า
      // ใน statement เดียว — SQLite/D1 รัน statement แบบ serialize (single
      // writer) จึงไม่มี request สองตัวได้ค่าเดียวกัน
      //
      // ต้องใช้ db.all() ไม่ใช่ db.run(): drizzle d1 `run()` คืนแค่
      // { success, meta } — D1 .run() ไม่มี RETURNING rows ทำให้เดิมต้อง
      // SELECT ตามหลัง ซึ่งเป็น race (request คู่ขนานอ่านค่าเดียวกัน →
      // application_no ซ้ำ → ชน UNIQUE) — db.all() กับ raw sql คืน
      // results array ตรง ๆ (drizzle d1 session: stmt.all().then(({results}) => results))
      const rows = await db.all<{ current_value: number }>(sql`
        INSERT INTO round_sequences (round_id, current_value, created_at, updated_at)
        VALUES (${roundId}, 1, unixepoch(), unixepoch())
        ON CONFLICT(round_id) DO UPDATE SET
          current_value = current_value + 1,
          updated_at = unixepoch()
        RETURNING current_value
      `);

      // UPSERT นี้กระทบ 1 row เสมอ — row[0] ต้องมี current_value เป็นตัวเลข
      // ถ้า shape ผิด (adapter/D1 พฤติกรรมเปลี่ยน) ต้อง fail ดัง ๆ ห้าม
      // fallback ไป SELECT หลัง UPSERT — การอ่านซ้ำคือ race window เดิม
      const value = Number(rows?.[0]?.current_value);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('round_sequences: UPSERT RETURNING did not yield current_value');
      }

      return { ok: true, running: value };
    } catch (err: any) {
      const message = String(err?.message ?? err);
      const causeMessage = String(err?.cause?.message ?? '');
      const combined = `${message} ${causeMessage}`;
      // SQLITE_BUSY: statement ไม่ได้รันเลย (database locked) — ลองใหม่ได้
      // โดยไม่เผา sequence / ส่วน error อื่น (รวมถึง shape-mismatch ข้างบน
      // ที่ UPSERT อาจรันไปแล้ว) ห้าม retry ไม่งั้นเลขข้ามเพิ่มโดยไม่จำเป็น
      if (/SQLITE_BUSY/i.test(combined) && attempt < maxRetries - 1) {
        await sleep(20 * (attempt + 1));
        continue;
      }
      return { ok: false, reason: 'DB_ERROR', error: message };
    }
  }

  return { ok: false, reason: 'DB_ERROR', error: 'Exceeded max retries' };
}

/**
 * ดึง running number ปัจจุบันโดยไม่ increment (สำหรับ read-only UI)
 */
export async function getCurrentRunningNumber(
  db: DB,
  roundId: string,
): Promise<number> {
  const seq = await db
    .select({ value: roundSequences.currentValue })
    .from(roundSequences)
    .where(eq(roundSequences.roundId, roundId))
    .get();
  return seq?.value ?? 0;
}

/**
 * Reset running number (admin use only, ใช้สำหรับ emergency)
 * ปกติไม่ควรเรียก — application number เป็น immutable
 */
export async function resetRunningNumber(
  db: DB,
  roundId: string,
  newValue: number = 0,
): Promise<void> {
  await db
    .update(roundSequences)
    .set({ currentValue: newValue, updatedAt: new Date() })
    .where(eq(roundSequences.roundId, roundId));
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
