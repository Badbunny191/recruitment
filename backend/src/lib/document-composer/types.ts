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
  | "logo"
  | "signature";

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

/**
 * Signature Block — render a signature section that uses application data
 *
 * Design:
 *   - เป็น Document Block (เหมือน logo / heading) — ไม่ใช่ Field Block
 *   - ไม่ต้องให้ผู้สมัครกรอก (ไม่ผูกกับ formData / field_master)
 *   - resolve ค่าจาก ApplicationContext ตอน render (PDF + Preview)
 *
 * Data Sources (V1):
 *   - signerName: application.fullname (ชื่อผู้สมัคร)
 *   - date:       application.submittedAt → Thai date (พ.ศ.)
 *   - time:       application.submittedAt → HH:mm (เวลา)
 *
 * Visibility toggles:
 *   - showName: เปิด/ปิด บรรทัด "(ชื่อผู้สมัคร)"   (default: true)
 *   - showDate: เปิด/ปิด บรรทัด "วันที่ ..."      (default: true)
 *   - showTime: เปิด/ปิด บรรทัด "เวลา ..."      (default: false)
 *     เหตุผล: เอกสารราชการ/สมัครงานส่วนใหญ่ไม่แสดงเวลา
 *     เวลาเป็น Optional — ผู้ใช้เปิดเองเมื่อต้องการ
 *
 * Fallback (เมื่อไม่มี application data หรือค่าว่าง):
 *   - แสดง placeholder text เพื่อให้ layout ของ PDF/Preview ไม่ collapse
 */
export interface SignatureBlock extends BaseBlock {
  type: "signature";
  /** ป้ายกำกับบทบาท เช่น "ผู้สมัคร", "ผู้รับรอง" (default: "ผู้สมัคร") */
  roleLabel?: string;
  /** แหล่งข้อมูลชื่อผู้ลงนาม (V1: รองรับเฉพาะ "application") */
  signerNameSource?: "application";
  /** แหล่งข้อมูลวันที่ (V1: รองรับเฉพาะ "application") */
  dateSource?: "application";
  /** แหล่งข้อมูลเวลา (V1: รองรับเฉพาะ "application") */
  timeSource?: "application";
  /** แสดง "(ชื่อผู้สมัคร)" หรือไม่ (default: true) */
  showName?: boolean;
  /** แสดง "วันที่ ..." หรือไม่ (default: true) */
  showDate?: boolean;
  /** แสดง "เวลา ..." หรือไม่ (default: false) */
  showTime?: boolean;
}

// =============================================================================
// Union
// =============================================================================

export type DocumentBlock =
  | HeadingBlock
  | FieldBlock
  | TableBlock
  | LogoBlock
  | SignatureBlock;

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
