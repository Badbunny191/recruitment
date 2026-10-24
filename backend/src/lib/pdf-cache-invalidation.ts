/**
 * PDF Cache Invalidation (D1)
 * --------------------------------------------
 * ทำให้ R2 PDF cache (`pdf/applications/{id}/v1.pdf`) หมดอายุเมื่อ
 * ข้อมูลต้นทางที่มีผลต่อเนื้อหา PDF ถูกเปลี่ยนแปลง
 *
 * ขอบเขต (พิสูจน์จากโค้ดแล้ว — ดู pdf-cache-invalidation.test.ts [3]):
 *   ✅ Document Descriptor ถูกบันทึก (PUT /admin/template-versions/:id/descriptor)
 *      → descriptor เป็น blueprint ของ PDF ทั้งฉบับ (pdf.service.ts โหลดจาก
 *        template_versions.descriptorJson ทุกครั้งที่ render)
 *   ❌ การเปลี่ยน status / statusReason ของใบสมัคร
 *      → Composer path ไม่มี STATUS token (document-tokens.ts) และไม่มี
 *        SystemDataKey สำหรับ status (document-composer/types.ts) — PDF
 *        ไม่แสดงสถานะ จึงต้องไม่ invalidate จากเหตุการณ์นี้
 *
 * หลักการ:
 *   - Backend-internal เท่านั้น — ไม่มี HTTP endpoint สำหรับลบ cache
 *   - Best-effort — ความล้มเหลว (D1 query / R2 delete) ต้องไม่ทำให้
 *     business operation หลัก (บันทึก descriptor) ล้มเหลวตาม
 *   - Scoped — ลบเฉพาะใบสมัครที่อยู่ใน rounds ของ template version นั้น
 *     ไม่ลบแบบไร้ขอบเขต และไม่แตะ objects อื่นใน bucket
 *   - ไม่เปิดเผยข้อมูลสำคัญ — error ถูก log ฝั่ง server เท่านั้น
 *     และไม่ถูกส่งกลับไปยัง client ไม่ว่ากรณีใด
 */

import { eq } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { applications, recruitmentRounds } from '../db/schema';
import { buildPdfCacheKey } from './pdf-types';

type DB = ReturnType<typeof drizzleFn<any>>;

/** R2 bucket.delete จัดการได้สูงสุด 1,000 keys ต่อ 1 call */
const R2_DELETE_BATCH_SIZE = 1000;

export interface PdfCacheInvalidationResult {
  /** จำนวน cache key ที่สั่งลบสำเร็จ */
  invalidated: number;
  /** true เมื่อ query หรือ delete ล้มเหลือ — caller ใช้เพื่อ log/monitor เท่านั้น */
  failed: boolean;
}

/**
 * หา application ids ทั้งหมดที่ PDF ของพวกเขา render จาก template version นี้
 *
 * ขอบเขตชัดเจน: applications → rounds → templateVersionId (ความสัมพันธ์
 * เดียวกับที่ buildApplicationContext ใช้ snapshot ตอน render) รวมใบสมัคร
 * ที่ถูก soft-delete ด้วย เพราะ cache ของพวกเขาก็สร้างมาจาก descriptor เดิม
 */
async function listApplicationIdsForTemplateVersion(
  db: DB,
  templateVersionId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(recruitmentRounds, eq(applications.roundId, recruitmentRounds.id))
    .where(eq(recruitmentRounds.templateVersionId, templateVersionId));
  return (rows as { id: string }[]).map((r) => r.id);
}

/**
 * Invalidate PDF cache ของทุกใบสมัครใน template version หนึ่ง ๆ
 *
 * Never throws — ทุกขั้นตอนถูก try/catch และ log ด้วย `[PDF-CACHE]` prefix
 * (log เฉพาะ version id / จำนวน / error message — ไม่มีข้อมูลผู้สมัคร)
 */
export async function invalidatePdfCacheForTemplateVersion(
  db: DB,
  r2: R2Bucket | undefined,
  templateVersionId: string
): Promise<PdfCacheInvalidationResult> {
  if (!r2) return { invalidated: 0, failed: false };

  try {
    const applicationIds = await listApplicationIdsForTemplateVersion(db, templateVersionId);
    if (applicationIds.length === 0) return { invalidated: 0, failed: false };

    const keys = applicationIds.map((id) => buildPdfCacheKey(id));
    for (let i = 0; i < keys.length; i += R2_DELETE_BATCH_SIZE) {
      await r2.delete(keys.slice(i, i + R2_DELETE_BATCH_SIZE));
    }
    return { invalidated: keys.length, failed: false };
  } catch (err) {
    console.error(
      `[PDF-CACHE] Failed to invalidate R2 PDF cache for template version ${templateVersionId}: ` +
        (err instanceof Error ? err.message : String(err))
    );
    return { invalidated: 0, failed: true };
  }
}
