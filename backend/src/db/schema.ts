import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('ADMIN'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  // User Management (Migration 021) — additive
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  passwordChangedAt: integer('password_changed_at', { mode: 'timestamp' }),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp' }),
  passwordMigrated: integer('password_migrated', { mode: 'boolean' }).notNull().default(false),
  // Migration 023: Track last successful login
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
}, (table) => ({
  roleActiveIdx: index('idx_admin_users_role_active').on(table.role, table.isActive),
}));

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
  // ── Other Option Support (Migration 026) ──────────────────────────────
  // true = field นี้ (RADIO / DROPDOWN / CHECKBOX) รองรับตัวเลือก
  // "อื่นๆ (โปรดระบุ)" — เมื่อผู้สมัครเลือก ต้องกรอกข้อความเพิ่มเติม
  // null / false = ไม่รองรับ (ค่าเริ่มต้นของฟิลด์เดิมทั้งหมด → backward compatible)
  allowOther: integer('allow_other', { mode: 'boolean' }).default(false),
}, (table) => ({
  checkFieldType: check('chk_field_type', sql`${table.fieldType} IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA')`)
}));

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  // Soft delete (Archive) - Sprint 5
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => ({
  deletedAtIdx: index('idx_templates_deleted_at').on(table.deletedAt),
}));

export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => templates.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(),
  status: text('status').default('DRAFT'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  // ── Document Composer V1 — Descriptor Storage (Migration 022) ──────
  // descriptor_json = serialized DocumentDescriptor (version + blocks) as raw TEXT
  //   - ใช้ raw text (no `mode: 'json'`) เพื่อให้ service layer control JSON.parse
  //     เอง — version-safe (รองรับ corruption / schema mismatch)
  //   - null = legacy (ยังไม่ define descriptor — fallback PDF renderer เดิม)
  // descriptor_schema_version = เวอร์ชัน schema ที่ save (ปัจจุบัน = 1)
  //   null = legacy / never saved
  //   version-safe: ตอน load เทียบกับ descriptor package version → reject mismatch
  descriptorJson: text('descriptor_json'),
  descriptorSchemaVersion: integer('descriptor_schema_version'),
  descriptorUpdatedAt: integer('descriptor_updated_at', { mode: 'timestamp' }),
  descriptorUpdatedBy: text('descriptor_updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  // ── Configurable PDF Filename (Migration 028) ─────────────────────────
  // รูปแบบชื่อไฟล์ PDF ตอนดาวน์โหลด เช่น ใบสมัคร_{applicationNo}_{fullname}
  //   - Token ที่รองรับ: {applicationNo} {fullname} {roundCode} {year}
  //   - null = legacy → ใช้ค่าเริ่มต้น (DEFAULT_PDF_FILENAME_PATTERN)
  //   - แก้ได้เฉพาะ DRAFT; ดาวน์โหลดไม่กระทบ PDF bytes / cache
  pdfFilenamePattern: text('pdf_filename_pattern'),
}, (table) => ({
  unqVersion: uniqueIndex('unq_template_version').on(table.templateId, table.versionNumber),
  checkStatus: check('chk_version_status', sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`),
  descriptorVersionIdx: index('idx_tpl_versions_descriptor_version').on(table.descriptorSchemaVersion),
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
  // Override Validation Message (null = use Master validation_message)
  validationMessage: text('validation_message'),
  // ── Other Option Support (Migration 026) ──────────────────────────────
  // true = field นี้ (RADIO / DROPDOWN / CHECKBOX) รองรับตัวเลือก
  // "อื่นๆ (โปรดระบุ)" — override ราย template (null = ใช้ค่าจาก Master)
  allowOther: integer('allow_other', { mode: 'boolean' }),
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
  // Migration 019 - Application Number Pattern (MVP)
  // NULL = ใช้ format เดิม (APP-YYYY-NNNN), not NULL = ใช้ format ที่กำหนด
  applicationPattern: text('application_pattern'),
  // รหัสรอบ (Admin กำหนดเอง เช่น CHM01, TEMP01) — required ใน MVP
  // ใช้กับ token {ROUND_CODE}
  roundCode: text('round_code'),
}, (table) => ({
  checkStatus: check('chk_round_status', sql`${table.status} IN ('DRAFT', 'ACTIVE', 'CLOSED')`),
  checkDates: check('chk_round_dates', sql`${table.closeDate} >= ${table.openDate}`),
  deletedAtIdx: index('idx_rounds_deleted_at').on(table.deletedAt),
  roundCodeIdx: index('idx_rounds_round_code').on(table.roundCode),
}));

/**
 * round_sequences: 1 row per round
 * เก็บ running number ของ application number ในแต่ละ round
 * สร้างแบบ lazy เมื่อ application แรกของ round ถูก submit
 * - Clone round: ได้ row ใหม่ที่ current_value = 0 (เริ่มนับใหม่)
 * - Archive round: row คงอยู่ (read-only) ไม่กระทบเลขที่ออกไปแล้ว
 */
export const roundSequences = sqliteTable('round_sequences', {
  roundId: text('round_id').primaryKey().references(() => recruitmentRounds.id, { onDelete: 'cascade' }),
  currentValue: integer('current_value').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => ({
  updatedAtIdx: index('idx_round_sequences_updated_at').on(table.updatedAt),
}));

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  applicationNo: text('application_no').unique(),
  roundId: text('round_id').notNull().references(() => recruitmentRounds.id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  fullname: text('fullname').notNull(),
  nationalId: text('national_id'), // Nullable - template may not include this field
  status: text('status').default('SUBMITTED'),
  statusReason: text('status_reason'),
  verifiedBy: text('verified_by'),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  formData: text('form_data', { mode: 'json' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  // Migration 019 - Application Number Pattern (MVP) - Snapshot Fields
  // nullable เพื่อรองรับ application เก่าที่ใช้ format APP-YYYY-NNNN
  // ใช้สำหรับ query/filter โดยไม่ต้อง join rounds
  // หมายเหตุ: ไม่ snapshot level_code เพราะไม่ได้ใช้ใน MVP (ไม่ render, ไม่ filter)
  // ถ้าต้องการ position_level สามารถ join recruitment_rounds ได้
  year: integer('year'),
  roundCode: text('round_code'),
  seqInRound: integer('seq_in_round'),
}, (table) => ({
  roundIdx: index('idx_apps_round').on(table.roundId),
  statusIdx: index('idx_apps_status').on(table.status),
  roundStatusIdx: index('idx_apps_round_status').on(table.roundId, table.status),
  yearIdx: index('idx_apps_year').on(table.year),
  roundCodeIdx: index('idx_apps_round_code').on(table.roundCode),
  yearRoundCodeIdx: index('idx_apps_year_round_code').on(table.year, table.roundCode),
  checkStatus: check('chk_app_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED')`)
}));

export const applicationAttachments = sqliteTable('application_attachments', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull(),
  fileUrl: text('file_url').notNull(),
  // Migration 027 — ชื่อไฟล์ต้นฉบับสำหรับ display แยกจาก object key
  // Nullable: ข้อมูลเก่าไม่มีค่า → ผู้อ่าน fallback ถอดจาก fileUrl
  originalFilename: text('original_filename'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
}, (table) => ({
  appIdx: index('idx_attachments_app').on(table.applicationId)
}));

// =============================================================================
// Attachment Lifecycle Ledger (Migration 029) — TEMP → ACTIVE → DELETED
// =============================================================================
// ปิด 3 ปัญหา: orphan files (ไม่มีใคร track ไฟล์ที่อัปโหลดแล้วไม่ submit),
// ปุ่มลบหน้า /apply ลบเฉพาะ React state, และ GET /public/uploads/files/:key
// เปิดได้แบบไม่มีเงื่อนไข ตารางนี้เป็น source of truth ของสถานะไฟล์:
//   - upload   → insert TEMP
//   - submit   → TEMP → ACTIVE (+ application_id)
//   - delete   → TEMP เท่านั้น: R2.delete + mark DELETED (ต้องมี delete token)
//   - cron รายวัน → TEMP อายุเกิน 7 วัน: ลบ R2 + mark DELETED
// หมายเหตุ: ไฟล์เก่าก่อน deploy (ไม่มีแถวในตารางนี้) ยังเปิดดูได้ผ่าน signed
// URL เท่านั้น — access control อยู่ที่ signature ไม่ใช่การมี-ไม่มีแถว
export const attachmentUploads = sqliteTable('attachment_uploads', {
  id: text('id').primaryKey(),
  r2Key: text('r2_key').notNull().unique(),
  status: text('status').notNull().default('TEMP'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  // TEMP ยังไม่ผูกใบสมัคร — ผูกตอน submit สำเร็จ (SET NULL เมื่อลบใบสมัคร
  // เพื่อให้ object ยังถูก GC ตามสถานะได้ ไม่ผูก lifecycle กับ applications)
  applicationId: text('application_id').references(() => applications.id, { onDelete: 'set null' }),
  originalFilename: text('original_filename'),
  // SHA-256 hex ของ one-time token ที่ออกพร้อม response ตอน upload —
  // ผู้สมัครไม่มี login จึงใช้ token เป็น capability พิสูจน์ว่าเป็นเจ้าของไฟล์
  // NULL = legacy row (ข้อมูลเก่า) → ลบผ่าน anonymous endpoint ไม่ได้
  deleteTokenHash: text('delete_token_hash'),
  activatedAt: integer('activated_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => ({
  statusUploadedIdx: index('idx_attachment_uploads_status_uploaded').on(table.status, table.uploadedAt),
  applicationIdx: index('idx_attachment_uploads_application').on(table.applicationId),
  checkStatus: check('chk_attachment_uploads_status', sql`${table.status} IN ('TEMP', 'ACTIVE', 'DELETED')`)
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
  entityIdx: index('idx_audit_entity').on(table.entityType, table.entityId),
  // Performance indexes for server-side pagination (Migration 017)
  createdAtIdx: index('idx_audit_created_at_desc').on(sql`${table.createdAt} DESC`),
  actionIdx: index('idx_audit_action').on(table.action),
  adminIdx: index('idx_audit_admin_id').on(table.adminId),
  entityIdIdx: index('idx_audit_entity_id').on(table.entityId),
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