/**
 * Document Composer V1 — Zod Schema
 *
 * Zod schema สำหรับ validate DocumentDescriptor
 *
 * ใช้ตรวจ descriptor ที่ส่งเข้ามา (เช่นจาก DB, config, หรือ future editor)
 * ก่อน pass เข้า renderer
 *
 * ── Design ──────────────────────────────────────────────────────────────
 *   - schema version = literal 1 (ไม่ bump — Requirement J.5)
 *   - แต่ละ block variant เป็น discriminated union (ตาม `type`)
 *   - id ต้อง unique ภายใน descriptor (checked ใน descriptor-validator.ts)
 *   - margin/align มี default + bounds (กันค่ามหาศาล)
 *
 * ── BACKWARD COMPATIBILITY (Requirement J) ───────────────────────────────
 *   ทุก property ที่เพิ่มในรอบนี้เป็น `.optional()` ทั้งหมด
 *   → descriptor เก่าที่บันทึกไว้ก่อนหน้านี้ยังผ่าน validation ได้
 */

import { z } from "zod";
import { PageSettingsSchema } from "./page-settings";

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

/** รูปแบบวันที่ */
const DateFormatSchema = z.enum([
  "thai_long",
  "thai_short",
  "iso",
  "numeric",
]);

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

/** ขนาดรูป (px/pt) — bounded เพื่อกันค่าผิดปกติที่ทำให้ PDF พัง */
const ImageSizeSchema = z
  .number()
  .int("Size must be an integer")
  .min(8, "Size too small (min 8)")
  .max(1000, "Size too large (max 1000)")
  .optional();

/**
 * URL รูปภาพ — validate ตามแนวทางเดียวกับ upload route เดิม
 *
 * Requirement K.5: URL รูปภาพต้องผ่าน validation
 * อนุญาตเฉพาะ http/https และ data: image (ไม่มีฐาน 64 ขนาดใหญ่ — จำกัดความยาว)
 */
const ImageUrlSchema = z
  .string()
  .max(2048, "Image URL too long (max 2048)")
  .refine(
    (url) => {
      const u = url.trim().toLowerCase();
      if (u.startsWith("http://") || u.startsWith("https://")) return true;
      // data: URI อนุญาตเฉพาะภาพ และความยาวจำกัด (กัน base64 ใหญ่ — Requirement D)
      if (u.startsWith("data:image/")) return url.length <= 4096;
      return false;
    },
    { message: "Image URL must be http(s) or a small data: image" }
  )
  .optional();

/** ข้อความที่ Admin กรอกเอง — bounded เพื่อกัน payload ใหญ่ */
const AdminTextSchema = (max: number) =>
  z.string().max(max, `Text too long (max ${max})`);

// =============================================================================
// Block Schemas (discriminated union by `type`)
// =============================================================================

/**
 * Heading / Text Block
 *
 * - text รองรับ \n (multiline) และ token ทั้ง 2 แบบ
 * - text ยังคง min(1) เหมือนเดิม (ไม่ให้ regression กับ descriptor เก่า)
 */
const HeadingBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("heading"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  text: z
    .string()
    .min(1, "Heading text is required")
    .max(2000, "Heading text too long (max 2000)"),
  size: SizeSchema,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});

/** key ของ System Data Block */
const SystemDataKeySchema = z.enum([
  "APPLICATION_NO",
  "ROUND_NAME",
  "APPLICATION_DATE",
  "PRINT_DATE",
  "POSITION_NAME",
]);

/**
 * System Data Block — ข้อมูลระบบ (เลขที่ใบสมัคร / ชื่อรอบ / วันที่)
 *
 * ทุก field optional ยกเว้น `key` เพื่อให้ descriptor เก่า load ได้
 */
const SystemDataBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("systemData"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  key: SystemDataKeySchema,
  label: z.string().min(1).max(100).optional(),
  showLabel: z.boolean().optional(),
  layout: z.enum(["stacked", "inline"]).optional(),
  labelStyle: SizeSchema.optional(),
  valueStyle: SizeSchema.optional(),
  dateFormat: DateFormatSchema.optional(),
});

/**
 * Page Break Block — สั่งให้ขึ้นหน้าใหม่ทันที
 *
 * ⚠️ มีเฉพาะ `id` + `type` (บวก field ของ BaseBlock ที่ optional)
 *   - ไม่มี height / size / offset → ไม่มีการเดาจุดแบ่งหน้า
 *   - descriptor ที่ไม่มี block นี้ยัง validate ผ่านตามปกติ
 */
const PageBreakBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("pageBreak"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
});

/**
 * Field Block — ข้อมูลที่ผู้สมัครกรอกจริง
 */
const FieldBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("field"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  fieldId: z.string().min(1, "fieldId is required"),
  label: z.string().min(1).max(255).optional(),
  showLabel: z.boolean().optional(),
  showRequired: z.boolean().optional(),
  labelStyle: SizeSchema.optional(),
  valueStyle: SizeSchema.optional(),
  layout: z.enum(["stacked", "inline"]).optional(),
});

/**
 * Table Block — ใช้เฉพาะ field ที่มีค่าหลายแถวจริง
 */
const TableBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("table"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  fieldId: z.string().min(1, "fieldId is required"),
  label: z.string().min(1).max(255).optional(),
  showLabel: z.boolean().optional(),
  emptyText: z.string().min(1).max(255).optional(),
});

/**
 * Logo Block — Requirement D
 *
 * - source: "organization" | "upload" | "none" (default ใน renderer = organization)
 * - width/height: bounded, height optional = auto aspect ratio
 * - imageUrl: forward-compatible (ยังไม่มี asset storage)
 */
const LogoBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("logo"),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  source: z.enum(["organization", "upload", "none"]).optional(),
  width: ImageSizeSchema,
  height: ImageSizeSchema,
  alt: z.string().min(1).max(255).optional(),
  imageUrl: ImageUrlSchema,
});

/**
 * Signature Block — Requirement C
 *
 * V1 (เดิม):
 *   - roleLabel: ป้ายกำกับ (default "ผู้สมัคร")
 *   - signerNameSource / dateSource / timeSource: literal "application"
 *   - showName / showDate / showTime: visibility toggles
 *
 * รอบนี้ (เพิ่ม):
 *   - lineLabel (default "ลงลายมือชื่อ")
 *   - lineStyle (default "..........")
 *   - dateLabel (default "วันที่")
 *   - nameFieldId (Application Field สำหรับชื่อ — field_master.id)
 *   - dateSource: "APPLICATION_DATE" | "PRINT_DATE" | "none"
 *   - showParentheses (default true)
 *
 * ค่าเก่าทั้งหมดยังผ่าน (optional ทั้งหมด)
 */
const SignatureBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("signature"),
  size: SizeSchema.optional(),
  align: AlignSchema.optional(),
  marginTop: MarginSchema,
  marginBottom: MarginSchema,
  roleLabel: z.string().min(1).max(100).optional(),
  lineLabel: AdminTextSchema(100).optional(),
  lineStyle: AdminTextSchema(120).optional(),
  dateLabel: AdminTextSchema(100).optional(),
  nameFieldId: z.string().min(1).max(128).optional(),
  signerNameSource: z.literal("application").optional(),
  showName: z.boolean().optional(),
  showParentheses: z.boolean().optional(),
  dateSource: z
    .union([
      z.literal("APPLICATION_DATE"),
      z.literal("PRINT_DATE"),
      z.literal("none"),
      // legacy (descriptor ที่บันทึกไว้ก่อนหน้านี้)
      z.literal("application"),
    ])
    .optional(),
  showDate: z.boolean().optional(),
  showTime: z.boolean().optional(),
  timeSource: z.literal("application").optional(),
});

/** Union ของ block variants — ใช้ `type` เป็น discriminator */
const DocumentBlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  FieldBlockSchema,
  TableBlockSchema,
  LogoBlockSchema,
  SignatureBlockSchema,
  SystemDataBlockSchema,
  PageBreakBlockSchema,
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
  /**
   * การตั้งค่าหน้ากระดาษ (ขอบกระดาษ) — optional
   *
   * ⚠️ Backward compatibility: descriptor เก่าที่ไม่มี field นี้ยังผ่านได้
   *   (fallback เป็น 40pt ทุกด้านที่ resolvePageGeometry())
   */
  pageSettings: PageSettingsSchema.optional(),
});

// =============================================================================
// Inferred Types (single source of truth จาก schema)
// =============================================================================

/** Inferred type จาก schema — ตรงกับ types.ts (สามารถใช้แทนกันได้) */
export type DocumentDescriptorInput = z.infer<typeof DocumentDescriptorSchema>;
export type DocumentBlockInput = z.infer<typeof DocumentBlockSchema>;