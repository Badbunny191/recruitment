/**
 * TEXTAREA Answer Validation (submit-side)
 * =======================================================================
 *
 * Pure function — ไม่พึ่ง DB ใช้ร่วมกับ public submit route
 * เพื่อให้ unit test ครอบคลุมกฎได้โดยตรง
 *
 * นับความยาวด้วย `String.length` (UTF-16 code units) ให้ผลตรงกับ
 * HTML textarea maxlength และ character counter ฝั่ง client
 * (สระ/วรรณยุกต์ไทย 1 หน่วย, emoji ทั่วไป 2 หน่วย — ตรงกันทั้งสองฝั่ง)
 *
 * Fallback (ข้อมูลเก่า):
 *   - minLength null/undefined → ไม่บังคับขั้นต่ำ
 *   - maxLength null/undefined → ใช้ Global Hard Cap TEXTAREA_LENGTH_CAP (5000)
 */

import { TEXTAREA_LENGTH_CAP } from '../schemas/validators';

export interface TextareaFieldRule {
  fieldId: string;
  isRequired: boolean;
  minLength: number | null;
  maxLength: number | null;
}

export interface TextareaValidationSuccess {
  ok: true;
}

export interface TextareaValidationFailure {
  ok: false;
  /** error code ที่ไม่เปิดเผยข้อมูลภายใน */
  code:
    | 'REQUIRED_FIELD_EMPTY'
    | 'INVALID_TEXTAREA_VALUE'
    | 'TEXTAREA_TOO_SHORT'
    | 'TEXTAREA_TOO_LONG';
  /** ข้อความภาษาไทยที่แสดงผู้สมัคร — ห้ามฝังค่าคำตอบ */
  message: string;
  fieldId: string;
}

export function effectiveTextareaMaxLength(
  maxLength: number | null | undefined
): number {
  return maxLength ?? TEXTAREA_LENGTH_CAP;
}

export function validateTextareaAnswer(
  value: unknown,
  rule: TextareaFieldRule
): TextareaValidationSuccess | TextareaValidationFailure {
  // คำตอบต้องเป็น string เท่านั้น (ห้าม object/number/array สำหรับ TEXTAREA)
  if (value !== null && value !== undefined && typeof value !== 'string') {
    return {
      ok: false,
      code: 'INVALID_TEXTAREA_VALUE',
      message: 'รูปแบบคำตอบไม่ถูกต้อง กรุณากรอกข้อความ',
      fieldId: rule.fieldId,
    };
  }

  const raw = typeof value === 'string' ? value : '';

  // Required: trim แล้วว่าง (รวม whitespace ล้วน) = ไม่มีคำตอบ
  if (rule.isRequired && raw.trim().length === 0) {
    return {
      ok: false,
      code: 'REQUIRED_FIELD_EMPTY',
      message: 'กรุณากรอกข้อมูลที่จำเป็น',
      fieldId: rule.fieldId,
    };
  }

  // Optional และว่างจริง → ผ่าน (ไม่ตรวจความยาว)
  if (raw.length === 0) {
    return { ok: true };
  }

  // Optional แต่เริ่มกรอกแล้ว (หรือ required) → ตรวจ minLength
  // นับด้วย raw string length (ไม่ trim — ช่องว่างเป็นส่วนของคำตอบ)
  const minLength = rule.minLength ?? null;
  if (minLength != null && raw.length < minLength) {
    return {
      ok: false,
      code: 'TEXTAREA_TOO_SHORT',
      message: `คำตอบสั้นเกินกำหนด ต้องมีอย่างน้อย ${minLength.toLocaleString('th-TH')} ตัวอักษร`,
      fieldId: rule.fieldId,
    };
  }

  // effective maxLength = field.maxLength ?? Global Hard Cap
  const effectiveMax = effectiveTextareaMaxLength(rule.maxLength);
  if (raw.length > effectiveMax) {
    return {
      ok: false,
      code: 'TEXTAREA_TOO_LONG',
      message: `คำตอบยาวเกินกำหนด สูงสุด ${effectiveMax.toLocaleString('th-TH')} ตัวอักษร`,
      fieldId: rule.fieldId,
    };
  }

  return { ok: true };
}
