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
 */

import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib";
import type {
  ApplicationContext,
  FieldData,
} from "../pdf-types";
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
} from "./types";

// =============================================================================
// Render Plan Types
// =============================================================================

/**
 * RenderPlan = ordered list ของ render command
 *
 * type discriminator: "heading" | "field" | "table" | "logo" | "padding"
 *
 * padding = spacing ระหว่าง block (จาก marginTop/marginBottom)
 */
export type RenderCommand =
  | PaddingCommand
  | HeadingRenderCommand
  | FieldRenderCommand
  | TableRenderCommand
  | LogoRenderCommand;

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
  text: string;
  size: HeadingBlock["size"];
  bold: boolean;
  align: "left" | "center" | "right";
  fontSize: number;
  margins: { top: number; bottom: number };
}

export interface FieldRenderCommand {
  type: "field";
  blockId: string;
  field: FieldData;
  overrideLabel?: string;
  align: "left" | "center" | "right";
  margins: { top: number; bottom: number };
}

export interface TableRenderCommand {
  type: "table";
  blockId: string;
  field: FieldData;
  align: "left" | "center" | "right";
  margins: { top: number; bottom: number };
}

export interface LogoRenderCommand {
  type: "logo";
  blockId: string;
  align: "left" | "center" | "right";
  margins: { top: number; bottom: number };
}

export interface RenderPlan {
  commands: RenderCommand[];
  meta: {
    blockCount: number;
    fieldRefCount: number;
    missingFieldIds: string[];
  };
}

// =============================================================================
// Constants (mirror pdf-renderer.service.ts เพื่อ visual consistency)
// =============================================================================

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const FOOTER_RESERVE = 60;
const CONTENT_TOP_AFTER_HEADER = PAGE_HEIGHT - MARGIN - 80;
const CONTENT_BOTTOM = MARGIN + FOOTER_RESERVE;
const LINE_HEIGHT = 1.4;
const POST_BLOCK_SPACING = 8;

const FONT_SIZE_LARGE = 16;
const FONT_SIZE_MEDIUM = 13;
const FONT_SIZE_SMALL = 11;
const FONT_SIZE_LABEL = 11;
const FONT_SIZE_BODY = 12;

const SIZE_TO_FONT_SIZE: Record<HeadingBlock["size"], number> = {
  large: FONT_SIZE_LARGE,
  medium: FONT_SIZE_MEDIUM,
  small: FONT_SIZE_SMALL,
};

const COLOR_PRIMARY = rgb(0.05, 0.27, 0.51);
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.4, 0.4, 0.4);

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

  for (const block of descriptor.blocks) {
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
      ctx
    );
    if (command) {
      commands.push(command);
      if (command.type === "field" || command.type === "table") {
        fieldRefCount += 1;
      }
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
  _ctx: ApplicationContext
): RenderCommand | null {
  const margins = {
    top: block.marginTop ?? 0,
    bottom: block.marginBottom ?? 0,
  };
  const align = (block.align ?? "left") as "left" | "center" | "right";

  switch (block.type) {
    case "heading":
      return {
        type: "heading",
        blockId: block.id,
        text: block.text,
        size: block.size,
        bold: block.bold ?? true,
        align,
        fontSize: SIZE_TO_FONT_SIZE[block.size],
        margins,
      };

    case "field": {
      const field = fieldIndex.get(block.fieldId);
      if (!field) {
        missingFieldIds.push(block.fieldId);
        return null;
      }
      return {
        type: "field",
        blockId: block.id,
        field,
        overrideLabel: block.label,
        align,
        margins,
      };
    }

    case "table": {
      const field = fieldIndex.get(block.fieldId);
      if (!field) {
        missingFieldIds.push(block.fieldId);
        return null;
      }
      return {
        type: "table",
        blockId: block.id,
        field,
        align,
        margins,
      };
    }

    case "logo":
      return {
        type: "logo",
        blockId: block.id,
        align,
        margins,
      };
  }
}

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
  // Dynamic import เพื่อรักษา tree-shakability
  const { loadSarabunFonts } = await import("../fonts/font-loader");
  const { loadSaoLogo } = await import("../assets/logo-loader");

  const doc = await PDFDocument.create();
  const fonts = await loadSarabunFonts(doc);
  const logo = await loadSaoLogo(doc);

  const state: ExecState = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: CONTENT_TOP_AFTER_HEADER,
    fonts,
    logo,
  };

  const generatedAt = Math.floor(Date.now() / 1000);

  for (const cmd of plan.commands) {
    executeCommand(state, ctx, cmd);
  }

  const bytes = await doc.save();
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
}

function executeCommand(
  state: ExecState,
  ctx: ApplicationContext,
  cmd: RenderCommand
): void {
  // Pagination guard
  if (state.y < CONTENT_BOTTOM) {
    state.page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    state.y = CONTENT_TOP_AFTER_HEADER;
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
  }
}

function drawHeading(state: ExecState, cmd: HeadingRenderCommand): void {
  const font = cmd.bold ? state.fonts.bold : state.fonts.regular;
  const textWidth = font.widthOfTextAtSize(cmd.text, cmd.fontSize);

  let x: number;
  switch (cmd.align) {
    case "center":
      x = (PAGE_WIDTH - textWidth) / 2;
      break;
    case "right":
      x = PAGE_WIDTH - MARGIN - textWidth;
      break;
    case "left":
    default:
      x = MARGIN;
  }

  state.page.drawText(cmd.text, {
    x,
    y: state.y - cmd.fontSize,
    font,
    size: cmd.fontSize,
    color: COLOR_PRIMARY,
  });
  state.y -= cmd.fontSize * LINE_HEIGHT;
}

function drawField(
  state: ExecState,
  ctx: ApplicationContext,
  cmd: FieldRenderCommand
): void {
  const rawValue = resolveAnswerValue(cmd.field, ctx);
  const displayValue = formatAnswerValueForDisplay(rawValue);
  const label = cmd.overrideLabel ?? cmd.field.label;
  const requiredMarker = cmd.field.isRequired ? " *" : "";

  // Label
  state.page.drawText(`${label}${requiredMarker}`, {
    x: MARGIN,
    y: state.y - FONT_SIZE_LABEL,
    font: state.fonts.bold,
    size: FONT_SIZE_LABEL,
    color: COLOR_GRAY,
  });
  state.y -= FONT_SIZE_LABEL * LINE_HEIGHT;

  // Value (V1 foundation: simple newline split; full Thai wrap ใน iteration ถัดไป)
  const lines = splitLinesForV1(displayValue);
  for (const line of lines) {
    state.page.drawText(line, {
      x: MARGIN + 12,
      y: state.y - FONT_SIZE_BODY,
      font: state.fonts.regular,
      size: FONT_SIZE_BODY,
      color: COLOR_BLACK,
    });
    state.y -= FONT_SIZE_BODY * LINE_HEIGHT;
  }

  state.y -= POST_BLOCK_SPACING;
}

function drawTable(
  _state: ExecState,
  _ctx: ApplicationContext,
  _cmd: TableRenderCommand
): void {
  // V1 foundation: table composition เป็น next iteration
  // block ถูก plan ไว้ใน RenderPlan.meta แล้ว
  // แต่ยังไม่ drawn — intentional เพื่อไม่กระทบ path อื่น
}

function drawLogo(state: ExecState, cmd: LogoRenderCommand): void {
  if (!state.logo) return;

  const targetWidth = 70;
  const aspectRatio = state.logo.height / state.logo.width;
  const targetHeight = targetWidth * aspectRatio;

  let x: number;
  switch (cmd.align) {
    case "center":
      x = (PAGE_WIDTH - targetWidth) / 2;
      break;
    case "right":
      x = PAGE_WIDTH - MARGIN - targetWidth;
      break;
    case "left":
    default:
      x = MARGIN;
  }

  state.page.drawImage(state.logo, {
    x,
    y: state.y - targetHeight,
    width: targetWidth,
    height: targetHeight,
  });
  state.y -= targetHeight;
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

function formatAnswerValueForDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    return value
      .map((v) => formatAnswerValueForDisplay(v))
      .filter((s) => s && s !== "-")
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json.length > 200 ? json.slice(0, 200) + "..." : json;
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function splitLinesForV1(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}
