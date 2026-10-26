/**
 * Attachment Ledger — operations บนตาราง attachment_uploads (Migration 029)
 * ============================================================================
 * Lifecycle: TEMP (เพิ่งอัปโหลด) → ACTIVE (submit สำเร็จ) → DELETED
 *
 *   - insertTempLedger           POST /public/uploads/direct
 *   - promoteAttachmentsToActive POST /public/applications/submit (ใน batch เดียว
 *                                กับ insert applications + application_attachments
 *                                → submit สำเร็จ/ล้มเหลวพร้อมกัน ไม่มี half-state)
 *   - hashDeleteToken            one-time capability ของผู้อัปโหลด (ไม่มี login)
 *
 * ทุก operation เขียนให้ idempotent ต่อสถานะเดิมเสมอ (WHERE status = ...)
 */
import { and, eq } from 'drizzle-orm';
import { attachmentUploads } from '../db/schema';
import { extractR2KeyFromFileUrl } from '../utils/filename';

/** SHA-256 hex ของ delete token (เก็บ hash ไม่เก็บ token ลง DB) */
export async function hashDeleteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface TempLedgerEntry {
  ledgerId: string;
  deleteToken: string;
}

/**
 * บันทึกการอัปโหลดเป็น TEMP + ออก delete token (คืนครั้งเดียว ฝั่ง client เก็บ)
 * db: drizzle instance (ใช้กับ D1 binding จริงหรือ D1-compatible adapter ใน test)
 */
export async function insertTempLedger(
  db: any,
  args: { r2Key: string; originalFilename: string | null },
): Promise<TempLedgerEntry> {
  const ledgerId = crypto.randomUUID();
  const deleteToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await db.insert(attachmentUploads).values({
    id: ledgerId,
    r2Key: args.r2Key,
    status: 'TEMP',
    originalFilename: args.originalFilename,
    deleteTokenHash: await hashDeleteToken(deleteToken),
  });
  return { ledgerId, deleteToken };
}

/**
 * Promote attachment ทั้งหมดของใบสมัครจาก TEMP → ACTIVE (ผูก application_id)
 * คืน statement ของ drizzle สำหรับใส่รวมใน db.batch(...) ตอน submit —
 * ถ้าเรียกตรง ๆ ต้อง await เอง
 *
 * fileUrl ที่ได้จาก client ถูกแปลงเป็น r2_key ก่อนเสมอ (ชนกับ UNIQUE ไม่ได้
 * เพราะ key นำหน้าด้วย UUID) — แถวที่ไม่พบ (legacy หรือถูก cron ลบไปแล้ว)
 * = UPDATE 0 แถว เงียบ ๆ ไม่พา submit ล้ม
 */
export function buildPromoteAttachmentsStatements(
  db: any,
  args: { applicationId: string; fileUrls: string[] },
): any[] {
  const statements: any[] = [];
  for (const fileUrl of args.fileUrls) {
    const r2Key = extractR2KeyFromFileUrl(fileUrl);
    if (!r2Key) continue;
    statements.push(
      db
        .update(attachmentUploads)
        .set({
          status: 'ACTIVE',
          applicationId: args.applicationId,
          activatedAt: new Date(),
        })
        .where(and(eq(attachmentUploads.r2Key, r2Key), eq(attachmentUploads.status, 'TEMP'))),
    );
  }
  return statements;
}
