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

import type { PageGeometry } from "./page-settings";

/**
 * HTML Preview Model — output ของ preview renderer
 *
 * field:
 *   - html: HTML string ของทั้งเอกสาร (semantic + structural)
 *   - body: HTML สำหรับ body content เท่านั้น (ไม่รวม <html>/<head>/<body> wrapper)
 *   - header: HTML สำหรับ document header block (logo + title + tokens)
 *   - meta: ข้อมูล debug + inspect
 *   - mode: โหมดที่ใช้ render (form / document)
 *   - tokens: ค่า resolved tokens สำหรับ diagnostics
 *
 * body แยกจาก html เพื่อให้ consumer ที่ต้องการ inline content เข้าไปใน layout
 * อื่น (เช่น embed ใน admin page) สามารถใช้ body ได้โดยตรง
 */
export interface PreviewModel {
  /** full HTML document (html + body wrapper) */
  html: string;
  /** body content เท่านั้น (ไม่มี <html>/<head>/<body> wrapper) */
  body: string;
  /** document header block (logo placeholder + title + token strip) */
  header: string;
  /**
   * CSS ชุดเดียวกับที่ฝังใน `html` — ส่งให้ consumer ที่ประกอบ document
   * shell เอง (เช่น PreviewFrame iframe srcdoc) เพื่อไม่ให้เกิด CSS drift
   * ระหว่าง backend กับ frontend
   */
  styles: string;
  /** debug + inspect info */
  meta: PreviewMeta;
  /** โหมดที่ใช้ render (UI ใช้ toggle Form ↔ Document โดยไม่ต้อง parse HTML) */
  mode: PreviewMode;
  /** resolved token values (ใช้กับแผง diagnostics) */
  tokens: PreviewTokenInfo[];
  /**
   * Geometry ของหน้ากระดาษ (ขอบกระดาษที่ resolve แล้ว)
   *
   * ใช้โดย consumer (PreviewFrame) เพื่อกำหนด padding ของ `.dc-page`
   * ให้ตรงกับค่าที่ Admin เลือกใน UI "ตั้งค่าหน้ากระดาษ"
   */
  page: PageGeometry;
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
  type: "heading" | "field" | "table" | "logo" | "signature" | "systemData";
  /** align ที่ใช้ render */
  align: "left" | "center" | "right";
  /** margin top ที่ใช้ render (pt) */
  marginTop: number;
  /** margin bottom ที่ใช้ render (pt) */
  marginBottom: number;
  /** field reference status (เฉพาะ field/table block) */
  fieldStatus?: "resolved" | "missing";
}

/**
 * โหมดของ Live Preview
 *
 * - `form`     → body field เรนเดอร์เป็น form control จริง (input/textarea/select/…)
 *                ตาม field type — ใช้ดู "form UX" ที่ผู้สมัครจะเจอ
 * - `document` → body field เรนเดอร์เป็นข้อความ read-only (label + value)
 *                ใกล้กับ PDF มากที่สุด — ใช้ดู "document layout" จริง
 */
export type PreviewMode = "form" | "document";

/**
 * Token value สำหรับแผง diagnostics
 *
 * - `text`  = ค่าที่ resolve ได้ (อาจเป็น placeholder text เช่น "{APPLICATION_NO}")
 * - `empty` = true เมื่อไม่มีข้อมูลจริง
 * - `label` = ชื่อ human-readable สำหรับแสดงใน UI
 *
 * ── Requirement F: Source Metadata ───────────────────────────────────────
 * แต่ละรายการระบุที่มาของข้อมูล:
 *   - application       → ข้อมูลผู้สมัคร
 *   - application_form  → คำตอบในใบสมัคร
 *   - round             → รอบรับสมัคร
 *   - system            → ระบบ
 *   - descriptor         → การตั้งค่าเอกสาร
 *   - sample            → ข้อมูลตัวอย่าง
 *   - unresolved        → ยังไม่ได้ผูกข้อมูล
 *
 * Backend resolver เป็นผู้ส่ง source metadata ที่เชื่อถือได้
 * Frontend แปลงเป็นภาษาไทย (Application → ข้อมูลผู้สมัคร, ฯลฯ)
 */
export type TokenSource =
  | "application"
  | "application_form"
  | "round"
  | "system"
  | "descriptor"
  | "sample"
  | "unresolved";

export interface PreviewTokenInfo {
  token: string;
  label: string;
  text: string;
  empty: boolean;
  /** แหล่งที่มาของข้อมูล (default = "sample" สำหรับ backward compat) */
  source?: TokenSource;
}

/**
 * ค่า resolved ของ system token ที่ใช้จริงใน descriptor หนึ่ง
 * ใช้สำหรับ buildTokenDiagnosticsWithSource()
 */
export interface ResolvedTokenEntry {
  token: string;
  label: string;
  text: string;
  empty: boolean;
  source: TokenSource;
}
