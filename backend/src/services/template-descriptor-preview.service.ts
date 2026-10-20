/**
 * Template Descriptor Preview Service
 * --------------------------------------------
 * Feature: Document Composer V1 — Admin API Layer
 *
 * สร้าง ApplicationContext ชั่วคราวจาก template version
 * เพื่อใช้กับ renderDescriptorToPreview()
 *
 * Design:
 *   - ไม่ต้องมี application จริง
 *   - ใช้ formData ตัวอย่าง (sample/mock) เพื่อให้ preview แสดงผลได้
 *   - sections + fields + formData ต้อง consistent กัน
 *
 * Reuse strategy:
 *   - ไม่อ่าน DB ใหม่ — caller (route handler) ส่ง templateVersionId
 *     แล้ว service query sections + fields เอง
 *   - field shape ตรงกับ ApplicationContext.fields (FieldData)
 */

import { eq, asc } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import {
  templateSections,
  templateFields,
  fieldMaster,
  templateVersions,
  recruitmentRounds,
} from '../db/schema';
import type { ApplicationContext, FieldData } from '../lib/pdf-types';
import { buildPreview } from '../utils/application-pattern';

type DB = ReturnType<typeof drizzleFn<any>>;

// Test-only seam: lets unit tests inject a pre-built Drizzle instance
// (e.g. better-sqlite3). Mirrors the pattern in template-descriptor.service.ts
// and rbac.service.ts. Production code never sets this.
let __drizzleOverride: any = null;
export function __setDrizzleForTests(instance: any) {
  __drizzleOverride = instance;
}

function resolveDb(db: DB): DB {
  if (__drizzleOverride !== null) return __drizzleOverride as DB;
  return db;
}

/**
 * Build sample row สำหรับ MASTER_DATA (table block) ที่ตรงกับ schema ของ field นั้นๆ
 *
 * ── ก่อนหน้านี้ (BUG) ──────────────────────────────────────────────
 * ทุก MASTER_DATA field ได้ row hard-coded:
 *   { ปีการศึกษา: '2566', สถาบัน: 'ตัวอย่าง', วุฒิ: 'ตัวอย่าง' }
 * → Preview ของ Table block แสดง header "ปีการศึกษา | สถาบัน | วุฒิ"
 *   ไม่ว่า field จริงจะเป็น "สังกัดปัจจุบัน", "หน่วยงาน", หรือ field อื่นใดก็ตาม
 * → หลอกผู้ใช้ + ไม่ตรงกับ field ที่เลือก
 *
 * ── หลัง (FIX) ─────────────────────────────────────────────────────
 * ใช้ field.label เป็น column name → schema-driven sample
 * - preview สะท้อน field ที่ผู้ใช้เลือกจริง
 * - cell value ใช้ placeholder สั้นๆ เพื่อทดสอบ wrap/length
 *
 * NOTE: จำนวน column ถูก derive จาก `Object.keys(row[0])` ใน preview-renderer.ts:502
 *       ดังนั้นตัวอย่าง row นี้จะกำหนด column structure ทั้งหมดของ preview
 */
function buildMasterDataSample(field: FieldData): Record<string, unknown> {
  // ใช้ label เป็น column name (เป็นชื่อเดียวกับที่ผู้ใช้เห็นใน Composer)
  const columnName = field.label || field.fieldId;
  return { [columnName]: `ตัวอย่าง ${columnName}` };
}

/**
 * Build sample formData สำหรับ preview
 *
 * ใช้ sample values เพื่อให้ preview renderer แสดงผล field/table ได้
 * - fieldId (field_master.id) เป็น key
 * - ถ้า field type = MASTER_DATA → ใช้ schema-aware sample (ตาม field.label)
 * - อื่นๆ → ใช้ text sample
 *
 * ── [Live Preview] Field-first ────────────────────────────────────────────
 * field ที่ทำหน้าที่เป็น "document header" (เช่นชื่อตำแหน่ง/เลขตำแหน่ง)
 * ต้องได้ค่าที่อ่านได้เป็นชื่อ/เลขจริง ไม่ใช่ "ตัวอย่าง{label}"
 * ไม่งั้น token resolver จะ resolve ค่าที่ไม่สมจริงลงหัวเอกสาร
 */
function buildSampleFormData(fields: FieldData[]): Record<string, unknown> {
  const formData: Record<string, unknown> = {};

  for (const field of fields) {
    const options = effectiveOptionsOf(field);

    if (isDocumentTokenField(field)) {
      // ── [Live Preview] field ที่เป็น document token → ค่าตัวอย่างที่อ่านได้จริง
      formData[field.fieldId] = buildDocumentTokenSample(field);
    } else if (field.type === 'MASTER_DATA') {
      // ── FIX: schema-aware sample (ตาม field.label) แทน hard-coded education data ──
      const columnName = field.label || field.fieldId;
      formData[field.fieldId] = [
        buildMasterDataSample(field),
        { [columnName]: `ตัวอย่าง ${columnName} 2` },
      ];
    } else if (field.type === 'DATE') {
      formData[field.fieldId] = '2566-01-15';
    } else if (field.type === 'CHECKBOX') {
      formData[field.fieldId] = true;
    } else if (field.type === 'FILE') {
      formData[field.fieldId] = '(ตัวอย่างไฟล์แนบ)';
    } else if (
      (field.type === 'DROPDOWN' || field.type === 'RADIO') &&
      options.length > 0
    ) {
      // ── [Live Preview] choice field → ใช้ option จริงของ field
      //    ไม่ใช้ "ตัวอย่าง{label}" เพราะค่านั้นไม่มีอยู่จริงในรายการ
      //    → preview จะโชว์ select ที่ selected ไม่ตรงกับตัวเลือกใดเลย
      formData[field.fieldId] = options[0];
    } else {
      formData[field.fieldId] = `ตัวอย่าง${field.label}`;
    }
  }

  return formData;
}

/**
 * ตัวเลือกที่ใช้ได้จริงของ field — override มีค่าใช้ override เสมอ
 * (mirror TemplateBuilder / preview-renderer)
 */
function effectiveOptionsOf(field: FieldData): string[] {
  if (field.overrideOptions && field.overrideOptions.length > 0) {
    return field.overrideOptions;
  }
  return field.options ?? [];
}

/**
 * [Live Preview] alias ที่ถือว่า field นั้นเป็น "document header"
 *
 * ต้องตรงกับรายการใน document-tokens.ts (TOKEN_FIELD_ALIASES)
 * เก็บเป็น lowercase เพื่อเทียบ case-insensitive
 *
 * NOTE: ไม่มี {APPLICATION_NO} ใน list นี้ เพราะเลขที่ใบสมัครมาจาก
 *       round.pattern โดยตรง (ไม่ใช่ form field ของผู้สมัคร)
 */
const DOCUMENT_TOKEN_ALIASES = new Set<string>([
  // POSITION_NUMBER
  'position_number',
  'position_no',
  'positionnumber',
  'position_no_position',
  'เลขที่ตำแหน่ง',
  'เลขตำแหน่ง',
  'ตำแหน่งที่ประกาศรับสมัคร',
  // POSITION_NAME
  'position_name',
  'positionname',
  'position_title',
  'position',
  'ชื่อตำแหน่ง',
  'ตำแหน่ง',
  // POSITION_LEVEL
  'position_level',
  'positionlevel',
  'ระดับตำแหน่ง',
  // ROUND_CODE
  'round_code',
  'roundcode',
  'รหัสรอบ',
]);

/**
 * field ที่ทำหน้าที่เป็น document header (ไม่ใช่คำตอบของผู้สมัคร)
 *
 * ตรวจจาก pdfMappingKey / fieldId ว่าตรงกับ alias ของ token ใด token หนึ่ง
 */
function isDocumentTokenField(field: FieldData): boolean {
  const keys = [field.pdfMappingKey, field.fieldId].filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
  return keys.some((k) => DOCUMENT_TOKEN_ALIASES.has(k.toLowerCase()));
}

/**
 * สร้างค่าตัวอย่างสำหรับ document token field
 *
 * ค่าต้อง "อ่านได้เป็นชื่อ/เลข" ตามธรรมชาติ เพื่อให้ preview หัวเอกสาร
 * ดูเหมือนเอกสารจริง (ไม่ใช่ "ตัวอย่างตำแหน่ง")
 */
function buildDocumentTokenSample(field: FieldData): string {
  const keys = [field.pdfMappingKey, field.fieldId].filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
  const key = (keys[0] ?? '').toLowerCase();

  if (key.includes('number') || key.includes('_no') || key.includes('เลข')) {
    return '๑๒/๒๕๖๙';
  }
  return 'นายสมชาย ใจดี';
}

/**
 * Build preview context จาก template version
 *
 * ใช้สำหรับเรียก renderDescriptorToPreview()
 * โดยไม่ต้องสร้าง Application จริง
 *
 * @param db - Drizzle instance
 * @param templateVersionId - template version id ที่ต้องการ preview
 * @returns ApplicationContext สำหรับ preview, หรือ null ถ้าไม่พบ
 */
export async function buildPreviewContext(
  db: ReturnType<typeof drizzleFn<any>>,
  templateVersionId: string
): Promise<ApplicationContext | null> {
  const resolved = resolveDb(db);

  // 1) Verify template version exists
  const tv = await resolved
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId))
    .get();
  if (!tv) return null;

  // 2) Load sections
  const sectionsRaw = await resolved
    .select({
      id: templateSections.id,
      name: templateSections.name,
      displayOrder: templateSections.displayOrder,
    })
    .from(templateSections)
    .where(eq(templateSections.templateVersionId, templateVersionId))
    .orderBy(asc(templateSections.displayOrder));

  const sections = sectionsRaw.map((s) => ({
    id: s.id,
    name: s.name,
    displayOrder: s.displayOrder,
  }));

  // 3) Load fields (joined with field_master)
  const fieldsRaw = await resolved
    .select({
      templateFieldId: templateFields.id,
      fieldId: templateFields.fieldId,
      sectionId: templateFields.sectionId,
      displayOrder: templateFields.displayOrder,
      isRequired: templateFields.isRequired,
      type: fieldMaster.fieldType,
      label: fieldMaster.labelTh,
      pdfMappingKey: fieldMaster.pdfMappingKey,
      options: fieldMaster.defaultOptions,
      overrideOptions: templateFields.overrideOptions,
      rows: templateFields.rows,
      helpText: fieldMaster.helpText,
      placeholder: fieldMaster.placeholder,
    })
    .from(templateFields)
    .innerJoin(fieldMaster, eq(templateFields.fieldId, fieldMaster.id))
    .where(eq(templateFields.templateVersionId, templateVersionId))
    .orderBy(asc(templateFields.displayOrder));

  const fields: FieldData[] = fieldsRaw.map((f) => {
    // Parse options (mirror pdf.service.ts logic)
    let options: string[] | null = null;
    if (f.options) {
      try {
        const parsed =
          typeof f.options === 'string' ? JSON.parse(f.options) : f.options;
        if (Array.isArray(parsed)) {
          options = parsed.map((o: any) =>
            typeof o === 'string' ? o : (o?.label ?? o?.value ?? String(o))
          );
        }
      } catch {
        // ignore parse error
      }
    }
    let overrideOptions: string[] | null = null;
    if (f.overrideOptions) {
      try {
        const parsed =
          typeof f.overrideOptions === 'string'
            ? JSON.parse(f.overrideOptions)
            : f.overrideOptions;
        if (Array.isArray(parsed)) {
          overrideOptions = parsed.map((o: any) =>
            typeof o === 'string' ? o : (o?.label ?? o?.value ?? String(o))
          );
        }
      } catch {
        // ignore parse error
      }
    }

    return {
      id: f.templateFieldId,
      fieldId: f.fieldId,
      sectionId: f.sectionId,
      displayOrder: f.displayOrder,
      type: f.type as any,
      label: f.label,
      pdfMappingKey: f.pdfMappingKey,
      options,
      overrideOptions,
      isRequired: !!f.isRequired,
      rows: f.rows,
      helpText: f.helpText,
      placeholder: f.placeholder,
    };
  });

  // 4) Build sample formData
  const formData = buildSampleFormData(fields);

  // 5) ── [Live Preview] Load round จริงที่ผูกกับ template version นี้ ──────
  //    ใช้เป็น fallback สำหรับ token ที่ไม่มี field รองรับ (เช่น ระดับตำแหน่ง)
  //    ถ้าไม่มี round → ใช้ค่า preview placeholder (ไม่ทำให้ preview พัง)
  const round = await loadPrimaryRound(resolved, templateVersionId);

  // 6) ── [Live Preview] Application number จริง (จาก round pattern) ──────
  //    ใช้ buildPreview() ของ application-pattern engine → ได้เลขจำลองจริง
  //    เช่น round pattern "{YEAR}-{ROUND_CODE}-{RUNNING:4}" → "2026-CHM01-0001"
  //    ถ้าไม่มี pattern/round → fallback เป็น "PREVIEW-0001" (คงเดิมเพื่อไม่ break test)
  const applicationNo = buildPreviewApplicationNo(round);

  // 7) Return ApplicationContext (preview-only)
  return {
    application: {
      id: `preview-${templateVersionId}`,
      applicationNo,
      email: 'preview@example.com',
      fullname: 'ตัวอย่าง ผู้สมัคร',
      nationalId: null,
      status: 'PREVIEW',
      statusReason: null,
      submittedAt: Math.floor(Date.now() / 1000),
      formData,
    },
    round: {
      id: round?.id ?? `preview-round-${templateVersionId}`,
      title: round?.title ?? 'Preview Mode',
      positionLevel: round?.positionLevel ?? 'N/A',
      announcementTitle: round?.announcementTitle ?? null,
      announcementDescription: round?.announcementDescription ?? null,
      applicationPattern: round?.applicationPattern ?? null,
      roundCode: round?.roundCode ?? null,
    },
    templateVersion: {
      id: tv.id,
      versionNumber: tv.versionNumber,
    },
    sections,
    fields,
    attachments: [],
  };
}

/**
 * [Live Preview] โหลด round ที่ผูกกับ template version นี้ (round ล่าสุดที่ยังไม่ถูกลบ)
 *
 * หนึ่ง template version อาจมีหลาย round → เอาล่าสุดเป็นตัวแทน
 * เพราะ preview แสดง "รูปแบบเอกสาร" ไม่ใช่ "เอกสารของ round ใด round หนึ่ง"
 *
 * @returns round row หรือ null (ไม่มี round → caller ใช้ placeholder)
 */
async function loadPrimaryRound(
  db: DB,
  templateVersionId: string
): Promise<typeof recruitmentRounds.$inferSelect | null> {
  try {
    return (
      (await db
        .select()
        .from(recruitmentRounds)
        .where(eq(recruitmentRounds.templateVersionId, templateVersionId))
        .orderBy(asc(recruitmentRounds.createdAt))
        .get()) ?? null
    );
  } catch (err) {
    // Round เป็นข้อมูลเสริม (fallback ของ token) — ไม่พร้อม = ยัง preview ได้
    // Log แบบ single line (ไม่ dump stack) เพราะเกิดได้ทุก request
    // เช่น test harness ที่ไม่ได้สร้างตาราง recruitment_rounds
    console.warn(
      `[preview] round lookup skipped (${templateVersionId}):`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * [Live Preview] สร้างเลขที่ใบสมัครจำลองจาก round pattern
 *
 * ใช้ engine เดียวกับตอนสร้างเลขจริง (utils/application-pattern.ts)
 * → preview แสดงรูปแบบเลขที่ตรงกับที่ผู้สมัครจะได้รับจริง
 *
 * @returns เลขที่ใบสมัคร หรือ "PREVIEW-0001" เมื่อไม่มี round/pattern
 */
function buildPreviewApplicationNo(
  round: typeof recruitmentRounds.$inferSelect | null
): string {
  const pattern = round?.applicationPattern;

  // ไม่มี round หรือไม่มี pattern → ใช้ค่า preview ที่ระบุชัดว่าเป็นจำลอง
  if (!round || !pattern || pattern.trim().length === 0) {
    return 'PREVIEW-0001';
  }

  // Year อ้างอิงจาก openDate ของ round (null-safe)
  const year = round.openDate ? new Date(round.openDate).getFullYear() : undefined;

  const preview = buildPreview(pattern, {
    ...(year !== undefined ? { year } : {}),
    ...(round.roundCode ? { roundCode: round.roundCode } : {}),
    running: 1,
  });

  // buildPreview คืน pattern เดิมเมื่อ pattern ไม่ผ่าน validation
  // (เช่น round ที่ admin ยังไม่ได้ตั้งค่าให้ครบ) → อย่าเอา pattern ดิบมาแสดง
  if (preview === pattern) {
    return 'PREVIEW-0001';
  }

  return preview;
}
