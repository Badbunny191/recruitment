/**
 * Document Composer V1 — Descriptor Generator
 *
 * Pure function ที่สร้าง DocumentDescriptor อัตโนมัติจาก
 *   - template_sections
 *   - template_fields
 *
 * ใช้ตอน "สร้าง Template Version ใหม่" เพื่อ seed descriptor เริ่มต้น
 * ตาม structure ของ section/field ที่มีอยู่แล้ว
 *
 * Mapping Rules (อัปเดตสำหรับ requirements A–H):
 *   1. ใส่ Logo Block เป็น block แรก
 *      - source = "organization" (ค่าเริ่มต้น — หากไม่มีโลโก้จริง
 *        renderer แสดง "ยังไม่มีโลโก้" ตาม Requirement D)
 *   2. Heading/Text Block แบบ Title:
 *      "ใบสมัครเข้ารับการคัดเลือก\n{ROUND_NAME}"
 *   3. System Data Block:
 *      - APPLICATION_NO
 *      - APPLICATION_DATE
 *   4. Sections ตามลำดับ displayOrder
 *      - แต่ละ section ที่มี name → Heading Block (size: medium, bold)
 *      - ภายใน section เรียง fields ตาม displayOrder
 *   5. Fields กลายเป็น Field Block หรือ Table Block
 *      - Field Block   : field ค่าเดียว (default — รวม MASTER_DATA แบบ single-select)
 *      - Table Block   : field id ใน tableFieldIds
 *   6. Signature Block ต่อท้าย (Requirement C + H.8)
 *
 * Pure:
 *   - ไม่อ่าน DB
 *   - ไม่เขียน DB
 *   - ไม่มี side effect
 *   - input เดียวกัน → output เดียวกัน
 *
 * ── Replace semantics (Requirement H — Generate ไม่สร้าง Block ซ้ำ) ────
 *   generator สร้าง descriptor ใหม่ทุกครั้ง ไม่ merge/append — caller
 *   (Generate route) ต้อง overwrite ทับ descriptor เดิม ไม่ใช่ append
 *   การเปลี่ยนแปลงนี้ทำใน service layer (ไม่ใช่ใน generator) เพื่อไม่ให้
 *   pure function นี้มี side effect
 */

import { validateDescriptor } from "./descriptor-validator";
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
  SignatureBlock,
  SystemDataBlock,
} from "./types";

// =============================================================================
// Input shape (decoupled from Drizzle schema — ใช้ subset ที่ generator ต้องการ)
// =============================================================================

/**
 * Input section (subset ของ template_sections)
 */
export interface GeneratorSectionInput {
  id: string;
  name: string;
  displayOrder: number;
  isActive?: boolean;
}

/**
 * Field type ที่ generator รู้จัก
 *
 * ── รวม REPEATER / TABLE (Requirement G) ──────────────────────────────────
 * เพื่อให้ heuristic ในการเลือก Table Block ครอบคลุม field ใหม่ในอนาคต
 */
export type GeneratorFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "DATE"
  | "DROPDOWN"
  | "RADIO"
  | "CHECKBOX"
  | "FILE"
  | "EMAIL"
  | "PHONE"
  | "MASTER_DATA"
  | "REPEATER"
  | "TABLE";

/**
 * Input field (subset ของ template_fields + field_master)
 */
export interface GeneratorFieldInput {
  id: string;
  /** field_master.id — ใช้เป็น block.fieldId */
  fieldId: string;
  sectionId: string | null;
  displayOrder: number;
  type: GeneratorFieldType;
  /** override label (null → ใช้ labelTh จาก master) */
  overrideLabelTh: string | null;
  /** labelTh จาก field_master (fallback ถ้าไม่มี override) */
  labelTh: string;
}

/**
 * Input สำหรับ generator
 */
export interface GeneratorInput {
  sections: GeneratorSectionInput[];
  fields: GeneratorFieldInput[];
  /**
   * IDs ของ field (template_fields.id) ที่ต้องการให้ render เป็น Table Block
   *
   * ถ้าไม่ระบุ → heuristic ตาม type:
   *   - REPEATER / TABLE → Table Block
   *   - MASTER_DATA       → Field Block (Requirement F: ค่าเดียว ไม่ใช่ตาราง
   *                       จนกว่า Admin จะยืนยันว่าเป็น multi-select)
   *   - อื่นๆ            → Field Block
   */
  tableFieldIds?: string[];
  /**
   * Field id ที่ใช้เป็น "ชื่อผู้สมัคร" ใน Signature Block (Requirement C.4)
   * เก็บเป็น field_master.id (stable mapping key)
   * ถ้าไม่ระบุ → Signature block ใช้ application.fullname เป็น fallback
   */
  signatureNameFieldId?: string;
}

// =============================================================================
// Result types
// =============================================================================

export type GenerateResult =
  | {
      ok: true;
      descriptor: DocumentDescriptor;
      meta: GeneratorMeta;
    }
  | {
      ok: false;
      issues: { path: string; message: string }[];
    };

export interface GeneratorMeta {
  logoBlockId: string;
  headingCount: number;
  fieldBlockCount: number;
  tableBlockCount: number;
  systemDataCount: number;
  signatureBlockId: string;
  /** block ทั้งหมดที่ generate (รวม logo/heading/systemData/signature) */
  totalBlocks: number;
}

// =============================================================================
// Generator
// =============================================================================

/**
 * สร้าง DocumentDescriptor จาก sections + fields
 *
 * ── ลำดับ (Requirement H) ─────────────────────────────────────────────────
 *   1. Logo Block
 *   2. Heading Title: "ใบสมัครเข้ารับการคัดเลือก\n{ROUND_NAME}"
 *   3. System Data Block: APPLICATION_NO, APPLICATION_DATE
 *   4. Section Heading + Field/Table blocks (ตาม template version)
 *   5. Signature Block (ต่อท้าย)
 *
 * @param input - sections, fields, tableFieldIds (optional)
 * @returns GenerateResult { ok: true, descriptor, meta } | { ok: false, issues }
 *
 * Pure function — ไม่อ่าน/เขียน DB
 */
export function generateDescriptorFromTemplate(
  input: GeneratorInput
): GenerateResult {
  const blocks: DocumentBlock[] = [];
  const issues: { path: string; message: string }[] = [];

  // ── 1) Validate input shape ────────────────────────────────────────
  if (!Array.isArray(input.sections)) {
    issues.push({
      path: "sections",
      message: "sections must be an array",
    });
  }
  if (!Array.isArray(input.fields)) {
    issues.push({
      path: "fields",
      message: "fields must be an array",
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // ── 2) Section index (id → section) ────────────────────────────────
  const sectionIndex = new Map<string, GeneratorSectionInput>();
  for (const section of input.sections) {
    sectionIndex.set(section.id, section);
  }

  // ── 3) Index fields by section (sectionId → fields[]) ──────────────
  //        เก็บ field ที่ sectionId === null ไว้ใน key '__unsectioned__'
  const fieldsBySection = new Map<string, GeneratorFieldInput[]>();
  fieldsBySection.set("__unsectioned__", []);

  for (const field of input.fields) {
    const key = field.sectionId ?? "__unsectioned__";
    if (!fieldsBySection.has(key)) {
      fieldsBySection.set(key, []);
    }
    fieldsBySection.get(key)!.push(field);
  }

  // ── 4) Sort sections by displayOrder (asc) ─────────────────────────
  const sortedSections = [...input.sections].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  // ── 5) Build blocks ───────────────────────────────────────────────
  let headingCount = 0;
  let fieldBlockCount = 0;
  let tableBlockCount = 0;
  let systemDataCount = 0;

  // 5a) Logo block (ด้านบนสุด — Requirement H.1)
  const logoBlock: LogoBlock = {
    id: makeBlockId("logo"),
    type: "logo",
    align: "left",
    source: "organization", // ถ้าไม่มี source จริง → แสดง "ยังไม่มีโลโก้"
    alt: "โลโก้หน่วยงาน",
    width: 70,
  };
  blocks.push(logoBlock);

  // 5b) Title heading — "ใบสมัครเข้ารับการคัดเลือก\n{ROUND_NAME}"
  // (Requirement H.2)
  const titleBlock: HeadingBlock = {
    id: makeBlockId("heading-title"),
    type: "heading",
    text: "ใบสมัครเข้ารับการคัดเลือก\n{ROUND_NAME}",
    size: "large",
    bold: true,
    align: "center",
    marginTop: 12,
    marginBottom: 12,
  };
  blocks.push(titleBlock);
  headingCount += 1;

  // 5c) System Data Blocks (Requirement H.3)
  const applicationNoBlock: SystemDataBlock = {
    id: makeBlockId("systemData-application-no"),
    type: "systemData",
    key: "APPLICATION_NO",
    layout: "inline",
    showLabel: true,
    labelStyle: "small",
    valueStyle: "medium",
    marginTop: 0,
    marginBottom: 2,
  };
  blocks.push(applicationNoBlock);
  systemDataCount += 1;

  const applicationDateBlock: SystemDataBlock = {
    id: makeBlockId("systemData-application-date"),
    type: "systemData",
    key: "APPLICATION_DATE",
    layout: "inline",
    showLabel: true,
    labelStyle: "small",
    valueStyle: "medium",
    marginTop: 0,
    marginBottom: 6,
  };
  blocks.push(applicationDateBlock);
  systemDataCount += 1;

  // 5d) Sections + their fields (Requirement H.4-H.6)
  for (const section of sortedSections) {
    // 5d-i) Section header (only ถ้า section.name ไม่ว่าง)
    if (section.name && section.name.trim().length > 0) {
      const headingBlock: HeadingBlock = {
        id: makeBlockId(`heading-section-${section.id}`),
        type: "heading",
        text: section.name,
        size: "medium",
        bold: true,
        align: "left",
        marginTop: 10,
        marginBottom: 3,
      };
      blocks.push(headingBlock);
      headingCount += 1;
    }

    // 5d-ii) Fields ใน section
    const sectionFields = (fieldsBySection.get(section.id) ?? []).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );

    for (const field of sectionFields) {
      const block = buildFieldBlock(field, input.tableFieldIds);
      if (block.type === "field") {
        fieldBlockCount += 1;
      } else {
        tableBlockCount += 1;
      }
      blocks.push(block);
    }
  }

  // 5e) Unsectioned fields (เรียงต่อท้ายสุด ตาม displayOrder)
  const unsectionedFields = (fieldsBySection.get("__unsectioned__") ?? []).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
  for (const field of unsectionedFields) {
    const block = buildFieldBlock(field, input.tableFieldIds);
    if (block.type === "field") {
      fieldBlockCount += 1;
    } else {
      tableBlockCount += 1;
    }
    blocks.push(block);
  }

  // 5f) Signature Block ต่อท้าย (Requirement H.8)
  const signatureBlock: SignatureBlock = {
    id: makeBlockId("signature"),
    type: "signature",
    align: "right",
    marginTop: 14,
    marginBottom: 8,
    lineLabel: "ลงลายมือชื่อ",
    roleLabel: "ผู้สมัคร",
    lineStyle: "........................................",
    dateLabel: "วันที่",
    dateSource: "APPLICATION_DATE",
    showName: true,
    showParentheses: true,
    showDate: true,
    showTime: false,
    // ถ้า caller ระบุ signatureNameFieldId มา → ใช้ Application Field
    // มิฉะนั้น → fallback ไปใช้ application.fullname (ของเดิม)
    nameFieldId: input.signatureNameFieldId,
  };
  blocks.push(signatureBlock);

  // ── 6) Validate ผ่าน zod (defense in depth) ───────────────────────
  const candidate: DocumentDescriptor = {
    version: 1,
    blocks,
  };

  const validation = validateDescriptor(candidate);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }

  const meta: GeneratorMeta = {
    logoBlockId: logoBlock.id,
    headingCount,
    fieldBlockCount,
    tableBlockCount,
    systemDataCount,
    signatureBlockId: signatureBlock.id,
    totalBlocks: blocks.length,
  };

  return {
    ok: true,
    descriptor: validation.value as DocumentDescriptor,
    meta,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build field block จาก input field
 *
 * Decision table (Requirement F + G):
 *   - field.id ∈ tableFieldIds            → Table Block (explicit override)
 *   - type === 'REPEATER' | 'TABLE'       → Table Block (explicit type)
 *   - type === 'MASTER_DATA'              → Field Block (Requirement F.1:
 *                                          ห้ามถือว่า MASTER_DATA ทุกชนิดเป็น Table
 *                                          — แยก MASTER_DATA แบบค่าเดียวออกจาก
 *                                          repeatable; Admin ต้องระบุ tableFieldIds
 *                                          เองเมื่อ multi-select)
 *   - else                                → Field Block
 */
function buildFieldBlock(
  field: GeneratorFieldInput,
  tableFieldIds: string[] | undefined
): FieldBlock | TableBlock {
  const isExplicitTable =
    tableFieldIds?.includes(field.id) ?? false;
  const isRepeatableType =
    field.type === "REPEATER" || field.type === "TABLE";

  const isTable = isExplicitTable || isRepeatableType;

  const label = field.overrideLabelTh ?? field.labelTh;
  const common = {
    id: makeBlockId(`${field.type}-${field.id}`),
    marginTop: 0,
    marginBottom: 3,
  };

  if (isTable) {
    return {
      ...common,
      type: "table",
      fieldId: field.fieldId,
    };
  }

  return {
    ...common,
    type: "field",
    fieldId: field.fieldId,
    label,
    // Requirement E: ค่า default
    showLabel: true,
    showRequired: true,
    valueStyle: "medium",
    layout: "stacked",
  };
}

/**
 * สร้าง block id ที่ unique ภายใน descriptor
 *
 * Format: `{prefix}-{uuid}`
 * - ใช้ globalThis.crypto.randomUUID() (ทำงานได้ทั้ง Node และ Cloudflare Workers)
 * - prefix ช่วยในการ debug (อ่าน id แล้วรู้เลยว่าเป็น block ประเภทอะไร)
 */
function makeBlockId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}