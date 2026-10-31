/**
 * Document Composer V1 — HTML Preview Renderer
 *
 * Pure function:
 *   ApplicationContext + DocumentDescriptor → PreviewModel (HTML)
 *
 * Design Goals:
 *   - ใช้ DocumentDescriptor ตัวเดียวกับ PDF Renderer (single source of truth)
 *   - 🔑 **Preview = เอกสาร ไม่ใช่ฟอร์ม**
 *     ทุก field render เป็น "ป้ายกำกับ + ค่า" เหมือน PDF ทุกประการ
 *     → ห้าม emit form control (input / textarea / select / checkbox / radio)
 *     → field ที่ว่างแสดง placeholder สีเทา (parity กับ PDF)
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
import { SAO_LOGO_BASE64 } from "../assets/sao-logo.data";
import { formatFieldValueWithOther } from "../other-option";
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
  SIGNATURE_NAME_PLACEHOLDER,
  SIGNATURE_NAME_HINT,
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
  resolveFileAttachmentValue,
  formatThaiDate,
  formatThaiTime,
  THAI_MONTHS,
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
 * ── System Data font size mapping (labelStyle / valueStyle) ──────────────
 *
 * ⚠️ แยกจาก `HEADING_SIZE_TO_PT` โดยเฉพาะ
 *    (Heading ใช้ 14/18/22 — System Data ต้องไม่ชนกับชั้นหัวเอกสาร)
 *
 * ต้องตรงกับ SYSTEMDATA_SIZE_TO_FONT_SIZE ใน descriptor-renderer.ts เสมอ
 * (PDF ↔ Preview parity)
 *
 *   - small  (label) = 12pt
 *   - medium (value) = 14pt
 *   - large  = 18pt (สูงกว่า value แต่ยังต่ำกว่าชื่อเอกสาร 22pt)
 */
const SYSTEMDATA_SIZE_TO_PT: Record<Size, number> = {
  large: 18,
  medium: 14,
  small: 12,
};

/**
 * ── Heading / Text Block font size mapping (Typography Phase 1) ──────────
 *
 * ⚠️ แยกจาก `SYSTEMDATA_SIZE_TO_PT` โดยเฉพาะ
 *
 * ต้องตรงกับ HEADING_SIZE_TO_FONT_SIZE ใน descriptor-renderer.ts เสมอ
 * (PDF ↔ Preview parity)
 *
 *   - small  → 14pt
 *   - medium → 18pt
 *   - large  → 22pt
 */
const HEADING_SIZE_TO_PT: Record<Size, number> = {
  large: 22,
  medium: 18,
  small: 14,
};

/**
 * ── Field typography ─────────────────────────────────────────────
 *
 * ต้องตรงกับ FIELD_LABEL_SIZE_TO_FONT_SIZE / FIELD_VALUE_SIZE_TO_FONT_SIZE
 * ใน descriptor-renderer.ts เสมอ (PDF ↔ Preview parity)
 *
 *   - small  = label 12pt / value 11pt
 *   - medium = label 14pt / value 13pt  ← ค่า default (block ที่ไม่ระบุ style)
 *   - large  = label 18pt / value 16pt
 */
const FIELD_LABEL_SIZE_TO_PT: Record<Size, number> = {
  small: 12,
  medium: 14,
  large: 18,
};

const FIELD_VALUE_SIZE_TO_PT: Record<Size, number> = {
  small: 11,
  medium: 13,
  large: 16,
};

/**
 * ── Signature font size mapping ────────────────────────────────────
 *
 * ต้องตรงกับ SIGNATURE_SIZE_TO_FONT_SIZE ใน descriptor-renderer.ts เสมอ
 *   - small  = 14pt
 *   - medium = 16pt (ค่าเริ่มต้น)
 *   - large  = 20pt
 */
const SIGNATURE_SIZE_TO_PT: Record<Size, number> = {
  small: 14,
  medium: 16,
  large: 20,
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
  /* POST_BLOCK_SPACING (4pt) — PDF เว้นท้ายทุก block (descriptor-renderer.ts
     state.y -= POST_BLOCK_SPACING) ใช้ padding-bottom เพราะ margin-bottom
     จะโดน inline style ของ block เขียนทับ (parity L2) */
  padding: 0 0 4pt 0;
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
  /* parity L3: bold=false → regular เหมือน PDF (bold font)
     (เดิมเป็น semibold ทำให้ bold=false ใน Preview ยังดูหนากว่า PDF) */
  font-weight: 400;
  color: #0d4572;
  margin: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.dc-heading--large  { font-size: 22pt; line-height: 1.4; }
.dc-heading--medium { font-size: 18pt; line-height: 1.4; }
.dc-heading--small  { font-size: 14pt; line-height: 1.4; }
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
  /* คงที่ 15.4pt → parity กับ PDF (SYSTEMDATA_LABEL_LINE_ADVANCE) */
  line-height: 15.4pt;
}
.dc-systemdata__value {
  color: #000000;
  /* parity L5: PDF วาด value ด้วย regular font (ไม่ bold) */
  font-weight: 400;
  /* คงที่ 18.2pt → parity กับ PDF (SYSTEMDATA_VALUE_LINE_ADVANCE) */
  line-height: 18.2pt;
}
/*
 * indent ซ้ายของ Value แบบ stacked — เฉพาะ align=left เท่านั้น (parity M7)
 *
 * PDF (descriptor-renderer.ts:drawSystemData): valueX = contentLeft +
 * STACKED_VALUE_INDENT(12pt) เฉพาะเมื่อ showLabel && align=left
 * → class นี้ emit จาก renderSystemDataBlock ตามเงื่อนไขเดียวกัน
 *   (เดิมเป็น CSS rule .dc-systemdata--stacked.dc-align--left ที่ indent
 *    ทั้งที่ showLabel=false และใช้ 12px ไม่ใช่ 12pt)
 */
.dc-systemdata__value--indent {
  padding-left: 12pt;
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
.dc-field--inline .dc-field__value {
  /* parity M7: inline ใช้ flex gap ของ .dc-field__body คั่น label↔value
     (เดิม rule นี้ reset เฉพาะระยะบน/ซ้ายแบบ padding แต่ระยะซ้ายจาก base rule
      ยังหลุดมาเพิ่มช่องว่าง label↔value ใน inline) */
  margin: 0;
  padding-left: 0;
}
.dc-field__label {
  font-size: 12pt;
  color: #666666;
  font-weight: 700;
  margin: 0 0 0 0;
  /* line-height คงที่ (13.75pt) → ตัวอักษรเล็กลงแต่พื้นที่แนวตั้งเท่าเดิม
     → parity กับ PDF renderer (FIELD_LABEL_LINE_ADVANCE) */
  line-height: 13.75pt;
}
.dc-field__value {
  font-size: 13pt;
  color: #000000;
  /* parity M7/L5: gap label→value = 3pt เหมือน PDF (LABEL_TO_MULTILINE_VALUE_GAP)
     ส่วน indent ซ้าย 12pt ย้ายไป .dc-field__value--indent (เฉพาะ align=left) */
  margin: 3pt 0 0 0;
  /* line-height คงที่ (15pt) → parity กับ PDF renderer (FIELD_VALUE_LINE_ADVANCE) */
  line-height: 15pt;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/*
 * indent ซ้ายของ Value แบบ stacked — เฉพาะ align=left เท่านั้น (parity M7)
 *
 * PDF (descriptor-renderer.ts:drawField): valueX = contentLeft +
 * STACKED_VALUE_INDENT(12pt) เฉพาะเมื่อ showLabel && align=left
 * → class นี้ emit จาก renderFieldBlock ตามเงื่อนไขเดียวกัน
 *   (เดิม margin-left: 12px ติดอยู่ใน base rule ทำให้ align=center ใน
 *    Preview เพี้ยนไปจาก PDF ที่กึ่งกลางสมบูรณ์)
 */
.dc-field__value--indent {
  margin-left: 12pt;
}
.dc-field--empty .dc-field__value {
  color: #999aa6;
  font-weight: 400;
}

/* required marker — parity L4: PDF วาด " *" ด้วย COLOR_GRAY เดียวกับ label
   (เดิมเป็นสีแดง ไม่ตรงกับ PDF) */
.dc-field__required {
  color: #666666;
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
/* parity L6: emptyText — PDF วาด 12pt regular สีเทา (COLOR_GRAY)
   (เดิม reuse .dc-field__value → ดำ 13pt + italic จาก .dc-table--empty) */
.dc-table__empty {
  font-size: 12pt;
  color: #666666;
}

/* ── Logo ─────────────────────────────────────────────────── */
/* width/height มาจาก block (Requirement D) — inline style ถูกเขียนทับ */
.dc-logo img {
  display: block;
  width: 70px;
  height: auto;
}
/*
 * โลโก้ฝังของระบบ (SAO logo) — ไม่ใช้ img tag กับ src
 *
 * ⚠️ ทำไมไม่ inline base64 ใน src ของ img
 *   1) payload 238KB จะถูก copy ซ้ำในทุก logo block ที่ Admin ใส่
 *   2) HTML attribute ไม่รองรับ var() → ย้ายไปฝังใน CSS ที่รันครั้งเดียว
 *
 * ⚠️⚠️ ทำไมใช้ background-image แทน content property
 *   content url() บน span ว่าง **ไม่สร้าง intrinsic size**
 *   → เมื่อ inline style เป็น height:auto (ค่า default ของ block)
 *      กล่องจะยุบสูง 0 และโลโก้**ไม่เห็นเลย** (พบจากการ screenshot
 *      ตรวจด้วย Chromium จริง — ไม่ใช่แค่เดาจากโค้ด)
 *
 *   background-image + background-size:contain รักษาพื้นที่ให้เสมอ
 *   และยังคง width/height จาก block ได้เหมือนเดิม
 */
.dc-logo__image {
  display: block;
  background-image: var(--dc-logo-src);
  background-repeat: no-repeat;
  background-position: left center;
  background-size: contain;
}
/*
 * align ของโลโก้ — mirror descriptor-renderer.ts (alignX)
 *
 * ⚠️ text-align มีผลกับ inline-level content เท่านั้น
 *    ส่วนโลโก้เป็น display:block (ข้อบังคับเพื่อไม่ให้กล่องยุบ เพราะ span ว่าง
 *    + background-image ไม่มี intrinsic size)
 *    → .dc-align--center / .dc-align--right ไม่มีผลกับโลโก้เลย
 *    → ต้องใช้ auto margin จัดตำแหน่งแทน (ชิดซ้าย/กึ่งกลาง/ชิดขวาของ content box)
 *
 *   คง display:block ไว้ เพราะเปลี่ยนเป็น inline-block แล้วโลโก้จะเกาะ baseline
 *   → เกิดช่องว่างด้านล่าง (~4px) แล้ว preview จะเลื่อนกว่า PDF อีก
 */
.dc-logo.dc-align--center > .dc-logo__image,
.dc-logo.dc-align--center > img {
  margin-left: auto;
  margin-right: auto;
}
.dc-logo.dc-align--right > .dc-logo__image,
.dc-logo.dc-align--right > img {
  margin-left: auto;
  margin-right: 0;
}
/* ไม่มีโลโก้ → ข้อความสีเทา (ห้ามแสดงกรอบรูปว่าง — Requirement D) */
.dc-logo__placeholder {
  display: inline-block;
  color: #9aa5b1;
  font-size: 10pt;
  font-style: italic;
  line-height: 1.4;
}
/* parity L10: source=none → PDF กินเฉพาะ margin (ไม่มีเนื้อหา ไม่มี
   POST_BLOCK_SPACING) → ยกเลิก padding-bottom ของ .dc-block */
.dc-logo--none {
  padding-bottom: 0;
}

/* ── Signature ────────────────────────────────────────────── */
.dc-signature {
  font-size: 12pt;
  color: #000000;
  line-height: 1.3;
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
/* โลโก้ฝังของระบบใน document header — ใช้ class เดียวกับ body
   ⚠️ ต้องกำหนด width/height ชัดเจน เพราะ span ว่างไม่มี intrinsic size
      (max-* อย่างเดียว + auto = กล่องยุบเป็น 0 → โลโก้ไม่เห็น)
      ขนาดตรงนี้ตั้งใจให้เท่ากรอบ placeholder เดิม (120x56) */
.dc-doc-header__logo .dc-logo__image {
  width: 120px;
  height: 56px;
  background-position: left center;
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

/**
 * ประกอบ CSS ที่ส่งให้ consumer (รวมตัวโลโก้ฝัง)
 *
 * ⚠️ ส่งโลโก้ผ่านทางนี้ ไม่ใช่ inline ใน `src=""` ของ <img> เพราะ:
 *   - HTML attribute ไม่รองรับ var()
 *   - ถ้า inline base64 ลงทุก <img> จะ copy payload 238KB ซ้ำตามจำนวน block
 *
 * payload จึงปรากฏ "ครั้งเดียวต่อ response" เสมอ ไม่ว่า descriptor จะมี
 * logo block กี่อัน (หรือแม้แต่ไม่มี — ถ้าไม่มีก็ไม่ต้องแนบไปเลย)
 *
 * ⚠️ memoized: string 238KB ถูกสร้างครั้งเดียวต่อ isolate แล้วนำมา reuse
 *    ทุก request → ไม่มีการ copy ซ้ำแม้แต่ครั้งเดียวต่อ render
 */
let builtStylesCache: string | null = null;

function buildStyles(): string {
  if (builtStylesCache !== null) return builtStylesCache;

  const logoUri = resolveInlineLogoDataUri();
  builtStylesCache = logoUri
    ? `${PREVIEW_STYLES}\n:root { ${INLINE_LOGO_VAR}: url("${logoUri}"); }`
    : PREVIEW_STYLES;

  return builtStylesCache;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Pure renderer: DocumentDescriptor + ApplicationContext → HTML Preview
 *
 * 🔑 Preview เป็น **เอกสาร** ไม่ใช่ฟอร์ม
 *    ทุก field render เป็น "ป้ายกำกับ + ค่า" เหมือน PDF เสมอ
 *    → ไม่มี form control (input / textarea / select / checkbox / radio)
 *
 * @param descriptor - DocumentDescriptor (validated input)
 * @param ctx - ApplicationContext (data ที่ใช้ resolve field values)
 * @param options - render options
 * @param options.mode - โหมดการ render (คงไว้เพื่อ backward compatibility
 *                       กับ client เดิมที่ยังส่งค่ามา)
 *
 *                       ⚠️ ทุกโหมดให้ผลลัพธ์**เหมือนกัน** (document เท่านั้น)
 *                          ไม่มี form control ในทุกกรณี
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
  // ⚠️ โหมดถูก normalize เป็น "document" เสมอ
  //   (Preview = เอกสาร → ไม่มี form control ไม่ว่า client จะส่งโหมดอะไรมา)
  const mode: PreviewMode = "document";
  void options.mode;
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

  return { html, body, header, styles: buildStyles(), meta, mode, tokens: tokensInfo, page };
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
  const pt = HEADING_SIZE_TO_PT[block.size];
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
 * mirror descriptor-renderer.ts:drawField (label + value) — **ไม่มี form control**
 *
 * 🔑 Preview = เอกสาร (ไม่ใช่ฟอร์ม)
 *   - field ทุกชนิด render เป็น "ป้ายกำกับ + ค่า" เหมือน PDF ทุกประการ
 *   - ห้าม emit <input> / <textarea> / <select> / checkbox / radio
 *     (preview เป็น read-only view เสมอ — ไม่มีช่องให้กรอก)
 *
 * Safety:
 *   - ทุกค่าถูก escape ก่อนใส่ HTML (XSS)
 *   - ไม่ inject event handler / script ใด ๆ
 */
function renderFieldBlock(
  field: FieldData,
  block: Extract<DocumentBlock, { type: "field" }>,
  ctx: ApplicationContext,
  mode: PreviewMode
): string {
  // `mode` เก็บไว้เพื่อ symmetry กับ renderBlock / renderTableBlock
  // และให้ signature ของ renderer ทั้งชุดตรงกัน (ไม่มีผลกับ output แล้ว)
  void mode;
  const rawValue = resolveAnswerValue(field, ctx);
  const label = block.label ?? field.label;
  // ── Requirement E: required marker เป็น optional toggle ────────────
  const showRequired = block.showRequired ?? true;
  const requiredMarker = field.isRequired && showRequired ? " *" : "";

  // ── Requirement E: layout stacked (default) | inline ────────────────
  const layout = block.layout ?? "stacked";
  const layoutClass = layout === "inline" ? " dc-field--inline" : " dc-field--stacked";

  const align = (block.align ?? DEFAULT_ALIGN) as Align;
  const alignClass = ALIGN_TO_CLASS[align];
  const marginTop = block.marginTop ?? 0;
  const marginBottom = block.marginBottom ?? 0;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join("; ")}"` : "";

  const labelPt = FIELD_LABEL_SIZE_TO_PT[block.labelStyle ?? "small"];
  const valuePt = FIELD_VALUE_SIZE_TO_PT[block.valueStyle ?? "medium"];

  const showLabel = block.showLabel ?? true;

  // ── parity M7: indent ซ้ายของ value ต้องมีเงื่อนไขเดียวกับ PDF
  // (descriptor-renderer.ts:drawField — valueX = contentLeft + 12pt
  //  เฉพาะเมื่อ showLabel && layout=stacked && align=left)
  const indentClass =
    layout === "stacked" && showLabel && align === "left"
      ? " dc-field__value--indent"
      : "";

  // ── Preview = เอกสารเสมอ (ไม่มี form control) ──────────────────────
  //   value render เป็นข้อความ label + value ชุดเดียวกับ PDF renderer
  //   → ไม่มี <input> / <textarea> / <select> / checkbox / radio ใน output
  const valueHtml = renderDocumentValue(field, rawValue, ctx, valuePt, indentClass);

  const emptyClass = !isNonEmptyValue(rawValue) ? " dc-field--empty" : "";

  // ── Requirement E: showLabel (default: true) ─────────────────────
  //  - ซ่อน label แล้ว → ไม่ emit <label> เลย (read-only mode ไม่ต้องมี label tag)
  const labelHtml = showLabel
    ? `<span class="dc-field__label" style="font-size: ${labelPt}pt">${escapeHtml(label)}<span class="dc-field__required">${requiredMarker}</span></span>`
    : "";

  // layout inline → ห่อ label + value ไว้ใน wrapper เดียวกัน
  const bodyInner = `${labelHtml}\n    ${valueHtml}`;
  const bodyHtml =
    layout === "inline" ? `<div class="dc-field__body">${bodyInner}</div>` : bodyInner;

  return `<section class="dc-field dc-block ${alignClass}${layoutClass}${emptyClass}"${styleAttr}>
    ${bodyHtml}
  </section>`;
}

/**
 * Render field value เป็นข้อความ read-only (เหมือน PDF ทุกประการ)
 *
 * 🔑 Preview เป็น "เอกสาร" ไม่ใช่ "ฟอร์ม"
 *   - ห้าม emit form control ใด ๆ (input/textarea/select/checkbox/radio)
 *   - ค่าว่าง → placeholder สีเทา (parity กับ PDF COLOR_PLACEHOLDER)
 *   - MASTER_DATA / array → format เดียวกับ PDF renderer
 *
 * หมายเหตุ: โครงสร้างนี้ตรงกับ `descriptor-renderer.ts:drawField`
 *   ซึ่งใช้ `formatAnswerValueForDisplay()` ชุดเดียวกัน
 */
function renderDocumentValue(
  field: FieldData,
  rawValue: unknown,
  ctx: ApplicationContext,
  valuePt?: number,
  extraClass = ""
): string {
  const fontStyle = valuePt ? ` style="font-size: ${valuePt}pt"` : "";
  // Empty marker = "-" มาตรฐานเดียวกับ PDF (formatAnswerValueForDisplay) —
  // เดิม HTML ใช้ "(ว่าง)" ทำให้ HTML Preview กับ PDF แสดงค่าว่างคนละรูป
  if (!isNonEmptyValue(rawValue)) {
    return `<div class="dc-field__value dc-field__value--empty${extraClass}"${fontStyle}>-</div>`;
  }
  // CHECKBOX / RADIO → แสดงค่าเป็นข้อความ (ไม่ใช่กล่องติ๊ก)
  //   boolean → "ใช่"/"ไม่ใช่" ผ่าน formatAnswerValueForDisplay เดียวกับ PDF
  //   "อื่นๆ (โปรดระบุ)" → "อื่นๆ: <ข้อความ>" (formatFieldValueWithOther)
  const display = formatFieldValueWithOther(
    field.fieldId,
    formatAnswerValueForDisplay(rawValue),
    ctx.application.formData
  );
  return `<div class="dc-field__value${extraClass}"${fontStyle}>${escapeHtml(display)}</div>`;
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
      ? `<div class="dc-table-label" style="font-weight:700;font-size:11pt;margin-bottom:4px">${escapeHtml(tableLabel)}</div>`
      : "";
    // parity L6: empty text ใช้ class ของตัวเอง — PDF วาด 12pt เทา regular
    // (เดิม reuse .dc-field__value → ดำ 13pt + italic)
    return `<section class="dc-table-wrap dc-table--empty dc-block ${alignClass}"${styleAttr}>
      ${labelHtml}
      <div class="dc-table__empty">${escapeHtml(emptyText)}</div>
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
    ? `<div class="dc-table-label" style="font-weight:700;font-size:11pt;margin-bottom:4px">${escapeHtml(tableLabel)}</div>`
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
 *     - "organization" → โลโก้หน่วยงาน (SAO logo — ใช้ asset ชุดเดียวกับ PDF)
 *     - "upload"       → รูปที่อัปโหลดเอง (ยังไม่มี asset storage)
 *
 *   ถ้าไม่มีโลโก้ → แสดง "ยังไม่มีโลโก้"
 *   ห้ามแสดงกรอบรูปว่าง / <img src=""> (เคยเป็นบั๊ก — src="" โหลด page เดิม)
 *
 *   ── ทำไมใช้ data URI แทน http URL (สำคัญต่อ performance) ────────────────
 *   ตาราง `organizations` ไม่มี column logo และไม่มี admin asset storage
 *   → ระบบไม่มี URL สาธารณะที่ browser โหลดโลโก้ได้โดยตรง
 *
 *   แต่ PDF มี asset จริงอยู่แล้ว (`assets/logo-loader.ts`)
 *   และ `sanitizeImageUrl()` ปฏิเสธ data URI ที่ยาวเกิน 4096 ตัวอักษร
 *   (มีไว้กัน base64 ขนาดใหญ่) → โลโก้จริง 238KB จะถูกกรองทิ้งเสมอ
 *
 *   ✅ ทางแก้: ฝัง base64 **ครั้งเดียวต่อ document** เป็น CSS custom property
 *   บน `.dc-preview` แล้วให้ทุก <img> อ้างผ่าน `var(--dc-logo-src)`
 *   → payload ไม่โตตามจำนวน logo block
 *   → ไม่มี request แยก / ไม่มี risk จาก cross-origin (sandbox="allow-same-origin")
 *
 *   ── Safety (Requirement K.5) ────────────────────────────────────────────
 *   URL ที่มาจาก descriptor (upload) ถูก validate ก่อนใส่ใน src=""
 *   (http/https/data:image เท่านั้น) และ escape attribute เสมอ
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

  // ── source = "none" → ไม่มีเนื้อหา แต่ยังเก็บ margin (parity L10) ──
  // PDF: buildRenderPlan ยัง push padding commands ของ marginTop/marginBottom
  // → Preview ต้อง emit element เปล่าที่มี margin เท่ากัน (เดิม return "" ทำให้
  //   margin หายไป ตำแหน่ง block ถัดไปเลื่อนต่างจาก PDF)
  if (block.source === "none") {
    return `<div class="dc-block dc-logo dc-logo--none ${alignClass}"${styleAttr}></div>`;
  }

  // ── ขนาด (รักษา aspect ratio: ถ้าไม่ระบุ height ให้ auto) ──────────
  const width = clampSize(block.width, DEFAULT_LOGO_WIDTH);
  // ใช้ height เฉพาะเมื่อ Admin ระบุ — CSS `height:auto` จะรักษา ratio ให้
  const height = block.height ? `height: ${clampSize(block.height, DEFAULT_LOGO_WIDTH)}px;` : "height: auto;";
  const sizeStyle = `width: ${width}px; ${height}`;

  // ── เลือก URL ตาม source ───────────────────────────────────────────
  //  organization → LOGO_SOURCE_URLS (มีค่า = inline SAO logo แล้ว)
  //  upload       → parity L10: PDF **ไม่ render imageUrl เลย** (ยังไม่มี
  //                 asset storage — drawLogo วาดข้อความ "ยังไม่มีโลโก้ (upload)")
  //                 → Preview ห้ามแสดงรูปเอง ไม่งั้น Preview มีรูปแต่ PDF ไม่มี
  const source = block.source ?? "organization";
  const rawUrl =
    source === "organization"
      ? LOGO_SOURCE_URLS.get("organization") ?? null
      : null;

  // ── โลโก้ฝัง (organization) → ยิงผ่าน CSS var (ประหยัด payload) ─────────
  //  ⚠️ HTML attribute (src="var(...)") **ไม่รองรับ** var() เพราะ attribute
  //     ไม่ใช่ CSS declaration → ใช้ element ที่ไม่มี src แล้วให้ CSS
  //     `background-image: var(--dc-logo-src)` เป็นตัวแสดงผลแทน
  //
  //  ⚠️ ต้องส่ง height เป็นตัวเลขเสมอ (ไม่ใช่ auto) สำหรับโลโก้ฝัง
  //     เพราะ span ว่าง + background-image ไม่มี intrinsic size
  //     → height:auto จะยุบเป็น 0 และโลโก้ไม่เห็น (ยืนยันด้วย screenshot)
  //     แก้โดยคำนวณจาก aspect ratio ของ PNG จริง (ดู getInlineLogoAspectRatio)
  if (rawUrl !== null && rawUrl !== "" && rawUrl === INLINE_LOGO_SRC) {
    const alt = escapeHtml(block.alt ?? "โลโก้หน่วยงาน");
    const ratio = getInlineLogoAspectRatio();
    const resolvedHeight = block.height
      ? clampSize(block.height, DEFAULT_LOGO_WIDTH)
      : Math.max(1, Math.round(width * ratio));
    return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
      <span class="dc-logo__image" role="img" aria-label="${alt}" style="width: ${width}px; height: ${resolvedHeight}px;"></span>
    </section>`;
  }

  const safeUrl = sanitizeImageUrl(rawUrl);

  if (safeUrl === null) {
    // ── ไม่มีโลโก้ → ข้อความสีเทา (parity L10 กับ PDF drawLogoText —
    //    upload แสดง note "(upload)" เหมือนกันทุกไบต์) ──────────────────
    const note =
      source === "upload" ? `${NO_LOGO_TEXT} (upload)` : NO_LOGO_TEXT;
    return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
      <span class="dc-logo__placeholder">${escapeHtml(note)}</span>
    </section>`;
  }

  const alt = escapeHtml(block.alt ?? "โลโก้หน่วยงาน");
  return `<section class="dc-block dc-logo ${alignClass}"${styleAttr}>
    <img src="${escapeHtml(safeUrl)}" alt="${alt}" style="${sizeStyle}" />
  </section>`;
}

/**
 * sentinel เทียบว่า URL ที่ resolve ได้เป็นโลโก้ฝังของระบบหรือไม่
 *
 * ใช้ค่า identity (สั้น) แทนการเทียบ data URI ยาว 238KB ทุกครั้งที่ render
 */
const INLINE_LOGO_SRC = "\u0000inline-sao-logo";

/**
 * ชื่อ CSS custom property ที่เก็บ data URI ของโลโก้
 *
 * ใช้กับ CSS `background-image: var(--dc-logo-src)` เท่านั้น
 */
const INLINE_LOGO_VAR = "--dc-logo-src";

/** PNG signature (8 bytes) สำหรับตรวจว่า base64 นี้เป็น PNG จริง */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** fallback aspect ratio (h/w) = 1 เมื่ออ่าน header ไม่ได้ */
const DEFAULT_LOGO_ASPECT_RATIO = 1;

/**
 * อ่าน aspect ratio (height / width) ของโลโก้ฝังจาก PNG header
 *
 * ── ทำไมต้องรู้ ratio ──────────────────────────────────────────────────────
 *   PDF renderer ใช้ `logo.height / logo.width` เพื่อรักษาสัดส่วนรูป
 *   (ดู descriptor-renderer.ts drawLogo)
 *   ส่วน HTML ฝั่งนี้ใช้ background-image → span ว่างไม่มี intrinsic size
 *   จึงต้องคำนวณ height เองจาก ratio เดียวกัน ไม่งั้นโลโก้จะยุบ/บิดเบี้ยว
 *
 * IHDR ของ PNG อยู่ที่ byte 16..24 (big-endian uint32):
 *   16..20 = width, 20..24 = height
 *
 * @returns height/width (memoized — อ่านครั้งเดียวต่อ isolate)
 */
let inlineLogoAspectRatio: number | null = null;

function getInlineLogoAspectRatio(): number {
  if (inlineLogoAspectRatio !== null) return inlineLogoAspectRatio;
  inlineLogoAspectRatio = DEFAULT_LOGO_ASPECT_RATIO;

  try {
    // decode เฉพาะ header (base64 4 ตัวอักษรแรก = ~3 bytes) ไม่ต้อง decode ทั้งไฟล์
    const headerB64 = SAO_LOGO_BASE64.slice(0, 32);
    const binary = atob(headerB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const isPng = PNG_SIGNATURE.every((b, i) => bytes[i] === b);
    if (!isPng || bytes.length < 24) return inlineLogoAspectRatio;

    const view = new DataView(bytes.buffer);
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    if (w > 0 && h > 0) {
      inlineLogoAspectRatio = h / w;
    }
  } catch {
    // อ่านไม่ได้ → ใช้ค่า fallback (1) ไม่ทำให้ preview ล้ม
  }

  return inlineLogoAspectRatio;
}

/**
 * data URI ของโลโก้หน่วยงาน (SAO logo)
 *
 * ⚠️ lazy (memoized) — ไม่ inline ค่าไว้ที่ top-level เพื่อไม่ให้
 *    ทุก module ที่ import renderer ต้องแบก payload 238KB (และ test ที่ไม่ได้
 *    เรียก logo path ด้วย)
 *
 *    resolveInlineLogoDataUri() ถูกเรียกครั้งเดียวตอน render จริง
 *    แล้วแทรกลง <head> เป็น style ที่ผูกกับ token ตัวเดียว
 *
 * memoized: string 238KB เป็น immutable → สร้างครั้งเดียวต่อ isolate
 * แล้ว reuse ทุก request (ไม่ leak เพราะไม่มีข้อมูลต่อ user/tenant)
 */
let inlineLogoDataUri: string | null | undefined;

function resolveInlineLogoDataUri(): string | null {
  if (inlineLogoDataUri !== undefined) return inlineLogoDataUri;
  try {
    const png = SAO_LOGO_BASE64;
    inlineLogoDataUri =
      typeof png === "string" && png.length > 0 ? `data:image/png;base64,${png}` : null;
  } catch {
    // ไม่มี asset (เช่น CI ที่ไม่ได้รัน build:assets) → ไม่ทำให้ preview ล้ม
    inlineLogoDataUri = null;
  }
  return inlineLogoDataUri;
}

/**
 * URL ของโลโก้หน่วยงานที่ resolve ได้จริง
 *
 * ปัจจุบัน resolve ได้จาก asset เดียวกับ PDF (`assets/sao-logo.data.ts`)
 * เมื่อมี column `logo` ใน `organizations` หรือ admin upload ในอนาคต
 * ให้เติม key "organization" ที่นี่ที่เดียว (renderer อื่นไม่ต้องแก้)
 */
const LOGO_SOURCE_URLS = new Map<string, string>();

/**
 * Register โลโก้ฝังในเป็น "organization source" (single source of truth)
 *
 * ⚠️ เรียกครั้งเดียวตอน module init — ทำให้ทั้ง `renderLogoBlock()` (body)
 * และ `renderDocumentHeader()` (header) เห็นค่าเดียวกันโดยไม่ต้องแก้ renderer
* ส่วนอื่น และทำให้โลโก้ใน HTML Preview ตรงกับ PDF (ใช้ asset ชุดเดียวกัน)
 *
 * ค่า sentinel (ไม่ใช่ data URI จริง) → payload 238KB ไม่ถูก copy ลง Map
 * ซ้ำ ๆ; data URI จริงถูกส่งผ่าน CSS var ครั้งเดียวต่อ response
 */
LOGO_SOURCE_URLS.set("organization", resolveInlineLogoDataUri() ? INLINE_LOGO_SRC : "");

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

  const labelPt = SYSTEMDATA_SIZE_TO_PT[block.labelStyle ?? "small"];
  const valuePt = SYSTEMDATA_SIZE_TO_PT[block.valueStyle ?? "medium"];

  const labelHtml = showLabel
    ? `<div class="dc-systemdata__label" style="font-size: ${labelPt}pt">${escapeHtml(label)}</div>`
    : "";
  // ── parity M7: indent เฉพาะ showLabel && stacked && left
  // (เงื่อนไขเดียวกับ PDF drawSystemData — valueX = contentLeft + 12pt)
  const valueIndentClass =
    showLabel && layout === "stacked" && align === "left"
      ? " dc-systemdata__value--indent"
      : "";
  const valueHtml = `<div class="dc-systemdata__value${valueIndentClass}" style="font-size: ${valuePt}pt">${escapeHtml(valueText)}</div>`;

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
 *   9. showTime     (default false) — แสดง "เวลา HH:mm น." (จาก submittedAt
 *      เสมอ แม้ dateSource=PRINT_DATE — เวลาไทย Asia/Bangkok ผ่าน formatter
 *      กลาง formatThaiTime ที่ document-tokens.ts)
 *
 * ── Fallback (เมื่อไม่มี application) ────────────────────────────────────
 *   - ชื่อ: "(ชื่อผู้สมัคร)"
 *   - วันที่: "______________"
 *   - เวลา (showTime=true): "______________"
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
  const size: Size = block.size ?? "medium";
  const fontSize = SIGNATURE_SIZE_TO_PT[size] ?? SIGNATURE_SIZE_TO_PT.medium;

  const styleParts: string[] = [];
  if (marginTop > 0) styleParts.push(`margin-top: ${marginTop}pt`);
  if (marginBottom > 0) styleParts.push(`margin-bottom: ${marginBottom}pt`);
  styleParts.push(`font-size: ${fontSize}pt`);
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

  // ── Line 5: เวลา (ถ้า showTime) ──────────────────────────────────
  //  Parity กับ PDF (descriptor-renderer.ts drawSignature Line 5):
  //  - ข้อความ `เวลา ${timeText} น.` (รวม suffix " น.") ทุกไบต์
  //  - เวลาจริง = สีดำ / ไม่มี submittedAt = `เวลา ______________ น.`
  //    สี placeholder (เหมือนบรรทัดวันที่)
  if (showTime) {
    const timeColor =
      timeText === "______________" ? " dc-signature__placeholder" : "";
    bodyParts.push(
      `<div class="dc-signature__time${timeColor}">เวลา ${escapeHtml(timeText)} น.</div>`
    );
  }

  return `<section class="dc-signature dc-block ${alignClass}"${styleAttr}>
    ${bodyParts.join("\n    ")}
  </section>`;
}

/** ชนิดของ dateSource ที่ renderer รองรับ (หลัง normalize ค่า legacy แล้ว) */
type SignatureDateSourceKind = "APPLICATION_DATE" | "PRINT_DATE" | "none";

// ── placeholder ชื่อผู้ลงนาม ────────────────────────────────────────────
// parity M2: SIGNATURE_NAME_PLACEHOLDER / SIGNATURE_NAME_HINT import จาก
// types.ts เป็น single source ของทั้ง Preview และ PDF (เดิมประกาศ local
// ทำให้ฝั่ง PDF ใช้ "(ชื่อผู้สมัคร)" ติดวงเล็บ — ขัด showParentheses=false)

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
<style>${buildStyles()}</style>
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

  // ── โลโก้ใน header: ใช้โลโก้จริงชุดเดียวกับ body + PDF ───────────────
  //  ถ้าไม่มี asset → placeholder "ยังไม่มีโลโก้" (พฤติกรรมเดิม)
  const hasInlineLogo = LOGO_SOURCE_URLS.get("organization") === INLINE_LOGO_SRC;
  const headerLogo = hasInlineLogo
    ? `<span class="dc-logo__image" role="img" aria-label="โลโก้หน่วยงาน"></span>`
    : `<span class="dc-doc-header__logo-placeholder">${NO_LOGO_TEXT}</span>`;

  return `<header class="dc-doc-header">
  <div class="dc-doc-header__logo">
    ${headerLogo}
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
 *   - FILE field ไม่มีค่าใน formData (apply flow เก็บใน attachments) →
 *     resolve จาก ctx.attachments ผ่าน resolveFileAttachmentValue ตัวเดียวกัน
 *   - fallback: null
 */
function resolveAnswerValue(
  field: FieldData,
  ctx: ApplicationContext
): unknown {
  const formData = (ctx.application.formData ?? {}) as Record<string, unknown>;
  const raw =
    formData[field.fieldId] ??
    formData[field.pdfMappingKey ?? ""] ??
    null;

  if (field.type === "FILE" && (raw === null || raw === "")) {
    return resolveFileAttachmentValue(field.fieldId, ctx);
  }
  return raw;
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
 * mirror descriptor-renderer.ts:formatCellValue (parity M4)
 *
 * ── Requirement F.6 / F.7: ห้ามแสดง JSON ดิบ ──────────────────────────────
 * object (เช่น MASTER_DATA `{ id, name }`) → ใช้ display label
 * ตาม schema จริง (`name` → `label` → `id` → "—") เหมือน PDF ทุกไบต์
 * (เดิมฝั่ง Preview ใช้ JSON.stringify ตัด 200 ตัว ทำให้ cell เป็น JSON
 *  ขณะที่ PDF แสดง display label)
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// =============================================================================
// Thai date/time formatting — ใช้ formatThaiDate/formatThaiTime/THAI_MONTHS
// จาก document-tokens (Asia/Bangkok fixed offset) — เดิมมี local copy ที่ใช้
// local getters ทำให้วันที่/เวลาเป็น UTC บน Workers (ดู test
// pdf-thai-date-format.test.ts) — THAI_MONTHS ยังใช้ที่ parse วันที่ในฟอร์ม
// =============================================================================

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
