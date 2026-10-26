/**
 * Local Smoke Test: TEXTAREA rows/minLength/MaxLength end-to-end
 * =======================================================================
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน submit route + schema route จริงบน Hono
 * กับ D1 จำลอง (in-memory) แบบเดียวกับ excel-export-e2e-smoke.test.ts
 * ไม่ deploy ไม่แตะ D1/Production
 *
 * เทียบขั้นตอน Local Smoke Test ของ spec:
 *   1. สร้าง TEXTAREA rows=5, minLength=10, maxLength=500      → seed ด้านล่าง
 *   2. ตรวจ Public Schema ส่งค่าครบ                              → smoke 2
 *   3-4. เปิด Applicant Form / ช่องสูง 5 บรรทัด                  → ครอบด้วย
 *        textarea-field.test.ts (getTextareaRows) + SSR page build ผ่าน
 *   5. พิมพ์ 9 ตัว → ไม่ผ่าน                                     → smoke 5
 *   6. พิมพ์ 10 ตัว → ผ่าน                                      → smoke 6
 *   7. พิมพ์ 500 ตัว → ผ่าน                                     → smoke 7
 *   8. เกิน 500 → native maxlength ป้องกัน                       → ฝั่ง UI
 *        (maxLength attr) ครอบด้วย textarea-field.test.ts
 *   9. Submit API ตรง 501 ตัว → 400                              → smoke 9
 *   10. Review รักษา newline                                     → ครอบด้วย
 *        textarea-review-markup.test.ts
 *   11. PDF Download ใช้ Renderer เดิม                            → renderer ไม่ถูกแก้
 *        (git diff ไม่มีไฟล์ PDF) + PDF regression tests ผ่านทั้งชุด
 *
 * รัน: node --import tsx src/routes/__tests__/submit-textarea-smoke.test.ts
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

// ── D1-compatible adapter (แบบเดียวกับ excel-export-e2e-smoke.test.ts) ──
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

// ── Seed: รอบ 1 = settings ครบ (rows=5, min=10, max=500) / รอบ 2 = ข้อมูลเก่า (null ทั้งหมด) ──
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์ม smoke TEXTAREA');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO template_versions VALUES ('tv-2','tpl-1',2,'PUBLISHED');
  INSERT INTO template_sections VALUES ('sec-1','tv-1','ข้อมูลทั่วไป',0,1,NULL,NULL);
  INSERT INTO field_master VALUES ('field-email','TEXT','อีเมล',NULL,'email',NULL,NULL,NULL,NULL,NULL,NULL,0,1);
  INSERT INTO field_master VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล',NULL,'fullname',NULL,NULL,NULL,NULL,NULL,NULL,0,1);
  INSERT INTO field_master VALUES ('f-answer','TEXTAREA','คำตอบที่ผู้ดูแลกำหนด',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,1);
  INSERT INTO template_fields VALUES ('tf-1','tv-1','field-email','sec-1',1,1,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO template_fields VALUES ('tf-2','tv-1','field-fullname','sec-1',2,1,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO template_fields VALUES ('tf-3','tv-1','f-answer','sec-1',3,1,NULL,NULL,0,NULL,NULL,NULL,5,10,500);
  INSERT INTO template_fields VALUES ('tf-4','tv-2','field-email',NULL,1,1,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO template_fields VALUES ('tf-5','tv-2','field-fullname',NULL,2,1,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO template_fields VALUES ('tf-6','tv-2','f-answer',NULL,3,1,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
  VALUES ('round-full','tv-1','รอบ smoke (settings ครบ)','ระดับต้น',1735603200,1798761600,'ACTIVE','SMK01');
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
  VALUES ('round-legacy','tv-2','รอบ smoke (ข้อมูลเก่า)','ระดับต้น',1735603200,1798761600,'ACTIVE','SMK02');
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
const submitBody = (roundId, answer) => {
  emailSeq += 1;
  return {
    roundId,
    formData: {
      'field-email': `smoke-${emailSeq}@test.local`,
      'field-fullname': 'ผู้สมัครสังเคราะห์',
      'f-answer': answer,
    },
    attachments: [],
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

await test('smoke 2: Public Schema ส่ง rows=5, minLength=10, maxLength=500 ครบ', async () => {
  __resetRateLimitStoreForTests();
  const res = await app.request('/api/v1/public/rounds/round-full/schema', {}, env());
  assertEqual(res.status, 200);
  const json = await res.json();
  const f = json.data.fields.find((x) => x.fieldId === 'f-answer');
  assertTrue(f, 'ไม่พบ field f-answer');
  assertEqual(f.rows, 5);
  assertEqual(f.minLength, 10);
  assertEqual(f.maxLength, 500);
});

await test('smoke 5: คำตอบ 9 ตัว (สั้นกว่า minLength) → 400 TEXTAREA_TOO_SHORT', async () => {
  const res = await post(submitBody('round-full', 'ก'.repeat(9)));
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertEqual(json.code, 'TEXTAREA_TOO_SHORT');
  assertTrue(json.error.includes('10'), 'error ต้องระบุ minLength');
});

await test('smoke 6: คำตอบ 10 ตัว (เท่า minLength) → 201', async () => {
  const res = await post(submitBody('round-full', 'ก'.repeat(10)));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('smoke 7: คำตอบ 500 ตัว (เท่า maxLength) → 201', async () => {
  const res = await post(submitBody('round-full', 'ก'.repeat(500)));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('smoke 9: submit API ตรง 501 ตัว (เกิน maxLength) → 400 TEXTAREA_TOO_LONG', async () => {
  const res = await post(submitBody('round-full', 'ก'.repeat(501)));
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertEqual(json.code, 'TEXTAREA_TOO_LONG');
  assertTrue(json.error.includes('500'), 'error ต้องระบุ maxLength');
  assertTrue(!('formData' in json), 'error ต้องไม่ส่งคำตอบกลับ');
});

await test('AB: required TEXTAREA whitespace อย่างเดียว → 400 REQUIRED_FIELD_EMPTY', async () => {
  const res = await post(submitBody('round-full', '   \n  '));
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertEqual(json.code, 'REQUIRED_FIELD_EMPTY');
});

await test('AJ: คำตอบไม่ใช่ string → 400 INVALID_TEXTAREA_VALUE', async () => {
  const res = await post(submitBody('round-full', 12345));
  assertEqual(res.status, 400, `status=${res.status}`);
  const json = await res.json();
  assertEqual(json.code, 'INVALID_TEXTAREA_VALUE');
});

await test('AL: field type อื่นทำงานเหมือนเดิม (required TEXT ว่าง → 400 แบบเดิม)', async () => {
  __resetRateLimitStoreForTests();
  const res = await app.request('/api/v1/public/applications/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roundId: 'round-full',
      formData: { 'field-email': 'no-fullname@test.local', 'f-answer': 'ก'.repeat(10) },
      attachments: [],
    }),
  }, env());
  assertEqual(res.status, 400);
  const json = await res.json();
  assertTrue(json.error.includes('field-fullname'), 'ต้องรายงาน field ที่จำเป็น');
});

await test('AM/AH/AI: ข้อมูลเก่า (ไม่มี settings) — 5,000 ผ่าน / 5,001 → 400 (hard cap)', async () => {
  const ok = await post(submitBody('round-legacy', 'ก'.repeat(5000)));
  assertEqual(ok.status, 201, `5,000 ต้องผ่าน: ${ok.status}`);

  const over = await post(submitBody('round-legacy', 'ก'.repeat(5001)));
  assertEqual(over.status, 400, '5,001 ต้องโดน hard cap');
  const json = await over.json();
  assertEqual(json.code, 'TEXTAREA_TOO_LONG');
  assertTrue(json.error.includes('5,000'), 'error ต้องระบุ hard cap');
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
