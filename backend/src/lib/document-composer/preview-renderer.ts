/**
 * Document Composer V1 — HTML Preview Renderer
 *
 * Pure function:
 *   ApplicationContext + DocumentDescriptor → PreviewModel (HTML)
 *
 * Design Goals:
 *   - ใช้ DocumentDescriptor ตัวเดียวกับ PDF Renderer (single source of truth)
 *   - ใช้ Layout Rules เดิม (align, size, bold, marginTop, marginBottom)
 *   - เป็น Pure Function — ไม่มี side effect, ไม่อ่าน DB, ไม่เรียก API
 *   - ไม่แตะ PDF Renderer (descriptor-renderer.ts)
 *   - ไม่แตะ Database / Migration / Route / UI Page
 *
 * Reuse strategy:
 *   - ใช้ descriptor-validation.ts logic pattern (validate ก่อน render)
 *   - ใช้ field lookup pattern เดียวกับ descriptor-renderer (Map index)
 *   - ใช้ value resolution pattern เดียวกับ PDF renderer
 *     (formData[fieldId] ?? formData[pdfMappingKey])
 *   - ใช้ size/bold/align/margin mapping เดียวกับ PDF renderer
 *
 * Output:
 *   - HTML Preview Model (semantic HTML + class-based styling)
 *   - ไม่ผูกกับ HTML framework ใดๆ (Next.js, React, Vue)
 *   - consumer (UI/Route) เป็นคนเลือกว่าจะ render ลงที่ไหน
 */

import type { ApplicationContext, FieldData } from "../pdf-types";
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  Size,
  Align,
} from "./types";
import type { PreviewModel, PreviewMeta, RenderedBlockSummary } from "./preview-model";

// =============================================================================
// Style mapping — mirror descriptor-renderer.ts (visual consistency)
// =============================================================================

/**
 * Map heading size → CSS font size (pt)
 *
 * ใช้ class แทน inline style เพื่อให้ consumer ปรับ theme ได้
 * ตัวเลขตรงกับ descriptor-renderer.ts:
 *   - large  → 16pt
 *   - medium → 13pt
 *   - small  → 11pt
 */
const SIZE_TO_PT: Record<Size, number> = {
  large: 16,
  medium: 13,
  small: 11,
};

const SIZE_TO_CLASS: Record<Size, string> = {
  large: "dc-heading--large",
  medium: "dc-heading--medium",
  small: "dc-heading--small",
};

const ALIGN_TO_CLASS: Record<Align, string> = {
  left: "dc-align--left",
  center: "dc-align--center",
  right: "dc-align--right",
};

/**
 * Default align — mirror descriptor-renderer.ts
 */
const DEFAULT_ALIGN: Align = "left";

/**
 * Default bold — mirror descriptor-renderer.ts (heading default = true)
 */
const DEFAULT_HEADING_BOLD = true;

// =============================================================================
// CSS block — emitted เป็น <style> tag ใน HTML output
//
// ค่าเหล่านี้ตรงกับ PDF constants เพื่อให้ visual ระหว่าง PDF กับ Preview ใกล้กัน
// =============================================================================

const PREVIEW_STYLES = `
.dc-preview {
  font-family: "Sarabun", "Tahoma", sans-serif;
  color: #0d4572;
  max-width: 515px;
  margin: 0 auto;
  padding: 40px;
  background: #ffffff;
  box-sizing: border-box;
  line-height: 1.4;
}

.dc-block {
  margin: 0;
  padding: 0;
}

.dc-block[data-margin-top] {
  margin-top: 0;
}

/* ── Alignment ─────────────────────────────────────────────── */
.dc-align--left   { text-align: left; }
.dc-align--center { text-align: center; }
.dc-align--right  { text-align: right; }

/* ── Heading ───────────────────────────────────────────────── */
.dc-heading {
  font-weight: 600;
  color: #0d4572;
  margin: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-heading--large  { font-size: 16pt; line-height: 1.4; }
.dc-heading--medium { font-size: 13pt; line-height: 1.4; }
.dc-heading--small  { font-size: 11pt; line-height: 1.4; }
.dc-heading--bold   { font-weight: 700; }

/* ── Field (Label + Value) ────────────────────────────────── */
.dc-field {
  margin: 0;
}
.dc-field__label {
  font-size: 11pt;
  color: #666666;
  font-weight: 700;
  margin: 0 0 0 0;
  line-height: 1.4;
}
.dc-field__value {
  font-size: 12pt;
  color: #000000;
  margin: 4px 0 0 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-field--empty .dc-field__value {
  color: #999999;
}

/* ── Table ─────────────────────────────────────────────────── */
.dc-table-wrap {
  width: 100%;
  overflow-x: auto;
}
.dc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11pt;
  color: #000000;
  table-layout: fixed;
}
.dc-table th,
.dc-table td {
  padding: 4px 6px;
  border: 0.5px solid #666666;
  text-align: left;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-table th {
  background: #ebebeb;
  font-weight: 700;
  border-color: #666666;
}
.dc-table td {
  border-right-color: #d9d9d9;
}
.dc-table td:last-child,
.dc-table th:last-child {
  border-right-color: #666666;
}
.dc-table--empty {
  color: #999999;
  font-style: italic;
}

/* ── Logo ─────────────────────────────────────────────────── */
.dc-logo img {
  display: block;
  width: 70px;
  height: auto;
}

/* ── Page break hint (สำหรับ print emulation) ───────────── */
.dc-page-break {
  border-top: 1px dashed #cccccc;
  margin: 12px 0;
  text-align: center;
  font-size: 9pt;
  color: #999999;
}
`;

// =============================================================================
// Public API
// =============================================================================

/**
 * Pure renderer: DocumentDescriptor + ApplicationContext → HTML Preview
 *
 * @param descriptor - DocumentDescriptor (validated input)
 * @param ctx - ApplicationContext (data ที่ใช้ resolve field values)
 * @returns PreviewModel { html, body, meta }
 *
 * Pure function:
 *   - ไม่อ่าน DB
 *   - ไม่เรียก network
 *   - ไม่ผูก state
 *   - input เดียวกัน → output เดียวกัน
 */
export function renderDescriptorToPreview(
  descriptor: DocumentDescriptor,
  ctx: ApplicationContext
): PreviewModel {
  // ── 1) Build field lookup index ────────────────────────────────
  // (pattern reuse จาก descriptor-renderer.ts:buildRenderPlan)
  const fieldIndex = new Map<string, FieldData>();
  for (const f of ctx.fields) {
    fieldIndex.set(f.fieldId, f);
  }

  // ── 2) Render blocks ──────────────────────────────────────────
  const bodyParts: string[] = [];
  const renderedBlocks: RenderedBlockSummary[] = [];
  let fieldRefCount = 0;
  const missingFieldIds: string[] = [];

  for (const block of descriptor.blocks) {
    const marginTop = block.marginTop ?? 0;
    const marginBottom = block.marginBottom ?? 0;
    const align = block.align ?? DEFAULT_ALIGN;

    const rendered = renderBlock(block, {
      fieldIndex,
      align,
      marginTop,
      marginBottom,
      ctx,
      missingFieldIds,
    });

    if (rendered !== null) {
      bodyParts.push(rendered.html);
      renderedBlocks.push(rendered.summary);
      if (
        block.type === "field" ||
        block.type === "table"
      ) {
        fieldRefCount += 1;
      }
    } else {
      // Block filtered out (เช่น missing field)
      renderedBlocks.push({
        blockId: block.id,
        type: block.type,
        align,
        marginTop,
        marginBottom,
        fieldStatus: "missing",
      });
    }
  }

  const body = bodyParts.join("");
  const meta: PreviewMeta = {
    blockCount: descriptor.blocks.length,
    fieldRefCount,
    missingFieldIds: Array.from(new Set(missingFieldIds)),
    renderedBlocks,
  };

  // ── 3) Wrap with document shell ───────────────────────────────
  const html = wrapDocument(body);

  return { html, body, meta };
}

// =============================================================================
// Block rendering
// =============================================================================

interface RenderBlockContext {
  fieldIndex: Map<string, FieldData>;
  align: Align;
  marginTop: number;
  marginBottom: number;
  ctx: ApplicationContext;
  missingFieldIds: string[];
}

interface RenderedBlock {
  html: string;
  summary: RenderedBlockSummary;
}

/**
 * Render a single block → HTML string + summary
 *
 * คืน null ถ้า block ต้องถูก skip (เช่น field block ที่ resolve ไม่เจอ)
 */
function renderBlock(
  block: DocumentBlock,
  rctx: RenderBlockContext
): RenderedBlock | null {
  const commonStyle = buildBlockStyleAttrs(
    rctx.align,
    rctx.marginTop,
    rctx.marginBottom
  );

  switch (block.type) {
    case "heading":
      return renderHeadingBlock(block, commonStyle);

    case "field": {
      const field = rctx.fieldIndex.get(block.fieldId);
      if (!field) {
        rctx.missingFieldIds.push(block.fieldId);
        return null;
      }
      return {
        html: renderFieldBlock(field, block, commonStyle, rctx.ctx),
        summary: {
          blockId: block.id,
          type: "field",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
          fieldStatus: "resolved",
        },
      };
    }

    case "table": {
      const field = rctx.fieldIndex.get(block.fieldId);
      if (!field) {
        rctx.missingFieldIds.push(block.fieldId);
        return null;
      }
      return {
        html: renderTableBlock(field, commonStyle, rctx.ctx),
        summary: {
          blockId: block.id,
          type: "table",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
          fieldStatus: "resolved",
        },
      };
    }

    case "logo":
      return {
        html: renderLogoBlock(commonStyle),
        summary: {
          blockId: block.id,
          type: "logo",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
        },
      };
  }
}

// =============================================================================
// Heading
// =============================================================================

/**
 * Render HeadingBlock → HTML
 *
 * mirror descriptor-renderer.ts:drawHeading
 *   - heading size (large/medium/small) + bold
 *   - align (left/center/right)
 *   - COLOR_PRIMARY = rgb(0.05, 0.27, 0.51) → #0d4572
 */
function renderHeadingBlock(
  block: HeadingBlock,
  styleAttrs: string
): RenderedBlock {
  const bold = block.bold ?? DEFAULT_HEADING_BOLD;
  const sizeClass = SIZE_TO_CLASS[block.size];
  const boldClass = bold ? " dc-heading--bold" : "";
  const pt = SIZE_TO_PT[block.size];

  // Escape HTML — heading text อาจมีอักขระพิเศษ
  const safeText = escapeHtml(block.text);

  const html = `<h2 class="dc-heading ${sizeClass}${boldClass}" style="font-size: ${pt}pt"${styleAttrs}>${safeText}</h2>`;

  return {
    html,
    summary: {
      blockId: block.id,
      type: "heading",
      align: (block.align ?? DEFAULT_ALIGN) as Align,
      marginTop: block.marginTop ?? 0,
      marginBottom: block.marginBottom ?? 0,
    },
  };
}

// =============================================================================
// Field
// =============================================================================

/**
 * Render FieldBlock → HTML
 *
 * mirror descriptor-renderer.ts:drawField
 *   - label (gray, bold)
 *   - "*" marker ถ้า required
 *   - value (body, indent 12px)
 *   - "-" placeholder ถ้า value ว่าง (PDF pattern reuse)
 */
function renderFieldBlock(
  field: FieldData,
  block: Extract<DocumentBlock, { type: "field" }>,
  styleAttrs: string,
  ctx: ApplicationContext
): string {
  const rawValue = resolveAnswerValue(field, ctx);
  const displayValue = formatAnswerValueForDisplay(rawValue);
  const label = block.label ?? field.label;
  const requiredMarker = field.isRequired ? " *" : "";

  const isEmpty = displayValue === "-";
  const emptyClass = isEmpty ? " dc-field--empty" : "";

  const safeLabel = escapeHtml(`${label}${requiredMarker}`);
  const safeValue = escapeHtml(displayValue);

  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];

  return `<section class="dc-field${emptyClass} ${alignClass}"${styleAttrs}>
    <div class="dc-field__label">${safeLabel}</div>
    <div class="dc-field__value">${safeValue}</div>
  </section>`;
}

// =============================================================================
// Table
// =============================================================================

/**
 * Render TableBlock → HTML
 *
 * mirror descriptor-renderer.ts:drawTable
 *   - data จาก formData[fieldId] (parse JSON/Array/Object)
 *   - columns จาก first row keys (insertion order)
 *   - table width = CONTENT_WIDTH เต็ม
 *   - empty → "(ไม่มีข้อมูล)" placeholder
 *   - align ของ block มีผลกับ table position
 *
 * Note: HTML table ไม่ต้อง pagination → preview แสดงทั้งหมดในหน้าเดียว
 */
function renderTableBlock(
  field: FieldData,
  styleAttrs: string,
  ctx: ApplicationContext
): string {
  const rawValue = resolveAnswerValue(field, ctx);
  const tableData = parseTableData(rawValue);

  if (tableData.length === 0) {
    const alignClass = ALIGN_TO_CLASS["left" as Align];
    return `<section class="dc-table-wrap dc-table--empty ${alignClass}"${styleAttrs}>
      <div class="dc-field__value">(ไม่มีข้อมูล)</div>
    </section>`;
  }

  const headers = Object.keys(tableData[0]);
  const rowsHtml = tableData
    .map((row) => {
      const cells = headers
        .map((key) => {
          const cellValue = formatCellValue(row[key]);
          return `<td>${escapeHtml(cellValue)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const headerHtml = headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");

  return `<section class="dc-table-wrap"${styleAttrs}>
    <table class="dc-table">
      <thead>
        <tr>${headerHtml}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </section>`;
}

// =============================================================================
// Logo
// =============================================================================

/**
 * Render LogoBlock → HTML
 *
 * V1: SAO logo placeholder (ใช้ data URI หรือ alt text)
 * - preview ใช้ alt text เพราะไม่ load asset จริง (ไม่ผูกกับ file path)
 * - width = 70px (mirror descriptor-renderer.ts:drawLogo)
 */
function renderLogoBlock(styleAttrs: string): string {
  const align = (extractAlignFromAttrs(styleAttrs) ?? DEFAULT_ALIGN) as Align;
  const alignClass = ALIGN_TO_CLASS[align];

  // ใช้ alt text อย่างเดียว — preview ไม่ฝัง asset
  // (production จะ inject <img src> จาก UI layer ในอนาคต)
  return `<section class="dc-block dc-logo ${alignClass}"${styleAttrs}>
    <img src="" alt="SAO Logo" />
  </section>`;
}

/**
 * Extract align จาก styleAttrs string
 *
 * styleAttrs มี class="dc-block dc-align--{align}" → ดึง dc-align--{align} ออกมา
 */
function extractAlignFromAttrs(styleAttrs: string): Align | null {
  const match = styleAttrs.match(/dc-align--(left|center|right)/);
  return match ? (match[1] as Align) : null;
}

// =============================================================================
// Document wrapper
// =============================================================================

/**
 * Wrap body content ใน full HTML document
 *
 * Shell structure:
 *   <html>
 *     <head>
 *       <meta charset>
 *       <style>...</style>
 *     </head>
 *     <body>
 *       <div class="dc-preview">{body}</div>
 *     </body>
 *   </html>
 *
 * Style อยู่ใน <style> tag เพื่อให้ preview render ได้ทันทีโดยไม่ต้องพึ่ง external CSS
 */
function wrapDocument(body: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Document Preview</title>
<style>${PREVIEW_STYLES}</style>
</head>
<body>
<div class="dc-preview">
${body}
</div>
</body>
</html>`;
}

// =============================================================================
// Helpers (mirror descriptor-renderer.ts semantics)
// =============================================================================

/**
 * Build block style attrs:
 *   - class="dc-block dc-align--{align}"
 *   - inline style="margin-top: ...; margin-bottom: ..." (เฉพาะ margin > 0)
 *
 * class ใช้สำหรับ general styling
 * inline style ใช้สำหรับ spacing เพราะ margin เป็น per-block ไม่สามารถใช้ class ได้
 *   โดยไม่ต้องสร้าง class ใหม่ทุกครั้ง
 */
function buildBlockStyleAttrs(
  align: Align,
  marginTop: number,
  marginBottom: number
): string {
  const alignClass = ALIGN_TO_CLASS[align];
  const classAttr = `class="dc-block ${alignClass}"`;

  const styleParts: string[] = [];
  if (marginTop > 0) {
    styleParts.push(`margin-top: ${marginTop}pt`);
  }
  if (marginBottom > 0) {
    styleParts.push(`margin-bottom: ${marginBottom}pt`);
  }

  if (styleParts.length === 0) {
    return ` ${classAttr}`;
  }

  return ` ${classAttr} style="${styleParts.join("; ")}"`;
}

/**
 * Resolve field value จาก ApplicationContext
 *
 * mirror descriptor-renderer.ts:resolveAnswerValue
 *   - formData[fieldId]
 *   - fallback: formData[pdfMappingKey]
 *   - fallback: null
 */
function resolveAnswerValue(
  field: FieldData,
  ctx: ApplicationContext
): unknown {
  const formData = (ctx.application.formData ?? {}) as Record<string, unknown>;
  return (
    formData[field.fieldId] ??
    formData[field.pdfMappingKey ?? ""] ??
    null
  );
}

/**
 * Format value สำหรับ preview
 *
 * mirror descriptor-renderer.ts:formatAnswerValueForDisplay
 */
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

/**
 * Parse raw value → table data
 *
 * mirror descriptor-renderer.ts:parseTableData
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

/**
 * Format value สำหรับ table cell
 *
 * mirror descriptor-renderer.ts:formatCellValue
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Escape HTML special characters
 *
 * ป้องกัน XSS เมื่อ render ค่าที่มาจาก field value
 * - & → &amp;
 * - < → &lt;
 * - > → &gt;
 * - " → &quot;
 * - ' → &#39;
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
