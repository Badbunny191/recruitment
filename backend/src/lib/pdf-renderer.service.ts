/**
 * PDF V1 — Renderer Service
 *
 * Pure function: ApplicationContext → PDF bytes
 *
 * ไม่ผูกกับ HTTP layer, Drizzle schema, หรือ R2
 * ไม่มี template engine
 * ไม่ hardcode field names
 *
 * Layout:
 *   - Fixed Header (logo + title + round + applicationNo + date)
 *   - Dynamic Body (sections + fields จาก template)
 *   - Fixed Footer (date + page number)
 *
 * Pagination:
 *   - pdf-lib ไม่มี auto-wrap ข้อความ
 *   - wrapText() คำนวณจำนวนบรรทัดจริง (ไม่ใช้ fixed counts)
 *   - heightForWrappedText() คำนวณความสูง block จาก wrap จริง
 *   - ensureSpace() ตรวจ reserved height ก่อนวาด → addPage ถ้าไม่พอ
 *   - ทุก state.y decrement ต้องสะท้อนใน blockHeight (invariant)
 */

import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb } from 'pdf-lib';
import { loadSarabunFonts } from './fonts/font-loader';
import { loadSaoLogo } from './assets/logo-loader';
import {
  ApplicationContext,
  FieldData,
  SectionData,
  APPLICATION_STATUS_LABELS,
  RenderedPdf,
} from './pdf-types';
import { formatFieldValueWithOther } from './other-option';
// =============================================================================
// Layout Constants
// =============================================================================

const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN = 40;
const HEADER_HEIGHT = 110; // Header reserve space
const FOOTER_HEIGHT = 50; // Footer reserve space
const CONTENT_TOP = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Field indent (left padding for value text under a label)
const FIELD_VALUE_INDENT = 12;
const FIELD_VALUE_INNER_WIDTH = CONTENT_WIDTH - FIELD_VALUE_INDENT;

const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SUBTITLE = 11;
const FONT_SIZE_BODY = 12;
const FONT_SIZE_SMALL = 10;
const FONT_SIZE_SECTION = 13;
const FONT_SIZE_LABEL = 11;
const LINE_HEIGHT = 1.4;

// Block spacing (in pt) — must match the actual `state.y` decrements below.
const LABEL_TO_VALUE_GAP = 4;   // gap between label and value (apply state.y -= GAP)
const POST_BLOCK_SPACING = 8;   // spacing after a single field block
const POST_SECTION_SPACING = 8; // spacing after a whole section
const PRE_SECTION_SPACING = 8;  // spacing before a section header

// Colors
const COLOR_PRIMARY = rgb(0.05, 0.27, 0.51); // Dark blue
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.4, 0.4, 0.4);
const COLOR_LIGHT_GRAY = rgb(0.85, 0.85, 0.85);

// =============================================================================
// Renderer State (mutable cursor during rendering)
// =============================================================================

interface RenderState {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: { regular: PDFFont; bold: PDFFont };
  logo: PDFImage | null;
  generatedAt: number;
  pageNumber: number;
  applicationNo: string;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Render ApplicationContext → PDF bytes
 */
export async function renderApplicationPdf(
  ctx: ApplicationContext
): Promise<RenderedPdf> {
  // 1. Setup
  const doc = await PDFDocument.create();
  const fonts = await loadSarabunFonts(doc);
  const logo = await loadSaoLogo(doc);

  const generatedAt = Math.floor(Date.now() / 1000);

  // 2. Create first page
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const state: RenderState = {
    doc,
    page,
    y: CONTENT_TOP,
    fonts,
    logo,
    generatedAt,
    pageNumber: 1,
    applicationNo: ctx.application.applicationNo,
  };

  // 3. Render Fixed Header
  renderHeader(state, ctx);

  // 4. Render Dynamic Body
  renderBody(state, ctx);

  // 5. Render Fixed Footer (last)
  renderFooter(state);

  // 6. Serialize
  const bytes = await doc.save();
  return {
    bytes,
    pageCount: doc.getPageCount(),
    generatedAt,
  };
}

// =============================================================================
// Fixed Header
// =============================================================================

function renderHeader(state: RenderState, ctx: ApplicationContext): void {
  const { page, fonts, logo } = state;

  // Logo (centered, top) — resize to ~70px wide
  if (logo) {
    const targetWidth = 70;
    const aspectRatio = logo.height / logo.width;
    const targetHeight = targetWidth * aspectRatio;
    const logoX = (PAGE_WIDTH - targetWidth) / 2;
    const logoY = PAGE_HEIGHT - MARGIN - targetHeight;

    page.drawImage(logo, {
      x: logoX,
      y: logoY,
      width: targetWidth,
      height: targetHeight,
    });
  }

  // Title: "ใบสมัคร" (centered, below logo)
  const titleY = PAGE_HEIGHT - MARGIN - (logo ? 80 : 0) - 10;
  drawTextCentered(page, 'ใบสมัคร', PAGE_WIDTH / 2, titleY, {
    font: fonts.bold,
    size: FONT_SIZE_TITLE,
    color: COLOR_PRIMARY,
  });

  // Subtitle: Round title
  const subtitleY = titleY - FONT_SIZE_TITLE * LINE_HEIGHT;
  drawTextCentered(
    page,
    ctx.round.title,
    PAGE_WIDTH / 2,
    subtitleY,
    { font: fonts.regular, size: FONT_SIZE_SUBTITLE, color: COLOR_BLACK }
  );

  // Application info (right-aligned, below subtitle)
  const infoY = subtitleY - FONT_SIZE_SUBTITLE * LINE_HEIGHT - 8;
  const statusLabel = APPLICATION_STATUS_LABELS[ctx.application.status] ?? ctx.application.status;
  const submittedDate = formatThaiDate(ctx.application.submittedAt);

  // Right column: "เลขใบสมัคร: XXX" / "สถานะ: XXX" / "วันที่สมัคร: XXX"
  page.drawText(`เลขใบสมัคร: ${ctx.application.applicationNo}`, {
    x: PAGE_WIDTH - MARGIN - measureText(`เลขใบสมัคร: ${ctx.application.applicationNo}`, fonts.regular, FONT_SIZE_SMALL),
    y: infoY,
    font: fonts.regular,
    size: FONT_SIZE_SMALL,
    color: COLOR_BLACK,
  });

  page.drawText(`สถานะ: ${statusLabel}`, {
    x: PAGE_WIDTH - MARGIN - measureText(`สถานะ: ${statusLabel}`, fonts.regular, FONT_SIZE_SMALL),
    y: infoY - FONT_SIZE_SMALL * LINE_HEIGHT,
    font: fonts.regular,
    size: FONT_SIZE_SMALL,
    color: COLOR_BLACK,
  });

  page.drawText(`วันที่สมัคร: ${submittedDate}`, {
    x: PAGE_WIDTH - MARGIN - measureText(`วันที่สมัคร: ${submittedDate}`, fonts.regular, FONT_SIZE_SMALL),
    y: infoY - FONT_SIZE_SMALL * LINE_HEIGHT * 2,
    font: fonts.regular,
    size: FONT_SIZE_SMALL,
    color: COLOR_BLACK,
  });

  // Divider line
  const dividerY = infoY - FONT_SIZE_SMALL * LINE_HEIGHT * 3 - 8;
  page.drawLine({
    start: { x: MARGIN, y: dividerY },
    end: { x: PAGE_WIDTH - MARGIN, y: dividerY },
    thickness: 0.5,
    color: COLOR_GRAY,
  });

  // Update y position for body to start after divider
  state.y = dividerY - 10;
}

// =============================================================================
// Dynamic Body
// =============================================================================

function renderBody(state: RenderState, ctx: ApplicationContext): void {
  const { sections, fields } = ctx;

  // Group fields by section
  const sectionMap = groupFieldsBySection(sections, fields);

  // Render each section
  for (const { section, fields: sectionFields } of sectionMap) {
    renderSection(state, section, sectionFields, ctx);
  }

  // Render unsectioned fields (sectionId === null) at the end
  const unsectionedFields = fields.filter(f => f.sectionId === null);
  if (unsectionedFields.length > 0) {
    renderSection(state, null, unsectionedFields, ctx);
  }
}

interface SectionGroup {
  section: SectionData | null;
  fields: FieldData[];
}

function groupFieldsBySection(
  sections: SectionData[],
  fields: FieldData[]
): SectionGroup[] {
  const groups: SectionGroup[] = [];

  // Active sections (isActive)
  const activeSections = sections.filter(s => s.id); // all sections here are active
  for (const section of activeSections) {
    const sectionFields = fields
      .filter(f => f.sectionId === section.id)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    if (sectionFields.length > 0) {
      groups.push({ section, fields: sectionFields });
    }
  }

  return groups;
}

function renderSection(
  state: RenderState,
  section: SectionData | null,
  fields: FieldData[],
  ctx: ApplicationContext
): void {
  // Section header (only if section has a name)
  if (section?.name) {
    // Reserved: section line + post-section spacing (used between this
    // header and the FIRST field of this section — the field block itself
    // does not need extra pre-spacing because POST_BLOCK_SPACING already
    // provides visual separation).
    const headerHeight = FONT_SIZE_SECTION * LINE_HEIGHT;
    ensureSpace(state, headerHeight + PRE_SECTION_SPACING);

    drawText(state.page, section.name, MARGIN, state.y, {
      font: state.fonts.bold,
      size: FONT_SIZE_SECTION,
      color: COLOR_PRIMARY,
    });
    state.y -= headerHeight;
    // No extra spacing here — the first field's blockHeight already
    // includes POST_BLOCK_SPACING which acts as visual gap.
    // But we still want a small breathing room before the first label,
    // so subtract PRE_SECTION_SPACING here (matches reservation above).
    state.y -= PRE_SECTION_SPACING;
  }

  // Render each field
  for (const field of fields) {
    renderField(state, field, ctx);
  }

  // Spacing after section — apply only when section has a name.
  // (Unsectioned fields don't need this extra gap because the next
  // field's POST_BLOCK_SPACING is sufficient.)
  if (section?.name) {
    state.y -= POST_SECTION_SPACING;
  }
}

function renderField(
  state: RenderState,
  field: FieldData,
  ctx: ApplicationContext
): void {
  const rawValue = resolveAnswerValue(field, ctx);
  const displayValue = formatFieldValueWithOther(
    field.fieldId,
    formatAnswerValue(field, rawValue),
    ctx.application.formData
  );

  // Heights — derived from wrapped lines, never from fixed counts.
  const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
  const valueLines = wrapText(displayValue, FIELD_VALUE_INNER_WIDTH, state.fonts.regular, FONT_SIZE_BODY);
  const valueHeight = heightForWrappedText(valueLines, FONT_SIZE_BODY);

  // Total reserved height = label + gap + value + post-block spacing.
  // MUST equal the sum of state.y decrements below, otherwise either
  // pagination breaks or blocks overlap.
  const blockHeight =
    labelHeight
    + LABEL_TO_VALUE_GAP
    + valueHeight
    + POST_BLOCK_SPACING;

  // Ensure space — if not enough, add new page (uses reserved height).
  ensureSpace(state, blockHeight);

  // Draw label (uses font.bold for label, indent 0).
  drawText(
    state.page,
    `${field.label}${field.isRequired ? ' *' : ''}`,
    MARGIN,
    state.y,
    {
      font: state.fonts.bold,
      size: FONT_SIZE_LABEL,
      color: COLOR_GRAY,
    }
  );
  state.y -= labelHeight;

  // Gap between label and value (must match blockHeight reservation).
  state.y -= LABEL_TO_VALUE_GAP;

  // Draw value lines — one draw per wrapped line. Each line uses the
  // same FONT_SIZE_BODY * LINE_HEIGHT height. Empty lines still occupy
  // height (they represent hard newlines).
  for (const line of valueLines) {
    drawText(
      state.page,
      line,
      MARGIN + FIELD_VALUE_INDENT,
      state.y,
      {
        font: state.fonts.regular,
        size: FONT_SIZE_BODY,
        color: COLOR_BLACK,
      }
    );
    state.y -= FONT_SIZE_BODY * LINE_HEIGHT;
  }

  // Post-block spacing (must match blockHeight reservation).
  state.y -= POST_BLOCK_SPACING;
}

// =============================================================================
// Fixed Footer
// =============================================================================

function renderFooter(state: RenderState): void {
  const { doc, page, fonts, generatedAt, pageNumber } = state;
  const totalPages = doc.getPageCount();
  const dateStr = formatThaiDate(generatedAt);

  // Draw footer on every page
  for (let i = 0; i < totalPages; i++) {
    const p = doc.getPage(i);
    const pageNum = i + 1;

    // Footer divider
    p.drawLine({
      start: { x: MARGIN, y: MARGIN + FOOTER_HEIGHT - 8 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + FOOTER_HEIGHT - 8 },
      thickness: 0.3,
      color: COLOR_LIGHT_GRAY,
    });

    // Generated date (left)
    p.drawText(`วันที่สร้าง PDF: ${dateStr}`, {
      x: MARGIN,
      y: MARGIN + 10,
      font: fonts.regular,
      size: FONT_SIZE_SMALL,
      color: COLOR_GRAY,
    });

    // Page number (right)
    const pageLabel = `หน้า ${pageNum} / ${totalPages}`;
    p.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - measureText(pageLabel, fonts.regular, FONT_SIZE_SMALL),
      y: MARGIN + 10,
      font: fonts.regular,
      size: FONT_SIZE_SMALL,
      color: COLOR_GRAY,
    });
  }
}

// =============================================================================
// Pagination Helpers
// =============================================================================

/**
 * Ensure there is enough vertical space for a block of `requiredHeight`.
 *
 * If not, add a new page and reset cursor to top of content area.
 *
 * IMPORTANT: `requiredHeight` MUST be the exact total height the block
 * will consume from `state.y` downward (sum of all `state.y -=` decrements
 * during drawing). Otherwise either:
 *   - reserved space is too small → block overlaps with footer or bottom margin
 *   - reserved space is too large → unnecessary page break
 *
 * Callers compute this from `wrapText` results and constant line heights,
 * never from fixed line counts.
 */
function ensureSpace(state: RenderState, requiredHeight: number): void {
  // Safety margin: leave at least 0.5pt between block bottom and footer.
  // This guards against floating-point drift.
  const SAFETY = 0.5;
  const blockBottom = state.y - requiredHeight;
  if (blockBottom < CONTENT_BOTTOM + SAFETY) {
    addNewPage(state);
  }
}

function addNewPage(state: RenderState): void {
  // Footer is rendered at the end (final pass) on all pages
  // — see renderFooter() called from main entry point.

  // Create new page
  state.page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.y = CONTENT_TOP;
  state.pageNumber += 1;
}

// =============================================================================
// Value Resolution & Formatting
// =============================================================================

/**
 * Resolve the answer value for a field from formData
 *
 * Strategy: lookup by fieldId (templateFields.fieldId) → formData[fieldId]
 * This works because formData keys = field_master.id
 */
function resolveAnswerValue(field: FieldData, ctx: ApplicationContext): unknown {
  const formData = (ctx.application.formData ?? {}) as Record<string, unknown>;
  return formData[field.fieldId] ?? formData[field.pdfMappingKey ?? ''] ?? null;
}

/**
 * Format the answer value for display
 *
 * - Handles: string, number, boolean, Date, ISO string, Array, Object
 * - ห้ามใช้ String(value) ตรงๆ — ถ้า value เป็น object จะได้ "[object Object]"
 * - For objects: extract common display keys (label, name, value, id) → fallback JSON
 */
function formatAnswerValue(field: FieldData, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  switch (field.type) {
    case 'DATE': {
      // value may be unix timestamp (number), Date object, or ISO string
      if (typeof value === 'number') {
        return formatThaiDate(value);
      }
      if (value instanceof Date) {
        return formatThaiDate(Math.floor(value.getTime() / 1000));
      }
      if (typeof value === 'string') {
        const ts = Date.parse(value);
        if (!isNaN(ts)) return formatThaiDate(ts / 1000);
        return value; // non-date string
      }
      return String(value);
    }

    case 'CHECKBOX':
      if (typeof value === 'boolean') return value ? '☑' : '☐';
      if (typeof value === 'string') {
        return /^(true|1|yes|ใช่|on)$/i.test(value) ? '☑' : '☐';
      }
      // ✅ Other Option Support — CHECKBOX แบบกลุ่ม (string[]): แสดง label จริง
      if (Array.isArray(value)) {
        if (value.length === 0) return '☐';
        const options = field.overrideOptions ?? field.options;
        const labels = value
          .map((v) => {
            if (Array.isArray(options)) {
              const resolved = resolveFromOptions(v, options);
              if (resolved !== null) return resolved;
            }
            return extractDisplayKey(v);
          })
          .filter(Boolean);
        return labels.length > 0 ? labels.join(', ') : '☑';
      }
      return '☐';

    case 'DROPDOWN':
    case 'RADIO':
    case 'MASTER_DATA': {
      // Try to resolve label from options first
      const options = field.overrideOptions ?? field.options;
      if (Array.isArray(options)) {
        const resolved = resolveFromOptions(value, options);
        if (resolved !== null) return resolved;
      }
      // Fall back to safe object/string formatting
      return formatValueForDisplay(value);
    }

    case 'FILE': {
      // value can be URL string OR { url, name } object OR array of files
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) {
        return value
          .map(v => (typeof v === 'string' ? v : extractDisplayKey(v)))
          .filter(Boolean)
          .join(', ');
      }
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        return (typeof obj.url === 'string' ? obj.url : null)
          ?? (typeof obj.fileUrl === 'string' ? obj.fileUrl : null)
          ?? extractDisplayKey(value);
      }
      return String(value);
    }

    case 'NUMBER': {
      if (typeof value === 'number') return String(value);
      if (typeof value === 'string') {
        const n = Number(value);
        return !isNaN(n) ? String(n) : value;
      }
      return formatValueForDisplay(value);
    }

    case 'TEXT':
    case 'TEXTAREA':
    default:
      return formatValueForDisplay(value);
  }
}

// =============================================================================
// Safe Value Formatters (used by formatAnswerValue)
// =============================================================================

/**
 * Safe formatter for any value → user-readable string
 *
 * รองรับ:
 *   - string  → ค่าเดิม
 *   - number  → String(num)
 *   - boolean → "ใช่" / "ไม่ใช่"
 *   - Date    → Thai date
 *   - Array   → join ด้วย ", "
 *   - Object  → resolve จาก display keys → fallback JSON
 */
function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (value instanceof Date) {
    return formatThaiDate(Math.floor(value.getTime() / 1000));
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '-';
    return value
      .map(item => formatValueForDisplay(item))
      .filter(s => s && s !== '-')
      .join(', ');
  }
  if (typeof value === 'object') {
    return extractDisplayKey(value);
  }
  return String(value);
}

/**
 * Extract a human-readable string from an object
 *
 * Priority: label > name > title > value > displayName > fullName > id
 * Fallback: JSON string of the object
 */
function extractDisplayKey(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object') return String(obj);

  const o = obj as Record<string, unknown>;
  const keys = ['label', 'name', 'title', 'value', 'displayName', 'fullName', 'fullname', 'text', 'code'];

  for (const key of keys) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v;
  }

  // Last resort: try id + any string
  if (typeof o.id === 'string') {
    return o.id;
  }

  // Fallback: compact JSON
  try {
    const json = JSON.stringify(obj);
    if (json.length > 200) return json.slice(0, 200) + '...';
    return json;
  } catch {
    return '[object]';
  }
}

/**
 * Resolve a value to its display label from a list of options
 *
 * Supports:
 *   - value is string/number → match against option.value
 *   - value is object        → match against option.id or option.value
 *   - value is array         → resolve each element
 */
function resolveFromOptions(value: unknown, options: unknown[]): string | null {
  const matches = (optionVal: unknown, searchVal: unknown): boolean => {
    if (optionVal === searchVal) return true;
    return String(optionVal) === String(searchVal);
  };

  // value is an object → try to match by id/value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const searchId = v.id ?? v.value;

    for (const option of options) {
      if (typeof option === 'object' && option !== null) {
        const opt = option as Record<string, unknown>;
        if (searchId !== undefined && matches(opt.value, searchId)) {
          return extractDisplayKey(opt);
        }
        if (searchId !== undefined && matches(opt.id, searchId)) {
          return extractDisplayKey(opt);
        }
      } else if (matches(option, searchId)) {
        return String(option);
      }
    }

    // No match in options → use display key of the value itself
    return extractDisplayKey(value);
  }

  // value is array → resolve each
  if (Array.isArray(value)) {
    const resolved = value
      .map(v => resolveFromOptions(v, options) ?? extractDisplayKey(v))
      .filter(Boolean);
    return resolved.length > 0 ? resolved.join(', ') : null;
  }

  // value is primitive (string/number/boolean)
  for (const option of options) {
    if (typeof option === 'object' && option !== null) {
      const opt = option as Record<string, unknown>;
      if (matches(opt.value, value) || matches(opt.id, value)) {
        return extractDisplayKey(opt);
      }
    } else if (matches(option, value)) {
      return String(option);
    }
  }

  return null;
}

// =============================================================================
// Text Wrapping
// =============================================================================

/**
 * Wrap text into lines that fit within maxWidth.
 *
 * Algorithm:
 *   - Try to break at whitespace (word boundary) when available.
 *   - For words longer than maxWidth (typical for Thai without spaces),
 *     fall back to character-level greedy wrapping.
 *   - Never drop characters; never invent extra content.
 *
 * This function returns lines whose actual rendered width is always
 * `<= maxWidth`, so the renderer can compute line height purely from the
 * returned array length.
 */
function wrapText(
  text: string,
  maxWidth: number,
  font: PDFFont,
  size: number
): string[] {
  if (!text) return [];

  // Normalize explicit newlines into paragraph boundaries.
  // This way, hard newlines are preserved as line breaks.
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, maxWidth, font, size));
  }

  return lines;
}

/**
 * Wrap a single paragraph (no embedded \n) into lines.
 *
 * Uses a hybrid approach:
 *   1. Greedy word-by-word when words fit; otherwise
 *   2. Greedy character-by-character for words that exceed maxWidth.
 *
 * Whitespace handling:
 *   - Single space between words is preserved.
 *   - Leading/trailing whitespace on a line is trimmed before push.
 *   - If a line becomes empty after trimming (e.g. consecutive spaces),
 *     it is dropped (no empty lines from whitespace-only tokens).
 */
function wrapParagraph(
  text: string,
  maxWidth: number,
  font: PDFFont,
  size: number
): string[] {
  // Split keeping whitespace as separate tokens so we can preserve spacing.
  const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
  const lines: string[] = [];
  let line = '';

  for (const token of tokens) {
    // Pure-whitespace token: attach to current line only if non-empty,
    // otherwise skip (avoid leading whitespace on a fresh line).
    if (/^\s+$/.test(token)) {
      if (line.length > 0) line += token;
      continue;
    }

    // Word fits on its own — try greedy concatenation first.
    if (measureText(token, font, size) <= maxWidth) {
      const candidate = line.length > 0 ? line + ' ' + token : token;
      if (measureText(candidate, font, size) <= maxWidth) {
        line = candidate;
      } else {
        // Flush current line, start new with this word
        if (line.length > 0) lines.push(line);
        line = token;
      }
      continue;
    }

    // Word is longer than maxWidth (typical for Thai without spaces).
    // Flush whatever we have, then character-wrap the long word.
    if (line.length > 0) lines.push(line);
    line = '';

    // Greedy char-wrap. Use Array.from to split by code points so we
    // never break surrogate pairs or combining marks.
    const chars = Array.from(token);
    let buf = '';
    for (const ch of chars) {
      const test = buf + ch;
      if (measureText(test, font, size) <= maxWidth) {
        buf = test;
      } else {
        if (buf.length > 0) lines.push(buf);
        // Always start a new buffer with this char (even if it itself
        // exceeds maxWidth — pdf-lib will still render it; we cannot
        // drop characters).
        buf = ch;
      }
    }
    if (buf.length > 0) line = buf;
  }

  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Compute total height (in pt) needed to render wrapped text.
 *
 * Returns 0 for empty input. Otherwise returns `lines * size * lineHeight`.
 * This is the single source of truth for vertical space — never use a
 * fixed line count.
 */
function heightForWrappedText(
  lines: string[],
  fontSize: number,
  lineHeightMultiplier: number = LINE_HEIGHT
): number {
  // Count only non-empty lines for height — empty paragraphs in wrapText
  // are used to mark hard newlines and should occupy one line of space.
  if (lines.length === 0) return 0;
  return lines.length * fontSize * lineHeightMultiplier;
}

function measureText(text: string, font: PDFFont, size: number): number {
  if (!text) return 0;
  return font.widthOfTextAtSize(text, size);
}

// =============================================================================
// Drawing Helpers
// =============================================================================

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  options: { font: PDFFont; size: number; color: ReturnType<typeof rgb> }
): void {
  page.drawText(text, { x, y, ...options });
}

function drawTextCentered(
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  options: { font: PDFFont; size: number; color: ReturnType<typeof rgb> }
): void {
  const width = measureText(text, options.font, options.size);
  page.drawText(text, {
    x: centerX - width / 2,
    y,
    ...options,
  });
}

// =============================================================================
// Date Formatting
// =============================================================================

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * Format unix timestamp to Thai date string (Buddhist year, Asia/Bangkok)
 * Example: "16 ตุลาคม 2569"
 *
 * Fixed offset +7h + getUTC* — ห้ามใช้ local getters เพราะบน Workers
 * local timezone = UTC (ดู document-tokens.ts formatThaiDate / test
 * pdf-thai-date-format.test.ts)
 */
function formatThaiDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000 + 7 * 60 * 60 * 1000);
  const day = d.getUTCDate();
  const month = THAI_MONTHS[d.getUTCMonth()];
  const thaiYear = d.getUTCFullYear() + 543;
  return `${day} ${month} ${thaiYear}`;
}
