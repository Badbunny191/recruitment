-- 1. ผู้ดูแลระบบ
CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'HR_OFFICER',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. คลังคำถาม
CREATE TABLE field_master (
    id TEXT PRIMARY KEY,
    field_type TEXT NOT NULL, -- 'TEXT', 'DROPDOWN', 'RADIO', 'FILE', etc.
    label_th TEXT NOT NULL,
    default_options TEXT, -- JSON Array
    pdf_mapping_key TEXT,
    is_active INTEGER DEFAULT 1
);

-- 3. เทมเพลตหลัก
CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. เวอร์ชันของเทมเพลต (หัวใจของ Template Versioning)
CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates(id),
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'PUBLISHED', 'ARCHIVED'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, version_number)
);

-- 5. การผูกฟิลด์เข้ากับเวอร์ชันของเทมเพลต
CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL REFERENCES template_versions(id),
    field_id TEXT NOT NULL REFERENCES field_master(id),
    display_order INTEGER NOT NULL,
    is_required INTEGER DEFAULT 1,
    override_options TEXT, -- JSON Array
    override_label_th TEXT
);

-- 6. รอบการรับสมัคร
CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL REFERENCES template_versions(id),
    title TEXT NOT NULL,
    position_level TEXT NOT NULL,
    open_date DATETIME NOT NULL,
    close_date DATETIME NOT NULL,
    status TEXT DEFAULT 'ACTIVE', -- 'DRAFT', 'ACTIVE', 'CLOSED'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. ข้อมูลใบสมัคร (Hybrid Model)
CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT UNIQUE,
    round_id TEXT NOT NULL REFERENCES recruitment_rounds(id),
    email TEXT NOT NULL, -- Core Field
    fullname TEXT NOT NULL, -- Core Field
    national_id TEXT NOT NULL, -- Core Field
    status TEXT DEFAULT 'SUBMITTED', -- 'DRAFT'(P2), 'SUBMITTED', 'VERIFIED'
    form_data TEXT NOT NULL, -- JSON Payload
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. ไฟล์แนบ
CREATE TABLE application_attachments (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id),
    field_id TEXT NOT NULL, -- อ้างอิงว่าอัปโหลดตอบคำถามข้อใด
    file_url TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. ร่องรอยการทำงาน
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT, -- JSON ของสิ่งที่เปลี่ยน
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_apps_round ON applications(round_id);
CREATE INDEX idx_apps_status ON applications(status);