/**
 * Document Composer V1 — Core Types
 *
 * TypeScript types สำหรับ Block-based Document Descriptor
 *
 * ใช้เป็น data contract ระหว่าง:
 *   - descriptor-schema.ts (Zod validation)
 *   - descriptor-renderer.ts (Pure function → PDF Render Plan)
 *
 * Design Principles:
 *   - Single Column Flow (ลำดับบน → ล่างเท่านั้น)
 *   - ไม่มี x/y coordinates
 *   - ไม่มี multi column
 *   - ทุก alignment เป็น block-level (left/center/right)
 */

// =============================================================================
// Common Enums
// =============================================================================

export type BlockType =
  | "heading"
  | "field"
  | "table"
  | "logo";

export type Align =
  | "left"
  | "center"
  | "right";

export type Size =
  | "small"
  | "medium"
  | "large";

// =============================================================================
// Base Block (shared shape สำหรับทุก block)
// =============================================================================

export interface BaseBlock {
  /** unique id ภายใน descriptor (ใช้สำหรับ debug + key) */
  id: string;
  type: BlockType;
  /** block-level alignment (default: left) */
  align?: Align;
  /** top margin (pt) — spacing ก่อน block นี้ */
  marginTop?: number;
  /** bottom margin (pt) — spacing หลัง block นี้ */
  marginBottom?: number;
}

// =============================================================================
// Block Variants
// =============================================================================

/**
 * Heading Block — static heading text
 *
 * ใช้สำหรับหัวข้อในเอกสาร (เช่น "ข้อมูลส่วนตัว", "ประวัติการศึกษา")
 */
export interface HeadingBlock extends BaseBlock {
  type: "heading";
  /** heading text (static) */
  text: string;
  /** heading size */
  size: Size;
  /** bold style */
  bold?: boolean;
}

/**
 * Field Block — bind กับ field ใน application form
 *
 * Renderer จะ resolve value จาก ApplicationContext ตอน render
 */
export interface FieldBlock extends BaseBlock {
  type: "field";
  /** field_master.id — ใช้ lookup จาก ApplicationContext.fields */
  fieldId: string;
  /** override label (optional) — ถ้าไม่กำหนดใช้ field.label จาก context */
  label?: string;
}

/**
 * Table Block — render field value เป็น table
 *
 * ใช้สำหรับ field ที่มี value เป็น array of rows
 */
export interface TableBlock extends BaseBlock {
  type: "table";
  /** field_master.id — field ที่เก็บ table data (array of objects) */
  fieldId: string;
}

/**
 * Logo Block — render logo image
 *
 * V1: ใช้ logo ตัวเดียว (SAO logo) จาก assets
 */
export interface LogoBlock extends BaseBlock {
  type: "logo";
}

// =============================================================================
// Union
// =============================================================================

export type DocumentBlock =
  | HeadingBlock
  | FieldBlock
  | TableBlock
  | LogoBlock;

// =============================================================================
// Document Descriptor (top-level)
// =============================================================================

/**
 * Document Descriptor — รายการ blocks ที่จะ render ตามลำดับ
 *
 * Single Column Flow: blocks render ตาม array order จากบนลงล่าง
 */
export interface DocumentDescriptor {
  /** schema version (currently always 1) */
  version: 1;
  /** ordered list of blocks */
  blocks: DocumentBlock[];
}
