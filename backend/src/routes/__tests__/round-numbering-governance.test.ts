/**
 * Application Number Governance — lock policy parity
 * =======================================================================
 *
 * ปัญหาเดิม (audit 2026-11-03):
 *   ระบบมี rule ล็อก 3 ชุดที่ไม่ตรงกัน
 *     A. UI: applicationPattern === null → LegacyBanner (ล็อกถาวร)
 *     B. UI: applicationCount > 0 && status === 'ACTIVE'
 *     C. Backend: applicationCount > 0 (ไม่สน status, ตัด soft-deleted)
 *   ผลคือ "บางรอบ lock บางรอบไม่ lock" ใน setting เดียวกัน
 *
 * Business Rule ที่อนุมัติ (2026-11-03):
 *   locked = activeApplicationCount > 0
 *   - ไม่ขึ้นกับ status ของรอบ (DRAFT / ACTIVE / CLOSED ให้ผลเหมือนกัน)
 *   - legacy (application_pattern = NULL) เป็น state ไม่ใช่ lock
 *   - UI ต้องใช้ numberingPolicy จาก backend เท่านั้น
 *
 * ครอบคลุม:
 *   GV1. legacy + 0 applications → PATCH ตั้ง pattern + roundCode ได้
 *   GV2. legacy + มี applications → 409 PATTERN_LOCKED
 *   GV3. DRAFT + มี applications → 409 (เดิม UI เปิดให้แก้ แต่ backend 409)
 *   GV4. CLOSED + มี applications → 409 (เดิม UI เปิดให้แก้)
 *   GV5. ACTIVE + 0 applications → แก้ได้
 *   GV6. soft-deleted applications only → ไม่ล็อก (ตรงกับ backend เดิม)
 *   GV7. GET /rounds แนบ numberingPolicy ที่ตรงกับ rule
 *   GV8. clone-options นับเฉพาะ non-deleted (เดิมนับรวม → UI ล็อกผิด)
 *   GV9. pattern ที่มี {ROUND_CODE} แต่ไม่มี roundCode → 400
 *   GV10. legacy + 0 apps + ตั้ง pattern ที่มี {ROUND_CODE} พร้อม roundCode → 200
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 *
 * รัน: node --import tsx src/routes/__tests__/round-numbering-governance.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
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

// ── D1-compatible adapter ──
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

const TEST_JWT_SECRET = 'test-secret-numbering-governance';

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT, batch_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at INTEGER,
    descriptor_json TEXT,
    descriptor_schema_version INTEGER,
    descriptor_updated_at INTEGER,
    descriptor_updated_by TEXT,
    pdf_filename_pattern TEXT
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position_level TEXT NOT NULL,
    open_date INTEGER NOT NULL,
    close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    created_at INTEGER,
    deleted_at INTEGER,
    announcement_title TEXT,
    announcement_description TEXT,
    contact_information TEXT,
    remark TEXT,
    application_pattern TEXT,
    round_code TEXT
  );
  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT,
    round_id TEXT NOT NULL,
    email TEXT NOT NULL,
    fullname TEXT NOT NULL,
    national_id TEXT,
    status TEXT DEFAULT 'SUBMITTED',
    status_reason TEXT,
    verified_by TEXT,
    verified_at INTEGER,
    form_data TEXT NOT NULL DEFAULT '{}',
    submitted_at INTEGER,
    deleted_at INTEGER,
    year INTEGER,
    round_code TEXT,
    seq_in_round INTEGER
  );
  CREATE TABLE round_sequences (
    round_id TEXT PRIMARY KEY NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({ DB: d1, JWT_SECRET: TEST_JWT_SECRET });

const ADMIN_ID = 'admin-uuid-0001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin@test.local');

sqlite.prepare(`INSERT INTO templates (id, name) VALUES ('tpl-1', 'Template A')`).run();
sqlite
  .prepare(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES ('ver-1', 'tpl-1', 1, 'PUBLISHED')`)
  .run();

const YEAR_2026 = Date.UTC(2026, 5, 1) / 1000;

let roundSeq = 0;
function insertRound(opts = {}) {
  roundSeq++;
  const id = `round-gv-${String(roundSeq).padStart(3, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO recruitment_rounds
        (id, template_version_id, title, position_level, open_date, close_date, status, deleted_at, application_pattern, round_code)
       VALUES (?, 'ver-1', ?, 'ปฏิบัติการ', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `รอบทดสอบ ${roundSeq}`,
      YEAR_2026,
      YEAR_2026 + 30 * 86400,
      opts.status ?? 'DRAFT',
      null,
      opts.pattern === undefined ? '{YEAR}-{ROUND_CODE}-{RUNNING:4}' : opts.pattern,
      opts.code === undefined ? null : opts.code,
    );
  return id;
}

let appSeq = 0;
function insertApplication(roundId, opts = {}) {
  appSeq++;
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', '{}', ?)`
    )
    .run(
      `app-gv-${appSeq}`,
      `APP-2026-${String(appSeq).padStart(4, '0')}`,
      roundId,
      `gv${appSeq}@t.local`,
      `ผู้สมัคร ${appSeq}`,
      opts.deleted ? Math.floor(Date.now() / 1000) : null,
    );
}

function roundRow(id) {
  return sqlite.prepare('SELECT * FROM recruitment_rounds WHERE id = ?').get(id);
}

async function adminRequest(method, path, body) {
  const token = await sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env());
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runAllTests() {

await test('GV1: legacy + 0 applications → PATCH ตั้ง pattern + roundCode ได้ (legacy ≠ lock)', async () => {
  const id = insertRound({ pattern: null, code: null, status: 'ACTIVE' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
    roundCode: 'GV01A',
  });
  assertEqual(res.status, 200, 'status');
  const row = roundRow(id);
  assertEqual(row.application_pattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'pattern ถูกบันทึก');
  assertEqual(row.round_code, 'GV01A', 'roundCode ถูกบันทึก');
});

await test('GV2: legacy + มี applications → 409 PATTERN_LOCKED', async () => {
  const id = insertRound({ pattern: null, code: null, status: 'ACTIVE' });
  insertApplication(id);
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{RUNNING:4}',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'PATTERN_LOCKED');
  assertEqual(json.applicationCount, 1, 'applicationCount');
  assertEqual(roundRow(id).application_pattern, null, 'ค่าไม่เปลี่ยน');
});

await test('GV3: DRAFT + มี applications → 409 (ไม่ขึ้นกับ status)', async () => {
  const id = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV03A', status: 'DRAFT' });
  insertApplication(id);
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'PATTERN_LOCKED');
});

await test('GV4: CLOSED + มี applications → 409 (เดิม UI เปิดให้แก้)', async () => {
  const id = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV04A', status: 'CLOSED' });
  insertApplication(id);
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    roundCode: 'GV04B',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_LOCKED');
});

await test('GV5: ACTIVE + 0 applications → แก้ pattern และ roundCode ได้', async () => {
  const id = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV05A', status: 'ACTIVE' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
    roundCode: 'GV05B',
  });
  assertEqual(res.status, 200, 'status');
  const row = roundRow(id);
  assertEqual(row.application_pattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}');
  assertEqual(row.round_code, 'GV05B');
});

await test('GV6: มีแต่ soft-deleted applications → ไม่ล็อก', async () => {
  const id = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV06A', status: 'ACTIVE' });
  insertApplication(id, { deleted: true });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  });
  assertEqual(res.status, 200, 'status');
  assertEqual(roundRow(id).application_pattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}');
});

await test('GV7: GET /rounds แนบ numberingPolicy ที่ตรงกับ rule', async () => {
  const legacyFree = insertRound({ pattern: null, code: null, status: 'ACTIVE' });
  const legacyBusy = insertRound({ pattern: null, code: null, status: 'CLOSED' });
  insertApplication(legacyBusy);
  const activeFree = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV07A', status: 'ACTIVE' });

  const res = await adminRequest('GET', '/api/v1/admin/rounds?view=all');
  assertEqual(res.status, 200, 'status');
  const json = await res.json();
  const byId = new Map(json.data.map((r) => [r.id, r]));

  const a = byId.get(legacyFree).numberingPolicy;
  assertEqual(a.locked, false, 'legacy + 0 apps ต้องไม่ล็อก');
  assertEqual(a.reason, 'LEGACY_NO_PATTERN');
  assertEqual(a.isLegacy, true);
  assertEqual(a.editable.applicationPattern, true);
  assertEqual(a.editable.roundCode, true);

  const b = byId.get(legacyBusy).numberingPolicy;
  assertEqual(b.locked, true, 'legacy + มี apps ต้องล็อก (CLOSED ก็ล็อก)');
  assertEqual(b.reason, 'HAS_APPLICATIONS');
  assertEqual(b.activeApplicationCount, 1);
  assertEqual(b.editable.applicationPattern, false);

  const c = byId.get(activeFree).numberingPolicy;
  assertEqual(c.locked, false, 'มี pattern + 0 apps ต้องไม่ล็อก');
  assertEqual(c.reason, 'EDITABLE');
  assertEqual(c.isLegacy, false);
});

await test('GV8: clone-options นับเฉพาะ non-deleted (เดิมนับรวม → UI ล็อกผิด)', async () => {
  const id = insertRound({ pattern: '{YEAR}-{RUNNING:4}', code: 'GV08A', status: 'ACTIVE' });
  insertApplication(id, { deleted: true });
  insertApplication(id, { deleted: true });

  const res = await adminRequest('GET', `/api/v1/admin/rounds/${id}/clone-options`);
  assertEqual(res.status, 200, 'status');
  const json = await res.json();
  assertEqual(json.data.applicationCount, 0, 'soft-deleted ต้องไม่ถูกนับ');
  assertEqual(json.data.numberingPolicy.locked, false, 'policy ต้องไม่ล็อก');
  assertEqual(json.data.needsProtection, false);
});

await test('GV9: pattern ที่มี {ROUND_CODE} แต่ไม่มี roundCode → 400', async () => {
  const id = insertRound({ pattern: null, code: null, status: 'ACTIVE' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  });
  assertEqual(res.status, 400, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_REQUIRED_FOR_PATTERN');
  assertEqual(json.field, 'roundCode');
});

await test('GV10: legacy + 0 apps + ตั้ง pattern {ROUND_CODE} พร้อม roundCode → 200', async () => {
  const id = insertRound({ pattern: null, code: null, status: 'CLOSED' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
    roundCode: 'GV10A',
  });
  assertEqual(res.status, 200, 'status');
  const row = roundRow(id);
  assertEqual(row.application_pattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}');
  assertEqual(row.round_code, 'GV10A');
});

}

// ── Summary ─────────────────────────────────────────────────────────────

runAllTests().then(() => {
  console.log(`\n=== round-numbering-governance: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
});
