/**
 * Document Composer V1 — Preview Model
 *
 * Data structure สำหรับ HTML Preview
 *
 * Preview เป็น HTML Preview Model ที่ render จาก DocumentDescriptor ตัวเดียวกับ PDF
 * (single source of truth) เพื่อให้ผลลัพธ์ระหว่าง Preview กับ PDF ใกล้กันที่สุด
 *
 * Design Principles:
 *   - ไม่ผูกกับ framework (Next.js, React)
 *   - ไม่มี inline-style สำหรับ spacing (ใช้ class เพื่อให้ reuse CSS ได้)
 *   - structural HTML เท่านั้น — style เพิ่มเติมผ่าน class เพื่อให้ HR team
 *     สามารถ override theme ได้ในอนาคโดยไม่ต้องแก้ renderer
 *   - ไม่มี inline-script / iframe / external resource
 */

/**
 * HTML Preview Model — output ของ preview renderer
 *
 * field:
 *   - html: HTML string ของทั้งเอกสาร (semantic + structural)
 *   - body: HTML สำหรับ body content เท่านั้น (ไม่รวม <html>/<head>/<body> wrapper)
 *   - meta: ข้อมูล debug + inspect
 *
 * body แยกจาก html เพื่อให้ consumer ที่ต้องการ inline content เข้าไปใน layout
 * อื่น (เช่น embed ใน admin page) สามารถใช้ body ได้โดยตรง
 */
export interface PreviewModel {
  /** full HTML document (html + body wrapper) */
  html: string;
  /** body content เท่านั้น (ไม่มี <html>/<head>/<body> wrapper) */
  body: string;
  /** debug + inspect info */
  meta: PreviewMeta;
}

/**
 * Debug + inspect info ที่แนบมากับ preview
 *
 * มีไว้เพื่อ:
 *   - ตรวจสอบ descriptor ที่ render (block count, missing fields)
 *   - debug การ layout (label บอก margin/align ของแต่ละ block)
 *   - inspect ใน test (assert ได้ว่า block ถูก render ครบ)
 */
export interface PreviewMeta {
  /** จำนวน block ทั้งหมดใน descriptor */
  blockCount: number;
  /** จำนวน field/table block ที่ resolve ได้ */
  fieldRefCount: number;
  /** fieldId ที่ resolve ไม่เจอ (ไม่ render block เหล่านี้) */
  missingFieldIds: string[];
  /** รายการ block ที่ render เป็น HTML (เรียงตาม descriptor order) */
  renderedBlocks: RenderedBlockSummary[];
}

/**
 * Summary ของแต่ละ block ที่ render
 *
 * ใช้สำหรับ inspect/debug เท่านั้น ไม่กระทบ HTML output
 */
export interface RenderedBlockSummary {
  /** block id (จาก descriptor) */
  blockId: string;
  /** block type */
  type: "heading" | "field" | "table" | "logo";
  /** align ที่ใช้ render */
  align: "left" | "center" | "right";
  /** margin top ที่ใช้ render (pt) */
  marginTop: number;
  /** margin bottom ที่ใช้ render (pt) */
  marginBottom: number;
  /** field reference status (เฉพาะ field/table block) */
  fieldStatus?: "resolved" | "missing";
}
