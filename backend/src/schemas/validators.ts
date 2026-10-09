import { z } from 'zod';

export const FieldTypeEnum = z.enum(['TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE']);
export const TemplateVersionStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const RoundStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const ApplicationStatusEnum = z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED']);

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const FieldMasterCreateSchema = z.object({
  fieldType: FieldTypeEnum,
  labelTh: z.string().min(1),
  defaultOptions: z.array(z.string()).nullable().optional(),
  pdfMappingKey: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const FieldMasterUpdateSchema = FieldMasterCreateSchema.partial();

export const TemplateCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const TemplateUpdateSchema = TemplateCreateSchema.partial();

export const TemplateFieldCreateSchema = z.object({
  fieldId: z.string(),
  displayOrder: z.number().int().positive(),
  isRequired: z.boolean().default(true),
  overrideOptions: z.array(z.string()).nullable().optional(),
  overrideLabelTh: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
  validationRules: z.record(z.string(), z.any()).nullable().optional(),
  // Rich Field Metadata
  rows: z.number().int().positive().nullable().optional(),
  minLength: z.number().int().min(0).nullable().optional(),
  maxLength: z.number().int().min(1).nullable().optional(),
});

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
  // Sprint 4 - Mode A
  sections: z.array(TemplateSectionCreatePayloadSchema).optional(),
  // Fields required ทุก mode (Mode A, B, C) — แต่ Mode B จะ ignore fields
  fields: z.array(TemplateFieldCreateSchema.extend({
    sectionId: z.string().nullable().optional(), // Mode A: client tempId
  })).min(1),
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
}).refine(data => {
  if (data.openDate !== undefined && data.closeDate !== undefined) {
    return data.closeDate > data.openDate;
  }
  return true;
}, { message: "closeDate must be after openDate", path: ["closeDate"] });

export const ApplicationStatusUpdateSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED']),
  reason: z.string().optional(),
});

export const ApplicationAttachmentSchema = z.object({
  fieldId: z.string(),
  fileUrl: z.string().min(1), // Accept relative or absolute URL
});

// Core field IDs - these are required for mapping formData to core columns
export const CORE_FIELD_IDS = ['field-fullname', 'field-email', 'field-national-id'] as const;

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
});

export const FileUploadRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.literal('application/pdf'),
  fileSize: z.number().positive().max(10 * 1024 * 1024), // Max 10MB
});