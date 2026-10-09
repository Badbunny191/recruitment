PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_normal_alex_wilder.sql','2026-10-07 15:54:50');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0001_applications_management.sql','2026-10-08 12:20:10');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0002_audit_trail.sql','2026-10-08 12:29:40');
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'HR_OFFICER' NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
INSERT INTO "admin_users" ("id","email","password_hash","role","created_at") VALUES('seed-admin-001','admin@recruitment.go.th','admin123','HR_ADMIN',1791388515);
CREATE TABLE `application_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`field_id` text NOT NULL,
	`file_url` text NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()), file_type TEXT, file_size INTEGER,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict
);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('bdc85d2a-c0a7-4b4a-b992-b41dd92ba96d','seed-admin-001','CREATE','RECRUITMENT_ROUND','round-001',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791397591);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('bdefae69-1a6c-4e2d-87a2-1b49fa1ff373','seed-admin-001','CREATE','RECRUITMENT_ROUND','round-001',NULL,'117.121.218.158',1791426016);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('047b70bd-58dc-49a2-be02-96dd6c450007','seed-admin-001','CREATE','RECRUITMENT_ROUND','round-001',NULL,'117.121.218.158',1791427183);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('2a2704df-fa19-4ee6-b780-85baccfd8470','seed-admin-001','CREATE','RECRUITMENT_ROUND','round-001',NULL,'117.121.218.158',1791428442);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('b7513c8d-fd14-4991-bc3b-a67ca72f4c54','seed-admin-001','CREATE','RECRUITMENT_ROUND','BULK/NEW',NULL,'117.121.218.158',1791455348);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('5f9eae71-8541-4ac9-bd92-a91fb824f613','seed-admin-001','UPDATE','APPLICATION','e372e230-4488-4161-ae4d-1d6a525fd907','"{\"status\":\"QUALIFIED\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791465100);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('92a6bc0a-8add-4a75-bf30-2d8ad8f905dd','seed-admin-001','UPDATE','APPLICATION','bc7f053d-bc58-4bb2-99d2-ad0cf6d03269','"{\"status\":\"UNDER_REVIEW\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791465107);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('2ef5ad4b-eb41-4d7f-a4fc-1df5c541e9cd','seed-admin-001','UPDATE','APPLICATION','bc7f053d-bc58-4bb2-99d2-ad0cf6d03269','"{\"status\":\"QUALIFIED\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791465205);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('ba822230-c000-476e-b078-a9b21c15804c','seed-admin-001','UPDATE','APPLICATION','e372e230-4488-4161-ae4d-1d6a525fd907','"{\"status\":\"REJECTED\",\"reason\":\"กก\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791465485);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('92e1a741-73d0-4efa-ad91-6ec9c41bdab8','seed-admin-001','UPDATE','APPLICATION','e372e230-4488-4161-ae4d-1d6a525fd907','"{\"status\":\"QUALIFIED\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791465500);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('b7fb3225-85f4-44e2-ba85-b855b1ec91e7','seed-admin-001','UPDATE','APPLICATION','e372e230-4488-4161-ae4d-1d6a525fd907','"{\"status\":\"ARCHIVED\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791467191);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('2434ba75-8341-4161-a0a6-7f8fb9da0b63','seed-admin-001','UPDATE','APPLICATION','e372e230-4488-4161-ae4d-1d6a525fd907','"{\"status\":\"QUALIFIED\"}"','2001:fb1:df:ced:a9c6:f776:4c48:1130',1791467230);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('f499c77f-82e3-4a8e-b55a-7e8376310184','seed-admin-001','UPDATE','FIELD_MASTER','field-email',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470495);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('709ece1d-69dd-4c3b-a824-9165008302c2','seed-admin-001','UPDATE','FIELD_MASTER','field-education',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470762);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('559b10a4-da87-4e7a-acab-e2caa5cd40e5','seed-admin-001','UPDATE','FIELD_MASTER','field-gender',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470771);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('5c9d850c-940f-4641-8330-903f8dd5db5f','seed-admin-001','UPDATE','FIELD_MASTER','field-national-id',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470785);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('1cdf6dee-cdd4-4f3a-93e2-f2ca373fc494','seed-admin-001','UPDATE','FIELD_MASTER','field-national-id',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470792);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('2c325d8b-5ece-456e-9fa0-b86adfca0fd4','seed-admin-001','UPDATE','FIELD_MASTER','field-fullname',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470804);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('47335d71-8345-4b37-80a1-1bcbdcbe38b6','seed-admin-001','UPDATE','FIELD_MASTER','field-resume',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470824);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('311c38f2-d04e-4981-8ee8-0d94ec3c6994','seed-admin-001','UPDATE','FIELD_MASTER','field-resume',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791470836);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('6679694a-a939-49ac-8f3d-d30ed92c2d36','seed-admin-001','UPDATE','FIELD_MASTER','field-resume',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791471481);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('4a61fbe8-e9dd-4192-b5fe-32934f99d0a2','seed-admin-001','UPDATE','FIELD_MASTER','field-email',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791471523);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('bc54bdb5-98d5-4fcf-b52c-af8fe2c66f38','seed-admin-001','UPDATE','FIELD_MASTER','field-phone',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791471565);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('513e1ecf-cd1c-4482-96b6-bfbe29e3b0c6','seed-admin-001','UPDATE','FIELD_MASTER','field-address',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791471571);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('05c9632e-b71b-464a-9ec4-b8f707581612','seed-admin-001','UPDATE','FIELD_MASTER','field-resume',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791471720);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('b743d8be-a33a-4ff3-b0df-fc8670bca610','seed-admin-001','UPDATE','TEMPLATE','tpl-general-001',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791472355);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('14542d53-66dc-40da-878d-26601a150d62','seed-admin-001','CREATE','TEMPLATE_VERSION','tpl-general-001',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791472441);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('5f747260-fe33-4c48-8387-22dfec2bdcfe','seed-admin-001','UPDATE','RECRUITMENT_ROUND','round-001',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791472512);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('3a9784f8-a23c-459c-996c-ffcb82bd00f8','seed-admin-001','UPDATE','RECRUITMENT_ROUND','5ac96989-968d-4f1a-a5e3-e2cebcc05a95',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791472525);
INSERT INTO "audit_logs" ("id","admin_id","action","entity_type","entity_id","payload","ip_address","created_at") VALUES('91d52e16-b10d-4b9c-8d4b-4838da2d175e','seed-admin-001','UPDATE','FIELD_MASTER','field-education',NULL,'2001:fb1:df:ced:a9c6:f776:4c48:1130',1791473442);
CREATE TABLE `field_master` (
	`id` text PRIMARY KEY NOT NULL,
	`field_type` text NOT NULL,
	`label_th` text NOT NULL,
	`default_options` text,
	`pdf_mapping_key` text,
	`is_active` integer DEFAULT true, help_text TEXT, placeholder TEXT, section TEXT, file_config TEXT, validation_type TEXT, validation_message TEXT,
	CONSTRAINT "chk_field_type" CHECK("field_master"."field_type" IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE'))
);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-fullname','TEXT','ชื่อ-นามสกุล',NULL,'fullname',1,NULL,NULL,'ข้อมูลส่วนบุคคล',NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-national-id','TEXT','เลขบัตรประจำตัวประชาชน',NULL,'national_id',0,NULL,NULL,'ข้อมูลส่วนบุคคล',NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-email','TEXT','อีเมล',NULL,'email',1,NULL,NULL,'ข้อมูลส่วนบุคคล',NULL,'EMAIL','กรุณากรอก email ให้ถูกต้อง');
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-phone','TEXT','เบอร์โทรศัพท์',NULL,'phone',1,NULL,NULL,'ข้อมูลส่วนบุคคล',NULL,'PHONE','กรุณากรอกหมายเลขโทรศัพท์ให้ถูกต้อง');
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-address','TEXTAREA','ที่อยู่',NULL,'address',0,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-education','DROPDOWN','ระดับการศึกษา','"[\"มัธยมศึกษา\",\"ปวช.\",\"ปวส.\",\"ปริญญาตรี\",\"ปริญญาโท\",\"ปริญญาเอก\"]"','education',1,NULL,NULL,'การศึกษา',NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-gender','RADIO','เพศ','"[\"ชาย\",\"หญิง\",\"อื่นๆ\"]"','gender',0,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-resume','FILE','ไฟล์ประวัติย่อ (PDF)',NULL,'resume',1,NULL,NULL,'ประสบการณ์ทำงาน','"{\"allowedFileTypes\":[\"pdf\"],\"maxFiles\":1,\"maxSizeMB\":3}"',NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-portfolio','FILE','ผลงาน (ถ้ามี)',NULL,'portfolio',1,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "field_master" ("id","field_type","label_th","default_options","pdf_mapping_key","is_active","help_text","placeholder","section","file_config","validation_type","validation_message") VALUES('field-experience','TEXTAREA','ประสบการณ์ทำงาน',NULL,'experience',1,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE `recruitment_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`title` text NOT NULL,
	`position_level` text NOT NULL,
	`open_date` integer NOT NULL,
	`close_date` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE',
	`created_at` integer DEFAULT (unixepoch()),
	`deleted_at` integer,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_round_status" CHECK("recruitment_rounds"."status" IN ('DRAFT', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "chk_round_dates" CHECK("recruitment_rounds"."close_date" >= "recruitment_rounds"."open_date")
);
INSERT INTO "recruitment_rounds" ("id","template_version_id","title","position_level","open_date","close_date","status","created_at","deleted_at") VALUES('round-001','tplver-001','รับสมัครพนักงานใหม่ ประจำปี 2569','ระดับชำนาญการ',1791427140,1792204740,'ACTIVE',1791388515,NULL);
INSERT INTO "recruitment_rounds" ("id","template_version_id","title","position_level","open_date","close_date","status","created_at","deleted_at") VALUES('5ac96989-968d-4f1a-a5e3-e2cebcc05a95','tplver-001','ทดสอบการรับสมัคร','ชำนาญการ',1791541680,1792924140,'ACTIVE',1791455348,NULL);
CREATE TABLE `template_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`field_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_required` integer DEFAULT true,
	`override_options` text,
	`override_label_th` text, validation_rules TEXT, help_text TEXT, placeholder TEXT,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `field_master`(`id`) ON UPDATE no action ON DELETE restrict
);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-001','tplver-001','field-fullname',1,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-002','tplver-001','field-national-id',2,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-003','tplver-001','field-email',3,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-004','tplver-001','field-phone',4,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-005','tplver-001','field-address',5,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-006','tplver-001','field-education',6,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-007','tplver-001','field-gender',7,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-008','tplver-001','field-resume',8,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-009','tplver-001','field-portfolio',9,0,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('tf-010','tplver-001','field-experience',10,0,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('97ee52dd-1960-4a89-98a8-08a7060b3746','40a803f9-691d-482f-b525-4f51664e47cb','field-fullname',1,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('52f794dd-698b-41e8-a8ec-10861494e77b','40a803f9-691d-482f-b525-4f51664e47cb','field-email',2,1,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "template_fields" ("id","template_version_id","field_id","display_order","is_required","override_options","override_label_th","validation_rules","help_text","placeholder") VALUES('14ec78d9-432f-4b2e-8755-54ed6f54cd0f','40a803f9-691d-482f-b525-4f51664e47cb','field-phone',3,1,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text DEFAULT 'DRAFT',
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_version_status" CHECK("template_versions"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);
INSERT INTO "template_versions" ("id","template_id","version_number","status","created_at") VALUES('tplver-001','tpl-general-001',1,'PUBLISHED',1791388515);
INSERT INTO "template_versions" ("id","template_id","version_number","status","created_at") VALUES('40a803f9-691d-482f-b525-4f51664e47cb','tpl-general-001',2,'PUBLISHED',1791472441);
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch())
);
INSERT INTO "templates" ("id","name","description","created_at") VALUES('tpl-general-001','แบบฟอร์มรับสมัครตำแหน่งประเภทวิชาการ ระดับชำนาญการ','Template สำหรับรับสมัครตำแหน่งประเภทวิชาการ ระดับชำนาญการ',1791388515);
CREATE TABLE IF NOT EXISTS "applications" (
  id text PRIMARY KEY NOT NULL,
  application_no text,
  round_id text NOT NULL,
  email text NOT NULL,
  fullname text NOT NULL,
  national_id text NOT NULL,
  status text DEFAULT 'SUBMITTED',
  status_reason text,
  verified_by text,
  verified_at integer,
  form_data text NOT NULL,
  submitted_at integer DEFAULT (unixepoch()),
  deleted_at integer,
  CONSTRAINT fk_round FOREIGN KEY (round_id) REFERENCES recruitment_rounds(id) ON DELETE RESTRICT,
  CONSTRAINT chk_app_status CHECK(status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'))
);
INSERT INTO "applications" ("id","application_no","round_id","email","fullname","national_id","status","status_reason","verified_by","verified_at","form_data","submitted_at","deleted_at") VALUES('e372e230-4488-4161-ae4d-1d6a525fd907','APP-2026-0240','round-001','thanet30@gmail.com','ธเนศ วรชินพันธุ์','1122211111111','QUALIFIED',NULL,'seed-admin-001',1791467230,'"{\"field-fullname\":\"ธเนศ วรชินพันธุ์\",\"field-national-id\":\"1122211111111\",\"field-email\":\"thanet30@gmail.com\",\"field-phone\":\"0875433363\",\"field-address\":\"หหห\",\"field-education\":\"มัธยมศึกษา\",\"field-experience\":\"หหห\"}"',1791434821,NULL);
INSERT INTO "applications" ("id","application_no","round_id","email","fullname","national_id","status","status_reason","verified_by","verified_at","form_data","submitted_at","deleted_at") VALUES('bc7f053d-bc58-4bb2-99d2-ad0cf6d03269','APP-2026-9144','round-001','dsd@sdsd.com','นายสมชาย ใจร้าย','1474111111111','QUALIFIED',NULL,'seed-admin-001',1791465205,'"{\"field-fullname\":\"นายสมชาย ใจร้าย\",\"field-national-id\":\"1474111111111\",\"field-email\":\"dsd@sdsd.com\",\"field-phone\":\"02121515\",\"field-address\":\"fdsfdsfdsfdsfd\",\"field-education\":\"ปวช.\",\"field-experience\":\"sss\"}"',1791446358,NULL);
INSERT INTO "applications" ("id","application_no","round_id","email","fullname","national_id","status","status_reason","verified_by","verified_at","form_data","submitted_at","deleted_at") VALUES('150e5778-6f09-4d04-b05b-4290bb90c66d','APP-2026-5943','5ac96989-968d-4f1a-a5e3-e2cebcc05a95','aasgdg@fefef.com','testtest','1222222222222','SUBMITTED',NULL,NULL,NULL,'{"field-fullname":"testtest","field-national-id":"1222222222222","field-email":"aasgdg@fefef.com","field-phone":"0222","field-address":"rgrgrgrgrg","field-education":"ปวช.","field-experience":""}',1791455434,NULL);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',3);
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);
CREATE INDEX `idx_attachments_app` ON `application_attachments` (`application_id`);
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);
CREATE INDEX `idx_tpl_fields_version` ON `template_fields` (`template_version_id`);
CREATE UNIQUE INDEX `unq_template_version` ON `template_versions` (`template_id`,`version_number`);
CREATE INDEX idx_apps_round ON applications(round_id);
CREATE INDEX idx_apps_status ON applications(status);
CREATE UNIQUE INDEX idx_apps_round_email ON applications(round_id, email) WHERE deleted_at IS NULL;
CREATE INDEX idx_field_master_section ON field_master(section);
CREATE INDEX idx_field_master_type ON field_master(field_type);
CREATE INDEX idx_field_master_validation_type ON field_master(validation_type);
