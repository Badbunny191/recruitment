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
});

export const TemplateVersionCreateSchema = z.object({
  templateId: z.string(),
  status: TemplateVersionStatusEnum.default('DRAFT'),
  fields: z.array(TemplateFieldCreateSchema).min(1),
});

export const RecruitmentRoundCreateSchema = z.object({
  templateVersionId: z.string(),
  title: z.string().min(1),
  positionLevel: z.string().min(1),
  openDate: z.number().int().positive(), // Unix timestamp (seconds)
  closeDate: z.number().int().positive(), // Unix timestamp (seconds)
  status: RoundStatusEnum.default('DRAFT'),
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

export const ApplicationSubmitSchema = z.object({
  roundId: z.string(),
  email: z.string().email(),
  fullname: z.string().min(1),
  nationalId: z.string().length(13),
  status: ApplicationStatusEnum.default('SUBMITTED'), 
  formData: z.record(z.string(), z.any()),
  attachments: z.array(ApplicationAttachmentSchema).optional(),
});

export const FileUploadRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.literal('application/pdf'),
  fileSize: z.number().positive().max(10 * 1024 * 1024), // Max 10MB
});