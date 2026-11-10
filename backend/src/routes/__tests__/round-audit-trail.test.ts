/**
 * Round Audit Trail — route-level regression (POST /rounds, PATCH /rounds/:id)
 * =======================================================================
 *
 * ยืนยันว่า endpoint จริง (ไม่ใช่แค่ helper) เขียน audit ถูกต้อง:
 *
 *   RA1. POST /admin/rounds → entityId = round id จริง (ไม่ใช่ 'BULK/NEW')
 *   RA2. POST /admin/rounds → payload มี roundId/title/roundCode/ช่วงเวลา
 *        (fail-when-no-fix: เดิม entityId='BULK/NEW' และ payload=NULL)
 *   RA3. POST /admin/rounds → audit row resolve ชื่อรอบได้ (entity_id ตรงกับรอบ)
 *   RA4. PATCH closeDate 16:29 → 16:31 วันเดียวกัน → audit มี diff จริง
 *        (fail-when-no-fix: เดิม toLocaleDateString ทำให้ 0 diff)
 *   RA5. PATCH วันที่เดิม (ไม่เปลี่ยน) → ไม่มี false diff
 *   RA6. PATCH ไม่ส่งวันที่ → ไม่มี diff ของวันที่
 *   RA7. PATCH เปลี่ยน title + closeDate พร้อมกัน → ได้ 2 diff ครบ
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ round-clone-numbering.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/round-audit-trail.test.ts
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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter (แบบเดียวกับ round-clone-numbering.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-round-audit';

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

const BKK = 7 * 60 * 60 * 1000;
/** เวลาไทย → unix seconds */
function bkkSec(y: number, m: number, d: number, h = 0, min = 0): number {
  return Math.floor((Date.UTC(y, m - 1, d, h, min) - BKK) / 1000);
}

async function adminRequest(method: string, path: string, body?: object) {
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

/** audit row ล่าสุดของ entity หนึ่ง */
function latestAudit(entityId: string, action?: string) {
  const sql = action
    ? `SELECT * FROM audit_logs WHERE entity_id = ? AND action = ? ORDER BY rowid DESC LIMIT 1`
    : `SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1`;
  const row = action ? sqlite.prepare(sql).get(entityId, action) : sqlite.prepare(sql).get(entityId);
  if (!row) return null;
  return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
}

/** audit row ล่าสุดของ entityType (ใช้หา CREATE ที่ entityId ผิด) */
function latestAuditByType(entityType: string) {
  const row = sqlite
    .prepare(`SELECT * FROM audit_logs WHERE entity_type = ? ORDER BY rowid DESC LIMIT 1`)
    .get(entityType);
  if (!row) return null;
  return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
}

function insertRound(opts: {
  code?: string | null;
  status?: string;
  openDate?: number;
  closeDate?: number;
  title?: string;
} = {}) {
  const id = `round-${Math.random().toString(36).slice(2, 10)}`;
  sqlite
    .prepare(
      `INSERT INTO recruitment_rounds
        (id, template_version_id, title, position_level, open_date, close_date, status, deleted_at, application_pattern, round_code)
       VALUES (?, 'ver-1', ?, 'ปฏิบัติการ', ?, ?, ?, NULL, '{YEAR}-{ROUND_CODE}-{RUNNING:4}', ?)`
    )
    .run(
      id,
      opts.title ?? 'รอบทดสอบ',
      opts.openDate ?? bkkSec(2026, 11, 1, 9, 0),
      opts.closeDate ?? bkkSec(2026, 11, 30, 16, 30),
      opts.status ?? 'ACTIVE',
      opts.code === undefined ? null : opts.code,
    );
  return id;
}

async function runAllTests() {

  // ── POST /rounds ─────────────────────────────────────────────────────
  await test('RA1 (fail-when-no-fix): POST /rounds → entityId = round id จริง ไม่ใช่ BULK/NEW', async () => {
    const res = await adminRequest('POST', '/api/v1/admin/rounds', {
      templateVersionId: 'ver-1',
      title: 'เชี่ยวชาญ 2569',
      positionLevel: 'เชี่ยวชาญ',
      openDate: bkkSec(2026, 11, 1, 9, 0),
      closeDate: bkkSec(2026, 11, 30, 16, 30),
      status: 'ACTIVE',
      roundCode: 'RA001',
    });
    assertEqual(res.status, 201, 'status');
    const json = await res.json();

    const audit = latestAudit(json.id, 'CREATE');
    assertTrue(!!audit, `ต้องมี audit row ที่ entity_id = ${json.id} (เดิมเป็น 'BULK/NEW')`);
    assertEqual(audit.entity_type, 'RECRUITMENT_ROUND', 'entity_type');
    assertTrue(audit.entity_id !== 'BULK/NEW', 'entity_id ต้องไม่ใช่ sentinel');
  });

  await test('RA2 (fail-when-no-fix): POST /rounds → payload มี roundId/title/roundCode/ช่วงเวลา', async () => {
    const res = await adminRequest('POST', '/api/v1/admin/rounds', {
      templateVersionId: 'ver-1',
      title: 'รอบ RA2',
      positionLevel: 'ทั่วไป',
      openDate: bkkSec(2026, 12, 1, 9, 0),
      closeDate: bkkSec(2026, 12, 20, 16, 30),
      status: 'DRAFT',
      roundCode: 'RA002',
    });
    assertEqual(res.status, 201, 'status');
    const json = await res.json();

    const audit = latestAudit(json.id, 'CREATE');
    assertTrue(!!audit, 'ต้องมี audit row');
    assertTrue(audit.payload !== null, `payload ต้องไม่เป็น NULL (ได้ ${JSON.stringify(audit.payload)})`);

    const p = audit.payload;
    assertEqual(p.roundId, json.id, 'roundId');
    assertEqual(p.title, 'รอบ RA2', 'title');
    assertEqual(p.roundCode, 'RA002', 'roundCode');
    assertEqual(p.positionLevel, 'ทั่วไป', 'positionLevel');
    assertEqual(p.openDate, '1 ธ.ค. 2569 09:00', 'openDate (เวลาไทย + นาที)');
    assertEqual(p.closeDate, '20 ธ.ค. 2569 16:30', 'closeDate (เวลาไทย + นาที)');
    assertEqual(p.status, 'DRAFT', 'status');
  });

  await test('RA3: POST /rounds → entity_id ตรงกับแถวใน recruitment_rounds (resolve ชื่อรอบได้)', async () => {
    const res = await adminRequest('POST', '/api/v1/admin/rounds', {
      templateVersionId: 'ver-1',
      title: 'รอบ RA3',
      positionLevel: 'ทั่วไป',
      openDate: bkkSec(2027, 1, 5, 9, 0),
      closeDate: bkkSec(2027, 1, 25, 16, 30),
      status: 'DRAFT',
      roundCode: 'RA003',
    });
    const json = await res.json();

    const audit = latestAuditByType('RECRUITMENT_ROUND');
    assertTrue(!!audit, 'ต้องมี audit row');
    const round = sqlite.prepare('SELECT id, title FROM recruitment_rounds WHERE id = ?').get(audit.entity_id);
    assertTrue(!!round, 'entity_id ต้องชี้ไปที่รอบที่มีจริง (audit-display resolver ใช้ค่านี้)');
    assertEqual(round.title, 'รอบ RA3', 'ชื่อรอบที่ resolve ได้');
    assertEqual(json.id, audit.entity_id, 'id ที่ตอบกลับต้องตรงกับ entity_id');
  });

  // ── PATCH /rounds/:id ────────────────────────────────────────────────
  await test('RA4 (fail-when-no-fix): PATCH closeDate 16:29 → 16:31 วันเดียวกัน → มี diff จริง', async () => {
    const id = insertRound({ code: 'RA004', closeDate: bkkSec(2026, 11, 30, 16, 29) });

    const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
      closeDate: bkkSec(2026, 11, 30, 16, 31),
    });
    assertEqual(res.status, 200, 'status');

    const audit = latestAudit(id, 'UPDATE');
    assertTrue(!!audit, 'ต้องมี audit row');
    assertTrue(audit.payload !== null, 'payload ต้องไม่เป็น NULL');

    const changes = audit.payload.changes ?? [];
    assertEqual(changes.length, 1, `ต้องมี diff เดียว (ได้ ${changes.length}: ${JSON.stringify(changes)})`);

    const c = changes[0];
    assertEqual(c.field, 'closeDate', 'field');
    assertEqual(c.oldValue, '30 พ.ย. 2569 16:29', 'oldValue ต้องมีนาที');
    assertEqual(c.newValue, '30 พ.ย. 2569 16:31', 'newValue ต้องมีนาที');
    assertTrue(
      audit.payload.summary.includes('16:29') && audit.payload.summary.includes('16:31'),
      `summary ต้องเห็นเวลาทั้งสองฝั่ง: ${audit.payload.summary}`,
    );
  });

  await test('RA5: PATCH วันที่เดิม (ไม่เปลี่ยน) → ไม่มี false diff', async () => {
    const close = bkkSec(2026, 11, 30, 16, 30);
    const id = insertRound({ code: 'RA005', closeDate: close });

    const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, { closeDate: close });
    assertEqual(res.status, 200, 'status');

    const audit = latestAudit(id, 'UPDATE');
    assertTrue(!!audit, 'ต้องมี audit row');
    const changes = audit.payload?.changes ?? [];
    assertEqual(changes.length, 0, `ไม่ควรมี diff (ได้ ${JSON.stringify(changes)})`);
  });

  await test('RA6: PATCH ไม่ส่งวันที่ → ไม่มี diff ของวันที่', async () => {
    const id = insertRound({ code: 'RA006', title: 'ชื่อเดิม RA6' });

    const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, { title: 'ชื่อใหม่ RA6' });
    assertEqual(res.status, 200, 'status');

    const audit = latestAudit(id, 'UPDATE');
    const changes = audit.payload?.changes ?? [];
    const dateChanges = changes.filter((c: any) => c.field === 'openDate' || c.field === 'closeDate');
    assertEqual(dateChanges.length, 0, `ห้ามมี diff ของวันที่ (ได้ ${JSON.stringify(dateChanges)})`);
    assertTrue(
      changes.some((c: any) => c.field === 'title'),
      'ต้องมี diff ของ title',
    );
  });

  await test('RA7: PATCH เปลี่ยน title + closeDate พร้อมกัน → ได้ 2 diff ครบ', async () => {
    const id = insertRound({ code: 'RA007', title: 'ชื่อเดิม', closeDate: bkkSec(2026, 11, 30, 16, 29) });

    const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${id}`, {
      title: 'ชื่อใหม่',
      closeDate: bkkSec(2026, 11, 30, 16, 31),
    });
    assertEqual(res.status, 200, 'status');

    const audit = latestAudit(id, 'UPDATE');
    const changes = audit.payload?.changes ?? [];
    assertEqual(changes.length, 2, `ต้องได้ 2 diff (ได้ ${JSON.stringify(changes.map((c: any) => c.field))})`);

    const titleChange = changes.find((c: any) => c.field === 'title');
    const dateChange = changes.find((c: any) => c.field === 'closeDate');
    assertEqual(titleChange.oldValue, 'ชื่อเดิม', 'title old');
    assertEqual(titleChange.newValue, 'ชื่อใหม่', 'title new');
    assertEqual(dateChange.oldValue, '30 พ.ย. 2569 16:29', 'closeDate old');
    assertEqual(dateChange.newValue, '30 พ.ย. 2569 16:31', 'closeDate new');
  });

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n=== Round audit trail: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILED TESTS:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
