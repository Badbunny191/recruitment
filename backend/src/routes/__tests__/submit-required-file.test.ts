/**
 * Required FILE field validation — submit route
 * =======================================================================
 *
 * Defect: FILE field ถูก serialize ลง `attachments` เท่านั้น (buildDraftPayload
 * ฝั่ง client ไม่เคยใส่ FILE ลง formData) แต่ required loop เดิมอ่านเฉพาะ
 * `data.formData` → FILE ที่ is_required=true ถูก reject เสมอ ทั้งที่อัปโหลด
 * ไฟล์มาแล้ว ("กรุณากรอกข้อมูลที่จำเป็น: field-resume")
 *
 * Fix: required loop ตรวจ FILE จาก `data.attachments` (มี attachment ≥ 1
 * รายการของ fieldId นั้น = ผ่าน, ครอบทั้ง single/multi-file) ค่า formData
 * ยังยอมรับเพื่อรองรับ payload รูปแบบเก่า — field type อื่นทำงานเหมือนเดิม
 *
 * ครอบคลุม:
 *   RF1. FILE required + attachment (single) → 201
 *   RF2. FILE required + ไม่มี attachment → 400 ระบุ fieldId
 *   RF3. FILE required + attachment ของ field อื่นเท่านั้น → 400
 *   RF4. FILE required multi-file (2 attachment ใน field เดียว) → 201
 *   RF5. FILE optional + ไม่มี attachment → 201 (regression)
 *   RF6. payload รูปแบบเก่า (URL อยู่ใน formData ไม่มี attachments) → 201 (compat)
 *   RF7. attachment ของ FILE ไม่ช่วย required ของ TEXT ที่หาย (field type อื่นเดิม)
 *   RF8. persistence ไม่กระทบ: form_data ไม่มี fileUrl / attachments ลง
 *        application_attachments ครบ (field_id + file_url + original_filename)
 *   RF9. attachment ที่ fileUrl ว่าง → Zod 400 (หลุด required ไม่ได้)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน submit route จริงบน Hono กับ D1 จำลอง
 * (in-memory) แบบเดียวกับ submit-textarea-smoke.test.ts ไม่ deploy ไม่แตะ D1
 *
 * รัน: node --import tsx src/routes/__tests__/submit-required-file.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../../routes/public.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter (แบบเดียวกับ submit-textarea-smoke.test.ts) ──
function createD1Adapter(sqlite) {
  return {
    prepare: (sqlText) => {
      const stmt = sqlite.prepare(sqlText);
      let bound = [];
      return {
        bind(...params) { bound = params; return this; },
        async all() { return { results: stmt.all(...bound) }; },
        async first() { return stmt.get(...bound) ?? null; },
        async run() {
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        async raw() { return stmt.raw(true).all(...bound); },
      };
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) { await s.run(); results.push({ results: [], success: true }); }
      return results;
    },
  };
}

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT DEFAULT 'DRAFT');
  CREATE TABLE template_sections (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, name TEXT NOT NULL, display_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE field_master (
    id TEXT PRIMARY KEY, field_type TEXT NOT NULL, label_th TEXT NOT NULL,
    default_options TEXT, pdf_mapping_key TEXT, section TEXT, help_text TEXT,
    placeholder TEXT, validation_type TEXT, validation_message TEXT,
    file_config TEXT, allow_other INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL,
    section_id TEXT, display_order INTEGER NOT NULL, is_required INTEGER DEFAULT 1,
    override_options TEXT, override_label_th TEXT, allow_other INTEGER,
    help_text TEXT, placeholder TEXT, validation_message TEXT,
    rows INTEGER, min_length INTEGER, max_length INTEGER
  );
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, title TEXT NOT NULL,
    position_level TEXT NOT NULL, open_date INTEGER NOT NULL, close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE', created_at INTEGER, deleted_at INTEGER,
    announcement_title TEXT, announcement_description TEXT, contact_information TEXT,
    remark TEXT, application_pattern TEXT, round_code TEXT
  );
  CREATE TABLE applications (
    id TEXT PRIMARY KEY, application_no TEXT UNIQUE, round_id TEXT NOT NULL,
    email TEXT NOT NULL, fullname TEXT NOT NULL, national_id TEXT,
    status TEXT DEFAULT 'SUBMITTED', status_reason TEXT, verified_by TEXT, verified_at INTEGER,
    form_data TEXT NOT NULL, submitted_at INTEGER, deleted_at INTEGER,
    year INTEGER, round_code TEXT, seq_in_round INTEGER
  );
  CREATE TABLE application_attachments (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, field_id TEXT NOT NULL, file_url TEXT NOT NULL, original_filename TEXT, uploaded_at INTEGER);
  CREATE TABLE attachment_uploads (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP', uploaded_at INTEGER, application_id TEXT, original_filename TEXT, delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER);
  CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT, ip_address TEXT, created_at INTEGER);
`);

// ── Seed: field-resume = FILE required / field-portfolio = FILE optional /
//    field-annual-doc = FILE required (ไว้ทดสอบ multi-file) / TEXT required 2 ชนิด ──
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์ม required FILE');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, file_config, is_active)
    VALUES ('field-email','TEXT','อีเมล','email',NULL,1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, file_config, is_active)
    VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',NULL,1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, file_config, is_active)
    VALUES ('field-resume','FILE','ไฟล์ประวัติย่อ',NULL,'{"maxFiles":1,"maxSizeMB":10}',1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, file_config, is_active)
    VALUES ('field-portfolio','FILE','ผลงาน',NULL,'{"maxFiles":3,"maxSizeMB":10}',1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, file_config, is_active)
    VALUES ('field-annual-doc','FILE','เอกสารประจำปี',NULL,'{"maxFiles":3,"maxSizeMB":10}',1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-1','tv-1','field-email',1,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-2','tv-1','field-fullname',2,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-3','tv-1','field-resume',3,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-4','tv-1','field-portfolio',4,0);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-5','tv-1','field-annual-doc',5,1);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-file','tv-1','รอบ required FILE','ระดับต้น',1735603200,1798761600,'ACTIVE','RFL01');
`);

const app = new Hono();
app.route('/api/v1/public', publicRoutes);

const d1 = createD1Adapter(sqlite);
const env = () => ({
  DB: d1,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000',
});

let emailSeq = 0;
const baseBody = (overrides = {}) => {
  emailSeq += 1;
  return {
    roundId: 'round-file',
    formData: {
      'field-email': `req-file-${emailSeq}@test.local`,
      'field-fullname': 'ผู้สมัครสังเคราะห์',
    },
    attachments: [],
    ...overrides,
  };
};

const post = async (body) => {
  __resetRateLimitStoreForTests();
  return app.request('/api/v1/public/applications/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env());
};

// ═══ รัน ═══ (ครอบด้วย async IIFE — repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {

await test('RF1: FILE required + attachment 1 ไฟล์ (single) → 201', async () => {
  const res = await post(baseBody({
    attachments: [
      { fieldId: 'field-resume', fileUrl: '/api/v1/public/uploads/files/resume.pdf', filename: 'resume.pdf' },
      { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/annual.pdf', filename: 'annual.pdf' },
    ],
  }));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('RF2: FILE required + ไม่มี attachment → 400 ระบุ fieldId', async () => {
  const res = await post(baseBody());
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertTrue(json.error.includes('field-resume'), `error ต้องระบุ field-resume: ${json.error}`);
});

await test('RF3: FILE required + attachment ของ field อื่นเท่านั้น → 400', async () => {
  const res = await post(baseBody({
    attachments: [{ fieldId: 'field-portfolio', fileUrl: '/api/v1/public/uploads/files/p1.pdf', filename: 'p1.pdf' }],
  }));
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertTrue(json.error.includes('field-resume'), `ต้องรายงาน field-resume: ${json.error}`);
});

await test('RF4: FILE required multi-file (2 attachment ใน field เดียว) → 201', async () => {
  const res = await post(baseBody({
    attachments: [
      { fieldId: 'field-resume', fileUrl: '/api/v1/public/uploads/files/r1.pdf', filename: 'r1.pdf' },
      { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/a1.pdf', filename: 'a1.pdf' },
      { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/a2.pdf', filename: 'a2.pdf' },
    ],
  }));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('RF5: FILE optional (portfolio) ไม่แนบ → 201 (regression: optional เดิมเป็นแบบนี้อยู่แล้ว)', async () => {
  const res = await post(baseBody({
    attachments: [
      { fieldId: 'field-resume', fileUrl: '/api/v1/public/uploads/files/r.pdf' },
      { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/a.pdf' },
    ],
  }));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('RF6: payload รูปแบบเก่า (URL อยู่ใน formData ไม่มี attachment) → 201 (backward compat)', async () => {
  const body = baseBody();
  body.formData['field-resume'] = '/api/v1/public/uploads/files/legacy.pdf';
  body.formData['field-annual-doc'] = '/api/v1/public/uploads/files/legacy-annual.pdf';
  const res = await post(body);
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('RF7: attachment ของ FILE ไม่ช่วย required ของ TEXT ที่หาย (field type อื่นเดิม)', async () => {
  const body = baseBody();
  delete body.formData['field-fullname'];
  body.attachments = [
    { fieldId: 'field-resume', fileUrl: '/api/v1/public/uploads/files/r.pdf' },
    { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/a.pdf' },
  ];
  const res = await post(body);
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertTrue(json.error.includes('field-fullname'), `ต้องรายงาน field-fullname: ${json.error}`);
});

await test('RF8: persistence ไม่กระทบ — form_data ไม่มี fileUrl / attachments ลงตารางครบ', async () => {
  const res = await post(baseBody({
    formData: {
      'field-email': 'persist@test.local',
      'field-fullname': 'ผู้ตรวจ persistence',
    },
    attachments: [
      { fieldId: 'field-resume', fileUrl: '/api/v1/public/uploads/files/persist-r.pdf', filename: 'ประวัติย่อ.pdf' },
      { fieldId: 'field-annual-doc', fileUrl: '/api/v1/public/uploads/files/persist-a.pdf', filename: 'เอกสาร.pdf' },
    ],
  }));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);

  const appRow = sqlite.prepare("SELECT id, form_data FROM applications WHERE email = 'persist@test.local'").get();
  assertTrue(appRow, 'ต้องมี applications row');
  const formData = JSON.parse(appRow.form_data);
  assertTrue(!('field-resume' in formData), 'form_data ต้องไม่มี FILE field (contract เดิม)');
  assertTrue(formData['field-fullname'] === 'ผู้ตรวจ persistence', 'form_data ต้องมีค่า TEXT ครบ');

  const atts = sqlite.prepare(
    "SELECT field_id, file_url, original_filename FROM application_attachments WHERE application_id = ? ORDER BY field_id"
  ).all(appRow.id);
  assertEqual(atts.length, 2, 'ต้องมี 2 attachments');
  assertTrue(atts.some((a) => a.field_id === 'field-resume' && a.file_url.includes('persist-r.pdf') && a.original_filename === 'ประวัติย่อ.pdf'),
    'attachment ต้องเก็บ field_id/file_url/original_filename ครบ');
});

await test('RF9: attachment ที่ fileUrl ว่าง → 400 ที่ Zod schema (หลุด required ไม่ได้)', async () => {
  const res = await post(baseBody({
    attachments: [{ fieldId: 'field-resume', fileUrl: '' }],
  }));
  assertEqual(res.status, 400, `status=${res.status}`);
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  (globalThis as any).process.exit(1);
}
})();
