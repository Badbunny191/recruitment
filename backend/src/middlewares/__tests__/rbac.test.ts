/**
 * RBAC v1 Integration Tests (Phase 3 P1)
 * รัน: node --import tsx src/middlewares/__tests__/rbac.test.ts
 *
 * Scope:
 *   - adminOnlyMiddleware: 403 for VIEWER, pass for SUPER_ADMIN / ADMIN
 *   - superAdminOnlyMiddleware: 403 for ADMIN/VIEWER, pass for SUPER_ADMIN
 *   - ensureNotLastSuperAdmin: blocks last-SUPER_ADMIN mutations
 *       (1 SA demote/disable rejected; 2 SA demote/disable allowed)
 *
 * The middleware tests use Hono's app.fetch with a stubbed c.env.
 * The ensureNotLastSuperAdmin tests use a real Drizzle instance backed
 * by an in-memory better-sqlite3 database, injected through the
 * service's `__setDrizzleForTests` seam. This keeps the SQL path
 * exercised end-to-end without needing a live D1 / Cloudflare Worker.
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import { authMiddleware, adminOnlyMiddleware, superAdminOnlyMiddleware } from '../auth.middleware';
import {
  ensureNotLastSuperAdmin,
  __setDrizzleForTests,
} from '../../services/rbac.service';
import { sign } from 'hono/jwt';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';

const SECRET = 'test-secret';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`✗ ${name}: ${e?.message ?? e}`);
    });
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

async function makeToken(role, id = 'user-1', email = 'u@test.com') {
  return sign({ id, email, role, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

async function fetchWithEnvUrl(app, url, init) {
  return app.fetch(new Request(`http://x${url}`, init), { JWT_SECRET: SECRET });
}

// =============================================================================
// Real Drizzle-on-better-sqlite3 harness for ensureNotLastSuperAdmin
// =============================================================================
//
// The service's seam `__setDrizzleForTests` accepts a factory. The factory
// receives an env-shaped object; we ignore it and return our own Drizzle
// instance bound to an in-memory SQLite database. This means the SQL
// path inside the service runs end-to-end (eq/and/ne/count) against real
// SQL — no predicate-shape parsing needed.

function makeInMemoryDrizzle() {
  const sqlite = new Database(':memory:');
  // Mirror the production admin_users schema. We only need the columns
  // the service actually queries: id, role, isActive.
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at INTEGER,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      password_migrated INTEGER NOT NULL DEFAULT 0
    );
  `);
  const db = drizzle(sqlite);
  return { db, sqlite };
}

function insertAdminUser(db: any, row: {
  id: string;
  email?: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
  isActive: boolean;
}) {
  db.run(
    sql`INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password, failed_login_attempts, password_migrated)
        VALUES (${row.id}, ${row.email ?? row.id + '@x'}, 'hash', ${row.role}, ${row.isActive ? 1 : 0}, 0, 0, 1)`,
  );
}

/**
 * Wraps a single ensureNotLastSuperAdmin call with a fresh in-memory
 * Drizzle instance seeded with the given users. The factory ignores
 * `env.DB` and returns our pre-built drizzle.
 */
async function withDrizzle<T>(
  users: Array<{ id: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER'; isActive: boolean }>,
  fn: () => Promise<T>,
): Promise<T> {
  const harness = makeInMemoryDrizzle();
  for (const u of users) insertAdminUser(harness.db, u);
  __setDrizzleForTests(() => harness.db);
  try {
    return await fn();
  } finally {
    __setDrizzleForTests(null);
    harness.sqlite.close();
  }
}

async function runAllTests() {
  // =============================================================================
  // adminOnlyMiddleware
  // =============================================================================
  console.log('\n=== adminOnlyMiddleware ===\n');

  await test('VIEWER is rejected with 403 on write', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/test', adminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('VIEWER');
    const res = await fetchWithEnvUrl(app, '/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 403, 'expected 403 for VIEWER');
  });

  await test('ADMIN is allowed to write (200)', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/test', adminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('ADMIN');
    const res = await fetchWithEnvUrl(app, '/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 200, 'expected 200 for ADMIN');
  });

  await test('SUPER_ADMIN is allowed to write (200)', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/test', adminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('SUPER_ADMIN');
    const res = await fetchWithEnvUrl(app, '/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 200, 'expected 200 for SUPER_ADMIN');
  });

  await test('Missing token returns 401 (authMiddleware runs first)', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/test', adminOnlyMiddleware, (c) => c.json({ ok: true }));
    const res = await fetchWithEnvUrl(app, '/test', { method: 'POST' });
    assertEqual(res.status, 401, 'expected 401 for missing token');
  });

  // =============================================================================
  // superAdminOnlyMiddleware
  // =============================================================================
  console.log('\n=== superAdminOnlyMiddleware ===\n');

  await test('VIEWER is rejected with 403', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/users', superAdminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('VIEWER');
    const res = await fetchWithEnvUrl(app, '/users', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 403, 'expected 403 for VIEWER');
  });

  await test('ADMIN is rejected with 403', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/users', superAdminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('ADMIN');
    const res = await fetchWithEnvUrl(app, '/users', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 403, 'expected 403 for ADMIN');
  });

  await test('SUPER_ADMIN is allowed (200)', async () => {
    const app = new Hono();
    app.use('*', authMiddleware);
    app.post('/users', superAdminOnlyMiddleware, (c) => c.json({ ok: true }));
    const token = await makeToken('SUPER_ADMIN');
    const res = await fetchWithEnvUrl(app, '/users', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assertEqual(res.status, 200, 'expected 200 for SUPER_ADMIN');
  });

  // =============================================================================
  // ensureNotLastSuperAdmin — post-change active SUPER_ADMIN count
  // =============================================================================
  console.log('\n=== ensureNotLastSuperAdmin (post-change count) ===\n');

  // 1) ONE active SUPER_ADMIN -> demote => reject
  await test('1 SA -> demote => reject (ok:false, LAST_SUPER_ADMIN)', async () => {
    await withDrizzle(
      [{ id: 'sa-1', role: 'SUPER_ADMIN', isActive: true }],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'sa-1',
          'ADMIN', // post-change role
          true,
        );
        assertTrue(result.ok === false, 'expected ok:false');
        assertEqual(result.reason, 'LAST_SUPER_ADMIN', 'expected LAST_SUPER_ADMIN reason');
      },
    );
  });

  // 2) ONE active SUPER_ADMIN -> disable => reject
  await test('1 SA -> disable => reject (ok:false, LAST_SUPER_ADMIN)', async () => {
    await withDrizzle(
      [{ id: 'sa-1', role: 'SUPER_ADMIN', isActive: true }],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'sa-1',
          'SUPER_ADMIN',
          false, // post-change isActive = false
        );
        assertTrue(result.ok === false, 'expected ok:false');
        assertEqual(result.reason, 'LAST_SUPER_ADMIN', 'expected LAST_SUPER_ADMIN reason');
      },
    );
  });

  // 3) TWO active SUPER_ADMINs -> demote one => allow
  await test('2 SA -> demote one => allow (ok:true, remaining=1)', async () => {
    await withDrizzle(
      [
        { id: 'sa-1', role: 'SUPER_ADMIN', isActive: true },
        { id: 'sa-2', role: 'SUPER_ADMIN', isActive: true },
      ],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'sa-1',
          'ADMIN', // demote sa-1
          true,
        );
        assertTrue(result.ok === true, 'expected ok:true when one SA remains active');
        assertEqual(result.remainingActiveSuperAdminCount, 1, 'expected 1 remaining active SA');
      },
    );
  });

  // 4) TWO active SUPER_ADMINs -> disable one => allow
  await test('2 SA -> disable one => allow (ok:true, remaining=1)', async () => {
    await withDrizzle(
      [
        { id: 'sa-1', role: 'SUPER_ADMIN', isActive: true },
        { id: 'sa-2', role: 'SUPER_ADMIN', isActive: true },
      ],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'sa-1',
          'SUPER_ADMIN',
          false, // disable sa-1
        );
        assertTrue(result.ok === true, 'expected ok:true when one SA remains active');
        assertEqual(result.remainingActiveSuperAdminCount, 1, 'expected 1 remaining active SA');
      },
    );
  });

  // Bonus: target is currently inactive SA — enabling them adds to active count.
  await test('Inactive SA -> enabling them does not reject (remaining=2)', async () => {
    await withDrizzle(
      [
        { id: 'sa-1', role: 'SUPER_ADMIN', isActive: true },
        { id: 'sa-2', role: 'SUPER_ADMIN', isActive: false },
      ],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'sa-2',
          'SUPER_ADMIN',
          true,
        );
        assertTrue(result.ok === true, 'expected ok:true');
        assertEqual(result.remainingActiveSuperAdminCount, 2, 'expected 2 remaining active SA');
      },
    );
  });

  // Bonus: non-existent target user -> ok:true (no-op)
  await test('Unknown target user -> ok:true', async () => {
    await withDrizzle(
      [{ id: 'sa-1', role: 'SUPER_ADMIN', isActive: true }],
      async () => {
        const result = await ensureNotLastSuperAdmin(
          { DB: {}, R2_BUCKET: undefined, JWT_SECRET: SECRET } as any,
          'does-not-exist',
          'ADMIN',
          true,
        );
        assertTrue(result.ok === true, 'expected ok:true for missing target');
      },
    );
  });
}

runAllTests()
  .then(() => {
    // =============================================================================
    // Summary
    // =============================================================================
    console.log('\n=== Summary ===\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    if (failed > 0) {
      (globalThis as any).process.exit(1);
    }
  })
  .catch((e) => {
    console.error('Test runner failed:', e);
    (globalThis as any).process.exit(1);
  });
