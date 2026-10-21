'use client';

/**
 * Workspace Layout — pure helpers สำหรับ Document Composer
 * -----------------------------------------------------------------
 * ก้อนที่ 2: Responsive Composer Workspace Layout
 *
 * หลักการ:
 *   1. **Single source of truth** — ตัวเลข min/max/default ทั้งหมดอยู่ที่ไฟล์นี้
 *      ห้ามกระจายไปหลาย Component
 *   2. **Pure functions** — ไม่มี side effect → เขียน test ได้โดยไม่ต้อง render React
 *   3. **Layout state แยกจาก DocumentDescriptor เด็ดขัด**
 *      → ไม่มี descriptor / token / ข้อมูลผู้สมัครอยู่ในไฟล์นี้
 *   4. **localStorage = UI preference เท่านั้น**
 *      → เก็บแค่ค่า layout (sidebarCollapsed / splitRatio)
 *
 * ⚠️ ระยะขอบภายในกระดาษ A4 / page margin / block spacing
 *    **ไม่อยู่ในขอบเขตของไฟล์นี้** (จะทำเป็นก้อน Document Page Settings แยก)
 */

// =============================================================================
// Constants — single source of truth
// =============================================================================

/** localStorage keys (namespace ชัดเจน) — เก็บเฉพาะ UI preference */
export const WORKSPACE_STORAGE_KEYS = {
  /** boolean: แถบ Actions ย่อ/ขยาย */
  sidebarCollapsed: 'composer.workspace.sidebarCollapsed',
  /** number: สัดส่วนความกว้างของ Visual Composer (0..1) */
  splitRatio: 'composer.workspace.splitRatio',
} as const;

/** ความกว้าง Actions sidebar (px) */
export const SIDEBAR_WIDTH = {
  expanded: 240,
  collapsed: 56,
} as const;

/** ความกว้างต่ำสุดของ Visual Composer และ Live Preview (px) */
export const MIN_PANEL_WIDTH = 420;

/** ความกว้างของ Divider (px) — ใช้หักออกจากพื้นที่คำนวณสัดส่วน */
export const DIVIDER_WIDTH = 8;

/** สัดส่วนเริ่มต้นของ Visual Composer (0..1) */
export const DEFAULT_SPLIT_RATIO = 0.5;

/** ขอบเขตสัดส่วนแบบ ratio (ใช้เมื่อหน้าต่างเล็กเกินจะรักษา min width ได้) */
export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;

/** ขนาดที่เลื่อนได้ต่อการกดปุ่มลูกศร (ratio) */
export const KEYBOARD_RESIZE_STEP = 0.02;

/** Breakpoint ของ workspace (px) */
export const WORKSPACE_BREAKPOINTS = {
  /** ต่ำกว่านี้ = โหมดแท็บ (mobile) */
  laptop: 1024,
  /** ตั้งแต่นี้ = desktop เต็มรูปแบบ */
  desktop: 1280,
} as const;

/** ค่าเริ่มต้นของ layout ทั้งชุด */
export const DEFAULT_WORKSPACE_LAYOUT = {
  splitRatio: DEFAULT_SPLIT_RATIO,
  sidebarCollapsed: false,
} as const;

/** คีย์ที่ใช้เลื่อนขนาดด้วยคีย์บอร์ด */
export type ResizeKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

// =============================================================================
// Types
// =============================================================================

/** โหมด layout ตามความกว้างหน้าต่าง */
export type WorkspaceLayoutMode = 'mobile' | 'laptop' | 'desktop';

/** แท็บที่แสดงบนหน้าจอแคบ */
export type WorkspaceTab = 'composer' | 'preview';

/** ช่วงสัดส่วนที่ใช้ได้จริง (หลังคำนึงถึง min panel width) */
export interface SplitBounds {
  min: number;
  max: number;
}

// =============================================================================
// Responsive mode
// =============================================================================

/**
 * เลือกโหมด layout จากความกว้างหน้าต่าง
 *
 * - `mobile`  (< 1024px) → โหมดแท็บ [แก้ไขเอกสาร] [ดูตัวอย่าง]
 * - `laptop`  (1024–1279px) → 3 คอลัมน์, Actions ย่อได้, ลาก Divider ได้
 * - `desktop` (>= 1280px) → 3 คอลัมน์เต็มรูปแบบ
 *
 * เหตุผลที่ใช้ 1024px: Layout เดิมของหน้านี้ใช้ Tailwind `lg:` (1024px)
 * เป็นจุดเปลี่ยนจาก 1 คอลัมน์เป็น 3 คอลัมน์ → ใช้ boundary เดิมเพื่อไม่ให้
 * ผู้ใช้ที่คุ้นกับ layout เดิมรู้สึกว่า "หน้าจอเล็กลง"
 */
export function resolveWorkspaceLayoutMode(width: number): WorkspaceLayoutMode {
  if (!Number.isFinite(width) || width <= 0) return 'desktop';
  if (width < WORKSPACE_BREAKPOINTS.laptop) return 'mobile';
  if (width < WORKSPACE_BREAKPOINTS.desktop) return 'laptop';
  return 'desktop';
}

// =============================================================================
// Split ratio — clamp / bounds
// =============================================================================

/**
 * ช่วงสัดส่วนที่ใช้ได้จริงเมื่อพิจารณาความกว้างจริงของพื้นที่ทำงาน
 *
 * - ถ้าพื้นที่กว้างพอ (>= 2 × MIN_PANEL_WIDTH) → บังคับให้ทั้งสองฝั่ง
 *   ไม่เล็กกว่า MIN_PANEL_WIDTH
 * - ถ้าเล็กกว่านั้น → ยึด ratio bounds (0.25–0.75) แทน เพื่อไม่ให้ panel หายไป
 */
export function resolveSplitBounds(containerWidth: number): SplitBounds {
  const fallback: SplitBounds = { min: MIN_SPLIT_RATIO, max: MAX_SPLIT_RATIO };
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return fallback;

  const fit = MIN_PANEL_WIDTH / containerWidth;
  if (fit > MAX_SPLIT_RATIO) return fallback; // พื้นที่แคบเกินกว่าจะรักษา min width ได้

  const min = Math.max(MIN_SPLIT_RATIO, fit);
  const max = Math.min(MAX_SPLIT_RATIO, 1 - fit);
  if (min > max) return fallback;
  return { min, max };
}

/**
 * Clamp สัดส่วนให้อยู่ในช่วงที่ใช้ได้
 *
 * @param ratio ค่าที่ต้องการ
 * @param containerWidth ความกว้างจริงของพื้นที่ทำงาน (px) — ถ้าไม่รู้จะใช้ ratio bounds
 */
export function clampSplitRatio(ratio: number, containerWidth = 0): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  const { min, max } = resolveSplitBounds(containerWidth);
  if (ratio < min) return min;
  if (ratio > max) return max;
  return ratio;
}

/** ค่าเริ่มต้น (ใช้ตอน reset) */
export function defaultSplitRatio(): number {
  return DEFAULT_SPLIT_RATIO;
}

/** ค่า layout ทั้งชุดหลัง reset */
export function resetWorkspaceLayout(): {
  splitRatio: number;
  sidebarCollapsed: boolean;
} {
  return {
    splitRatio: DEFAULT_WORKSPACE_LAYOUT.splitRatio,
    sidebarCollapsed: DEFAULT_WORKSPACE_LAYOUT.sidebarCollapsed,
  };
}

// =============================================================================
// Pointer / keyboard resize
// =============================================================================

/**
 * คำนวณสัดส่วนจากตำแหน่ง pointer (px ของ client) เทียบกับพื้นที่ทำงาน
 */
export function splitRatioFromClientX(
  clientX: number,
  rect: { left: number; width: number }
): number {
  if (!rect || rect.width <= 0) return DEFAULT_SPLIT_RATIO;
  const raw = (clientX - rect.left) / rect.width;
  if (!Number.isFinite(raw)) return DEFAULT_SPLIT_RATIO;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * ปรับสัดส่วนด้วยคีย์บอร์ด
 *
 * - ArrowLeft  → ลด (Visual Composer แคบลง)
 * - ArrowRight → เพิ่ม (Visual Composer กว้างขึ้น)
 * - Home       → ไปค่าต่ำสุด
 * - End        → ไปค่าสูงสุด
 *
 * ผลลัพธ์ถูก clamp เสมอ → ไม่มีทางลาก/กดจนเกินขอบเขต
 */
export function resizeRatioByKey(
  currentRatio: number,
  key: ResizeKey,
  options: { containerWidth?: number; step?: number } = {}
): number {
  const { containerWidth = 0, step = KEYBOARD_RESIZE_STEP } = options;
  const { min, max } = resolveSplitBounds(containerWidth);
  const base = Number.isFinite(currentRatio) ? currentRatio : DEFAULT_SPLIT_RATIO;

  let next: number;
  switch (key) {
    case 'ArrowLeft':
      next = base - step;
      break;
    case 'ArrowRight':
      next = base + step;
      break;
    case 'Home':
      next = min;
      break;
    case 'End':
      next = max;
      break;
    default:
      next = base;
  }
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

// =============================================================================
// Safe localStorage
// =============================================================================

/** subset ของ Storage ที่ต้องใช้ (ทำให้ test ได้โดยไม่ต้องมี DOM) */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * อ่านค่าจาก storage อย่างปลอดภัย
 * - ไม่พังเมื่อ localStorage ไม่มี (SSR) หรือโยน error (privacy mode)
 */
export function readWorkspacePreference(
  key: string,
  storage?: StorageLike | null
): string | null {
  try {
    const target =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return null;
    return target.getItem(key);
  } catch {
    return null;
  }
}

/**
 * เขียนค่าลง storage อย่างปลอดภัย (ไม่ throw)
 */
export function writeWorkspacePreference(
  key: string,
  value: string,
  storage?: StorageLike | null
): boolean {
  try {
    const target =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse ค่า splitRatio ที่อ่านมาจาก storage
 * - malformed / NaN / นอกช่วง → fallback เป็นค่าเริ่มต้น
 */
export function parseStoredSplitRatio(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_SPLIT_RATIO;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return DEFAULT_SPLIT_RATIO;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_SPLIT_RATIO;
  if (parsed < MIN_SPLIT_RATIO) return MIN_SPLIT_RATIO;
  if (parsed > MAX_SPLIT_RATIO) return MAX_SPLIT_RATIO;
  return parsed;
}

/**
 * Parse ค่า sidebarCollapsed ที่อ่านมาจาก storage
 * - '1' | 'true' → true, '0' | 'false' → false, อื่นๆ → false (default)
 */
export function parseStoredSidebarCollapsed(
  raw: string | null | undefined
): boolean {
  if (raw == null) return false;
  const value = String(raw).trim().toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return false;
}

/** แปลง boolean → ค่าที่เก็บลง storage */
export function serializeSidebarCollapsed(collapsed: boolean): string {
  return collapsed ? '1' : '0';
}

/** แปลง ratio → ค่าที่เก็บลง storage */
export function serializeSplitRatio(ratio: number): string {
  return String(ratio);
}

// =============================================================================
// UI state (tab) — ต้องไม่ล้าง state ของงานจริง
// =============================================================================

export interface WorkspaceUiState {
  /** แท็บที่ active (ใช้เฉพาะโหมด mobile) */
  activeTab: WorkspaceTab;
  /** block ที่ผู้ใช้เลือกอยู่ (ต้องคงอยู่เมื่อสลับแท็บ) */
  selectedBlockId: string | null;
}

export type WorkspaceUiAction = { type: 'setTab'; tab: WorkspaceTab };

/**
 * Reducer ของ UI state ฝั่ง workspace
 *
 * ⚠️ เปลี่ยนแท็บห้ามล้าง `selectedBlockId` (ห้ามทำให้ selection หาย)
 * ⚠️ ห้ามแตะ descriptor / data source / preview result ที่นี่
 */
export function workspaceUiReducer(
  state: WorkspaceUiState,
  action: WorkspaceUiAction
): WorkspaceUiState {
  switch (action.type) {
    case 'setTab':
      if (action.tab === state.activeTab) return state;
      // เปลี่ยนเฉพาะแท็บ — ทุกอย่างอื่นคงเดิม
      return { ...state, activeTab: action.tab };
    default:
      return state;
  }
}

// =============================================================================
// Preview trigger — สลับแท็บต้องไม่ทำให้เกิด Preview request ใหม่
// =============================================================================

export interface PreviewTriggerInput {
  /** descriptor ปัจจุบัน (ใช้เปรียบเทียบเนื้อหา) */
  descriptor: unknown;
  /** JSON ของ descriptor ปัจจุบัน */
  descriptorText?: string;
  /** ข้อความ JSON ถูกต้องไหม */
  isTextValid: boolean;
  /** แหล่งข้อมูลของ preview (sample / real) */
  dataSource: unknown;
}

/**
 * คำนวณ "ลายเซ็น" ของสิ่งที่ควร trigger preview ใหม่
 *
 * สลับแท็บ (layout) **ไม่** เปลี่ยนลายเซ็นนี้ → ไม่เกิด Preview request ซ้ำ
 * เพราะเหตุผลของ layout เพียงอย่างเดียว
 */
export function previewTriggerSignature(input: PreviewTriggerInput): string {
  const descriptorPart =
    typeof input.descriptorText === 'string'
      ? input.descriptorText
      : safeStringify(input.descriptor);
  const dataSourcePart = safeStringify(input.dataSource);
  return `${input.isTextValid ? '1' : '0'}|${descriptorPart}|${dataSourcePart}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// =============================================================================
// Actions wiring (fullscreen preview callback)
// =============================================================================

export interface WorkspaceActionHandlers {
  onGenerate: () => void;
  onLoad: () => void;
  onSave: () => void;
  /** เปิด Fullscreen Preview — callback เดิมจาก ComposerClient */
  onFullscreenPreview: () => void;
}

/**
 * สร้างชุด handler ของ workspace
 *
 * ⚠️ คืน **callback เดิม** ทุกตัว (ไม่ wrap / ไม่เปลี่ยนพฤติกรรม)
 * → ทดสอบได้ว่า "Fullscreen Preview ยังเรียก callback เดิม"
 */
export function buildWorkspaceActions(
  handlers: WorkspaceActionHandlers
): WorkspaceActionHandlers {
  return {
    onGenerate: handlers.onGenerate,
    onLoad: handlers.onLoad,
    onSave: handlers.onSave,
    onFullscreenPreview: handlers.onFullscreenPreview,
  };
}
