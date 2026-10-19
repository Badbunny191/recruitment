/**
 * Document Composer V1 — Zod Schema
 *
 * Zod schema สำหรับ validate DocumentDescriptor
 *
 * ใช้ตรวจ descriptor ที่ส่งเข้ามา (เช่นจาก DB, config, หรือ future editor)
 * ก่อน pass เข้า renderer
 *
 * Design:
 *   - schema version = literal 1 (รองรับการ migrate ในอนาคต)
 *   - แต่ละ block variant เป็น discriminated union (ตาม `type`)
 *   - id ต้อง unique ภายใน descriptor (checked ใน descriptor-validator.ts)
 *   - margin/align มี default + bounds (กันค่ามหาศาล)
 */

import { z } from "zod";

// =============================================================================
// Shared Schemas
// =============================================================================

/** Block id — required, non-empty */
const BlockIdSchema = z
  .string()
  .min(1, "Block id is required")
  .max(128, "Block id is too long");

/** Alignment */
const AlignSchema = z.enum(["left", "center", "right"]);

/** Size */
const SizeSchema = z.enum(["small", "medium", "large"]);

/**
 * Margin (pt) — bounded เพื่อกันค่าผิดปกติ
 *
 * - ไม่ใหญ่เกิน 200pt (≈ 7cm)
 * - ไม่ติดลบ
 */
const MarginSchema = z
  .number()
  .int("Margin must be an integer (pt)")
  .min(0, "Margin cannot be negative")
  .max(200, "Margin too large (max 200pt)")
  .optional();

// =============================================================================
// Block Schemas (discriminated union by `type`)
// =============================================================================

const HeadingBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("heading"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  text: z.string().min(1, "Heading text is required").max(500, "Heading text too long"),
  size: SizeSchema,
  bold: z.boolean().optional(),
});

const FieldBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("field"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  fieldId: z.string().min(1, "fieldId is required"),
  label: z.string().min(1).max(255).optional(),
});

const TableBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("table"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  fieldId: z.string().min(1, "fieldId is required"),
});

const LogoBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("logo"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
});

/**
 * Signature Block schema — Document Block ที่ใช้ข้อมูลจาก Application
 *
 * V1:
 *   - roleLabel: ป้ายกำกับ (default "ผู้สมัคร")
 *   - signerNameSource / dateSource / timeSource: literal "application" เท่านั้น
 *     (เปิดทางให้รองรับ source อื่นในอนาคต เช่น "fixed" หรือ "manual")
 *   - showName / showDate / showTime: visibility toggles
 *     - showName (default true)
 *     - showDate (default true)
 *     - showTime (default false) — เอกสารราชการ/สมัครงานส่วนใหญ่ไม่แสดงเวลา
 */
const SignatureBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("signature"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  roleLabel: z.string().min(1).max(100).optional(),
  signerNameSource: z.literal("application").optional(),
  dateSource: z.literal("application").optional(),
  timeSource: z.literal("application").optional(),
  showName: z.boolean().optional(),
  showDate: z.boolean().optional(),
  showTime: z.boolean().optional(),
});

/** Union ของ block variants — ใช้ `type` เป็น discriminator */
const DocumentBlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  FieldBlockSchema,
  TableBlockSchema,
  LogoBlockSchema,
  SignatureBlockSchema,
]);

// =============================================================================
// Document Descriptor Schema
// =============================================================================

/**
 * Top-level Document Descriptor schema
 *
 * Validate:
 *   - version = 1 (literal)
 *   - blocks = array ของ block ตามลำดับ
 *   - แต่ละ block validate ตาม variant ของมัน
 */
export const DocumentDescriptorSchema = z.object({
  version: z.literal(1),
  blocks: z
    .array(DocumentBlockSchema)
    .min(1, "Descriptor must have at least one block"),
});

// =============================================================================
// Inferred Types (single source of truth จาก schema)
// =============================================================================

/** Inferred type จาก schema — ตรงกับ types.ts (สามารถใช้แทนกันได้) */
export type DocumentDescriptorInput = z.infer<typeof DocumentDescriptorSchema>;
export type DocumentBlockInput = z.infer<typeof DocumentBlockSchema>;
