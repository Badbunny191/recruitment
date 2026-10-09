import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('HR_OFFICER'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

export const fieldMaster = sqliteTable('field_master', {
  id: text('id').primaryKey(),
  fieldType: text('field_type').notNull(),
  labelTh: text('label_th').notNull(),
  defaultOptions: text('default_options', { mode: 'json' }),
  pdfMappingKey: text('pdf_mapping_key'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  // UI enhancement
  helpText: text('help_text'),
  placeholder: text('placeholder'),
  section: text('section'),
  fileConfig: text('file_config', { mode: 'json' }),
  // Validation
  validationType: text('validation_type'),
  validationMessage: text('validation_message'),
}, (table) => ({
  checkFieldType: check('chk_field_type', sql`${table.fieldType} IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE')`)
}));

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => templates.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(),
  status: text('status').default('DRAFT'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
}, (table) => ({
  unqVersion: uniqueIndex('unq_template_version').on(table.templateId, table.versionNumber),
  checkStatus: check('chk_version_status', sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`)
}));

export const templateSections = sqliteTable('template_sections', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => ({
  versionIdx: index('idx_tpl_sections_version').on(table.templateVersionId),
  unqVersionOrder: uniqueIndex('unq_tpl_sections_version_order').on(table.templateVersionId, table.displayOrder),
}));

export const templateFields = sqliteTable('template_fields', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull().references(() => fieldMaster.id, { onDelete: 'restrict' }),
  sectionId: text('section_id').references(() => templateSections.id, { onDelete: 'set null' }),
  displayOrder: integer('display_order').notNull(),
  isRequired: integer('is_required', { mode: 'boolean' }).default(true),
  overrideOptions: text('override_options', { mode: 'json' }),
  overrideLabelTh: text('override_label_th'),
  helpText: text('help_text'),
  placeholder: text('placeholder'),
  validationRules: text('validation_rules', { mode: 'json' }),
  // Rich Field Metadata - rows (TEXTAREA), min_length, max_length
  rows: integer('rows'),
  minLength: integer('min_length'),
  maxLength: integer('max_length'),
}, (table) => ({
  tplVerIdx: index('idx_tpl_fields_version').on(table.templateVersionId),
  sectionIdx: index('idx_tpl_fields_section').on(table.sectionId),
}));

export const recruitmentRounds = sqliteTable('recruitment_rounds', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  positionLevel: text('position_level').notNull(),
  openDate: integer('open_date', { mode: 'timestamp' }).notNull(),
  closeDate: integer('close_date', { mode: 'timestamp' }).notNull(),
  status: text('status').default('ACTIVE'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  // Form Header / Announcement
  announcementTitle: text('announcement_title'),
  announcementDescription: text('announcement_description'),
  contactInformation: text('contact_information'),
  remark: text('remark'),
}, (table) => ({
  checkStatus: check('chk_round_status', sql`${table.status} IN ('DRAFT', 'ACTIVE', 'CLOSED')`),
  checkDates: check('chk_round_dates', sql`${table.closeDate} >= ${table.openDate}`)
}));

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  applicationNo: text('application_no').unique(),
  roundId: text('round_id').notNull().references(() => recruitmentRounds.id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  fullname: text('fullname').notNull(),
  nationalId: text('national_id').notNull(),
  status: text('status').default('SUBMITTED'),
  statusReason: text('status_reason'),
  verifiedBy: text('verified_by'),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  formData: text('form_data', { mode: 'json' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' })
}, (table) => ({
  roundIdx: index('idx_apps_round').on(table.roundId),
  statusIdx: index('idx_apps_status').on(table.status),
  roundStatusIdx: index('idx_apps_round_status').on(table.roundId, table.status),
  checkStatus: check('chk_app_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED')`)
}));

export const applicationAttachments = sqliteTable('application_attachments', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull(),
  fileUrl: text('file_url').notNull(),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
}, (table) => ({
  appIdx: index('idx_attachments_app').on(table.applicationId)
}));

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull().references(() => adminUsers.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: text('payload', { mode: 'json' }),
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
}, (table) => ({
  entityIdx: index('idx_audit_entity').on(table.entityType, table.entityId)
}));

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

export const jobFamilies = sqliteTable('job_families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

export const positionLevels = sqliteTable('position_levels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

export const positions = sqliteTable('positions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  jobFamilyId: text('job_family_id').notNull(),
  positionLevelId: text('position_level_id').notNull(),
  displayOrder: integer('display_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});