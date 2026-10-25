/**
 * Field Settings Validation (builder-side)
 * =======================================================================
 *
 * Client-side mirror ของ backend TemplateFieldCreateSchema
 * (backend/src/schemas/validators.ts) สำหรับ rows/minLength/maxLength
 * ใช้แสดง inline error ใน Advanced Settings ของ Template Builder
 *
 * ค่า input เป็น string (RHF register ไม่แปลง) — ค่าว่าง = ไม่กำหนด
 */

export const FIELD_ROWS_MIN = 1;
export const FIELD_ROWS_MAX = 20;
export const FIELD_LENGTH_CAP = 5000;

export interface FieldSettingsInput {
  rows?: string;
  minLength?: string;
  maxLength?: string;
}

/** ตรวจค่า rows/minLength/maxLength → error ภาษาไทย (คั่นด้วย " / ") หรือ null */
export function validateFieldSettings(f: FieldSettingsInput): string | null {
  const errors: string[] = [];
  const parse = (s?: string): number | null => {
    if (s == null || s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };

  const rows = parse(f.rows);
  if (rows != null && (!Number.isInteger(rows) || rows < FIELD_ROWS_MIN || rows > FIELD_ROWS_MAX)) {
    errors.push('ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด');
  }

  const minLength = parse(f.minLength);
  if (minLength != null && (!Number.isInteger(minLength) || minLength < 0)) {
    errors.push('ความยาวขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  } else if (minLength != null && minLength > FIELD_LENGTH_CAP) {
    errors.push('ความยาวขั้นต่ำต้องไม่เกิน 5,000 ตัวอักษร');
  }

  const maxLength = parse(f.maxLength);
  if (maxLength != null && (!Number.isInteger(maxLength) || maxLength < 1)) {
    errors.push('ความยาวสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  } else if (maxLength != null && maxLength > FIELD_LENGTH_CAP) {
    errors.push('ความยาวสูงสุดต้องไม่เกิน 5,000 ตัวอักษร');
  }

  if (minLength != null && Number.isInteger(minLength) && minLength >= 0 && minLength <= FIELD_LENGTH_CAP) {
    const effectiveMax =
      maxLength != null && Number.isInteger(maxLength) && maxLength >= 1
        ? maxLength
        : FIELD_LENGTH_CAP;
    if (minLength > effectiveMax) {
      errors.push('ความยาวขั้นต่ำต้องไม่มากกว่าความยาวสูงสุด');
    }
  }

  return errors.length > 0 ? errors.join(' / ') : null;
}
