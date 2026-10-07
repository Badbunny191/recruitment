import { relations } from 'drizzle-orm';
import { 
  adminUsers, fieldMaster, templates, templateVersions, templateFields, 
  recruitmentRounds, applications, applicationAttachments, auditLogs 
} from './schema';

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  auditLogs: many(auditLogs)
}));

export const fieldMasterRelations = relations(fieldMaster, ({ many }) => ({
  templateFields: many(templateFields)
}));

export const templatesRelations = relations(templates, ({ many }) => ({
  versions: many(templateVersions)
}));

export const templateVersionsRelations = relations(templateVersions, ({ one, many }) => ({
  template: one(templates, { fields: [templateVersions.templateId], references: [templates.id] }),
  fields: many(templateFields),
  rounds: many(recruitmentRounds)
}));

export const templateFieldsRelations = relations(templateFields, ({ one }) => ({
  templateVersion: one(templateVersions, { fields: [templateFields.templateVersionId], references: [templateVersions.id] }),
  field: one(fieldMaster, { fields: [templateFields.fieldId], references: [fieldMaster.id] })
}));

export const recruitmentRoundsRelations = relations(recruitmentRounds, ({ one, many }) => ({
  templateVersion: one(templateVersions, { fields: [recruitmentRounds.templateVersionId], references: [templateVersions.id] }),
  applications: many(applications)
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  round: one(recruitmentRounds, { fields: [applications.roundId], references: [recruitmentRounds.id] }),
  attachments: many(applicationAttachments)
}));

export const applicationAttachmentsRelations = relations(applicationAttachments, ({ one }) => ({
  application: one(applications, { fields: [applicationAttachments.applicationId], references: [applications.id] })
}));