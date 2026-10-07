import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const fieldMaster = sqliteTable('field_master', {
  id: text('id').primaryKey(),
  fieldType: text('field_type').notNull(),
  labelTh: text('label_th').notNull(),
  defaultOptions: text('default_options', { mode: 'json' }),
  pdfMappingKey: text('pdf_mapping_key'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true)
});

export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  status: text('status').default('DRAFT')
});

export const templateFields = sqliteTable('template_fields', {
  id: text('id').primaryKey(),
  templateVersionId: text('template_version_id').notNull(),
  fieldId: text('field_id').notNull(),
  displayOrder: integer('display_order').notNull(),
  isRequired: integer('is_required', { mode: 'boolean' }).default(true),
  overrideOptions: text('override_options', { mode: 'json' }),
  overrideLabelTh: text('override_label_th')
});

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  applicationNo: text('application_no').unique(),
  roundId: text('round_id').notNull(),
  email: text('email').notNull(),
  fullname: text('fullname').notNull(),
  nationalId: text('national_id').notNull(),
  status: text('status').default('SUBMITTED'),
  formData: text('form_data', { mode: 'json' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' })
}, (table) => ({
  roundIdx: index('idx_apps_round').on(table.roundId)
}));