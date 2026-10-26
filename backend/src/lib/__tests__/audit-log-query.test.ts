// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Audit Log Filter/Search Regression Tests (GET /admin/audit-logs)
 * =======================================================================
 *
 * ปิด 2 บั๊กหน้า Audit Logs (fix/audit-log-filters):
 *
 *   Issue 1 — multi-select action filter ใช้งานไม่ได้: frontend ส่ง
 *     action=PDF_DOWNLOAD,EXPORT_EXCEL แต่ backend เดิมใช้ eq() กับทั้ง
 *     string → LIKE/eq จับคู่ตรง ๆ ไม่ได้เลยเมื่อเลือกหลายค่า
 *     → parseMultiParam + inArray (ค่าเดียวยังใช้ eq เหมือนเดิม)
 *     entity filter มีบั๊กเดียวกัน (frontend ส่ง comma-separated เหมือนกัน)
 *
 *   Issue 2 — ค้นหา admin ไม่เจอ: backend เดิม search ค้นเฉพาะ
 *     adminId/entityId/ipAddress — admin ใช้ UUID เป็น adminId ผู้ใช้จึง
 *     ค้นด้วยอีเมลไม่เจอ (admin_users ไม่มีคอลัมน์ displayName/name —
 *     actor display ที่ resolve ได้คือ email)
 *     → เพิ่ม subquery IN (SELECT id FROM admin_users WHERE email LIKE ...)
 *
 * Test ยิง buildAuditLogWhere กับ better-sqlite3 in-memory แล้ว run query
 * จริง — fail-when-no-fix: เคส regression หลักต้องพังกับโค้ดเดิม
 *
 * Run: node --import tsx src/lib/__tests__/audit-log-query.test.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { buildAuditLogWhere, parseMultiParam } from '../audit-log-query';

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });

  // DDL เฉพาะ 2 ตารางที่ builder ใช้ — โครงตรงตาม schema.ts/migrations
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
      admin_id TEXT NOT NULL REFERENCES admin_users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT,
      ip_address TEXT,
      created_at INTEGER
    );
    CREATE INDEX idx_audit_action ON audit_logs(action);
    CREATE INDEX idx_audit_admin_id ON audit_logs(admin_id);
  `);

  return { sqlite, db };
}

const ADMIN_A = 'admin-uuid-aaaa';
const ADMIN_B = 'admin-uuid-bbbb';
const ADMIN_C = 'admin-uuid-cccc';

function seed(db) {
  db.insert(schema.adminUsers).values([
    { id: ADMIN_A, email: 'somchai@sao.go.th', passwordHash: 'x' },
    { id: ADMIN_B, email: 'somsri@sao.go.th', passwordHash: 'x' },
    { id: ADMIN_C, email: 'root@sao.go.th', passwordHash: 'x' },
  ]).run();

  const logs = [
    { id: 'log-1', adminId: ADMIN_A, action: 'CREATE', entityType: 'RECRUITMENT_ROUND', entityId: 'round-1', ipAddress: '10.0.0.1' },
    { id: 'log-2', adminId: ADMIN_A, action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: 'app-1', ipAddress: '10.0.0.2' },
    { id: 'log-3', adminId: ADMIN_A, action: 'EXPORT_EXCEL', entityType: 'APPLICATION', entityId: 'round-1', ipAddress: '10.0.0.3' },
    { id: 'log-4', adminId: ADMIN_B, action: 'UPDATE', entityType: 'TEMPLATE', entityId: 'tpl-1', ipAddress: '10.0.0.4' },
    { id: 'log-5', adminId: ADMIN_B, action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: 'app-2', ipAddress: '10.0.0.5' },
    { id: 'log-6', adminId: ADMIN_C, action: 'DELETE', entityType: 'ADMIN_USER', entityId: ADMIN_B, ipAddress: '192.168.1.9' },
  ];
  db.insert(schema.auditLogs).values(logs).run();
}

function runQuery(db, params) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(buildAuditLogWhere(db, params))
    .orderBy(schema.auditLogs.id)
    .all();
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
const tests: Array<[string, () => Promise<void> | void]> = [];

function test(name, fn) {
  tests.push([name, fn]);
}

async function runAll() {
  for (const [name, fn] of tests) {
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
}

const assertEqual = (actual, expected, msg = '') => {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const assertSetEqual = (actual, expected, msg = '') => {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`${msg} expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
};

// ============ parseMultiParam ============

test('parseMultiParam: "A,B" → [A, B]', () => {
  assertSetEqual(parseMultiParam('PDF_DOWNLOAD,EXPORT_EXCEL'), ['PDF_DOWNLOAD', 'EXPORT_EXCEL']);
});

test('parseMultiParam: ตัดช่องว่างและค่าว่าง "A , ,B," → [A, B]', () => {
  assertSetEqual(parseMultiParam(' PDF_DOWNLOAD , , EXPORT_EXCEL ,'), ['PDF_DOWNLOAD', 'EXPORT_EXCEL']);
});

test('parseMultiParam: undefined/empty → []', () => {
  assertEqual(parseMultiParam(undefined).length, 0);
  assertEqual(parseMultiParam('').length, 0);
  assertEqual(parseMultiParam('   ').length, 0);
});

// ============ Issue 1: multi-select action ============

test('S1: action เดี่ยว — คงพฤติกรรมเดิม (eq)', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: ['PDF_DOWNLOAD'], entities: [], search: '' });
  assertSetEqual(rows.map((r) => r.id), ['log-2', 'log-5']);
});

test('S2 (regression หลัก): action หลายค่าแบบ comma-separated — เลือก 2 action ได้ครบ', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: ['PDF_DOWNLOAD', 'EXPORT_EXCEL'], entities: [], search: '' });
  assertSetEqual(rows.map((r) => r.id), ['log-2', 'log-3', 'log-5']);
});

test('S3: action หลายค่าแบบมีช่องว่าง — parseMultiParam trim แล้วจับคู่ได้', () => {
  const { db } = createTestDb();
  seed(db);
  const actions = parseMultiParam(' PDF_DOWNLOAD , EXPORT_EXCEL ');
  const rows = runQuery(db, { actions, entities: [], search: '' });
  assertSetEqual(rows.map((r) => r.id), ['log-2', 'log-3', 'log-5']);
});

test('S4: action หลายค่า + entity เดี่ยว — AND กันถูกต้อง', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: ['PDF_DOWNLOAD', 'EXPORT_EXCEL'], entities: ['APPLICATION'], search: '' });
  assertSetEqual(rows.map((r) => r.id), ['log-2', 'log-3', 'log-5']);
});

test('S5 (regression): entity หลายค่า — บั๊กเดียวกับ action ต้องหาย', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: ['RECRUITMENT_ROUND', 'APPLICATION'], search: '' });
  assertSetEqual(rows.map((r) => r.id), ['log-1', 'log-2', 'log-3', 'log-5']);
});

test('S6: action ไม่ตรงกับข้อมูล → 0 แถว (ไม่ throw)', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: ['NON_EXISTENT'], entities: [], search: '' });
  assertEqual(rows.length, 0);
});

test('S7: ไม่มี filter → ทุกแถว (where undefined)', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: '' });
  assertEqual(rows.length, 6);
});

// ============ Issue 2: search ============

test('S8 (regression หลัก): ค้นด้วยอีเมลเต็ม admin → เจอ log ของ admin นั้น', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: 'somchai@sao.go.th' });
  assertSetEqual(rows.map((r) => r.id), ['log-1', 'log-2', 'log-3']);
});

test('S9: ค้นด้วยอีเมลบางส่วน → LIKE จับคู่ได้', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: 'somsri@' });
  assertSetEqual(rows.map((r) => r.id), ['log-4', 'log-5']);
});

test('S10: ค้นด้วย adminId (UUID) — คงพฤติกรรมเดิม', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: ADMIN_B });
  assertSetEqual(rows.map((r) => r.id), ['log-4', 'log-5', 'log-6']);
});

test('S11: ค้นด้วย entityId — คงพฤติกรรมเดิม', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: 'app-1' });
  assertSetEqual(rows.map((r) => r.id), ['log-2']);
});

test('S12: ค้นด้วย ipAddress — คงพฤติกรรมเดิม', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: '192.168.1.9' });
  assertSetEqual(rows.map((r) => r.id), ['log-6']);
});

test('S13: ค้น "sao.go.th" → ครบทุก admin (ทุกอีเมล match) ไม่โดน bind limit ซ้ำซ้อน', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: 'sao.go.th' });
  assertEqual(rows.length, 6);
});

test('S14: ค้นไม่เจอทั้ง email/adminId/entityId/ip → 0 แถว (subquery ว่าง = false)', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: [], entities: [], search: 'nobody@nowhere.dev' });
  assertEqual(rows.length, 0);
});

test('S15: search + action filter ร่วมกัน — AND ถูกต้อง', () => {
  const { db } = createTestDb();
  seed(db);
  const rows = runQuery(db, { actions: ['PDF_DOWNLOAD'], entities: [], search: 'somchai@sao.go.th' });
  assertSetEqual(rows.map((r) => r.id), ['log-2']);
});

console.log('\n═══ Audit Log Filter/Search Regression ═══\n');

void runAll().then(() => {
  console.log(`\nผลรวม: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.map((f) => `  ✗ ${f}`).join('\n'));
    process.exit(1);
  }
});
