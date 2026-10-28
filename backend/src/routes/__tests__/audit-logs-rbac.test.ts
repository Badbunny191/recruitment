/**
 * Audit Logs RBAC Enforcement Tests
 * ===================================
 *
 * Evidence Verification Audit (2026-10-28) พิสูจน์แล้วว่า GET /admin/audit-logs
 * ไม่มี role check ฝั่ง backend — VIEWER และ ADMIN ที่ผ่าน authMiddleware +
 * accountStateGate อ่าน audit logs ได้ครบทั้ง payload (email/IP ของผู้ใช้ระบบ)
 * ทั้งที่ frontend ซ่อนเมนูและ guard หน้าด้วย minRole SUPER_ADMIN
 * (frontend guard ไม่ใช่ security control)
 *
 * Policy ที่ enforce: GET /admin/audit-logs เข้าได้เฉพาะ SUPER_ADMIN
 * (ตรงกับ frontend: หน้า /admin/audit-logs และแถบกิจกรรมล่าสุดของ Dashboard
 * ที่เรียก endpoint นี้เมื่อ isSuperAdmin เท่านั้น)
 *
 * ครอบคลุม:
 *   1. VIEWER       → 403 (ไม่มีข้อมูล audit หลุดออกจาก body)
 *   2. ADMIN        → 403 (ไม่มีข้อมูล audit หลุดออกจาก body)
 *   3. SUPER_ADMIN  → 200 + items ครบ (regression: enforcement ไม่ทำ happy path พัง)
 *   4. ไม่มี token  → 401 (authMiddleware ยังทำงานก่อน role check)
 *
 * รัน SQL จริงบน better-sqlite3 ผ่าน D1-compatible adapter
 * (prepare/bind/all/run/raw/batch) เหมือน must-change-password.test.ts
 * และ mount adminRoutes จริง เพื่อครอบ chain ครบ:
 * authMiddleware → accountStateGate → superAdminOnlyMiddleware → handler
 *
 * Run: node --import tsx src/routes/__tests__/audit-logs-rbac.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { Hono } from 'hono';
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
  } catch (e) {
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
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// D1-compatible adapter over better-sqlite3 (in-memory)
// =============================================================================

function createD1Adapter(sqlite: Database.Database) {
  const makeStatement = (sqlText: string) => {
    const stmt = sqlite.prepare(sqlText);
    let boundParams: any[] = [];
    const api = {
      bind(...params: any[]) {
        boundParams = params;
        return api;
      },
      async all() {
        return { results: stmt.all(...boundParams) };
      },
      async first() {
        return stmt.get(...boundParams) ?? null;
      },
      async run() {
        const info = stmt.run(...boundParams);
        return {
          success: true,
          meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        };
      },
      async raw() {
        return stmt.raw(true).all(...boundParams);
      },
    };
    return api;
  };

  return {
    prepare: (sqlText: string) => makeStatement(sqlText),
    async batch(statements: any[]) {
      const results = [];
      for (const s of statements) {
        await s.run();
        results.push({ results: [], success: true, meta: { changes: 0 } });
      }
      return results;
    },
  };
}

// =============================================================================
// Test fixture — admin_users (accountStateGate) + audit_logs (drizzle select *)
// =============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-audit-logs-rbac';

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    created_at INTEGER DEFAULT (unixepoch()),
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    password_changed_at INTEGER,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    password_migrated INTEGER NOT NULL DEFAULT 0,
    last_login_at INTEGER
  );

  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({
  DB: d1,
  JWT_SECRET: TEST_JWT_SECRET,
});

function insertAdminUser(opts: { id: string; email: string; role: string }) {
  sqlite
    .prepare(
      `INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password,
        failed_login_attempts, locked_until, password_migrated)
       VALUES (?, ?, 'hash', ?, 1, 0, 0, NULL, 1)`,
    )
    .run(opts.id, opts.email, opts.role);
}

const SA_ID = 'sa-1';
const ADMIN_ID = 'admin-1';
const VIEWER_ID = 'viewer-1';

insertAdminUser({ id: SA_ID, email: 'sa@test.com', role: 'SUPER_ADMIN' });
insertAdminUser({ id: ADMIN_ID, email: 'admin@test.com', role: 'ADMIN' });
insertAdminUser({ id: VIEWER_ID, email: 'viewer@test.com', role: 'VIEWER' });

// 2 แถว audit log — entity_type ที่ resolver ไม่รู้จักเพื่อไม่ trigger join
// ตารางอื่น (scope ของ test นี้คือ RBAC ไม่ใช่ display resolution)
// created_at ต่างกันเพื่อให้ ordering (desc createdAt) deterministic
function insertAuditLog(opts: { id: string; adminId: string; action: string; secondsAgo: number }) {
  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, payload, ip_address, created_at)
       VALUES (?, ?, ?, 'TEST_ENTITY_UNKNOWN', 'test-entity-1', '{"selfChange":false}', '203.0.113.50', unixepoch() - ?)`,
    )
    .run(opts.id, opts.adminId, opts.action, opts.secondsAgo);
}

insertAuditLog({ id: 'log-1', adminId: SA_ID, action: 'LOGIN', secondsAgo: 60 });
insertAuditLog({ id: 'log-2', adminId: ADMIN_ID, action: 'UPDATE', secondsAgo: 0 });

function auditRowCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get() as any).n;
}

async function signedRequest(path: string, jwtPayload: object | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwtPayload) {
    const token = await sign(jwtPayload as any, TEST_JWT_SECRET);
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/v1/admin${path}`, { method: 'GET', headers }, env());
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function payloadFor(id: string, email: string, role: string) {
  return { id, email, role, exp: Math.floor(Date.now() / 1000) + 3600 };
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Audit Logs RBAC — GET /admin/audit-logs');
  console.log('=================================================\n');

  await test('VIEWER → 403 และ body ไม่มีข้อมูล audit หลุด', async () => {
    assertEqual(auditRowCount(), 2, 'fixture must seed 2 audit rows');
    const res = await signedRequest('/audit-logs', payloadFor(VIEWER_ID, 'viewer@test.com', 'VIEWER'));
    assertEqual(res.status, 403, 'VIEWER must be rejected');
    assertEqual(res.body.error, 'Forbidden', 'body must be the standard Forbidden error');
    assertTrue(res.body.items === undefined, 'no audit items may leak in body');
  });

  await test('ADMIN → 403 และ body ไม่มีข้อมูล audit หลุด', async () => {
    const res = await signedRequest('/audit-logs', payloadFor(ADMIN_ID, 'admin@test.com', 'ADMIN'));
    assertEqual(res.status, 403, 'ADMIN must be rejected (audit logs are SUPER_ADMIN only)');
    assertEqual(res.body.error, 'Forbidden', 'body must be the standard Forbidden error');
    assertTrue(res.body.items === undefined, 'no audit items may leak in body');
  });

  await test('SUPER_ADMIN → 200 พร้อม items ครบ (regression happy path)', async () => {
    const res = await signedRequest('/audit-logs', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    assertEqual(res.status, 200, 'SUPER_ADMIN must still be allowed');
    assertEqual(res.body.total, 2, 'both seeded audit rows must be returned');
    assertEqual(res.body.items.length, 2, 'items array must contain both rows');
    // route sort desc(createdAt) — log-2 (ใหม่กว่า) ต้องมาก่อน
    assertEqual(res.body.items[0].action, 'UPDATE', 'items must be ordered newest first');
    assertEqual(res.body.items[1].action, 'LOGIN', 'items must carry real audit data');
    assertTrue(typeof res.body.totalPages === 'number', 'pagination fields must be present');
  });

  await test('SUPER_ADMIN → 200 เมื่อมี filter query (params path เดิมไม่พัง)', async () => {
    const res = await signedRequest(
      '/audit-logs?page=1&pageSize=10&action=LOGIN&search=sa@',
      payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'),
    );
    assertEqual(res.status, 200, 'SUPER_ADMIN with filter params must still be allowed');
    assertEqual(res.body.items.length, 1, 'action=LOGIN filter must narrow to 1 row');
    assertEqual(res.body.items[0].id, 'log-1', 'filtered row must be the LOGIN log');
  });

  await test('ไม่มี token → 401 (authMiddleware ยังทำงานก่อน role check)', async () => {
    const res = await signedRequest('/audit-logs', null);
    assertEqual(res.status, 401, 'unauthenticated request must be rejected');
    assertTrue(res.body.items === undefined, 'no audit items may leak in body');
  });

  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  if (failed > 0) {
    (globalThis as any).process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Test runner failed:', e);
  (globalThis as any).process.exit(1);
});
