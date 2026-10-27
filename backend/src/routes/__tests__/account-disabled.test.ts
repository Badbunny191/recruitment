/**
 * R9.1 Regression Tests — Account Disable Enforcement
 * =====================================================
 *
 * ก่อนหน้านี้ authMiddleware ตรวจแค่ลายเซ็น + อายุ JWT — admin ปิดบัญชี
 * (isActive=false) แล้ว JWT เดิมที่ยังไม่หมดอายุ (อายุ 8 ชั่วโมง) ยังใช้
 * ระบบได้ต่อจนหมดอายุ token ขัดกับความคาดหวัง "ปิดบัญชีแล้วต้องใช้ไม่ได้ทันที"
 *
 * test นี้ยืนยันพฤติกรรมใหม่ (gate เดียวกับ R9 — ตรวจจาก DB ทุก request):
 *   A. Case 1 — isActive=true → ใช้งานได้ปกติ
 *   B. Case 2 — isActive=false → 403 ACCOUNT_DISABLED (read/write/allowlist)
 *   C. Case 3 — disable หลัง login (ผ่าน route จริง) → request ถัดไปถูกบล็อก
 *      + re-enable แล้วใช้ได้ใหม่
 *   D. Case 4 — isActive=false + mustChangePassword=true → ACCOUNT_DISABLED
 *      มาก่อน (disable ชนะทุก path รวม allowlist)
 *   E. Case 6 — JWT เก่าอายุยาว (ยังไม่หมอด) ของบัญชีที่ถูกปิด → ใช้ไม่ได้
 *   F. Case 6 เสริม — audit การ disable ถูกบันทึก (actor/target/reason)
 *   G. edge — JWT ของ user ที่ไม่มีใน DB → ปล่อยผ่าน gate, handler 404
 *
 * Run: node --import tsx src/routes/__tests__/account-disabled.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';
import { hashPassword } from '../../services/auth.service';

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
// Test fixture
// =============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-r91';
const PASSWORD = 'TestP@ssw0rd!91';

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
  CREATE INDEX idx_admin_users_role_active ON admin_users(role, is_active);

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

  CREATE TABLE field_master (
    id TEXT PRIMARY KEY,
    field_type TEXT NOT NULL CHECK (field_type IN ('TEXT', 'TEXTAREA', 'DROPDOWN', 'RADIO', 'FILE', 'NUMBER', 'CHECKBOX', 'DATE', 'MASTER_DATA')),
    label_th TEXT NOT NULL,
    default_options TEXT,
    pdf_mapping_key TEXT,
    is_active INTEGER DEFAULT 1,
    help_text TEXT,
    placeholder TEXT,
    section TEXT,
    file_config TEXT,
    validation_type TEXT,
    validation_message TEXT,
    allow_other INTEGER DEFAULT 0
  );

  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({
  DB: d1,
  JWT_SECRET: TEST_JWT_SECRET,
});

async function insertUser(opts: {
  email: string;
  password?: string;
  role?: string;
  isActive?: number;
  mustChangePassword?: number;
}) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password,
        failed_login_attempts, locked_until, password_migrated)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1)`,
    )
    .run(
      id,
      opts.email,
      await hashPassword(opts.password ?? PASSWORD),
      opts.role ?? 'ADMIN',
      opts.isActive ?? 1,
      opts.mustChangePassword ?? 0,
    );
  return id;
}

function rowById(id: string): any {
  return sqlite.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
}

function parseAuditPayload(raw: any): any {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    value = JSON.parse(value);
  }
  return value;
}

async function request(
  method: string,
  path: string,
  jwtPayload: object | null,
  body?: object,
  ip = '203.0.113.41',
  exp?: number,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-connecting-ip': ip,
  };
  if (jwtPayload) {
    const claims: any = { ...jwtPayload };
    if (exp !== undefined) claims.exp = exp;
    headers.Authorization = `Bearer ${await sign(claims, TEST_JWT_SECRET)}`;
  }
  const res = await app.request(
    `/api/v1/admin${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(email: string, password: string, ip = '203.0.113.42') {
  return request(
    'POST',
    '/auth/login',
    null,
    { email, password },
    ip,
  );
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('R9.1: Account Disable Enforcement — Tests');
  console.log('=================================================\n');

  // ---- A: Case 1 — isActive=true ใช้งานได้ปกติ ----
  await test('A1: Case 1 — isActive=true → GET /fields 200', async () => {
    const id = await insertUser({ email: 'a1@sao-test.local' });
    const { status, body } = await request('GET', '/fields', { id, email: 'a1@sao-test.local', role: 'ADMIN' });
    assertEqual(status, 200, 'A1 status');
    assertEqual(body.code, undefined, 'A1 ไม่มี error code');
  });

  // ---- B: Case 2 — isActive=false → 403 ACCOUNT_DISABLED ----
  await test('B1: Case 2 — isActive=false → GET /fields 403 + code ACCOUNT_DISABLED', async () => {
    const id = await insertUser({ email: 'b1@sao-test.local', isActive: 0 });
    const { status, body } = await request('GET', '/fields', { id, email: 'b1@sao-test.local', role: 'ADMIN' });
    assertEqual(status, 403, 'B1 status');
    assertEqual(body.success, false, 'B1 success=false');
    assertEqual(body.code, 'ACCOUNT_DISABLED', 'B1 code');
    assertEqual(body.message, 'Account disabled', 'B1 message ตามสเปค');
  });

  await test('B2: Case 2 — disabled → write endpoint (POST /organizations) ถูกบล็อกด้วย', async () => {
    const id = await insertUser({ email: 'b2@sao-test.local', role: 'SUPER_ADMIN', isActive: 0 });
    const { status, body } = await request(
      'POST',
      '/organizations',
      { id, email: 'b2@sao-test.local', role: 'SUPER_ADMIN' },
      { name: 'กองบัญชีปิด', isActive: true },
    );
    assertEqual(status, 403, 'B2 status');
    assertEqual(body.code, 'ACCOUNT_DISABLED', 'B2 code');
  });

  await test('B3: Case 2 — disabled → allowlist ของ mustChangePassword ถูกบล็อกทั้งหมด', async () => {
    const id = await insertUser({ email: 'b3@sao-test.local', isActive: 0 });
    const me = await request('GET', '/auth/me', { id, email: 'b3@sao-test.local', role: 'ADMIN' });
    assertEqual(me.status, 403, 'B3 /auth/me status');
    assertEqual(me.body.code, 'ACCOUNT_DISABLED', 'B3 /auth/me code');

    const cp = await request(
      'POST',
      '/auth/change-password',
      { id, email: 'b3@sao-test.local', role: 'ADMIN' },
      { currentPassword: PASSWORD, newPassword: 'N3wStr0ng!Pass9', confirmPassword: 'N3wStr0ng!Pass9' },
    );
    assertEqual(cp.status, 403, 'B3 change-password status');
    assertEqual(cp.body.code, 'ACCOUNT_DISABLED', 'B3 change-password code (ไม่ใช่ 401 หรือ MUST_CHANGE_PASSWORD)');
  });

  // ---- C: Case 3 — disable หลัง login → บล็อกทันที + re-enable กลับมาได้ ----
  await test('C1: Case 3 — login ก่อน แล้ว admin disable → request ถัดไป (JWT เดิม) ถูกบล็อก', async () => {
    const targetId = await insertUser({ email: 'c1@sao-test.local' });
    const adminId = await insertUser({ email: 'c1-admin@sao-test.local', role: 'SUPER_ADMIN' });

    const claims = { id: targetId, email: 'c1@sao-test.local', role: 'ADMIN' };
    const before = await request('GET', '/fields', claims);
    assertEqual(before.status, 200, 'C1 ก่อน disable ต้องใช้ได้');

    const disable = await request(
      'POST',
      `/users/${targetId}/disable`,
      { id: adminId, email: 'c1-admin@sao-test.local', role: 'SUPER_ADMIN' },
      { userId: targetId, reason: 'ลาออก' },
    );
    assertEqual(disable.status, 200, 'C1 disable status');

    // JWT เดิม (ยังไม่หมดอายุ — claims เดิมเป๊ะ) → ถูกบล็อกทันที
    const after = await request('GET', '/fields', claims);
    assertEqual(after.status, 403, 'C1 หลัง disable ต้องโดนบล็อก');
    assertEqual(after.body.code, 'ACCOUNT_DISABLED', 'C1 code');
  });

  await test('C2: re-enable ผ่าน PATCH /users/:id → ใช้งานได้ใหม่ (บัญชียังต้องเปลี่ยนรหัสผ่านถ้า flag คงอยู่)', async () => {
    const targetId = await insertUser({ email: 'c2@sao-test.local', isActive: 0 });
    const adminId = await insertUser({ email: 'c2-admin@sao-test.local', role: 'SUPER_ADMIN' });

    const blocked = await request('GET', '/fields', { id: targetId, email: 'c2@sao-test.local', role: 'ADMIN' });
    assertEqual(blocked.status, 403, 'C2 ก่อน enable ต้องโดนบล็อก');

    const enable = await request(
      'PATCH',
      `/users/${targetId}`,
      { id: adminId, email: 'c2-admin@sao-test.local', role: 'SUPER_ADMIN' },
      { isActive: true },
    );
    assertEqual(enable.status, 200, 'C2 enable status');

    const after = await request('GET', '/fields', { id: targetId, email: 'c2@sao-test.local', role: 'ADMIN' });
    assertEqual(after.status, 200, 'C2 หลัง enable ต้องใช้ได้');
  });

  // ---- D: Case 4 — disabled + mustChangePassword → ACCOUNT_DISABLED มาก่อน ----
  await test('D1: Case 4 — isActive=false + mustChangePassword=true → 403 ACCOUNT_DISABLED (ไม่ใช่ MUST_CHANGE_PASSWORD)', async () => {
    const id = await insertUser({ email: 'd1@sao-test.local', isActive: 0, mustChangePassword: 1 });
    const { status, body } = await request('GET', '/fields', { id, email: 'd1@sao-test.local', role: 'ADMIN' });
    assertEqual(status, 403, 'D1 status');
    assertEqual(body.code, 'ACCOUNT_DISABLED', 'D1 code — disable ต้องชนะ');
    assertTrue(body.code !== 'MUST_CHANGE_PASSWORD', 'D1 ห้ามตอบ MUST_CHANGE_PASSWORD');
  });

  // ---- E: Case 6 — old JWT ยังไม่หมดอายุ → ใช้ไม่ได้ ----
  await test('E1: Case 6 — JWT อายุยาว (exp อีก 1 ปี) ของบัญชีที่ถูกปิด → ยังถูกบล็อก', async () => {
    const id = await insertUser({ email: 'e1@sao-test.local', isActive: 0 });
    const farFutureExp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const { status, body } = await request(
      'GET',
      '/fields',
      { id, email: 'e1@sao-test.local', role: 'ADMIN' },
      undefined,
      'ip-e1',
      farFutureExp,
    );
    assertEqual(status, 403, 'E1 status — อายุ token ไม่เกี่ยว');
    assertEqual(body.code, 'ACCOUNT_DISABLED', 'E1 code');
  });

  // ---- F: audit การ disable ----
  await test('F1: disable → audit action UPDATE + payload ครบ (actor/target/reason)', async () => {
    const targetId = await insertUser({ email: 'f1@sao-test.local' });
    const adminId = await insertUser({ email: 'f1-admin@sao-test.local', role: 'SUPER_ADMIN' });
    const disable = await request(
      'POST',
      `/users/${targetId}/disable`,
      { id: adminId, email: 'f1-admin@sao-test.local', role: 'SUPER_ADMIN' },
      { userId: targetId, reason: 'ตรวจสอบพบความผิดปกติ' },
      'ip-f1',
    );
    assertEqual(disable.status, 200, 'F1 disable status');

    const logs = sqlite
      .prepare("SELECT * FROM audit_logs WHERE admin_id = ? AND entity_id = ? AND action = 'UPDATE'")
      .all(adminId, targetId) as any[];
    assertEqual(logs.length, 1, 'F1 audit row');
    const payload = parseAuditPayload(logs[0].payload);
    assertEqual(payload.selfChange, false, 'F1 payload.selfChange');
    assertEqual(payload.targetUserId, targetId, 'F1 payload.targetUserId');
    assertEqual(payload.targetEmail, 'f1@sao-test.local', 'F1 payload.targetEmail');
    assertEqual(payload.reason, 'ตรวจสอบพบความผิดปกติ', 'F1 payload.reason');
  });

  // ---- G: edge — user ไม่มีใน DB (JWT valid) → gate ปล่อยผ่าน, handler 404 ----
  await test('G1: JWT ของ user ที่ไม่มีใน DB → ไม่โดน gate (404 จาก handler ตามเดิม)', async () => {
    const ghostId = crypto.randomUUID();
    const { status, body } = await request('GET', '/auth/me', { id: ghostId, email: 'ghost@sao-test.local', role: 'ADMIN' });
    assertEqual(status, 404, 'G1 status — handler ตอบ 404 เอง');
    assertTrue(body.code !== 'ACCOUNT_DISABLED', 'G1 ต้องไม่โดน gate บล็อก');
  });

  // ---- Summary ----
  console.log('');
  console.log('=================================================');
  console.log(`ผลรวม: ${passed} ผ่าน, ${failed} ล้มเหลว`);
  console.log('=================================================');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
