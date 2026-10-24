/**
 * Submit Route — Attachment Original Filename (Migration 027)
 * ============================================================================
 * รัน: node --import tsx src/routes/__tests__/submit-attachment-filename.test.ts
 *
 * ครอบ POST /api/v1/public/applications/submit แบบ mount route จริง
 * (D1-compatible adapter บน better-sqlite3 in-memory — ข้อมูลสังเคราะห์ทั้งหมด):
 *
 *   S. Payload เก่า {fieldId, fileUrl} ยัง submit ได้ (backward compat)
 *   T. Payload ใหม่มี filename → บันทึก original_filename
 *   U. ชื่อภาษาไทยบันทึกและอ่านกลับได้
 *   V. Backend sanitize filename ซ้ำก่อน insert (path separator / null byte /
 *      control chars / ยาวเกิน — ไม่เชื่อ client ตรงๆ)
 *   W. Attachment หลายไฟล์บันทึกชื่อถูกต้องครบทุกไฟล์
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../public.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name, fn) {
  return Promise.resolve().then(() => fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  }).catch((e) => {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  });
}
function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTrue(cond, msg = '') { if (!cond) throw new Error(msg || 'Expected true'); }

// ── D1-compatible adapter (แบบเดียวกับ admin-login-lockout.test.ts) ────────
function createD1Adapter(sqlite) {
  const makeStatement = (sqlText) => {
    const stmt = sqlite.prepare(sqlText);
    let bound = [];
    const api = {
      bind(...params) { bound = params; return api; },
      async all() { return { results: stmt.all(...bound) }; },
      async first() { return stmt.get(...bound) ?? null; },
      async run() {
        const info = stmt.run(...bound);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() { return stmt.raw(true).all(...bound); },
    };
    return api;
  };
  return {
    prepare: (sqlText) => makeStatement(sqlText),
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        await s.run();
        results.push({ results: [], success: true, meta: { changes: 0 } });
      }
      return results;
    },
  };
}

// ── Schema (mirror ของไฟล์ migration จริง — ครบทุกคอลัมน์ที่ route แตะ) ─────
const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT DEFAULT 'DRAFT');
  CREATE TABLE template_sections (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, name TEXT NOT NULL, display_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1);
  CREATE TABLE field_master (
    id TEXT PRIMARY KEY, field_type TEXT NOT NULL, label_th TEXT NOT NULL,
    pdf_mapping_key TEXT, allow_other INTEGER DEFAULT 0
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL,
    section_id TEXT, display_order INTEGER NOT NULL, is_required INTEGER DEFAULT 1,
    allow_other INTEGER
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
  CREATE TABLE application_attachments (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL, field_id TEXT NOT NULL,
    file_url TEXT NOT NULL, original_filename TEXT, uploaded_at INTEGER
  );
`);

const d1 = createD1Adapter(sqlite);
const app = new Hono();
app.route('/api/v1/public', publicRoutes);
const env = () => ({
  DB: d1,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000', // test ยิงหลายรอบ — เปิดเพดานสูง + reset ทุกครั้ง
});

// ── Seed world ───────────────────────────────────────────────────────────────
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์มทดสอบ submit');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO field_master VALUES ('field-email','TEXT','อีเมล','email',0);
  INSERT INTO field_master VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',0);
  INSERT INTO field_master VALUES ('f-files','FILE','เอกสารแนบ',NULL,0);
  INSERT INTO template_fields VALUES ('tf-1','tv-1','field-email',NULL,1,1,NULL);
  INSERT INTO template_fields VALUES ('tf-2','tv-1','field-fullname',NULL,2,1,NULL);
  INSERT INTO template_fields VALUES ('tf-3','tv-1','f-files',NULL,3,0,NULL);
  -- หน้าต่างเปิดรับกว้างพอสำหรับทุกช่วงเวลาที่ test รัน
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status)
  VALUES ('round-1','tv-1','รอบทดสอบ submit','ระดับต้น',1735603200,1798761600,'ACTIVE');
`);

let seq = 0;
async function submit(payload) {
  __resetRateLimitStoreForTests();
  return app.request('/api/v1/public/applications/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, env());
}

function basePayload({ email, attachments }) {
  seq += 1;
  return {
    roundId: 'round-1',
    formData: {
      'field-email': email,
      'field-fullname': `ผู้สมัครทดสอบ ${seq}`,
    },
    attachments,
  };
}

const attsOf = (email) => sqlite.prepare(
  'SELECT a.id, a.field_id, a.file_url, a.original_filename FROM application_attachments a JOIN applications p ON p.id = a.application_id WHERE p.email = ? ORDER BY a.rowid',
).all(email);

async function runAll() {
  console.log('\n=== Submit — Attachment Original Filename (Migration 027) ===\n');

  await test('S: payload เก่า (fieldId+fileUrl ไม่มี filename) ยัง submit ได้ + original_filename เป็น NULL', async () => {
    const res = await submit(basePayload({
      email: 'old-payload@test.local',
      attachments: [{ fieldId: 'f-files', fileUrl: '/api/v1/public/uploads/files/uploads%2Fdocuments%2F2026%2F11111111-2222-3333-4444-555555555556-resume.pdf' }],
    }));
    assertEqual(res.status, 201, `ต้อง 201 ได้: ${res.status} ${await res.text()}`);
    const atts = attsOf('old-payload@test.local');
    assertEqual(atts.length, 1, 'บันทึก 1 attachment');
    assertEqual(atts[0].original_filename, null, 'original_filename ต้องเป็น NULL');
  });

  await test('T+U: payload ใหม่มี filename ภาษาไทย → บันทึกและอ่านกลับได้ครบ', async () => {
    const res = await submit(basePayload({
      email: 'thai@test.local',
      attachments: [{
        fieldId: 'f-files',
        fileUrl: '/api/v1/public/uploads/files/uploads%2Fdocuments%2F2026%2Fbbbbbbbb-2222-3333-4444-555555555556-x.pdf',
        filename: 'ใบสมัคร-ฉบับแก้ไข.pdf',
      }],
    }));
    assertEqual(res.status, 201);
    const atts = attsOf('thai@test.local');
    assertEqual(atts[0].original_filename, 'ใบสมัคร-ฉบับแก้ไข.pdf', 'ชื่อไทยต้องครบทุกตัวอักษร');
  });

  await test('V: backend sanitize ซ้ำก่อน insert — path separator / null byte / control / ยาวเกิน', async () => {
    const longName = 'ก'.repeat(200) + '.pdf'; // ผ่าน zod max(255) แต่เกิน cap 120 ของ sanitizer
    const res = await submit(basePayload({
      email: 'sanitize@test.local',
      attachments: [
        { fieldId: 'f-files', fileUrl: '/f/1', filename: '../../etc/evil/เอกสารลับ.pdf' },
        { fieldId: 'f-files', fileUrl: '/f/2', filename: 'เอกสาร\x00\x01ดี.pdf' },
        { fieldId: 'f-files', fileUrl: '/f/3', filename: longName },
        { fieldId: 'f-files', fileUrl: '/f/4', filename: '   ' },          // ว่าง → NULL (fallback ฝั่งผู้อ่าน)
      ],
    }));
    assertEqual(res.status, 201);
    const atts = attsOf('sanitize@test.local');
    assertEqual(atts.length, 4);
    assertEqual(atts[0].original_filename, 'เอกสารลับ.pdf', 'ตัด path เหลือ basename');
    assertEqual(atts[1].original_filename, 'เอกสารดี.pdf', 'null byte + control ถูกตัด');
    assertTrue(atts[2].original_filename.length <= 120, `ยาวต้อง ≤120 ได้ ${atts[2].original_filename.length}`);
    assertTrue(atts[2].original_filename.endsWith('.pdf'), 'คงนามสกุล .pdf');
    assertEqual(atts[3].original_filename, null, 'ชื่อว่าง → NULL ไม่ใช่ชื่อปลอม');
  });

  await test('V: filename ยาวเกิน 255 ตัว → zod ปฏิเสธที่ payload (400) ตาม contract', async () => {
    const res = await submit(basePayload({
      email: 'too-long@test.local',
      attachments: [{ fieldId: 'f-files', fileUrl: '/f/x', filename: 'ก'.repeat(300) }],
    }));
    assertEqual(res.status, 400, 'payload ที่เกิน max(255) ต้องถูกปฏิเสธตั้งแต่ zod');
  });

  await test('W: หลายไฟล์ใน field เดียว + หลาย field — บันทึงชื่อถูกครบทุกไฟล์', async () => {
    const res = await submit(basePayload({
      email: 'multi@test.local',
      attachments: [
        { fieldId: 'f-files', fileUrl: '/f/a', filename: 'my file (final) v2 -- แก้ไข.pdf' },
        { fieldId: 'f-files', fileUrl: '/f/b', filename: 'media_6accd61b060ba_1791809051.pdf' },
        { fieldId: 'f-files', fileUrl: '/f/c', filename: 'media_6accd61b060ba_1791809051.pdf' }, // ชื่อซ้ำ — เก็บชื่อเดิมทั้งคู่
      ],
    }));
    assertEqual(res.status, 201);
    const atts = attsOf('multi@test.local');
    assertEqual(atts.length, 3, 'ครบ 3 ไฟล์');
    assertEqual(atts[0].original_filename, 'my file (final) v2 -- แก้ไข.pdf', 'ช่องว่าง/วงเล็บ/ขีด ครบ');
    assertEqual(atts[1].original_filename, 'media_6accd61b060ba_1791809051.pdf');
    assertEqual(atts[2].original_filename, 'media_6accd61b060ba_1791809051.pdf', 'ชื่อเดียวกันสองไฟล์ยังเป็นชื่อเดิม');
    assertTrue(atts[1].id !== atts[2].id, 'สองไฟล์เป็นคนละ record');
  });

  await test('regression: submit ไม่มี attachments ยังผ่าน (กรณีฟอร์มไม่มีไฟล์)', async () => {
    const res = await submit(basePayload({ email: 'no-file@test.local', attachments: undefined }));
    assertEqual(res.status, 201, 'ต้อง 201 เหมือนเดิม');
    assertEqual(attsOf('no-file@test.local').length, 0);
  });

  console.log(`\n=== Submit suite: ${passed} ผ่าน, ${failed} ล้ม ===`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((e) => { console.error('FATAL:', e); process.exit(1); });
