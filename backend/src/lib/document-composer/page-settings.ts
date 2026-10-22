/**
 * Document Page Settings — Pure Helpers
 * --------------------------------------------
 * Feature: Document Composer — Page Settings (margin ของหน้ากระดาษ)
 *
 * ⚠️ ขอบเขตของก้อนนี้
 *   - ตั้งค่านี้มีผลกับ **ตัวอย่างเอกสาร (Preview)** เท่านั้น
 *   - PDF Renderer (descriptor-renderer.ts) ยังไม่รองรับ → รอก้อนถัดไป
 *
 * ── Design Principles ────────────────────────────────────────────────────
 *   1. **Pure functions** — ไม่มี side effect → เขียน test ได้ง่าย
 *   2. **Defensive** — ค่า invalid / NaN / Infinity ต้อง fallback หรือ clamp
 *      โดยไม่ throw (ไม่ทำให้ Preview หรือหน้าเว็บล้ม)
 *   3. **Backward compatible** — descriptor ที่ไม่มี `pageSettings`
 *      → fallback เป็น 40pt ทุกด้าน (ค่าเดิมของระบบ)
 *   4. **ไม่ bump version** — `DocumentDescriptor.version` ยังคงเป็น 1
 *      และไม่มี DB migration (เก็บอยู่ใน descriptor_json เดิม)
 *
 * ── หน่วยวัด ─────────────────────────────────────────────────────────────
 *   - Descriptor เก็บค่าเป็น **pt** (จุด) — เป็นหน่วยเดียวกับ PDF renderer
 *   - UI แสดงผลเป็น **มม.** (มิลลิเมตร) เพื่อความเข้าใจง่าย
 *   - 1 inch = 72 pt = 25.4 mm
 */

import { z } from "zod";

// =============================================================================
// Constants — single source of truth
// =============================================================================

/** จำนวนจุดต่อนิ้ว */
export const PT_PER_INCH = 72;

/** จำนวนมิลลิเมตรต่อนิ้ว */
export const MM_PER_INCH = 25.4;

/** ความกว้างหน้ากระดาษ A4 (pt) */
export const PAGE_WIDTH_PT = 595.28;

/** ความสูงหน้ากระดาษ A4 (pt) */
export const PAGE_HEIGHT_PT = 841.89;

/** ขอบกระดาษเริ่มต้น (pt) — ใช้เป็น fallback ทุกกรณี */
export const DEFAULT_MARGIN_PT = 40;

/** ขอบกระดาษต่ำสุด (pt) */
export const MIN_MARGIN_PT = 10;

/** ขอบกระดาษสูงสุด (pt) */
export const MAX_MARGIN_PT = 144;

/** พื้นที่เนื้อหาขั้นต่ำ (pt) — ป้องกันเนื้อหาหายไปทั้งหมด */
export const MIN_CONTENT_SIZE_PT = 200;

/** ค่าขอบกระดาษของแต่ละ preset (pt) */
export const PRESET_MARGIN_PT = {
  narrow: 28,
  normal: 40,
  wide: 72,
} as const;

// =============================================================================
// Types
// =============================================================================

/** รูปแบบขอบกระดาษที่เลือกได้ */
export type PageMarginPreset = "narrow" | "normal" | "wide" | "custom";

/** ค่าขอบกระดาษต่อด้าน (pt) */
export type PageMarginSide = "top" | "right" | "bottom" | "left";

/** การตั้งค่าหน้ากระดาษ (เก็บใน descriptor เป็น pt) */
export interface PageSettings {
  /** preset ที่เลือก */
  preset: PageMarginPreset;
  /** ขอบบน (pt) */
  top: number;
  /** ขอบขวา (pt) */
  right: number;
  /** ขอบล่าง (pt) */
  bottom: number;
  /** ขอบซ้าย (pt) */
  left: number;
}

/** ผลลัพธ์ของ resolvePageGeometry() — ใช้ render preview */
export interface PageGeometry {
  /** preset ที่ใช้จริง (normalize แล้ว) */
  preset: PageMarginPreset;
  /** ขอบบน (pt) — clamp แล้ว */
  marginTop: number;
  /** ขอบขวา (pt) — clamp แล้ว */
  marginRight: number;
  /** ขอบล่าง (pt) — clamp แล้ว */
  marginBottom: number;
  /** ขอบซ้าย (pt) — clamp แล้ว */
  marginLeft: number;
  /** ความกว้างพื้นที่เนื้อหา (pt) — ไม่น้อยกว่า MIN_CONTENT_SIZE_PT */
  contentWidth: number;
  /** ความสูงพื้นที่เนื้อหา (pt) — ไม่น้อยกว่า MIN_CONTENT_SIZE_PT */
  contentHeight: number;
  /** ความกว้างหน้ากระดาษ (pt) */
  pageWidth: number;
  /** ความสูงหน้ากระดาษ (pt) */
  pageHeight: number;
}

// =============================================================================
// Unit conversion — pure
// =============================================================================

/**
 * แปลง pt → mm (ปัดทศนิยม 1 ตำแหน่งสำหรับแสดงผลใน UI)
 *
 * ค่า invalid → คืน NaN-safe fallback (0) โดยไม่ throw
 */
export function ptToMm(pt: number): number {
  if (typeof pt !== "number" || !Number.isFinite(pt)) return 0;
  return round1((pt / PT_PER_INCH) * MM_PER_INCH);
}

/**
 * แปลง mm → pt (ปัดทศนิยม 1 ตำแหน่งเพื่อให้ descriptor อ่านง่าย)
 *
 * ค่า invalid → fallback (DEFAULT_MARGIN_PT)
 */
export function mmToPt(mm: number): number {
  if (typeof mm !== "number" || !Number.isFinite(mm)) return DEFAULT_MARGIN_PT;
  return round1((mm / MM_PER_INCH) * PT_PER_INCH);
}

/** ปัดทศนิยม 1 ตำแหน่ง */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// =============================================================================
// Clamp / fallback — pure
// =============================================================================

/**
 * Clamp ค่าขอบกระดาษ (pt) ให้อยู่ในช่วงที่ใช้ได้
 *
 * - NaN / ค่าที่ไม่ใช่ number → fallback (default 40pt)
 * - +Infinity → clamp เป็น 144pt (max)
 * - -Infinity → clamp เป็น 10pt (min)
 * - ต่ำกว่า 10 → 10 / สูงกว่า 144 → 144
 */
export function clampMarginPt(
  value: unknown,
  fallback: number = DEFAULT_MARGIN_PT
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return clampMarginPt(fallback, DEFAULT_MARGIN_PT);
  }
  if (value === Number.POSITIVE_INFINITY) return MAX_MARGIN_PT;
  if (value === Number.NEGATIVE_INFINITY) return MIN_MARGIN_PT;
  if (value < MIN_MARGIN_PT) return MIN_MARGIN_PT;
  if (value > MAX_MARGIN_PT) return MAX_MARGIN_PT;
  return round1(value);
}

/**
 * Normalize preset — ค่าที่ไม่รู้จัก → "normal"
 */
export function normalizePreset(value: unknown): PageMarginPreset {
  if (
    value === "narrow" ||
    value === "normal" ||
    value === "wide" ||
    value === "custom"
  ) {
    return value;
  }
  return "normal";
}

// =============================================================================
// Core helper — resolvePageGeometry
// =============================================================================

/**
 * Resolve geometry ของหน้ากระดาษจาก pageSettings
 *
 * ── กฎ ────────────────────────────────────────────────────────────────────
 *   - preset = narrow/normal/wide → ใช้ค่าขอบตาม preset ทุกด้าน
 *     (ค่า top/right/bottom/left ใน descriptor ถูกเมิน — preset เป็นตัวกำหนด)
 *   - preset = custom → ใช้ค่าต่อด้าน (clamp 10–144pt)
 *   - descriptor ไม่มี pageSettings / ค่าเสีย → fallback 40pt ทุกด้าน
 *
 * @param settings - pageSettings จาก descriptor (อาจเป็น undefined/null)
 * @returns PageGeometry (พร้อมใช้ render preview)
 */
export function resolvePageGeometry(
  settings?: Partial<PageSettings> | null
): PageGeometry {
  const preset = normalizePreset(settings?.preset);

  let top: number;
  let right: number;
  let bottom: number;
  let left: number;

  if (preset === "custom") {
    top = clampMarginPt(settings?.top);
    right = clampMarginPt(settings?.right);
    bottom = clampMarginPt(settings?.bottom);
    left = clampMarginPt(settings?.left);
  } else {
    const presetMargin = PRESET_MARGIN_PT[preset];
    top = presetMargin;
    right = presetMargin;
    bottom = presetMargin;
    left = presetMargin;
  }

  const contentWidth = Math.max(
    MIN_CONTENT_SIZE_PT,
    round1(PAGE_WIDTH_PT - left - right)
  );
  const contentHeight = Math.max(
    MIN_CONTENT_SIZE_PT,
    round1(PAGE_HEIGHT_PT - top - bottom)
  );

  return {
    preset,
    marginTop: top,
    marginRight: right,
    marginBottom: bottom,
    marginLeft: left,
    contentWidth,
    contentHeight,
    pageWidth: PAGE_WIDTH_PT,
    pageHeight: PAGE_HEIGHT_PT,
  };
}

/**
 * ค่า pageSettings เริ่มต้น (preset = normal → 40pt ทุกด้าน)
 */
export function createDefaultPageSettings(): PageSettings {
  return {
    preset: "normal",
    top: PRESET_MARGIN_PT.normal,
    right: PRESET_MARGIN_PT.normal,
    bottom: PRESET_MARGIN_PT.normal,
    left: PRESET_MARGIN_PT.normal,
  };
}

// =============================================================================
// Zod schema (optional property → backward compatible)
// =============================================================================

/** ช่วงขอบกระดาษที่ยอมรับ (pt) */
export const PAGE_MARGIN_PT_RANGE = {
  min: MIN_MARGIN_PT,
  max: MAX_MARGIN_PT,
} as const;

/**
 * ขอบกระดาษแบบ custom (pt) — **lenient**
 *
 * ⚠️ ขอบเขต: ไม่ reject ค่าแปลกปลอม แต่ clamp เข้าช่วง 10..144
 *   - NaN / Infinity / null / string ที่แปลงไม่ได้ → fallback 40pt
 *   - ต่ำกว่า 10 → 10 / สูงกว่า 144 → 144
 *   → ทำให้ descriptor ที่มีค่าเสียยัง save/load ได้ โดยไม่ crash
 */
export const PageMarginPtSchema = z
  .unknown()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return clampMarginPt(toFiniteNumber(value));
  });

/**
 * แปลงค่าใด ๆ เป็น number ที่ใช้ได้
 * - number ที่ finite → คืนค่าเดิม
 * - string ที่ parse ได้ → คืนค่าที่ parse ได้
 * - อื่น ๆ (NaN / Infinity / null / object) → null (ให้ caller fallback)
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** ตรวจว่าเป็น plain object (ไม่ใช่ array / null) */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * PageSettings object schema
 *
 * ⚠️ ทุก field เป็น optional ยกเว้น preset
 *   → descriptor เก่าที่ไม่มี pageSettings ยังผ่าน validation ได้
 */
export const PageSettingsObjectSchema = z.object({
  preset: z
    .enum(["narrow", "normal", "wide", "custom"])
    .catch("normal")
    .default("normal"),
  top: PageMarginPtSchema,
  right: PageMarginPtSchema,
  bottom: PageMarginPtSchema,
  left: PageMarginPtSchema,
});

/**
 * PageSettings schema (lenient ทั้งก้อน)
 *
 * - ค่าที่ไม่ใช่ object (string / number / array / null) → undefined
 *   → fallback เป็น 40pt ทุกด้านที่ resolvePageGeometry()
 * - ไม่ throw / ไม่ crash แม้ descriptor มีค่าเสีย
 */
export const PageSettingsSchema = z.preprocess(
  (value) => (isPlainObject(value) ? value : undefined),
  PageSettingsObjectSchema.optional()
);

/** Inferred type จาก schema */
export type PageSettingsInput = z.infer<typeof PageSettingsObjectSchema>;
