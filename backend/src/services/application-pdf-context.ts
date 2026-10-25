/**
 * Application PDF filename context — ใช้ร่วมกันทั้ง Admin และ Public download
 * ============================================================================
 * โหลดข้อมูลที่ resolver ต้องใช้ในที่เดียวเพื่อให้ชื่อไฟล์ทั้งสอง endpoint
 * ตรงกันทุกตัวอักษร:
 *   applications (snapshot: applicationNo, fullname, year, round_code)
 *     → recruitment_rounds (template_version_id)
 *       → template_versions.pdf_filename_pattern (Migration 028)
 *
 * ห้ามแตะ PDF bytes / cache — ฟังก์ชันนี้เกี่ยวกับชื่อไฟล์เท่านั้น
 */

import { eq } from 'drizzle-orm';
import { applications, recruitmentRounds, templateVersions } from '../db/schema';

export interface ApplicationPdfFilenameContext {
  applicationId: string;
  applicationNo: string | null;
  fullname: string | null;
  roundCode: string | null;
  year: number | null;
  /** null = version เก่า/ไม่ได้ตั้ง → resolver ใช้ค่าเริ่มต้น */
  pattern: string | null;
}

export async function loadPdfFilenameContext(
  db: any,
  applicationId: string
): Promise<ApplicationPdfFilenameContext | null> {
  const row = await db
    .select({
      applicationId: applications.id,
      applicationNo: applications.applicationNo,
      fullname: applications.fullname,
      roundCode: applications.roundCode,
      year: applications.year,
      pattern: templateVersions.pdfFilenamePattern,
    })
    .from(applications)
    .innerJoin(recruitmentRounds, eq(applications.roundId, recruitmentRounds.id))
    .leftJoin(templateVersions, eq(recruitmentRounds.templateVersionId, templateVersions.id))
    .where(eq(applications.id, applicationId))
    .get();

  if (!row) return null;
  return row;
}
