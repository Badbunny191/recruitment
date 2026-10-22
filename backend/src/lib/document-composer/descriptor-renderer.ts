/**
 * Document Composer V1 — Descriptor → PDF Render Plan
 *
 * Pure translation layer:
 *   ApplicationContext + DocumentDescriptor → RenderPlan → PDF bytes
 *
 * จุดสำคัญ:
 *   - ไม่แก้ไฟล์ renderer เดิม (pdf-renderer.service.ts)
 *   - คืน plan เป็น array ของ "render command" ที่ ordered ตามลำดับ
 *   - executePlan() เป็น adapter ที่เรียกใช้ sub-renderer ของ document-composer
 *     (ไม่ mutate state ของ renderer เดิม)
 *
 * ทำไมต้องแยก "plan" ออกจาก "render":
 *   - testable: ตรวจ plan ได้โดยไม่ต้องสร้าง PDF จริง
 *   - debuggable: เห็นลำดับ block ที่จะ render ทั้งหมดก่อนยิง PDF
 *
 * ── Requirement I.6: Preview HTML และ PDF ใช้ token resolver และ field
 *    capability เดียวกัน — ห้ามสร้าง token resolver ซ้ำ
 *    → PDF renderer ใช้ resolveDocumentTokens / applyDocumentTokensWithFields
 *      เดียวกับ preview-renderer.ts
 */

import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib";
import type {
  ApplicationContext,
  FieldData,
} from "../pdf-types";
import {
  resolveDocumentTokens,
  applyDocumentTokensWithFields,
  resolveFieldValue,
  type DocumentToken,
  type TokenValue,
  DOCUMENT_TOKEN_LABELS,
} from "./document-tokens";
import { getObjectDisplayLabel } from "./field-capabilities";
import {
  resolvePageGeometry,
  type PageGeometry,
} from "./page-settings";
import {
  SYSTEM_DATA_LABELS,
  NO_LOGO_TEXT,
  DEFAULT_SIGNATURE_LINE_LABEL,
  DEFAULT_SIGNATURE_ROLE_LABEL,
  DEFAULT_SIGNATURE_DATE_LABEL,
  DEFAULT_SIGNATURE_LINE_STYLE,
  DEFAULT_SHOW_NAME,
  DEFAULT_SHOW_PARENTHESES,
  DEFAULT_SHOW_DATE,
  DEFAULT_SHOW_TIME,
  DEFAULT_DATE_FORMAT,
} from "./types";
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
  SignatureBlock,
  SystemDataBlock,
  SystemDataKey,
  DateFormat,
  Size,
  Align,
} from "./types";

// =============================================================================
// Render Plan Types
// =============================================================================

/**
 * RenderPlan = ordered list ของ render command
 *
 * type discriminator: "heading" | "field" | "table" | "logo" | "signature"
 *   | "systemData" | "padding"
 *
 * padding = spacing ระหว่าง block (จาก marginTop/marginBottom)
 */
export type RenderCommand =
  | PaddingCommand
  | HeadingRenderCommand
  | FieldRenderCommand
  | TableRenderCommand
  | LogoRenderCommand
  | SignatureRenderCommand
  | SystemDataRenderCommand
  | PageBreakRenderCommand;

/**
 * Page Break Render Command — สั่งขึ้นหน้าใหม่ทันที
 *
 * ⚠️ ไม่มี height / offset / any sizing field โดยเด็ดขาด
 *   เพื่อกันไม่ให้มีการ "เดา" จุดแบ่งหน้าจากการคำนวณความสูง
 *   executor จะเรียก `addNewPage(state)` เสมอเมื่อเจอ command นี้
 */
export interface PageBreakRenderCommand {
  type: "pageBreak";
  blockId: string;
}

export interface PaddingCommand {
  type: "padding";
  /** vertical space (pt) */
  amount: number;
  /** which margin produced this padding (for debugging) */
  from: "marginTop" | "marginBottom" | "postBlock";
}

export interface HeadingRenderCommand {
  type: "heading";
  blockId: string;
  /** text after system tokens resolved (still has {FIELD:<id>} resolved too) */
  text: string;
  size: Size;
  bold: boolean;
  italic: boolean;
  align: Align;
  fontSize: number;
  margins: { top: number; bottom: number };
}

export interface FieldRenderCommand {
  type: "field";
  blockId: string;
  field: FieldData;
  overrideLabel?: string;
  showLabel: boolean;
  showRequired: boolean;
  valueStyle: Size;
  layout: "stacked" | "inline";
  align: Align;
  margins: { top: number; bottom: number };
}

export interface TableRenderCommand {
  type: "table";
  blockId: string;
  field: FieldData;
  showLabel: boolean;
  label?: string;
  emptyText: string;
  align: Align;
  margins: { top: number; bottom: number };
}

export interface LogoRenderCommand {
  type: "logo";
  blockId: string;
  source: LogoBlock["source"];
  width?: number;
  height?: number;
  alt?: string;
  align: Align;
  margins: { top: number; bottom: number };
}

/**
 * Signature Render Command — Document Block ที่ใช้ข้อมูลจาก Application
 *
 * ค่าต่างๆ (name / date / time) resolve จาก ApplicationContext ตอน
 * buildRenderPlan() — command เก็บเฉพาะ static config (lineLabel/lineStyle
 * /dateLabel/roleLabel/align/nameFieldId/dateSource/showName/showDate
 * /showTime/showParentheses) + resolved values เพื่อให้ executor render ได้
 * ตรง pattern เดียวกับ heading/logo (ไม่ต้อง query context ซ้ำ)
 */
export interface SignatureRenderCommand {
  type: "signature";
  blockId: string;
  roleLabel: string;
  lineLabel: string;
  lineStyle: string;
  dateLabel: string;
  align: Align;
  /** resolved signer name (หรือ fallback placeholder) */
  signerName: string;
  /** true เมื่อ signerName เป็น placeholder (ไม่มีข้อมูลจริง) */
  hasRealName: boolean;
  /** show parentheses around signer name */
  showParentheses: boolean;
  /** resolved Thai date string (หรือ fallback "______________") */
  dateText: string;
  /** resolved HH:mm (หรือ fallback "______________") */
  timeText: string;
  /** true เมื่อใช้ fallback — ใช้กำหนด font color ให้จางลง */
  isFallback: boolean;
  /** visibility toggles */
  showName: boolean;
  showDate: boolean;
  showTime: boolean;
  margins: { top: number; bottom: number };
}

/**
 * System Data Render Command — ระบบข้อมูล 1 รายการ
 *
 * ใช้ system token เดียวกับ preview-renderer (Requirement I.6)
 * → ไม่มี token resolver ซ้ำ — value ถูก resolve ที่ buildRenderPlan แล้ว
 */
export interface SystemDataRenderCommand {
  type: "systemData";
  blockId: string;
  key: SystemDataKey;
  label: string;
  /** "stacked" → label on top / value below (Requirement B) */
  /** "inline"  → label และ value บรรทัดเดียวกัน */
  layout: "stacked" | "inline";
  showLabel: boolean;
  labelStyle: Size;
  valueStyle: Size;
  /** resolved token text (อาจเป็น placeholder เช่น "{APPLICATION_NO}") */
  valueText: string;
  /** true เมื่อไม่มีข้อมูลจริง — ใช้กำหนด font color ให้จางลง */
  isEmpty: boolean;
  /** output font size (pt) */
  labelFontSize: number;
  valueFontSize: number;
  align: Align;
  margins: { top: number; bottom: number };
}

export interface RenderPlan {
  commands: RenderCommand[];
  /**
   * Page geometry ที่ resolve จาก descriptor.pageSettings
   *
   * - descriptor เก่าที่ไม่มี pageSettings → normal (40pt ทุกด้าน)
   * - ใช้เป็น single source of truth ของ PDF layout
   *   (Preview ใช้ resolvePageGeometry() ชุดเดียวกัน)
   */
  page?: PageGeometry;
  meta: {
    blockCount: number;
    fieldRefCount: number;
    missingFieldIds: string[];
  };
}

// =============================================================================
// Constants (mirror pdf-renderer.service.ts เพื่อ visual consistency)
// =============================================================================

/**
 * ความสูงที่กันไว้สำหรับ header ของเอกสาร (pt)
 *
 * ปรับลดเป็น 0 pt เพื่อให้ระยะขอบบน (marginTop) จาก Page Settings เป็น source of truth
 * ของระยะห่างจากขอบบนหน้ากระดาษอย่างแท้จริง ไม่เกิดพื้นที่ว่างซ้ำซ้อนใน Header Area
 */
const HEADER_RESERVE = 0;

/** ความสูงที่กันไว้สำหรับ footer (pt) */
const FOOTER_RESERVE = 60;

/**
 * ความสูงขั้นต่ำของ content area (pt)
 * ป้องกัน content box ติดลบเมื่อ margin สูงมาก → pagination ไม่ infinite
 */
const MIN_CONTENT_HEIGHT = 120;

/** ระยะเว้นระหว่าง block (pt) */
const POST_BLOCK_SPACING = 4;

/** อัตราส่วนความสูงบรรทัด */
const LINE_HEIGHT = 1.4;

/** อัตราส่วนความสูงบรรทัดสำหรับ Field Block (กระชับแน่นขึ้น 20-25%) */
const FIELD_LINE_HEIGHT = 1.25;

/** อัตราส่วนความสูงบรรทัดสำหรับ Signature Block (กระชับขึ้น) */
const SIGNATURE_LINE_HEIGHT = 1.3;

/**
 * Page Box — กรอบพื้นที่เนื้อหาที่คำนวณจาก PageGeometry
 *
 * ทุกจุดใน renderer ที่เคยใช้ค่าคงที่ MARGIN / CONTENT_WIDTH /
 * CONTENT_TOP / CONTENT_BOTTOM ต้องเปลี่ยนมาใช้ box นี้แทน
 */
export interface PageBox {
  /** ความกว้างหน้ากระดาษ (pt) */
  pageWidth: number;
  /** ความสูงหน้ากระดาษ (pt) */
  pageHeight: number;
  /** ขอบบน (pt) */
  marginTop: number;
  /** ขอบขวา (pt) */
  marginRight: number;
  /** ขอบล่าง (pt) */
  marginBottom: number;
  /** ขอบซ้าย (pt) */
  marginLeft: number;
  /** ขอบซ้ายของ content box (pt) */
  contentLeft: number;
  /** ขอบขวาของ content box (pt) */
  contentRight: number;
  /** พิกัด y สูงสุดของ content box (pt) — เส้นบน */
  contentTop: number;
  /** พิกัด y ต่ำสุดของ content box (pt) — เส้นล่าง */
  contentBottom: number;
  /** ความกว้างพื้นที่เนื้อหา (pt) */
  contentWidth: number;
  /** ความสูงพื้นที่เนื้อหา (pt) */
  contentHeight: number;
}

/**
 * คำนวณ PageBox จาก PageGeometry
 *
 * ── กฎ ────────────────────────────────────────────────────────────────────
 *   - contentTop    = pageHeight - marginTop - HEADER_RESERVE
 *   - contentBottom = marginBottom + FOOTER_RESERVE
 *   - contentLeft   = marginLeft
 *   - contentRight  = pageWidth - marginRight
 *   - contentWidth  = min(geometry.contentWidth, contentRight - contentLeft)
 *   - ป้องกัน content box ติดลบ: ถ้า contentBottom >= contentTop
 *     → บีบ contentBottom ลงให้เหลือพื้นที่อย่างน้อย MIN_CONTENT_HEIGHT
 */
export function buildPageBox(geometry: PageGeometry): PageBox {
  const pageWidth = geometry.pageWidth;
  const pageHeight = geometry.pageHeight;

  const contentLeft = geometry.marginLeft;
  const contentRight = pageWidth - geometry.marginRight;

  let contentTop = pageHeight - geometry.marginTop - HEADER_RESERVE;
  let contentBottom = geometry.marginBottom + FOOTER_RESERVE;

  // ── ป้องกัน content box ติดลบ / เล็กเกินจนพิมพ์ไม่ได้ ──────────────
  if (!Number.isFinite(contentTop)) contentTop = pageHeight;
  if (!Number.isFinite(contentBottom)) contentBottom = 0;

  if (contentBottom > contentTop - MIN_CONTENT_HEIGHT) {
    contentBottom = contentTop - MIN_CONTENT_HEIGHT;
  }
  if (contentBottom < 0) contentBottom = 0;

  const availableWidth = Math.max(0, contentRight - contentLeft);
  const contentWidth = Math.min(geometry.contentWidth, availableWidth);

  return {
    pageWidth,
    pageHeight,
    marginTop: geometry.marginTop,
    marginRight: geometry.marginRight,
    marginBottom: geometry.marginBottom,
    marginLeft: geometry.marginLeft,
    contentLeft,
    contentRight,
    contentTop,
    contentBottom,
    contentWidth,
    contentHeight: Math.max(0, contentTop - contentBottom),
  };
}

const FONT_SIZE_LARGE = 16;
const FONT_SIZE_MEDIUM = 13;
const FONT_SIZE_SMALL = 11;
const FONT_SIZE_LABEL = 11;
const FONT_SIZE_BODY = 12;
const FONT_SIZE_TABLE_HEADER = 11;
const FONT_SIZE_TABLE_CELL = 11;

const TABLE_ROW_PADDING_X = 6; // horizontal padding inside cell
const TABLE_ROW_PADDING_Y = 4; // vertical padding inside row
const TABLE_BORDER = 0.5;
const TABLE_HEADER_BG_THRESHOLD = 0.92;

const SIZE_TO_FONT_SIZE: Record<Size, number> = {
  large: FONT_SIZE_LARGE,
  medium: FONT_SIZE_MEDIUM,
  small: FONT_SIZE_SMALL,
};

const COLOR_PRIMARY = rgb(0.05, 0.27, 0.51);
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.4, 0.4, 0.4);
const COLOR_LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const COLOR_PLACEHOLDER = rgb(0.6, 0.64, 0.7); // soft slate-grey for empty data
const COLOR_HEADER_BG = rgb(TABLE_HEADER_BG_THRESHOLD, TABLE_HEADER_BG_THRESHOLD, TABLE_HEADER_BG_THRESHOLD);

// Signature block defaults
// Visibility toggles — mirror preview-renderer.ts
// - showName: true   (default: เปิด)
// - showDate: true   (default: เปิด)
// - showTime: false  (default: ปิด — เอกสารราชการส่วนใหญ่ไม่แสดงเวลา)
const DEFAULT_SHOW_TIME_INNER = DEFAULT_SHOW_TIME;
const FONT_SIZE_SIGNATURE_LABEL = 12;
const FONT_SIZE_SIGNATURE_NAME = 12;
const FONT_SIZE_SIGNATURE_META = 12;
const SIGNATURE_LINE_MIN_WIDTH = 200; // pt

// =============================================================================
// Plan Builder
// =============================================================================

/**
 * Main entry: build RenderPlan from descriptor + context
 *
 * Pure function — ไม่มี side effects
 */
export function buildRenderPlan(
  descriptor: DocumentDescriptor,
  ctx: ApplicationContext
): RenderPlan {
  const commands: RenderCommand[] = [];
  const missingFieldIds: string[] = [];
  let fieldRefCount = 0;

  // Field lookup index (field_master.id = FieldData.fieldId)
  const fieldIndex = new Map<string, FieldData>();
  for (const f of ctx.fields) {
    fieldIndex.set(f.fieldId, f);
  }

  // [Requirement I.6] คำนวณ token ครั้งเดียวต่อ render ผ่าน shared resolver
  const tokens = resolveDocumentTokens(ctx);

  // ── Page geometry (ขอบกระดาษ) ────────────────────────────────────────
  // descriptor เก่าที่ไม่มี pageSettings → resolvePageGeometry(undefined)
  // → fallback normal (40pt ทุกด้าน) = ผลเดิมของ renderer
  const page = resolvePageGeometry(descriptor.pageSettings);

  for (const block of descriptor.blocks) {
    // ── Page Break: ขึ้นหน้าใหม่ทันที ไม่คำนวณความสูง ──────────────────
    // ข้าม padding ของ block นี้ (margin มีผลกับหน้าใหม่อยู่แล้ว)
    if (block.type === "pageBreak") {
      commands.push({ type: "pageBreak", blockId: block.id });
      continue;
    }

    if (block.marginTop && block.marginTop > 0) {
      commands.push({
        type: "padding",
        amount: block.marginTop,
        from: "marginTop",
      });
    }

    const command = buildBlockCommand(
      block,
      fieldIndex,
      missingFieldIds,
      ctx,
      tokens
    );
    if (command) {
      commands.push(command);
      if (command.type === "field" || command.type === "table") {
        fieldRefCount += 1;
      }
    } else if (block.type === "heading") {
      // heading ที่ resolve ได้แต่ text ว่าง → ไม่ push block ใด ๆ
      // (ป้องกัน PDF generation ล้ม — Requirement K.6)
    }

    if (block.marginBottom && block.marginBottom > 0) {
      commands.push({
        type: "padding",
        amount: block.marginBottom,
        from: "marginBottom",
      });
    }
  }

  return {
    commands,
    page,
    meta: {
      blockCount: descriptor.blocks.length,
      fieldRefCount,
      missingFieldIds: Array.from(new Set(missingFieldIds)),
    },
  };
}

// =============================================================================
// Block → Command mappers
// =============================================================================

function buildBlockCommand(
  block: DocumentBlock,
  fieldIndex: Map<string, FieldData>,
  missingFieldIds: string[],
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>
): RenderCommand | null {
  const margins = {
    top: block.marginTop ?? 0,
    bottom: block.marginBottom ?? 0,
  };
  const align = (block.align ?? "left") as Align;

  switch (block.type) {
    case "heading":
      return buildHeadingCommand(block, ctx, tokens, align, margins);

    case "systemData":
      return buildSystemDataCommand(block, tokens, align, margins);

    case "field": {
      const field = fieldIndex.get(block.fieldId);
      if (!field) {
        missingFieldIds.push(block.fieldId);
        return null;
      }
      return buildFieldCommand(block, field, align, margins);
    }

    case "table": {
      const field = fieldIndex.get(block.fieldId);
      if (!field) {
        missingFieldIds.push(block.fieldId);
        return null;
      }
      return buildTableCommand(block, field, align, margins);
    }

    case "logo":
      return buildLogoCommand(block, align, margins);

    case "signature":
      return buildSignatureCommand(block, ctx, tokens, align, margins);

    case "pageBreak":
      return { type: "pageBreak", blockId: block.id };
  }

  // Defensive (TypeScript exhaustive switch ผ่านแล้ว แต่กันเหนือกว่า)
  // unknown block → return null เพื่อไม่ทำให้ PDF generation ล้ม
  // (Requirement K.6 + K.10: ห้ามนำข้อมูลอื่นมาแทน / ห้าม crash)
  return null;
}

// =============================================================================
// Heading builder
// =============================================================================

function buildHeadingCommand(
  block: HeadingBlock,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>,
  align: Align,
  margins: { top: number; bottom: number }
): HeadingRenderCommand {
  // [Requirement I.6 / A] resolve ทั้ง system + field tokens ด้วย shared resolver
  const resolved = applyDocumentTokensWithFields(block.text, ctx, tokens);

  return {
    type: "heading",
    blockId: block.id,
    text: resolved.text,
    size: block.size,
    bold: block.bold ?? true,
    italic: block.italic ?? false,
    align,
    fontSize: SIZE_TO_FONT_SIZE[block.size],
    margins,
  };
}

// =============================================================================
// SystemData builder
// =============================================================================

function buildSystemDataCommand(
  block: SystemDataBlock,
  tokens: Record<DocumentToken, TokenValue>,
  align: Align,
  margins: { top: number; bottom: number }
): SystemDataRenderCommand {
  const tokenValue = tokens[block.key];
  const isEmpty = !tokenValue || tokenValue.empty;
  const rawText = isEmpty ? `{${block.key}}` : tokenValue.text;

  const valueText = applyDateFormat(rawText, block.key, block.dateFormat);
  const label = block.label ?? SYSTEM_DATA_LABELS[block.key];

  return {
    type: "systemData",
    blockId: block.id,
    key: block.key,
    label,
    layout: block.layout ?? "stacked",
    showLabel: block.showLabel ?? true,
    labelStyle: block.labelStyle ?? "small",
    valueStyle: block.valueStyle ?? "medium",
    valueText,
    isEmpty,
    labelFontSize: SIZE_TO_FONT_SIZE[block.labelStyle ?? "small"],
    valueFontSize: SIZE_TO_FONT_SIZE[block.valueStyle ?? "medium"],
    align,
    margins,
  };
}

/**
 * Apply dateFormat to a date token (text เดิมมาจาก token resolver ในรูป thai_long)
 *
 * mirror preview-renderer.ts:formatSystemDateValue
 */
function applyDateFormat(
  text: string,
  key: SystemDataKey,
  fmt?: DateFormat
): string {
  const isDateKey = key === "APPLICATION_DATE" || key === "PRINT_DATE";
  if (!isDateKey) return text;
  const f = fmt ?? DEFAULT_DATE_FORMAT;
  if (f === "thai_long") return text;
  const parsed = parseThaiLongDate(text);
  if (parsed === null) return text;
  switch (f) {
    case "thai_short":
      return `${parsed.day}/${parsed.monthIndex + 1}/${parsed.year}`;
    case "iso":
      return `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
    case "numeric":
      return `${String(parsed.day).padStart(2, "0")}-${String(parsed.monthIndex + 1).padStart(2, "0")}-${parsed.year}`;
    default:
      return text;
  }
}

/**
 * Parse "20 ตุลาคม 2569" → { day, monthIndex (0-based), year (พ.ศ.) }
 *
 * @returns null ถ้า parse ไม่ได้ — ไม่ throw, ไม่ทำ PDF ล้ม
 */
function parseThaiLongDate(
  text: string
): { day: number; monthIndex: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s+([^\d\s]+)\s+(\d{4})\s*$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const monthIndex = THAI_MONTHS.indexOf(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(day) || monthIndex < 0 || !Number.isFinite(year)) return null;
  return { day, monthIndex, year };
}

// =============================================================================
// Field builder
// =============================================================================

function buildFieldCommand(
  block: FieldBlock,
  field: FieldData,
  align: Align,
  margins: { top: number; bottom: number }
): FieldRenderCommand {
  return {
    type: "field",
    blockId: block.id,
    field,
    overrideLabel: block.label,
    showLabel: block.showLabel ?? true,
    showRequired: block.showRequired ?? true,
    valueStyle: block.valueStyle ?? "medium",
    layout: block.layout ?? "stacked",
    align,
    margins,
  };
}

// =============================================================================
// Table builder
// =============================================================================

function buildTableCommand(
  block: TableBlock,
  field: FieldData,
  align: Align,
  margins: { top: number; bottom: number }
): TableRenderCommand {
  return {
    type: "table",
    blockId: block.id,
    field,
    showLabel: block.showLabel ?? true,
    label: block.label,
    emptyText: block.emptyText ?? "(ไม่มีข้อมูล)",
    align,
    margins,
  };
}

// =============================================================================
// Logo builder
// =============================================================================

function buildLogoCommand(
  block: LogoBlock,
  align: Align,
  margins: { top: number; bottom: number }
): LogoRenderCommand {
  return {
    type: "logo",
    blockId: block.id,
    source: block.source ?? "organization",
    width: block.width,
    height: block.height,
    alt: block.alt,
    align,
    margins,
  };
}

// =============================================================================
// Signature builder — Requirement C
// =============================================================================

function buildSignatureCommand(
  block: SignatureBlock,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>,
  align: Align,
  margins: { top: number; bottom: number }
): SignatureRenderCommand {
  // ── Labels & styles (with explicit defaults from types.ts) ─────────
  const lineLabel = block.lineLabel ?? DEFAULT_SIGNATURE_LINE_LABEL;
  const roleLabel = block.roleLabel ?? DEFAULT_SIGNATURE_ROLE_LABEL;
  const lineStyle = block.lineStyle ?? DEFAULT_SIGNATURE_LINE_STYLE;
  const dateLabel = block.dateLabel ?? DEFAULT_SIGNATURE_DATE_LABEL;
  const showParentheses = block.showParentheses ?? DEFAULT_SHOW_PARENTHESES;

  // Visibility toggles (Requirement C.6/C.7/C.8)
  const showName = block.showName ?? DEFAULT_SHOW_NAME;
  const showDate = block.showDate ?? DEFAULT_SHOW_DATE;
  const showTime = block.showTime ?? DEFAULT_SHOW_TIME_INNER;

  // ── Signer name: nameFieldId → fallback application.fullname ───────
  let signerName: string;
  let hasRealName: boolean;
  if (block.nameFieldId) {
    const resolved = resolveFieldValue(block.nameFieldId, ctx);
    if (resolved === null) {
      // field ไม่อยู่ใน version นี้ → placeholder (ไม่ fallback เงียบ ๆ)
      signerName = SIGNATURE_NAME_PLACEHOLDER;
      hasRealName = false;
    } else if (resolved.empty) {
      signerName = SIGNATURE_NAME_PLACEHOLDER;
      hasRealName = false;
    } else {
      signerName = resolved.text;
      hasRealName = true;
    }
  } else {
    const fullname = (ctx.application?.fullname ?? "").trim();
    if (fullname.length > 0) {
      signerName = fullname;
      hasRealName = true;
    } else {
      signerName = SIGNATURE_NAME_PLACEHOLDER;
      hasRealName = false;
    }
  }

  // ── Date source: APPLICATION_DATE / PRINT_DATE / none ──────────────
  const submittedAt = ctx.application?.submittedAt;
  const hasSubmittedAt = typeof submittedAt === "number" && submittedAt > 0;
  const dateSource: "APPLICATION_DATE" | "PRINT_DATE" | "none" =
    block.dateSource === "none" || block.dateSource === "PRINT_DATE"
      ? block.dateSource
      : "APPLICATION_DATE"; // legacy "application" → APPLICATION_DATE

  let dateText: string;
  if (dateSource === "none") {
    dateText = "______________";
  } else if (dateSource === "PRINT_DATE") {
    const print = tokens.PRINT_DATE;
    dateText = print && !print.empty ? print.text : "______________";
  } else {
    const appDate = tokens.APPLICATION_DATE;
    if (appDate && !appDate.empty) {
      dateText = appDate.text;
    } else if (hasSubmittedAt && typeof submittedAt === "number") {
      dateText = formatThaiDate(submittedAt);
    } else {
      dateText = "______________";
    }
  }

  const timeText = hasSubmittedAt && typeof submittedAt === "number"
    ? formatThaiTime(submittedAt)
    : "______________";

  const isFallback =
    (showName && !hasRealName) ||
    (showDate && dateText === "______________") ||
    (showTime && timeText === "______________");

  return {
    type: "signature",
    blockId: block.id,
    roleLabel,
    lineLabel,
    lineStyle,
    dateLabel,
    align,
    signerName,
    hasRealName,
    showParentheses,
    dateText,
    timeText,
    isFallback,
    showName,
    showDate,
    showTime,
    margins,
  };
}

// =============================================================================
// Signature defaults (shared with preview-renderer)
// =============================================================================

/**
 * ข้อความ placeholder ของชื่อ (เมื่อไม่มีข้อมูลจริง)
 *
 * คงไว้ในรูป "(ชื่อผู้สมัคร)" เพื่อความ consistent กับ test signature-block
 * (command.signerName includes parens, renderer ไม่ต้องใส่ซ้ำ)
 */
const SIGNATURE_NAME_PLACEHOLDER = "(ชื่อผู้สมัคร)";

// =============================================================================
// Plan Executor — adapter to PDF bytes
// =============================================================================

export interface RenderedBytes {
  bytes: Uint8Array;
  pageCount: number;
  generatedAt: number;
}

/**
 * Execute RenderPlan → PDF bytes
 *
 * ไม่ mutate ไฟล์ renderer เดิมแต่อย่างใด — ใช้ sub-renderer ของ document-composer
 * ที่ reuse font-loader + logo-loader ของเดิม
 */
export async function renderPlanToPdf(
  plan: RenderPlan,
  ctx: ApplicationContext
): Promise<RenderedBytes> {
  // Lazy load assets — logo เฉพาะเมื่อ plan มี logo block
  // เพื่อลด PDF size สำหรับ table/field-only documents
  const { loadSarabunFonts } = await import("../fonts/font-loader");
  const { loadSaoLogo } = await import("../assets/logo-loader");

  const doc = await PDFDocument.create();
  const fonts = await loadSarabunFonts(doc);
  const hasLogo = plan.commands.some((c) => c.type === "logo");
  const logo: PDFImage | null = hasLogo ? await loadSaoLogo(doc) : null;

  // ── Page geometry ─────────────────────────────────────────────────────
  // plan.page มาจาก resolvePageGeometry(descriptor.pageSettings)
  // - plan ที่ไม่มี page (เช่น เรียกใช้เก่า / unit test) → fallback normal 40pt
  const geometry = plan.page ?? resolvePageGeometry(undefined);
  const box = buildPageBox(geometry);

  const state: ExecState = {
    doc,
    page: doc.addPage([box.pageWidth, box.pageHeight]),
    y: box.contentTop,
    fonts,
    logo,
    box,
  };

  const generatedAt = Math.floor(Date.now() / 1000);

  for (const cmd of plan.commands) {
    try {
      executeCommand(state, ctx, cmd);
    } catch (err) {
      // [Requirement K.6] per-block resilience: log + continue
      // ไม่ให้ 1 block error ทำเอกสารทั้งฉบับล้ม
      // eslint-disable-next-line no-console
      console.error(
        `[descriptor-renderer] block ${(cmd as { blockId?: string }).blockId ?? cmd.type} failed:`,
        err
      );
      // ปล่อยให้ render ต่อ (ไม่ throw ออก)
    }
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes,
    pageCount: doc.getPageCount(),
    generatedAt,
  };
}

// =============================================================================
// Command execution (internal)
// =============================================================================

interface ExecState {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: { regular: PDFFont; bold: PDFFont };
  logo: PDFImage | null;
  /** กรอบพื้นที่เนื้อหา (จาก resolvePageGeometry) */
  box: PageBox;
}

function executeCommand(
  state: ExecState,
  ctx: ApplicationContext,
  cmd: RenderCommand
): void {
  // ── Page Break: ขึ้นหน้าใหม่ทันที ────────────────────────────────────
  // ต้องอยู่ก่อน pagination guard + switch เพื่อไม่ให้ถูก "เดา" ตำแหน่ง
  // และไม่วาดอะไรลงหน้าที่แล้ว (ผู้ใช้สั่งตรง ๆ ด้วย block pageBreak)
  if (cmd.type === "pageBreak") {
    addNewPage(state);
    return;
  }

  // Pagination guard (mirror pdf-renderer.service.ts:ensureSpace)
  if (state.y < state.box.contentBottom) {
    addNewPage(state);
  }

  switch (cmd.type) {
    case "padding":
      state.y -= cmd.amount;
      break;
    case "heading":
      drawHeading(state, cmd);
      break;
    case "field":
      drawField(state, ctx, cmd);
      break;
    case "table":
      drawTable(state, ctx, cmd);
      break;
    case "logo":
      drawLogo(state, cmd);
      break;
    case "signature":
      drawSignature(state, cmd);
      break;
    case "systemData":
      drawSystemData(state, cmd);
      break;
    // ⚠️ ไม่มี case "pageBreak" ที่นี่โดยเจตนา
    //    → TypeScript narrow `cmd` ออกจาก union แล้วหลัง early return ข้างบน
    //      ถ้าใส่ case ซ้ำจะเป็น dead code
    //    → logic อยู่ที่ `if (cmd.type === "pageBreak") { addNewPage(state); return; }`
  }
}

/**
 * Add new page and reset cursor to top of content area.
 */
function addNewPage(state: ExecState): void {
  state.page = state.doc.addPage([state.box.pageWidth, state.box.pageHeight]);
  state.y = state.box.contentTop;
}

// =============================================================================
// Heading Renderer (Requirement A — multiline + tokens + italic)
// =============================================================================

/**
 * Draw heading — supports multiline (split by \n) + bold/italic + align
 *
 * Token resolution is performed at buildRenderPlan() time using the shared
 * resolver (applyDocumentTokensWithFields). This function draws text only.
 *
 * [Requirement K.6] ข้อความที่ resolve แล้วถูกวาดตรง ๆ ไม่มี HTML entity
 * — token resolver ส่ง plain text มาเสมอ (XSS-safe by construction).
 */
function drawHeading(state: ExecState, cmd: HeadingRenderCommand): void {
  const font = cmd.bold ? state.fonts.bold : state.fonts.regular;
  const italicFont = state.fonts.regular; // pdf-lib ไม่รองรับ oblique — ใช้ regular แต่รักษา semantic
  const drawFont = (cmd.italic ? italicFont : font);
  const box = state.box;

  // Multiline: split by \n (Requirement A.2)
  // + wrap ข้อความยาวให้อยู่ใน content box (อิง contentWidth)
  const rawLines = cmd.text.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of rawLines) {
    const wrapped = wrapText(raw, box.contentWidth, drawFont, cmd.fontSize);
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }

  const lineSpacing = cmd.fontSize * LINE_HEIGHT;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const w = drawFont.widthOfTextAtSize(line, cmd.fontSize);
    // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
    ensureLineSpace(state, lineSpacing);
    const x = alignX(box, cmd.align, w);
    state.page.drawText(line || "", {
      x,
      y: state.y - cmd.fontSize,
      font: drawFont,
      size: cmd.fontSize,
      color: COLOR_PRIMARY,
    });
    state.y -= lineSpacing;
  }

  // NOTE: ห้าม drop block ที่ resolve ได้แล้ว (Requirement K.6)
  // ถ้า text ว่าง → วาดบรรทัดเดียวกัน (อาจวาด invisible) เพื่อรักษา layout
  // (multiline จะไม่วาดเลยก็ได้ — แต่เราวาด 1 บรรทัดว่าง)
  if (lines.length === 0) {
    state.y -= lineSpacing;
  }

  state.y -= POST_BLOCK_SPACING;
}

/**
 * คำนวณ x ของข้อความตาม align ภายใน content box
 *
 * - center → กึ่งกลาง content box (ไม่ใช่กึ่งกลางหน้ากระดาษ)
 *   → เมื่อ margin ซ้าย/ขวาเท่ากัน ผลเหมือนเดิมทุกประการ
 * - right  → ขวาชิด contentRight
 * - left   → contentLeft
 */
function alignX(box: PageBox, align: Align, textWidth: number): number {
  switch (align) {
    case "center":
      return box.contentLeft + (box.contentWidth - textWidth) / 2;
    case "right":
      return box.contentRight - textWidth;
    case "left":
    default:
      return box.contentLeft;
  }
}

// =============================================================================
// SystemData Renderer (Requirement B)
// =============================================================================

/**
 * Draw system data block — label + value with stacked/inline layout
 *
 * mirror preview-renderer.ts:renderSystemDataBlock
 * - showLabel (default true)
 * - layout stacked/inline
 * - value empty → สี placeholder (ไม่ใช่ข้อมูลจริง)
 */
function drawSystemData(state: ExecState, cmd: SystemDataRenderCommand): void {
  const valueColor = cmd.isEmpty ? COLOR_PLACEHOLDER : COLOR_BLACK;
  const labelColor = COLOR_GRAY;
  const box = state.box;

  if (cmd.showLabel && cmd.layout === "inline") {
    // ── Inline Compound Layout: Label + Space + Value จัดเป็นก้อนเดียว ──
    const spaceW = state.fonts.regular.widthOfTextAtSize(" ", cmd.valueFontSize);
    const labelW = state.fonts.bold.widthOfTextAtSize(cmd.label, cmd.labelFontSize);
    const valueW = state.fonts.regular.widthOfTextAtSize(cmd.valueText, cmd.valueFontSize);
    const compoundW = labelW + spaceW + valueW;

    const startX = alignX(box, cmd.align, compoundW);
    const maxFontSize = Math.max(cmd.labelFontSize, cmd.valueFontSize);
    const lineHeight = maxFontSize * LINE_HEIGHT;
    ensureLineSpace(state, lineHeight);

    // Draw label
    state.page.drawText(cmd.label, {
      x: startX,
      y: state.y - maxFontSize,
      font: state.fonts.bold,
      size: cmd.labelFontSize,
      color: labelColor,
    });

    // Draw value
    state.page.drawText(cmd.valueText || "", {
      x: startX + labelW + spaceW,
      y: state.y - maxFontSize,
      font: state.fonts.regular,
      size: cmd.valueFontSize,
      color: valueColor,
    });

    // ลด Y เพียงครั้งเดียวสำหรับบรรทัดนี้ + post spacing
    state.y -= lineHeight;
    state.y -= POST_BLOCK_SPACING;
    return;
  }

  // Stacked layout (or showLabel = false)
  if (cmd.showLabel) {
    const labelLines = wrapText(
      cmd.label,
      box.contentWidth,
      state.fonts.bold,
      cmd.labelFontSize
    );
    for (const line of labelLines) {
      const lw = state.fonts.bold.widthOfTextAtSize(line, cmd.labelFontSize);
      ensureLineSpace(state, cmd.labelFontSize * LINE_HEIGHT);
      state.page.drawText(line, {
        x: alignX(box, cmd.align, lw),
        y: state.y - cmd.labelFontSize,
        font: state.fonts.bold,
        size: cmd.labelFontSize,
        color: labelColor,
      });
      state.y -= cmd.labelFontSize * LINE_HEIGHT;
    }
  }

  // stacked (or no label): วาด value ในบรรทัดถัดไป
  // indent 12pt เฉพาะเมื่อ align=left และ showLabel
  const valueX =
    cmd.showLabel && cmd.align === "left"
      ? box.contentLeft + 12
      : box.contentLeft;
  drawValueBlock(state, cmd, valueX, valueColor);

  state.y -= POST_BLOCK_SPACING;
}

/**
 * Helper: draw system-data value with alignment & multiline
 *
 * ข้อความยาว → wrap ให้อยู่ใน content box (อิง contentWidth)
 */
function drawValueBlock(
  state: ExecState,
  cmd: SystemDataRenderCommand,
  xHint: number,
  color: ReturnType<typeof rgb>
): void {
  const box = state.box;
  const rawLines = cmd.valueText.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of rawLines) {
    const wrapped = wrapText(
      raw,
      box.contentWidth,
      state.fonts.regular,
      cmd.valueFontSize
    );
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }

  for (const line of lines) {
    const w = state.fonts.regular.widthOfTextAtSize(line, cmd.valueFontSize);
    // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
    ensureLineSpace(state, cmd.valueFontSize * LINE_HEIGHT);
    const x =
      cmd.align === "center"
        ? alignX(box, "center", w)
        : cmd.align === "right"
          ? alignX(box, "right", w)
          : xHint;
    state.page.drawText(line || "", {
      x,
      y: state.y - cmd.valueFontSize,
      font: state.fonts.regular,
      size: cmd.valueFontSize,
      color,
    });
    state.y -= cmd.valueFontSize * LINE_HEIGHT;
  }
}

// =============================================================================
// Field Renderer (Requirement E — layout stacked/inline, showLabel/showRequired)
// =============================================================================

function drawField(
  state: ExecState,
  ctx: ApplicationContext,
  cmd: FieldRenderCommand
): void {
  const rawValue = resolveAnswerValue(cmd.field, ctx);
  const displayValue = formatAnswerValueForDisplay(rawValue);
  const label = cmd.overrideLabel ?? cmd.field.label;
  const requiredMarker =
    cmd.field.isRequired && cmd.showRequired ? " *" : "";
  const box = state.box;
  const labelText = `${label}${requiredMarker}`;
  const isEmpty = !isNonEmptyValue(rawValue);
  const valueColor = isEmpty ? COLOR_PLACEHOLDER : COLOR_BLACK;

  if (cmd.layout === "inline" && cmd.showLabel) {
    // ── Inline Compound Layout: Label + Space + Value เป็นก้อนเดียว ──
    const spaceW = state.fonts.regular.widthOfTextAtSize("  ", FONT_SIZE_BODY);
    const labelW = state.fonts.bold.widthOfTextAtSize(labelText, FONT_SIZE_LABEL);
    const rawLines = displayValue.split(/\r?\n/);
    const availableValW = box.contentWidth - labelW - spaceW;
    const valueLines: string[] = [];
    if (availableValW > 30) {
      const firstLineWrapped = wrapText(rawLines[0] || "", availableValW, state.fonts.regular, FONT_SIZE_BODY);
      valueLines.push(firstLineWrapped[0] || "");
      const remainingFirst = firstLineWrapped.slice(1);
      for (const rem of remainingFirst) {
        valueLines.push(rem);
      }
      for (let i = 1; i < rawLines.length; i++) {
        const wrapped = wrapText(rawLines[i], box.contentWidth, state.fonts.regular, FONT_SIZE_BODY);
        valueLines.push(...(wrapped.length > 0 ? wrapped : [""]));
      }
    } else {
      for (const raw of rawLines) {
        const wrapped = wrapText(raw, box.contentWidth, state.fonts.regular, FONT_SIZE_BODY);
        valueLines.push(...(wrapped.length > 0 ? wrapped : [""]));
      }
    }

    const valLine0 = valueLines[0] ?? "";
    const valLine0W = state.fonts.regular.widthOfTextAtSize(valLine0, FONT_SIZE_BODY);
    const compoundW = labelW + spaceW + valLine0W;
    const startX = alignX(box, cmd.align, compoundW);

    const maxFontSize = Math.max(FONT_SIZE_LABEL, FONT_SIZE_BODY);
    const lineHeight = maxFontSize * FIELD_LINE_HEIGHT;
    ensureLineSpace(state, lineHeight);

    // Draw label
    state.page.drawText(labelText, {
      x: startX,
      y: state.y - maxFontSize,
      font: state.fonts.bold,
      size: FONT_SIZE_LABEL,
      color: COLOR_GRAY,
    });

    // Draw value line 0
    state.page.drawText(valLine0, {
      x: startX + labelW + spaceW,
      y: state.y - maxFontSize,
      font: state.fonts.regular,
      size: FONT_SIZE_BODY,
      color: valueColor,
    });
    state.y -= lineHeight;

    // Subsequent value lines if any
    for (let i = 1; i < valueLines.length; i++) {
      const line = valueLines[i];
      const lw = state.fonts.regular.widthOfTextAtSize(line, FONT_SIZE_BODY);
      ensureLineSpace(state, FONT_SIZE_BODY * FIELD_LINE_HEIGHT);
      const x = cmd.align === "center"
        ? alignX(box, "center", lw)
        : cmd.align === "right"
          ? alignX(box, "right", lw)
          : startX + labelW + spaceW;
      state.page.drawText(line, {
        x,
        y: state.y - FONT_SIZE_BODY,
        font: state.fonts.regular,
        size: FONT_SIZE_BODY,
        color: valueColor,
      });
      state.y -= FONT_SIZE_BODY * FIELD_LINE_HEIGHT;
    }

    state.y -= POST_BLOCK_SPACING;
    return;
  }

  // Stacked layout (or showLabel = false)
  if (cmd.showLabel) {
    const labelLines = wrapText(labelText, box.contentWidth, state.fonts.bold, FONT_SIZE_LABEL);
    for (const line of labelLines) {
      const lw = state.fonts.bold.widthOfTextAtSize(line, FONT_SIZE_LABEL);
      ensureLineSpace(state, FONT_SIZE_LABEL * FIELD_LINE_HEIGHT);
      state.page.drawText(line, {
        x: alignX(box, cmd.align, lw),
        y: state.y - FONT_SIZE_LABEL,
        font: state.fonts.bold,
        size: FONT_SIZE_LABEL,
        color: COLOR_GRAY,
      });
      state.y -= FONT_SIZE_LABEL * FIELD_LINE_HEIGHT;
    }
  }

  // Draw stacked value
  const valueX =
    cmd.showLabel && cmd.align === "left"
      ? box.contentLeft + 12
      : box.contentLeft;
  drawFieldValue(
    state,
    displayValue,
    valueX,
    rawValue,
    cmd.align
  );

  state.y -= POST_BLOCK_SPACING;
}

/**
 * Draw field value (string ที่ผ่าน format แล้ว) — multiline, alignment-aware
 *
 * ข้อความยาว → wrap ให้อยู่ใน content box (อิง contentWidth)
 */
function drawFieldValue(
  state: ExecState,
  displayValue: string,
  xHint: number,
  rawValue: unknown,
  align: Align = "left"
): void {
  const box = state.box;
  const rawLines = displayValue.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of rawLines) {
    const wrapped = wrapText(
      raw,
      box.contentWidth,
      state.fonts.regular,
      FONT_SIZE_BODY
    );
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }

  // value color: dim grey ถ้า field ว่าง
  const isEmpty = !isNonEmptyValue(rawValue);
  const color = isEmpty ? COLOR_PLACEHOLDER : COLOR_BLACK;

  for (const line of lines) {
    const w = state.fonts.regular.widthOfTextAtSize(line, FONT_SIZE_BODY);
    // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
    ensureLineSpace(state, FONT_SIZE_BODY * FIELD_LINE_HEIGHT);
    const x =
      align === "center"
        ? alignX(box, "center", w)
        : align === "right"
          ? alignX(box, "right", w)
          : xHint;
    state.page.drawText(line || "", {
      x,
      y: state.y - FONT_SIZE_BODY,
      font: state.fonts.regular,
      size: FONT_SIZE_BODY,
      color,
    });
    state.y -= FONT_SIZE_BODY * FIELD_LINE_HEIGHT;
  }
}

// =============================================================================
// Table Renderer
// =============================================================================

interface TableLayout {
  /** table origin x (depends on align) */
  x: number;
  /** table width */
  totalWidth: number;
  /** column x positions (left edge of each column) */
  columns: { x: number; width: number }[];
  /** column headers (from first row's keys) — flat string per column */
  headers: string[];
  /** header cells wrapped (per column → lines) */
  wrappedHeaders: string[][];
  /** body cells wrapped (per row → per column → lines) */
  rows: string[][][];
  /** pre-computed row height per row (pt) — body rows only */
  rowHeights: number[];
  /** total table height (pt) */
  totalHeight: number;
  /** header row height (pt) */
  headerHeight: number;
}

function drawTable(
  state: ExecState,
  ctx: ApplicationContext,
  cmd: TableRenderCommand
): void {
  // 1) Resolve & parse data
  const rawValue = resolveAnswerValue(cmd.field, ctx);
  const tableData = parseTableData(rawValue);

  if (cmd.showLabel && cmd.label) {
    // label ยาวเกิน content box → wrap ให้อยู่ในกรอบ
    const labelLines = wrapText(
      cmd.label,
      state.box.contentWidth,
      state.fonts.bold,
      FONT_SIZE_LABEL
    );
    for (const line of labelLines) {
      const lw = state.fonts.bold.widthOfTextAtSize(line, FONT_SIZE_LABEL);
      // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
      ensureLineSpace(state, FONT_SIZE_LABEL * LINE_HEIGHT);
      state.page.drawText(line, {
        x: alignX(state.box, cmd.align, lw),
        y: state.y - FONT_SIZE_LABEL,
        font: state.fonts.bold,
        size: FONT_SIZE_LABEL,
        color: COLOR_BLACK,
      });
      state.y -= FONT_SIZE_LABEL * LINE_HEIGHT;
    }
  }

  if (tableData.length === 0) {
    // Empty state (Requirement G — emptyText)
    const emptyLines = wrapText(
      cmd.emptyText,
      state.box.contentWidth,
      state.fonts.regular,
      FONT_SIZE_BODY
    );
    for (const line of emptyLines) {
      const lw = state.fonts.regular.widthOfTextAtSize(line, FONT_SIZE_BODY);
      // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
      ensureLineSpace(state, FONT_SIZE_BODY * LINE_HEIGHT);
      state.page.drawText(line, {
        x: alignX(state.box, cmd.align, lw),
        y: state.y - FONT_SIZE_BODY,
        font: state.fonts.regular,
        size: FONT_SIZE_BODY,
        color: COLOR_GRAY,
      });
      state.y -= FONT_SIZE_BODY * LINE_HEIGHT;
    }
    state.y -= POST_BLOCK_SPACING;
    return;
  }

  // 2) Determine columns from first object's keys (preserve insertion order)
  const headers = extractTableHeaders(tableData);

  // 3) Build cell strings
  const cellStrings = buildCellStrings(tableData, headers);

  // 4) Compute layout (column widths, row heights)
  const layout = computeTableLayout(state, headers, cellStrings, cmd.align);

  // 5) Draw — with pagination + header repeat
  drawTableWithPagination(state, layout);

  // 6) Post-block spacing
  state.y -= POST_BLOCK_SPACING;
}

// =============================================================================
// Table data parsing
// =============================================================================

/**
 * Parse field value → table data
 *
 * Accepted shapes:
 *   - Array<object>  → ใช้ตรงๆ
 *   - JSON string   → parse แล้วตรวจเป็น array
 *   - Object เดี่ยว   → wrap เป็น array 1 row
 *   - null / scalar → []
 */
function parseTableData(rawValue: unknown): Record<string, unknown>[] {
  let parsed: unknown = rawValue;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (parsed === null || parsed === undefined) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed
      .filter((r): r is Record<string, unknown> => isPlainObject(r))
      .map((r) => ({ ...r }));
  }

  if (isPlainObject(parsed)) {
    return [{ ...parsed }];
  }

  return [];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract column headers from first row's keys (insertion order).
 *
 * Fallback: ถ้า data ว่าง → headers = []
 */
function extractTableHeaders(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}

/**
 * Build cell strings — for each row, for each column, produce flat cell text.
 */
function buildCellStrings(
  rows: Record<string, unknown>[],
  headers: string[]
): string[][] {
  return rows.map((row) =>
    headers.map((key) => formatCellValue(row[key]))
  );
}

/**
 * Format cell value เป็นข้อความสำหรับตาราง
 *
 * ── Requirement F.6 / F.7: ห้ามแสดง JSON ดิบ ──────────────────────────────
 * object (เช่น MASTER_DATA `{ id, name }`) → ใช้ display label
 * ตาม schema จริง (`name` → `label` → `id` → "—")
 * ไม่ใช้ JSON.stringify และไม่ตัดความยาวแบบ `...` (เพราะจะเป็น JSON อยู่ดี)
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((v) => formatCellValue(v))
      .filter((s) => s.length > 0)
      .join(", ");
  }
  if (isPlainObject(value)) {
    return getObjectDisplayLabel(value);
  }
  return String(value);
}

// =============================================================================
// Table layout (column widths + row heights)
// =============================================================================

function computeTableLayout(
  state: ExecState,
  headers: string[],
  cellStrings: string[][],
  align: Align
): TableLayout {
  const colCount = headers.length;
  const isEmpty = colCount === 0 || cellStrings.length === 0;

  // ── ความกว้างตาราง = contentWidth จาก page geometry ───────────────
  const box = state.box;
  const totalWidth = box.contentWidth;
  const tableX = alignX(box, align, totalWidth);

  if (isEmpty) {
    return {
      x: tableX,
      totalWidth,
      columns: [],
      headers: [],
      wrappedHeaders: [],
      rows: [],
      rowHeights: [],
      totalHeight: 0,
      headerHeight: 0,
    };
  }

  const columnWidth = totalWidth / colCount;
  const columns = Array.from({ length: colCount }, (_, i) => ({
    x: tableX + i * columnWidth,
    width: columnWidth,
  }));

  const cellInnerWidth = columnWidth - 2 * TABLE_ROW_PADDING_X;

  const wrappedHeaders = headers.map((h) =>
    wrapText(h, cellInnerWidth, state.fonts.bold, FONT_SIZE_TABLE_HEADER)
  );
  const headerLines = Math.max(...wrappedHeaders.map((l) => l.length), 1);
  const headerHeight =
    headerLines * FONT_SIZE_TABLE_HEADER * LINE_HEIGHT + 2 * TABLE_ROW_PADDING_Y;

  const wrappedRows: string[][][] = cellStrings.map((row) =>
    row.map((cell) =>
      wrapText(cell, cellInnerWidth, state.fonts.regular, FONT_SIZE_TABLE_CELL)
    )
  );

  const rowHeights = wrappedRows.map((row) => {
    const maxLines = Math.max(...row.map((l) => l.length), 1);
    return maxLines * FONT_SIZE_TABLE_CELL * LINE_HEIGHT + 2 * TABLE_ROW_PADDING_Y;
  });

  const bodyHeight = rowHeights.reduce((a, b) => a + b, 0);
  const totalHeight = headerHeight + bodyHeight;

  return {
    x: tableX,
    totalWidth,
    columns,
    headers,
    wrappedHeaders,
    rows: wrappedRows,
    rowHeights,
    totalHeight,
    headerHeight,
  };
}

// =============================================================================
// Table drawing (with pagination + header repeat)
// =============================================================================

function drawTableWithPagination(
  state: ExecState,
  layout: TableLayout
): void {
  if (layout.columns.length === 0) {
    return;
  }

  ensureSpace(state, layout.headerHeight);
  drawTableHeader(state, layout);

  for (let r = 0; r < layout.rows.length; r++) {
    const rowHeight = layout.rowHeights[r];
    const rowFits = fitsWithMargin(state, rowHeight);

    if (!rowFits) {
      addNewPage(state);
      drawTableHeader(state, layout);
    }

    drawTableRow(state, layout, r);
  }
}

function drawTableHeader(state: ExecState, layout: TableLayout): void {
  const rowHeight = layout.headerHeight;
  const tableBottomY = state.y - rowHeight;

  state.page.drawRectangle({
    x: layout.x,
    y: tableBottomY,
    width: layout.totalWidth,
    height: rowHeight,
    color: COLOR_HEADER_BG,
  });

  for (let c = 0; c < layout.columns.length; c++) {
    const col = layout.columns[c];
    const lines = layout.wrappedHeaders[c] ?? [layout.headers[c] ?? ""];

    for (let li = 0; li < lines.length; li++) {
      state.page.drawText(lines[li], {
        x: col.x + TABLE_ROW_PADDING_X,
        y: tableBottomY + rowHeight - TABLE_ROW_PADDING_Y - FONT_SIZE_TABLE_HEADER - li * FONT_SIZE_TABLE_HEADER * LINE_HEIGHT,
        font: state.fonts.bold,
        size: FONT_SIZE_TABLE_HEADER,
        color: COLOR_BLACK,
      });
    }
  }

  drawTableBorders(state, layout, tableBottomY, rowHeight);

  state.y = tableBottomY;
}

function drawTableRow(
  state: ExecState,
  layout: TableLayout,
  rowIndex: number
): void {
  const rowHeight = layout.rowHeights[rowIndex];
  const rowBottomY = state.y - rowHeight;
  const wrappedCells = layout.rows[rowIndex];

  for (let c = 0; c < layout.columns.length; c++) {
    const col = layout.columns[c];
    const lines = wrappedCells[c] ?? [];

    for (let li = 0; li < lines.length; li++) {
      state.page.drawText(lines[li], {
        x: col.x + TABLE_ROW_PADDING_X,
        y: rowBottomY + rowHeight - TABLE_ROW_PADDING_Y - FONT_SIZE_TABLE_CELL - li * FONT_SIZE_TABLE_CELL * LINE_HEIGHT,
        font: state.fonts.regular,
        size: FONT_SIZE_TABLE_CELL,
        color: COLOR_BLACK,
      });
    }
  }

  drawTableBorders(state, layout, rowBottomY, rowHeight);

  state.y = rowBottomY;
}

function drawTableBorders(
  state: ExecState,
  layout: TableLayout,
  rowBottomY: number,
  rowHeight: number
): void {
  const top = state.y;
  const bottom = rowBottomY;
  const left = layout.x;
  const right = layout.x + layout.totalWidth;

  state.page.drawLine({
    start: { x: left, y: top },
    end: { x: right, y: top },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  state.page.drawLine({
    start: { x: left, y: bottom },
    end: { x: right, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  state.page.drawLine({
    start: { x: left, y: top },
    end: { x: left, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  state.page.drawLine({
    start: { x: right, y: top },
    end: { x: right, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  for (let c = 1; c < layout.columns.length; c++) {
    const colX = layout.columns[c].x;
    state.page.drawLine({
      start: { x: colX, y: top },
      end: { x: colX, y: bottom },
      thickness: TABLE_BORDER,
      color: COLOR_LIGHT_GRAY,
    });
  }
}

// =============================================================================
// Pagination helpers
// =============================================================================

function ensureSpace(state: ExecState, requiredHeight: number): void {
  const SAFETY = 0.5;
  const blockBottom = state.y - requiredHeight;
  if (blockBottom < state.box.contentBottom + SAFETY) {
    addNewPage(state);
  }
}

/**
 * ตรวจว่ามีที่ว่างพอสำหรับ 1 บรรทัดที่กำลังจะวาด
 *
 * ใช้กับข้อความที่ wrap เป็นหลายบรรทัด (heading / field / systemData /
 * signature) → ถ้าบรรทัดต่อไปล้น content box → ขึ้นหน้าใหม่ก่อนวาด
 *
 * ⚠️ ต้องเรียกก่อนวาดทุกบรรทัด ไม่ใช่แค่ก่อน block
 *    เพราะข้อความยาวอาจ wrap ข้ามขอบล่างของ content box
 */
function ensureLineSpace(state: ExecState, lineHeight: number): void {
  const SAFETY = 0.5;
  if (state.y - lineHeight < state.box.contentBottom + SAFETY) {
    addNewPage(state);
  }
}

function fitsWithMargin(state: ExecState, requiredHeight: number): boolean {
  const SAFETY = 0.5;
  return state.y - requiredHeight >= state.box.contentBottom + SAFETY;
}

// =============================================================================
// Logo Renderer (Requirement D — none/organization → "ยังไม่มีโลโก้")
// =============================================================================

/**
 * Render Logo Block
 *
 * ── Requirement D ────────────────────────────────────────────────────────────
 *   source:
 *     - "none"         → ไม่แสดงอะไรเลย (no image, no text)
 *     - "organization" → โลโก้หน่วยงาน (ระบบยังไม่มี asset จริง → "ยังไม่มีโลโก้")
 *     - "upload"       → ยังไม่รองรับ — แสดง "ยังไม่มีโลโก้" เพื่อไม่ให้ PDF ล้ม
 *
 *   width/height: จาก block (optional); ถ้าไม่มี → default 70pt / auto aspect
 *   align: left | center | right (block-level alignment)
 *
 *   IMPORTANT: ถ้าไม่มี source จริง (organization/no upload available) → ไม่ render
 *   กรอบรูปว่าง หรือ <img> empty — แสดงข้อความ "ยังไม่มีโลโก้" แทน
 *
 *   [Requirement K.7] ไม่ทำให้ PDF generation ล้มเมื่อไม่มีโลโก้
 */
function drawLogo(state: ExecState, cmd: LogoRenderCommand): void {
  const source = cmd.source ?? "organization";

  // ── source = "none" → ไม่ render (Requirement D) ─────────────────────
  if (source === "none") {
    return;
  }

  // ── ขนาด (block-controlled, มี default) ────────────────────────────
  const targetWidth = clampSize(cmd.width, 70);

  // ── กรณี "upload" → ยังไม่มี asset storage → แสดงข้อความเตือน ─────
  // (ระบบไม่มี Public R2 route สำหรับ admin upload — Requirement D)
  if (source === "upload") {
    const note = `${NO_LOGO_TEXT} (upload)`;
    drawLogoText(state, note, cmd.align);
    return;
  }

  // ── "organization" → ใช้รูป SAO logo จาก asset-loader ────────────
  if (!state.logo) {
    // ไม่มี asset → แสดง placeholder (Requirement D)
    drawLogoText(state, NO_LOGO_TEXT, cmd.align);
    return;
  }

  const aspectRatio = state.logo.height / state.logo.width;

  // ── โลโก้ต้องอยู่ภายใน content box ────────────────────────────────
  // - ความกว้างไม่เกิน contentWidth
  // - ความสูงไม่เกินพื้นที่ที่เหลือใน content box (ไม่ทับ footer)
  // - align: left → contentLeft, center → กึ่งกลาง content box, right → contentRight
  const box = state.box;
  const maxWidth = Math.max(1, box.contentWidth);
  let fittedWidth = Math.min(targetWidth, maxWidth);
  let fittedHeight = fittedWidth * aspectRatio;

  // พื้นที่แนวตั้งที่เหลือ (อาจน้อย/ไม่พอ → ต้องย่อหรือขึ้นหน้าใหม่)
  const availableHeight = state.y - box.contentBottom;
  if (fittedHeight > availableHeight) {
    if (availableHeight <= 0) {
      // ไม่มีที่ว่างเลย → ขึ้นหน้าใหม่แล้วลองอีกครั้ง
      addNewPage(state);
      const fresh = state.y - box.contentBottom;
      fittedHeight = Math.max(0, Math.min(fittedHeight, fresh));
      fittedWidth = fittedHeight / aspectRatio;
    } else {
      fittedHeight = availableHeight;
      fittedWidth = fittedHeight / aspectRatio;
    }
  }

  const x = alignX(box, cmd.align, fittedWidth);

  state.page.drawImage(state.logo, {
    x,
    y: state.y - fittedHeight,
    width: fittedWidth,
    height: fittedHeight,
  });
  state.y -= fittedHeight;
  state.y -= POST_BLOCK_SPACING;
}

/**
 * Helper: draw "ยังไม่มีโลโก้" placeholder text — block-level align
 */
function drawLogoText(state: ExecState, text: string, align: Align): void {
  const fontSize = 11;
  const box = state.box;
  const lines = wrapText(text, box.contentWidth, state.fonts.regular, fontSize);
  for (const line of lines) {
    const w = state.fonts.regular.widthOfTextAtSize(line, fontSize);
    state.page.drawText(line, {
      x: alignX(box, align, w),
      y: state.y - fontSize,
      font: state.fonts.regular,
      size: fontSize,
      color: COLOR_GRAY,
    });
    state.y -= fontSize * LINE_HEIGHT;
  }
  state.y -= POST_BLOCK_SPACING;
}

/**
 * Clamp width ให้อยู่ในช่วง 8..1000 (mirror image-size schema bounds)
 */
function clampSize(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.round(value);
  if (n < 8) return 8;
  if (n > 1000) return 1000;
  return n;
}

// =============================================================================
// Signature Renderer (Requirement C — extended layout)
// =============================================================================

/**
 * Draw signature block — render lines ตาม layout เดียวกับ Preview:
 *   1) "<lineLabel> <lineStyle> <roleLabel>"      — always rendered
 *   2) "(<signerName>)"            — ถ้า showName (+ showParentheses)
 *      หรือ "<signerName>"         — ถ้า showName + !showParentheses
 *   3) "<dateLabel> <dateText>"    — ถ้า showDate
 *   4) "เวลา <timeText> น."         — ถ้า showTime (default: ปิด)
 *
 * Visibility:
 *   - ทุก fallback line ใช้สี PLACEHOLDER (ไม่ใช่ COLOR_BLACK)
 *   - ทุกค่าจริงใช้สี BLACK
 *
 * [Requirement K.6] หาก block ใด ๆ render ล้ม (เช่น signature.length overflow) →
 * ใช้ try/catch รอบ executeCommand เพื่อกันเอกสารทั้งฉบับล้ม
 */
function computeSignatureHeight(
  state: ExecState,
  cmd: SignatureRenderCommand
): number {
  let height = FONT_SIZE_SIGNATURE_LABEL * SIGNATURE_LINE_HEIGHT;
  const box = state.box;

  if (cmd.showName) {
    const text = cmd.signerName;
    const isPlaceholder = !cmd.hasRealName;
    const alreadyWrapped = text.startsWith("(") && text.endsWith(")");
    let displayText: string;
    if (isPlaceholder && alreadyWrapped) {
      displayText = text;
    } else if (cmd.showParentheses) {
      displayText = `(${text})`;
    } else {
      displayText = text;
    }
    const lines = wrapText(
      displayText,
      box.contentWidth,
      state.fonts.regular,
      FONT_SIZE_SIGNATURE_META
    );
    height += Math.max(1, lines.length) * (FONT_SIZE_SIGNATURE_META * SIGNATURE_LINE_HEIGHT);
  }

  if (cmd.showDate) {
    const lines = wrapText(
      `${cmd.dateLabel} ${cmd.dateText}`,
      box.contentWidth,
      state.fonts.regular,
      FONT_SIZE_SIGNATURE_META
    );
    height += Math.max(1, lines.length) * (FONT_SIZE_SIGNATURE_META * SIGNATURE_LINE_HEIGHT);
  }

  if (cmd.showTime) {
    const lines = wrapText(
      `เวลา ${cmd.timeText} น.`,
      box.contentWidth,
      state.fonts.regular,
      FONT_SIZE_SIGNATURE_META
    );
    height += Math.max(1, lines.length) * (FONT_SIZE_SIGNATURE_META * SIGNATURE_LINE_HEIGHT);
  }

  height += POST_BLOCK_SPACING;
  return height;
}

function drawSignature(state: ExecState, cmd: SignatureRenderCommand): void {
  // Keep Together: คำนวณความสูงทั้งบล็อก ถ้าพื้นที่หน้าเดิมไม่พอ ให้ขึ้นหน้าใหม่ทันทีก่อนวาด Line 1
  const requiredHeight = computeSignatureHeight(state, cmd);
  ensureSpace(state, requiredHeight);

  // ── Line 1: "<lineLabel> <lineStyle> <roleLabel>" — always rendered ──
  const labelText = cmd.lineLabel;
  const lineText = cmd.lineStyle;
  const roleText = cmd.roleLabel.trim().length > 0 ? cmd.roleLabel : "";
  // (space ระหว่าง elements: 1 space)
  drawSignatureLine1(state, labelText, lineText, roleText, cmd.align);

  // ── Line 2: signerName (ถ้า showName) ──────────────────────────────
  if (cmd.showName) {
    const nameColor = cmd.hasRealName ? COLOR_BLACK : COLOR_PLACEHOLDER;
    const isPlaceholder = !cmd.hasRealName;
    // ถ้า command มี placeholder ที่ห่อด้วย (...) มาแล้ว (เช่น "(ชื่อผู้สมัคร)")
    // → วาดตรง ๆ ห้ามใส่ () ซ้ำ
    const text = cmd.signerName;
    const alreadyWrapped =
      text.startsWith("(") && text.endsWith(")");
    let displayText: string;
    if (isPlaceholder && alreadyWrapped) {
      displayText = text;
    } else if (cmd.showParentheses) {
      displayText = `(${text})`;
    } else {
      displayText = text;
    }
    drawSignatureText(state, displayText, cmd.align, nameColor);
  }

  // ── Line 3: roleLabel (already in line 1; ตาม Requirement C signature layout) ──

  // ── Line 4: วันที่ (ถ้า showDate และ dateSource !== 'none') ───────
  if (cmd.showDate) {
    const isPlaceholderDate = cmd.dateText === "______________";
    const dateColor = isPlaceholderDate ? COLOR_PLACEHOLDER : COLOR_BLACK;
    drawSignatureText(
      state,
      `${cmd.dateLabel} ${cmd.dateText}`,
      cmd.align,
      dateColor
    );
  }

  // ── Line 5: เวลา (ถ้า showTime) ──────────────────────────────────
  if (cmd.showTime) {
    const isPlaceholderTime = cmd.timeText === "______________";
    const timeColor = isPlaceholderTime ? COLOR_PLACEHOLDER : COLOR_BLACK;
    drawSignatureText(
      state,
      `เวลา ${cmd.timeText} น.`,
      cmd.align,
      timeColor
    );
  }

  state.y -= POST_BLOCK_SPACING;
}

/**
 * Draw signature line 1: "<lineLabel> <lineStyle> <roleLabel>"
 *
 * (alias สำหรับเส้น: "......" "_____" หรือข้อความอื่นที่ Admin ตั้ง)
 * ความยาว total = labelW + sp + lineW + sp + roleW
 * (วาด label, line, role แยกกัน 3 elements)
 */
function drawSignatureLine1(
  state: ExecState,
  label: string,
  lineStyle: string,
  roleLabel: string,
  align: Align
): void {
  const fontSize = FONT_SIZE_SIGNATURE_LABEL;
  const box = state.box;
  const labelW = state.fonts.regular.widthOfTextAtSize(label, fontSize);
  const lineW = state.fonts.regular.widthOfTextAtSize(lineStyle, fontSize);
  const roleW = state.fonts.regular.widthOfTextAtSize(roleLabel, fontSize);
  const space = 8;

  const totalWidth =
    labelW +
    space +
    lineW +
    (roleLabel.length > 0 ? space + roleW : 0);

  // ── Determine x origin based on align (ภายใน content box) ────────
  const blockX = alignX(box, align, totalWidth);

  // ถ้าเส้น+label ยาวเกิน content box → ตัดเส้นให้พอดีกรอบ
  const lineText =
    blockX + labelW + space + lineW > box.contentRight
      ? "…"
      : lineStyle;
  const usedLineW = state.fonts.regular.widthOfTextAtSize(lineText, fontSize);

  // Draw label
  state.page.drawText(label, {
    x: blockX,
    y: state.y - fontSize,
    font: state.fonts.regular,
    size: fontSize,
    color: COLOR_BLACK,
  });
  let cur = blockX + labelW + space;

  // Draw line style (จุด/ขีด)
  state.page.drawText(lineText, {
    x: cur,
    y: state.y - fontSize,
    font: state.fonts.regular,
    size: fontSize,
    color: COLOR_BLACK,
  });
  cur += usedLineW + space;

  // Draw role label (optional)
  if (roleLabel.length > 0 && cur + roleW <= box.contentRight) {
    state.page.drawText(roleLabel, {
      x: cur,
      y: state.y - fontSize,
      font: state.fonts.regular,
      size: fontSize,
      color: COLOR_BLACK,
    });
  }

  state.y -= fontSize * SIGNATURE_LINE_HEIGHT;
}

/**
 * Draw signature text line (label + name / date / time)
 * - รักษา block-level align
 * - ใช้สีที่กำหนด (BLACK หรือ PLACEHOLDER)
 * - ข้อความยาว → wrap ให้อยู่ใน content box
 */
function drawSignatureText(
  state: ExecState,
  text: string,
  align: Align,
  color: ReturnType<typeof rgb>
): void {
  const fontSize = FONT_SIZE_SIGNATURE_META;
  const box = state.box;
  const lines = wrapText(text, box.contentWidth, state.fonts.regular, fontSize);
  for (const line of lines) {
    const w = state.fonts.regular.widthOfTextAtSize(line, fontSize);
    // ข้อความยาวที่ wrap หลายบรรทัด → ขึ้นหน้าใหม่ถ้าบรรทัดนี้ล้น content box
    ensureLineSpace(state, fontSize * SIGNATURE_LINE_HEIGHT);
    state.page.drawText(line, {
      x: alignX(box, align, w),
      y: state.y - fontSize,
      font: state.fonts.regular,
      size: fontSize,
      color,
    });
    state.y -= fontSize * SIGNATURE_LINE_HEIGHT;
  }
}

// =============================================================================
// Inline value resolution (mirror pdf-renderer.service.ts semantics)
// =============================================================================

function resolveAnswerValue(field: FieldData, ctx: ApplicationContext): unknown {
  const formData = (ctx.application.formData ?? {}) as Record<string, unknown>;
  return (
    formData[field.fieldId] ??
    formData[field.pdfMappingKey ?? ""] ??
    null
  );
}

/**
 * Format value สำหรับ field display
 *
 * mirror preview-renderer.ts (Requirement F.5/F.6/F.7)
 * - MASTER_DATA แบบค่าเดียว { id, name } → .name (ไม่ JSON.stringify)
 * - array ของ object → labels joined
 * - primitive → as-is
 */
function formatAnswerValueForDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    if (value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
      const labels = value
        .map((v) => getObjectDisplayLabel(v as Record<string, unknown>))
        .filter((s) => s && s !== "—");
      return labels.length > 0 ? labels.join(", ") : "-";
    }
    return value
      .map((v) => formatAnswerValueForDisplay(v))
      .filter((s) => s && s !== "-")
      .join(", ");
  }
  if (typeof value === "object") {
    const label = getObjectDisplayLabel(value as Record<string, unknown>);
    return label === "—" ? "-" : label;
  }
  return String(value);
}

/**
 * ตรวจว่า value มีเนื้อหาจริงหรือไม่ (ใช้กำหนดสี placeholder)
 */
function isNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// =============================================================================
// Thai date/time formatting (mirror pdf-renderer.service.ts semantics)
// =============================================================================

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/**
 * Format unix timestamp → Thai date string (พ.ศ.)
 * Example: 16 ตุลาคม 2569
 */
function formatThaiDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = d.getDate();
  const month = THAI_MONTHS[d.getMonth()];
  const thaiYear = d.getFullYear() + 543;
  return `${day} ${month} ${thaiYear}`;
}

/**
 * Format unix timestamp → HH:mm
 * Example: 13:37
 */
function formatThaiTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// =============================================================================
// Thai-aware text wrap
// =============================================================================

function wrapText(
  text: string,
  maxWidth: number,
  font: PDFFont,
  size: number
): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(paragraph, maxWidth, font, size));
  }
  return lines;
}

function wrapParagraph(
  text: string,
  maxWidth: number,
  font: PDFFont,
  size: number
): string[] {
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const lines: string[] = [];
  let line = "";

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (line.length > 0) line += token;
      continue;
    }

    if (font.widthOfTextAtSize(token, size) <= maxWidth) {
      const candidate = line.length > 0 ? line + " " + token : token;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line.length > 0) lines.push(line);
        line = token;
      }
      continue;
    }

    if (line.length > 0) lines.push(line);
    line = "";

    const chars = Array.from(token);
    let buf = "";
    for (const ch of chars) {
      const test = buf + ch;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        buf = test;
      } else {
        if (buf.length > 0) lines.push(buf);
        buf = ch;
      }
    }
    if (buf.length > 0) line = buf;
  }

  if (line.length > 0) lines.push(line);
  return lines;
}

// suppress unused-import warning for some helpers kept for future
void resolveDocumentTokens;
void DOCUMENT_TOKEN_LABELS;
