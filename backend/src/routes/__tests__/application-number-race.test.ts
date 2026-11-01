/**
 * Application number allocation race — submit route + round-sequence service
 * =======================================================================
 *
 * Root causes (ยืนยันจากโค้ดจริง @ fix/application-number-race):
 *
 *   RC1 — round-sequence.service.ts: drizzle d1 `db.run()` คืนแค่
 *         `{success, meta}` (D1 `.run()` ไม่มี RETURNING rows) ทำให้
 *         extractReturnedValue() คืน null เสมอ → ทุกการออกเลขหลุดไป
 *         SELECT หลัง UPSERT → request คู่ขนานอ่านค่าเดียวกัน →
 *         application_no ซ้ำ → ชน UNIQUE แล้วตอบ 503
 *
 *   RC2 — public.routes.ts getMaxSequenceForYear(): `orderBy(desc(application_no))`
 *         บน TEXT = lexical — 'APP-2026-9999' > 'APP-2026-10000' → เมื่อ
 *         sequence ข้าม 9,999 ทุก submit คำนวณเลข 10000 ซ้ำ → ชน UNIQUE
 *         ครบ 5 retry → 503 ถาวร
 *
 *   RC3 — application-number.service.ts buildLegacyNumber(): MAX แบบ lexical
 *         เหมือน RC2 (ปัจจุบันไม่ถูก submit path เรียก แต่ต้องไม่ regress)
 *
 * ครอบคลุม (AN = Application Number):
 *   AN1.  atomic allocation ปกติ — เลขต่อเนื่องจาก sequence เดิม (Strategy B)
 *   AN2.  concurrent allocation — 6 request พร้อมกัน (gated) → ไม่มีเลขซ้ำ
 *         ไม่มี 503 (fail-before-fix: SELECT-after-UPSERT ทำให้ 5 request โดน 503)
 *   AN3.  crossing 9,999 แบบเรียง — 9998→9999→10000→10001 format ถูกต้อง
 *         ไม่ truncate ไม่ย้อนกลับ (Strategy A)
 *   AN4.  crossing 9,999 เมื่อ 10000 มีอยู่แล้ว — lexical MAX ต้องไม่ทำให้ 503
 *         (fail-before-fix: โค้ดเก่าคืน UNIQUE_COLLISION → 503 ถาวร)
 *   AN5.  concurrent crossing 9,999 (gated) — ทั้งคู่ต้อง 201 (fail-before-fix)
 *   AN6.  failed application insert — sequence ถูกเผา (gap) ตาม policy
 *         และใบถัดไปใช้เลขถัดจากเลขที่เผา ไม่นำเลขกลับมาใช้ซ้ำ
 *   AN7.  first application ของ round — ไม่มี sequence row → สร้าง row
 *         current_value=1 และคืนเลขแรกถูกต้อง
 *   AN8.  existing sequence row — increment จากค่าใน DB ตรง ๆ (pre-seed 41 → 42)
 *   AN9.  legacy data — ใบสมัครเก่าไม่ถูกแตะ (byte-identical) และเลขใหม่ต่อจาก
 *         numeric max ของปีนั้น
 *   AN10. duplicate submission — duplicate email → 400 ข้อความเดิม และ TOCTOU
 *         (insert ชน idx_apps_round_email) → 400 ไม่ใช่ 503/500 ทั้ง Strategy A/B
 *   AN11. result-shape regression — getNextRunningNumber ต้องอ่านค่าจาก
 *         RETURNING โดยตรง (break SELECT บน round_sequences แล้วยังต้อง
 *         ทำงานถูก) — ห้ามกลับไปมี SELECT-after-UPSERT fallback
 *   AN12. buildLegacyNumber (service) — numeric MAX ข้าม 9,999 ได้ (RC3)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน submit route จริงบน Hono กับ D1 จำลอง
 * (better-sqlite3 in-memory + D1 adapter) แบบเดียวกับ submit-required-file.test.ts
 * ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/application-number-race.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../../routes/public.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';
import { getNextRunningNumber } from '../../services/round-sequence.service';
import { buildApplicationNumber } from '../../services/application-number.service';
import { drizzle } from 'drizzle-orm/d1';

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

// อ่าน body ครั้งเดียว — ห้าม res.text() ซ้ำกับ res.json() (Body is unusable)
async function jsonOf(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
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

// ── Gate: บังคับ interleaving เพื่อพิสูจน์ race ──
// statement ที่ตรง match จะ "execute จริงทันที" (capture ผลตอนเรียก) แต่
// "คืนผล" หลังรอจนครบ gateSize ครั้ง → request ทุกตัว claim/อ่านก่อนตัวใด
// เคลียร์ต่อ เหมือนถูกแข่งเวลาจริง เมื่อปล่อยแล้ว statement ถัดไปผ่านทันที
function makeGate(gateSize: number) {
  let arrived = 0;
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return {
    released: false,
    async pass() {
      arrived += 1;
      if (arrived >= gateSize) {
        this.released = true;
        release();
        return;
      }
      await promise;
    },
  };
}

function createGatedAdapter(base, match: (sqlText: string) => boolean, gate) {
  return {
    prepare(sqlText) {
      const stmt = base.prepare(sqlText);
      if (!gate.released && match(sqlText)) {
        return {
          bind(...params) { stmt.bind(...params); return this; },
          async all() { const r = await stmt.all(); if (!gate.released) await gate.pass(); return r; },
          async first() { const r = await stmt.first(); if (!gate.released) await gate.pass(); return r; },
          async run() { const r = await stmt.run(); if (!gate.released) await gate.pass(); return r; },
          // drizzle select แบบมี fields ใช้ raw() (session.values) ไม่ใช่ first()
          async raw() { const r = await stmt.raw(); if (!gate.released) await gate.pass(); return r; },
        };
      }
      return stmt;
    },
    batch: (statements) => base.batch(statements),
  };
}

// ห่อ adapter ให้ batch ล้ม 1 ครั้ง (จำลอง insert application ล้มหลัง claim sequence)
function createFailBatchOnceAdapter(base) {
  let armed = true;
  return {
    prepare: (sqlText) => base.prepare(sqlText),
    async batch(statements) {
      if (armed) {
        armed = false;
        throw new Error('forced-failure: application insert down');
      }
      return base.batch(statements);
    },
  };
}

// ห่อ adapter ให้ SELECT บน round_sequences พัง (พิสูจน์ว่าไม่มี SELECT fallback)
function createBrokenSequenceSelectAdapter(base) {
  return {
    prepare(sqlText) {
      if (/from\s+"?round_sequences"?/i.test(sqlText)) {
        return {
          bind() { return this; },
          async all() { throw new Error('broken: sequence select must not be used'); },
          async first() { throw new Error('broken: sequence select must not be used'); },
          async run() { throw new Error('broken: sequence select must not be used'); },
          async raw() { throw new Error('broken: sequence select must not be used'); },
        };
      }
      return base.prepare(sqlText);
    },
    batch: (statements) => base.batch(statements),
  };
}

// จำลอง TOCTOU: duplicate check เห็นว่าไม่มีแถวซ้ำ (เหมือนแพ้แข่งเวลา)
// แต่ insert ยังชน idx_apps_round_email จริง (แบบเดียวกับ DP7)
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
  -- ── Migration 030: partial unique index ตัวจริง (safety net ของ duplicate) ──
  CREATE UNIQUE INDEX idx_apps_round_email
    ON applications (round_id, lower(email))
    WHERE status != 'CANCELED' AND deleted_at IS NULL;
  CREATE TABLE round_sequences (
    round_id TEXT PRIMARY KEY REFERENCES recruitment_rounds(id) ON DELETE CASCADE,
    current_value INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE application_attachments (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, field_id TEXT NOT NULL, file_url TEXT NOT NULL, original_filename TEXT, uploaded_at INTEGER);
  CREATE TABLE attachment_uploads (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP', uploaded_at INTEGER, application_id TEXT, original_filename TEXT, delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER);
  CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT, ip_address TEXT, created_at INTEGER);
`);

// ── Seed: template + 2 rounds ──
// round-legacy : application_pattern = NULL → Strategy A (APP-YYYY-NNNN, per-year)
// round-pattern: pattern {YEAR}-{ROUND_CODE}-{RUNNING:4} → Strategy B (per-round)
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์ม race test');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-email','TEXT','อีเมล','email',1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-1','tv-1','field-email',1,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-2','tv-1','field-fullname',2,1);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code, application_pattern)
    VALUES ('round-legacy','tv-1','รอบ legacy','ระดับต้น',1735689600,1798761600,'ACTIVE','LEG01',NULL);
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code, application_pattern)
    VALUES ('round-pattern','tv-1','รอบ pattern','ระดับต้น',1735689600,1798761600,'ACTIVE','RACE01','{YEAR}-{ROUND_CODE}-{RUNNING:4}');
`);

// ── Adapter wiring: default base, สลับได้ต่อ test ──
const baseD1 = createD1Adapter(sqlite);
let activeD1 = baseD1;

const app = new Hono();
app.route('/api/v1/public', publicRoutes);

const env = () => ({
  DB: activeD1,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000',
});

let emailSeq = 0;
const baseBody = (roundId: string) => {
  emailSeq += 1;
  return {
    roundId,
    formData: {
      'field-email': `race-${emailSeq}@test.local`,
      'field-fullname': 'ผู้สมัครสังเคราะห์',
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

const resetD1 = () => { activeD1 = baseD1; };

const seqValue = (roundId: string) =>
  sqlite.prepare('SELECT current_value AS v FROM round_sequences WHERE round_id = ?').get(roundId)?.v;

// ═══ รัน ═══ (ครอบด้วย async IIFE — repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {

// ─────── Strategy B (pattern round) ───────

await test('AN1: atomic allocation ปกติ — submit ต่อเนื่องได้เลข 0001→0002→0003 (Strategy B)', async () => {
  resetD1();
  const r1 = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r1?.data?.applicationNo, '2025-RACE01-0001', `เลขแรก: ${JSON.stringify(r1)}`);

  const r2 = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r2?.data?.applicationNo, '2025-RACE01-0002', `เลขสอง: ${JSON.stringify(r2)}`);

  const r3 = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r3?.data?.applicationNo, '2025-RACE01-0003', `เลขสาม: ${JSON.stringify(r3)}`);
});

await test('AN2: concurrent allocation — 6 request พร้อมกัน (gated) ได้เลขไม่ซ้ำและไม่มี 503 (fail-before-fix: SELECT-after-UPSERT)', async () => {
  resetD1();
  // เคลียร์ state ของ round-pattern (AN1 สร้าง 0001-0003 ไว้) ให้เริ่มนับที่ 0
  sqlite.prepare('DELETE FROM round_sequences WHERE round_id = ?').run('round-pattern');
  sqlite.prepare('DELETE FROM applications WHERE round_id = ?').run('round-pattern');
  // 6 submit เข้า claim statement เดียวกัน — gate บังคับให้ UPSERT ทั้ง 6 รัน
  // ก่อนตัวใดอ่านผล (โค้ดเก่า: SELECT-after-UPSERT อ่านค่าล่าสุดซ้ำกันทั้ง 6)
  const gate = makeGate(6);
  activeD1 = createGatedAdapter(
    baseD1,
    (s) => /INSERT INTO round_sequences/i.test(s) && /RETURNING/i.test(s),
    gate,
  );
  const posts = Array.from({ length: 6 }, () => post(baseBody('round-pattern')));
  const responses = await Promise.all(posts);
  resetD1();

  const statuses = responses.map((r) => r.status);
  const okCount = statuses.filter((s) => s === 201).length;
  assertEqual(okCount, 6, `ทุก request ต้อง 201 (ได้: ${statuses.join(',')})`);

  const numbers = [];
  for (const r of responses) numbers.push((await jsonOf(r))?.data?.applicationNo);
  const unique = new Set(numbers);
  assertEqual(unique.size, 6, `ต้องไม่มีเลขซ้ำ (ได้: ${numbers.join(',')})`);

  // ครบ 1..6 ไม่มีข้าม ไม่มีซ้ำ
  const expected = Array.from({ length: 6 }, (_, i) => `2025-RACE01-${String(i + 1).padStart(4, '0')}`);
  numbers.sort();
  assertTrue(
    expected.every((e) => numbers.includes(e)),
    `เลขต้องครบ 0001-0006 (ได้: ${numbers.join(',')})`,
  );
});

await test('AN7: first application ของ round — ไม่มี sequence row → สร้าง row current_value=1 และเลขแรกถูกต้อง', async () => {
  resetD1();
  sqlite.prepare('DELETE FROM round_sequences WHERE round_id = ?').run('round-pattern');
  sqlite.prepare('DELETE FROM applications WHERE round_id = ?').run('round-pattern');

  assertTrue(seqValue('round-pattern') === undefined, 'ต้องยังไม่มี sequence row');
  const r = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r?.data?.applicationNo, '2025-RACE01-0001', `เลขแรกของ round: ${JSON.stringify(r)}`);
  assertEqual(seqValue('round-pattern'), 1, 'sequence row ต้องถูกสร้างที่ current_value=1');
});

await test('AN8: existing sequence row — increment จากค่า DB ตรง ๆ (pre-seed 41 → 0042)', async () => {
  resetD1();
  sqlite.prepare('DELETE FROM round_sequences WHERE round_id = ?').run('round-pattern');
  sqlite.prepare('DELETE FROM applications WHERE round_id = ?').run('round-pattern');
  sqlite.prepare("INSERT INTO round_sequences (round_id, current_value) VALUES ('round-pattern', 41)").run();

  const r = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r?.data?.applicationNo, '2025-RACE01-0042', `เลขต้องต่อจาก 41: ${JSON.stringify(r)}`);
  assertEqual(seqValue('round-pattern'), 42, 'current_value ต้องเป็น 42 ใน DB');
});

await test('AN6: failed application insert — sequence เผาเป็น gap ตาม policy และเลขถัดไปไม่นำ gap กลับมาใช้', async () => {
  resetD1();
  sqlite.prepare('DELETE FROM round_sequences WHERE round_id = ?').run('round-pattern');
  sqlite.prepare('DELETE FROM applications WHERE round_id = ?').run('round-pattern');

  // ครั้งแรก: claim sequence สำเร็จแต่ batch insert ล้ม (จำลอง DB failure)
  activeD1 = createFailBatchOnceAdapter(baseD1);
  const resFail = await post(baseBody('round-pattern'));
  resetD1();
  assertEqual(resFail.status, 500, `insert ล้มต้อง 500 (ได้ ${resFail.status})`);

  // Policy: gap ถูกยอมรับ — sequence ถูกเผาไปแล้ว (claim เสร็จก่อน insert)
  assertEqual(seqValue('round-pattern'), 1, 'sequence ต้องถูกเผา (current_value=1)');

  // ใบถัดไปต้องได้ 0002 — ห้ามนำเลข 0001 กลับมาใช้ (application_no immutable)
  const r = await jsonOf(await post(baseBody('round-pattern')));
  assertEqual(r?.data?.applicationNo, '2025-RACE01-0002', `เลขถัดไปต้องข้าม gap: ${JSON.stringify(r)}`);
});

await test('AN10a: duplicate submission (Strategy B) — duplicate email → 400 ข้อความเดิม ไม่เกี่ยวกับการออกเลข', async () => {
  resetD1();
  const body1 = baseBody('round-pattern');
  body1.formData['field-email'] = 'dupe-b@test.local';
  const res1 = await post(body1);
  assertEqual(res1.status, 201, `submit แรกต้อง 201 (ได้ ${res1.status})`);

  const body2 = baseBody('round-pattern');
  body2.formData['field-email'] = 'DUPE-B@test.local'; // case ต่าง = คนเดียวกัน (030)
  const res2 = await post(body2);
  assertEqual(res2.status, 400, `duplicate ต้อง 400 (ได้ ${res2.status})`);
  const j2 = await jsonOf(res2);
  assertEqual(j2.error, 'ท่านได้สมัครรอบนี้แล้ว', `ข้อความ duplicate ต้องเดิม: ${JSON.stringify(j2)}`);
});

await test('AN10b: TOCTOU duplicate (Strategy B) — insert ชน idx_apps_round_email → 400 ไม่ใช่ 503/500', async () => {
  resetD1();
  // pre-insert แถวซ้ำโดยตรง (เสมือน submit คู่ขนานแทรกระหว่าง check กับ insert)
  // หมายเหตุ: application_no ต้องไม่ขึ้นต้น APP-2026- ไม่งั้นเปื้อน year-max ของ Strategy A
  sqlite.prepare(
    "INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status) VALUES ('pre-b','X-PREEXIST-0001','round-pattern','toctou-b@test.local','ผู้ก่อนหน้า B','{}','SUBMITTED')"
  ).run();
  // duplicate check ถูก bypass (เหมือนแพ้แข่ง) → insert ติด idx_apps_round_email
  activeD1 = createBypassDuplicateCheckAdapter(baseD1);
  const body = baseBody('round-pattern');
  body.formData['field-email'] = 'TOCTOU-B@test.local';
  const res = await post(body);
  resetD1();
  assertEqual(res.status, 400, `TOCTOU duplicate ต้อง 400 (ได้ ${res.status})`);
  const j = await jsonOf(res);
  assertEqual(j.error, 'ท่านได้สมัครรอบนี้แล้ว', `ข้อความ TOCTOU ต้องเดิม: ${JSON.stringify(j)}`);
  const n = sqlite.prepare("SELECT COUNT(*) AS n FROM applications WHERE lower(email) = 'toctou-b@test.local'").get();
  assertEqual(n.n, 1, 'ต้องยังมีแถวเดียว (insert ถูก index ปฏิเสธ)');
});

// ─────── Strategy A (legacy round, APP-YYYY-NNNN per-year) ───────

await test('AN9: legacy data — ใบเก่าไม่ถูกแตะ (byte-identical) และเลขใหม่ต่อจาก numeric max', async () => {
  resetD1();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status) VALUES ('leg-1','APP-2026-0001','round-legacy','legacy1@test.local','ผู้เก่า 1','{}','SUBMITTED')").run();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status) VALUES ('leg-2','APP-2026-0002','round-legacy','legacy2@test.local','ผู้เก่า 2','{}','SUBMITTED')").run();

  const before = sqlite.prepare("SELECT id, application_no, email, form_data FROM applications WHERE id LIKE 'leg-%' ORDER BY id").all();

  const r = await jsonOf(await post(baseBody('round-legacy')));
  assertEqual(r?.data?.applicationNo, 'APP-2026-0003', `เลขใหม่ต้องต่อจาก numeric max ของปี 2026: ${JSON.stringify(r)}`);

  const after = sqlite.prepare("SELECT id, application_no, email, form_data FROM applications WHERE id LIKE 'leg-%' ORDER BY id").all();
  assertEqual(JSON.stringify(before), JSON.stringify(after), 'แถวใบเก่าต้อง byte-identical');
});

await test('AN3: crossing 9,999 เรียงลำดับ — 9998→9999→10000→10001 format ถูกต้อง ไม่ truncate ไม่ย้อนกลับ', async () => {
  resetD1();
  // เคลียร์ใบของปี 2026 ที่ AN9 seed ไว้ แล้ว seed จนใกล้ขอบ 9,999
  sqlite.prepare("DELETE FROM applications WHERE application_no LIKE 'APP-2026-%'").run();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data) VALUES ('c-1','APP-2026-9998','round-legacy','c1@test.local','ผู้ 9998','{}')").run();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data) VALUES ('c-2','APP-2026-9999','round-legacy','c2@test.local','ผู้ 9999','{}')").run();

  const r1 = await jsonOf(await post(baseBody('round-legacy')));
  assertEqual(r1?.data?.applicationNo, 'APP-2026-10000', `ข้าม 9,999 ต้องเป็น 5 หลักเต็ม ไม่ truncate เป็น 0000: ${JSON.stringify(r1)}`);

  const r2 = await jsonOf(await post(baseBody('round-legacy')));
  assertEqual(r2?.data?.applicationNo, 'APP-2026-10001', `เลขถัดจาก 10000 ต้องเป็น 10001: ${JSON.stringify(r2)}`);
});

await test('AN4: crossing 9,999 เมื่อ APP-YYYY-10000 มีอยู่แล้ว — lexical MAX ห้ามทำให้ 503 (fail-before-fix)', async () => {
  resetD1();
  // seed state เองให้ deterministic: APP-2026-9999 + APP-2026-10000 มีอยู่จริง
  // lexical MAX = 'APP-2026-9999' (เพราะ '9' > '1') → โค้ดเก่าคำนวณ 10000 ซ้ำ
  // → ชน UNIQUE ครบ 5 retry → UNIQUE_COLLISION → 503 ถาวร
  sqlite.prepare("DELETE FROM applications WHERE application_no LIKE 'APP-2026-%'").run();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data) VALUES ('c-3','APP-2026-9999','round-legacy','c3@test.local','ผู้ 9999','{}')").run();
  sqlite.prepare("INSERT INTO applications (id, application_no, round_id, email, fullname, form_data) VALUES ('c-4','APP-2026-10000','round-legacy','c4@test.local','ผู้ 10000','{}')").run();

  const r = await jsonOf(await post(baseBody('round-legacy')));
  assertEqual(r?.data?.applicationNo, 'APP-2026-10001', `ต้องได้ 10001 จาก numeric MAX: ${JSON.stringify(r)}`);
});

await test('AN5: concurrent crossing 9,999 (gated) — ทั้งคู่ต้อง 201 ไม่มีใครติด lexical MAX (fail-before-fix)', async () => {
  resetD1();
  // state: สุดท้ายของปี 2026 คือ APP-2026-10001 (จาก AN4)
  // request 2 ตัวอ่าน MAX พร้อมกัน (gate) — โค้ดเก่าทั้งคู่เห็น lexical 9999
  // → คำนวณ 10000 ซ้ำเดิม → retry ก็ยังอ่าน 9999 → 503 ซ้ำไม่จบ
  const gate = makeGate(2);
  // match: MAX query ของ Strategy A (like บน application_no) — ทั้งโค้ดเก่า
  // (ORDER BY DESC) และโค้ดใหม่ (MAX(CAST(SUBSTR)))
  activeD1 = createGatedAdapter(
    baseD1,
    (s) => /application_no/i.test(s) && /\bLIKE\b/i.test(s),
    gate,
  );
  const posts = [post(baseBody('round-legacy')), post(baseBody('round-legacy'))];
  const [r1, r2] = await Promise.all(posts);
  resetD1();

  const j1 = await jsonOf(r1);
  const j2 = await jsonOf(r2);
  assertEqual(r1.status, 201, `#1 status=${r1.status} ${JSON.stringify(j1)}`);
  assertEqual(r2.status, 201, `#2 status=${r2.status} ${JSON.stringify(j2)}`);
  const n1 = j1?.data?.applicationNo;
  const n2 = j2?.data?.applicationNo;
  assertTrue(n1 !== n2, `เลขต้องไม่ซ้ำ (ได้ ${n1}, ${n2})`);
  const seqs = [n1, n2].map((n) => parseInt(n.split('-')[2], 10)).sort((a, b) => a - b);
  assertEqual(seqs[0], 10002, 'เลขแรกของคู่ขนาน');
  assertEqual(seqs[1], 10003, 'เลขหลังของคู่ขนาน');
});

await test('AN10c: TOCTOU duplicate (Strategy A) — insert ชน idx_apps_round_email → 400 เดิม', async () => {
  resetD1();
  sqlite.prepare(
    "INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status) VALUES ('pre-a','X-PREEXIST-0002','round-legacy','toctou-a@test.local','ผู้ก่อนหน้า A','{}','SUBMITTED')"
  ).run();
  activeD1 = createBypassDuplicateCheckAdapter(baseD1);
  const body = baseBody('round-legacy');
  body.formData['field-email'] = 'TOCTOU-A@test.local';
  const res = await post(body);
  resetD1();
  assertEqual(res.status, 400, `TOCTOU duplicate ต้อง 400 (ได้ ${res.status})`);
  const n = sqlite.prepare("SELECT COUNT(*) AS n FROM applications WHERE lower(email) = 'toctou-a@test.local'").get();
  assertEqual(n.n, 1, 'ต้องยังมีแถวเดียว (insert ถูก index ปฏิเสธ)');
});

// ─────── Service-level: result-shape regression (AN11/AN12) ───────

await test('AN11: result-shape regression — getNextRunningNumber อ่าน RETURNING ตรง ๆ (break SELECT บน round_sequences แล้วยังคืนค่าถูก)', async () => {
  resetD1();
  const gatedDb = drizzle(createBrokenSequenceSelectAdapter(baseD1));

  const r1 = await getNextRunningNumber(gatedDb, 'round-legacy');
  assertTrue(r1.ok, `claim 1 ต้องสำเร็จ: ${JSON.stringify(r1)}`);
  if (r1.ok) assertEqual(r1.running, 1, 'claim แรกจาก RETURNING');

  const r2 = await getNextRunningNumber(gatedDb, 'round-legacy');
  assertTrue(r2.ok, `claim 2 ต้องสำเร็จ: ${JSON.stringify(r2)}`);
  if (r2.ok) assertEqual(r2.running, 2, 'claim สองจาก RETURNING — ห้ามอ่านซ้ำด้วย SELECT');
});

await test('AN12: buildLegacyNumber (service) — numeric MAX ข้าม 9,999 (RC3)', async () => {
  resetD1();
  const db = drizzle(baseD1);
  // state ปัจจุบัน: APP-2026-10003 คือ numeric max (จาก AN5)
  const result = await buildApplicationNumber(db, { roundId: 'round-legacy', applicationId: 'unused-id' });
  assertTrue(result.ok, `buildLegacyNumber ต้องสำเร็จ: ${JSON.stringify(result)}`);
  if (result.ok) {
    assertEqual(result.applicationNo, 'APP-2026-10004', 'numeric MAX ต้องเห็น 10003 → ถัดไป 10004');
    assertEqual(result.snapshot.year, 2026, 'snapshot year');
  }
});

// ── สรุป ──
console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  (globalThis as any).process.exit(1);
}
})();
