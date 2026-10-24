/**
 * Filename display helpers (frontend)
 * ============================================================================
 * พฤติกรรมตรงกับ backend/src/utils/filename.ts ทุกประการ — แยกไฟล์เพราะ
 * frontend ห้าม import backend-only module (tests ของสองฝั่งเช็คความสอดคล้องกัน)
 *
 * ลำดับการเลือกชื่อของ attachment:
 *   1. original_filename จาก record ถ้ามีค่า
 *   2. fallback ถอดจาก fileUrl / object key:
 *      - decode percent encoding แบบปลอดภัยทีละก้อน (ไม่ throw)
 *      - basename หลัง slash หรือ backslash ตัวสุดท้าย
 *      - ตัด UUID 36 ตัวนำหน้าเฉพาะเมื่อตรงรูปแบบเต็ม `<uuid>-`
 */

/** control characters ทั้ง C0 และ C1 (รวม null byte) */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** UUID มาตรฐาน 36 ตัวตามด้วยขีดหนึ่งตัว */
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;

/** ก้อน percent encoding ที่ถูกต้อง (อาจยาวหลาย triplet ติดกัน) */
const PCT_RUN_RE = /(?:%[0-9a-fA-F]{2})+/g;

function safeDecode(value: string): string {
  return value.replace(PCT_RUN_RE, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** ถอดชื่อไฟล์จาก fileUrl / object key — คืน '' เมื่อถอดไม่ได้ (ไม่ throw กับ input เพี้ยน) */
export function attachmentDisplayFileName(fileUrl: string): string {
  if (typeof fileUrl !== 'string' || !fileUrl) return '';
  const noQuery = fileUrl.split('?')[0].split('#')[0];
  const decoded = safeDecode(noQuery);
  const segments = decoded.split(/[\\/]/);
  let last = (segments[segments.length - 1] ?? '').trim();
  last = last.replace(CONTROL_CHARS_RE, '').trim();
  const uuidMatch = last.match(UUID_PREFIX_RE);
  if (uuidMatch) last = uuidMatch[1].trim();
  return last;
}

/**
 * ลำดับชื่อสำหรับ display ของ attachment หนึ่งชิ้น:
 * original_filename ก่อน → fallback จาก fileUrl (ใช้ร่วมทั้ง review และ admin detail)
 */
export function attachmentDisplayName(record: {
  originalFilename?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
}): string {
  const fromRecord = typeof record.originalFilename === 'string'
    ? record.originalFilename.replace(CONTROL_CHARS_RE, '').trim()
    : '';
  if (fromRecord) return fromRecord;
  // fileName คือ metadata ฝั่ง draft (ใช้ก่อน fallback จาก URL)
  const fromDraft = typeof record.fileName === 'string'
    ? record.fileName.replace(CONTROL_CHARS_RE, '').trim()
    : '';
  if (fromDraft) return fromDraft;
  return attachmentDisplayFileName(typeof record.fileUrl === 'string' ? record.fileUrl : '');
}
