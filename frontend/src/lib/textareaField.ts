/**
 * TEXTAREA Field Settings (applicant-side)
 * =======================================================================
 *
 * Pure helpers สำหรับ Rich Field Metadata ของ TEXTAREA
 * (rows / minLength / maxLength จาก public schema)
 *
 * นับความยาวด้วย String.length (UTF-16 code units) ให้ผลตรงกับ
 * HTML textarea maxlength และ backend validation (textarea-validation.ts)
 *
 * Fallback ข้อมูลเก่า:
 *   - rows null      → 4 (เท่าค่าที่ hardcode มาก่อน)
 *   - minLength null → ไม่บังคับขั้นต่ำ
 *   - maxLength null → Global Hard Cap 5000
 */

export const TEXTAREA_FALLBACK_ROWS = 4;
export const TEXTAREA_HARD_CAP = 5000;

export interface TextareaFieldSettings {
  rows?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
}

export function getTextareaRows(settings: TextareaFieldSettings): number {
  return settings.rows ?? TEXTAREA_FALLBACK_ROWS;
}

export function getTextareaMinLength(
  settings: TextareaFieldSettings
): number | null {
  return settings.minLength ?? null;
}

export function getTextareaMaxLength(settings: TextareaFieldSettings): number {
  return settings.maxLength ?? TEXTAREA_HARD_CAP;
}

/** นับความยาวแบบ UTF-16 (String.length) — ตรงกับ native maxlength */
export function countUtf16Units(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

/**
 * ระดับการเตือนของ counter
 * - "warning" เมื่อเหลือไม่เกิน 10% (len ≥ 90% แต่ยังไม่ถึงเพดาน)
 * - "max" เมื่อถึงเพดาน
 * - "normal" อื่น ๆ
 */
export function counterLevel(len: number, max: number): 'normal' | 'warning' | 'max' {
  if (len >= max) return 'max';
  if (max > 0 && len >= max * 0.9) return 'warning';
  return 'normal';
}

/** ข้อความ counter: "123 / 5,000 ตัวอักษร" */
export function formatCounter(len: number, max: number): string {
  return `${len.toLocaleString('th-TH')} / ${max.toLocaleString('th-TH')} ตัวอักษร`;
}

/**
 * RHF validate rule สำหรับ minLength ของ TEXTAREA
 * - ค่าว่าง (optional) → ผ่าน (ให้ required จัดการ)
 * - มีค่าแล้วต้องยาวถึง minLength (นับ raw length ไม่ trim)
 */
export function textareaMinLengthValidator(
  minLength: number | null
): (value: unknown) => true | string {
  return (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) return true;
    if (minLength == null || value.length >= minLength) return true;
    return `กรุณากรอกให้ครบอย่างน้อย ${minLength.toLocaleString('th-TH')} ตัวอักษร`;
  };
}

/**
 * RHF validate rule สำหรับ maxLength ของ TEXTAREA
 * (native maxlength ป้องกันการพิมพ์เกินอยู่แล้ว — rule นี้กันกรณี
 * ค่าจาก draft/เบราว์เซอร์เก่าไม่รองรับ maxlength)
 */
export function textareaMaxLengthValidator(
  maxLength: number
): (value: unknown) => true | string {
  return (value: unknown) => {
    if (typeof value !== 'string') return true;
    return (
      value.length <= maxLength ||
      `คำตอบยาวเกินกำหนด (สูงสุด ${maxLength.toLocaleString('th-TH')} ตัวอักษร)`
    );
  };
}

/**
 * RHF validate rule: required TEXTAREA ที่เป็น whitespace ล้วน = ไม่มีคำตอบ
 * (RHF required จับแค่ "" — " " ต้องมาตรวจที่นี่)
 */
export function textareaNotBlankValidator(
  isRequired: boolean
): (value: unknown) => true | string {
  return (value: unknown) => {
    if (!isRequired) return true;
    if (typeof value === 'string' && value.trim().length === 0) {
      return 'กรุณากรอกข้อมูล';
    }
    return true;
  };
}
