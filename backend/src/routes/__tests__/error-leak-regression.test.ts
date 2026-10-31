/**
 * TASK 1 — Error Leak Remediation (Platform Hardening Phase 1)
 * =======================================================================
 *
 * ปัญหาเดิม (audit @main): 3 จุดใน admin.routes.ts ส่ง err.message /
 * err.cause.message กลับไปที่ client — ข้อความ error ภายใน (เช่น
 * "no such table: ..." หรือ SQL detail) อาจบอกโครงสร้าง DB ให้ผู้โจมตี
 *
 *   1. PATCH /admin/applications/:id/status  → { error: err.message,
 *      details: err.cause.message }
 *   2. POST /admin/applications/bulk-status  → รูปแบบเดียวกัน
 *   3. GET  /admin/applications/:id/pdf      → { message: err.message }
 *
 * การแก้: คง HTTP status 500 และรูปร่าง response (key error/message) ไว้
 * แต่ใส่ข้อความกลาง — รายละเอียดเต็มยังอยู่ใน server log (console.error)
 *
 * หลักฐาน fail-before-fix: แต่ละเคสใช้ fault ที่จงใจใส่ "ลายเซ็น" ลงใน
 * ข้อความ error ภายใน (เช่น trigger RAISE ข้อความ 'leak-canary-...')
 * — ถ้าโค้ดเป็นเวอร์ชันเก่า body จะมีคำนั้น (test จะ fail ทันที)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono + D1 จำลอง (better-sqlite3)
 * แบบเดียวกับ bulk-status-validation.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/error-leak-regression.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';
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

function assertFalseIncludes(haystack, needle, msg = '') {
  if (String(haystack).includes(needle)) {
    throw new Error(`${msg} response ห้ามมีข้อความภายใน "${needle}" (เกิด error leak)`);
  }
}

// ── D1-compatible adapter (แบบเดียวกับ bulk-status-validation.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-error-leak';

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
    ip_address TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT UNIQUE,
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
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({
  DB: d1,
  JWT_SECRET: TEST_JWT_SECRET,
});

const ADMIN_ID = 'admin-uuid-leak-0001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin@test.local');

let appSeq = 0;
function insertApplication() {
  appSeq++;
  const id = `app-leak-${String(appSeq).padStart(4, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status)
       VALUES (?, ?, 'round-1', ?, ?, 'SUBMITTED')`
    )
    .run(id, `APP-2567-${String(appSeq).padStart(4, '0')}`, `leak${appSeq}@test.local`, `ผู้สมัคร ${appSeq}`);
  return id;
}

function authHeaders() {
  // sign เป็น async — เรียกผ่าน request helper แทน
  return null;
}

async function request(method: string, path: string, body?: object) {
  const token = await sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  const res = await app.request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'cf-connecting-ip': '198.51.100.9',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env()
  );
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* binary */ }
  return { status: res.status, text, body: parsed };
}

/**
 * Fault injection ผ่าน SQLite trigger — SELECT ยังผ่าน (จำเป็นเพื่อไปถึง
 * catch block ใน try) แต่ UPDATE พังด้วยข้อความที่มี "ลายเซ็น" ที่ถ้าโค้ด
 * เดิมส่ง err.message กลับ client จะเห็นคำนี้ทันที (fail-before-fix)
 */
const CANARY = 'leak-canary-sqlite-internal-detail';
function armUpdateTrigger() {
  sqlite.exec(`
    CREATE TRIGGER force_update_error BEFORE UPDATE ON applications
    BEGIN
      SELECT RAISE(ABORT, '${CANARY}');
    END;
  `);
}
function disarmUpdateTrigger() {
  sqlite.exec('DROP TRIGGER IF EXISTS force_update_error');
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('TASK 1: Error Leak Remediation — Regression Tests');
  console.log('=================================================\n');

  __resetRateLimitStoreForTests();

  // ---- EL1: PATCH status พังกลางทาง → ห้ามส่ง err.message/details ----
  await test('EL1: PATCH /applications/:id/status ล้มเหลว → 500 + ข้อความกลาง ไม่มี err.message/err.cause.message', async () => {
    const id = insertApplication();
    armUpdateTrigger();
    try {
      const res = await request('PATCH', `/api/v1/admin/applications/${id}/status`, { status: 'QUALIFIED' });
      assertEqual(res.status, 500, 'HTTP status คงเดิม (500)');
      assertFalseIncludes(res.text, CANARY, 'PATCH status');
      assertFalseIncludes(res.text, 'no such table', 'PATCH status (sqlite message)');
      assertEqual(res.body?.error, 'เกิดข้อผิดพลาดในการอัปเดตสถานะ', 'body.error = ข้อความกลาง');
      assertTrue(res.body && !('details' in res.body), 'ห้ามมี key details (เดิมส่ง err.cause.message)');
      assertFalseIncludes(res.text, 'UNIQUE constraint', 'ห้ามมี SQL detail');
    } finally {
      disarmUpdateTrigger();
    }
  });

  // ---- EL2: bulk-status พังกลางทาง → ห้ามส่ง err.message/details ----
  await test('EL2: POST /applications/bulk-status ล้มเหลว → 500 + ข้อความกลาง ไม่มี err.message/err.cause.message', async () => {
    const id = insertApplication();
    armUpdateTrigger();
    try {
      const res = await request('POST', '/api/v1/admin/applications/bulk-status', { ids: [id], status: 'QUALIFIED' });
      assertEqual(res.status, 500, 'HTTP status คงเดิม (500)');
      assertFalseIncludes(res.text, CANARY, 'bulk status');
      assertFalseIncludes(res.text, 'no such table', 'bulk status (sqlite message)');
      assertEqual(res.body?.error, 'เกิดข้อผิดพลาดในการอัปเดตสถานะ', 'body.error = ข้อความกลาง');
      assertTrue(res.body && !('details' in res.body), 'ห้ามมี key details (เดิมส่ง err.cause.message)');
    } finally {
      disarmUpdateTrigger();
    }
  });

  // ---- EL3: PDF route พังกลางทาง → ห้ามส่ง err.message ใน key message ----
  await test('EL3: GET /applications/:id/pdf ล้มเหลว → 500 + { error } เท่านั้น ไม่มี message ภายใน', async () => {
    const id = insertApplication();
    // buildApplicationContext: SELECT applications ผ่าน → SELECT recruitment_rounds พัง
    sqlite.exec('DROP TABLE recruitment_rounds');
    try {
      const res = await request('GET', `/api/v1/admin/applications/${id}/pdf`);
      assertEqual(res.status, 500, 'HTTP status คงเดิม (500)');
      assertFalseIncludes(res.text, 'no such table', 'PDF (sqlite message)');
      assertFalseIncludes(res.text, 'recruitment_rounds', 'PDF (ชื่อตารางภายใน)');
      assertEqual(res.body?.error, 'Failed to generate PDF', 'body.error = ข้อความเดิม');
      assertTrue(res.body && !('message' in res.body), 'ห้ามมี key message (เดิมส่ง err.message)');
    } finally {
      sqlite.exec('CREATE TABLE recruitment_rounds (id TEXT PRIMARY KEY)');
    }
  });

  // ---- EL4: เคสสำเร็จปกติยังเดิม (แก้ไม่ทำลาย happy path) ----
  await test('EL4: PATCH status สำเร็จปกติ → 200 + response contract เดิมครบ', async () => {
    const id = insertApplication();
    const res = await request('PATCH', `/api/v1/admin/applications/${id}/status`, { status: 'QUALIFIED' });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body?.success, true, 'body.success');
    assertEqual(res.body?.data?.status, 'QUALIFIED', 'data.status');
    assertEqual(
      sqlite.prepare('SELECT status FROM applications WHERE id = ?').get(id).status,
      'QUALIFIED',
      'row updated'
    );
  });

  // ---- EL5: bulk-status สำเร็จปกติยังเดิม ----
  await test('EL5: POST bulk-status สำเร็จปกติ → 200 + response contract เดิมครบ', async () => {
    const id = insertApplication();
    const res = await request('POST', '/api/v1/admin/applications/bulk-status', { ids: [id], status: 'REJECTED', reason: 'เอกสารไม่ครบ' });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body?.success, true, 'body.success');
    assertEqual(res.body?.updated, 1, 'body.updated');
  });

  console.log('');
  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
