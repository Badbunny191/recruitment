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
  SignatureBlock,
  Size,
  Align,
} from "./types";
import type {
  PreviewModel,
  PreviewMeta,
  RenderedBlockSummary,
  PreviewMode,
  PreviewTokenInfo,
} from "./preview-model";
import {
  resolveDocumentTokens,
  applyDocumentTokens,
  DOCUMENT_TOKENS,
  type DocumentToken,
} from "./document-tokens";

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

/* ── Form control (Live Preview — render field เป็น control จริง) ─────────
   Preview แสดง document layout + form UX พร้อมกัน
   → field ต้องเป็น control จริงตาม field type (input/textarea/select/…)
   → ใช้ :read-only + pointer-events:none เพื่อกันไม่ให้ user แก้ค่า
      (preview เป็น read-only view เสมอ)
   ────────────────────────────────────────────────────────────────────── */
.dc-control {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 12pt;
  color: #000000;
  background: #fbfdff;
  border: 1px solid #c9d4de;
  border-radius: 3px;
  padding: 3px 6px;
  margin: 4px 0 0 12px;
  line-height: 1.4;
  pointer-events: none;
  -webkit-user-select: text;
  user-select: text;
}
.dc-control:focus {
  outline: none;
}
.dc-control[readonly] {
  background: #fbfdff;
}
textarea.dc-control {
  resize: none;
  white-space: pre-wrap;
  word-wrap: break-word;
}
select.dc-control {
  appearance: none;
  -webkit-appearance: none;
}

/* checkbox / radio — inline ไม่ใช่ full width */
.dc-control--inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: auto;
  margin: 4px 0 0 12px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font-size: 11pt;
}
.dc-control--inline input {
  pointer-events: none;
  margin: 0;
}

/* file — แสดงเป็นกล่อง placeholder แบบ read-only */
.dc-control--file {
  background: #f6f8fa;
  border-style: dashed;
  color: #55636f;
  font-size: 11pt;
}

/* required marker */
.dc-field__required {
  color: #c0392b;
}

/* disabled/unavailable state — field ที่ไม่มีข้อมูล */
.dc-control:disabled,
.dc-control--empty {
  color: #999999;
  background: #f7f8f9;
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

/* ── Signature ────────────────────────────────────────────── */
.dc-signature {
  font-size: 12pt;
  color: #000000;
  line-height: 1.4;
}
.dc-signature__line {
  display: inline-block;
  border-bottom: 1px solid #000000;
  min-width: 200px;
  height: 1em;
  vertical-align: baseline;
}
.dc-signature__name {
  margin-top: 4px;
}
.dc-signature__role {
  margin-top: 0;
}
.dc-signature__date,
.dc-signature__time {
  margin-top: 0;
}
.dc-signature__placeholder {
  color: #999999;
}

/* ── Page break hint (สำหรับ print emulation) ───────────── */
.dc-page-break {
  border-top: 1px dashed #cccccc;
  margin: 12px 0;
  text-align: center;
  font-size: 9pt;
  color: #999999;
}

/* ── Radio group wrapper ──────────────────────────────────── */
.dc-control-group {
  margin: 4px 0 0 12px;
}

/* ── Document info strip (Live Preview debug) ────────────────
   แสดงค่าจริงของ token (เลขที่ใบสมัคร/ตำแหน่ง) ที่ resolve ได้
   เพื่อให้ผู้ใช้ตรวจสอบได้ว่าข้อมูลมาจากแหล่งไหน
   ───────────────────────────────────────────────────────────── */
.dc-docinfo {
  margin-top: 28px;
  padding: 10px 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  background: #f8fafc;
  font-size: 10pt;
  color: #475569;
}
.dc-docinfo__title {
  font-weight: 700;
  margin-bottom: 6px;
  color: #334155;
}
.dc-docinfo__row {
  display: flex;
  gap: 8px;
  padding: 1px 0;
}
.dc-docinfo__label {
  min-width: 96px;
  color: #64748b;
}
.dc-docinfo__value {
  font-weight: 600;
  color: #0d4572;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/* token ที่ยังไม่มีข้อมูลจริง → สีเตือน + italic */
.dc-docinfo__value--empty {
  color: #9aa5b1;
  font-weight: 400;
  font-style: italic;
}

/* ── Document header (Logo placeholder + Title + Token strip) ──
   [Live Preview UX — Req 5, 6]
   - โลโก้: ยังไม่มี → placeholder สีเทา "ยังไม่มีโลโก้"
   - Token ที่ resolve ไม่ได้ → สีเทาอ่อน + italic
   - ใช้ class .dc-header-meta__value--empty บน token value ── */
.dc-doc-header {
  margin: 0 0 16px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid #cbd5e1;
}
.dc-doc-header__logo {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 8px;
  min-height: 56px;
}
.dc-doc-header__logo img {
  max-height: 56px;
  max-width: 120px;
  height: auto;
}
.dc-doc-header__logo-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 56px;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  color: #94a3b8;
  font-size: 11pt;
  background: #f8fafc;
  font-style: italic;
}
.dc-doc-header__title {
  font-size: 18pt;
  font-weight: 700;
  color: #0d4572;
  margin: 8px 0 12px 0;
  line-height: 1.3;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-header-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 11pt;
  color: #475569;
}
.dc-header-meta dt {
  font-weight: 600;
  color: #64748b;
}
.dc-header-meta dd {
  margin: 0;
  color: #0f172a;
  font-weight: 500;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-header-meta__value--empty {
  color: #9aa5b1 !important;
  font-weight: 400 !important;
  font-style: italic;
}

/* fullscreen modal: A4 aspect, scroll ภายใน, padding เหมือนหน้ากระดาษ */
@media print {
  /* browser default — ใช้ print เพื่อให้ Ctrl+P จาก modal ออกมาเป็น A4 */
  .dc-preview { box-shadow: none; margin: 0; padding: 0; max-width: none; }
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
 * @param options - render options
 * @param options.mode - โหมดการ render body fields:
 *                       - `form`     → body field เป็น form control จริง (default)
 *                       - `document` → body field เป็น label + value (เหมือน PDF)
 *                       UI consumer (PreviewModal) toggle ระหว่างสองโหมดได้
 *                       โดยเรียก renderer คนละ mode — token logic ชุดเดียวกัน
 * @param options.title - ชื่อเอกสารที่จะแสดงใน document header
 *                       (default: ใช้ descriptor.blocks ตัวแรกที่เป็น heading large
 *                        ถ้าไม่เจอ → "Document")
 * @param options.includeHeader - true (default) เพิ่ม document header block
 *                       (Logo placeholder + Title + Application No + Position Name/Number)
 *                       false เพื่อ render body อย่างเดียว (ใช้สำหรับ thumbnail ที่
 *                       header ทำให้ layout แน่นเกินไป)
 *                       ใน Preview UX: modal เปิด = true, thumbnail = false
 * @returns PreviewModel { html, body, header, meta, mode, tokens }
 *
 * Pure function:
 *   - ไม่อ่าน DB
 *   - ไม่เรียก network
 *   - ไม่ผูก state
 *   - input เดียวกัน → output เดียวกัน
 */
export interface RenderPreviewOptions {
  mode?: PreviewMode;
  title?: string;
  includeHeader?: boolean;
}

export function renderDescriptorToPreview(
  descriptor: DocumentDescriptor,
  ctx: ApplicationContext,
  options: RenderPreviewOptions = {}
): PreviewModel {
  const mode: PreviewMode = options.mode ?? "form";
  const includeHeader = options.includeHeader ?? true;
  // ── 1) Build field lookup index ────────────────────────────────
  // (pattern reuse จาก descriptor-renderer.ts:buildRenderPlan)
  const fieldIndex = new Map<string, FieldData>();
  for (const f of ctx.fields) {
    fieldIndex.set(f.fieldId, f);
  }

  // ── 1.1) Resolve document tokens (เลขที่ใบสมัคร / ตำแหน่ง) ─────────
  //  คำนวณครั้งเดียวต่อ render แล้วส่งต่อให้ทุก block
  //  ลำดับ: template field → system (round) → placeholder
  const tokens = resolveDocumentTokens(ctx);

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
      tokens,
      mode,
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

  // ── 3) Build document header (logo placeholder + title + token strip) ──
  // ใช้ร่วมกันทั้ง modal และ thumbnail — single source of truth
  // (consumer เลือกว่าจะ inject ลง html หรือไม่ผ่าน `includeHeader`)
  const title = options.title ?? resolveDescriptorTitle(descriptor);
  const header = includeHeader ? renderDocumentHeader(title, tokens) : "";

  // ── 4) Wrap with document shell ───────────────────────────────
  const html = wrapDocument(body, header, tokens);

  // ── 5) Diagnostics — ข้อมูล token ที่ resolve ได้ ────────────────
  const tokensInfo = buildTokenDiagnostics(tokens);

  return { html, body, header, meta, mode, tokens: tokensInfo };
}

/**
 * หา title ของ descriptor — ใช้ heading block ตัวแรกที่ size=large
 * ถ้าไม่มี → fallback เป็น "Document"
 *
 * `applyDocumentTokens` resolve token ใน heading text ก่อน → แล้วค่อย escape
 */
function resolveDescriptorTitle(descriptor: DocumentDescriptor): string {
  for (const block of descriptor.blocks) {
    if (block.type === "heading" && block.size === "large") {
      // ไม่อ่าน ApplicationContext ตรงนี้ — ใช้ placeholder tokens
      // (ดู preview-modal.css หรือ renderDocumentHeader สำหรับ full resolve)
      return block.text.trim() || "Document";
    }
  }
  return "Document";
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
  tokens: Record<DocumentToken, import("./document-tokens").TokenValue>;
  mode: PreviewMode;
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
  switch (block.type) {
    case "heading":
      return renderHeadingBlock(block, rctx.tokens);

    case "field": {
      const field = rctx.fieldIndex.get(block.fieldId);
      if (!field) {
        rctx.missingFieldIds.push(block.fieldId);
        return null;
      }
      return {
        html: renderFieldBlock(field, block, rctx.ctx, rctx.mode),
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
        html: renderTableBlock(field, block, rctx.ctx, rctx.mode),
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
        html: renderLogoBlock(block),
        summary: {
          blockId: block.id,
          type: "logo",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
        },
      };

    case "signature":
      return {
        html: renderSignatureBlock(block, rctx.ctx),
        summary: {
          blockId: block.id,
          type: "signature",
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
 *
 * [Live Preview] รองรับ document token ในข้อความ heading
 *   เช่น "ใบสมัครเลขที่ {APPLICATION_NO}" → "ใบสมัครเลขที่ 2026-CHM01-0001"
 *
 * Order สำคัญ: resolve token → escape HTML
 * (ถ้า escape ก่อน resolve ค่าจาก DB จะกลายเป็น entity แล้ว render เพี้ยน)
 */
function renderHeadingBlock(
  block: HeadingBlock,
  tokens: Record<DocumentToken, import("./document-tokens").TokenValue>
): RenderedBlock {
  const bold = block.bold ?? DEFAULT_HEADING_BOLD;
  const sizeClass = SIZE_TO_CLASS[block.size];
  const boldClass = bold ? " dc-heading--bold" : "";
  const pt = SIZE_TO_PT[block.size];
  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  // ── [Live Preview] resolve document token ก่อน → แล้วค่อย escape ──
  const safeText = escapeHtml(applyDocumentTokens(block.text, tokens));

  // ── FIX: inline align class + margin style เข้า attribute เดียวกัน ──
  // (เดิม styleAttrs มี class+style แยก → browser ignore attribute ที่ 2)
  const styleParts: string[] = [`font-size: ${pt}pt`];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const html = `<h2 class="dc-heading ${sizeClass}${boldClass} dc-block ${alignClass}" style="${styleParts.join("; ")}">${safeText}</h2>`;

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
 * mirror descriptor-renderer.ts:drawField ในส่วนข้อมูล (label + value)
 * แต่ [Live Preview] เปลี่ยน value ให้เป็น form control จริงตาม field.type
 *
 * เหตุผล: preview ต้องสะท้อนทั้ง document layout (หัว/ท้าย/จัดหน้า)
 * และ form UX (ผู้สมัครเจอช่องกรอกแบบไหน) → ต้องเป็น control จริง
 *
 * Safety:
 *   - ทุกค่าถูก escape ก่อนใส่ attribute (XSS)
 *   - control ทั้งหมดเป็น read-only ใช้ pointer-events:none
 *   - ไม่ inject event handler / script ใด ๆ
 */
function renderFieldBlock(
  field: FieldData,
  block: Extract<DocumentBlock, { type: "field" }>,
  ctx: ApplicationContext,
  mode: PreviewMode
): string {
  const rawValue = resolveAnswerValue(field, ctx);
  const label = block.label ?? field.label;
  const requiredMarker = field.isRequired ? " *" : "";

  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  const safeLabel = escapeHtml(`${label}${requiredMarker}`);

  // ── mode = "form"     → render เป็น form control จริง (input/textarea/…)
  //    mode = "document" → render เป็น label + value (เหมือน PDF)
  // ใช้ renderer function เดียวกัน (no token logic duplicated)
  const controlHtml =
    mode === "form"
      ? renderFormControl(field, rawValue)
      : renderDocumentValue(field, rawValue);

  const emptyClass = !isNonEmptyValue(rawValue) ? " dc-field--empty" : "";

  return `<section class="dc-field dc-block ${alignClass}${emptyClass}"${styleAttr}>
    <label class="dc-field__label">${safeLabel}</label>
    ${controlHtml}
  </section>`;
}

/**
 * Render field value เป็นข้อความ read-only (Document/PDF Preview mode)
 *
 * - ใกล้เคียง PDF: บรรทัด label แล้วตามด้วย value
 * - ค่าว่าง → "(ว่าง)" placeholder สีเทา
 * - MASTER_DATA / array → format เดียวกับ display
 * - ไม่ใช้ control HTML ใด ๆ
 */
function renderDocumentValue(field: FieldData, rawValue: unknown): string {
  if (!isNonEmptyValue(rawValue)) {
    return `<div class="dc-field__value dc-field__value--empty">(ว่าง)</div>`;
  }
  const display = formatAnswerValueForDisplay(rawValue);
  return `<div class="dc-field__value">${escapeHtml(display)}</div>`;
}

/**
 * Render form control ตาม field.type
 *
 * Mapping (mirror TemplatePreviewModal.tsx + apply/page.tsx):
 *   TEXT            → <input type="text">
 *   NUMBER          → <input type="number">
 *   DATE            → <input type="text"> (เก็บเป็น พ.ศ. ตาม sample data)
 *   TEXTAREA        → <textarea rows=N>
 *   DROPDOWN        → <select> + <option>
 *   RADIO           → radio group (label เป็น helpText/placeholder/label)
 *   CHECKBOX        → single checkbox (label เป็น helpText/placeholder/label)
 *   FILE            → read-only file placeholder box
 *   MASTER_DATA     → <select> แบบ searchable (options จาก field options)
 *
 * @param field - FieldData (มี type/options/overrideOptions/rows/helpText)
 * @param rawValue - ค่าจริงจาก formData (อาจเป็น string/number/bool/array/object/null)
 * @returns HTML string ของ control
 */
function renderFormControl(field: FieldData, rawValue: unknown): string {
  const hasValue = isNonEmptyValue(rawValue);

  switch (field.type) {
    case "NUMBER": {
      const v = hasValue ? escapeHtml(String(rawValue)) : "";
      return `<input class="dc-control" type="number" value="${v}" readonly />`;
    }

    case "TEXTAREA": {
      const rows = clampRows(field.rows);
      const v = hasValue ? escapeHtml(formatAnswerValueForDisplay(rawValue)) : "";
      return `<textarea class="dc-control" rows="${rows}" readonly>${v}</textarea>`;
    }

    case "DROPDOWN":
    case "MASTER_DATA": {
      const options = effectiveOptions(field);
      const current = hasValue
        ? escapeHtml(formatAnswerValueForDisplay(rawValue))
        : "";
      const placeholder = field.placeholder ?? "— เลือก —";

      const optionsHtml = options
        .map((o) => {
          const safeOpt = escapeHtml(o);
          // select ที่มีค่าเดียว → mark selected ให้เห็นค่าจริง
          const isSelected =
            current.length > 0 &&
            safeOpt.toLowerCase() === current.toLowerCase();
          return `<option value="${safeOpt}"${isSelected ? " selected" : ""}>${safeOpt}</option>`;
        })
        .join("");

      // ถ้าไม่มี options → ยังแสดงค่าที่ resolve ได้เป็น option เดียว
      const fallbackOption =
        optionsHtml.length === 0 && current.length > 0
          ? `<option value="${current}" selected>${current}</option>`
          : "";

      const head =
        current.length > 0 && !hasSelectedOption(options, current)
          ? `<option value="${current}" selected>${current}</option>`
          : `<option value="">${escapeHtml(placeholder)}</option>`;

      return `<select class="dc-control" disabled>${head}${optionsHtml}${fallbackOption}</select>`;
    }

    case "RADIO": {
      const options = effectiveOptions(field);
      if (options.length === 0) {
        return renderEmptyControl(field, "ไม่มีตัวเลือก");
      }
      const current = hasValue ? String(rawValue).trim() : "";
      const items = options
        .map((o) => {
          const safeOpt = escapeHtml(o);
          const checked =
            current.length > 0 &&
            safeOpt.toLowerCase() === current.toLowerCase();
          return `<label class="dc-control--inline"><input type="radio" disabled${checked ? " checked" : ""} /><span>${safeOpt}</span></label>`;
        })
        .join("");
      return `<div class="dc-control-group">${items}</div>`;
    }

    case "CHECKBOX": {
      const checked = rawValue === true || rawValue === "true";
      const caption = field.helpText ?? field.placeholder ?? field.label;
      return `<label class="dc-control--inline"><input type="checkbox" disabled${checked ? " checked" : ""} /><span>${escapeHtml(caption)}</span></label>`;
    }

    case "FILE": {
      const v = hasValue ? escapeHtml(formatAnswerValueForDisplay(rawValue)) : "— ยังไม่มีไฟล์ —";
      return `<div class="dc-control dc-control--file">📎 ${v}</div>`;
    }

    case "DATE": {
      // sample data เก็บเป็น "2566-01-15" (พ.ศ. text) → ไม่ใช่ ISO
      // จึงใช้ type="text" แทน type="date" เพื่อไม่ให้ browser ตีความผิด
      const v = hasValue ? escapeHtml(formatAnswerValueForDisplay(rawValue)) : "";
      return `<input class="dc-control" type="text" value="${v}" readonly placeholder="ว/ด/ป พ.ศ." />`;
    }

    case "TEXT":
    default: {
      const v = hasValue ? escapeHtml(formatAnswerValueForDisplay(rawValue)) : "";
      const placeholder = field.placeholder
        ? escapeHtml(field.placeholder)
        : "";
      return `<input class="dc-control" type="text" value="${v}" readonly placeholder="${placeholder}" />`;
    }
  }
}

/**
 * Placeholder เมื่อ field ไม่มี control ที่เหมาะสม (เช่น RADIO ที่ไม่มี options)
 */
function renderEmptyControl(field: FieldData, message: string): string {
  const placeholder = field.placeholder
    ? escapeHtml(field.placeholder)
    : escapeHtml(message);
  return `<input class="dc-control dc-control--empty" type="text" value="" readonly placeholder="${placeholder}" />`;
}

/**
 * ตัวเลือกที่ใช้ได้จริง — overrideOptions มีค่าใช้ override เสมอ (mirror TemplateBuilder)
 */
function effectiveOptions(field: FieldData): string[] {
  if (field.overrideOptions && field.overrideOptions.length > 0) {
    return field.overrideOptions;
  }
  return field.options ?? [];
}

/**
 * ตรวจว่า options มีค่าที่ตรงกับ current อยู่แล้วหรือไม่
 * (กัน render selected ซ้ำสอง option)
 */
function hasSelectedOption(
  options: string[],
  current: string
): boolean {
  const target = current.toLowerCase();
  return options.some((o) => o.toLowerCase() === target);
}

/**
 * Clamp rows ของ textarea ให้อยู่ในช่วงที่อ่านสบาย
 * (field.rows มาจาก template_fields.rows — อาจเป็น null/0/ใหญ่เกิน)
 */
function clampRows(rows: number | null): number {
  if (rows === null || !Number.isFinite(rows)) return 3;
  const n = Math.floor(rows);
  if (n < 1) return 1;
  if (n > 12) return 12;
  return n;
}

/**
 * ตรวจว่าค่ามีเนื้อหาจริงหรือไม่ (null/undefined/""/[]/{}/false = ว่าง)
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
  block: Extract<DocumentBlock, { type: "table" }>,
  ctx: ApplicationContext,
  mode: PreviewMode
): string {
  const rawValue = resolveAnswerValue(field, ctx);
  const tableData = parseTableData(rawValue);

  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  // ── FIX: inline margin เข้า style attribute เดียว (เดิม styleAttrs ทำให้เกิด double class+style) ──
  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // Table render เหมือนกันทั้งสอง mode (table เป็น read-only โดยธรรมชาติ
  // — ไม่ต้อง render เป็น control). Param `mode` เก็บไว้เพื่อ symmetry กับ
  // renderFieldBlock และให้ future ใช้ต่อได้
  void mode;

  if (tableData.length === 0) {
    return `<section class="dc-table-wrap dc-table--empty dc-block ${alignClass}"${styleAttr}>
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

  return `<section class="dc-table-wrap dc-block ${alignClass}"${styleAttr}>
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
function renderLogoBlock(block: Extract<DocumentBlock, { type: "logo" }>): string {
  const align = (block.align ?? DEFAULT_ALIGN) as Align;
  const alignClass = ALIGN_TO_CLASS[align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  // ── FIX: inline margin เข้า style attribute เดียว (เดิม styleAttrs ทำให้เกิด double class+style) ──
  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // ใช้ alt text อย่างเดียว — preview ไม่ฝัง asset
  // (production จะ inject <img src> จาก UI layer ในอนาคต)
  return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
    <img src="" alt="SAO Logo" />
  </section>`;
}

// =============================================================================
// Signature
// =============================================================================

/**
 * Default role label — mirror descriptor-renderer.ts
 */
const DEFAULT_SIGNATURE_ROLE = "ผู้สมัคร";

/**
 * Default visibility toggles — mirror descriptor-renderer.ts
 * - showName: true  (เปิด บรรทัด "(ชื่อผู้สมัคร)")
 * - showDate: true  (เปิด บรรทัด "วันที่ ...")
 * - showTime: false (ปิด บรรทัด "เวลา ..." — เอกสารราชการส่วนใหญ่ไม่แสดงเวลา)
 */
const DEFAULT_SHOW_NAME = true;
const DEFAULT_SHOW_DATE = true;
const DEFAULT_SHOW_TIME = false;

/**
 * Render SignatureBlock → HTML
 *
 * mirror descriptor-renderer.ts:drawSignature
 *   - "ลงลายมือชื่อ" + underscore line
 *   - "(ชื่อผู้สมัคร)" parenthetical (escape: actual name in fallback mode) — ถ้า showName
 *   - role label (default: "ผู้สมัคร")
 *   - "วันที่ DD MONTH พ.ศ." (Thai Buddhist year) — ถ้า showDate
 *   - "เวลา HH:mm น." — ถ้า showTime (default: ปิด)
 *
 * Fallback (เมื่อไม่มี application):
 *   - ชื่อ: "(ชื่อผู้สมัคร)"
 *   - วันที่/เวลา: "______________"
 *
 * ไม่ทำการ pagination ใน preview — ทั้ง block อยู่ใน DOM ปกติ
 */
function renderSignatureBlock(
  block: SignatureBlock,
  ctx: ApplicationContext
): string {
  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  const roleLabel = block.roleLabel ?? DEFAULT_SIGNATURE_ROLE;
  const showName = block.showName ?? DEFAULT_SHOW_NAME;
  const showDate = block.showDate ?? DEFAULT_SHOW_DATE;
  const showTime = block.showTime ?? DEFAULT_SHOW_TIME;

  // ── Resolve values from application context ───────────────────
  const signerName = (ctx.application.fullname ?? "").trim();
  const submittedAt = ctx.application.submittedAt;

  const hasName = signerName.length > 0;
  const hasTime = typeof submittedAt === "number" && submittedAt > 0;

  const displayName = hasName ? signerName : "(ชื่อผู้สมัคร)";
  const displayDate = hasTime
    ? formatThaiDate(submittedAt)
    : "______________";
  const displayTime = hasTime
    ? formatThaiTime(submittedAt)
    : "______________";

  const nameClass = hasName ? "" : " dc-signature__placeholder";

  // ── Build body lines based on visibility toggles ─────────────
  const bodyParts: string[] = [
    `<div>ลงลายมือชื่อ <span class="dc-signature__line">&nbsp;</span></div>`,
  ];
  if (showName) {
    bodyParts.push(
      `<div class="dc-signature__name${nameClass}">(${escapeHtml(displayName)})</div>`
    );
  }
  bodyParts.push(
    `<div class="dc-signature__role">${escapeHtml(roleLabel)}</div>`
  );
  if (showDate) {
    bodyParts.push(
      `<div class="dc-signature__date">วันที่ ${escapeHtml(displayDate)}</div>`
    );
  }
  if (showTime) {
    bodyParts.push(
      `<div class="dc-signature__time">เวลา ${escapeHtml(displayTime)}</div>`
    );
  }

  return `<section class="dc-signature dc-block ${alignClass}"${styleAttr}>
    ${bodyParts.join("\n    ")}
  </section>`;
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
 *       <div class="dc-preview">{header}{body}</div>
 *     </body>
 *   </html>
 *
 * Style อยู่ใน <style> tag เพื่อให้ preview render ได้ทันทีโดยไม่ต้องพึ่ง external CSS
 *
 * [Live Preview] body เดิมยังถูกส่งกลับแยก (PreviewModel.body) เพื่อให้
 * consumer ที่ต้องการ inline content ใช้ได้โดยไม่มี document shell
 * → shell นี้เป็นส่วนเสริม ไม่เปลี่ยนพฤติกรรมเดิม
 */
function wrapDocument(body: string, header: string, tokens: Record<DocumentToken, import("./document-tokens").TokenValue>): string {
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
${header}
${body}
${renderDocumentHeaderInfo(tokens)}
</div>
</body>
</html>`;
}

/**
 * Render document header block — Logo placeholder + Title + Application No + Position info
 *
 * [Live Preview UX — Req 5, 6]
 * - Logo: ถ้ามี URL จริงใช้ <img>, ไม่มี → placeholder สีเทาพร้อมข้อความ
 *   "ยังไม่มีโลโก้" (req ระบุชัดเจน — ไม่เงียบ ไม่ทำเป็นรูปว่าง)
 * - Title: ชื่อเอกสารจาก descriptor (heading large ตัวแรก)
 * - Application No: token ที่ resolve ได้ → ถ้าไม่ได้ → placeholder สีเทา
 * - Position Name / Number: เหมือนกัน
 * - Token ที่ resolve ไม่ได้ใช้ EMPTY_PLACEHOLDER + class .dc-token--empty
 *   (สีเทาอ่อน + italic) เพื่อให้ผู้ใช้รู้ทันทีว่ายังผูกไม่สมบูรณ์
 *
 * โครงสร้าง:
 *   <header class="dc-doc-header">
 *     <div class="dc-doc-header__logo">…</div>
 *     <h1 class="dc-doc-header__title">ชื่อเอกสาร</h1>
 *     <dl class="dc-doc-header__meta">
 *       <dt>เลขที่ใบสมัคร</dt><dd>{APPLICATION_NO}</dd>
 *       <dt>ตำแหน่ง</dt><dd>{POSITION_NAME}</dd>
 *       <dt>เลขตำแหน่ง</dt><dd>{POSITION_NUMBER}</dd>
 *     </dl>
 *   </header>
 */
function renderDocumentHeader(
  title: string,
  tokens: Record<DocumentToken, import("./document-tokens").TokenValue>
): string {
  const resolvedTitle = escapeHtml(applyDocumentTokens(title, tokens));

  const metaRows = [
    {
      label: "เลขที่ใบสมัคร",
      value: tokens.APPLICATION_NO,
    },
    {
      label: "ชื่อตำแหน่ง",
      value: tokens.POSITION_NAME,
    },
    {
      label: "เลขที่ตำแหน่ง",
      value: tokens.POSITION_NUMBER,
    },
  ]
    .map(({ label, value }) => {
      const emptyClass = value.empty ? " dc-header-meta__value--empty" : "";
      return `<dt>${escapeHtml(label)}</dt>
      <dd class="dc-header-meta__value${emptyClass}">${escapeHtml(value.text)}</dd>`;
    })
    .join("\n      ");

  return `<header class="dc-doc-header">
  <div class="dc-doc-header__logo">
    <span class="dc-doc-header__logo-placeholder">ยังไม่มีโลโก้</span>
  </div>
  <h1 class="dc-doc-header__title">${resolvedTitle}</h1>
  <dl class="dc-header-meta">
      ${metaRows}
  </dl>
</header>`;
}

/**
 * Build token diagnostics (สำหรับ FE consumer — UI ใช้แสดงแผง Diagnostics)
 */
function buildTokenDiagnostics(
  tokens: Record<DocumentToken, import("./document-tokens").TokenValue>
): PreviewTokenInfo[] {
  const LABELS: Record<DocumentToken, string> = {
    APPLICATION_NO: "เลขที่ใบสมัคร",
    POSITION_NUMBER: "เลขที่ตำแหน่ง",
    POSITION_NAME: "ชื่อตำแหน่ง",
    POSITION_LEVEL: "ระดับตำแหน่ง",
    ROUND_CODE: "รหัสรอบ",
  };
  const out: PreviewTokenInfo[] = [];
  for (const token of DOCUMENT_TOKENS) {
    out.push({
      token,
      label: LABELS[token],
      text: tokens[token].text,
      empty: tokens[token].empty,
    });
  }
  return out;
}

/**
 * [Live Preview] แถบข้อมูลหัวเอกสาร (position + application number)
 *
 * วัตถุประสงค์: ให้ผู้ใช้เห็นว่าเอกสารนี้จะแสดง "เลขที่ใบสมัคร" และ
 * "ข้อมูลตำแหน่ง" ด้วยค่าอะไร — ไม่ใช่ placeholder
 *
 * - แสดงเฉพาะ token ที่ resolve ได้จริง (empty = false)
 * - token ที่ยังไม่มีข้อมูลจะแสดง placeholder เพื่อให้รู้ว่า"ยังไม่ได้ผูก"
 * - เป็น debug strip ไม่ใช่ส่วนหนึ่งของเอกสาร → จัดวางท้ายสุด
 */
function renderDocumentHeaderInfo(
  tokens: Record<DocumentToken, import("./document-tokens").TokenValue>
): string {
  const LABELS: Array<{
    token: DocumentToken;
    label: string;
  }> = [
    { token: "APPLICATION_NO", label: "เลขที่ใบสมัคร" },
    { token: "POSITION_NUMBER", label: "เลขที่ตำแหน่ง" },
    { token: "POSITION_NAME", label: "ชื่อตำแหน่ง" },
    { token: "POSITION_LEVEL", label: "ระดับตำแหน่ง" },
    { token: "ROUND_CODE", label: "รหัสรอบ" },
  ];

  const rows = LABELS.map(({ token, label }) => {
    const value = tokens[token];
    const valueText = escapeHtml(value.text);
    const valueClass = value.empty ? "dc-docinfo__value dc-docinfo__value--empty" : "dc-docinfo__value";
    return `      <div class="dc-docinfo__row">
        <span class="dc-docinfo__label">${escapeHtml(label)}</span>
        <span class="${valueClass}">${valueText}</span>
      </div>`;
  }).join("\n");

  return `
<!-- ── Document info strip (Live Preview debug, ไม่อยู่ใน PDF) ── -->
<aside class="dc-docinfo" aria-label="ข้อมูลเอกสารสำหรับ Preview">
  <div class="dc-docinfo__title">ข้อมูลเอกสาร (ตัวอย่างจาก Template/Round)</div>
${rows}
</aside>`;
}

// =============================================================================
// Helpers (mirror descriptor-renderer.ts semantics)
// =============================================================================

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

// =============================================================================
// Thai date/time formatting (mirror descriptor-renderer.ts semantics)
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
 * Format unix timestamp → HH:mm เวลา
 * Example: 13:37
 */
function formatThaiTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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
