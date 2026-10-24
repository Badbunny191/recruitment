/**
 * "อื่นๆ (โปรดระบุ)" — Other Option Support (frontend shared contract)
 * ============================================================================
 *
 * Feature: Field Types RADIO / DROPDOWN / CHECKBOX รองรับตัวเลือก
 *          "อื่นๆ (โปรดระบุ)" ซึ่งเมื่อผู้สมัครเลือก จะต้องกรอกข้อความเพิ่มเติม
 *
 * ── Data contract (ต้องตรงกับ backend/src/lib/other-option.ts) ──────────────
 *   ค่าที่เลือก (radio / dropdown)  → string ของ label ของ option
 *   ค่าที่เลือก (checkbox group)    → string[] ของ label ของ option
 *   ข้อความเพิ่มเติม                → key พี่น้อง `${fieldId}__other`
 *
 * ── Backward compatibility ────────────────────────────────────────────────
 *   - field เดิม (ไม่มี option "อื่นๆ") → ทำงานเหมือนเดิมทุกประการ
 *   - formData ที่มีอยู่แล้ว → ไม่มี key `__other` → อ่านได้ตามปกติ
 */

/** Label ของ option "อื่นๆ" ที่แสดงในฟอร์ม (ต้องตรงกับ backend) */
export const OTHER_OPTION_LABEL = 'อื่นๆ (โปรดระบุ)';

/** Prefix ที่ใช้แสดงผล (เช่น Review / Application Detail) */
export const OTHER_DISPLAY_LABEL = 'อื่นๆ';

/** Suffix ของ key ที่เก็บข้อความเพิ่มเติม */
export const OTHER_KEY_SUFFIX = '__other';

/** key ที่เก็บข้อความเพิ่มเติมของ field */
export function otherKey(fieldId: string): string {
  return `${fieldId}${OTHER_KEY_SUFFIX}`;
}

/** ตรวจว่า field นี้รองรับ option "อื่นๆ" หรือไม่ (จากรายการ options) */
export function supportsOtherOption(options: string[] | null | undefined): boolean {
  if (!Array.isArray(options)) return false;
  return options.includes(OTHER_OPTION_LABEL);
}

/** ตรวจว่าค่า (string หรือ string[]) มี "อื่นๆ" อยู่หรือไม่ */
export function isOtherValue(value: unknown): boolean {
  if (typeof value === 'string') return value === OTHER_OPTION_LABEL;
  if (Array.isArray(value)) return value.some((v) => v === OTHER_OPTION_LABEL);
  return false;
}

/** จัดรูปแบบข้อความเพิ่มเติมสำหรับแสดงผล */
export function formatOtherDisplay(otherText: string | null | undefined): string {
  const trimmed = (otherText ?? '').trim();
  return trimmed ? `${OTHER_DISPLAY_LABEL}: ${trimmed}` : OTHER_DISPLAY_LABEL;
}

/**
 * แทนที่ label "อื่นๆ (โปรดระบุ)" ในข้อความที่แสดง ด้วย "อื่นๆ: <ข้อความ>"
 *
 * ใช้กับ display string ที่ format เสร็จแล้ว (เช่น PDF / Review)
 * → ทำงานได้ทั้งกรณีค่าเดียวและกรณีหลายค่า (join ด้วย ", ")
 */
export function replaceOtherInDisplay(display: string, otherText: string | null | undefined): string {
  if (!display || !display.includes(OTHER_OPTION_LABEL)) return display;
  return display.split(OTHER_OPTION_LABEL).join(formatOtherDisplay(otherText));
}

/**
 * เพิ่ม / ลบ option "อื่นๆ" ออกจากรายการ options
 *
 * @param options รายการ options ปัจจุบัน
 * @param enabled true = ต้องมี "อื่นๆ", false = ต้องไม่มี
 */
export function withOtherOption(options: string[], enabled: boolean): string[] {
  const without = options.filter((o) => o !== OTHER_OPTION_LABEL);
  return enabled ? [...without, OTHER_OPTION_LABEL] : without;
}

/**
 * คำนวณรายการ options ที่ "ใช้งานจริง" ของ field
 *
 * - overrideOptions มีค่า → ใช้ค่านั้น (override ชนะ master)
 * - ไม่มี → ใช้ options จาก master
 * - ถ้า allowOther = true → ต้องมี "อื่นๆ (โปรดระบุ)" เสมอ
 *
 * ทำให้ผู้ดูแลไม่ต้องพิมพ์ label เอง และแบบฟอร์มเดิม (allowOther ไม่มีค่า)
 * ยังทำงานเหมือนเดิมทุกประการ
 */
export function effectiveOptions(
  options: string[] | null | undefined,
  overrideOptions: string[] | null | undefined,
  allowOther: boolean | null | undefined
): string[] {
  const base = Array.isArray(overrideOptions) && overrideOptions.length > 0
    ? overrideOptions
    : Array.isArray(options)
      ? options
      : [];
  if (!allowOther) return base;
  return withOtherOption(base, true);
}
