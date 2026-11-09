/**
 * Submission Failure Evidence — Integration & Regression Test Suite
 * ================================================================
 *
 * Scope:
 *   T1. Closed Round (403): returns status 403, refCode matching ERR-XXXXXX,
 *       and writes failure row with category 'ROUND_CLOSED'.
 *   T2. Validation Error (400): missing required field returns status 400,
 *       refCode, and writes failure row with category 'VALIDATION_ERROR'.
 *   T3. Duplicate Email (400): returns 400, refCode, and writes failure row
 *       with category 'DUPLICATE_EMAIL'.
 *   T4. Instant Rollback Flag: SUBMISSION_FAILURE_LOGGING_ENABLED='false'
 *       bypasses failure logging (no rows inserted).
 *   T5. RBAC on GET /api/v1/admin/submission-failures:
 *       SUPER_ADMIN (200), ADMIN (200), VIEWER (200), Anonymous (401).
 *   T6. Retention Purge: records older than 180 days are deleted.
 *
 * Run: node --import tsx src/routes/__tests__/submission-failure-evidence.test.ts
 */

// @ts-nocheck
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../../routes/public.routes';
import { adminRoutes } from '../../routes/admin.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';
import { drizzle } from 'drizzle-orm/better-sqlite3';

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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter ──
function createD1Adapter(sqlite: any) {
  return {
    prepare: (sqlText: string) => {
      const stmt = sqlite.prepare(sqlText);
      let bound: any[] = [];
      return {
        bind(...params: any[]) { bound = params; return this; },
        async all() { return { results: stmt.all(...bound) }; },
        async first() { return stmt.get(...bound) ?? null; },
        async run() {
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        async raw() { return stmt.raw(true).all(...bound); },
      };
    },
    async batch(statements: any[]) {
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
  CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT, ip_address TEXT, batch_id TEXT, created_at INTEGER);

  CREATE UNIQUE INDEX idx_apps_round_email
    ON applications (round_id, lower(email))
    WHERE status != 'CANCELED' AND deleted_at IS NULL;

  -- ── Migration 034: application_submit_failures ──
  CREATE TABLE application_submit_failures (
    id TEXT PRIMARY KEY,
    ref_code TEXT NOT NULL,
    round_id TEXT,
    email TEXT,
    fullname TEXT,
    submission_token TEXT,
    category TEXT NOT NULL,
    reason_code TEXT,
    error_message TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    ip_address TEXT,
    cf_ray TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX idx_submit_failures_ref_code ON application_submit_failures(ref_code);
  CREATE INDEX idx_submit_failures_round_email ON application_submit_failures(round_id, email, created_at DESC);
  CREATE INDEX idx_submit_failures_created_at ON application_submit_failures(created_at);
`);

// ── Seed ──
sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์มรับสมัคร');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-email','TEXT','อีเมล','email',1);
  INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key, is_active)
    VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-1','tv-1','field-email',1,1);
  INSERT INTO template_fields (id, template_version_id, field_id, display_order, is_required)
    VALUES ('tf-2','tv-1','field-fullname',2,1);

  -- Open round
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-open','tv-1','รอบเปิดรับสมัคร','ระดับต้น',1735603200,1798761600,'ACTIVE','OPEN01');

  -- Closed round
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-closed','tv-1','รอบที่ปิดแล้ว','ระดับต้น',1600000000,1600001000,'ACTIVE','CLOSED01');

  -- Admin users
  INSERT INTO admin_users VALUES ('u-sa', 'sa@test.com', 'hash', 'SUPER_ADMIN', 1, 0);
  INSERT INTO admin_users VALUES ('u-admin', 'admin@test.com', 'hash', 'ADMIN', 1, 0);
  INSERT INTO admin_users VALUES ('u-viewer', 'viewer@test.com', 'hash', 'VIEWER', 1, 0);
`);

const app = new Hono();
app.route('/api/v1/public', publicRoutes);
app.route('/api/v1/admin', adminRoutes);

const d1 = createD1Adapter(sqlite);
const makeEnv = (overrides = {}) => ({
  DB: d1,
  JWT_SECRET: 'test-secret-sfe',
  RATE_LIMIT_PER_MINUTE: '1000',
  TURNSTILE_ENABLED: 'false',
  ...overrides,
});

async function main() {
  console.log('\n=== Test Suite: Submission Failure Evidence ===\n');

  // T1: Closed Round rejection captures failure with refCode
  await test('T1. Closed Round (403) returns refCode and records failure row', async () => {
    __resetRateLimitStoreForTests();
    const payload = {
      roundId: 'round-closed',
      formData: {
        'field-email': 'closed.applicant@test.com',
        'field-fullname': 'สมชาย เกินเวลา',
      },
      submissionToken: 'tok-closed-1',
    };

    const res = await app.request('/api/v1/public/applications/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '1.2.3.4',
        'cf-ray': 'ray-closed-123',
        'user-agent': 'Mozilla/5.0 Test',
      },
      body: JSON.stringify(payload),
    }, makeEnv());

    assertEqual(res.status, 403, 'status must be 403');
    const json = await res.json();
    assertTrue(typeof json.refCode === 'string' && /^ERR-[2-9A-HJ-NP-Z]{6}$/.test(json.refCode), `refCode format valid: ${json.refCode}`);

    const row = sqlite.prepare('SELECT * FROM application_submit_failures WHERE ref_code = ?').get(json.refCode);
    assertTrue(row, 'failure row must be stored in DB');
    assertEqual(row.category, 'ROUND_CLOSED', 'category matches');
    assertEqual(row.email, 'closed.applicant@test.com', 'email matches');
    assertEqual(row.fullname, 'สมชาย เกินเวลา', 'fullname matches');
    assertEqual(row.submission_token, 'tok-closed-1', 'token matches');
    assertEqual(row.http_status, 403, 'http status matches');
    assertEqual(row.ip_address, '1.2.3.4', 'ip matches');
    assertEqual(row.cf_ray, 'ray-closed-123', 'ray matches');
  });

  // T2: Validation error (missing required field) captures failure
  await test('T2. Validation Error (400) captures failure with VALIDATION_ERROR', async () => {
    __resetRateLimitStoreForTests();
    const payload = {
      roundId: 'round-open',
      formData: {
        'field-email': 'valid.email@test.com',
        // 'field-fullname' is required but omitted
      },
      submissionToken: 'tok-val-1',
    };

    const res = await app.request('/api/v1/public/applications/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '2.3.4.5',
      },
      body: JSON.stringify(payload),
    }, makeEnv());

    assertEqual(res.status, 400, 'status must be 400');
    const json = await res.json();
    assertTrue(typeof json.refCode === 'string' && /^ERR-[2-9A-HJ-NP-Z]{6}$/.test(json.refCode), 'refCode returned');

    const row = sqlite.prepare('SELECT * FROM application_submit_failures WHERE ref_code = ?').get(json.refCode);
    assertTrue(row, 'failure row must exist');
    assertEqual(row.category, 'VALIDATION_ERROR');
    assertEqual(row.email, 'valid.email@test.com');
  });

  // T3: Duplicate email captures DUPLICATE_EMAIL
  await test('T3. Duplicate Email (400) captures failure with DUPLICATE_EMAIL', async () => {
    __resetRateLimitStoreForTests();
    const email = 'duplicate.test@domain.com';
    // Seed first application
    sqlite.prepare(`
      INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, submitted_at)
      VALUES ('app-existing', 'APP-2026-0001', 'round-open', ?, 'คนเดิม', '{}', 1735603300)
    `).run(email);

    const payload = {
      roundId: 'round-open',
      formData: {
        'field-email': email,
        'field-fullname': 'คนเดิม พยายามส่งซ้ำ',
      },
      submissionToken: 'tok-dup-1',
    };

    const res = await app.request('/api/v1/public/applications/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, makeEnv());

    assertEqual(res.status, 400, 'status must be 400');
    const json = await res.json();
    assertTrue(json.refCode, 'refCode returned on duplicate');

    const row = sqlite.prepare('SELECT * FROM application_submit_failures WHERE ref_code = ?').get(json.refCode);
    assertTrue(row, 'failure row stored');
    assertEqual(row.category, 'DUPLICATE_EMAIL');
    assertEqual(row.email, email);
  });

  // T4: Rollback toggle bypasses logging
  await test('T4. Rollback Toggle SUBMISSION_FAILURE_LOGGING_ENABLED=false stops logging', async () => {
    __resetRateLimitStoreForTests();
    const beforeCount = sqlite.prepare('SELECT COUNT(*) as c FROM application_submit_failures').get().c;

    const payload = {
      roundId: 'round-closed',
      formData: {
        'field-email': 'toggle.off@test.com',
        'field-fullname': 'ทดสอบปิดระบบ',
      },
    };

    const res = await app.request('/api/v1/public/applications/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, makeEnv({ SUBMISSION_FAILURE_LOGGING_ENABLED: 'false' }));

    assertEqual(res.status, 403);
    const afterCount = sqlite.prepare('SELECT COUNT(*) as c FROM application_submit_failures').get().c;
    assertEqual(afterCount, beforeCount, 'no new row should be inserted when toggle is false');
  });

  // T5: RBAC for GET /api/v1/admin/submission-failures
  await test('T5. RBAC: SUPER_ADMIN, ADMIN, VIEWER can query; unauthenticated 401', async () => {
    // Generate test JWT tokens
    const { sign } = await import('hono/jwt');
    const secret = 'test-secret-sfe';
    const makeToken = (userId: string, role: string) => sign({ id: userId, email: `${role.toLowerCase()}@test.com`, role }, secret);

    const saToken = await makeToken('u-sa', 'SUPER_ADMIN');
    const adminToken = await makeToken('u-admin', 'ADMIN');
    const viewerToken = await makeToken('u-viewer', 'VIEWER');

    // 1) Unauthenticated -> 401
    const unauth = await app.request('/api/v1/admin/submission-failures', { method: 'GET' }, makeEnv());
    assertEqual(unauth.status, 401, 'unauth -> 401');

    // 2) SUPER_ADMIN -> 200
    const saRes = await app.request('/api/v1/admin/submission-failures', {
      method: 'GET',
      headers: { authorization: `Bearer ${saToken}` },
    }, makeEnv());
    assertEqual(saRes.status, 200, 'SUPER_ADMIN -> 200');

    // 3) ADMIN -> 200
    const adminRes = await app.request('/api/v1/admin/submission-failures', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    }, makeEnv());
    assertEqual(adminRes.status, 200, 'ADMIN -> 200');

    // 4) VIEWER -> 200
    const viewerRes = await app.request('/api/v1/admin/submission-failures', {
      method: 'GET',
      headers: { authorization: `Bearer ${viewerToken}` },
    }, makeEnv());
    assertEqual(viewerRes.status, 200, 'VIEWER -> 200');
  });

  // T6: Retention cleanup (180 days)
  await test('T6. Retention Purge: records > 180 days are purged, recent retained', async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const oldTime = now - (181 * dayMs);
    const recentTime = now - (10 * dayMs);

    sqlite.prepare(`
      INSERT INTO application_submit_failures (id, ref_code, category, error_message, http_status, created_at)
      VALUES ('fail-old', 'ERR-OLD123', 'SYSTEM_ERROR', 'old error', 500, ?)
    `).run(oldTime);

    sqlite.prepare(`
      INSERT INTO application_submit_failures (id, ref_code, category, error_message, http_status, created_at)
      VALUES ('fail-recent', 'ERR-NEW123', 'SYSTEM_ERROR', 'recent error', 500, ?)
    `).run(recentTime);

    const { purgeOldSubmitFailures } = await import('../../services/submit-failure.service');
    const deletedCount = await purgeOldSubmitFailures(d1, 180);
    assertTrue(deletedCount >= 1, 'at least 1 old record purged');

    const oldRow = sqlite.prepare('SELECT * FROM application_submit_failures WHERE id = ?').get('fail-old');
    const recentRow = sqlite.prepare('SELECT * FROM application_submit_failures WHERE id = ?').get('fail-recent');

    assertEqual(oldRow, undefined, 'old record must be purged');
    assertTrue(recentRow, 'recent record must remain');
  });

  // T7: GET /api/v1/admin/submission-failures returns human-readable round information (roundCode, roundTitle)
  await test('T7. GET /api/v1/admin/submission-failures returns roundCode and roundTitle', async () => {
    const { sign } = await import('hono/jwt');
    const secret = 'test-secret-sfe';
    const adminToken = await sign({ id: 'u-admin', email: 'admin@test.com', role: 'ADMIN' }, secret);

    const res = await app.request('/api/v1/admin/submission-failures?pageSize=50', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    }, makeEnv());

    assertEqual(res.status, 200, 'status 200');
    const json = await res.json();
    assertTrue(json.success, 'response success');
    assertTrue(Array.isArray(json.data), 'data is array');

    // Find row from T1 (round-closed) and T2 (round-open)
    const closedRow = json.data.find((r: any) => r.roundId === 'round-closed');
    assertTrue(closedRow, 'closed round failure found');
    assertEqual(closedRow.roundCode, 'CLOSED01', 'roundCode matches');
    assertEqual(closedRow.roundTitle, 'รอบที่ปิดแล้ว', 'roundTitle matches');

    const openRow = json.data.find((r: any) => r.roundId === 'round-open');
    assertTrue(openRow, 'open round failure found');
    assertEqual(openRow.roundCode, 'OPEN01', 'roundCode matches');
    assertEqual(openRow.roundTitle, 'รอบเปิดรับสมัคร', 'roundTitle matches');
  });

  // T8: GET /api/v1/admin/rounds/:id returns single round by ID
  await test('T8. GET /api/v1/admin/rounds/:id returns round information or 404', async () => {
    const { sign } = await import('hono/jwt');
    const secret = 'test-secret-sfe';
    const adminToken = await sign({ id: 'u-admin', email: 'admin@test.com', role: 'ADMIN' }, secret);

    // Existing round
    const resFound = await app.request('/api/v1/admin/rounds/round-open', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    }, makeEnv());
    assertEqual(resFound.status, 200, 'found round -> 200');
    const jsonFound = await resFound.json();
    assertEqual(jsonFound.data.id, 'round-open');
    assertEqual(jsonFound.data.roundCode, 'OPEN01');
    assertEqual(jsonFound.data.title, 'รอบเปิดรับสมัคร');

    // Non-existent round
    const resNotFound = await app.request('/api/v1/admin/rounds/non-existent-uuid', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    }, makeEnv());
    assertEqual(resNotFound.status, 404, 'non-existent -> 404');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.error('Failed tests:\n' + failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
