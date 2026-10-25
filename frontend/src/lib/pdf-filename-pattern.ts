/**
 * PDF filename pattern helpers (Admin UI)
 * ============================================================================
 * Mirror ของ backend/src/utils/application-pdf-filename.ts — frontend ห้าม import
 * โมดูล backend จึงต้องสำเนา logic ไว้ฝั่งนี้ (inline validation + preview ทันที)
 * ค่าจริงยัง validate ที่ backend อีกชั้น (ข้อความไทยชุดเดียวกัน)
 *
 * หมายเหตุ token: เก็บชื่ออังกฤษในระบบ แต่ UI อธิบายความหมายเป็นภาษาไทย:
 *   {applicationNo} = เลขที่ใบสมัคร, {fullname} = ชื่อผู้สมัคร,
 *   {roundCode} = รหัสรอบรับสมัคร, {year} = ปีของใบสมัคร
 */

export const DEFAULT_PDF_FILENAME_PATTERN = 'ใบสมัคร_{applicationNo}_{fullname}';

export const PDF_FILENAME_TOKENS = ['applicationNo', 'fullname', 'roundCode', 'year'] as const;

export type PdfFilenameToken = (typeof PDF_FILENAME_TOKENS)[number];

/** คำอธิบาย token สำหรับแสดงใน UI (ภาษาไทย) */
export const PDF_TOKEN_LABELS: Record<PdfFilenameToken, string> = {
  applicationNo: 'เลขที่ใบสมัคร',
  fullname: 'ชื่อผู้สมัคร',
  roundCode: 'รหัสรอบรับสมัคร',
  year: 'ปีของใบสมัคร',
};

/** ความยาวสูงสุดของ pattern (UTF-16 code units) — เหมือน backend */
export const MAX_PDF_PATTERN_LENGTH = 200;

/** ข้อมูลสังเคราะห์สำหรับ Preview (ห้ามใช้ข้อมูลผู้สมัครจริง) */
export const PDF_PREVIEW_SAMPLE = {
  applicationNo: 'APP-2026-5025',
  fullname: 'นายทดสอบ ระบบ',
  roundCode: 'TEST',
  year: 2026,
};

const TOKEN_RE = /\{([^{}]*)\}/g;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const FILENAME_FORBIDDEN_RE = /[/\\:*?"<>|]/g;
const HAS_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

export type PatternValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/** Inline validation ใน UI — กติกาชุดเดียวกับ backend validatePdfFilenamePattern */
export function validatePdfFilenamePattern(raw: unknown): PatternValidationResult {
  if (raw === null || raw === undefined) return { ok: true };
  if (typeof raw !== 'string') return { ok: false, message: 'รูปแบบชื่อไฟล์ไม่ถูกต้อง' };

  const pattern = raw;
  if (pattern.trim() === '') return { ok: true };
  if (pattern.length > MAX_PDF_PATTERN_LENGTH) {
    return { ok: false, message: `รูปแบบชื่อไฟล์ต้องมีความยาวไม่เกิน ${MAX_PDF_PATTERN_LENGTH} ตัวอักษร` };
  }
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
  const allowed = new Set<string>(PDF_FILENAME_TOKENS);
  // exec loop (matchAll iterator ต้องการ downlevelIteration / target >= es2015)
  const tokenRe = /\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pattern)) !== null) {
    if (!allowed.has(m[1])) {
      return { ok: false, message: `พบตัวแปรที่ระบบไม่รองรับ: {${m[1]}}` };
    }
  }
  return { ok: true };
}

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

/**
 * Preview ชื่อไฟล์จาก pattern ด้วยข้อมูลสังเคราะห์ (ทันทีระหว่างพิมพ์) —
 * ใช้ logic เดียวกับ backend resolver: token ไม่มีค่าถูกตัด, เติม .pdf ครั้งเดียว
 * ผู้ใช้จะเห็นชื่อจริงจาก Content-Disposition ตอนดาวน์โหลด (backend เป็น Source of Truth)
 */
export function buildPdfFilenamePreview(
  pattern: string | null | undefined,
  sample: {
    applicationNo?: string;
    fullname?: string;
    roundCode?: string;
    year?: number | string;
  } = PDF_PREVIEW_SAMPLE
): string {
  const effective =
    typeof pattern === 'string' && pattern.trim() !== '' ? pattern : DEFAULT_PDF_FILENAME_PATTERN;

  const values: Record<PdfFilenameToken, string> = {
    applicationNo: sanitizeTokenValue(sample.applicationNo ?? '', 120),
    fullname: sanitizeTokenValue(sample.fullname ?? '', 60),
    roundCode: sanitizeTokenValue(sample.roundCode ?? '', 40),
    year: sanitizeTokenValue(sample.year === null || sample.year === undefined ? '' : String(sample.year), 10),
  };

  let name = effective.replace(TOKEN_RE, (whole, key: string) =>
    key in values ? values[key as PdfFilenameToken] : ''
  );
  name = name
    .replace(CONTROL_CHARS_RE, '_')
    .replace(FILENAME_FORBIDDEN_RE, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '');

  // กัน .pdf.pdf — เติมนามสกุลครั้งเดียว (เหมือน backend)
  if (!name) return `ใบสมัคร.pdf`;
  if (/\.pdf$/i.test(name)) return name;
  return `${name}.pdf`;
}
