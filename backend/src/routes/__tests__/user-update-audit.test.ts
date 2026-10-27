/**
 * R12 (ต่อเนื่อง): PATCH /admin/users/:id — audit diff ของ email
 * =======================================================================
 *
 * ปัญหาเดิม (false negative — พบเพิ่มระหว่างทำ R12):
 *   call site ของ PATCH /admin/users/:id สร้าง newValues จาก "ค่าเดิม" ของ
 *   target แทนค่าที่ผู้ใช้ส่งมา:
 *
 *     computeChanges(
 *       { email: target.email, ... },   // old  ✓
 *       { email: target.email, ... },   // new  ✗ ควรเป็น data.email
 *       'ADMIN_USER'
 *     )
 *
 *   ผลคือเปลี่ยน email จริงแต่ audit log ไม่มี diff ของ email เลย
 *   (old กับ new เป็นค่าเดียวกัน → changes ว่าง → payload เป็น null)
 *
 * การแก้: ส่ง data.email เป็นค่าใหม่ (undefined เมื่อไม่ได้ส่ง → R12 lib
 *   skip ให้เอง) — ไม่แตะ updateValues/DB ทุกอย่าง (behavior เดิมครบ)
 *
 * ครอบคลุม:
 *   UU1.  เปลี่ยน email → audit มี diff email old→new ตรงตัว (Case 1)
 *   UU2.  PATCH email เป็นค่าเดิม → ไม่มี diff ของ email (Case 2)
 *   UU3.  partial update field อื่น (isActive) → email ไม่โผล่มั่ว (Case 3)
 *   UU4.  partial หลาย field (email + isActive) → ได้เฉพาะ 2 diff นั้น
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ bulk-status-validation.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/user-update-audit.test.ts
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

const TEST_JWT_SECRET = 'test-secret-user-update-audit';

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
    admin_id TEXT NOT NULL,
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

const SUPER_ADMIN_ID = 'superadmin-uuid-0001';
const TARGET_ID = 'target-uuid-0002';
const TARGET_OLD_EMAIL = 'old@test.local';
const TARGET_NEW_EMAIL = 'new@test.local';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'SUPER_ADMIN', 1)`)
  .run(SUPER_ADMIN_ID, 'superadmin@test.local');
sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(TARGET_ID, TARGET_OLD_EMAIL);

function auditRows(): any[] {
  return sqlite.prepare('SELECT * FROM audit_logs ORDER BY created_at, id').all();
}

// convention เดิมของระบบ: setAuditPayload รับ JSON string แล้ว drizzle
// (payload mode 'json') stringify ซ้ำ → คอลัมน์ดิบต้อง parse สองชั้น
function parseAuditPayload(raw: string | null): any {
  if (raw == null) return null;
  const once = JSON.parse(raw);
  return typeof once === 'string' ? JSON.parse(once) : once;
}

function targetRow(): any {
  return sqlite.prepare('SELECT * FROM admin_users WHERE id = ?').get(TARGET_ID);
}

// แต่ละเคสเริ่มจาก state เดิมของ target เสมอ (เคสก่อนหน้าอาจเปลี่ยน email/is_active ไป)
function resetTarget() {
  sqlite
    .prepare(`UPDATE admin_users SET email = ?, is_active = 1, role = 'ADMIN' WHERE id = ?`)
    .run(TARGET_OLD_EMAIL, TARGET_ID);
}

async function patchUser(body: object) {
  __resetRateLimitStoreForTests();
  const token = await sign(
    { id: SUPER_ADMIN_ID, email: 'superadmin@test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  const res = await app.request(
    `/api/v1/admin/users/${TARGET_ID}`,
    {
      method: 'PATCH',
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

function changesFromLastAudit(): any[] {
  const rows = auditRows();
  if (rows.length === 0) return [];
  const payload = parseAuditPayload(rows[rows.length - 1].payload);
  return payload?.changes ?? [];
}

async function runAllTests() {
  console.log('\n=== R12 (ต่อ): PATCH /admin/users/:id — email audit diff ===\n');

  // ---- UU1: Case 1 — เปลี่ยน email → มี diff ----
  await test('UU1: เปลี่ยน email → audit มี diff email old→new ตรงตัว', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();
    resetTarget();

    const res = await patchUser({ email: TARGET_NEW_EMAIL });
    assertEqual(res.status, 200, 'HTTP status');

    // DB เปลี่ยนจริง (behavior เดิมไม่กระทบ)
    assertEqual(targetRow().email, TARGET_NEW_EMAIL, 'email ใน DB ต้องเปลี่ยน');

    const rows = auditRows();
    assertEqual(rows.length, 1, 'audit row count');
    assertEqual(rows[0].action, 'UPDATE', 'action เป็น UPDATE (PATCH)');
    assertEqual(rows[0].entity_type, 'ADMIN_USER', 'entity_type');
    assertEqual(rows[0].entity_id, TARGET_ID, 'entity_id');

    const changes = changesFromLastAudit();
    const emailChange = changes.find((c) => c.field === 'email');
    assertTrue(!!emailChange, `ต้องมี diff ของ email (ได้: ${changes.map((c) => c.field).join(',') || '(ว่าง)'})`);
    assertEqual(emailChange.oldValue, TARGET_OLD_EMAIL, 'diff oldValue = email เดิม');
    assertEqual(emailChange.newValue, TARGET_NEW_EMAIL, 'diff newValue = email ใหม่ที่ผู้ใช้ส่งมา');
  });

  // ---- UU2: Case 2 — email ค่าเดิม → ไม่มี diff ----
  await test('UU2: PATCH email เป็นค่าเดิม → ไม่มี diff ของ email', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();
    resetTarget();

    const res = await patchUser({ email: TARGET_OLD_EMAIL });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(targetRow().email, TARGET_OLD_EMAIL, 'email ใน DB คงเดิม');

    const changes = changesFromLastAudit();
    assertTrue(!changes.some((c) => c.field === 'email'), `ห้ามมี diff email เมื่อค่าเดิมเป๊ะ (ได้: ${changes.map((c) => c.field).join(',') || '(ว่าง)'})`);
  });

  // ---- UU3: Case 3 — partial update field อื่น → email ไม่โผล่มั่ว ----
  await test('UU3: partial update isActive → email ไม่โผล่มามั่ว', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();
    resetTarget();

    const res = await patchUser({ isActive: false });
    assertEqual(res.status, 200, 'HTTP status');

    const changes = changesFromLastAudit();
    const fields = changes.map((c) => c.field);
    assertTrue(!fields.includes('email'), `email ห้ามโผล่เมื่อไม่ได้ส่ง (ได้: ${fields.join(',') || '(ว่าง)'})`);
    assertTrue(fields.includes('isActive'), `ต้องมี diff ของ isActive (ได้: ${fields.join(',') || '(ว่าง)'})`);
  });

  // ---- UU4: partial หลาย field → เฉพาะที่ส่งมาและเปลี่ยนจริง ----
  await test('UU4: PATCH {email, isActive} พร้อมกัน → ได้ diff เฉพาะ 2 field นั้น', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();
    resetTarget();
    sqlite.prepare(`UPDATE admin_users SET email = ?, is_active = 1 WHERE id = ?`).run(TARGET_OLD_EMAIL, TARGET_ID);

    const res = await patchUser({ email: TARGET_NEW_EMAIL, isActive: false });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(targetRow().email, TARGET_NEW_EMAIL, 'email ใน DB ต้องเปลี่ยน');

    const fields = changesFromLastAudit().map((c) => c.field).sort();
    assertEqual(JSON.stringify(fields), JSON.stringify(['email', 'isActive']), 'ต้องได้แค่ email + isActive');
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
