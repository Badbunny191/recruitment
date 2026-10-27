/**
 * Duplicate application protection — submit route (Migration 030 companion)
 * =======================================================================
 *
 * Business Rule (source of truth 2026-10-28):
 *   - ผู้สมัครมี active application ได้ 1 ใบต่อรอบ (active = ทุกสถานะยกเว้น CANCELED)
 *   - CANCELED สมัครใหม่ได้ / ARCHIVED (เก็บเข้าคลัง) สมัครใหม่ไม่ได้
 *   - คนละรอบสมัครได้อิสระกัน
 *   - email ต่าง case ถือเป็นคนเดียวกัน (เทียบด้วย lower())
 *
 * ครอบคลุม (DP = Duplicate Protection):
 *   DP1. submit ครั้งแรก → 201 (baseline)
 *   DP2. submit ซ้ำ email เดิม case เดิม → 400 "ท่านได้สมัครรอบนี้แล้ว"
 *   DP3. submit ซ้ำ email ต่าง case (สองทิศทาง) → 400 (fail-when-no-fix:
 *        โค้ดเก่า eq() exact-case จะให้ผ่านเป็น 201)
 *   DP4. แถวเดิม CANCELED → สมัครใหม่ → 201 (รวมยืนยันว่า index 030
 *        ไม่บล็อก CANCELED ตอน insert)
 *   DP5. แถวเดิม ARCHIVED → สมัครใหม่ → 400 (rule: archive ไม่เปิดทาง)
 *   DP6. email เดียวกันคนละรอบ → 201 ทั้งสองรอบ
 *   DP7. TOCTOU: duplicate check โดนแข่งเวลา (จำลองด้วยการ bypass query) →
 *        insert ติด idx_apps_round_email → ต้องได้ 400 "ท่านได้สมัครรอบนี้แล้ว"
 *        ไม่ใช่ 500 (fail-when-no-fix: โค้ดเก่า map เป็น DB_ERROR → 500)
 *
 * Test DDL ใส่ partial unique index ของ migration 030 จริง เพื่อทดสอบว่า
 * app check กับ DB index บังคับกฎเดียวกัน
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน submit route จริงบน Hono กับ D1 จำลอง
 * (in-memory) แบบเดียวกับ submit-required-file.test.ts ไม่ deploy ไม่แตะ D1
 *
 * รัน: node --import tsx src/routes/__tests__/submit-duplicate-protection.test.ts
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

// ── D1-compatible adapter (แบบเดียวกับ submit-required-file.test.ts) ──
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

// ── จำลอง TOCTOU: ทำให้ duplicate check เห็นว่าไม่มีแถวซ้ำ (เหมือนถูกแข่งเวลา)
//    แต่ insert ยังชน idx_apps_round_email จริง ──
function createBypassDuplicateCheckAdapter(base) {
  return {
    prepare(sqlText) {
      if (sqlText.includes('from "applications"') && sqlText.includes('"status" <>')) {
        return {
          bind() { return this; },
          async all() { return { results: [] }; },
          async first() { return null; },
          async run() { return { success: true, meta: { changes: 0, last_row_id: 0 } }; },
          async raw() { return []; },
        };
      }
      return base.prepare(sqlText);
    },
    batch: (statements) => base.batch(statements),
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

  -- ── Migration 030: partial unique index ตัวจริง ──
  CREATE UNIQUE INDEX idx_apps_round_email
    ON applications (round_id, lower(email))
    WHERE status != 'CANCELED' AND deleted_at IS NULL;
`);

// ── Seed: รอบเปิดรับ 2 รอบ (DP6 ใช้พิสูจน์ "คนละรอบสมัครได้") ──
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์มทดสอบ duplicate');
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
    VALUES ('round-dup-1','tv-1','รอบทดสอบ 1','ระดับต้น',1735603200,1798761600,'ACTIVE','DUP01');
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-dup-2','tv-1','รอบทดสอบ 2','ระดับต้น',1735603200,1798761600,'ACTIVE','DUP02');
`);

const app = new Hono();
app.route('/api/v1/public', publicRoutes);

const d1 = createD1Adapter(sqlite);
const d1Bypass = createBypassDuplicateCheckAdapter(d1);
const env = (db = d1) => ({
  DB: db,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000',
});

let emailSeq = 0;
const submitBody = (email, roundId = 'round-dup-1') => ({
  roundId,
  formData: {
    'field-email': email,
    'field-fullname': 'ผู้สมัครสังเคราะห์',
  },
  attachments: [],
});

const post = async (body, useBypass = false) => {
  __resetRateLimitStoreForTests();
  return app.request('/api/v1/public/applications/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env(useBypass ? d1Bypass : d1));
};

const newEmail = (prefix) => {
  emailSeq += 1;
  return `${prefix}-${emailSeq}@test.local`;
};

// ═══ รัน ═══ (ครอบด้วย async IIFE — repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {

await test('DP1: submit ครั้งแรก → 201 (baseline)', async () => {
  const res = await post(submitBody(newEmail('dp1')));
  assertEqual(res.status, 201, `status=${res.status} ${await res.text()}`);
});

await test('DP2: submit ซ้ำ email เดิม case เดิม → 400 ข้อความเดิม', async () => {
  const email = newEmail('dp2');
  const first = await post(submitBody(email));
  assertEqual(first.status, 201, `first status=${first.status} ${await first.text()}`);
  const second = await post(submitBody(email));
  assertEqual(second.status, 400, `second status=${second.status}`);
  const json = await second.json();
  assertEqual(json.error, 'ท่านได้สมัครรอบนี้แล้ว', `error=${json.error}`);
});

await test('DP3: submit ซ้ำ email ต่าง case (สองทิศทาง) → 400 (case-insensitive)', async () => {
  // ทิศทาง 1: เก็บ lowercase → ส่งตัวพิมพ์ใหญ่
  const emailLower = newEmail('dp3');
  const a = await post(submitBody(emailLower));
  assertEqual(a.status, 201, `a status=${a.status} ${await a.text()}`);
  const b = await post(submitBody(emailLower.toUpperCase()));
  const bText = await b.text();
  assertEqual(b.status, 400, `b status=${b.status} ${bText}`);
  assertEqual(JSON.parse(bText).error, 'ท่านได้สมัครรอบนี้แล้ว');

  // ทิศทาง 2: เก็บมีตัวพิมพ์ใหญ่ → ส่ง lowercase
  const emailMixed = `Mixed-${newEmail('dp3b')}`;
  const c = await post(submitBody(emailMixed));
  assertEqual(c.status, 201, `c status=${c.status} ${await c.text()}`);
  const d = await post(submitBody(emailMixed.toLowerCase()));
  const dText = await d.text();
  assertEqual(d.status, 400, `d status=${d.status} ${dText}`);
  assertEqual(JSON.parse(dText).error, 'ท่านได้สมัครรอบนี้แล้ว');
});

await test('DP4: แถวเดิม CANCELED → สมัครใหม่ได้ → 201 (index 030 ไม่บล็อก)', async () => {
  const email = newEmail('dp4');
  const first = await post(submitBody(email));
  assertEqual(first.status, 201, `first status=${first.status} ${await first.text()}`);

  // admin ยกเลิกใบเดิม (เลียนแบบ PATCH /admin/applications/:id/status)
  sqlite.exec(`UPDATE applications SET status='CANCELED', status_reason='ทดสอบยกเลิก' WHERE email='${email}'`);

  const second = await post(submitBody(email));
  assertEqual(second.status, 201, `second status=${second.status} ${await second.text()}`);
  const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM applications WHERE lower(email)=lower('${email}')`).get();
  assertEqual(rows.n, 2, 'ต้องมี 2 แถว (CANCELED เก่า + SUBMITTED ใหม่)');
});

await test('DP5: แถวเดิม ARCHIVED → สมัครใหม่ไม่ได้ → 400', async () => {
  const email = newEmail('dp5');
  const first = await post(submitBody(email));
  assertEqual(first.status, 201, `first status=${first.status} ${await first.text()}`);

  sqlite.exec(`UPDATE applications SET status='ARCHIVED', status_reason='เก็บเข้าคลัง' WHERE email='${email}'`);

  const second = await post(submitBody(email));
  const secondText = await second.text();
  assertEqual(second.status, 400, `second status=${second.status} ${secondText}`);
  assertEqual(JSON.parse(secondText).error, 'ท่านได้สมัครรอบนี้แล้ว');
});

await test('DP6: email เดียวกันคนละรอบ → 201 ทั้งสองรอบ', async () => {
  const email = newEmail('dp6');
  const r1 = await post(submitBody(email, 'round-dup-1'));
  assertEqual(r1.status, 201, `round1 status=${r1.status} ${await r1.text()}`);
  const r2 = await post(submitBody(email, 'round-dup-2'));
  assertEqual(r2.status, 201, `round2 status=${r2.status} ${await r2.text()}`);
});

await test('DP7: TOCTOU — check ถูกแข่งเวลา → insert ติด idx_apps_round_email → 400 ไม่ใช่ 500', async () => {
  const email = newEmail('dp7');
  // pre-insert แถวซ้ำโดยตรง (เสมือน submit คู่ขนานแทรกผ่านระหว่าง check กับ insert)
  sqlite.exec(`
    INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status)
    VALUES ('dp7-existing', 'APP-2026-90909', 'round-dup-1', '${email}', 'ผู้สมัครสังเคราะห์', '{}', 'SUBMITTED')
  `);
  // submit ด้วย email ต่าง case + duplicate check ถูก bypass (เหมือนแพ้แข่ง)
  const res = await post(submitBody(email.toUpperCase()), true);
  const resText = await res.text();
  assertEqual(res.status, 400, `status=${res.status} ${resText}`);
  assertEqual(JSON.parse(resText).error, 'ท่านได้สมัครรอบนี้แล้ว', `error=${JSON.parse(resText).error}`);
  // ไม่มีแถวใหม่ถูกใส่
  const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM applications WHERE lower(email)=lower('${email}')`).get();
  assertEqual(rows.n, 1, 'ต้องยังมีแถวเดียว (insert ถูก index ปฏิเสธ)');
});

console.log(`\nผลรวม: ผ่าน ${passed} ไม่ผ่าน ${failed}`);
if (failed > 0) {
  console.log('รายการที่ล้มเหลว:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

})();
