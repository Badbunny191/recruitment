/**
 * Apply Reset — "ล้างข้อมูลทั้งหมด" บนหน้าสมัคร (/apply)
 * =====================================================================
 * ล้าง session การสมัครที่ยังไม่ได้ส่งให้หมดจริง ไม่ใช่แค่หน้าจอ:
 *   1. ไฟล์แนบที่อัปโหลดแล้วแต่ยังไม่ submit — ลบจริงผ่าน backend
 *      DELETE /public/uploads/direct/:ledgerId (best-effort: ไฟล์ไหน
 *      ลบไม่สำเร็จให้ cron GC ตามเก็บ ledger TEMP ภายใน 7 วัน)
 *   2. applyDraft:* ทุก key ใน sessionStorage (ทุกรอบ ไม่ใช่รอบเดียว)
 *   3. submissionToken
 *
 * React state (form values, attachmentMeta, validation errors, FileUpload
 * local state) เป็นหน้าที่ของ caller (apply/page.tsx) เพราะ lib นี้ต้อง
 * ทดสอบได้ใน Node โดยไม่มี DOM
 */

import { clearAllApplyDrafts } from './applyDraft';
import { clearSubmissionToken } from './submissionToken';

export const RESET_CONFIRM_MESSAGE =
  'การดำเนินการนี้จะล้างข้อมูลและไฟล์แนบที่ยังไม่ได้ส่งทั้งหมด ต้องการดำเนินการต่อหรือไม่';

/** โครงเบาของ UploadedFileMeta — structural เพื่อไม่ต้อง import component */
export interface ResettableAttachment {
  ledgerId?: string;
  deleteToken?: string;
}

export interface ResetApplySessionInput {
  /** attachmentMeta ปัจจุบันของหน้า — ไฟล์ที่มี ledgerId+deleteToken จะถูกลบจริง */
  attachmentMeta: Record<string, ResettableAttachment[]>;
  /** override สำหรับ test; ค่าเริ่มต้นเหมือนที่อื่นในระบบ */
  apiUrl?: string;
  /** inject fetch สำหรับ test (ค่าเริ่มต้น globalThis.fetch) */
  fetchImpl?: typeof fetch;
}

export interface ResetApplySessionResult {
  /** จำนวนไฟล์ที่ลบจาก backend สำเร็จ */
  deletedFiles: number;
  /** จำนวนไฟล์ที่ลบไม่สำเร็จ (best-effort — ไม่บล็อกการล้าง state) */
  failedFiles: number;
  /** จำนวน draft (applyDraft:* key) ที่ถูกลบ */
  clearedDrafts: number;
}

/**
 * ล้าง session การสมัครตามรายการด้านบน คืนสรุปผล ฟังก์ชันนี้ไม่ throw —
 * ความล้มเหลวของการลบไฟล์แต่ละไฟล์ถูกนับใน failedFiles และการล้าง
 * state ฝั่ง client ต้องเกิดต่อให้ครบเสมอ
 */
export async function resetApplySession(
  input: ResetApplySessionInput
): Promise<ResetApplySessionResult> {
  const files: ResettableAttachment[] = [];
  for (const list of Object.values(input.attachmentMeta || {})) {
    for (const f of list || []) {
      if (f?.ledgerId && f?.deleteToken) files.push(f);
    }
  }

  const doFetch = input.fetchImpl ?? fetch;
  const apiUrl = input.apiUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';

  let deletedFiles = 0;
  let failedFiles = 0;
  // Best-effort — ลบพร้อมกัน และไม่ให้ไฟล์ไหนล้มทั้งรอบ
  await Promise.all(
    files.map(async (f) => {
      try {
        const res = await doFetch(
          `${apiUrl}/public/uploads/direct/${encodeURIComponent(f.ledgerId!)}`,
          {
            method: 'DELETE',
            headers: { 'X-Attachment-Token': f.deleteToken! },
          }
        );
        if (res.ok) {
          deletedFiles++;
        } else {
          failedFiles++;
        }
      } catch {
        failedFiles++;
      }
    })
  );

  const clearedDrafts = clearAllApplyDrafts();
  clearSubmissionToken();

  return { deletedFiles, failedFiles, clearedDrafts };
}
