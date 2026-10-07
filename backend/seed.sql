/**
 * Seed script สำหรับ Demo
 * รันด้วย: wrangler d1 execute sao-db --local --file=./seed.sql
 */

-- สร้าง admin user (password: admin123)
INSERT INTO admin_users (id, email, password_hash, role) VALUES 
  ('seed-admin-001', 'admin@recruitment.go.th', 'admin123', 'HR_ADMIN');

-- สร้าง field_master (ชนิดฟิลด์สำหรับฟอร์ม)
INSERT INTO field_master (id, field_type, label_th, default_options, pdf_mapping_key, is_active) VALUES 
  ('field-fullname', 'TEXT', 'ชื่อ-นามสกุล', NULL, 'fullname', true),
  ('field-national-id', 'TEXT', 'เลขบัตรประจำตัวประชาชน', NULL, 'national_id', true),
  ('field-email', 'TEXT', 'อีเมล', NULL, 'email', true),
  ('field-phone', 'TEXT', 'เบอร์โทรศัพท์', NULL, 'phone', true),
  ('field-address', 'TEXTAREA', 'ที่อยู่', NULL, 'address', true),
  ('field-education', 'DROPDOWN', 'ระดับการศึกษา', '["มัธยมศึกษา","ปวช.","ปวส.","ปริญญาตรี","ปริญญาโท","ปริญญาเอก"]', 'education', true),
  ('field-gender', 'RADIO', 'เพศ', '["ชาย","หญิง","อื่นๆ"]', 'gender', true),
  ('field-resume', 'FILE', 'ไฟล์ประวัติย่อ (PDF)', NULL, 'resume', true),
  ('field-portfolio', 'FILE', 'ผลงาน (ถ้ามี)', NULL, 'portfolio', true),
  ('field-experience', 'TEXTAREA', 'ประสบการณ์ทำงาน', NULL, 'experience', true);

-- สร้าง template สำหรับฟอร์มสมัครงาน
INSERT INTO templates (id, name, description) VALUES 
  ('tpl-general-001', 'แบบฟอร์มสมัครงานทั่วไป', 'Template สำหรับรับสมัครงานตำแหน่งทั่วไป');

-- สร้าง template version
INSERT INTO template_versions (id, template_id, version_number, status) VALUES 
  ('tplver-001', 'tpl-general-001', 1, 'PUBLISHED');

-- สร้าง template fields (ลำดับฟิลด์ในฟอร์ม)
INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required) VALUES 
  ('tf-001', 'tplver-001', 'field-fullname', 1, true),
  ('tf-002', 'tplver-001', 'field-national-id', 2, true),
  ('tf-003', 'tplver-001', 'field-email', 3, true),
  ('tf-004', 'tplver-001', 'field-phone', 4, true),
  ('tf-005', 'tplver-001', 'field-address', 5, true),
  ('tf-006', 'tplver-001', 'field-education', 6, true),
  ('tf-007', 'tplver-001', 'field-gender', 7, true),
  ('tf-008', 'tplver-001', 'field-resume', 8, true),
  ('tf-009', 'tplver-001', 'field-portfolio', 9, false),
  ('tf-010', 'tplver-001', 'field-experience', 10, false);

-- สร้าง recruitment round (รอบรับสมัคร)
INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status) VALUES 
  ('round-001', 'tplver-001', 'รับสมัครพนักงานใหม่ ประจำปี 2569', 'ระดับปฏิบัติการ', 1735680600, 1740940200, 'ACTIVE');
