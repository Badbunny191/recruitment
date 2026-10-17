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
  DocumentBlock,
  DocumentDescriptor,
} from "./types";

export type {
  DocumentDescriptorInput,
  DocumentBlockInput,
} from "./descriptor-schema";

export type {
  RenderCommand,
  RenderPlan,
  RenderedBytes,
} from "./descriptor-renderer";

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
// Renderer
// =============================================================================

export {
  buildRenderPlan,
  renderPlanToPdf,
} from "./descriptor-renderer";
