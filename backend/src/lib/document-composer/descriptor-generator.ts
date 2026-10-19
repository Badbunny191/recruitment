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
 * Mapping Rules:
 *   1. ใส่ Logo Block เป็น block แรก (ด้านบนสุด)
 *   2. เรียง sections ตาม displayOrder (asc)
 *   3. ภายใน section: เรียง fields ตาม displayOrder (asc)
 *   4. แต่ละ section ที่มี name → สร้าง Heading Block (size: medium, bold)
 *      - ถ้า field ไม่มี section (sectionId === null) → ไม่สร้าง heading
 *   5. แต่ละ field → สร้าง Field Block หรือ Table Block
 *      - Field Block  : field type ปกติ (TEXT, TEXTAREA, NUMBER, DATE, FILE,
 *                       DROPDOWN, RADIO, CHECKBOX)
 *      - Table Block  : field type MASTER_DATA ที่ติ๊ก tableFields หรือ
 *                       ตาม heuristic ที่ generator เลือก
 *   6. descriptor.version = 1 (literal)
 *
 * Pure:
 *   - ไม่อ่าน DB
 *   - ไม่เขียน DB
 *   - ไม่มี side effect
 *   - input เดียวกัน → output เดียวกัน
 *
 * Output:
 *   - DocumentDescriptor (validated ผ่าน validateDescriptor() ภายใน)
 *   - คืนเป็น result type เพื่อให้ caller ตรวจสอบได้ (ok / errors)
 */

import { validateDescriptor } from "./descriptor-validator";
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
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
 * ตรงกับ field_master.fieldType (subset)
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
  | "MASTER_DATA";

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
   * ถ้าไม่ระบุ → generator จะใช้ heuristic:
   *   - MASTER_DATA → Table Block
   *   - อื่นๆ → Field Block
   */
  tableFieldIds?: string[];
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
  /** จำนวน heading block (เท่ากับจำนวน section ที่มี name) */
  headingCount: number;
  /** จำนวน field block ที่ generate */
  fieldBlockCount: number;
  /** จำนวน table block ที่ generate */
  tableBlockCount: number;
  /** block ทั้งหมดที่ generate (รวม logo) */
  totalBlocks: number;
}

// =============================================================================
// Generator
// =============================================================================

/**
 * สร้าง DocumentDescriptor จาก sections + fields
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

  // 5a) Logo block (ด้านบนสุด)
  const logoBlock: LogoBlock = {
    id: makeBlockId("logo"),
    type: "logo",
    align: "left",
  };
  blocks.push(logoBlock);

  // 5b) Sections + their fields
  for (const section of sortedSections) {
    // 5b-i) Section header (only ถ้า section.name ไม่ว่าง)
    if (section.name && section.name.trim().length > 0) {
      const headingBlock: HeadingBlock = {
        id: makeBlockId(`heading-${section.id}`),
        type: "heading",
        text: section.name,
        size: "medium",
        bold: true,
        align: "left",
        marginTop: 12,
        marginBottom: 8,
      };
      blocks.push(headingBlock);
      headingCount += 1;
    }

    // 5b-ii) Fields ใน section
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

  // 5c) Unsectioned fields (เรียงต่อท้ายสุด ตาม displayOrder)
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
 * Decision table:
 *   - field.id ∈ tableFieldIds        → Table Block
 *   - type === 'MASTER_DATA'          → Table Block (heuristic)
 *   - else                            → Field Block
 */
function buildFieldBlock(
  field: GeneratorFieldInput,
  tableFieldIds: string[] | undefined
): FieldBlock | TableBlock {
  const isTable =
    (tableFieldIds?.includes(field.id) ?? false) ||
    field.type === "MASTER_DATA";

  const label = field.overrideLabelTh ?? field.labelTh;
  const common = {
    id: makeBlockId(`${field.type}-${field.id}`),
    marginTop: 0,
    marginBottom: 8,
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
