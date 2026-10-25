/**
 * Application PDF filename helpers — ใช้ร่วมกันทั้ง Admin และ Public download
 * ============================================================================
 * นโยบาย:
 *   - Backend เป็น Source of Truth ของชื่อไฟล์ — frontend ห้ามสร้างชื่อเอง
 *     (frontend อ่านจาก Content-Disposition เท่านั้น)
 *   - Pattern เก็บระดับ template_versions.pdf_filename_pattern (Migration 028)
 *     null / ว่าง = ใช้ค่าเริ่มต้น DEFAULT_PDF_FILENAME_PATTERN
 *   - ระบบเติม `.pdf` ให้เสมอ — pattern ห้ามมีนามสกุล
 *   - การเปลี่ยนชื่อดาวน์โหลดไม่กระทบ PDF bytes → ไม่แตะ PDF cache / R2 key
 *
 * องค์ประกอบ:
 *   1. validatePdfFilenamePattern — ตรวจ pattern ที่ admin ตั้ง (ข้อความไทย)
 *   2. buildApplicationPdfFilename — resolve token + sanitize + เติม .pdf
 *   3. buildPdfContentDisposition — header แบบ RFC 5987 (filename + filename*)
 */

// ── Token / Pattern ─────────────────────────────────────────────────────────

/** Token ที่อนุญาต — ห้ามเพิ่มข้อมูลอ่อนไหว (email / phone / nationalId / fileUrl) */
export const PDF_FILENAME_TOKENS = ['applicationNo', 'fullname', 'roundCode', 'year'] as const;

export type PdfFilenameToken = (typeof PDF_FILENAME_TOKENS)[number];

/** ค่าเริ่มต้นเมื่อ pattern เป็น null/ว่าง (token ชื่ออังกฤษ — UI แปลงความหมายให้ผู้ดูแล) */
export const DEFAULT_PDF_FILENAME_PATTERN = 'ใบสมัคร_{applicationNo}_{fullname}';

/** ความยาวสูงสุดของ pattern (UTF-16 code units) */
export const MAX_PDF_PATTERN_LENGTH = 200;

/** ความยาวสูงสุดของชื่อไฟล์รวม (ไม่รวม .pdf) — กัน path/filename limit ฝั่ง OS */
export const MAX_PDF_FILENAME_LENGTH = 120;

/** ความยาวสูงสุดของส่วน fullname ในชื่อไฟล์ */
export const MAX_FULLNAME_SEGMENT_LENGTH = 60;

/** นามสกุลที่ระบบเติมให้ */
export const PDF_EXTENSION = '.pdf';

const TOKEN_RE = /\{([^{}]*)\}/g;

/** อักขระต้องห้ามในชื่อไฟล์ (Windows reserved + path separator) */
const FILENAME_FORBIDDEN_RE = /[/\\:*?"<>|]/g;

/** control characters ทั้ง C0 และ C1 (รวม NUL, CR, LF, tab) — ใช้กับ .replace() เท่านั้น */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** เวอร์ชัน non-global สำหรับ .test() (global regex เก็บ lastIndex ข้ามการเรียก) */
const HAS_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

// ── 1. Pattern Validation ───────────────────────────────────────────────────

export type PatternValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * ตรวจ pattern จากผู้ดูแล (ก่อนบันทึกลง template_versions):
 *   - ว่าง/whitespace เท่านั้น → ผ่าน (หมายถึงใช้ค่าเริ่มต้น, เก็บเป็น null)
 *   - ต้องมี {applicationNo} อย่างน้อยหนึ่งครั้ง
 *   - ห้าม token นอก allowlist
 *   - ห้ามมี .pdf (ระบบเติมให้เอง)
 *   - ห้าม / \ .. CR/LF/control characters
 *   - ยาวไม่เกิน 200 UTF-16 code units
 * ข้อความ error เป็นภาษาไทย เพื่อแสดงในหน้า Admin ตรง ๆ
 */
export function validatePdfFilenamePattern(raw: unknown): PatternValidationResult {
  if (raw === null || raw === undefined) return { ok: true };
  if (typeof raw !== 'string') {
    return { ok: false, message: 'รูปแบบชื่อไฟล์ไม่ถูกต้อง' };
  }

  const pattern = raw;
  if (pattern.trim() === '') return { ok: true };

  if (pattern.length > MAX_PDF_PATTERN_LENGTH) {
    return {
      ok: false,
      message: `รูปแบบชื่อไฟล์ต้องมีความยาวไม่เกิน ${MAX_PDF_PATTERN_LENGTH} ตัวอักษร`,
    };
  }

  // นามสกุล — ตรวจทั้ง .pdf ตรง ๆ และกรณีพิมพ์ผสม (.PDF) เพื่อกัน .pdf.pdf
  if (/\.pdf/i.test(pattern)) {
    return { ok: false, message: 'ไม่ต้องระบุนามสกุล .pdf ระบบจะเพิ่มให้อัตโนมัติ' };
  }

  if (pattern.includes('/') || pattern.includes('\\')) {
    return { ok: false, message: 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\' };
  }

  if (pattern.includes('..')) {
    return { ok: false, message: 'รูปแบบชื่อไฟล์ต้องไม่มี ".."' };
  }

  if (HAS_CONTROL_CHARS_RE.test(pattern)) {
    return { ok: false, message: 'รูปแบบชื่อไฟล์ต้องไม่มีตัวอักษรควบคุมหรือการขึ้นบรรทัดใหม่' };
  }

  if (!pattern.includes('{applicationNo}')) {
    return { ok: false, message: 'รูปแบบชื่อไฟล์ต้องมี {applicationNo}' };
  }

  // Token นอก allowlist — รายงาน token แรกที่พบ
  const allowed = new Set<string>(PDF_FILENAME_TOKENS);
  for (const match of pattern.matchAll(TOKEN_RE)) {
    if (!allowed.has(match[1])) {
      return { ok: false, message: `พบตัวแปรที่ระบบไม่รองรับ: {${match[1]}}` };
    }
  }

  return { ok: true };
}

/**
 * Normalize pattern ก่อนบันทึก: whitespace เท่านั้น → null (ใช้ค่าเริ่มต้น)
 * คืน input เดิมถ้ามีเนื้อหา (caller validate แล้ว)
 */
export function normalizePdfFilenamePattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : raw;
}

// ── 2. Sanitization ─────────────────────────────────────────────────────────

/**
 * Sanitize ค่า token สำหรับฝังในชื่อไฟล์:
 *   1. control characters (รวม CR/LF/tab/NUL) → `_`
 *   2. whitespace ต่อเนื่อง → `_`
 *   3. `/ \ : * ? " < > |` → `_`
 *   4. รวม `_` ซ้ำ, ตัด `.`/`_`/ช่องว่างหัวท้าย (กัน `..`, ชื่อจบด้วยจุด)
 *   5. จำกัดความยาวตาม code point (กันตัด surrogate pair ครึ่งเดียว)
 * คงภาษาไทย สระ และวรรณยุกต์ทั้งหมด — คืน '' เมื่อไม่เหลือค่า (caller ตัดส่วนนั้นออก)
 */
function sanitizeTokenValue(raw: unknown, maxLength: number): string {
  let value = String(raw ?? '');
  if (!value) return '';
  value = value
    .replace(CONTROL_CHARS_RE, '_')
    .replace(/\s+/g, '_')
    .replace(FILENAME_FORBIDDEN_RE, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '');
  if (!value || value === '..') return '';
  const chars = Array.from(value);
  if (chars.length > maxLength) {
    value = chars.slice(0, maxLength).join('').replace(/[._\s]+$/g, '');
  }
  return value === '..' ? '' : value;
}

/** Sanitize ชื่อไฟล์รวมหลัง resolve token (defensive อีกชั้นก่อนส่ง header) */
function sanitizeFinalName(name: string): string {
  return name
    .replace(CONTROL_CHARS_RE, '_')
    .replace(FILENAME_FORBIDDEN_RE, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '');
}

// ── 3. Resolver ─────────────────────────────────────────────────────────────

export interface PdfFilenameInput {
  /** pattern จาก template_versions.pdf_filename_pattern — null/ว่าง = ใช้ค่าเริ่มต้น */
  pattern?: string | null;
  applicationNo?: string | null;
  fullname?: string | null;
  roundCode?: string | null;
  year?: number | string | null;
  /** ใช้แทน applicationNo เมื่อไม่มีเลขที่ใบสมัคร */
  applicationId?: string | null;
}

/**
 * Resolve pattern → ชื่อไฟล์ .pdf ที่ปลอดภัย:
 *   1. เลือก pattern (null/ว่าง → DEFAULT_PDF_FILENAME_PATTERN)
 *   2. Sanitize + เติมค่า token — token ที่ไม่มีค่าถูกตัดพร้อม separator เกิน
 *      (fullname ว่าง → ตัดส่วน fullname และ `_` ที่ค้าง, applicationNo ไม่มี
 *       → ใช้ applicationId แทน, ไม่มีทั้งคู่ → token ว่างถูกตัด)
 *   3. Sanitize ผลลัพธ์รวม (กัน `..` / separator ต้องห้าม)
 *   4. จำกัดความยาว, เติม `.pdf` ครั้งเดียว
 *   5. ผลลัพธ์ว่าง → fallback `ใบสมัคร_{applicationNo|applicationId}.pdf`
 * Deterministic: input เดียวกันได้ชื่อเดียวกันทุกครั้ง
 */
export function buildApplicationPdfFilename(input: PdfFilenameInput): string {
  const pattern =
    typeof input.pattern === 'string' && input.pattern.trim() !== ''
      ? input.pattern
      : DEFAULT_PDF_FILENAME_PATTERN;

  const values: Record<PdfFilenameToken, string> = {
    applicationNo: sanitizeTokenValue(
      input.applicationNo ?? input.applicationId ?? '',
      MAX_PDF_FILENAME_LENGTH
    ),
    fullname: sanitizeTokenValue(input.fullname ?? '', MAX_FULLNAME_SEGMENT_LENGTH),
    roundCode: sanitizeTokenValue(input.roundCode ?? '', 40),
    year: sanitizeTokenValue(
      input.year === null || input.year === undefined ? '' : String(input.year),
      10
    ),
  };

  // แทน token ด้วยค่า (token ไม่มีค่า → string ว่าง แล้วจึงเก็บกวาด separator)
  let name = pattern.replace(TOKEN_RE, (whole, key: string) =>
    key in values ? values[key as PdfFilenameToken] : ''
  );

  name = sanitizeFinalName(name);
  if (!name) {
    const fallbackNo = String(input.applicationNo ?? input.applicationId ?? '').trim();
    const fallbackName =
      sanitizeTokenValue(fallbackNo, MAX_PDF_FILENAME_LENGTH) || 'application';
    // กัน .pdf.pdf — ค่าที่ resolve อาจลงท้าย .pdf อยู่แล้ว (defensive)
    return /\.pdf$/i.test(fallbackName)
      ? fallbackName
      : `ใบสมัคร_${fallbackName}${PDF_EXTENSION}`;
  }

  const chars = Array.from(name);
  if (chars.length > MAX_PDF_FILENAME_LENGTH) {
    name = chars.slice(0, MAX_PDF_FILENAME_LENGTH).join('').replace(/[._\s]+$/g, '');
  }

  // กัน .pdf.pdf — เติมนามสกุลครั้งเดียว
  if (/\.pdf$/i.test(name)) return name;
  return `${name}${PDF_EXTENSION}`;
}

// ── 4. Content-Disposition ──────────────────────────────────────────────────

/**
 * ASCII fallback สำหรับ `filename=` — ใช้ applicationNo/applicationId เท่านั้น
 * (pattern เป็นภาษาไทย ใส่ `filename=` ตรง ๆ ไม่ได้) ผู้ใช้จริงเห็นค่าจาก filename*
 */
export function buildPdfAsciiFallbackFilename(input: {
  applicationNo?: string | null;
  applicationId?: string | null;
}): string {
  const no = String(input.applicationNo ?? '').trim();
  const safe = /^[\x21-\x7e]+$/.test(no)
    ? no.replace(/["\\]/g, '')
    : String(input.applicationId ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '');
  return `application-${safe || 'document'}.pdf`;
}

/**
 * Content-Disposition header แบบ RFC 5987:
 *   attachment; filename="ASCII-fallback.pdf";
 *             filename*=UTF-8''{percent-encoded UTF-8 name}
 *   - ไม่มี CR/LF ได้ (ตัดทิ้งก่อน encode) → กัน header injection
 *   - filename* decode กลับเป็นภาษาไทยได้ครบถ้วน
 * Admin และ Public ใช้ฟังก์ชันนี้ร่วมกันเพื่อให้ชื่อเหมือนกันทุกตัวอักษร
 */
export function buildPdfContentDisposition(
  filename: string,
  asciiInput?: { applicationNo?: string | null; applicationId?: string | null }
): string {
  const clean = filename.replace(CONTROL_CHARS_RE, '');
  const ascii = buildPdfAsciiFallbackFilename(asciiInput ?? {});
  const encoded = encodeURIComponent(clean);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
