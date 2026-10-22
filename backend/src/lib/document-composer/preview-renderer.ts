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
  SystemDataBlock,
  LogoBlock,
  DateFormat,
  Size,
  Align,
} from "./types";
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
  PreviewModel,
  PreviewMeta,
  RenderedBlockSummary,
  PreviewMode,
  PreviewTokenInfo,
  TokenSource,
} from "./preview-model";
import {
  resolveDocumentTokens,
  applyDocumentTokens,
  applyDocumentTokensWithFields,
  resolveFieldValue,
  DOCUMENT_TOKENS,
  DOCUMENT_TOKEN_LABELS,
  INSERTABLE_DOCUMENT_TOKENS,
  collectUsedTokens,
  type DocumentToken,
  type TokenValue,
} from "./document-tokens";
import { getObjectDisplayLabel } from "./field-capabilities";
import { resolvePageGeometry } from "./page-settings";

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
/* italic (Requirement A — ตัวเอียง) */
.dc-heading--italic { font-style: italic; }

/* ── Multiline heading (Requirement A.2 — ข้อความหลายบรรทัด) ─────────
   Admin พิมพ์ \n ใน textarea → แต่ละบรรทัดกลายเป็น <div> หนึ่งบรรทัด
   เพื่อให้ line-height ตรงกับ PDF renderer (ซึ่งวาดทีละบรรทัด)
   ────────────────────────────────────────────────────────────────────── */
.dc-heading__line {
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* ── Token placeholder ในเนื้อหา (Requirement I.9) ───────────────────
   token ที่ resolve ไม่ได้ → สีเทา + หรือ + ยังไม่มีข้อมูล
   ────────────────────────────────────────────────────────────────────── */
.dc-token--empty {
  color: #9aa5b1;
  font-style: italic;
}

/* ── System Data Block (Requirement B) ──────────────────────────── */
.dc-systemdata__label {
  color: #666666;
  font-weight: 700;
}
.dc-systemdata__value {
  color: #000000;
  font-weight: 600;
}
/* stacked: indent 12px เฉพาะเมื่อ align=left
   center/right → ไม่ indent เพื่อให้ text-align ทำงานถูกต้อง */
.dc-systemdata--stacked.dc-align--left .dc-systemdata__value {
  padding-left: 12px;
}
.dc-systemdata--stacked .dc-systemdata__value {
  margin-top: 2px;
}
.dc-systemdata--inline .dc-systemdata__label {
  margin-right: 8px;
}
/* inline: label กับ value อยู่บรรทัดเดียวกัน */
.dc-systemdata--inline .dc-systemdata__body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
  width: 100%;
  box-sizing: border-box;
}
/* inline alignment — justify-content จัดตำแหน่ง flex children ตาม block.align */
.dc-systemdata--inline.dc-align--left .dc-systemdata__body {
  justify-content: flex-start;
}
.dc-systemdata--inline.dc-align--center .dc-systemdata__body {
  justify-content: center;
}
.dc-systemdata--inline.dc-align--right .dc-systemdata__body {
  justify-content: flex-end;
}
.dc-systemdata--empty .dc-systemdata__value {
  color: #9aa5b1;
  font-weight: 400;
  font-style: italic;
}

/* ── Field (Label + Value) ────────────────────────────────── */
.dc-field {
  margin: 0;
}
/* layout = inline → label + value บรรทัดเดียวกัน (Requirement E) */
.dc-field--inline .dc-field__body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
  width: 100%;
  box-sizing: border-box;
}
/* inline alignment — justify-content จัดตำแหน่ง flex children ตาม block.align */
.dc-field--inline.dc-align--left .dc-field__body {
  justify-content: flex-start;
}
.dc-field--inline.dc-align--center .dc-field__body {
  justify-content: center;
}
.dc-field--inline.dc-align--right .dc-field__body {
  justify-content: flex-end;
}
.dc-field--inline .dc-field__value,
.dc-field--inline .dc-control {
  margin-top: 0;
  padding-left: 0;
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
/* width/height มาจาก block (Requirement D) — inline style ถูกเขียนทับ */
.dc-logo img {
  display: block;
  width: 70px;
  height: auto;
}
/* ไม่มีโลโก้ → ข้อความสีเทา (ห้ามแสดงกรอบรูปว่าง — Requirement D) */
.dc-logo__placeholder {
  display: inline-block;
  color: #9aa5b1;
  font-size: 10pt;
  font-style: italic;
  line-height: 1.4;
}

/* ── Signature ────────────────────────────────────────────── */
.dc-signature {
  font-size: 12pt;
  color: #000000;
  line-height: 1.4;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* เส้นลายเซ็นแบบข้อความ (lineStyle) — default = จุด 40 ตัว */
.dc-signature__line-text {
  display: inline-block;
  white-space: pre;
  letter-spacing: 0;
}
/* เส้นลายเซ็นแบบเส้น (fallback เมื่อไม่ได้ใส่ lineStyle) */
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

/* ── Page break separator (Continuous Preview) ────────────────
   HTML Preview เป็น continuous → ไม่แบ่งหน้า A4 ในเบราว์เซอร์
   แสดงเป็น separator ประกอบเท่านั้น
   จุดแบ่งหน้าจริง = PDF Preview (source of truth)
   ───────────────────────────────────────────────────────────── */
.dc-page-break {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
  color: #64748b;
  font-size: 10pt;
  user-select: none;
}
.dc-page-break::before,
.dc-page-break::after {
  content: "";
  flex: 1;
  border-top: 1px dashed #cbd5e1;
}
.dc-page-break__label {
  flex: none;
  white-space: nowrap;
  padding: 2px 10px;
  border: 1px dashed #cbd5e1;
  border-radius: 999px;
  background: #f8fafc;
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
  const header = includeHeader ? renderDocumentHeader(title, tokens, descriptor) : "";

  // ── 4) Wrap with document shell ───────────────────────────────
  const html = wrapDocument(body, header, tokens);

  // ── 5) Diagnostics — ข้อมูล token ที่ใช้จริง + source metadata ────
  // Requirement E: filter to only tokens used in descriptor
  // Requirement F: include source metadata (application/round/system/sample)
  // isRealApplication: true when using real application data (not sample)
  // id starts with "preview-" when using sample context
  const isRealApplication = !!(ctx.application.id && !String(ctx.application.id).startsWith("preview-"));
  const tokensInfo = buildTokenDiagnostics(tokens, descriptor, ctx, isRealApplication);

  // ── 5.1) Page geometry (ขอบกระดาษ) ─────────────────────────────────
  //  มีผลกับ Preview เท่านั้น — PDF Renderer ยังไม่รองรับ (รอก้อนถัดไป)
  //  descriptor เก่าที่ไม่มี pageSettings → fallback 40pt ทุกด้าน
  const page = resolvePageGeometry(descriptor.pageSettings);

  return { html, body, header, styles: PREVIEW_STYLES, meta, mode, tokens: tokensInfo, page };
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
      // เอาเฉพาะบรรทัดแรก (title ของ document header ไม่ควรหลายบรรทัด)
      return block.text.split(/\r?\n/)[0]?.trim() || "Document";
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
  tokens: Record<DocumentToken, TokenValue>;
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
      return renderHeadingBlock(block, rctx.ctx, rctx.tokens);

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

    case "systemData":
      return {
        html: renderSystemDataBlock(block, rctx.tokens),
        summary: {
          blockId: block.id,
          type: "systemData",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
        },
      };

    case "signature":
      return {
        html: renderSignatureBlock(block, rctx.ctx, rctx.tokens),
        summary: {
          blockId: block.id,
          type: "signature",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
        },
      };

    case "pageBreak":
      return {
        html: PAGE_BREAK_HTML,
        summary: {
          blockId: block.id,
          type: "pageBreak",
          align: rctx.align,
          marginTop: rctx.marginTop,
          marginBottom: rctx.marginBottom,
        },
      };
  }
}

/**
 * Page Break separator (HTML Preview แบบ continuous)
 *
 * ⚠️ Preview นี้เป็น "continuous" — ไม่พยายามแบ่งหน้า A4 ในเบราว์เซอร์
 *    จึงแสดงเป็น separator ประกอบเท่านั้น
 *    จุดแบ่งหน้าจริงดูได้จาก PDF Preview (source of truth)
 */
const PAGE_BREAK_HTML =
  '<div class="dc-page-break" data-dc-page-break="1" style="page-break-after: always; break-after: page;">' +
  '<span class="dc-page-break__label">📄 หน้าใหม่</span>' +
  "</div>";

// =============================================================================
// Heading / Text Block
// =============================================================================

/**
 * Render HeadingBlock → HTML
 *
 * mirror descriptor-renderer.ts:drawHeading
 *   - heading size (large/medium/small) + bold + italic
 *   - align (left/center/right)
 *   - COLOR_PRIMARY = rgb(0.05, 0.27, 0.51) → #0d4572
 *
 * [Live Preview] รองรับทั้ง System Token และ Application Field token:
 *   "ใบสมัครรอบ {ROUND_NAME}\nเลขที่ใบสมัคร {APPLICATION_NO}\nชื่อ {FIELD:abc123}"
 *
 * Order สำคัญ: resolve token → escape HTML
 * (ถ้า escape ก่อน resolve ค่าจาก DB จะกลายเป็น entity แล้ว render เพี้ยน)
 */
function renderHeadingBlock(
  block: HeadingBlock,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>
): RenderedBlock {
  const bold = block.bold ?? DEFAULT_HEADING_BOLD;
  const sizeClass = SIZE_TO_CLASS[block.size];
  const boldClass = bold ? " dc-heading--bold" : "";
  const italicClass = block.italic ? " dc-heading--italic" : "";
  const pt = SIZE_TO_PT[block.size];
  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  // ── [Live Preview] resolve token (system + field) ก่อน → แล้วค่อย escape ──
  // ใช้ entry point เดียวกับ PDF renderer (applyDocumentTokensWithFields)
  // → ไม่มี token resolver ซ้ำ (Requirement I.6)
  const resolved = applyDocumentTokensWithFields(block.text, ctx, tokens);

  // ── Multiline: แต่ละบรรทัดแยกเป็น <div class="dc-heading__line">
  // (Requirement A.2) — ทำให้ line-height ตรงกับ PDF ที่วาดทีละบรรทัด
  const linesHtml = resolved.text
    .split(/\r?\n/)
    .map((line) => `<div class="dc-heading__line">${renderTokensWithPlaceholders(line, tokens)}</div>`)
    .join("");

  // ── FIX: inline align class + margin style เข้า attribute เดียวกัน ──
  // (เดิม styleAttrs มี class+style แยก → browser ignore attribute ที่ 2)
  const styleParts: string[] = [`font-size: ${pt}pt`];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const html = `<h2 class="dc-heading ${sizeClass}${boldClass}${italicClass} dc-block ${alignClass}" style="${styleParts.join("; ")}">${linesHtml}</h2>`;

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

/**
 * Escape ข้อความ แล้วครอบ token ที่ยังไม่มีข้อมูลด้วย span สีเทา
 *
 * Requirement I.9 — Placeholder ต้องมี style สีเทาและเห็นชัด
 * Requirement K.6 — token ที่ไม่รู้จักต้องแสดงเป็นข้อความอย่างปลอดภัย
 *
 * @param text - ข้อความที่ resolve token แล้ว (ยังไม่ escape)
 * @param tokens - token map (ใช้ตรวจว่าตัวไหนยังเป็น placeholder)
 *
 * หมายเหตุ: ข้อความถูก escape ก่อนเสมอ → ไม่มีทางเกิด script injection
 * แม้ Admin จะพิมพ์ HTML ลงไปใน block นี้ (Requirement K.2/K.3)
 */
function renderTokensWithPlaceholders(
  text: string,
  tokens: Record<DocumentToken, TokenValue>
): string {
  // เครื่องหมาย token ที่ระบบรู้จัก → เช็คว่าตัวไหนยังไม่มีข้อมูล
  // pattern รวมทั้ง system token และ {FIELD:<id>} (Requirement K.6)
  const TOKEN_BRACE = /(\{[A-Z_]+(?::[A-Za-z0-9_-]+)?\})/g;

  let out = "";
  let lastIndex = 0;
  for (const match of text.matchAll(TOKEN_BRACE)) {
    const index = match.index ?? 0;
    const brace = match[1];

    // ข้อความก่อน token → escape ตามปกติ
    out += escapeHtml(text.slice(lastIndex, index));

    // หา token name จาก {NAME} หรือ {FIELD:id}
    const name = brace.slice(1, -1);
    const isFieldToken = name.startsWith("FIELD:");
    const isKnownSystem = !isFieldToken && (name as DocumentToken) in tokens;
    const tokenValue = isKnownSystem ? tokens[name as DocumentToken] : null;
    const isEmpty = isFieldToken ? true : tokenValue ? tokenValue.empty : false;

    // token ที่ resolve ได้ → ข้อความธรรมดา (escape แล้ว)
    // token ที่ยังไม่มีข้อมูล → span สีเทา + italic
    const inner = isEmpty
      ? `<span class="dc-token--empty">${escapeHtml(brace)}</span>`
      : escapeHtml(brace);

    out += inner;
    lastIndex = index + brace.length;
  }

  // ส่วนที่เหลือหลัง token สุดท้าย
  out += escapeHtml(text.slice(lastIndex));
  return out;
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
  // ── Requirement E: required marker เป็น optional toggle ────────────
  const showRequired = block.showRequired ?? true;
  const requiredMarker = field.isRequired && showRequired ? " *" : "";

  // ── Requirement E: layout stacked (default) | inline ────────────────
  const layout = block.layout ?? "stacked";
  const layoutClass = layout === "inline" ? " dc-field--inline" : "";

  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // ── mode = "form"     → render เป็น form control จริง (input/textarea/…)
  //    mode = "document" → render เป็น label + value (เหมือน PDF)
  // ใช้ renderer function เดียวกัน (no token logic duplicated)
  const controlHtml =
    mode === "form"
      ? renderFormControl(field, rawValue)
      : renderDocumentValue(field, rawValue);

  const emptyClass = !isNonEmptyValue(rawValue) ? " dc-field--empty" : "";

  // ── Requirement E: showLabel (default: true) ─────────────────────
  //  - ซ่อน label แล้ว → ไม่ emit <label> เลย (read-only mode ไม่ต้องมี label tag)
  const showLabel = block.showLabel ?? true;
  const labelHtml = showLabel
    ? `<label class="dc-field__label">${escapeHtml(label)}<span class="dc-field__required">${requiredMarker}</span></label>`
    : "";

  // layout inline → ห่อ label + control ไว้ใน wrapper เดียวกัน
  const bodyInner = `${labelHtml}\n    ${controlHtml}`;
  const bodyHtml =
    layout === "inline" ? `<div class="dc-field__body">${bodyInner}</div>` : bodyInner;

  return `<section class="dc-field dc-block ${alignClass}${layoutClass}${emptyClass}"${styleAttr}>
    ${bodyHtml}
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

  const showLabel = block.showLabel ?? true;
  const tableLabel = block.label;
  const emptyText = block.emptyText ?? "(ไม่มีข้อมูล)";

  if (tableData.length === 0) {
    const labelHtml = showLabel && tableLabel
      ? `<div class="dc-table-label" style="font-weight:700;margin-bottom:4px">${escapeHtml(tableLabel)}</div>`
      : "";
    return `<section class="dc-table-wrap dc-table--empty dc-block ${alignClass}"${styleAttr}>
      ${labelHtml}
      <div class="dc-field__value">${escapeHtml(emptyText)}</div>
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

  const labelHtml = showLabel && tableLabel
    ? `<div class="dc-table-label" style="font-weight:700;margin-bottom:4px">${escapeHtml(tableLabel)}</div>`
    : "";

  return `<section class="dc-table-wrap dc-block ${alignClass}"${styleAttr}>
    ${labelHtml}
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
// Logo (Requirement D)
// =============================================================================

/** ความกว้าง default ของโลโก้ (px ใน preview) — คงเดิมไว้เพื่อ BC */
const DEFAULT_LOGO_WIDTH = 70;

/**
 * Render LogoBlock → HTML
 *
 * ── Requirement D ────────────────────────────────────────────────────────
 *   source:
 *     - "none"         → ไม่แสดงอะไรเลย (ว่าง)
 *     - "organization" → โลโก้หน่วยงาน
 *     - "upload"       → รูปที่อัปโหลดเอง (ยังไม่มี asset storage)
 *
 *   ถ้าไม่มีโลโก้หรือโหลดไม่ได้ → แสดง "ยังไม่มีโลโก้"
 *   ห้ามแสดงกรอบรูปว่าง / <img src=""> (เคยเป็นบั๊ก — src="" โหลด page เดิม)
 *
 *   ── ข้อจำกัดที่ตรวจพบจริง (รายงานตาม Requirement D) ──────────────────
 *   ตาราง `organizations` ไม่มี column logo
 *   และไม่มี admin asset storage (R2 route ที่มีรับเฉพาะ PDF เอกสารสมัคร)
 *   → renderer นี้รับ imageUrl จาก ctx.logoUrl (ถ้ามีในอนาคต)
 *   → ถ้าไม่มี URL → แสดงข้อความ "ยังไม่มีโลโก้" เสมอ ไม่ทำให้ Preview ล้ม
 *
 *   ── Safety (Requirement K.5) ────────────────────────────────────────────
 *   URL ถูก validate ก่อนใส่ใน src="" (http/https/data:image เท่านั้น)
 *   และ escape attribute เสมอ → ไม่มีทางเกิด script injection
 */
function renderLogoBlock(block: LogoBlock): string {
  const align = (block.align ?? DEFAULT_ALIGN) as Align;
  const alignClass = ALIGN_TO_CLASS[align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // ── source = "none" → ไม่แสดงอะไรเลย ────────────────────────────────
  if (block.source === "none") {
    return "";
  }

  // ── ขนาด (รักษา aspect ratio: ถ้าไม่ระบุ height ให้ auto) ──────────
  const width = clampSize(block.width, DEFAULT_LOGO_WIDTH);
  // ใช้ height เฉพาะเมื่อ Admin ระบุ — CSS `height:auto` จะรักษา ratio ให้
  const height = block.height ? `height: ${clampSize(block.height, DEFAULT_LOGO_WIDTH)}px;` : "height: auto;";
  const sizeStyle = `width: ${width}px; ${height}`;

  // ── เลือก URL ตาม source ───────────────────────────────────────────
  //  organization → ctx.logoUrl (ยังไม่มีในระบบ → null)
  //  upload       → block.imageUrl (forward-compatible)
  //  ไม่มี source  (descriptor เก่า) → organization (คงพฤติกรรมเดิม)
  const source = block.source ?? "organization";
  const rawUrl =
    source === "upload"
      ? block.imageUrl
      : LOGO_SOURCE_URLS.get("organization") ?? null;

  const safeUrl = sanitizeImageUrl(rawUrl);

  if (safeUrl === null) {
    // ── ไม่มีโลโก้ → ข้อความสีเทา (ห้ามกรอบรูปว่าง — Requirement D) ──
    return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
      <span class="dc-logo__placeholder">${NO_LOGO_TEXT}</span>
    </section>`;
  }

  const alt = escapeHtml(block.alt ?? "โลโก้หน่วยงาน");
  return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
    <img src="${escapeHtml(safeUrl)}" alt="${alt}" style="${sizeStyle}" />
  </section>`;
}

/**
 * URL ของโลโก้หน่วยงานที่ resolve ได้จริง
 *
 * ปัจจุบันระบบไม่มีแหล่งโลโก้จริง (ไม่มี column ใน organizations,
 * ไม่มี admin asset storage) → Map ว่าง = ยังไม่มี source
 *
 * เมื่อมี source จริงในอนาคต ให้เติม key "organization" ที่นี่ที่เดียว
 * (renderer อื่นไม่ต้องแก้ — เป็น single source of truth)
 */
const LOGO_SOURCE_URLS = new Map<string, string>();

/**
 * Validate URL รูปภาพก่อนใส่ใน src="" (Requirement K.5)
 *
 * อนุญาตเฉพาะ:
 *   - http:// / https://
 *   - data:image/* ขนาดเล็ก (≤ 4096 ตัวอักษร — กัน base64 ใหญ่)
 *
 * @returns URL ที่ปลอดภัย หรือ null ถ้าไม่ผ่านการตรวจ
 */
function sanitizeImageUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return trimmed;
  if (lower.startsWith("data:image/") && trimmed.length <= 4096) return trimmed;
  // protocol นอกเหนือจากนี้ (เช่น javascript:, vbscript:, data:text/html) → ปฏิเสธ
  return null;
}

/**
 * Clamp ขนาดรูปให้อยู่ในช่วงที่ปลอดภัย (8..1000) — กันค่าผิดปกติทำให้ layout พัง
 */
function clampSize(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.round(value);
  if (n < 8) return 8;
  if (n > 1000) return 1000;
  return n;
}

// =============================================================================
// System Data Block (Requirement B)
// =============================================================================

/**
 * Render SystemDataBlock → HTML
 *
 * แสดง "ข้อมูลระบบ" 1 รายการ (เลขที่ใบสมัคร / ชื่อรอบ / วันที่)
 *
 * ── ตั้งค่าได้ (Requirement B) ────────────────────────────────────────────
 *   - label ที่แสดง (custom ได้ / default = SYSTEM_DATA_LABELS[key])
 *   - showLabel (default: true)
 *   - layout: "stacked" (default) = label บน / value ล่าง
 *             "inline"           = label และ value บรรทัดเดียวกัน
 *   - align (ของ block)
 *   - labelStyle / valueStyle (small/medium/large)
 *   - dateFormat (ใช้กับ APPLICATION_DATE / PRINT_DATE)
 *
 * ── Placeholder (Requirement I.9) ─────────────────────────────────────────
 *   token ที่ resolve ไม่ได้ → แสดง {TOKEN} สีเทา + italic
 *   (เหมือน heading — ไม่ใช้ค่าอื่นมาแทน: Requirement K.10)
 */
function renderSystemDataBlock(
  block: SystemDataBlock,
  tokens: Record<DocumentToken, TokenValue>
): string {
  const align = (block.align ?? DEFAULT_ALIGN) as Align;
  const alignClass = ALIGN_TO_CLASS[align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // ── ค่า (resolve จาก token map — single source of truth เดียวกับ heading) ──
  const value = tokens[block.key];
  const isEmpty = !value || value.empty;
  const valueText = isEmpty ? `{${block.key}}` : formatSystemDateValue(value.text, block);

  const label = block.label ?? SYSTEM_DATA_LABELS[block.key];
  const showLabel = block.showLabel ?? true;
  const layout = block.layout ?? "stacked";

  const labelPt = SIZE_TO_PT[block.labelStyle ?? "small"];
  const valuePt = SIZE_TO_PT[block.valueStyle ?? "medium"];

  const labelHtml = showLabel
    ? `<div class="dc-systemdata__label" style="font-size: ${labelPt}pt">${escapeHtml(label)}</div>`
    : "";
  const valueHtml = `<div class="dc-systemdata__value" style="font-size: ${valuePt}pt">${escapeHtml(valueText)}</div>`;

  const layoutClass = layout === "inline" ? " dc-systemdata--inline" : " dc-systemdata--stacked";
  const emptyClass = isEmpty ? " dc-systemdata--empty" : "";

  // ── layout inline → label + value ต้องอยู่ในกลุ่มเดียวกัน ──────
  // mirror renderFieldBlock: inline ห่อทั้ง label และ value ไว้ใน
  // .dc-systemdata__body (flex container) → justify-content จัดกลุ่ม
  // เดียวได้ ถ้า label อยู่นอก body จะถูกจัดตำแหน่งแยกจน alignment ไม่มีผล
  if (layout === "inline") {
    return `<section class="dc-systemdata dc-block ${alignClass}${layoutClass}${emptyClass}"${styleAttr}>
    <div class="dc-systemdata__body">${labelHtml}${valueHtml}</div>
  </section>`;
  }

  // stacked → label บนบรรทัด / value ล่างบรรทัด (ไม่ต้องมี wrapper)
  return `<section class="dc-systemdata dc-block ${alignClass}${layoutClass}${emptyClass}"${styleAttr}>
    ${labelHtml}
    ${valueHtml}
  </section>`;
}

/**
 * Format ค่าวันที่ตาม dateFormat ที่เลือก (Requirement B)
 *
 * tokens resolver ส่งมาเป็น "20 ตุลาคม 2569" (thai_long) เสมอ
 * → ถ้าเลือกรูปแบบอื่น ต้องแปลงกลับเป็นตัวเลขจากข้อความไทย
 *
 * @param text - ค่าที่ resolve ได้ (รูปแบบไทยยาว)
 * @param block - block config (ใช้ key + dateFormat)
 * @returns ข้อความตามรูปแบบที่เลือก
 */
function formatSystemDateValue(text: string, block: SystemDataBlock): string {
  const isDateKey = block.key === "APPLICATION_DATE" || block.key === "PRINT_DATE";
  const fmt = block.dateFormat ?? DEFAULT_DATE_FORMAT;
  if (!isDateKey || fmt === "thai_long") return text;

  // parse "20 ตุลาคม 2569" → { day, monthIndex, year }
  const parsed = parseThaiLongDate(text);
  if (parsed === null) return text;

  switch (fmt) {
    case "thai_short":
      return `${parsed.day}/${parsed.monthIndex + 1}/${parsed.year}`;
    case "iso":
      return `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
    case "numeric":
      return `${String(parsed.day).padStart(2, "0")}-${String(parsed.monthIndex + 1).padStart(2, "0")}-${parsed.year}`;
    default:
      // ไม่ควรถูกเรียก (เพราะผ่าน check fmt !== "thai_long" แล้ว)
      // แต่ถ้ามีค่าใหม่ในอนาคต ป้องกันไม่ให้พัง
      return text;
  }
}

/**
 * Parse "20 ตุลาคม 2569" → { day, monthIndex (0-based), year (พ.ศ.) }
 *
 * @returns null ถ้า parse ไม่ได้ (คืนค่าเดิม — ไม่ throw, ไม่ทำ Preview ล้ม)
 */
function parseThaiLongDate(text: string): { day: number; monthIndex: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s+([^\d\s]+)\s+(\d{4})\s*$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const monthIndex = THAI_MONTHS.indexOf(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(day) || monthIndex < 0 || !Number.isFinite(year)) return null;
  return { day, monthIndex, year };
}

// =============================================================================
// Signature (Requirement C)
// =============================================================================

/**
 * ค่า default ของ Signature (ย้ายไปใช้จาก types.ts แล้ว)
 *
 * เดิมมี duplicate constant ที่นี่ (DEFAULT_SIGNATURE_ROLE / DEFAULT_SHOW_*)
 * ทำให้ renderer สองฝั่ง (preview / PDF) drift กันได้
 * → ตอนนี้ทั้งสองฝั่ง import จาก types.ts ที่เป็น single source of truth
 *   (DEFAULT_SHOW_NAME / DEFAULT_SHOW_PARENTHESES / DEFAULT_SHOW_DATE /
 *    DEFAULT_SHOW_TIME / DEFAULT_SIGNATURE_*_LABEL)
 *
 * ────────────────────────────────────────────────────────────────────────
/**
 * Render SignatureBlock → HTML
 *
 * ── Requirement C: ค่าเริ่มต้น ────────────────────────────────────────────
 *   ลงลายมือชื่อ ........................................ ผู้สมัคร
 *   ({ชื่อ-นามสกุล})
 *   วันที่ {APPLICATION_DATE}
 *
 * ── สิ่งที่ตั้งค่าได้ ─────────────────────────────────────────────────────
 *   1. lineLabel    (default "ลงลายมือชื่อ") — label ก่อนเส้น
 *   2. roleLabel    (default "ผู้สมัคร")     — label หลังเส้น
 *   3. lineStyle    (default "......")     — รูปแบบเส้นลายเซ็น
 *   4. nameFieldId  — Application Field สำหรับชื่อ (field_master.id)
 *   5. dateSource   — APPLICATION_DATE / PRINT_DATE / none
 *   6. showName / showDate / showParentheses
 *   7. dateLabel    (default "วันที่")
 *   8. align        — left / center / right
 *
 * ── Fallback (เมื่อไม่มี application) ────────────────────────────────────
 *   - ชื่อ: "(ชื่อผู้สมัคร)"
 *   - วันที่: "______________"
 *
 * ไม่ทำการ pagination ใน preview — ทั้ง block อยู่ใน DOM ปกติ
 */
function renderSignatureBlock(
  block: SignatureBlock,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>
): string {
  const alignClass = ALIGN_TO_CLASS[(block.align ?? DEFAULT_ALIGN) as Align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  // ── ข้อความที่ตั้งค่าได้ (Requirement C.1/C.2/C.3/C.10) ─────────────
  const lineLabel = block.lineLabel ?? DEFAULT_SIGNATURE_LINE_LABEL;
  const roleLabel = block.roleLabel ?? DEFAULT_SIGNATURE_ROLE_LABEL;
  const lineStyle = block.lineStyle ?? DEFAULT_SIGNATURE_LINE_STYLE;
  const dateLabel = block.dateLabel ?? DEFAULT_SIGNATURE_DATE_LABEL;
  const showParentheses = block.showParentheses ?? DEFAULT_SHOW_PARENTHESES;

  // ── Visibility toggles (Requirement C.6/C.7/C.8) ───────────────────
  const showName = block.showName ?? DEFAULT_SHOW_NAME;
  const showDate = block.showDate ?? DEFAULT_SHOW_DATE;
  const showTime = block.showTime ?? DEFAULT_SHOW_TIME;

  // ── Resolve ชื่อ: nameFieldId (Requirement C.4) → fallback fullname ──
  const { signerName, hasName } = resolveSignerName(block, ctx);
  const submittedAt = ctx.application.submittedAt;
  const hasSubmittedAt = typeof submittedAt === "number" && submittedAt > 0;

  // ── Resolve วันที่ตาม dateSource (Requirement C.5) ──────────────────
  //  - "none"              → ไม่แสดงวันที่เลย
  //  - "PRINT_DATE"        → วันที่พิมพ์ (จาก token resolver = เวลาสร้างเอกสาร)
  //  - "APPLICATION_DATE"  → วันที่สมัคร (default)
  //  - "application" (legacy descriptor) → พฤติกรรมเดิม = submitted_at
  const rawDateSource = block.dateSource ?? "APPLICATION_DATE";
  const dateSource: SignatureDateSourceKind =
    rawDateSource === "none" || rawDateSource === "PRINT_DATE"
      ? rawDateSource
      : "APPLICATION_DATE";

  const dateText = resolveSignatureDateText(dateSource, ctx, tokens, hasSubmittedAt);
  const timeText = hasSubmittedAt
    ? formatThaiTime(submittedAt)
    : "______________";

  const nameClass = hasName ? "" : " dc-signature__placeholder";

  // ── เส้นลายเซ็น (Requirement C.3) ───────────────────────────────────
  //  ถ้า Admin กำหนด lineStyle (จุด/ขีด) → ใช้ข้อความตามนั้น
  //  ถ้าไม่กำหนด → ใช้เส้นคั่นแบบ CSS (พฤติกรรมเดิม)
  const lineInner =
    lineStyle.trim().length > 0
      ? `<span class="dc-signature__line-text">${escapeHtml(lineStyle)}</span>`
      : `<span class="dc-signature__line">&nbsp;</span>`;

  // ── Build body lines ตาม layout เดิม + label ที่ปรับได้ ───────────
  //  บรรทัด 1: "<lineLabel> <line> <roleLabel>"
  const roleInline = roleLabel.trim().length > 0
    ? ` <span class="dc-signature__role">${escapeHtml(roleLabel)}</span>`
    : "";
  const line1Label = lineLabel.trim().length > 0
    ? `<span>${escapeHtml(lineLabel)}</span> `
    : "";

  const bodyParts: string[] = [
    `<div>${line1Label}${lineInner}${roleInline}</div>`,
  ];

  if (showName) {
    // showParentheses = false → แสดงชื่อเปล่า ไม่มีวงเล็บ (Requirement C.8)
    const displayName = hasName
      ? signerName
      : showParentheses
        ? SIGNATURE_NAME_PLACEHOLDER
        : SIGNATURE_NAME_HINT;
    const nameText = showParentheses
      ? `(${escapeHtml(displayName)})`
      : escapeHtml(displayName);
    bodyParts.push(
      `<div class="dc-signature__name${nameClass}">${nameText}</div>`
    );
  }

  if (showDate && dateSource !== "none") {
    const dateColor = dateText === "______________" ? " dc-signature__placeholder" : "";
    bodyParts.push(
      `<div class="dc-signature__date${dateColor}">${escapeHtml(dateLabel)} ${escapeHtml(dateText)}</div>`
    );
  }

  if (showTime && hasSubmittedAt) {
    bodyParts.push(
      `<div class="dc-signature__time dc-signature__placeholder">เวลา ${escapeHtml(timeText)}</div>`
    );
  }

  return `<section class="dc-signature dc-block ${alignClass}"${styleAttr}>
    ${bodyParts.join("\n    ")}
  </section>`;
}

/** ชนิดของ dateSource ที่ renderer รองรับ (หลัง normalize ค่า legacy แล้ว) */
type SignatureDateSourceKind = "APPLICATION_DATE" | "PRINT_DATE" | "none";

/**
 * ข้อความ placeholder ของชื่อ (เมื่อไม่มีข้อมูลจริง)
 *
 * เป็นข้อความ hint ของเอกสาร ไม่ใช่ Application Field
 * (Requirement C: ห้ามสร้าง Application Field ชื่อ "ลายมือชื่อ" โดยอัตโนมัติ)
 */
const SIGNATURE_NAME_PLACEHOLDER = "ชื่อผู้สมัคร";

/** ข้อความ hint เมื่อปิดวงเล็บรอบชื่อ */
const SIGNATURE_NAME_HINT = "ชื่อ-นามสกุล";

/**
 * Resolve ชื่อผู้ลงนาม (Requirement C.4)
 *
 * ลำดับ (ตามที่ผู้ใช้เลือก):
 *   1. nameFieldId → Application Field ที่ Admin เลือก (เก็บเป็น field_master.id)
 *   2. ถ้า field นั้นไม่มีใน template version นี้ → ยังเป็น placeholder
 *      (ไม่ fallback เงียบ ๆ ไปใช้ชื่อคนอื่น)
 *   3. ไม่ได้เลือก field เลย → application.fullname (พฤติกรรมเดิม)
 *
 * @returns { signerName, hasName }
 */
function resolveSignerName(
  block: SignatureBlock,
  ctx: ApplicationContext
): { signerName: string; hasName: boolean } {
  if (block.nameFieldId) {
    const resolved = resolveFieldValue(block.nameFieldId, ctx);
    if (resolved !== null) {
      if (resolved.empty) {
        // field มีอยู่แต่ยังไม่มีค่า → placeholder
        return { signerName: SIGNATURE_NAME_PLACEHOLDER, hasName: false };
      }
      return { signerName: resolved.text, hasName: true };
    }
    // field ไม่อยู่ใน version นี้ → ยังเป็น placeholder (ไม่หลอกว่ามีชื่อ)
    return { signerName: SIGNATURE_NAME_PLACEHOLDER, hasName: false };
  }

  const fullname = (ctx.application.fullname ?? "").trim();
  if (fullname.length > 0) {
    return { signerName: fullname, hasName: true };
  }
  return { signerName: SIGNATURE_NAME_PLACEHOLDER, hasName: false };
}

/**
 * Resolve ข้อความวันที่ของ Signature Block ตาม dateSource (Requirement C.5)
 *
 * - APPLICATION_DATE → วันที่สมัครจริง (applications.submitted_at)
 * - PRINT_DATE       → วันที่พิมพ์ (จาก token resolver — เวลาสร้างเอกสาร)
 * - none             → ไม่คืนค่า (renderer ข้ามบรรทัดนี้)
 *
 * @returns ข้อความวันที่ หรือ "______________" เมื่อไม่มีข้อมูลจริง
 */
function resolveSignatureDateText(
  dateSource: SignatureDateSourceKind,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>,
  hasSubmittedAt: boolean
): string {
  if (dateSource === "none") return "______________";

  if (dateSource === "PRINT_DATE") {
    const print = tokens.PRINT_DATE;
    if (!print || print.empty) return "______________";
    return print.text;
  }

  // APPLICATION_DATE — ใช้ค่าจาก token resolver เป็นหลัก (single source of truth)
  // fallback เป็น formatThaiDate(submittedAt) ถ้า token ยังไม่ถูก resolve
  const appDate = tokens.APPLICATION_DATE;
  if (appDate && !appDate.empty) return appDate.text;
  if (hasSubmittedAt && typeof ctx.application.submittedAt === "number") {
    return formatThaiDate(ctx.application.submittedAt);
  }
  return "______________";
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
function wrapDocument(body: string, header: string, tokens: Record<DocumentToken, TokenValue>): string {
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
 * Render document header block — Logo placeholder + Title + Application tokens
 *
 * [Live Preview UX — Requirement I.5]
 * - Logo: ใช้ <img> ถ้ามี URL จริง ไม่มี → placeholder สีเทา "ยังไม่มีโลโก้"
 * - Title: ชื่อเอกสารจาก descriptor (heading large ตัวแรก)
 * - Token rows: แสดงเฉพาะ token ที่**ยังไม่มี** SystemDataBlock ใน descriptor
 *   → descriptor เป็น single source of truth สำหรับ layout ข้อมูลระบบ
 *   → ถ้า Admin เพิ่ม SystemDataBlock APPLICATION_NO → header ไม่แสดงซ้ำ
 *
 * โครงสร้าง:
 *   <header class="dc-doc-header">
 *     <div class="dc-doc-header__logo">…</div>
 *     <h1 class="dc-doc-header__title">ชื่อเอกสาร</h1>
 *     <dl class="dc-doc-header__meta">
 *       <dt>เลขที่ใบสมัคร</dt><dd>{APPLICATION_NO}</dd>  ← ถ้ายังไม่มี block
 *       <dt>ชื่อรอบการสมัคร</dt><dd>{ROUND_NAME}</dd>      ← ถ้ายังไม่มี block
 *     </dl>
 *   </header>
 *
 * @param descriptor - สำหรับตรวจว่า token ใดถูก render โดย SystemDataBlock แล้ว
 */
function renderDocumentHeader(
  title: string,
  tokens: Record<DocumentToken, TokenValue>,
  descriptor: DocumentDescriptor
): string {
  const resolvedTitle = escapeHtml(applyDocumentTokens(title, tokens));

  // ── Collect keys ที่มี SystemDataBlock แล้วใน descriptor ─────
  // → header ไม่ต้องแสดงซ้ำ (descriptor เป็น single source)
  const systemDataKeys = new Set<string>();
  for (const block of descriptor.blocks) {
    if (block.type === "systemData") {
      systemDataKeys.add(block.key);
    }
  }

  // ── Render เฉพาะ token ที่ยังไม่มี block ─────────────────────
  const metaRows = INSERTABLE_DOCUMENT_TOKENS
    .filter((token) => !systemDataKeys.has(token))
    .map((token) => {
      const value = tokens[token];
      const label = DOCUMENT_TOKEN_LABELS[token];
      const emptyClass = value.empty ? " dc-header-meta__value--empty" : "";
      return `<dt>${escapeHtml(label)}</dt>
      <dd class="dc-header-meta__value${emptyClass}">${escapeHtml(value.text)}</dd>`;
    })
    .join("\n      ");

  return `<header class="dc-doc-header">
  <div class="dc-doc-header__logo">
    <span class="dc-doc-header__logo-placeholder">${NO_LOGO_TEXT}</span>
  </div>
  <h1 class="dc-doc-header__title">${resolvedTitle}</h1>
  <dl class="dc-doc-header__meta">
      ${metaRows}
  </dl>
</header>`;
}

/**
 * Build token diagnostics filtered to only used tokens
 *
 * Requirement E: Show only tokens that the descriptor actually uses.
 * Tokens not used by the descriptor must NOT appear in diagnostics
 * and must NOT be counted as "missing".
 *
 * Requirement F: Include source metadata for each token:
 *   - "application"    → comes from application table
 *   - "application_form" → comes from application formData
 *   - "round"          → comes from recruitment round
 *   - "system"         → comes from system (e.g., PRINT_DATE)
 *   - "sample"         → sample data (default preview mode)
 *   - "unresolved"     → token not bound to any data
 *
 * @param tokens - resolved token values
 * @param descriptor - the descriptor being previewed
 * @param isRealApplication - true if using real applicant data (not sample)
 */
/**
 * Build token diagnostics for the preview panel.
 *
 * Requirement E: Show only tokens that the descriptor actually uses.
 * Tokens not used by the descriptor must NOT appear in diagnostics
 * and must NOT be counted as "missing".
 *
 * Token collection sources:
 *   - SystemDataBlock.key
 *   - HeadingBlock text: {TOKEN} patterns
 *   - HeadingBlock text: {FIELD:<fieldId>} patterns
 *   - SignatureBlock.dateSource
 *   - SignatureBlock.nameFieldId
 *   - FieldBlock.fieldId
 *   - TableBlock.fieldId
 *
 * @param tokens - resolved token values
 * @param descriptor - the descriptor being previewed
 * @param isRealApplication - true if using real applicant data (not sample)
 */
function buildTokenDiagnostics(
  tokens: Record<DocumentToken, TokenValue>,
  descriptor: DocumentDescriptor,
  ctx: ApplicationContext,
  isRealApplication: boolean
): PreviewTokenInfo[] {
  // ── Step 1: collect tokens used in this descriptor ─────────────────────
  // Uses collectUsedTokens() from document-tokens.ts
  // Returns Set of: "APPLICATION_NO", "ROUND_NAME", "FIELD:abc123", etc.
  const usedTokens = collectUsedTokens(descriptor);

  // ── Step 2: filter tokens to only those used in descriptor ─────────────
  // System tokens (e.g. "APPLICATION_NO", "ROUND_NAME")
  const systemTokenNames = DOCUMENT_TOKENS.filter((t) => usedTokens.has(t));

  // Field tokens (e.g. "FIELD:abc123")
  const fieldTokenNames = Array.from(usedTokens).filter((t) => t.startsWith("FIELD:"));

  const out: PreviewTokenInfo[] = [];

  // ── Step 3: add system tokens in DOCUMENT_TOKENS order ─────────────────
  for (const token of systemTokenNames) {
    const source = resolveTokenSource(token, tokens, isRealApplication);
    out.push({
      token,
      label: DOCUMENT_TOKEN_LABELS[token],
      text: tokens[token].text,
      empty: tokens[token].empty,
      source,
    });
  }

  // ── Step 4: add field tokens ───────────────────────────────────────────
  for (const fieldToken of fieldTokenNames) {
    const fieldId = fieldToken.replace("FIELD:", "");
    const resolved = resolveFieldValue(fieldId, ctx);

    out.push({
      token: fieldToken,
      label: `Field: ${fieldId}`,
      text: resolved?.text ?? `{FIELD:${fieldId}}`,
      empty: resolved?.empty ?? true,
      source: resolved ? "application_form" : "unresolved",
    });
  }

  return out;
}

/**
 * Resolve the data source for a system token
 *
 * This determines what category the token value comes from:
 *   - "application"      → application table fields (fullname, email, submittedAt)
 *   - "application_form" → application formData (form field answers)
 *   - "round"           → recruitment round fields (title, roundCode, etc.)
 *   - "system"          → system-generated (PRINT_DATE)
 *   - "sample"          → sample data (default preview mode)
 *   - "unresolved"      → no data source found (placeholder)
 */
function resolveTokenSource(
  token: DocumentToken,
  tokens: Record<DocumentToken, TokenValue>,
  isRealApplication: boolean
): TokenSource {
  // If token is empty, it's unresolved
  if (tokens[token].empty) {
    return "unresolved";
  }

  // If not using real application, all tokens are from sample
  if (!isRealApplication) {
    return "sample";
  }

  // Map tokens to their sources
  switch (token) {
    case "APPLICATION_NO":
    case "APPLICATION_DATE":
      return "application";
    case "ROUND_NAME":
    case "ROUND_CODE":
    case "POSITION_LEVEL":
      return "round";
    case "PRINT_DATE":
      return "system";
    case "POSITION_NAME":
    case "POSITION_NUMBER":
      // These have no data source in the current system
      return "unresolved";
    default:
      return "unresolved";
  }
}

/**
 * [Live Preview] แถบข้อมูลเอกสาร (diagnostics strip — ไม่อยู่ใน PDF)
 *
 * วัตถุประสงค์: ให้ผู้ใช้เห็นว่าเอกสารนี้จะแสดงค่าอะไร — ไม่ใช่ placeholder
 *
 * - แสดงเฉพาะ token ที่ UI อนุญาตให้แทรก (INSERTABLE_DOCUMENT_TOKENS)
 *   → ไม่แสดง POSITION_LEVEL / ROUND_CODE / POSITION_NUMBER
 *     (ระบบไม่มีข้อมูลจริงและไม่ได้บังคับให้ใช้ — Requirement A)
 * - token ที่ยังไม่มีข้อมูลจะแสดง placeholder เพื่อให้รู้ว่า"ยังไม่ได้ผูก"
 * - เป็น debug strip ไม่ใช่ส่วนหนึ่งของเอกสาร → จัดวางท้ายสุด
 *   และถูกซ่อนเป็นค่าเริ่มต้นด้วย CSS (Requirement I.12)
 */
function renderDocumentHeaderInfo(
  tokens: Record<DocumentToken, TokenValue>
): string {
  const rows = INSERTABLE_DOCUMENT_TOKENS.map((token) => {
    const value = tokens[token];
    const label = DOCUMENT_TOKEN_LABELS[token];
    const valueText = escapeHtml(value.text);
    const valueClass = value.empty ? "dc-docinfo__value dc-docinfo__value--empty" : "dc-docinfo__value";
    return `      <div class="dc-docinfo__row">
        <span class="dc-docinfo__label">${escapeHtml(label)}</span>
        <span class="${valueClass}">${valueText}</span>
      </div>`;
  }).join("\n");

  return `
<!-- ── Document info strip (Live Preview debug, ไม่อยู่ใน PDF) ── -->
<aside class="dc-docinfo" aria-label="ตรวจสอบข้อมูลเอกสาร">
  <div class="dc-docinfo__title">ตรวจสอบข้อมูลเอกสาร (ตัวอย่างจาก Template/Round)</div>
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
 *
 * ── Requirement F (MASTER_DATA แบบค่าเดียว) ────────────────────────────────
 *   "สังกัดปัจจุบัน" เก็บค่าเป็น object เดี่ยว { id, name } (ไม่ใช่ array)
 *   → ต้องแสดงเป็น "กองวิชาการ" (เอา .name) ไม่ใช่ JSON ดิบ
 *   → ห้ามสร้าง sample data สองแถวสำหรับ field แบบนี้
 *
 *   array → คงพฤติกรรมเดิม (join ด้วย ", ") เพราะเป็น multi-select/repeater
 *   object อื่นที่ไม่มี display field → safe readable fallback "—"
 *   (ห้าม JSON.stringify ใน Document/PDF — Requirement F.6)
 */
function formatAnswerValueForDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    // array ของ object (MASTER_DATA multi-select / table) → ดึง display label
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
    // MASTER_DATA แบบค่าเดียว { id, name } → เอา .name (Requirement F.3/F.5)
    // ถ้าไม่มี display field → safe readable fallback (Requirement F.7)
    const label = getObjectDisplayLabel(value as Record<string, unknown>);
    return label === "—" ? "-" : label;
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
