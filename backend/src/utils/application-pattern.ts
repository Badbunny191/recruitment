/**
 * Application Number Pattern Validator (MVP)
 * --------------------------------------------
 * Feature: Per-Round Application Number Pattern
 *
 * รูปแบบที่รองรับ (MVP):
 *   {YEAR}         → ปี ค.ศ. 4 หลัก จาก openDate (เช่น 2026)
 *   {ROUND_CODE}   → รหัสรอบที่ Admin กำหนด (เช่น "CHM01", "TEMP01", "PROMOTE01")
 *   {RUNNING:3}    → Running number 3 หลัก (001-999)
 *   {RUNNING:4}    → Running number 4 หลัก (0001-9999)  ← default
 *   {RUNNING:5}    → Running number 5 หลัก (00001-99999)
 *   {RUNNING:6}    → Running number 6 หลัก (000001-999999)
 *
 * ตัวอักษรคั่น (separator) ที่อนุญาต: - / . _
 *
 * ตัวอย่าง:
 *   "{YEAR}-{ROUND_CODE}-{RUNNING:4}"  → "2026-CHM01-0001"
 *
 * Validation rules:
 *   1. ต้องมี {RUNNING:n} อย่างน้อย 1 token
 *   2. n ต้องอยู่ระหว่าง 3-6
 *   3. token ที่ใช้ต้องอยู่ใน allowed set เท่านั้น ({YEAR}, {ROUND_CODE}, {RUNNING:n})
 *   4. ไม่ขึ้นต้น/ลงท้ายด้วย separator
 *   5. ไม่มี separator ซ้ำติดกัน
 *   6. token ซ้ำกันไม่ได้
 *   7. ความยาวรวม ≤ 100 ตัวอักษร
 *
 * round_code format (separate validator):
 *   - Alphanumeric only (A-Z, 0-9)
 *   - 3-20 characters
 *   - No spaces
 *   - Auto uppercase (เก็บ uppercase เท่านั้น)
 */

export const ALLOWED_SEPARATORS = ['-', '/', '.', '_'] as const;
export const ALLOWED_DIGIT_COUNTS = [3, 4, 5, 6] as const;
export const MAX_PATTERN_LENGTH = 100;

/** Allowed token names (without params) */
const ALLOWED_TOKEN_NAMES = ['YEAR', 'ROUND_CODE'] as const;

export type ValidationSuccess = {
  valid: true;
  tokens: ParsedToken[];
  digitCount: number;
  preview: string;
  maxCapacity: number;
};

export type ValidationFailure = {
  valid: false;
  error: string;
  errorField?: string;
};

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type ParsedToken =
  | { kind: 'TOKEN'; name: 'YEAR' | 'ROUND_CODE'; raw: string }
  | { kind: 'RUNNING'; digitCount: number; raw: string }
  | { kind: 'SEPARATOR'; value: string; raw: string };

/**
 * ตรวจสอบ pattern string ตามกฎทั้งหมด
 * @returns ValidationResult ที่บอก valid/error พร้อม preview (ถ้า valid)
 */
export function validateApplicationPattern(
  pattern: string,
  context: PatternRenderContext = {},
): ValidationResult {
  // 1. Empty / null
  if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
    return { valid: false, error: 'กรุณากรอกรูปแบบเลขที่ใบสมัคร', errorField: 'pattern' };
  }

  const trimmed = pattern.trim();

  // 2. Length
  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return {
      valid: false,
      error: `รูปแบบยาวเกินไป (สูงสุด ${MAX_PATTERN_LENGTH} ตัวอักษร, ปัจจุบัน ${trimmed.length})`,
      errorField: 'pattern',
    };
  }

  // 3. Start/End with separator
  if (ALLOWED_SEPARATORS.includes(trimmed[0] as any)) {
    return { valid: false, error: 'รูปแบบต้องไม่ขึ้นต้นด้วยตัวคั่น', errorField: 'pattern' };
  }
  if (ALLOWED_SEPARATORS.includes(trimmed[trimmed.length - 1] as any)) {
    return { valid: false, error: 'รูปแบบต้องไม่ลงท้ายด้วยตัวคั่น', errorField: 'pattern' };
  }

  // 4. Parse and validate tokens + separators
  const tokens = parsePattern(trimmed);
  if (tokens instanceof Error) {
    return { valid: false, error: tokens.message, errorField: 'pattern' };
  }

  // 5. Consecutive separators
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === 'SEPARATOR' && tokens[i + 1].kind === 'SEPARATOR') {
      return { valid: false, error: 'ตัวคั่นซ้ำติดกันไม่ได้', errorField: 'pattern' };
    }
  }

  // 6. Duplicate tokens
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t.kind === 'SEPARATOR') continue;
    const key = t.kind === 'RUNNING' ? `RUNNING:${t.digitCount}` : t.name;
    if (seen.has(key)) {
      return { valid: false, error: `Token ${key} ซ้ำกัน`, errorField: 'pattern' };
    }
    seen.add(key);
  }

  // 7. Must contain RUNNING
  const runningToken = tokens.find((t) => t.kind === 'RUNNING');
  if (!runningToken || runningToken.kind !== 'RUNNING') {
    return { valid: false, error: 'ต้องมี {RUNNING:n} อย่างน้อย 1 token', errorField: 'pattern' };
  }

  // 8. Digit count in allowed set
  if (!ALLOWED_DIGIT_COUNTS.includes(runningToken.digitCount as any)) {
    return {
      valid: false,
      error: `จำนวนหลักของ RUNNING ต้องเป็น ${ALLOWED_DIGIT_COUNTS.join(', ')} เท่านั้น (ได้: ${runningToken.digitCount})`,
      errorField: 'pattern',
    };
  }

  // 9. Build preview (best-effort, skip if context missing)
  let preview = '';
  try {
    if (Object.keys(context).length > 0) {
      preview = renderPattern(tokens, context);
    }
  } catch {
    // preview is optional — ignore errors when context is partial
  }

  return {
    valid: true,
    tokens,
    digitCount: runningToken.digitCount,
    preview,
    maxCapacity: Math.pow(10, runningToken.digitCount) - 1,
  };
}

/**
 * แยก pattern เป็น token array
 * @returns ParsedToken[] หรือ throw Error
 */
function parsePattern(pattern: string): ParsedToken[] | Error {
  const tokens: ParsedToken[] = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    // Token { ... }
    if (ch === '{') {
      const closeIdx = pattern.indexOf('}', i);
      if (closeIdx === -1) {
        return new Error(`Token ไม่สมบูรณ์: '{' ไม่มี '}' ปิด`);
      }
      const raw = pattern.slice(i, closeIdx + 1);
      const inner = pattern.slice(i + 1, closeIdx);

      if (inner === 'YEAR' || inner === 'ROUND_CODE') {
        tokens.push({ kind: 'TOKEN', name: inner, raw });
      } else if (inner.startsWith('RUNNING:')) {
        const digitStr = inner.slice('RUNNING:'.length);
        if (!/^\d+$/.test(digitStr)) {
          return new Error(`Token {RUNNING:...} ต้องระบุจำนวนหลักเป็นตัวเลข: ${raw}`);
        }
        const digitCount = parseInt(digitStr, 10);
        tokens.push({ kind: 'RUNNING', digitCount, raw });
      } else if (inner === 'RUNNING') {
        return new Error(`Token {RUNNING} ต้องระบุจำนวนหลัก เช่น {RUNNING:4}`);
      } else {
        return new Error(`Token ที่ไม่รู้จัก: ${raw} (อนุญาต: {YEAR}, {ROUND_CODE}, {RUNNING:n})`);
      }
      i = closeIdx + 1;
      continue;
    }

    // Separator
    if (ALLOWED_SEPARATORS.includes(ch as any)) {
      tokens.push({ kind: 'SEPARATOR', value: ch, raw: ch });
      i++;
      continue;
    }

    // Unknown character
    return new Error(`ตัวอักษรที่ไม่อนุญาต: '${ch}' (อนุญาตเฉพาะ token, separator -/./_/_, และตัวอักษรอื่นๆ ที่อยู่ใน LEVEL)`);
  }

  return tokens;
}

export interface PatternRenderContext {
  year?: number;
  roundCode?: string;
  running?: number;
}

/**
 * Render pattern เป็น application number จริง
 * @throws ถ้า context ไม่ครบ
 */
export function renderPattern(
  tokens: ParsedToken[],
  context: PatternRenderContext,
): string {
  const parts: string[] = [];

  for (const t of tokens) {
    if (t.kind === 'SEPARATOR') {
      parts.push(t.value);
    } else if (t.kind === 'TOKEN' && t.name === 'YEAR') {
      if (context.year == null) throw new Error('Missing context: year');
      parts.push(String(context.year));
    } else if (t.kind === 'TOKEN' && t.name === 'ROUND_CODE') {
      if (!context.roundCode) throw new Error('Missing context: roundCode');
      parts.push(context.roundCode);
    } else if (t.kind === 'RUNNING') {
      if (context.running == null) throw new Error('Missing context: running');
      parts.push(padNumber(context.running, t.digitCount));
    }
  }

  return parts.join('');
}

/**
 * สร้าง preview string จาก pattern + sample context
 */
export function buildPreview(
  pattern: string,
  context: PatternRenderContext = {},
): string {
  const result = validateApplicationPattern(pattern, context);
  if (result.valid) return result.preview;
  return pattern; // fallback: return raw pattern on invalid
}

function padNumber(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Default pattern เมื่อ round ใหม่ไม่ได้กรอก
 */
export const DEFAULT_APPLICATION_PATTERN = '{YEAR}-{ROUND_CODE}-{RUNNING:4}';

// =============================================================================
// round_code validator
// =============================================================================

export const ROUND_CODE_MIN_LENGTH = 3;
export const ROUND_CODE_MAX_LENGTH = 20;
const ROUND_CODE_REGEX = /^[A-Z0-9]{3,20}$/;

export type RoundCodeValidation =
  | { valid: true; normalized: string }
  | { valid: false; error: string };

/**
 * Validate + normalize round_code
 * - Trim whitespace
 * - Uppercase
 * - Check alphanumeric 3-20 chars
 */
export function validateRoundCode(input: string | null | undefined): RoundCodeValidation {
  if (input == null) {
    return { valid: false, error: 'กรุณากรอกรหัสรอบ (round_code)' };
  }
  const trimmed = String(input).trim();
  if (!trimmed) {
    return { valid: false, error: 'กรุณากรอกรหัสรอบ (round_code)' };
  }
  const normalized = trimmed.toUpperCase();
  if (normalized.length < ROUND_CODE_MIN_LENGTH) {
    return {
      valid: false,
      error: `รหัสรอบต้องมีอย่างน้อย ${ROUND_CODE_MIN_LENGTH} ตัวอักษร (ปัจจุบัน ${normalized.length})`,
    };
  }
  if (normalized.length > ROUND_CODE_MAX_LENGTH) {
    return {
      valid: false,
      error: `รหัสรอบต้องไม่เกิน ${ROUND_CODE_MAX_LENGTH} ตัวอักษร (ปัจจุบัน ${normalized.length})`,
    };
  }
  if (!ROUND_CODE_REGEX.test(normalized)) {
    return {
      valid: false,
      error: 'รหัสรอบต้องเป็นตัวอักษรภาษาอังกฤษ (A-Z) และตัวเลข (0-9) เท่านั้น ห้ามมีช่องว่าง',
    };
  }
  return { valid: true, normalized };
}

/**
 * Helper: extract digit count จาก pattern string (ไม่ validate)
 * ใช้สำหรับ quick access เช่น "max capacity = 10^n - 1"
 */
export function extractRunningDigitCount(pattern: string): number | null {
  const m = pattern.match(/\{RUNNING:(\d+)\}/);
  return m ? parseInt(m[1], 10) : null;
}
