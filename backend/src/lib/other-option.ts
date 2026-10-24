/**
 * "อื่นๆ (โปรดระบุ)" — Other Option Support (shared contract)
 * ============================================================================
 *
 * Feature: Field Types RADIO / DROPDOWN / CHECKBOX รองรับตัวเลือก
 *          "อื่นๆ (โปรดระบุ)" ซึ่งเมื่อผู้สมัครเลือก จะต้องกรอกข้อความเพิ่มเติม
 *
 * ── Data contract ───────────────────────────────────────────────────────────
 *   ค่าที่เลือก (radio / dropdown)  → เก็บเป็น string ของ label ของ option
 *   ค่าที่เลือก (checkbox group)    → เก็บเป็น string[] ของ label ของ option
 *   ข้อความเพิ่มเติม                → เก็บใน key พี่น้อง `${fieldId}__other`
 *
 *   เหตุผลที่แยก key:
 *     - backward compatible: field เดิมยังเป็น scalar (string / boolean / array)
 *       → โค้ดเดิมที่อ่านค่า (PDF renderer, review page, lookup) ยังทำงานได้
 *     - key ใหม่ `${fieldId}__other` ถูกมองข้ามโดย renderer เดิม จึงไม่กระทบ
 *       แบบฟอร์มเก่าแม้แต่น้อย
 *
 * ── Display ────────────────────────────────────────────────────────────────
 *   ค่าที่แสดง = `อื่นๆ: <ข้อความ>` (ตามสเปค)
 */

/// Label ของ option "อื่นๆ" ที่แสดงในฟอร์ม (ต้องตรงกันทั้ง frontend / backend)
export const OTHER_OPTION_LABEL = "อื่นๆ (โปรดระบุ)";

/// Prefix ที่ใช้แสดงผล (เช่น PDF / Review / Application Detail)
export const OTHER_DISPLAY_LABEL = "อื่นๆ";

/// Suffix ของ key ที่เก็บข้อความเพิ่มเติม
export const OTHER_KEY_SUFFIX = "__other";

/**
 * Field type ที่รองรับตัวเลือก "อื่นๆ (โปรดระบุ)"
 */
export const OTHER_OPTION_FIELD_TYPES = ["RADIO", "DROPDOWN", "CHECKBOX"] as const;

/**
 * key ที่เก็บข้อความเพิ่มเติมของ field
 */
export function otherKey(fieldId: string): string {
  return `${fieldId}${OTHER_KEY_SUFFIX}`;
}

/**
 * ตรวจว่าค่า (string หรือ array ของ string) มี "อื่นๆ" อยู่หรือไม่
 */
export function isOtherValue(value: unknown): boolean {
  if (typeof value === "string") return value === OTHER_OPTION_LABEL;
  if (Array.isArray(value)) {
    return value.some((v) => v === OTHER_OPTION_LABEL);
  }
  return false;
}

/**
 * ดึงข้อความเพิ่มเติมจาก formData (ถ้ามี)
 */
export function extractOtherText(
  formData: Record<string, unknown> | null | undefined,
  fieldId: string
): string {
  if (!formData) return "";
  const raw = formData[otherKey(fieldId)];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  return "";
}

/**
 * จัดรูปแบบค่าสำหรับแสดงผลเมื่อผู้สมัครเลือก "อื่นๆ"
 *
 * @returns `อื่นๆ: xxx` เมื่อมีข้อความ, `อื่นๆ` เมื่อไม่มีข้อความ
 */
export function formatOtherDisplay(otherText: string | null | undefined): string {
  const trimmed = (otherText ?? "").trim();
  return trimmed ? `${OTHER_DISPLAY_LABEL}: ${trimmed}` : OTHER_DISPLAY_LABEL;
}

/**
 * แทนที่ label "อื่นๆ (โปรดระบุ)" ใน display string ด้วย "อื่นๆ: <ข้อความ>"
 *
 * ใช้กับ display string ที่ format เสร็จแล้ว (PDF / Preview / Review)
 * → รองรับทั้งค่าเดียว ("อื่นๆ (โปรดระบุ)") และค่าหลายรายการ
 *   (join ด้วย ", ") โดยอัตโนมัติ
 */
export function replaceOtherInDisplay(
  display: string,
  otherText: string | null | undefined
): string {
  if (!display || !display.includes(OTHER_OPTION_LABEL)) return display;
  return display.split(OTHER_OPTION_LABEL).join(formatOtherDisplay(otherText));
}

/**
 * จัดรูปแบบค่าของ field สำหรับแสดงผล (PDF / Preview)
 *
 * - ถ้าค่ามี "อื่นๆ" → แสดง "อื่นๆ: <ข้อความที่กรอก>"
 * - ถ้าไม่มี → คืนค่าเดิม
 */
export function formatFieldValueWithOther(
  fieldId: string,
  display: string,
  formData: Record<string, unknown> | null | undefined
): string {
  if (!display || !display.includes(OTHER_OPTION_LABEL)) return display;
  return replaceOtherInDisplay(display, extractOtherText(formData, fieldId));
}

/**
 * ทำให้รายการ options มี / ไม่มีตัวเลือก "อื่นๆ (โปรดระบุ)" อย่างถูกต้อง
 *
 * Idempotent — เรียกซ้ำได้โดยไม่เกิดตัวเลือกซ้ำ
 *
 * @param options รายการ options ที่ parse แล้ว (string[] | null)
 * @param allowOther true = ต้องมีตัวเลือก "อื่นๆ (โปรดระบุ)"
 */
export function applyOtherOption(
  options: string[] | null | undefined,
  allowOther: boolean | null | undefined
): string[] | null {
  const base = Array.isArray(options) ? options : [];
  const without = base.filter((o) => o !== OTHER_OPTION_LABEL);
  if (!allowOther) {
    // ไม่รองรับ → เอาตัวเลือก "อื่นๆ" ออก (ถ้ามีอยู่เดิมจากการกรอกเอง)
    return without.length > 0 ? without : null;
  }
  return [...without, OTHER_OPTION_LABEL];
}

/**
 * ตรวจว่า field นี้รองรับตัวเลือก "อื่นๆ" หรือไม่
 *
 * - allowOther = true → รองรับ (แม้ผู้ดูแลยังไม่ได้เพิ่ม label ลงใน options)
 * - options มี label อยู่แล้ว → รองรับ (ผู้ดูแลพิมพ์เอง)
 */
export function hasOtherOption(
  options: string[] | null | undefined,
  allowOther: boolean | null | undefined
): boolean {
  if (allowOther === true) return true;
  if (!Array.isArray(options)) return false;
  return options.includes(OTHER_OPTION_LABEL);
}

/**
 * Parse ค่า options ที่อาจเป็น string[] | JSON string | null → string[] | null
 *
 * คืน null เมื่อค่าไม่ใช่รายการตัวเลือก (เช่น MASTER_DATA ที่เป็น object)
 */
export function parseOptionsArray(
  input: unknown
): string[] | null {
  if (input === null || input === undefined) return null;
  if (Array.isArray(input)) {
    return input.filter((v): v is string => typeof v === "string");
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * เติม option "อื่นๆ (โปรดระบุ)" ถ้ายังไม่มี (append-only → backward compatible)
 *
 * ต่างจาก applyOtherOption ตรงที่ไม่ลบ option ที่มีอยู่เดิมออก
 * → แบบฟอร์มเดิมที่ผู้ดูแลพิมพ์ "อื่นๆ (โปรดระบุ)" เองยังทำงานเหมือนเดิม
 */
export function appendOtherOption(
  options: string[] | null | undefined,
  allowOther: boolean | null | undefined
): string[] | null {
  const base = Array.isArray(options) ? options : [];
  if (!allowOther) {
    return base.length > 0 ? base : null;
  }
  if (base.includes(OTHER_OPTION_LABEL)) return base;
  return [...base, OTHER_OPTION_LABEL];
}
