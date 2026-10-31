/**
 * TASK 4 — Bulk Status Hardening: MAX_BULK_IDS = 80 (Platform Hardening Phase 1)
 * =======================================================================
 *
 * ปัญหาเดิม (audit @main): kind 'ids' ของ POST /admin/applications/bulk-status
 * (ทั้ง legacy { ids } และ selector { kind: 'ids', ids }) ไม่มี cap — id > 100
 * กลายเป็น bind parameter ของ `IN (...)` ใน D1 ซึ่งจำกัด ~100 bind/statement
 * → query ล้มทั้งก้อน 500 ("too many SQL variables") และ payload ขนาดยักษ์
 * ผ่านเข้าถึงชั้น query ได้
 *
 * การแก้ (fail closed): normalizeSelectorInput รับ option maxIds — bulk-status
 * ส่ง MAX_BULK_IDS = 80 (เท่ากับ MAX_SELECTOR_EXCLUDE_IDS ที่มีอยู่แล้ว)
 * เกิน cap → 400 พร้อม message อ่านเข้าใจ นับหลัง dedupe (เกณฑ์เดียวกับ bind จริง)
 *
 * ขอบเขตที่ห้ามกระทบ (business workflow เดิม):
 *   - POST /applications/export-selected ใช้ cap ของตัวเอง (MAX_EXPORT_ROWS
 *     = 1,000) — ไม่โดน MAX_BULK_IDS
 *   - selector kind 'filter' ไม่จำกัด (resolve ใน SQL ไม่ใช่ bind ต่อ id)
 *   - excludeIds cap 80 มีอยู่แล้ว (test ครอบใน bulk-status-validation BS25)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono + D1 จำลอง (better-sqlite3)
 * แบบเดียวกับ bulk-status-validation.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/bulk-ids-cap.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';
import { normalizeSelectorInput, MAX_BULK_IDS } from '../../lib/applications-selector';

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

const TEST_JWT_SECRET = 'test-secret-bulk-ids-cap';

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
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({
  DB: d1,
  JWT_SECRET: TEST_JWT_SECRET,
});

const ADMIN_ID = 'admin-uuid-cap-0001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin@test.local');

function insertApplication(id: string) {
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status)
       VALUES (?, ?, 'round-1', ?, ?, 'SUBMITTED')`
    )
    .run(id, `APP-2567-${id}`, `${id}@test.local`, `ผู้สมัคร ${id}`);
}

function auditCount(): number {
  return sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
}

async function bulkRequest(body: object) {
  const token = await sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  const res = await app.request(
    '/api/v1/admin/applications/bulk-status',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'cf-connecting-ip': '198.51.100.9',
      },
      body: JSON.stringify(body),
    },
    env()
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

function ids(n: number, prefix = 'app'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(4, '0')}`);
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log(`TASK 4: Bulk ids cap (MAX_BULK_IDS = ${MAX_BULK_IDS}) — Tests`);
  console.log('=================================================\n');

  __resetRateLimitStoreForTests();

  // ---- BC1: legacy { ids } เกิน cap → 400 fail closed ----
  await test('BC1: legacy ids 81 รายการ (>80) → 400 + message อ่านเข้าใจ + ไม่แตะ DB + ไม่มี audit', async () => {
    const res = await bulkRequest({ ids: ids(MAX_BULK_IDS + 1), status: 'QUALIFIED' });
    assertEqual(res.status, 400, 'HTTP status (fail closed — เดิมพัง 500 ที่ >100)');
    assertEqual(res.body?.success, false, 'success=false');
    assertTrue(
      typeof res.body?.message === 'string' && res.body.message.includes('80'),
      `message ต้องบอก cap 80: ${JSON.stringify(res.body?.message)}`,
    );
    assertEqual(auditCount(), 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BC2: selector kind 'ids' เกิน cap → 400 เหมือนกัน ----
  await test('BC2: selector { kind: ids, ids: 81 } → 400 + message เดียวกัน', async () => {
    const res = await bulkRequest({
      selector: { kind: 'ids', ids: ids(MAX_BULK_IDS + 1) },
      status: 'QUALIFIED',
    });
    assertEqual(res.status, 400, 'HTTP status');
    assertEqual(res.body?.success, false, 'success=false');
    assertTrue(res.body?.message?.includes('80'), 'message บอก cap 80');
    assertEqual(auditCount(), 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BC3: ขอบบน — 80 รายการพอดี → ผ่าน ----
  await test(`BC3: ids พอดี ${MAX_BULK_IDS} รายการ → 200 + updated ครบ (ขอบบนไม่ตัดเกิน)`, async () => {
    const realIds = ids(MAX_BULK_IDS, 'real');
    for (const id of realIds) insertApplication(id);

    const res = await bulkRequest({ ids: realIds, status: 'QUALIFIED' });
    assertEqual(res.status, 200, `HTTP status ${JSON.stringify(res.body)}`);
    assertEqual(res.body?.updated, MAX_BULK_IDS, 'updated ครบทุกใบ');

    sqlite.prepare('DELETE FROM applications').run();
    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BC4: cap นับหลัง dedupe — 81 รายการที่ซ้ำกันเหลือ ≤80 → ผ่าน ----
  await test('BC4: cap นับหลัง dedupe — 90 id (มีตัวซ้ำ 11) เหลือ 79 unique → 200', async () => {
    const realIds = ids(79, 'uniq');
    for (const id of realIds) insertApplication(id);

    // 90 element แต่ unique แค่ 79 (ตัวซ้ำ 11)
    const payloadIds = [...realIds, ...ids(11, 'uniq')];
    assertEqual(new Set(payloadIds).size, 79, 'จัด fixture ให้ unique = 79');

    const res = await bulkRequest({ ids: payloadIds, status: 'QUALIFIED' });
    assertEqual(res.status, 200, `HTTP status ${JSON.stringify(res.body)}`);
    assertEqual(res.body?.updated, 79, 'updated = unique จริง');

    sqlite.prepare('DELETE FROM applications').run();
    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BC5: cap นับ unique — 81 unique ที่แทรก element ว่างมาด้วย → ยัง 400 ----
  await test('BC5: 81 unique + ค่าว่าง/ไม่ใช่ string ปน → ยัง 400 (ค่าว่างไม่ช่วยลด bind)', async () => {
    const payload = [...ids(MAX_BULK_IDS + 1), '', '   ', null, 123];
    const res = await bulkRequest({ ids: payload, status: 'QUALIFIED' });
    assertEqual(res.status, 400, 'HTTP status — นับเฉพาะ string ไม่ว่าง = 81 > 80');
    assertEqual(auditCount(), 0, 'ห้ามสร้าง audit');
  });

  // ---- BC6: export-selected ไม่โดน cap นี้ (business workflow เดิม) ----
  await test('BC6: normalizeSelectorInput ไม่ส่ง maxIds (export path) — applicationIds 81 รายการยังผ่าน', async () => {
    const result = normalizeSelectorInput(
      { applicationIds: ids(MAX_BULK_IDS + 1) },
      'applicationIds'
    );
    assertEqual(result.ok, true, 'export ไม่โดน MAX_BULK_IDS — cap ของตัวเองที่ 1,000');
  });

  // ---- BC7: filter selector ไม่โดน cap (resolve ใน SQL) ----
  await test('BC7: selector kind filter → ไม่โดน MAX_BULK_IDS (ยังทำงานเดิม)', async () => {
    for (const id of ids(3, 'flt')) insertApplication(id);

    const res = await bulkRequest({
      selector: { kind: 'filter', roundId: 'round-1', status: 'SUBMITTED' },
      status: 'QUALIFIED',
    });
    assertEqual(res.status, 200, `HTTP status ${JSON.stringify(res.body)}`);
    assertEqual(res.body?.updated, 3, 'filter อัปเดตทุกใบที่ตรง');

    sqlite.prepare('DELETE FROM applications').run();
    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BC8: ตารางยังใหญ่กว่า cap — filter 200 ใบยังอัปเดตได้ทั้งชุด ----
  await test('BC8: ใบสมัคร 200 ใบ + filter ไม่ส่ง id → อัปเดตได้ทั้งหมด (cap คุมเฉพาะ bind ต่อ id)', async () => {
    for (const id of ids(200, 'big')) insertApplication(id);

    const res = await bulkRequest({
      selector: { kind: 'filter', roundId: 'round-1', status: 'SUBMITTED' },
      status: 'QUALIFIED',
    });
    assertEqual(res.status, 200, `HTTP status ${JSON.stringify(res.body)}`);
    assertEqual(res.body?.updated, 200, 'updated = 200 (workflow เดิมครบ)');

    sqlite.prepare('DELETE FROM applications').run();
    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  console.log('');
  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
