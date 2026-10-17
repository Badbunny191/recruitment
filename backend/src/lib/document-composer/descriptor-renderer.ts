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
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 1.4;
const POST_BLOCK_SPACING = 8;

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

const SIZE_TO_FONT_SIZE: Record<HeadingBlock["size"], number> = {
  large: FONT_SIZE_LARGE,
  medium: FONT_SIZE_MEDIUM,
  small: FONT_SIZE_SMALL,
};

const COLOR_PRIMARY = rgb(0.05, 0.27, 0.51);
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.4, 0.4, 0.4);
const COLOR_LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const COLOR_HEADER_BG = rgb(TABLE_HEADER_BG_THRESHOLD, TABLE_HEADER_BG_THRESHOLD, TABLE_HEADER_BG_THRESHOLD);

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
  // Lazy load assets — logo เฉพาะเมื่อ plan มี logo block
  // เพื่อลด PDF size สำหรับ table/field-only documents
  const { loadSarabunFonts } = await import("../fonts/font-loader");
  const { loadSaoLogo } = await import("../assets/logo-loader");

  const doc = await PDFDocument.create();
  const fonts = await loadSarabunFonts(doc);
  const hasLogo = plan.commands.some((c) => c.type === "logo");
  const logo = hasLogo ? await loadSaoLogo(doc) : null;

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
  // Pagination guard (mirror pdf-renderer.service.ts:ensureSpace)
  if (state.y < CONTENT_BOTTOM) {
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
  }
}

/**
 * Add new page and reset cursor to top of content area.
 *
 * Pattern reuse: pdf-renderer.service.ts:addNewPage
 *   - สร้าง new page
 *   - reset state.y = CONTENT_TOP_AFTER_HEADER
 *   - footer/header จะถูก render ใน final pass (V1: ไม่มี header/footer pass
 *     เพราะ composer ไม่มี fixed header — แต่ pattern เดียวกัน)
 */
function addNewPage(state: ExecState): void {
  state.page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.y = CONTENT_TOP_AFTER_HEADER;
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

  // Value (V1: simple newline split; full Thai wrap ใน iteration ถัดไป)
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

// =============================================================================
// Table Renderer
// =============================================================================

/**
 * Table layout pre-computed from data + fonts.
 *
 * Reuse pattern จาก pdf-renderer.service.ts: renderField ใช้
 *   - heightForWrappedText() ก่อนวาด → reserve space
 *   - ensureSpace() ก่อนวาด
 *
 * V1 composer ใช้ pattern เดียวกันแต่ต่อ row-by-row เพราะ row height
 * ขึ้นกับ wrapped lines ของ cell ที่ wrap มากที่สุดใน row นั้น
 */
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
 *
 * Cell value formatting ใช้ pattern เดียวกับ formatAnswerValueForDisplay
 * แต่ flatten array/object เป็น single-line text
 *
 * Return type: row → cell (flat string), เช่น [["a", "b"], ["c", "d"]]
 *              (wrap จริงทำใน computeTableLayout เพื่อให้รู้ font/width)
 */
function buildCellStrings(
  rows: Record<string, unknown>[],
  headers: string[]
): string[][] {
  return rows.map((row) =>
    headers.map((key) => {
      const v = row[key];
      return formatCellValue(v);
    })
  );
}

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

// =============================================================================
// Table layout (column widths + row heights)
// =============================================================================

/**
 * Compute layout: column widths, per-row wrapped cell lines, row heights.
 *
 * Algorithm:
 *   1) Distribute CONTENT_WIDTH เท่าๆ กัน (single column flow: ไม่มี column spec)
 *      → column width = CONTENT_WIDTH / N
 *      → cell inner width = columnWidth - 2*TABLE_ROW_PADDING_X
 *   2) Wrap ทุก cell ในทุก row ด้วย wrapParagraph (Thai-aware)
 *   3) row height = max(lines count) * fontSize * LINE_HEIGHT + 2*TABLE_ROW_PADDING_Y
 *   4) header height = header row height (single row header)
 *   5) total height = header + sum(rows)
 */
function computeTableLayout(
  state: ExecState,
  headers: string[],
  cellStrings: string[][],
  align: "left" | "center" | "right"
): TableLayout {
  const colCount = headers.length;
  const isEmpty = colCount === 0 || cellStrings.length === 0;

  // ── Table width & origin ────────────────────────────────────────────
  // V1: ใช้ CONTENT_WIDTH เต็ม (single column flow)
  //     align ของ block มีผลกับ table position ในหน้า:
  //       left  → flush left (MARGIN)
  //       right → flush right (PAGE_WIDTH - MARGIN)
  //       center → centered
  const totalWidth = isEmpty ? CONTENT_WIDTH : CONTENT_WIDTH;
  let tableX: number;
  switch (align) {
    case "right":
      tableX = PAGE_WIDTH - MARGIN - totalWidth;
      break;
    case "center":
      tableX = (PAGE_WIDTH - totalWidth) / 2;
      break;
    case "left":
    default:
      tableX = MARGIN;
  }

  // ── Column layout (empty table fallback) ────────────────────────────
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

  // ── Column widths (equal distribution) ──────────────────────────────
  const columnWidth = totalWidth / colCount;
  const columns = Array.from({ length: colCount }, (_, i) => ({
    x: tableX + i * columnWidth,
    width: columnWidth,
  }));

  const cellInnerWidth = columnWidth - 2 * TABLE_ROW_PADDING_X;

  // ── Wrap header cells ───────────────────────────────────────────────
  const wrappedHeaders = headers.map((h) =>
    wrapText(h, cellInnerWidth, state.fonts.bold, FONT_SIZE_TABLE_HEADER)
  );
  const headerLines = Math.max(...wrappedHeaders.map((l) => l.length), 1);
  const headerHeight =
    headerLines * FONT_SIZE_TABLE_HEADER * LINE_HEIGHT + 2 * TABLE_ROW_PADDING_Y;

  // ── Wrap body cells + compute per-row height ───────────────────────
  // cellStrings: string[][] = [row][cell] → wrap each cell to lines
  // wrappedRows: string[][][] = [row][cell][line]
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

/**
 * Draw table with page break support.
 *
 * Pattern reuse: pdf-renderer.service.ts:renderField
 *   - ensureSpace() ก่อนแต่ละ row
 *   - reserved height = computed row height (จาก wrap จริง ไม่ใช่ fixed count)
 *
 * Header repeats on every page (re-draw header row หลัง page break)
 */
function drawTableWithPagination(
  state: ExecState,
  layout: TableLayout
): void {
  if (layout.columns.length === 0) {
    // Empty table — draw single placeholder line
    ensureSpace(state, FONT_SIZE_BODY * LINE_HEIGHT);
    state.page.drawText("(ไม่มีข้อมูล)", {
      x: layout.x,
      y: state.y - FONT_SIZE_BODY,
      font: state.fonts.regular,
      size: FONT_SIZE_BODY,
      color: COLOR_GRAY,
    });
    state.y -= FONT_SIZE_BODY * LINE_HEIGHT;
    return;
  }

  // ── Ensure header fits on current page; else break to new page ──────
  ensureSpace(state, layout.headerHeight);
  drawTableHeader(state, layout);

  // ── Draw each row with page break + header repeat ───────────────────
  for (let r = 0; r < layout.rows.length; r++) {
    const rowHeight = layout.rowHeights[r];

    // Page break logic:
    //   - If current row doesn't fit AND header+row can fit on a new page
    //     → break page + repeat header
    //   - If current row doesn't fit AND header+row STILL doesn't fit
    //     (i.e. even on a new page, header+row exceeds content area)
    //     → break anyway, draw header (it might be cropped but at least
    //       we get a page break so the next row can start cleanly)
    //   - Otherwise: draw row in place
    const rowFits = fitsWithMargin(state, rowHeight);
    const headerPlusRowFits = fitsWithMargin(state, layout.headerHeight + rowHeight);

    if (!rowFits) {
      addNewPage(state);
      drawTableHeader(state, layout);
    } else if (!headerPlusRowFits) {
      // Defensive: row fits but no room for next header
      // → continue (will be caught in next iteration)
    }

    drawTableRow(state, layout, r);
  }
}

/**
 * Draw header row: background fill + bold text + borders.
 */
function drawTableHeader(state: ExecState, layout: TableLayout): void {
  const rowHeight = layout.headerHeight;
  const tableBottomY = state.y - rowHeight;

  // Background fill
  state.page.drawRectangle({
    x: layout.x,
    y: tableBottomY,
    width: layout.totalWidth,
    height: rowHeight,
    color: COLOR_HEADER_BG,
  });

  // Cell text + borders
  for (let c = 0; c < layout.columns.length; c++) {
    const col = layout.columns[c];
    const lines = layout.wrappedHeaders[c] ?? [layout.headers[c] ?? ""];

    // Draw cell text (top-aligned within cell)
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

  // Borders
  drawTableBorders(state, layout, tableBottomY, rowHeight);

  state.y = tableBottomY;
}

/**
 * Draw body row: cell text + borders.
 */
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

/**
 * Draw table borders (outer + vertical column separators + horizontal
 * separator between header and first row).
 *
 * Note: horizontal lines between body rows ไม่วาดเพื่อให้อ่านง่าย
 *       (V1: minimal style — vertical lines + header underline)
 */
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

  // Top border
  state.page.drawLine({
    start: { x: left, y: top },
    end: { x: right, y: top },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  // Bottom border
  state.page.drawLine({
    start: { x: left, y: bottom },
    end: { x: right, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  // Left border
  state.page.drawLine({
    start: { x: left, y: top },
    end: { x: left, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  // Right border
  state.page.drawLine({
    start: { x: right, y: top },
    end: { x: right, y: bottom },
    thickness: TABLE_BORDER,
    color: COLOR_GRAY,
  });

  // Vertical column separators
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
// Pagination helpers (reuse pattern from pdf-renderer.service.ts)
// =============================================================================

/**
 * Ensure there is enough vertical space for a block of `requiredHeight`.
 *
 * Pattern reuse: pdf-renderer.service.ts:ensureSpace
 *   - ถ้า reserved height overflow → addNewPage()
 *
 * ความแตกต่างจากต้นฉบับ: เพิ่ม SAFETY margin เพื่อกัน float drift
 */
function ensureSpace(state: ExecState, requiredHeight: number): void {
  const SAFETY = 0.5;
  const blockBottom = state.y - requiredHeight;
  if (blockBottom < CONTENT_BOTTOM + SAFETY) {
    addNewPage(state);
  }
}

/**
 * Check ว่า reserved height พอ + เผื่อ margin ให้ header ซ้ำได้
 */
function fitsWithMargin(state: ExecState, requiredHeight: number): boolean {
  const SAFETY = 0.5;
  return state.y - requiredHeight >= CONTENT_BOTTOM + SAFETY;
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

// =============================================================================
// Thai-aware text wrap (re-implementation of pdf-renderer.service.ts:wrapText)
// =============================================================================

/**
 * Wrap text into lines that fit within maxWidth.
 *
 * Algorithm mirror: pdf-renderer.service.ts:wrapText
 *   - Try to break at whitespace (word boundary) when available
 *   - For words longer than maxWidth (typical for Thai without spaces),
 *     fall back to character-level greedy wrapping
 *   - Never drop characters; never invent extra content
 *   - Preserve explicit newlines as line breaks
 */
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
