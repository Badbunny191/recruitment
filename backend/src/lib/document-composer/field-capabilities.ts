/**
 * Field capabilities — ใช้บอกว่า field นี้ "เป็น table ได้" หรือไม่
 *
 * Requirement G: Table Picker ต้องแสดงเฉพาะ field ที่มี capability
 *   - isRepeatable === true
 *   - valueShape === "array"
 *   - field schema มี columns
 *   - REPEATER / TABLE
 *
 * และห้ามแสดง field ค่าเดียว:
 *   - EMAIL / TEXT / PHONE / NUMBER / DATE / FILE / CHECKBOX
 *   - TEXTAREA แบบค่าเดียว
 *   - MASTER_DATA แบบ single-select
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *   "สังกัดปัจจุบัน" เป็น MASTER_DATA แบบ single-select (Requirement F)
 *   → ต้องไม่ปรากฏใน Table Picker เพราะมันเป็น "ค่าเดียว ไม่ใช่หลายรายการ"
 *
 * ── Single source of truth ───────────────────────────────────────────────
 *   ใช้จากทั้ง frontend (Table Picker) และ backend (renderer / validator)
 *   เพื่อให้ฝั่งเดียวกัน filter ตามกฎเดียวกัน
 */

/** Value shape ของ Application Field */
export type FieldValueShape = "scalar" | "array" | "object";

/** Capability ของ field — ใช้ตอน filter table picker */
export interface RepeatableCapability {
  /** ใช้แสดงใน table picker ได้ */
  isRepeatable: boolean;
  /** value shape ของ field นี้ */
  valueShape: FieldValueShape;
  /** เหตุผล (ถ้าไม่ repeatable) — ใช้แสดง UI hint */
  reason?: string;
}

/**
 * Application field type — enum ที่ใช้ใน template_fields.type
 *
 * ใช้ string literal ที่รู้จักทั้งหมด ถ้าเจอ type ใหม่จะถือว่า scalar (safe default)
 */
export type ApplicationFieldType =
  | "TEXT"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "TEXTAREA"
  | "DROPDOWN"
  | "RADIO"
  | "CHECKBOX"
  | "FILE"
  | "DATE"
  | "MASTER_DATA"
  | "REPEATER"
  | "TABLE"
  | "UNKNOWN";

/**
 * ค่า field แบบ object — เช่น MASTER_DATA ค่าเดียวที่มี id+name
 *
 * ดูเพิ่มที่ Requirement F: MASTER_DATA = { id, name }
 */
export interface FieldObjectValue {
  id?: string | number | null;
  name?: string | null;
  label?: string | null;
  [key: string]: unknown;
}

/**
 * Helper: ตรวจ value เป็น "object เดี่ยวที่อ่านได้" หรือไม่
 *
 * ใช้สำหรับ MASTER_DATA แบบ single-select
 */
export function isSingleValueObject(
  value: unknown
): value is FieldObjectValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Helper: ตรวจ value เป็น "array of objects" หรือไม่
 *
 * ใช้สำหรับ table/repeater render
 */
export function isArrayOfObjects(
  value: unknown
): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false;
  // ในทางปฏิบัติ array ของค่าเดียว (string/number) ไม่ใช่ table
  // แต่ array ของ object ที่มี keys >= 1 คือ table แน่นอน
  return value.every(
    (item) => typeof item === "object" && item !== null && !Array.isArray(item)
  );
}

/**
 * ตรวจว่า type เป็น scalar (ค่าเดียว) หรือไม่
 *
 * Scalar types:
 *   - TEXT, EMAIL, PHONE, NUMBER, TEXTAREA (single)
 *   - DATE, FILE, CHECKBOX (single)
 *   - DROPDOWN, RADIO (single-select)
 *   - MASTER_DATA (single-select) — ดู Requirement F
 */
export function isScalarFieldType(type: string | undefined | null): boolean {
  if (!type) return true;
  const t = type.toUpperCase();
  return (
    t === "TEXT" ||
    t === "EMAIL" ||
    t === "PHONE" ||
    t === "NUMBER" ||
    t === "TEXTAREA" ||
    t === "DATE" ||
    t === "FILE" ||
    t === "CHECKBOX" ||
    t === "DROPDOWN" ||
    t === "RADIO" ||
    t === "MASTER_DATA" // single-select เท่านั้น
  );
}

/**
 * ตรวจว่า type เป็น repeatable (table) หรือไม่
 *
 * Repeatable types:
 *   - REPEATER, TABLE
 *   - MASTER_DATA แบบ multi-select (ตรวจจาก value เป็น array)
 */
export function isRepeatableType(type: string | undefined | null): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return t === "REPEATER" || t === "TABLE";
}

/**
 * ตรวจ capability ของ Application Field
 *
 * @param type - field type
 * @param value - sample value (optional — ใช้ตรวจ MASTER_DATA multi-select)
 *
 * Logic:
 *   - ถ้า type เป็น REPEATER / TABLE → repeatable
 *   - ถ้า value เป็น array → repeatable (override)
 *   - ถ้า value เป็น object เดียว → scalar (single)
 *   - ถ้า type scalar อื่น → scalar
 *   - ถ้า type unknown → check จาก value shape
 */
export function getFieldCapability(
  type: string | undefined | null,
  value?: unknown
): RepeatableCapability {
  // case 1: explicit repeatable types
  if (isRepeatableType(type)) {
    return {
      isRepeatable: true,
      valueShape: "array",
    };
  }

  // case 2: MASTER_DATA หรือ scalar types — ตรวจจาก value
  if (value !== undefined && value !== null) {
    if (Array.isArray(value)) {
      // MASTER_DATA แบบ multi-select, REPEATER, etc.
      return {
        isRepeatable: true,
        valueShape: "array",
      };
    }
    if (typeof value === "object") {
      // single-value object (MASTER_DATA แบบ single-select, etc.)
      return {
        isRepeatable: false,
        valueShape: "object",
        reason: "Field is a single-value object",
      };
    }
    // primitive → scalar
    return {
      isRepeatable: false,
      valueShape: "scalar",
    };
  }

  // case 3: ไม่มี value, ใช้ type
  if (isScalarFieldType(type)) {
    return {
      isRepeatable: false,
      valueShape: "scalar",
    };
  }

  // case 4: unknown type — safe default = scalar
  return {
    isRepeatable: false,
    valueShape: "scalar",
    reason: "Unknown field type — treated as scalar",
  };
}

/**
 * Helper: ดู value shape ของ field จาก value
 *
 * ใช้ใน renderer เพื่อเลือก strategy:
 *   - scalar → แสดงค่าเดียว
 *   - object → แสดง display field (name / label)
 *   - array → แสดง table
 */
export function getFieldValueShape(value: unknown): FieldValueShape {
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "scalar";
}

/**
 * Helper: ตรวจว่า field นี้ render เป็น table ได้
 */
export function isRepeatableField(
  type: string | undefined | null,
  value?: unknown
): boolean {
  return getFieldCapability(type, value).isRepeatable;
}

/**
 * Helper: ดึง display label จาก single-value object
 *
 * Requirement F.5: ถ้าค่าเป็น object ให้เลือก display label ที่เหมาะสม
 *
 * Priority:
 *   1. `name` (มาตรฐาน MASTER_DATA)
 *   2. `label` (fallback)
 *   3. `id` (ถ้าเป็น primitive)
 *   4. JSON string (สุดท้าย — แต่ renderer ไม่ใช้ case นี้แล้ว)
 */
export function getObjectDisplayLabel(value: FieldObjectValue): string {
  if (typeof value.name === "string" && value.name.trim()) {
    return value.name.trim();
  }
  if (typeof value.label === "string" && value.label.trim()) {
    return value.label.trim();
  }
  if (value.id !== undefined && value.id !== null) {
    return String(value.id);
  }
  // safe readable fallback (Requirement F.7)
  return "—";
}
