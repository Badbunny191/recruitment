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
 *   2. claim แถวก่อน: mark DELETED ด้วย WHERE status='TEMP' — ถ้าผู้สมัคร
 *      submit promote แถวนี้เป็น ACTIVE ไปแล้ว (ระหว่าง SELECT กับ claim)
 *      UPDATE จะกระทบ 0 แถว → ข้ามแถวนี้ทันที ห้ามแตะ R2 object
 *      (ไม่งั้นไฟล์แนบของใบสมัครที่เพิ่ง submit จะถูกลบ = data loss)
 *   3. ถ้า claim สำเร็จแต่ R2.delete ล้ม → revert กลับ TEMP เพื่อให้รอบถัดไป
 *      retry ได้ (self-healing) — ถ้า revert ก็ล้มด้วย เหลือแถว DELETED
 *      + orphan object ที่ GET ไม่ได้ผ่าน app อยู่ดี (ปลอดภัยกว่า data loss)
 *   4. R2.delete ของ key ที่ไม่มีอยู่แล้วไม่ error → รันซ้ำได้ปลอดภัย
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
      // Claim ก่อน (guard status='TEMP') — ถ้า submit promote ไปแล้ว กระทบ
      // 0 แถว = ข้าม ห้ามลบ R2 object ที่ใบสมัครเพิ่งผูกไว้
      const claim = await db
        .update(attachmentUploads)
        .set({ status: 'DELETED', deletedAt: new Date() })
        .where(and(eq(attachmentUploads.id, row.id), eq(attachmentUploads.status, 'TEMP')))
        .run();
      const claimed = (claim as any)?.meta?.changes ?? (claim as any)?.changes ?? 0;
      if (claimed === 0) continue;

      try {
        await r2.delete(row.r2Key);
        result.deleted++;
      } catch (err) {
        // R2 ล้มหลัง claim — revert กลับ TEMP ให้รอบถัดไป retry (self-healing)
        try {
          await db
            .update(attachmentUploads)
            .set({ status: 'TEMP', deletedAt: null })
            .where(and(eq(attachmentUploads.id, row.id), eq(attachmentUploads.status, 'DELETED')));
        } catch (revertErr) {
          console.error(`[AttachmentCleanup] Failed to revert claim for ${row.r2Key}:`, revertErr);
        }
        throw err;
      }
    } catch (err) {
      result.errors++;
      console.error(`[AttachmentCleanup] Failed for ${row.r2Key}:`, err);
    }
  }

  return result;
}
