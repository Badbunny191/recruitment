/**
 * Attachment Cleanup — Cron GC ของไฟล์ TEMP ที่ไม่ถูก submit
 * ============================================================================
 * ปิดปัญหา Orphan Files: upload เข้า R2 ทันที (FileUpload.tsx) แต่ถ้าผู้สมัคร
 * ปิด tab / ไม่ submit ไฟล์ค้างใน bucket ตลอดอายุระบบ — เดิมไม่มี cron,
 * ไม่มี scheduled handler, ไม่มี DELETE endpoint เลย
 *
 * กลยุทธ์ (idempotent ทุกขั้น):
 *   1. เลือก ledger แถว status='TEMP' อายุเกิน cutoff (default 7 วัน)
 *      LIMIT ต่อรองรัน — รันวันละครั้งพอเพียง และกัน timeout เมื่อ backlog ใหญ่
 *   2. R2.delete(r2_key) — R2 delete ของ key ที่ไม่มีอยู่แล้วไม่ error
 *      → รันซ้ำได้ปลอดภัย
 *   3. mark DELETED ด้วย WHERE status='TEMP' — ถ้า isolate อื่นแตะแถวเดียวกัน
 *      (หรือผู้สมัคร submit พอดีในจังหวะเดียวกัน) UPDATE จะไปกระทบแถวที่
 *      สถานะเปลี่ยนไปแล้วไม่ได้ → ไม่มีทางลบไฟล์ ACTIVE
 *
 * ลำดับ "ลบ R2 ก่อน mark" ตั้งใจ: ถ้า mark ล้มเหลว รอบ cron ถัดไปจะเจอแถว
 * TEMP เดิมแล้ว retry ทั้งสองขั้น (R2.delete ซ้ำ = no-op) — ระบบ self-healing
 * ทิศตรงข้าม (mark ก่อน) จะทิ้ง object ค้างใน bucket ถ้า mark สำเร็จแต่
 * R2.delete ล้ม และไม่มีรอบถัดไปมาเก็บ
 */
import { and, eq, lt } from 'drizzle-orm';
import { attachmentUploads } from '../db/schema';

export const TEMP_CLEANUP_AFTER_DAYS = 7;
export const TEMP_CLEANUP_BATCH_LIMIT = 200;

export interface CleanupResult {
  scanned: number;
  deleted: number;
  errors: number;
}

export async function cleanupExpiredTempAttachments(
  db: any,
  r2: { delete: (key: string) => Promise<unknown> },
  options?: { olderThanDays?: number; limit?: number },
): Promise<CleanupResult> {
  const olderThanDays = options?.olderThanDays ?? TEMP_CLEANUP_AFTER_DAYS;
  const limit = options?.limit ?? TEMP_CLEANUP_BATCH_LIMIT;

  // Date constructor รับ milliseconds — คำนวณ cutoff เป็น ms ตั้งแต่ต้น
  // (drizzle mode:'timestamp' แปลงกลับเป็น unix seconds ตอนเทียบกับคอลัมน์)
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ id: attachmentUploads.id, r2Key: attachmentUploads.r2Key })
    .from(attachmentUploads)
    .where(and(eq(attachmentUploads.status, 'TEMP'), lt(attachmentUploads.uploadedAt, cutoff)))
    .limit(limit);

  const result: CleanupResult = { scanned: rows.length, deleted: 0, errors: 0 };

  for (const row of rows) {
    try {
      await r2.delete(row.r2Key);
      await db
        .update(attachmentUploads)
        .set({ status: 'DELETED', deletedAt: new Date() })
        // Guard สถานะ: ระหว่าง R2.delete กับ mark ผู้สมัคร submit ของจริง
        // อาจ promote แถวนี้เป็น ACTIVE ไปแล้ว — ห้าม mark ทับ
        .where(and(eq(attachmentUploads.id, row.id), eq(attachmentUploads.status, 'TEMP')));
      result.deleted++;
    } catch (err) {
      result.errors++;
      console.error(`[AttachmentCleanup] Failed for ${row.r2Key}:`, err);
    }
  }

  return result;
}
