/**
 * Document Composer V1 — Descriptor Validator
 *
 * High-level validation pipeline:
 *   1. Schema validate (ผ่าน Zod)
 *   2. Semantic checks (id uniqueness, fieldId reference, etc.)
 *
 * คืน ValidationResult ที่ renderer ใช้ตัดสินใจว่าจะ render ต่อหรือหยุด
 */

import {
  DocumentDescriptorSchema,
  type DocumentDescriptorInput,
  type DocumentBlockInput,
} from "./descriptor-schema";

// =============================================================================
// Public Types
// =============================================================================

export interface ValidationIssue {
  /** dotted path to the problematic field (e.g. "blocks.3.fieldId") */
  path: string;
  /** human-readable error message */
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

// =============================================================================
// Validator
// =============================================================================

/**
 * Validate arbitrary input → DocumentDescriptor
 *
 * - Step 1: Zod schema validation (parse + shape check)
 * - Step 2: Semantic checks (id uniqueness, fieldId existence hints)
 */
export function validateDescriptor(
  input: unknown
): ValidationResult<DocumentDescriptorInput> {
  // ── Step 1: Schema validation ────────────────────────────────────────
  const schemaResult = DocumentDescriptorSchema.safeParse(input);
  if (!schemaResult.success) {
    const issues = schemaResult.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { ok: false, issues };
  }

  const descriptor = schemaResult.data;

  // ── Step 2: Semantic checks ─────────────────────────────────────────
  const semanticIssues: ValidationIssue[] = [];

  // 2a) Block id uniqueness
  const seenIds = new Set<string>();
  descriptor.blocks.forEach((block, index) => {
    if (seenIds.has(block.id)) {
      semanticIssues.push({
        path: `blocks.${index}.id`,
        message: `Duplicate block id: "${block.id}"`,
      });
    }
    seenIds.add(block.id);
  });

  // 2b) fieldId uniqueness *within same block type* —
  //     (โดยหลักการ V1 ไม่บังคับ เพราะอาจ render ซ้ำได้)
  //     แต่ field block ที่ fieldId เดียวกันใน descriptor จะ resolve ค่าเดียวกัน
  //     → warning only (ไม่ fail)
  //     (ปล่อยเป็น no-op ใน V1 — runtime warning จะอยู่ใน renderer)

  // 2c) table/field block ต้องมี fieldId ตรงกับ field_master ที่มีจริง
  //     (check นี้ทำที่ service layer ไม่ใช่ที่นี่ เพราะต้อง query DB)
  //     ที่นี่ check แค่ shape consistency:
  for (let i = 0; i < descriptor.blocks.length; i++) {
    const block = descriptor.blocks[i];
    if (
      (block.type === "field" || block.type === "table") &&
      !block.fieldId.trim()
    ) {
      semanticIssues.push({
        path: `blocks.${i}.fieldId`,
        message: "fieldId cannot be empty",
      });
    }
  }

  if (semanticIssues.length > 0) {
    return { ok: false, issues: semanticIssues };
  }

  return { ok: true, value: descriptor };
}

/**
 * Strict variant — throw ถ้า invalid (ใช้สำหรับ boot-time config validation)
 */
export function assertDescriptor(
  input: unknown
): DocumentDescriptorInput {
  const result = validateDescriptor(input);
  if (!result.ok) {
    const detail = result.issues
      .map((i) => `  - ${i.path}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid DocumentDescriptor:\n${detail}`);
  }
  return result.value;
}

/**
 * Helper: extract all fieldIds ที่ block ต้องการ (สำหรับ preload check)
 *
 * ไม่รวม logo (ไม่ต้องการ field)
 */
export function collectRequiredFieldIds(
  descriptor: DocumentDescriptorInput
): Set<string> {
  const ids = new Set<string>();
  for (const block of descriptor.blocks) {
    if (block.type === "field" || block.type === "table") {
      ids.add(block.fieldId);
    }
  }
  return ids;
}

/**
 * Type guard: block เป็น FieldBlock หรือ TableBlock ที่ต้องการ field data
 */
export function isDataBlock(
  block: DocumentBlockInput
): block is Extract<DocumentBlockInput, { type: "field" | "table" }> {
  return block.type === "field" || block.type === "table";
}
