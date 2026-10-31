/**
 * Archived round cannot accept submissions (AR = Archived Round)
 * =======================================================================
 *
 * Bug (analysis 2026-10-31 @ 37d56604):
 *   GET /public/rounds/:id/schema บล็อกรอบที่ถูก archive (deletedAt IS NOT NULL)
 *   → 403 reason 'ARCHIVED' แต่ POST /public/applications/submit ไม่เช็ค deletedAt
 *   → ถ้า admin archive รอบก่อน closeDate (เช่น ยกเลิกรอบก่อนกำหนด) หน้าเว็บ
 *     (homepage/apply/schema) หายหมด แต่คนที่รู้ roundId + form structure
 *     ยังยิง submit ตรงสร้างใบสมัครจริงได้จนถึง closeDate
 *
 * ครอบคลุม (AR):
 *   AR1. control: รอบปกติ (ACTIVE ในช่วงเปิด, ไม่มี deletedAt) → 201 (baseline ของ harness)
 *   AR2. GET /schema ของรอบ archived → 403 reason ARCHIVED (พฤติกรรมที่ submit ต้อง mirror)
 *   AR3. POST /submit ของรอบ archived (ACTIVE + ยังไม่หมดเวลา) → 403 ARCHIVED
 *        (fail-when-no-fix: โค้ดเก่าไม่เช็ค deletedAt → 201)
 *   AR4. ข้อความ error ของ submit ต้องตรงกับ /schema ทุกตัวอักษร (parity)
 *   AR5. archived round ต้องไม่มี application ถูกสร้าง
 *   AR6. archived DRAFT round → 403 เช่นกัน (deletedAt ตัดสินก่อน status เหมือน /schema)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน submit/schema route จริงบน Hono กับ D1 จำลอง
 * (in-memory) แบบเดียวกับ submit-duplicate-protection.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/submit-archived-round.test.ts
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

// ── D1-compatible adapter (แบบเดียวกับ submit-duplicate-protection.test.ts) ──
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
`);

// ── Seed: 3 รอบในช่วงเปิดรับเดียวกัน (2025-01-01 → 2027-01-01) ──
//   round-arch-normal : ACTIVE + deleted_at=NULL  (control ของ AR1)
//   round-arch-active : ACTIVE + deleted_at ตั้งแล้ว (bug เป้าหมายหลัก — archive ก่อนหมดเวลา)
//   round-arch-draft  : DRAFT  + deleted_at ตั้งแล้ว (AR6)
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์มทดสอบ archived round');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-email','TEXT','อีเมล','email',1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-1','tv-1','field-email',1,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-2','tv-1','field-fullname',2,1);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-arch-normal','tv-1','รอบปกติ (control)','ระดับต้น',1735603200,1798761600,'ACTIVE','ARN01');
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code, deleted_at)
    VALUES ('round-arch-active','tv-1','รอบถูก archive ก่อนหมดเวลา','ระดับต้น',1735603200,1798761600,'ACTIVE','ARA01',1761859200);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code, deleted_at)
    VALUES ('round-arch-draft','tv-1','รอบ DRAFT ที่ถูก archive','ระดับต้น',1735603200,1798761600,'DRAFT','ARD01',1761859200);
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
const submitBody = (email, roundId) => ({
  roundId,
  formData: {
    'field-email': email,
    'field-fullname': 'ผู้สมัครสังเคราะห์',
  },
  attachments: [],
});

const post = async (body) => {
  __resetRateLimitStoreForTests();
  return app.request('/api/v1/public/applications/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env());
};

const getSchema = async (roundId) => {
  __resetRateLimitStoreForTests();
  return app.request(`/api/v1/public/rounds/${roundId}/schema`, {}, env());
};

const newEmail = (prefix) => {
  emailSeq += 1;
  return `${prefix}-${emailSeq}@test.local`;
};

// ═══ รัน ═══ (ครอบด้วย async IIFE — repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {

await test('AR1: control — รอบปกติ ACTIVE ในช่วงเปิด → 201 (baseline ของ harness)', async () => {
  const res = await post(submitBody(newEmail('ar1'), 'round-arch-normal'));
  const text = await res.text();
  assertEqual(res.status, 201, `status=${res.status} ${text}`);
});

await test('AR2: GET /schema ของรอบ archived → 403 reason ARCHIVED (พฤติกรรมที่ submit ต้อง mirror)', async () => {
  const res = await getSchema('round-arch-active');
  const text = await res.text();
  assertEqual(res.status, 403, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertEqual(json.reason, 'ARCHIVED', `reason=${json.reason}`);
});

await test('AR3: POST /submit รอบ archived (ACTIVE + ยังไม่หมดเวลา) → 403 ARCHIVED (fail-when-no-fix: เดิม 201)', async () => {
  const res = await post(submitBody(newEmail('ar3'), 'round-arch-active'));
  const text = await res.text();
  assertEqual(res.status, 403, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertEqual(json.reason, 'ARCHIVED', `reason=${json.reason}`);
});

await test('AR4: ข้อความ error ของ submit ต้องตรงกับ /schema ทุกตัวอักษร (parity)', async () => {
  const schemaRes = await getSchema('round-arch-active');
  const schemaJson = await schemaRes.json();
  const submitRes = await post(submitBody(newEmail('ar4'), 'round-arch-active'));
  const submitJson = await submitRes.json();
  assertEqual(submitJson.error, schemaJson.error, `submit error="${submitJson.error}" vs schema error="${schemaJson.error}"`);
});

await test('AR5: archived round ต้องไม่มี application ถูกสร้าง', async () => {
  const res = await post(submitBody(newEmail('ar5'), 'round-arch-active'));
  assertEqual(res.status, 403, `status=${res.status} ${await res.text()}`);
  const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM applications WHERE round_id='round-arch-active'`).get();
  assertEqual(rows.n, 0, `ต้องมี 0 แถว แต่ได้ ${rows.n}`);
});

await test('AR6: archived DRAFT round → 403 ARCHIVED (deletedAt ตัดสินก่อน status เหมือน /schema)', async () => {
  const res = await post(submitBody(newEmail('ar6'), 'round-arch-draft'));
  const text = await res.text();
  assertEqual(res.status, 403, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertEqual(json.reason, 'ARCHIVED', `reason=${json.reason}`);
});

console.log(`\nผลรวม: ผ่าน ${passed} ไม่ผ่าน ${failed}`);
if (failed > 0) {
  console.log('รายการที่ล้มเหลว:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

})();
