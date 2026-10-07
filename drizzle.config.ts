import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('HR_OFFICER'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export const fieldMaster = sqliteTable('field_master', {
  id: text('id').primaryKey(),
  fieldType: text('field_type').notNull(),
  labelTh: text('label_th').notNull(),
  defaultOptions: text('default_options', { mode: 'json' }),
  pdfMappingKey: text('pdf_mapping_key'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true)
});

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => templates.id),
  versionNumber: integer('version_number').notNull(),
  status: text('status').default('DRAFT'),
  createdAt: integer('created_at', { mode: 'timestamp' })
}, (t) => ({
  unqVersion: uniqueIndex('unq_template_version').on(t.templateId, t.versionNumber)
}));

export const templateFields = sqliteTable('template_fields', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id),
  fieldId: text('field_id').notNull().references(() => fieldMaster.id),
  displayOrder: integer('display_order').notNull(),
  isRequired: integer('is_required', { mode: 'boolean' }).default(true),
  overrideOptions: text('override_options', { mode: 'json' }),
  overrideLabelTh: text('override_label_th')
});

export const recruitmentRounds = sqliteTable('recruitment_rounds', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id),
  title: text('title').notNull(),
  positionLevel: text('position_level').notNull(),
  openDate: integer('open_date', { mode: 'timestamp' }).notNull(),
  closeDate: integer('close_date', { mode: 'timestamp' }).notNull(),
  status: text('status').default('ACTIVE'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  applicationNo: text('application_no').unique(),
  roundId: text('round_id').notNull().references(() => recruitmentRounds.id),
  email: text('email').notNull(),
  fullname: text('fullname').notNull(),
  nationalId: text('national_id').notNull(),
  status: text('status').default('SUBMITTED'),
  formData: text('form_data', { mode: 'json' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' })
}, (t) => ({
  roundIdx: index('idx_apps_round').on(t.roundId),
  statusIdx: index('idx_apps_status').on(t.status)
}));

export const applicationAttachments = sqliteTable('application_attachments', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull().references(() => applications.id),
  fieldId: text('field_id').notNull(),
  fileUrl: text('file_url').notNull(),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' })
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull().references(() => adminUsers.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: text('payload', { mode: 'json' }),
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});