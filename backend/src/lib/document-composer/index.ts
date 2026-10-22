/**
 * Document Composer V1 — Public API
 *
 * Public exports สำหรับ document composer foundation
 *
 * ใช้แทน hardcoded PDF layout ในอนาคต
 *
 * Flow ที่ consumer เรียก:
 *   import {
 *     validateDescriptor,
 *     buildRenderPlan,
 *     renderPlanToPdf,
 *   } from '@/lib/document-composer';
 *
 *   const v = validateDescriptor(descriptorInput);
 *   if (!v.ok) return res.status(400).json({ issues: v.issues });
 *
 *   const plan = buildRenderPlan(v.value, ctx);
 *   const { bytes, pageCount, generatedAt } = await renderPlanToPdf(plan, ctx);
 *
 * Single Column Flow + Block-based composition
 * - ไม่มี canvas
 * - ไม่มี x/y coordinates
 * - ไม่มี drag & drop
 */

// =============================================================================
// Types
// =============================================================================

export type {
  BlockType,
  Align,
  Size,
  BaseBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
  SignatureBlock,
  SystemDataBlock,
  SystemDataKey,
  PageBreakBlock,
  SignatureDateSource,
  LogoSource,
  DateFormat,
  DocumentBlock,
  DocumentDescriptor,
} from "./types";

export {
  DEFAULT_SIGNATURE_LINE_LABEL,
  DEFAULT_SIGNATURE_ROLE_LABEL,
  DEFAULT_SIGNATURE_DATE_LABEL,
  DEFAULT_SIGNATURE_LINE_STYLE,
  DEFAULT_SHOW_NAME,
  DEFAULT_SHOW_PARENTHESES,
  DEFAULT_SHOW_DATE,
  DEFAULT_SHOW_TIME,
  DEFAULT_DATE_FORMAT,
  SYSTEM_DATA_LABELS,
  NO_LOGO_TEXT,
} from "./types";

export type {
  DocumentDescriptorInput,
  DocumentBlockInput,
} from "./descriptor-schema";

// =============================================================================
// Validator
// =============================================================================

export {
  validateDescriptor,
  assertDescriptor,
  collectRequiredFieldIds,
  isDataBlock,
  type ValidationIssue,
  type ValidationResult,
} from "./descriptor-validator";

// =============================================================================
// Schema (re-export Zod schema สำหรับ use cases อื่น)
// =============================================================================

export { DocumentDescriptorSchema } from "./descriptor-schema";

// =============================================================================
// Page Settings (ขอบกระดาษ — Preview only)
// =============================================================================

export {
  resolvePageGeometry,
  createDefaultPageSettings,
  clampMarginPt,
  normalizePreset,
  ptToMm,
  mmToPt,
  PageSettingsSchema,
  PageMarginPtSchema,
  PAGE_MARGIN_PT_RANGE,
  DEFAULT_MARGIN_PT,
  MIN_MARGIN_PT,
  MAX_MARGIN_PT,
  MIN_CONTENT_SIZE_PT,
  PRESET_MARGIN_PT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  PT_PER_INCH,
  MM_PER_INCH,
  type PageSettings,
  type PageSettingsInput,
  type PageMarginPreset,
  type PageMarginSide,
  type PageGeometry,
} from "./page-settings";

// =============================================================================
// Renderer
// =============================================================================

export {
  buildRenderPlan,
  renderPlanToPdf,
  type RenderPlan,
  type RenderCommand,
  type PaddingCommand,
  type HeadingRenderCommand,
  type FieldRenderCommand,
  type TableRenderCommand,
  type LogoRenderCommand,
  type SignatureRenderCommand,
  type SystemDataRenderCommand,
} from "./descriptor-renderer";

// =============================================================================
// Preview (HTML Preview Renderer)
// =============================================================================

export {
  renderDescriptorToPreview,
} from "./preview-renderer";

export type {
  PreviewModel,
  PreviewMeta,
  RenderedBlockSummary,
  PreviewMode,
  PreviewTokenInfo,
  TokenSource,
  ResolvedTokenEntry,
} from "./preview-model";

// =============================================================================
// Document Tokens (System Data + Application Field tokens)
// =============================================================================

export {
  resolveDocumentTokens,
  applyDocumentTokens,
  applyDocumentTokensWithFields,
  applyFieldTokens,
  resolveFieldValue,
  buildFieldToken,
  listFieldTokensInText,
  formatThaiDate,
  collectUsedTokens,
  DOCUMENT_TOKENS,
  DOCUMENT_TOKEN_LABELS,
  INSERTABLE_DOCUMENT_TOKENS,
  type DocumentToken,
  type InsertableDocumentToken,
  type TokenValue,
  type ResolvedFieldValue,
} from "./document-tokens";

// =============================================================================
// Field capabilities (Table Picker filter — Requirement G)
// =============================================================================

export {
  isRepeatableField,
  isScalarFieldType,
  getFieldValueShape,
  getObjectDisplayLabel,
  isSingleValueObject,
  isArrayOfObjects,
  getFieldCapability,
  type FieldValueShape,
  type FieldObjectValue,
  type RepeatableCapability,
  type ApplicationFieldType,
} from "./field-capabilities";

// =============================================================================
// Generator (auto-build DocumentDescriptor from template_sections + template_fields)
// =============================================================================

export {
  generateDescriptorFromTemplate,
  type GenerateResult,
  type GeneratorMeta,
  type GeneratorInput,
  type GeneratorSectionInput,
  type GeneratorFieldInput,
  type GeneratorFieldType,
} from "./descriptor-generator";