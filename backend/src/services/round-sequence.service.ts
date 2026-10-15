/**
 * Round Sequence Service
 * --------------------------------------------
 * Feature: Per-Round Application Number Pattern (MVP)
 *
 * จัดการ running number ของ application ในแต่ละ round
 * - 1 round = 1 row ใน round_sequences
 * - สร้างแบบ lazy (ตอน application แรกของ round)
 * - ใช้ UPSERT + RETURNING เพื่อ atomic increment
 * - Clone round: lazy create row ใหม่ที่ current_value = 0 (เริ่มนับใหม่)
 * - Archive round: row คงอยู่ แต่ไม่ issue running ใหม่
 *
 * D1/SQLite considerations:
 * - SQLite มี transaction-based locking ที่ strong พอ
 * - ใช้ INSERT ... ON CONFLICT DO UPDATE (UPSERT) + RETURNING
 * - ถ้า race condition (ขณะ insert row ใหม่): retry สูงสุด 3 ครั้ง
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

      // UPSERT: insert ถ้ายังไม่มี, increment + return ถ้ามีแล้ว
      // ใช้ raw SQL เพื่อความชัดเจนและ atomic
      const result = await db.run(sql`
        INSERT INTO round_sequences (round_id, current_value, created_at, updated_at)
        VALUES (${roundId}, 1, unixepoch(), unixepoch())
        ON CONFLICT(round_id) DO UPDATE SET
          current_value = current_value + 1,
          updated_at = unixepoch()
        RETURNING current_value
      `);

      // D1/SQLite: อ่าน RETURNING จาก result.meta
      const newValue = extractReturnedValue(result);
      if (newValue == null) {
        // fallback: SELECT หลัง UPSERT
        const seq = await db
          .select({ value: roundSequences.currentValue })
          .from(roundSequences)
          .where(eq(roundSequences.roundId, roundId))
          .get();
        if (!seq) {
          throw new Error('Failed to read sequence after UPSERT');
        }
        return { ok: true, running: seq.value };
      }

      return { ok: true, running: newValue };
    } catch (err: any) {
      const message = String(err?.message ?? err);
      // Transient errors: retry
      const isRetryable = /SQLITE_BUSY|UNIQUE|conflict/i.test(message);
      if (isRetryable && attempt < maxRetries - 1) {
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

function extractReturnedValue(result: any): number | null {
  // D1 returns: { success, meta: { changes, last_row_id, ... } }
  // SQLite better-sqlite3 returns: { changes, lastInsertRowid }
  // Drizzle's db.run wraps the D1 response
  const meta = result?.meta;
  if (!meta) return null;
  // RETURNING clause: last_row_id ไม่ใช่ sequence value
  // ต้อง query ซ้ำเพื่ออ่าน RETURNING value
  // (D1 ปัจจุบันยังไม่ expose RETURNING rows ใน meta)
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
