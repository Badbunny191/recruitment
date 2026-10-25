/**
 * PDF download helpers — อ่านชื่อไฟล์จาก Content-Disposition (backend เป็น Source of Truth)
 * ============================================================================
 * นโยบาย:
 *   - Frontend ห้ามสร้างชื่อไฟล์ PDF ใบสมัครเอง (ห้าม resolve pattern เอง,
 *     ห้ามใช้ fullname จาก input มาสร้างชื่อ)
 *   - ลำดับการอ่าน: filename* (RFC 5987, UTF-8) ก่อน → filename (ASCII fallback)
 *   - decode อย่างปลอดภัย (ก้อน percent ที่เสียคงดิบไว้) และ sanitize อีกชั้น
 *   - Header ไม่มี/ผิดรูปแบบ → caller ใช้ fallback `${applicationNo || 'application'}.pdf`
 */

/** control characters ทั้ง C0 และ C1 (รวม NUL, CR, LF) */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

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

/**
 * ตัดท้าย quote ค้าง (header ผิดรูปแบบ เช่น filename="abc) ออกก่อนใช้
 */
function stripDanglingQuote(value: string): string {
  return value.replace(/"+$/g, '');
}

/**
 * Sanitize ชื่อที่อ่านได้จาก header อีกชั้น (defensive):
 *   - ตัด control characters
 *   - มี path separator → เอาเฉพาะ basename (กัน path traversal)
 *   - ว่าง / "." / ".." → ถือว่าใช้ไม่ได้ (คืน '' ให้ caller fallback)
 */
function sanitizeHeaderFilename(name: string): string {
  let cleaned = name.replace(CONTROL_CHARS_RE, '').trim();
  if (cleaned.includes('/') || cleaned.includes('\\')) {
    const segments = cleaned.split(/[\\/]/).filter(Boolean);
    cleaned = segments[segments.length - 1] ?? '';
  }
  cleaned = cleaned.replace(/^"+|"+$/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return '';
  return cleaned;
}

/**
 * อ่านชื่อไฟล์จาก Content-Disposition header:
 *   1. filename*=UTF-8''<percent-encoded> ก่อน (ชื่อไทยจริงจาก backend)
 *   2. filename="<ASCII fallback>" รองลงมา
 *   3. ไม่มี/ผิดรูปแบบ → คืน '' (caller ใช้ fallback ของตัวเอง)
 */
export function parseContentDispositionFilename(disposition: string | null | undefined): string {
  if (!disposition || typeof disposition !== 'string') return '';
  let rest = disposition;

  // 1. filename* (RFC 5987) — อ่านก่อนเสมอ แล้วตัดออกเพื่อไม่ให้ match filename= ซ้ำ
  const starMatch = rest.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;\s]+)/);
  if (starMatch) {
    rest = rest.replace(starMatch[0], '');
    const decoded = sanitizeHeaderFilename(stripDanglingQuote(safeDecode(starMatch[1])));
    if (decoded) return decoded;
  }

  // 2. filename= — quoted หรือ bare token
  const plainMatch = rest.match(/filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;\s]+)/i);
  if (plainMatch) {
    const raw = plainMatch[1] !== undefined ? plainMatch[1] : plainMatch[2];
    const decoded = sanitizeHeaderFilename(safeDecode(raw ?? ''));
    if (decoded) return decoded;
  }

  return '';
}
