/**
 * Filename helpers — ใช้ร่วมกันทั้ง upload / submit / Excel export
 * ============================================================================
 * นโยบาย "display name ≠ object key":
 *   - R2 Object Key นำหน้าด้วย UUID เสมอ → ไฟล์ชื่อเดียวกันได้ key คนละค่า
 *   - Original filename เก็บแยก (application_attachments.original_filename)
 *     โดย sanitize เฉพาะสิ่งอันตราย คง Unicode (ไทย/ช่องว่าง/วงเล็บ/จุด/ขีด)
 *   - ผู้อ่าน (Excel / Admin) ใช้ original_filename ก่อน ถ้าไม่มีจึง fallback
 *     ถอดจาก fileUrl / object key
 */

/** ความยาวสูงสุดของส่วนชื่อไฟล์ (ไม่รวม uuid prefix ใน object key) */
export const MAX_FILENAME_LENGTH = 120;

/** control characters ทั้ง C0 และ C1 (รวม null byte) */
export const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** UUID มาตรฐาน 36 ตัวตามด้วยขีดหนึ่งตัว — ใช้ strip prefix ของ object key */
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;

/** ก้อน percent encoding ที่ถูกต้อง (อาจยาวหลาย triplet ติดกัน) */
const PCT_RUN_RE = /(?:%[0-9a-fA-F]{2})+/g;

/**
 * ถอด percent encoding แบบปลอดภัย ทีละก้อน %XX:
 * ก้อนไหนเสีย (เช่น "100%.pdf" ที่ % ไม่มี hex ตามหลัง หรือ surrogate ครึ่งเดียว)
 * คงดิบไว้โดยไม่ทำให้ก้อนอื่นหรือทั้ง string พัง
 */
function safeDecode(value: string): string {
  return value.replace(PCT_RUN_RE, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * สร้างชื่อไฟล์สำหรับ display/key-suffix จากชื่อต้นฉบับ:
 *   1. ชื่อที่แทรก path separator (/ หรือ \) → เอาเฉพาะ basename กัน path traversal
 *   2. ตัด control characters ทั้งหมด (รวม null byte)
 *   3. trim + จำกัดความยาวโดยรักษานามสกุล
 *   4. ว่าง / "." / ".." → fallback "document.pdf"
 * ไม่แตะตัวอักษร Unicode — ใช้ทั้งตอนสร้าง R2 key (upload) และ sanitize ซ้ำ
 * ค่าจาก client ก่อน insert original_filename (submit)
 */
export function sanitizeDisplayFilename(raw: string): string {
  let name = String(raw ?? '');
  const segments = name.split(/[\\/]/).filter(Boolean);
  // มี separator → ผู้ส่งพยายามกำหนด path ไม่ได้ผล: เอาเฉพาะ basename
  if (segments.length > 0 && /[\\/]/.test(name)) {
    name = segments[segments.length - 1];
  }
  name = name.replace(CONTROL_CHARS_RE, '').trim();
  if (name.length > MAX_FILENAME_LENGTH) {
    // ตัดเหลือ MAX โดยคงนามสกุลไว้ (สั้นไม่เกิน 10 ตัว) ให้อ่านเป็นไฟล์ .pdf ได้
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx > 0 && name.length - dotIdx <= 10 ? name.slice(dotIdx) : '';
    name = name.slice(0, Math.max(1, MAX_FILENAME_LENGTH - ext.length)).trim() + ext;
  }
  if (!name || name === '.' || name === '..') return 'document.pdf';
  return name;
}

/**
 * สำหรับ attachment record ตอน submit: sanitize ค่าจาก client ซ้ำก่อน insert
 * คืน null เมื่อไม่มีชื่อที่ใช้ได้จริง (ว่าง/เป็นแต่ separator/จุด) เพื่อให้
 * ฝั่งผู้อ่าน fallback จาก fileUrl แทนการเก็บชื่อปลอม
 */
export function sanitizeOriginalFilenameOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = sanitizeDisplayFilename(trimmed);
  // cleaned กลายเป็น fallback "document.pdf" ทั้งที่ client ไม่ได้ส่งชื่อนั้น
  // = ตัดแล้วไม่เหลือชื่อจริง → null
  if (cleaned === 'document.pdf' && trimmed !== 'document.pdf') return null;
  return cleaned;
}

/**
 * ถอดชื่อไฟล์สำหรับ display จาก fileUrl / object key (fallback path):
 *   1. ตัด query/hash → decode URL-encoding แบบปลอดภัยทีละก้อน
 *   2. basename หลัง slash หรือ backslash ตัวสุดท้าย
 *   3. ตัด UUID 36 ตัวนำหน้าเฉพาะเมื่อตรงรูปแบบเต็ม `<uuid>-`
 *      (ชื่อธรรมดาที่ไม่มี UUID นำหน้าต้องไม่ถูกตัด)
 *   4. ตัด control characters — คืน '' เมื่อถอดไม่ได้ (caller ใช้ fallback)
 * ห้ามคืน path/object key/URL เต็ม และห้าม throw กับ input เพี้ยน
 */
export function attachmentDisplayFileName(fileUrl: string): string {
  if (typeof fileUrl !== 'string' || !fileUrl) return '';
  const noQuery = fileUrl.split('?')[0].split('#')[0];
  const decoded = safeDecode(noQuery);
  const segments = decoded.split(/[\\/]/);
  // basename ว่าง (URL/key จบด้วย separator) = ถอดชื่อไม่ได้ → คืน '' ให้ caller
  // fallback "ไฟล์แนบ" — ห้ามยืม segment ก่อนหน้า เพราะเป็นส่วน path ไม่ใช่ชื่อไฟล์
  let last = (segments[segments.length - 1] ?? '').trim();
  last = last.replace(CONTROL_CHARS_RE, '').trim();
  const uuidMatch = last.match(UUID_PREFIX_RE);
  if (uuidMatch) last = uuidMatch[1].trim();
  return last;
}

/**
 * ลำดับการเลือกชื่อสำหรับ display ของ attachment หนึ่งชิ้น:
 *   1. original_filename จาก record ถ้ามีค่า (ตัด control chars แบบ defensive)
 *   2. fallback ถอดจาก fileUrl ด้วย attachmentDisplayFileName
 * ใช้ร่วมกันทั้ง Excel export และ Admin detail
 */
export function attachmentDisplayName(record: {
  originalFilename?: string | null;
  fileUrl?: string | null;
}): string {
  const original = typeof record.originalFilename === 'string'
    ? record.originalFilename.replace(CONTROL_CHARS_RE, '').trim()
    : '';
  if (original) return original;
  return attachmentDisplayFileName(typeof record.fileUrl === 'string' ? record.fileUrl : '');
}

// ── Excel Export filename — ใช้ร่วมทั้ง Filtered / Selected export ─────────
// รูปแบบ: ใบสมัคร-{ชื่อรอบที่ผู้ใช้เห็น}-{YYYYMMDD-HHmm}.xlsx
// ห้ามใช้ UUID / รหัสรอบเป็นส่วนหลักของชื่อ — ผู้ใช้อ่านไม่รู้เรื่อง

/** อักขระที่ใช้ในชื่อไฟล์บนระบบทั่วไป (Windows) ไม่ได้ */
const FILENAME_FORBIDDEN_RE = /[/\\:*?"<>|]/g;

/** ความยาวสูงสุดของ "ชื่อรอบ" ในชื่อไฟล์ export (ไม่รวม prefix/stamp/นามสกุล) */
export const MAX_EXPORT_ROUND_NAME_LENGTH = 80;

/** fallback สุดท้ายเมื่อไม่มีทั้งชื่อรอบและรหัสรอบ */
export const EXPORT_FALLBACK_ROUND_NAME = 'รอบรับสมัคร';

/**
 * Sanitize ชื่อรอบสำหรับใช้เป็นส่วนหนึ่งของชื่อไฟล์:
 *   1. control characters (รวม CR/LF) และอักขระต้องห้าม / \ : * ? " < > | → space
 *   2. รวมช่องว่างซ้ำเป็นช่องเดียว
 *   3. trim จุดและช่องว่างหัวท้าย
 *   4. จำกัดความยาวตาม code point (กันตัด surrogate pair ครึ่งเดียว)
 * คง Unicode ภาษาไทยทั้งหมด — คืน '' เมื่อไม่เหลือชื่อให้ใช้ (caller fallback ต่อ)
 */
export function sanitizeRoundNameForFilename(raw: unknown): string {
  let name = String(raw ?? '');
  name = name
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(FILENAME_FORBIDDEN_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) return '';
  const chars = Array.from(name);
  if (chars.length > MAX_EXPORT_ROUND_NAME_LENGTH) {
    name = chars.slice(0, MAX_EXPORT_ROUND_NAME_LENGTH).join('').replace(/[.\s]+$/g, '');
  }
  return name;
}

/**
 * ชื่อไฟล์ .xlsx สำหรับดาวน์โหลด (Unicode) — ลำดับ fallback:
 *   1. ชื่อรอบ (recruitment_rounds.title) ที่ผู้ใช้เห็นจริง
 *   2. รหัสรอบ (round_code) เมื่อชื่อรอบว่าง
 *   3. คำทั่วไป "รอบรับสมัคร"
 * stamp = เวลา Asia/Bangkok ปี ค.ศ. รูปแบบ YYYYMMDD-HHmm (มาตรฐานเดียวกับคอลัมน์วันที่สมัคร)
 */
export function buildExportFilename(
  round: { title?: string | null; roundCode?: string | null },
  stamp: string,
): string {
  const namePart = sanitizeRoundNameForFilename(round.title)
    || sanitizeRoundNameForFilename(round.roundCode)
    || EXPORT_FALLBACK_ROUND_NAME;
  return `ใบสมัคร-${namePart}-${stamp}.xlsx`;
}

/**
 * ชื่อไฟล์ ASCII สำหรับ filename= ใน Content-Disposition (fallback สำหรับ
 * HTTP client เก่าที่ไม่อ่าน filename*) — ใช้รหัสรอบเมื่อเป็น ASCII ได้
 * ไม่เกี่ยวข้องกับชื่อหลักที่ผู้ใช้เห็น (ผู้ใช้เห็นค่าจาก filename*)
 */
export function buildExportFilenameAscii(
  round: { roundCode?: string | null },
  stamp: string,
): string {
  const code = String(round.roundCode ?? '').trim();
  const asciiCode = /^[\x21-\x7e]+$/.test(code) ? code.replace(/["\\]/g, '') : '';
  return `${asciiCode || 'applications'}-${stamp}.xlsx`;
}
