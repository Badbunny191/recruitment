/**
 * P0 Regression: Audit Trail Hardening (fail-soft + create-user identity)
 * =======================================================================
 *
 * ที่มา: production audit (Phase — Technical Debt Revalidation)
 *
 * ── ปัญหา #1 (fail-soft audit insert) ────────────────────────────────────
 *   auditMiddleware() ทำงานแบบ:
 *       await next();            ← business operation สำเร็จแล้ว
 *       await db.insert(auditLogs)...   ← ถ้าโยน error → app.onError → 500
 *
 *   ผลกระทบ: client ได้ 500 ทั้งที่งานจริงสำเร็จ (admin เห็น "เกิดข้อผิดพลาด"
 *   แล้วกด retry → งานซ้ำ / ข้อมูลซ้ำ) — เป็น fail direction ผิด
 *
 *   ตัวอย่างที่เกิดได้จริง: audit_logs.admin_id เป็น FK → admin_users(id)
 *   ON DELETE RESTRICT → ถ้า adminId ไม่มีใน admin_users insert จะ fail
 *
 *   Pattern ที่ใช้แล้วในระบบ (ต้องให้ตรงกัน):
 *     - PDF_DOWNLOAD  (admin.routes.ts)         → try/catch แล้ว
 *     - writeExportAudit (excel-export.service.ts) → try/catch แล้ว
 *
 * ── ปัญหา #2 (create-user audit ไม่ระบุตัวตนผู้ถูกสร้าง) ────────────────
 *   POST /admin/users ไม่มี :id ใน path → entityId = 'BULK/NEW' (sentinel)
 *   → audit-display resolver ข้าม → หน้า Audit Logs แสดงแค่ "ผู้ใช้งานระบบ"
 *     + UUID ย่อ → ตอบคำถาม "ใครสร้างผู้ใช้คนนี้" ไม่ได้
 *   และไม่มี setAuditPayload เลย → payload = null (ไม่มี role, ไม่รู้ว่า
 *   ออกรหัสผ่านชั่วคราวหรือไม่)
 *
 * ครอบคลุม:
 *   AU1. audit insert ล้ม → request หลักยัง 2xx (fail-soft) + มี error log
 *   AU2. audit insert สำเร็จ → ยังเขียน audit row ตามปกติ (ไม่เสียพฤติกรรมเดิม)
 *   AU3. POST /admin/users → action = 'CREATE_USER' (ไม่ใช่ 'CREATE')
 *   AU4. POST /admin/users → payload มี targetUserId / targetEmail / role
 *   AU5. POST /admin/users → payload ไม่มี temporaryPassword (ห้ามเก็บ plaintext)
 *   AU6. POST /admin/users → ยังคงตอบ 201 + temporaryPassword ใน response (contract เดิม)
 *   AU7. POST /admin/users → ผู้ใช้ถูกสร้างจริงใน DB
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ user-update-audit.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/audit-fail-soft-and-create-user.test.ts
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

// ── D1-compatible adapter (แบบเดียวกับ user-update-audit.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-audit-fail-soft';

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

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'SUPER_ADMIN', 1)`)
  .run(SUPER_ADMIN_ID, 'superadmin@test.local');

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

async function superAdminToken() {
  return await sign(
    { id: SUPER_ADMIN_ID, email: 'superadmin@test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
}

async function createUser(body: object) {
  __resetRateLimitStoreForTests();
  const token = await superAdminToken();
  const res = await app.request(
    '/api/v1/admin/users',
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

// ────────────────────────────────────────────────────────────────────────────
//  AU1–AU2: audit insert ล้ม → request หลักต้องยังสำเร็จ (fail-soft)
// ────────────────────────────────────────────────────────────────────────────

/**
 * สร้าง adapter ที่ INSERT เข้า audit_logs จะโยน error เสมอ
 * (จำลอง FK restrict ที่ admin_id ไม่มีใน admin_users)
 * ทุก query อื่นทำงานปกติ
 */
function createAuditFailingAdapter() {
  const base = createD1Adapter(sqlite);
  return {
    prepare: (sqlText) => {
      const isAuditInsert = /INSERT INTO ["']?audit_logs/i.test(sqlText);
      const stmt = base.prepare(sqlText);
      return {
        bind(...params) { stmt.bind(...params); return this; },
        async all() { return stmt.all(); },
        async first() { return stmt.first(); },
        async raw() { return stmt.raw(); },
        async run() {
          if (isAuditInsert) {
            throw new Error('FOREIGN KEY constraint failed: audit_logs.admin_id');
          }
          return stmt.run();
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) { await s.run(); results.push({ results: [], success: true }); }
      return results;
    },
  };
}

async function runAllTests() {
  console.log('\n=== P0: Audit fail-soft + create-user audit identity ===\n');

  // ---- AU1: audit insert ล้ม → request หลักยัง 2xx ----
  await test('AU1: audit insert ล้ม → request หลักยังสำเร็จ (ไม่กลายเป็น 500)', async () => {
    // ── เตรียม env ที่ audit insert จะล้มเสมอ ──
    const failingD1 = createAuditFailingAdapter();
    const failingEnv = () => ({ DB: failingD1, JWT_SECRET: TEST_JWT_SECRET });

    // snapshot จำนวนผู้ใช้ก่อน
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;

    const token = await superAdminToken();
    const res = await app.request(
      '/api/v1/admin/users',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'cf-connecting-ip': '198.51.100.9',
        },
        body: JSON.stringify({ email: 'failsoft@test.local', role: 'ADMIN' }),
      },
      failingEnv()
    );

    const body = await res.json().catch(() => null);

    // ❌ พฤติกรรมเดิม (ก่อนแก้): 500 เพราะ audit insert โยน error
    assertEqual(res.status, 201, `ต้องได้ 201 (audit ล้มต้องไม่กระทบ request หลัก) แต่ได้ ${res.status}: ${JSON.stringify(body)}`);
    assertTrue(body?.success === true, 'response ต้องยังบอก success');

    // business operation ต้องเกิดจริง (ผู้ใช้ถูกสร้าง)
    const after = sqlite.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
    assertEqual(after, before + 1, 'ผู้ใช้ต้องถูกสร้างจริงใน DB');

    // และไม่มี audit row (เพราะ insert ล้ม) — แต่ request ไม่ล้ม
    const rows = auditRows().filter((r) => r.entity_type === 'ADMIN_USER' && r.action === 'CREATE_USER');
    assertEqual(rows.length, 0, 'ไม่ควรมี audit row (insert ล้ม)');
  });

  // ---- AU2: audit insert สำเร็จ → ยังเขียน audit row ตามปกติ ----
  await test('AU2: audit insert สำเร็จ → ยังเขียน audit row ปกติ (ไม่เสียพฤติกรรมเดิม)', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();

    const res = await createUser({ email: 'normal@test.local', role: 'VIEWER' });
    assertEqual(res.status, 201, 'HTTP status');

    const rows = auditRows().filter((r) => r.entity_type === 'ADMIN_USER');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');
    assertEqual(rows[0].admin_id, SUPER_ADMIN_ID, 'admin_id ต้องเป็น actor');
  });

  // ---- AU3: action = CREATE_USER ----
  await test("AU3: POST /admin/users → action = 'CREATE_USER' (ไม่ใช่ 'CREATE')", async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();

    const res = await createUser({ email: 'action@test.local', role: 'ADMIN' });
    assertEqual(res.status, 201, 'HTTP status');

    const rows = auditRows().filter((r) => r.entity_type === 'ADMIN_USER');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');
    assertEqual(rows[0].action, 'CREATE_USER', 'action ต้องเป็น CREATE_USER');
    assertEqual(rows[0].entity_type, 'ADMIN_USER', 'entity_type');
  });

  // ---- AU4: payload มี targetUserId / targetEmail / role ----
  await test('AU4: payload มี targetUserId / targetEmail / role', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();

    const res = await createUser({ email: 'identity@test.local', role: 'VIEWER' });
    assertEqual(res.status, 201, 'HTTP status');
    assertTrue(!!res.body?.id, 'response ต้องมี id ของผู้ใช้ใหม่');

    const rows = auditRows().filter((r) => r.entity_type === 'ADMIN_USER');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');

    const payload = parseAuditPayload(rows[0].payload);
    assertTrue(payload && typeof payload === 'object', 'payload ต้องไม่เป็น null');
    assertEqual(payload.targetUserId, res.body.id, 'targetUserId ต้องเป็น id ผู้ใช้ที่สร้าง');
    assertEqual(payload.targetEmail, 'identity@test.local', 'targetEmail');
    assertEqual(payload.role, 'VIEWER', 'role ที่ให้สิทธิ์');
    assertEqual(payload.selfChange, false, 'selfChange ต้อง false (actor ≠ target)');
    assertEqual(payload.issuedTemporaryPassword, true, 'ต้องบันทึกว่าออกรหัสผ่านชั่วคราว');
  });

  // ---- AU5: payload ห้ามมี temporaryPassword ----
  await test('AU5: payload ห้ามมี temporaryPassword (ไม่เก็บ plaintext ใน audit)', async () => {
    sqlite.prepare('DELETE FROM audit_logs').run();

    const res = await createUser({ email: 'noplaintext@test.local', role: 'ADMIN' });
    assertEqual(res.status, 201, 'HTTP status');
    assertTrue(!!res.body?.temporaryPassword, 'response ต้องคืน temporaryPassword (contract เดิม)');

    const rows = auditRows().filter((r) => r.entity_type === 'ADMIN_USER');
    const rawPayload = String(rows[0].payload ?? '');
    assertTrue(
      !rawPayload.includes(res.body.temporaryPassword),
      'payload ห้ามมี temporaryPassword ค่าจริง',
    );
    assertTrue(
      !/"temporaryPassword"\s*:/i.test(rawPayload),
      'payload ห้ามมี field ชื่อ temporaryPassword',
    );
  });

  // ---- AU6: response contract เดิมคงอยู่ ----
  await test('AU6: response ยังคง 201 + success + id + temporaryPassword + message', async () => {
    const res = await createUser({ email: 'contract@test.local', role: 'ADMIN' });
    assertEqual(res.status, 201, 'HTTP status');
    assertEqual(res.body?.success, true, 'success');
    assertTrue(typeof res.body?.id === 'string' && res.body.id.length > 0, 'id');
    assertTrue(typeof res.body?.temporaryPassword === 'string' && res.body.temporaryPassword.length > 0, 'temporaryPassword');
    assertTrue(typeof res.body?.message === 'string' && res.body.message.length > 0, 'message');
  });

  // ---- AU7: ผู้ใช้ถูกสร้างจริง + password เป็น hash ----
  await test('AU7: ผู้ใช้ถูกสร้างจริงใน DB และเก็บ password เป็น bcrypt hash', async () => {
    const res = await createUser({ email: 'dbreal@test.local', role: 'ADMIN' });
    assertEqual(res.status, 201, 'HTTP status');

    const row = sqlite
      .prepare('SELECT * FROM admin_users WHERE email = ?')
      .get('dbreal@test.local');
    assertTrue(!!row, 'ต้องมีผู้ใช้ใน DB');
    assertEqual(row.role, 'ADMIN', 'role');
    assertTrue(
      String(row.password_hash).startsWith('$2'),
      `password_hash ต้องเป็น bcrypt hash (ได้: ${String(row.password_hash).slice(0, 8)}…)`,
    );
    assertTrue(
      String(row.password_hash) !== res.body.temporaryPassword,
      'password_hash ห้ามเป็น plaintext',
    );
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
