import { z } from 'zod';
import { USER_ROLES } from '../types';

// Allowed values must stay in sync with the CHECK constraint "chk_field_type"
// in backend/src/db/schema.ts and the D1 table definition.
export const FieldTypeEnum = z.enum(['TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA']);
export const TemplateVersionStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const RoundStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const ApplicationStatusEnum = z.enum(['DRAFT', 'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED']);

// =============================================================================
// Authentication Schemas
// =============================================================================

// Role enum - synced with USER_ROLES in types.ts
export const UserRoleEnum = z.enum(USER_ROLES);

// Login schema - updated with password policy validation
export const LoginRequestSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

// Password validation regex patterns
const PASSWORD_POLICY = {
  minLength: 8,
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /[0-9]/,
  special: /[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?\\]/,
};

// User create schema
export const CreateUserSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  role: UserRoleEnum,
  mustChangePassword: z.boolean().default(true),
}).refine(
  (data) => data.role !== 'SUPER_ADMIN',
  { message: 'ไม่สามารถสร้างผู้ใช้ระดับ SUPER_ADMIN ได้', path: ['role'] }
);

// User update schema
export const UpdateUserSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง').optional(),
  role: UserRoleEnum.optional(),
  isActive: z.boolean().optional(),
}).refine(
  (data) => !(data.role === 'SUPER_ADMIN'),
  { message: 'ไม่สามารถเปลี่ยนเป็น SUPER_ADMIN ได้', path: ['role'] }
);

// Password change schema (for users changing their own password)
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
  newPassword: z.string()
    .min(PASSWORD_POLICY.minLength, `รหัสผ่านต้องมีความยาวอย่างน้อย ${PASSWORD_POLICY.minLength} ตัวอักษร`)
    .regex(PASSWORD_POLICY.uppercase, 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว')
    .regex(PASSWORD_POLICY.lowercase, 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว')
    .regex(PASSWORD_POLICY.number, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว')
    .regex(PASSWORD_POLICY.special, 'รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว'),
  confirmPassword: z.string().min(1, 'กรุณายืนยันรหัสผ่านใหม่'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'รหัสผ่านใหม่ไม่ตรงกัน',
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านปัจจุบัน',
  path: ['newPassword'],
});

// Password reset request schema (admin initiates)
export const ResetPasswordSchema = z.object({
  userId: z.string().uuid('รหัสผู้ใช้ไม่ถูกต้อง'),
});

// Force change password schema (admin forces user to change password)
export const ForceChangePasswordSchema = z.object({
  userId: z.string().uuid('รหัสผู้ใช้ไม่ถูกต้อง'),
  mustChangePassword: z.boolean(),
});

// Disable user schema
export const DisableUserSchema = z.object({
  userId: z.string().uuid('รหัสผู้ใช้ไม่ถูกต้อง'),
  reason: z.string().min(1, 'กรุณาระบุเหตุผล').max(500),
});

// =============================================================================
// RBAC v1 — Role Enum
// =============================================================================
//
// Synced with USER_ROLES in src/types.ts. Any role value that arrives
// from the client is validated against this set; legacy values like
// HR_ADMIN / REVIEWER / HR_OFFICER are rejected at the API boundary
// (the database has been migrated to the new set in migration 020).

// Master data sources available to MASTER_DATA fields (Phase 1: organizations only)
export const MASTER_DATA_SOURCES = ['organizations'] as const;
export type MasterDataSource = (typeof MASTER_DATA_SOURCES)[number];

export const MasterDataOptionsSchema = z.object({
  source: z.enum(MASTER_DATA_SOURCES),
});

// defaultOptions has two shapes:
//  - string[] : static options for DROPDOWN / RADIO
//  - { source: MasterDataSource } : MASTER_DATA field config
export const FieldOptionsSchema = z.union([
  z.array(z.string()),
  MasterDataOptionsSchema,
]);

export const FieldMasterCreateSchema = z.object({
  fieldType: FieldTypeEnum,
  labelTh: z.string().min(1),
  defaultOptions: FieldOptionsSchema.nullable().optional(),
  pdfMappingKey: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  // UI enhancement fields
  section: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
  // Validation
  validationType: z.string().nullable().optional(),
  validationMessage: z.string().nullable().optional(),
  // File config (JSON)
  fileConfig: z.record(z.string(), z.any()).nullable().optional(),
  // Other Option Support — field นี้รองรับตัวเลือก "อื่นๆ (โปรดระบุ)" หรือไม่
  // ใช้ได้เฉพาะ RADIO / DROPDOWN / CHECKBOX (validate ใน route)
  allowOther: z.boolean().optional(),
});

export const FieldMasterUpdateSchema = FieldMasterCreateSchema.partial();

export const TemplateCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const TemplateUpdateSchema = TemplateCreateSchema.partial();

// ── TEXTAREA ค่ากำหนดระบบ (Rich Field Metadata) ─────────────────────────────
// rows     = ความสูงเริ่มต้นของช่องกรอกบนหน้าจอ (ไม่เกี่ยวกับ PDF)
// min/max  = ความยาวคำตอบ (UTF-16 code units เทียบ String.length / HTML maxlength)
// maxLength ที่เกิน cap นี้ต้องถูกปฏิเสธทั้ง Builder และ Backend
export const TEXTAREA_ROWS_MIN = 1;
export const TEXTAREA_ROWS_MAX = 20;
export const TEXTAREA_MIN_LENGTH_MIN = 0;
export const TEXTAREA_LENGTH_CAP = 5000;

// Base object แยกไว้เพื่อให้ .extend() ได้ (superRefine ครอบแล้วจะเป็น ZodEffects
// ซึ่งไม่มี .extend — ทุก variant ต้อง .superRefine(textareaSettingsRefine) เอง)
const TemplateFieldBaseSchema = z.object({
  fieldId: z.string(),
  displayOrder: z.number().int().positive(),
  isRequired: z.boolean().default(true),
  overrideOptions: z.array(z.string()).nullable().optional(),
  overrideLabelTh: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
  // Validation Message override (null = ใช้ค่า master)
  validationMessage: z.string().nullable().optional(),
  validationRules: z.record(z.string(), z.any()).nullable().optional(),
  // Other Option Support (null = ใช้ค่าจาก Master)
  allowOther: z.boolean().nullable().optional(),
  // Rich Field Metadata
  rows: z
    .number()
    .int('ความสูงเริ่มต้นต้องเป็นจำนวนเต็ม')
    .min(TEXTAREA_ROWS_MIN, 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด')
    .max(TEXTAREA_ROWS_MAX, 'ความสูงเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 20 บรรทัด')
    .nullable()
    .optional(),
  minLength: z
    .number()
    .int('ความยาวขั้นต่ำต้องเป็นจำนวนเต็ม')
    .min(TEXTAREA_MIN_LENGTH_MIN, 'ความยาวขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
    .max(TEXTAREA_LENGTH_CAP, 'ความยาวขั้นต่ำต้องไม่เกิน 5,000 ตัวอักษร')
    .nullable()
    .optional(),
  maxLength: z
    .number()
    .int('ความยาวสูงสุดต้องเป็นจำนวนเต็ม')
    .min(1, 'ความยาวสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
    .max(TEXTAREA_LENGTH_CAP, 'ความยาวสูงสุดต้องไม่เกิน 5,000 ตัวอักษร')
    .nullable()
    .optional(),
});

/**
 * minLength ต้องไม่มากกว่า effective maxLength (ถ้าไม่มี maxLength ให้เทียบ cap)
 */
export function textareaSettingsRefine(
  field: { minLength?: number | null; maxLength?: number | null },
  ctx: z.RefinementCtx
): void {
  if (field.minLength != null) {
    const effectiveMax = field.maxLength ?? TEXTAREA_LENGTH_CAP;
    if (field.minLength > effectiveMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minLength'],
        message: 'ความยาวขั้นต่ำต้องไม่มากกว่าความยาวสูงสุด',
      });
    }
  }
}

export const TemplateFieldCreateSchema =
  TemplateFieldBaseSchema.superRefine(textareaSettingsRefine);

// Sprint 4 - Section schemas
export const TemplateSectionCreatePayloadSchema = z.object({
  tempId: z.string().min(1), // client-generated for mapping
  name: z.string().min(1, 'Section name required').max(200),
  displayOrder: z.number().int().positive(),
});

export const TemplateSectionCreateSchema = z.object({
  templateVersionId: z.string(),
  name: z.string().min(1, 'Section name required').max(200),
  displayOrder: z.number().int().positive(),
});

export const TemplateSectionUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  displayOrder: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const TemplateSectionReorderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    displayOrder: z.number().int().positive(),
  })).min(1),
});

export const TemplateFieldReorderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    displayOrder: z.number().int().positive(),
    sectionId: z.string().nullable().optional(),
  })).min(1),
});

export const TemplateFieldSectionAssignSchema = z.object({
  sectionId: z.string().nullable(),
});

export const TemplateVersionCreateSchema = z.object({
  templateId: z.string(),
  status: TemplateVersionStatusEnum.default('DRAFT'),
  // Sprint 4 - Mode B
  cloneFromVersionId: z.string().optional(),
  // ── Configurable PDF Filename (Migration 028) ──
  // รูปแบบชื่อไฟล์ PDF (null/ว่าง = ใช้ค่าเริ่มต้น) — validate เนื้อหาด้วย
  // validatePdfFilenamePattern ใน route handler เพื่อคืนข้อความไทยกลับ UI
  pdfFilenamePattern: z.string().max(500).nullable().optional(),
  // Sprint 4 - Mode A
  sections: z.array(TemplateSectionCreatePayloadSchema).optional(),
  // Fields required ทุก mode (Mode A, C) — Mode B (clone) จะ ignore fields
  // ดังนั้นทำให้ optional เพื่อรองรับ clone ที่ไม่ต้องส่ง fields
  fields: z.array(TemplateFieldBaseSchema.extend({
    sectionId: z.string().nullable().optional(), // Mode A: client tempId
  }).superRefine(textareaSettingsRefine)).min(1).optional(), // เพิ่ม .optional() เพื่อรองรับ Mode B
}).refine(data => {
  // Mode B (clone): ต้องมี cloneFromVersionId
  // Mode A/C: ต้องมี fields อย่างน้อย 1
  if (data.cloneFromVersionId) {
    return true; // Mode B: ผ่าน
  }
  // Mode A/C: ต้องมี fields
  return data.fields && data.fields.length >= 1;
}, {
  message: "Either cloneFromVersionId (Mode B) or fields (Mode A/C) is required",
  path: ["fields"],
});

// =============================================================================
// Sprint 4 - Template Version Update Schema (Phase 1)
// PUT /admin/template-versions/:versionId - UPDATE Draft เดิม (ไม่สร้าง Version ใหม่)
// =============================================================================
export const TemplateVersionUpdateSchema = z.object({
  sections: z.array(TemplateSectionCreatePayloadSchema).min(1, 'At least 1 section required'),
  fields: z.array(TemplateFieldBaseSchema.extend({
    sectionId: z.string().nullable().optional(), // client tempId
  }).superRefine(textareaSettingsRefine)).min(1, 'At least 1 field required'),
  // ── Configurable PDF Filename (Migration 028) ──
  // optional: ไม่ส่ง = ไม่แตะค่าเดิม (Builder เก่า/backward compatible)
  // null/ว่าง = ใช้ค่าเริ่มต้น — validate เนื้อหาใน route handler (ข้อความไทย)
  pdfFilenamePattern: z.string().max(500).nullable().optional(),
});

export const RecruitmentRoundCreateSchema = z.object({
  templateVersionId: z.string(),
  title: z.string().min(1),
  positionLevel: z.string().min(1),
  openDate: z.number().int().positive(), // Unix timestamp (seconds)
  closeDate: z.number().int().positive(), // Unix timestamp (seconds)
  status: RoundStatusEnum.default('DRAFT'),
  // Form Header / Announcement
  announcementTitle: z.string().nullable().optional(),
  announcementDescription: z.string().nullable().optional(),
  contactInformation: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  // Migration 019 - Application Number Pattern (MVP)
  // null = ใช้ format เดิม (APP-YYYY-NNNN)
  // string = pattern ตามที่กำหนด (validated ใน service layer)
  applicationPattern: z.string().min(1).max(100).nullable().optional(),
  // รหัสรอบ (Admin กำหนดเอง เช่น CHM01, TEMP01) — required
  // validated ใน service layer (validateRoundCode)
  roundCode: z.string().min(3).max(20),
}).refine(data => data.closeDate > data.openDate, {
  message: "closeDate must be after openDate",
  path: ["closeDate"],
});

export const RecruitmentRoundUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  positionLevel: z.string().min(1).optional(),
  openDate: z.number().int().positive().optional(),
  closeDate: z.number().int().positive().optional(),
  status: RoundStatusEnum.optional(),
  templateVersionId: z.string().optional(), // For DRAFT round version change
  // Form Header / Announcement
  announcementTitle: z.string().nullable().optional(),
  announcementDescription: z.string().nullable().optional(),
  contactInformation: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  // Migration 019 - Application Number Pattern
  // Lock behavior: ถ้า round มี application แล้ว แก้ไม่ได้ (ตรวจใน route handler)
  applicationPattern: z.string().min(1).max(100).nullable().optional(),
  // round_code เป็น required field — ต้องส่งมาเสมอเมื่อ patch
  roundCode: z.string().min(3).max(20).optional(),
}).refine(data => {
  if (data.openDate !== undefined && data.closeDate !== undefined) {
    return data.closeDate > data.openDate;
  }
  return true;
}, { message: "closeDate must be after openDate", path: ["closeDate"] });

// Status ที่อนุญาตให้อัปเดตผ่าน API — derive จาก ApplicationStatusEnum
// (single source of truth) โดยห้ามย้อนกลับไป DRAFT เสมอ
// ARCHIVED = legacy-only (soft removal): แถวเดิมยังแสดง/ส่งออก/audit/PDF ได้
// ครบ แต่ห้ามตั้งเป็นสถานะใหม่ผ่าน API ทุกช่องทาง — reject เป็น validation error
// (ยังเปลี่ยนออกจาก ARCHIVED ไปสถานะอื่นได้ — escape hatch)
export const UpdatableApplicationStatusEnum = ApplicationStatusEnum.exclude(['DRAFT', 'ARCHIVED']);

export const ApplicationStatusUpdateSchema = z.object({
  status: UpdatableApplicationStatusEnum,
  reason: z.string().optional(),
});

/**
 * POST /admin/applications/bulk-status — อัปเดตสถานะหลายใบพร้อมกัน
 * ids ต้องเป็น application id (UUID string) อย่างน้อย 1 รายการ
 *
 * ⚠️ Phase 2: schema นี้คงไว้เป็น legacy contract (payload { ids })
 *    — handler ใช้ normalizeSelectorInput() เพื่อรับ selector ได้ด้วย
 *    โดยไม่ทำให้ payload เดิมเปลี่ยนความหมาย
 */
export const BulkApplicationStatusUpdateSchema = z.object({
  ids: z
    .array(z.string().min(1, 'รายการ ID ไม่ถูกต้อง'), { message: 'กรุณาเลือกอย่างน้อย 1 รายการ' })
    .min(1, 'กรุณาเลือกอย่างน้อย 1 รายการ'),
  status: UpdatableApplicationStatusEnum,
  reason: z.string().optional(),
});

// =============================================================================
// FEATURE: Applications Selector (Phase 2)
// =============================================================================
//
// Selector = "สิ่งที่ผู้ใช้เลือก" ที่ส่งขึ้น server แทนการส่ง id ทั้งชุด
// ใช้ร่วมกันระหว่าง bulk-status และ export-selected
//
//   kind 'ids'    → { kind: 'ids', ids: string[] }
//   kind 'filter' → { kind: 'filter', roundId, status?, search? }
//
// เหตุผลที่ต้องมี: "เลือกทั้งหมดตามตัวกรอง" ที่มี 1,000+ แถว ถ้าส่ง id
// ทั้งชุดจะเกิน body/URL limit และไม่ตรงกับสิ่งที่ผู้ใช้เห็นจริง
//
// หมายเหตุ: legacy schema (BulkApplicationStatusUpdateSchema /
// ExcelExportSelectedSchema) ยังอยู่ครบและยังใช้ได้เหมือนเดิม

/** selector kind 'ids' — รายการที่ระบุชัดเจน */
export const ApplicationsSelectorIdsSchema = z.object({
  kind: z.literal('ids'),
  ids: z
    .array(z.string().min(1, 'รายการ ID ไม่ถูกต้อง'), { message: 'กรุณาเลือกอย่างน้อย 1 รายการ' })
    .min(1, 'กรุณาเลือกอย่างน้อย 1 รายการ'),
});

/**
 * selector kind 'filter' — ทั้งหมดตามตัวกรอง
 * roundId บังคับเสมอ (กันการเลือกข้ามรอบโดยไม่ตั้งใจ)
 * status รับได้ทั้งค่า enum เดี่ยว และ comma-separated (เหมือน export GET)
 */
export const ApplicationsSelectorFilterSchema = z.object({
  kind: z.literal('filter'),
  roundId: z.string().min(1, 'กรุณาระบุรอบรับสมัคร (roundId)'),
  status: z.string().nullable().optional(),
  search: z.string().nullable().optional(),
});

export const ApplicationsSelectorSchema = z.discriminatedUnion('kind', [
  ApplicationsSelectorIdsSchema,
  ApplicationsSelectorFilterSchema,
]);

/**
 * Body ของ bulk-status (Phase 2) — รับได้ทั้ง selector และ ids เดิม
 * ใช้ refine เพื่อบังคับ "ต้องมีอย่างใดอย่างหนึ่ง และห้ามมีทั้งคู่"
 * (การแปลงเป็น selector จริงทำที่ normalizeSelectorInput ใน handler
 *  เพื่อให้ message ตรงกับที่ handler สร้าง)
 */
export const BulkApplicationStatusSelectorSchema = z
  .object({
    ids: z
      .array(z.string().min(1, 'รายการ ID ไม่ถูกต้อง'), { message: 'กรุณาเลือกอย่างน้อย 1 รายการ' })
      .min(1, 'กรุณาเลือกอย่างน้อย 1 รายการ')
      .optional(),
    selector: ApplicationsSelectorSchema.optional(),
    status: UpdatableApplicationStatusEnum,
    reason: z.string().optional(),
  })
  .refine((d) => (d.selector !== undefined) !== (d.ids !== undefined), {
    message: 'กรุณาระบุ selector หรือ ids อย่างใดอย่างหนึ่ง',
    path: ['selector'],
  });

// =============================================================================
// FEATURE: Archive / Restore / Permanent Delete
// =============================================================================

// View filter: All | Active | Archived
export const RoundViewFilterSchema = z.enum(['all', 'active', 'archived']).default('active');

export const ApplicationAttachmentSchema = z.object({
  fieldId: z.string(),
  fileUrl: z.string().min(1), // Accept relative or absolute URL
  /**
   * Optional original filename (Migration 027) — ชื่อจริงที่ผู้สมัครเลือก
   * เพื่อเก็บลง application_attachments.original_filename หลัง sanitize ซ้ำ
   * ที่ backend Payload เก่า (ไม่มี field นี้) ยังผ่านได้ตามเดิม
   */
  filename: z.string().max(255).optional(),
});

// Core field IDs - these map to legacy root columns (backward compatibility)
// NOTE: field-national-id is NO LONGER hardcoded - only email and fullname are required
// All other fields come from template schema
export const CORE_FIELD_IDS = ['field-fullname', 'field-email'] as const;

/**
 * Optional idempotency token. The client should generate a UUID per
 * submission attempt and send it on the wire. The backend uses it to
 * reject duplicate submissions within the configured TTL window.
 *
 * We accept up to 128 chars which is generous for any UUID or ULID
 * variant. Empty / missing is allowed: if the client does not send a
 * token, the idempotency middleware falls back to no-op (the
 * per-round+email duplicate check still guards the database).
 */
export const SubmissionTokenSchema = z
  .string()
  .min(1)
  .max(128)
  .optional();

/**
 * Honeypot field schema. The frontend is NOT supposed to render this;
 * the backend uses it to detect naive bots. Always optional; when
 * present and non-empty, the request is dropped with 400.
 *
 * Validators accept this as part of the body so it propagates from the
 * zValidator call to the handler without re-parsing. The actual decision
 * is made by the honeypot middleware, not by Zod.
 */
export const HoneypotFieldSchema = z.string().optional();

/**
 * Cloudflare Turnstile token (PR #3). The frontend widget — when the
 * `TURNSTILE_ENABLED` flag is on — includes this field on submit and
 * the backend's `turnstileMiddleware` verifies it against Cloudflare's
 * `siteverify` endpoint before allowing the request through.
 *
 * The schema accepts an optional string here for two reasons:
 *   1. When Turnstile is disabled the field will not be present.
 *   2. The middleware, not Zod, is the authoritative gate. If we
 *      required it here we'd break clients that haven't rolled out
 *      the widget yet (e.g. programmatic callers) — and the
 *      middleware would still need to do the work anyway.
 *
 * Length bound mirrors Cloudflare's documented maximum (~2048 chars)
 * with a defensive cap of 4096 to absorb any future format change.
 */
export const TurnstileTokenSchema = z.string().min(1).max(4096).optional();

export const ApplicationSubmitSchema = z.object({
  roundId: z.string(),
  // Support BOTH modes for backward compatibility during transition:
  // - New Mode: formData only (email/fullname/nationalId inside formData)
  // - Legacy Mode: root fields (email/fullname/nationalId as separate fields)
  formData: z.record(z.string(), z.any()),
  attachments: z.array(ApplicationAttachmentSchema).optional(),
  // Legacy fields (optional - for backward compatibility)
  email: z.string().email().optional(),
  fullname: z.string().optional(),
  nationalId: z.string().optional(),
  status: ApplicationStatusEnum.default('SUBMITTED'),
  // PR #1: hardening fields
  // - submissionToken: idempotency key (any opaque client-generated string)
  // - website_url:    honeypot (must be absent or empty for real users)
  submissionToken: SubmissionTokenSchema,
  website_url: HoneypotFieldSchema,
  // PR #3: Cloudflare Turnstile token. Required when TURNSTILE_ENABLED=true;
  // the turnstileMiddleware enforces this server-side, not Zod.
  turnstileToken: TurnstileTokenSchema,
});

export const FileUploadRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.literal('application/pdf'),
  fileSize: z.number().positive().max(10 * 1024 * 1024), // Max 10MB
});

export const ApplicationLookupSchema = z.object({
  roundId: z.string().min(1, 'กรุณาเลือกรอบรับสมัคร'),
  email: z.string().email('กรุณากรอกอีเมลให้ถูกต้อง'),
  phone: z
    .string()
    .min(1, 'กรุณากรอกเบอร์โทรศัพท์')
    .regex(/^[0-9+\s\-().]+$/, 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง')
    .refine(
      (val) => {
        const digits = val.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 12;
      },
      { message: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมีตัวเลข 8-12 หลัก)' }
    ),
});