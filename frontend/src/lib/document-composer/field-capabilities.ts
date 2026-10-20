/**
 * field-capabilities (Frontend)
 * ------------------------------------------------------------------
 * Single source of truth ของกฎ "field นี้เอาไปทำเป็น Table ได้ไหม"
 *
 * ⚠️ สำคัญ: ไฟล์นี้เป็น **mirror** ของ backend
 *   `backend/src/lib/document-composer/field-capabilities.ts`
 *   ทุก logic ต้องตรงกัน — ไม่งั้น Table Picker จะเสนอ field ที่
 *   PDF renderer render ไม่ได้จริง
 *
 * Requirement G — Table Picker ต้องแสดง**เฉพาะ** field ที่ repeatable จริง:
 *   - isRepeatable === true
 *   - valueShape === "array"
 *   - type เป็น REPEATER / TABLE
 *
 * และห้ามแสดง:
 *   - scalar fields (TEXT / EMAIL / PHONE / NUMBER / DATE / FILE / CHECKBOX)
 *   - TEXTAREA แบบค่าเดียว, DROPDOWN / RADIO แบบ single-select
 *   - MASTER_DATA แบบ single-select เช่น "สังกัดปัจจุบัน"
 *     (เป็น object `{ id, name }` ไม่ใช่ array)
 *
 * ── เหตุผลที่ไม่ import จาก backend ────────────────────────────────────
 *   Frontend เป็น Next.js (client bundle) — backend เป็น Hono + Drizzle
 *   การ import ข้าม boundary จะดึง Drizzle schema เข้ามาด้วย
 *   จึง mirror เฉพาะ pure functions ที่ไม่มี dependency
 *   (และมี test ยืนยันว่ากฎตรงกัน)
 */

// =============================================================================
// Types
// =============================================================================

export type FieldValueShape = 'scalar' | 'array' | 'object';

export interface RepeatableCapability {
  /** true เฉพาะ field ที่มีค่าเป็นหลายรายการจริง */
  isRepeatable: boolean;
  valueShape: FieldValueShape;
  /** เหตุผลที่ไม่ repeatable (ใช้แสดง hint ใน UI) */
  reason?: string;
}

/**
 * Application field type — enum ที่ใช้ใน `template_fields.type`
 *
 * `UNKNOWN` = type ใหม่ที่ client ไม่รู้จัก → safe default = scalar
 */
export type ApplicationFieldType =
  | 'TEXT'
  | 'EMAIL'
  | 'PHONE'
  | 'NUMBER'
  | 'TEXTAREA'
  | 'DROPDOWN'
  | 'RADIO'
  | 'CHECKBOX'
  | 'FILE'
  | 'DATE'
  | 'MASTER_DATA'
  | 'REPEATER'
  | 'TABLE'
  | 'UNKNOWN';

// =============================================================================
// Value shape helpers
// =============================================================================

/** ตรวจ value เป็น "object เดี่ยวที่อ่านได้" (MASTER_DATA แบบ single-select) */
export function isSingleValueObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ตรวจ value เป็น "array of objects" (table / repeater) */
export function isArrayOfObjects(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  );
}

// =============================================================================
// Type classification
// =============================================================================

/** normalize type เป็น ApplicationFieldType (unknown → 'UNKNOWN') */
export function normalizeFieldType(
  type: string | undefined | null
): ApplicationFieldType {
  if (!type) return 'UNKNOWN';
  const t = type.toUpperCase();
  const known: readonly ApplicationFieldType[] = [
    'TEXT',
    'EMAIL',
    'PHONE',
    'NUMBER',
    'TEXTAREA',
    'DROPDOWN',
    'RADIO',
    'CHECKBOX',
    'FILE',
    'DATE',
    'MASTER_DATA',
    'REPEATER',
    'TABLE',
  ];
  return (known as readonly string[]).includes(t) ? (t as ApplicationFieldType) : 'UNKNOWN';
}

/**
 * type ที่เก็บ "ค่าเดียว" (scalar)
 *
 * รวม `MASTER_DATA` แบบ single-select และ `DROPDOWN`/`RADIO`
 * เพราะทั้งหมดเก็บค่าเดียวเว้นแต่ถ้า value เป็น array จะถูกจัดการที่
 * {@link getFieldCapability} แทน
 */
export function isScalarFieldType(type: string | undefined | null): boolean {
  const t = normalizeFieldType(type);
  return (
    t === 'TEXT' ||
    t === 'EMAIL' ||
    t === 'PHONE' ||
    t === 'NUMBER' ||
    t === 'TEXTAREA' ||
    t === 'DATE' ||
    t === 'FILE' ||
    t === 'CHECKBOX' ||
    t === 'DROPDOWN' ||
    t === 'RADIO' ||
    t === 'MASTER_DATA'
  );
}

/** type ที่เป็น repeatable โดยชัดเจน */
export function isRepeatableType(type: string | undefined | null): boolean {
  const t = normalizeFieldType(type);
  return t === 'REPEATER' || t === 'TABLE';
}

// =============================================================================
// Capability (กฎหลัก — mirror backend getFieldCapability)
// =============================================================================

/**
 * ตรวจ capability ของ Application Field
 *
 * @param type - field type
 * @param value - sample value (ถ้ามี — ใช้ตัดสิน MASTER_DATA multi-select)
 *
 * Logic (ต้องตรงกับ backend แบบ 100%):
 *   1. type เป็น REPEATER / TABLE → repeatable (array)
 *   2. ถ้ามี value:
 *      - array           → repeatable (array)
 *      - object เดี่ยว    → scalar (object) — เช่น MASTER_DATA single-select
 *      - primitive       → scalar
 *   3. ไม่มี value → ใช้ type: scalar type → scalar
 *   4. unknown type → safe default = scalar
 */
export function getFieldCapability(
  type: string | undefined | null,
  value?: unknown
): RepeatableCapability {
  if (isRepeatableType(type)) {
    return { isRepeatable: true, valueShape: 'array' };
  }

  if (value !== undefined && value !== null) {
    if (Array.isArray(value)) {
      return { isRepeatable: true, valueShape: 'array' };
    }
    if (typeof value === 'object') {
      return {
        isRepeatable: false,
        valueShape: 'object',
        reason: 'Field เป็นค่าเดียว (object) ไม่ใช่หลายรายการ',
      };
    }
    return { isRepeatable: false, valueShape: 'scalar' };
  }

  if (isScalarFieldType(type)) {
    return { isRepeatable: false, valueShape: 'scalar' };
  }

  return {
    isRepeatable: false,
    valueShape: 'scalar',
    reason: 'ไม่รู้จักประเภทฟิลด์นี้ — ถือว่าเป็นค่าเดียว',
  };
}

/** ตรวจว่า field นี้ render เป็น table ได้จริงหรือไม่ */
export function isRepeatableField(
  type: string | undefined | null,
  value?: unknown
): boolean {
  return getFieldCapability(type, value).isRepeatable;
}

/** ดู value shape ของ field จาก value ที่ได้ */
export function getFieldValueShape(value: unknown): FieldValueShape {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'scalar';
}

// =============================================================================
// Display label (Requirement F — ห้ามแสดง JSON ดิบ)
// =============================================================================

/**
 * ดึง display label จาก single-value object
 *
 * Priority: `name` → `label` → `id` → `—`
 * (ห้าม JSON.stringify — Requirement F.6/F.7)
 */
export function getObjectDisplayLabel(value: Record<string, unknown>): string {
  const name = value.name;
  if (typeof name === 'string' && name.trim()) return name.trim();

  const label = value.label;
  if (typeof label === 'string' && label.trim()) return label.trim();

  const id = value.id;
  if (id !== undefined && id !== null) return String(id);

  return '—';
}