/**
 * Document Composer V1 — Core Types
 *
 * TypeScript types สำหรับ Block-based Document Descriptor
 *
 * ใช้เป็น data contract ระหว่าง:
 *   - descriptor-schema.ts (Zod validation)
 *   - descriptor-renderer.ts (Pure function → PDF Render Plan)
 *
 * ── Design Principles ────────────────────────────────────────────────────
 *   - Single Column Flow (ลำดับบน → ล่างเท่านั้น)
 *   - ไม่มี x/y coordinates
 *   - ไม่มี multi column
 *   - ทุก alignment เป็น block-level (left/center/right)
 *
 * ── BACKWARD COMPATIBILITY (Requirement J) ───────────────────────────────
 *   ทุก property ที่เพิ่มในรอบนี้เป็น **optional** และมี default ที่ถูกต้อง
 *   descriptor ที่บันทึกไว้ก่อนหน้านี้จึงยัง:
 *     - ผ่าน zod validation
 *     - render ออกมาเหมือนเดิม
 *   `DocumentDescriptor.version` ยังเป็น literal 1 (ไม่ bump)
 */

import type { PageSettings } from "./page-settings";

// =============================================================================
// Common Enums
// =============================================================================

export type BlockType =
  | "heading"
  | "field"
  | "table"
  | "logo"
  | "signature"
  /** ข้อมูลระบบ (เลขที่ใบสมัคร / ชื่อรอบ / วันที่) — Requirement B */
  | "systemData"
  /** ขึ้นหน้าใหม่ทันที (ไม่คำนวณความสูงเพื่อเดาจุดแบ่งหน้า) */
  | "pageBreak";

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
// Heading / Text Block
// =============================================================================

/**
 * Heading / Text Block — ข้อความที่ Admin พิมพ์เอง
 *
 * รองรับ (Requirement A):
 *   1. ข้อความอิสระ
 *   2. ข้อความหลายบรรทัด (ใช้ \n)
 *   3. การแทรก System Token  ({APPLICATION_NO}, {ROUND_NAME}, …)
 *   4. การแทรก Application Field  ({FIELD:<fieldId>})
 *   5. ผสมข้อความกับ token ใน Block เดียว
 *   6. รูปแบบพื้นฐาน: size, bold, italic, align, marginTop/Bottom
 */
export interface HeadingBlock extends BaseBlock {
  type: "heading";
  /**
   * ข้อความ (static หรือผสม token)
   * รองรับหลายบรรทัดด้วย \n — renderer จะ wrap + แยกบรรทัดให้
   */
  text: string;
  /** heading size */
  size: Size;
  /** bold style */
  bold?: boolean;
  /** italic style (เพิ่มในรอบนี้ — optional เพื่อ BC) */
  italic?: boolean;
}

// =============================================================================
// System Data Block (Requirement B)
// =============================================================================

/**
 * ประเภทข้อมูลระบบที่แสดงเป็น System Data Block ได้
 *
 * ทุกค่าเป็น System Token ที่ resolve จากระบบจริง
 * (ดู document-tokens.ts สำหรับแหล่งข้อมูลจริงแต่ละตัว)
 */
export type SystemDataKey =
  | "APPLICATION_NO"
  | "ROUND_NAME"
  | "APPLICATION_DATE"
  | "PRINT_DATE"
  | "POSITION_NAME";

/**
 * System Data Block — แสดงค่า "ข้อมูลระบบ" 1 รายการ เป็น block แยก
 *
 * ตัวอย่างการใช้งาน:
 *   [
 *     { id, type: "systemData", key: "APPLICATION_NO" },
 *     { id, type: "systemData", key: "APPLICATION_DATE" }
 *   ]
 *
 * ค่า default เมื่อ Preview ยังไม่มีใบสมัครจริง:
 *   - APPLICATION_NO   → จาก application number engine เดิม (buildPreview)
 *   - APPLICATION_DATE → วันที่ตัวอย่างในรูปแบบไทย
 *   - PRINT_DATE       → วันที่ Preview ปัจจุบัน
 *   - ROUND_NAME       → ชื่อรอบจริงที่ผูกกับ Template Version
 *   - POSITION_NAME    → ยังไม่มี source → แสดง {POSITION_NAME} เป็น placeholder
 */
export interface SystemDataBlock extends BaseBlock {
  type: "systemData";
  /** key ของข้อมูลระบบที่จะแสดง */
  key: SystemDataKey;
  /** label ที่แสดง (default = label มาตรฐานของ key) */
  label?: string;
  /** แสดง label หรือซ่อน (default: true) */
  showLabel?: boolean;
  /**
   * รูปแบบการจัดวาง (Requirement B)
   * - stacked → label ด้านบน / value อยู่บรรทัดถัดไป (default)
   * - inline  → label และ value อยู่บรรทัดเดียวกัน
   */
  layout?: "stacked" | "inline";
  /** รูปแบบตัวอักษรของ label (default: small) */
  labelStyle?: Size;
  /** รูปแบบตัวอักษรของ value (default: medium) */
  valueStyle?: Size;
  /** รูปแบบวันที่ (ใช้กับ APPLICATION_DATE / PRINT_DATE เท่านั้น) */
  dateFormat?: DateFormat;
}

/**
 * Page Break Block — สั่งให้ PDF Renderer ขึ้นหน้าใหม่ทันที
 *
 * ⚠️ ขอบเขต (ห้ามละเมิด)
 *   - **ไม่มี** height estimation / การคำนวณความสูงเพื่อเดาจุดแบ่งหน้า
 *   - PDF Renderer พบ `type === "pageBreak"` → เรียก `addNewPage(state)` ทันที
 *   - HTML Preview แสดงเป็น separator ประกอบ (📄 หน้าใหม่) เท่านั้น
 *   - Page Settings schema ไม่ได้รับผลกระทบ
 */
export interface PageBreakBlock extends BaseBlock {
  type: "pageBreak";
}

/** รูปแบบวันที่ที่รองรับ (Requirement B — date format) */
export type DateFormat =
  | "thai_long" // 7 มกราคม 2569
  | "thai_short" // 7/1/2569
  | "iso" // 2569-01-07
  | "numeric"; // 07-01-2569

// =============================================================================
// Field Block
// =============================================================================

/**
 * Field Block — แสดงข้อมูลที่ผู้สมัครกรอกจริงจาก Template Version (Requirement E)
 *
 * Form Preview   → render เป็น form control ตาม field type
 * Document/PDF   → render เป็น label + value แบบอ่านอย่างเดียว
 */
export interface FieldBlock extends BaseBlock {
  type: "field";
  /** field_master.id — ใช้ lookup จาก ApplicationContext.fields */
  fieldId: string;
  /** override label (optional) — ถ้าไม่กำหนดใช้ field.label จาก context */
  label?: string;
  /** แสดง label หรือซ่อน (default: true) */
  showLabel?: boolean;
  /** แสดง required marker " *" หรือไม่ (default: true) */
  showRequired?: boolean;
  /** รูปแบบตัวอักษรของ label (default: small) */
  labelStyle?: Size;
  /** รูปแบบตัวอักษรของ value (default: medium) */
  valueStyle?: Size;
  /**
   * รูปแบบการจัดวาง label + value
   * - stacked (default) → label บรรทัดบน / value บรรทัดล่าง
   * - inline             → label และ value อยู่บรรทัดเดียวกัน
   */
  layout?: "stacked" | "inline";
}

// =============================================================================
// Table Block
// =============================================================================

/**
 * Table Block — render field value เป็น table (Requirement G)
 *
 * ใช้ **เฉพาะ** field ที่มีค่าเป็นหลายแถวจริง (repeatable)
 * Table Picker ต้องกรองเฉพาะ field ที่มี capability นี้
 */
export interface TableBlock extends BaseBlock {
  type: "table";
  /** field_master.id — field ที่เก็บ table data (array of objects) */
  fieldId: string;
  /** label ที่แสดงเหนือตาราง (optional) */
  label?: string;
  /** แสดง label หรือซ่อน (default: true) */
  showLabel?: boolean;
  /** ข้อความเมื่อไม่มีข้อมูล (default: "(ไม่มีข้อมูล)") */
  emptyText?: string;
}

// =============================================================================
// Logo Block
// =============================================================================

/**
 * แหล่งที่มาของโลโก้ (Requirement D)
 *
 * - `organization` → โลโก้หน่วยงาน (source จริงจากระบบ)
 * - `upload`       → อัปโหลดรูปเอง (ยังไม่มี asset storage — ดูหมายเหตุด้านล่าง)
 * - `none`         → ไม่แสดงโลโก้
 */
export type LogoSource = "organization" | "upload" | "none";

/**
 * Logo Block — render logo image (Requirement D)
 *
 * ── ข้อจำกัดที่ตรวจพบจริง (รายงานตาม Requirement D) ────────────────────
 *   ระบบ **ไม่มี** column logo ในตาราง `organizations`
 *   (organizations = id, name, display_order, is_active, created_at, updated_at)
 *   และ **ไม่มี** asset storage สำหรับ Admin
 *   (มีแต่ R2 route สาธารณะที่รับเฉพาะ PDF เอกสารสมัคร — ใช้ไม่ได้)
 *
 *   ดังนั้น:
 *     - source = "organization" → ยังไม่มี source จริง → แสดง "ยังไม่มีโลโก้"
 *       (พร้อมเชื่อมต่อได้ภายหลังโดยไม่ต้องเปลี่ยน schema)
 *     - source = "upload"       → โครงสร้างข้อมูลรองรับไว้ล่วงหน้า (imageUrl)
 *       แต่ UI จะ disable ไว้เพราะไม่มีช่องทางอัปโหลด
 *     - source = "none"         → ไม่แสดงโลโก้
 *
 *   ห้ามแสดงกรอบรูปว่าง และห้ามทำให้ Preview/PDF ล้ม
 */
export interface LogoBlock extends BaseBlock {
  type: "logo";
  /** แหล่งโลโก้ (default: "organization" — คงพฤติกรรมเดิมไว้) */
  source?: LogoSource;
  /** ความกว้าง (px ใน preview / pt ใน PDF) (default: 70 — คงเดิมไว้) */
  width?: number;
  /**
   * ความสูง — null/undefined = auto (รักษา aspect ratio จากรูปจริง)
   * ถ้าระบุตัวเลข → ยังคง aspect ratio เป็นหลัก (คำนวณจากรูปต้นฉบับ)
   */
  height?: number;
  /** alt text / คำอธิบาย (ใช้เมื่อโลโก้โหลดไม่ได้) */
  alt?: string;
  /**
   * URL ของรูปที่อัปโหลดเอง (forward-compatible)
   * ยังไม่มี asset storage — ถ้ามีค่าแต่โหลดไม่ได้จะแสดง "ยังไม่มีโลโก้"
   */
  imageUrl?: string;
}

// =============================================================================
// Signature Block
// =============================================================================

/**
 * แหล่งที่มาของวันทีใน Signature Block (Requirement C.5)
 *
 * - `APPLICATION_DATE` → วันที่สมัคร (applications.submitted_at)
 * - `PRINT_DATE`       → วันที่พิมพ์ (เวลาสร้างเอกสาร)
 * - `none`             → ไม่แสดงวันที่
 *
 * ค่า default = "APPLICATION_DATE" (คงพฤติกรรมเดิมไว้)
 */
export type SignatureDateSource = "APPLICATION_DATE" | "PRINT_DATE" | "none";

/**
 * Signature Block — ส่วนจัดหน้าสำหรับชื่อ วันที่ และเส้นลงลายมือชื่อ (Requirement C)
 *
 * ── ขอบเขต ─────────────────────────────────────────────────────────────
 *   ไม่ใช่ช่องลายเซ็นดิจิทัล — เป็นส่วนจัดหน้าเท่านั้น
 *   และ **ห้ามสร้าง Application Field ชื่อ "ลายมือชื่อ" โดยอัตโนมัติ**
 *
 * ── ค่าเริ่มต้น (Requirement C — ค่าเริ่มต้น) ─────────────────────────────
 *   ลงลายมือชื่อ ........................................ ผู้สมัคร
 *   ({ชื่อ-นามสกุล})
 *   วันที่ {APPLICATION_DATE}
 *
 * ── Data Sources ───────────────────────────────────────────────────────
 *   - ชื่อ: nameFieldId → Application Field (field_master.id)
 *            ถ้าไม่กำหนด → fallback ไป application.fullname
 *   - วันที่: dateSource → APPLICATION_DATE / PRINT_DATE / none
 */
export interface SignatureBlock extends BaseBlock {
  type: "signature";
  /** ขนาดตัวอักษร (default: "small") */
  size?: Size;

  // ── ข้อความ ──────────────────────────────────────────────────────────
  /** ป้ายกำกับบทบาท เช่น "ผู้สมัคร", "ผู้รับรอง" (default: "ผู้สมัคร") */
  roleLabel?: string;
  /**
   * label ก่อนเส้นลายเซ็น (default: "ลงลายมือชื่อ")
   * Admin แก้ได้ เช่น "ลงชื่อ"
   */
  lineLabel?: string;
  /**
   * รูปแบบเส้นลายเซ็น (default: 40 จุด)
   * เช่น "........................................"
   */
  lineStyle?: string;
  /**
   * label ก่อนวันที่ (default: "วันที่")
   * Admin แก้ได้ เช่น "วันที่ยื่นใบสมัคร"
   */
  dateLabel?: string;

  // ── แหล่งข้อมูลชื่อ ──────────────────────────────────────────────────
  /**
   * Application Field สำหรับชื่อผู้สมัคร
   * เก็บเป็น field_master.id (stable mapping key)
   * ห้ามผูกด้วย label อย่างเดียว (Requirement C.4)
   * ไม่กำหนด → ใช้ application.fullname (fallback เดิม)
   */
  nameFieldId?: string;
  /** แหล่งข้อมูลชื่อ (legacy — ยังรองรับเพื่อ BC) */
  signerNameSource?: "application";
  /** แสดง "(ชื่อผู้สมัคร)" หรือไม่ (default: true) */
  showName?: boolean;
  /** แสดงวงเล็บรอบชื่อหรือไม่ (default: true) */
  showParentheses?: boolean;

  // ── แหล่งข้อมูลวันที่ ────────────────────────────────────────────────
  /** แหล่งข้อมูลวันที่ (default: "APPLICATION_DATE") */
  dateSource?: SignatureDateSource;
  /** legacy — ยังรองรับเพื่อ BC */
  dateSourceLegacy?: "application";
  /** แสดง "วันที่ ..." หรือไม่ (default: true) */
  showDate?: boolean;
  /** แสดงเวลาหรือไม่ (default: false — เอกสารราชการไม่แสดงเวลา) */
  showTime?: boolean;

  /** แหล่งข้อมูลเวลา (legacy — ยังรองรับเพื่อ BC) */
  timeSource?: "application";
}

// =============================================================================
// Union
// =============================================================================

export type DocumentBlock =
  | HeadingBlock
  | FieldBlock
  | TableBlock
  | LogoBlock
  | SignatureBlock
  | SystemDataBlock
  | PageBreakBlock;

// =============================================================================
// Document Descriptor (top-level)
// =============================================================================

/**
 * Document Descriptor — รายการ blocks ที่จะ render ตามลำดับ
 *
 * Single Column Flow: blocks render ตาม array order จากบนลงล่าง
 */
export interface DocumentDescriptor {
  /** schema version (still 1 — ไม่ bump เพื่อ BC ตาม Requirement J.5) */
  version: 1;
  /** ordered list of blocks */
  blocks: DocumentBlock[];
  /**
   * การตั้งค่าหน้ากระดาษ (ขอบกระดาษ) — optional
   *
   * ⚠️ Backward compatibility:
   *   descriptor เก่าที่ไม่มี field นี้ → ต้อง fallback เป็น 40pt ทุกด้าน
   *   (ดู resolvePageGeometry() ใน page-settings.ts)
   *
   * ⚠️ ขอบเขต: มีผลกับ Preview เท่านั้น — PDF Renderer ยังไม่รองรับ
   */
  pageSettings?: PageSettings;
}

// =============================================================================
// Shared constants (single source of truth สำหรับ default values)
// =============================================================================

/** ค่าเริ่มต้นของข้อความใน Signature Block */
export const DEFAULT_SIGNATURE_LINE_LABEL = "ลงลายมือชื่อ";
export const DEFAULT_SIGNATURE_ROLE_LABEL = "ผู้สมัคร";
export const DEFAULT_SIGNATURE_DATE_LABEL = "วันที่";
export const DEFAULT_SIGNATURE_LINE_STYLE = "........................................";

/** Visibility defaults — mirror renderer */
export const DEFAULT_SHOW_NAME = true;
export const DEFAULT_SHOW_PARENTHESES = true;
export const DEFAULT_SHOW_DATE = true;
export const DEFAULT_SHOW_TIME = false;

/** ค่าเริ่มต้นของรูปแบบวันที่ */
export const DEFAULT_DATE_FORMAT: DateFormat = "thai_long";

/** label มาตรฐานของ System Data key */
export const SYSTEM_DATA_LABELS: Record<SystemDataKey, string> = {
  APPLICATION_NO: "เลขที่ใบสมัคร",
  ROUND_NAME: "ชื่อรอบการสมัคร",
  APPLICATION_DATE: "วันที่สมัคร",
  PRINT_DATE: "วันที่พิมพ์",
  POSITION_NAME: "ชื่อตำแหน่ง",
};

/** ข้อความเมื่อไม่มีโลโก้ (Requirement D — ห้ามแสดงกรอบรูปว่าง) */
export const NO_LOGO_TEXT = "ยังไม่มีโลโก้";