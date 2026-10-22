/**
 * Page Settings — Frontend Pure Helpers
 * --------------------------------------------
 * Document Composer — UI "ตั้งค่าหน้ากระดาษ"
 *
 * ⚠️ ขอบเขตของก้อนนี้
 *   - การตั้งค่านี้มีผลกับ **ตัวอย่างเอกสาร (Preview)** เท่านั้น
 *   - ส่วน PDF จะรองรับในก้อนถัดไป
 *
 * ── หน่วยวัด ─────────────────────────────────────────────────────────────
 *   - Descriptor เก็บค่าเป็น **pt** (จุด)
 *   - UI แสดงผลเป็น **มม.** (มิลลิเมตร)
 *   - 1 inch = 72 pt = 25.4 mm
 *
 * ── ขอบเขตที่ห้ามแตะ ─────────────────────────────────────────────────────
 *   - ไม่เกี่ยวกับ Block selection / contextual insertion
 *   - ไม่เกี่ยวกับ Workspace layout
 */

// =============================================================================
// Constants — single source of truth (mirror backend page-settings.ts)
// =============================================================================

export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

export const PAGE_WIDTH_PT = 595.28;
export const PAGE_HEIGHT_PT = 841.89;

export const DEFAULT_MARGIN_PT = 40;
export const MIN_MARGIN_PT = 10;
export const MAX_MARGIN_PT = 144;
export const MIN_CONTENT_SIZE_PT = 200;

/** ค่าขอบกระดาษของแต่ละ preset (pt) */
export const PRESET_MARGIN_PT = {
  narrow: 28,
  normal: 40,
  wide: 72,
} as const;

/** label ภาษาไทยของแต่ละ preset */
export const PRESET_LABELS: Record<
  PageMarginPresetKey,
  { label: string; hint: string }
> = {
  narrow: { label: 'แคบ', hint: 'ขอบกระดาษแคบ เหมาะกับตารางที่กว้าง' },
  normal: { label: 'ปกติ', hint: 'ขอบกระดาษมาตรฐาน (ค่าเริ่มต้น)' },
  wide: { label: 'กว้าง', hint: 'ขอบกระดาษกว้าง เหมาะกับเอกสารที่มีข้อความน้อย' },
  custom: { label: 'กำหนดเอง', hint: 'กำหนดขอบกระดาษเองทีละด้าน' },
};

/** label ภาษาไทยของแต่ละด้าน */
export const MARGIN_SIDE_LABELS: Record<MarginSide, string> = {
  top: 'บน',
  right: 'ขวา',
  bottom: 'ล่าง',
  left: 'ซ้าย',
};

/** ข้อความเตือนที่ต้องแสดงใน UI เพื่อไม่ให้ผู้ใช้เข้าใจผิด */
export const PAGE_SETTINGS_DISCLAIMER =
  'การตั้งค่านี้ใช้กับตัวอย่างเอกสาร ส่วน PDF จะรองรับในก้อนถัดไป';

// =============================================================================
// Types
// =============================================================================

export type PageMarginPresetKey = 'narrow' | 'normal' | 'wide' | 'custom';
export type MarginSide = 'top' | 'right' | 'bottom' | 'left';

export interface PageSettings {
  preset: PageMarginPresetKey;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Geometry ของหน้ากระดาษ (คำนวณในฝั่ง UI — mirror backend) */
export interface PageGeometry {
  preset: PageMarginPresetKey;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  contentWidth: number;
  contentHeight: number;
  pageWidth: number;
  pageHeight: number;
}

/** ผลการตรวจสอบค่า margin ของ UI */
export interface MarginValidation {
  ok: boolean;
  /** ข้อความแสดงแบบ inline */
  message?: string;
}

// =============================================================================
// Unit conversion — pure
// =============================================================================

/** ปัดทศนิยม 1 ตำแหน่ง */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** แปลง pt → mm (1 ตำแหน่งทศนิยม) */
export function ptToMm(pt: number): number {
  if (typeof pt !== 'number' || !Number.isFinite(pt)) return 0;
  return round1((pt / PT_PER_INCH) * MM_PER_INCH);
}

/** แปลง mm → pt (1 ตำแหน่งทศนิยม) */
export function mmToPt(mm: number): number {
  if (typeof mm !== 'number' || !Number.isFinite(mm)) return DEFAULT_MARGIN_PT;
  return round1((mm / MM_PER_INCH) * PT_PER_INCH);
}

// =============================================================================
// Clamp / normalize — pure
// =============================================================================

/**
 * Clamp ค่าขอบกระดาษ (pt) ให้อยู่ในช่วง 10..144
 *
 * - NaN / ค่าที่ไม่ใช่ number → fallback (40pt)
 * - +Infinity → 144pt (max) / -Infinity → 10pt (min)
 */
export function clampMarginPt(
  value: unknown,
  fallback: number = DEFAULT_MARGIN_PT
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return clampMarginPt(fallback, DEFAULT_MARGIN_PT);
  }
  if (value === Number.POSITIVE_INFINITY) return MAX_MARGIN_PT;
  if (value === Number.NEGATIVE_INFINITY) return MIN_MARGIN_PT;
  if (value < MIN_MARGIN_PT) return MIN_MARGIN_PT;
  if (value > MAX_MARGIN_PT) return MAX_MARGIN_PT;
  return round1(value);
}

/** Normalize preset — ค่าที่ไม่รู้จัก → 'normal' */
export function normalizePreset(value: unknown): PageMarginPresetKey {
  if (
    value === 'narrow' ||
    value === 'normal' ||
    value === 'wide' ||
    value === 'custom'
  ) {
    return value;
  }
  return 'normal';
}

/** ค่าเริ่มต้นของ pageSettings */
export function createDefaultPageSettings(): PageSettings {
  return {
    preset: 'normal',
    top: PRESET_MARGIN_PT.normal,
    right: PRESET_MARGIN_PT.normal,
    bottom: PRESET_MARGIN_PT.normal,
    left: PRESET_MARGIN_PT.normal,
  };
}

// =============================================================================
// Core helper — resolvePageGeometry
// =============================================================================

/**
 * Resolve geometry ของหน้ากระดาษจาก pageSettings
 *
 * - preset = narrow/normal/wide → ใช้ค่าขอบตาม preset ทุกด้าน
 * - preset = custom → ใช้ค่าต่อด้าน (clamp 10..144)
 * - ไม่มี pageSettings / ค่าเสีย → fallback 40pt ทุกด้าน
 */
export function resolvePageGeometry(
  settings?: Partial<PageSettings> | null
): PageGeometry {
  const preset = normalizePreset(settings?.preset);

  let top: number;
  let right: number;
  let bottom: number;
  let left: number;

  if (preset === 'custom') {
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

// =============================================================================
// UI helpers — preset / custom / reset
// =============================================================================

/**
 * ค่าขอบกระดาษของ preset (ทุกด้านเท่ากัน)
 */
export function presetMarginsPt(preset: PageMarginPresetKey): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const value = PRESET_MARGIN_PT[preset === 'custom' ? 'normal' : preset];
  return { top: value, right: value, bottom: value, left: value };
}

/**
 * สร้าง pageSettings จาก preset (เลือกใหม่ → reset ค่าต่อด้านตาม preset)
 */
export function applyPreset(
  preset: PageMarginPresetKey,
  current?: Partial<PageSettings> | null
): PageSettings {
  const normalized = normalizePreset(preset);
  if (normalized !== 'custom') {
    return { preset: normalized, ...presetMarginsPt(normalized) };
  }
  // custom → เริ่มจากค่าเดิม (ถ้ามี) หรือค่าเริ่มต้น
  const base = current ?? createDefaultPageSettings();
  return {
    preset: 'custom',
    top: clampMarginPt(base.top),
    right: clampMarginPt(base.right),
    bottom: clampMarginPt(base.bottom),
    left: clampMarginPt(base.left),
  };
}

/**
 * รีเซ็ต pageSettings กลับค่าเริ่มต้น (normal → 40pt ทุกด้าน)
 */
export function resetPageSettings(): PageSettings {
  return createDefaultPageSettings();
}

/**
 * ตรวจสอบค่า margin ที่ผู้ใช้กรอก (จากช่อง input)
 *
 * - ว่าง → ข้อความ "กรุณากรอกค่า"
 * - NaN / Infinity → "กรุณากรอกเป็นตัวเลขที่ถูกต้อง"
 * - ติดลบ → "ขอบกระดาษต้องไม่ติดลบ"
 * - นอกช่วง 10..144pt → "ต้องอยู่ระหว่าง ... มม."
 */
export function validateMarginInput(raw: string | number): MarginValidation {
  const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();

  if (text.length === 0) {
    return { ok: false, message: 'กรุณากรอกค่า' };
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, message: 'กรุณากรอกเป็นตัวเลขที่ถูกต้อง' };
  }
  if (value < 0) {
    return { ok: false, message: 'ขอบกระดาษต้องไม่ติดลบ' };
  }

  const pt = mmToPt(value);
  if (pt < MIN_MARGIN_PT || pt > MAX_MARGIN_PT) {
    const minMm = ptToMm(MIN_MARGIN_PT);
    const maxMm = ptToMm(MAX_MARGIN_PT);
    return {
      ok: false,
      message: `ต้องอยู่ระหว่าง ${minMm} – ${maxMm} มม.`,
    };
  }

  return { ok: true };
}

/**
 * แปลงค่าจากช่อง input (mm) → ค่า pt สำหรับเก็บใน descriptor
 * - ค่าเสีย → fallback 40pt (ไม่ throw)
 */
export function marginInputToPt(raw: string | number): number {
  const validation = validateMarginInput(raw);
  if (!validation.ok) return DEFAULT_MARGIN_PT;
  const value = Number(typeof raw === 'number' ? raw : String(raw).trim());
  return clampMarginPt(mmToPt(value));
}

/**
 * แปลงค่าจาก descriptor (pt) → ค่าที่แสดงในช่อง input (mm)
 */
export function marginPtToInput(pt: number): string {
  const clamped = clampMarginPt(pt);
  return String(ptToMm(clamped));
}
