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
} from '../db/schema';
import type { ApplicationContext, FieldData } from '../lib/pdf-types';

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
 * Stub formData สำหรับ preview
 *
 * ใช้ sample values เพื่อให้ preview renderer แสดงผล field/table ได้
 * - fieldId (field_master.id) เป็น key
 * - ถ้า field type = MASTER_DATA → ใช้ schema-aware sample (ตาม field.label)
 * - อื่นๆ → ใช้ text sample
 */
function buildSampleFormData(fields: FieldData[]): Record<string, unknown> {
  const formData: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.type === 'MASTER_DATA') {
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
    } else {
      formData[field.fieldId] = `ตัวอย่าง${field.label}`;
    }
  }

  return formData;
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

  // 5) Return ApplicationContext (preview-only)
  return {
    application: {
      id: `preview-${templateVersionId}`,
      applicationNo: 'PREVIEW',
      email: 'preview@example.com',
      fullname: 'ตัวอย่าง ผู้สมัคร',
      nationalId: null,
      status: 'PREVIEW',
      statusReason: null,
      submittedAt: Math.floor(Date.now() / 1000),
      formData,
    },
    round: {
      id: `preview-round-${templateVersionId}`,
      title: 'Preview Mode',
      positionLevel: 'N/A',
      announcementTitle: null,
      announcementDescription: null,
      applicationPattern: null,
      roundCode: null,
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
