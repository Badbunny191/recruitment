/**
 * R9 Regression Tests — mustChangePassword Enforcement
 * =====================================================
 *
 * ก่อนหน้านี้ flag `admin_users.must_change_password` ถูกบันทึกและคืนค่าใน
 * login response แต่ไม่มีการ enforce เลย — authMiddleware เช็คแค่ลายเซ็น JWT
 * ผู้ใช้ที่ถูก reset รหัสผ่าน (หรือถูกสร้างบัญชีใหม่) ยังใช้งานทุก endpoint
 * ได้ตามปกติจนกว่าเจ้าตัวจะเปลี่ยนเอง ขัดกับ security policy
 *
 * test นี้ยืนยันพฤติกรรมใหม่:
 *   A. Case 1 — flag=false → ใช้งาน endpoint ปกติได้ (GET + POST)
 *   B. Case 2 — flag=true → endpoint ทั่วไปถูกบล็อก 403 + code
 *      MUST_CHANGE_PASSWORD (read + write + ทุก role) แต่ allowlist
 *      (POST /auth/change-password, GET /auth/me) ยังผ่าน
 *   C. Login ยังสำเร็จเมื่อ flag=true พร้อมคืน mustChangePassword: true
 *   D. Case 3 — flag=true เปลี่ยนรหัสผ่านสำเร็จ → 200 + flag ถูก reset
 *   E. Case 4 — token เดิมหลังเปลี่ยนรหัสผ่าน → ใช้งาน endpoint ปกติได้
 *   F. Case 5 — admin reset password → flag ของ target = true
 *   G. Case 6 — audit log ถูกสร้าง: actor + target + action
 *      (CHANGE_PASSWORD self / RESET_PASSWORD admin) + payload ครบ
 *
 * รัน SQL จริงบน better-sqlite3 ผ่าน D1-compatible adapter
 * (prepare/bind/all/run/raw/batch) เหมือน admin-login-lockout.test.ts
 *
 * Run: node --import tsx src/routes/__tests__/must-change-password.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';
import { hashPassword } from '../../services/auth.service';
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

const TEST_JWT_SECRET = 'test-jwt-secret-r9';
const OLD_PASSWORD = 'OldP@ssw0rd!R9';
const NEW_PASSWORD = 'N3wStr0ng!Pass9';

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
      await hashPassword(opts.password ?? OLD_PASSWORD),
      opts.role ?? 'ADMIN',
      opts.isActive ?? 1,
      opts.mustChangePassword ?? 0,
    );
  return id;
}

function rowById(id: string): any {
  return sqlite.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
}

function rowByEmail(email: string): any {
  return sqlite.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
}

async function signedRequest(
  method: string,
  path: string,
  jwtPayload: object,
  body?: object,
  ip = '203.0.113.9',
) {
  const token = await sign(jwtPayload, TEST_JWT_SECRET);
  const res = await app.request(
    `/api/v1/admin${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'cf-connecting-ip': ip,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  return res;
}

async function jsonOf(res: Response) {
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * payload ถูกเก็บแบบ double-encoded (drizzle mode json + caller ส่ง string)
 * — parse ซ้ำจนได้ object (กันทั้งเคส single/double encoding)
 */
function parseAuditPayload(raw: any): any {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    value = JSON.parse(value);
  }
  return value;
}

// =============================================================================
// Tests (รันตามลำดับ — ใช้ shared DB)
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('R9: mustChangePassword Enforcement — Tests');
  console.log('=================================================\n');

  // ---- C: login ยังผ่านเมื่อ flag=true (Part B.1) ----
  await test('C1: login สำเร็จเมื่อ mustChangePassword=true → คืน token + flag true', async () => {
    __resetRateLimitStoreForTests();
    const email = 'login-flag@sao-test.local';
    await insertUser({ email, mustChangePassword: 1 });

    const res = await app.request(
      '/api/v1/admin/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': 'ip-c1' },
        body: JSON.stringify({ email, password: OLD_PASSWORD }),
      },
      env(),
    );
    const body = await res.json().catch(() => ({}));
    assertEqual(res.status, 200, 'C1 status');
    assertTrue(typeof body.token === 'string' && body.token.length > 0, 'C1 ต้องออก token');
    assertEqual(body.user?.mustChangePassword, true, 'C1 flag ต้องเป็น true');
  });

  // ---- A: Case 1 — flag=false ใช้งานได้ปกติ ----
  await test('A1: Case 1 — flag=false → GET /fields 200', async () => {
    const id = await insertUser({ email: 'case1@sao-test.local', mustChangePassword: 0 });
    const res = await signedRequest('GET', '/fields', { id, email: 'case1@sao-test.local', role: 'ADMIN' });
    assertEqual(res.status, 200, 'A1 status');
  });

  await test('A2: Case 1 — flag=false → POST /organizations 200 (write ผ่าน)', async () => {
    const id = await insertUser({ email: 'case1w@sao-test.local', mustChangePassword: 0 });
    const res = await signedRequest(
      'POST',
      '/organizations',
      { id, email: 'case1w@sao-test.local', role: 'SUPER_ADMIN' },
      { name: 'กองทดสอบ', isActive: true },
    );
    assertEqual(res.status, 201, 'A2 status');
  });

  // ---- B: Case 2 — flag=true ถูกบล็อก ยกเว้น allowlist ----
  await test('B1: Case 2 — flag=true → GET /fields 403 + code MUST_CHANGE_PASSWORD', async () => {
    const id = await insertUser({ email: 'case2@sao-test.local', mustChangePassword: 1 });
    const res = await signedRequest('GET', '/fields', { id, email: 'case2@sao-test.local', role: 'ADMIN' });
    assertEqual(res.status, 403, 'B1 status');
    const body = await res.json().catch(() => ({}));
    assertEqual(body.success, false, 'B1 success=false');
    assertEqual(body.code, 'MUST_CHANGE_PASSWORD', 'B1 code');
  });

  await test('B2: Case 2 — flag=true → write endpoint (POST /organizations) ถูกบล็อกด้วย', async () => {
    const id = await insertUser({ email: 'case2w@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 1 });
    const res = await signedRequest(
      'POST',
      '/organizations',
      { id, email: 'case2w@sao-test.local', role: 'SUPER_ADMIN' },
      { name: 'กองถูกบล็อก', isActive: true },
    );
    assertEqual(res.status, 403, 'B2 status');
    const body = await res.json().catch(() => ({}));
    assertEqual(body.code, 'MUST_CHANGE_PASSWORD', 'B2 code');
  });

  await test('B3: Case 2 — flag=true → VIEWER และ SUPER_ADMIN โดนบล็อกเหมือนกัน', async () => {
    const viewerId = await insertUser({ email: 'case2v@sao-test.local', role: 'VIEWER', mustChangePassword: 1 });
    const saId = await insertUser({ email: 'case2s@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 1 });
    const viewerRes = await signedRequest('GET', '/users', { id: viewerId, email: 'case2v@sao-test.local', role: 'VIEWER' });
    assertEqual(viewerRes.status, 403, 'B3 viewer status');
    const saRes = await signedRequest('GET', '/users', { id: saId, email: 'case2s@sao-test.local', role: 'SUPER_ADMIN' });
    assertEqual(saRes.status, 403, 'B3 super admin status');
    const viewerBody = await viewerRes.json().catch(() => ({}));
    assertEqual(viewerBody.code, 'MUST_CHANGE_PASSWORD', 'B3 viewer code');
  });

  await test('B4: Case 2 — flag=true → allowlist POST /auth/change-password ยังเข้า handler (401 current password ผิด)', async () => {
    const id = await insertUser({ email: 'case2cp@sao-test.local', mustChangePassword: 1 });
    const res = await signedRequest(
      'POST',
      '/auth/change-password',
      { id, email: 'case2cp@sao-test.local', role: 'ADMIN' },
      { currentPassword: 'WrongP@ss!999', newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    );
    // ถ้า gate บล็อกจะได้ 403 MUST_CHANGE_PASSWORD — ต้องผ่าน gate ไปเจอ handler
    // และ handler ตอบ 401 เพราะรหัสผ่านปัจจุบันไม่ถูก
    assertEqual(res.status, 401, 'B4 status (handler ตรวจ current password)');
    const body = await res.json().catch(() => ({}));
    assertTrue(body.code !== 'MUST_CHANGE_PASSWORD', 'B4 ต้องไม่โดน gate บล็อก');
  });

  await test('B5: Case 2 — flag=true → allowlist GET /auth/me ยังใช้ได้', async () => {
    const id = await insertUser({ email: 'case2me@sao-test.local', mustChangePassword: 1 });
    const res = await signedRequest('GET', '/auth/me', { id, email: 'case2me@sao-test.local', role: 'ADMIN' });
    assertEqual(res.status, 200, 'B5 status');
    const body = await res.json().catch(() => ({}));
    assertEqual(body.data?.mustChangePassword, true, 'B5 /auth/me ต้องคืน flag true');
  });

  // ---- D: Case 3 — เปลี่ยนรหัสผ่านสำเร็จ → flag reset ----
  await test('D1: Case 3 — flag=true เปลี่ยนรหัสผ่านสำเร็จ → 200 + flag=false ใน DB', async () => {
    const id = await insertUser({ email: 'case3@sao-test.local', mustChangePassword: 1 });
    const res = await signedRequest(
      'POST',
      '/auth/change-password',
      { id, email: 'case3@sao-test.local', role: 'ADMIN' },
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    );
    assertEqual(res.status, 200, 'D1 status');
    const row = rowById(id);
    assertEqual(Number(row.must_change_password), 0, 'D1 flag ต้องถูก reset');
  });

  // ---- E: Case 4 — token เดิมหลังเปลี่ยนรหัสผ่าน ใช้งานได้ปกติ ----
  await test('E1: Case 4 — token เดิม (ยังไม่หมดอายุ) หลังเปลี่ยนรหัสผ่าน → endpoint ปกติ 200', async () => {
    const id = await insertUser({ email: 'case4@sao-test.local', mustChangePassword: 1 });
    // เปลี่ยนรหัสผ่านก่อน
    const cpRes = await signedRequest(
      'POST',
      '/auth/change-password',
      { id, email: 'case4@sao-test.local', role: 'ADMIN' },
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    );
    assertEqual(cpRes.status, 200, 'E1 change-password status');
    // token เดิม (JWT เดิมไม่มี flag) → gate อ่าน DB ต้องเจอ flag=false
    const res = await signedRequest('GET', '/fields', { id, email: 'case4@sao-test.local', role: 'ADMIN' });
    assertEqual(res.status, 200, 'E1 fields status — ต้องไม่ติด flag เดิมค้างใน JWT');
  });

  // ---- F: Case 5 — admin reset password → flag ของ target = true ----
  await test('F1: Case 5 — SUPER_ADMIN reset-password ให้ target → 200 + target flag=true', async () => {
    const adminId = await insertUser({ email: 'case5admin@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 0 });
    const targetId = await insertUser({ email: 'case5target@sao-test.local', role: 'ADMIN', mustChangePassword: 0 });
    const res = await signedRequest(
      'POST',
      `/users/${targetId}/reset-password`,
      { id: adminId, email: 'case5admin@sao-test.local', role: 'SUPER_ADMIN' },
    );
    assertEqual(res.status, 200, 'F1 status');
    const body = await res.json().catch(() => ({}));
    assertTrue(typeof body.temporaryPassword === 'string' && body.temporaryPassword.length > 0, 'F1 ต้องคืน temporaryPassword');
    const row = rowById(targetId);
    assertEqual(Number(row.must_change_password), 1, 'F1 target flag ต้องเป็น true');
  });

  await test('F2: Case 5 — target ที่ถูก reset (flag=true) login แล้วโดนบล็อก endpoint ทั่วไป', async () => {
    const adminId = await insertUser({ email: 'case5b-admin@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 0 });
    const targetId = await insertUser({ email: 'case5b-target@sao-test.local', role: 'ADMIN', mustChangePassword: 0 });
    await signedRequest(
      'POST',
      `/users/${targetId}/reset-password`,
      { id: adminId, email: 'case5b-admin@sao-test.local', role: 'SUPER_ADMIN' },
    );
    const res = await signedRequest('GET', '/fields', { id: targetId, email: 'case5b-target@sao-test.local', role: 'ADMIN' });
    assertEqual(res.status, 403, 'F2 status');
    const body = await res.json().catch(() => ({}));
    assertEqual(body.code, 'MUST_CHANGE_PASSWORD', 'F2 code');
  });

  // ---- G: Case 6 — audit log ครบ ----
  await test('G1: Case 6 — self change-password → audit action CHANGE_PASSWORD + payload ครบ', async () => {
    const id = await insertUser({ email: 'case6@sao-test.local', mustChangePassword: 1 });
    const res = await signedRequest(
      'POST',
      '/auth/change-password',
      { id, email: 'case6@sao-test.local', role: 'ADMIN' },
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      'ip-g1',
    );
    assertEqual(res.status, 200, 'G1 status');

    const logs = sqlite
      .prepare("SELECT * FROM audit_logs WHERE admin_id = ? AND action = 'CHANGE_PASSWORD'")
      .all(id) as any[];
    assertEqual(logs.length, 1, 'G1 ต้องมี audit row เดียว');
    const log = logs[0];
    assertEqual(log.admin_id, id, 'G1 actor (admin_id) = ผู้เปลี่ยนเอง');
    assertEqual(log.entity_type, 'ADMIN_USER', 'G1 entity_type');
    const payload = parseAuditPayload(log.payload);
    assertEqual(payload.selfChange, true, 'G1 payload.selfChange');
    assertEqual(payload.targetUserId, id, 'G1 payload.targetUserId');
    assertEqual(payload.targetEmail, 'case6@sao-test.local', 'G1 payload.targetEmail');
  });

  await test('G2: Case 6 — admin reset-password → audit action RESET_PASSWORD + payload ครบ (actor ≠ target)', async () => {
    const adminId = await insertUser({ email: 'case6b-admin@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 0 });
    const targetId = await insertUser({ email: 'case6b-target@sao-test.local', role: 'ADMIN', mustChangePassword: 0 });
    const res = await signedRequest(
      'POST',
      `/users/${targetId}/reset-password`,
      { id: adminId, email: 'case6b-admin@sao-test.local', role: 'SUPER_ADMIN' },
      undefined,
      'ip-g2',
    );
    assertEqual(res.status, 200, 'G2 status');

    const logs = sqlite
      .prepare("SELECT * FROM audit_logs WHERE action = 'RESET_PASSWORD' AND admin_id = ?")
      .all(adminId) as any[];
    assertEqual(logs.length, 1, 'G2 ต้องมี audit row เดียว');
    const log = logs[0];
    assertEqual(log.admin_id, adminId, 'G2 actor = SUPER_ADMIN ผู้รีเซ็ต');
    assertEqual(log.entity_id, targetId, 'G2 entityId = target user');
    const payload = parseAuditPayload(log.payload);
    assertEqual(payload.selfChange, false, 'G2 payload.selfChange=false (admin reset)');
    assertEqual(payload.targetUserId, targetId, 'G2 payload.targetUserId');
    assertEqual(payload.targetEmail, 'case6b-target@sao-test.local', 'G2 payload.targetEmail');
  });

  await test('G3: Case 6 — change-password ล้มเหลว (401) ต้องไม่เขียน audit log', async () => {
    const id = await insertUser({ email: 'case6c@sao-test.local', mustChangePassword: 1 });
    await signedRequest(
      'POST',
      '/auth/change-password',
      { id, email: 'case6c@sao-test.local', role: 'ADMIN' },
      { currentPassword: 'WrongP@ss!999', newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      'ip-g3',
    );
    const logs = sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE admin_id = ? AND action = 'CHANGE_PASSWORD'")
      .get(id) as any;
    assertEqual(Number(logs.n), 0, 'G3 ห้ามมี audit row เมื่อ change ล้มเหลว');
  });

  // ---- H: force-change-password (toggle โดยไม่ rotate password) ----
  await test('H1: force-change-password → flag เปลี่ยน + audit action UPDATE + payload ครบ', async () => {
    const adminId = await insertUser({ email: 'h1-admin@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 0 });
    const targetId = await insertUser({ email: 'h1-target@sao-test.local', role: 'VIEWER', mustChangePassword: 0 });
    const res = await signedRequest(
      'POST',
      `/users/${targetId}/force-change-password`,
      { id: adminId, email: 'h1-admin@sao-test.local', role: 'SUPER_ADMIN' },
      { userId: targetId, mustChangePassword: true },
      'ip-h1',
    );
    assertEqual(res.status, 200, 'H1 status');
    assertEqual(Number(rowById(targetId).must_change_password), 1, 'H1 target flag = true');

    const logs = sqlite
      .prepare("SELECT * FROM audit_logs WHERE admin_id = ? AND entity_id = ? AND action = 'UPDATE'")
      .all(adminId, targetId) as any[];
    assertEqual(logs.length, 1, 'H1 audit row');
    const payload = parseAuditPayload(logs[0].payload);
    assertEqual(payload.forcedMustChangePassword, true, 'H1 payload.forcedMustChangePassword');
    assertEqual(payload.targetUserId, targetId, 'H1 payload.targetUserId');
  });

  // ---- I: สร้าง user ใหม่ default flag=true + โดนบล็อกทันที (Part E) ----
  await test('I1: POST /users default → mustChangePassword=true + user ใหม่โดนบล็อกทันที', async () => {
    const adminId = await insertUser({ email: 'i1-admin@sao-test.local', role: 'SUPER_ADMIN', mustChangePassword: 0 });
    const res = await signedRequest(
      'POST',
      '/users',
      { id: adminId, email: 'i1-admin@sao-test.local', role: 'SUPER_ADMIN' },
      { email: 'i1-new@sao-test.local', role: 'VIEWER' },
      'ip-i1',
    );
    assertEqual(res.status, 201, 'I1 status');
    const body = await res.json().catch(() => ({}));
    const created = rowByEmail('i1-new@sao-test.local');
    assertTrue(!!created, 'I1 user ถูกสร้าง');
    assertEqual(Number(created.must_change_password), 1, 'I1 default flag = true');

    // user ใหม่ login ด้วย temporary password → โดนบล็อก endpoint ทั่วไป
    __resetRateLimitStoreForTests();
    const loginRes = await app.request(
      '/api/v1/admin/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': 'ip-i1b' },
        body: JSON.stringify({ email: 'i1-new@sao-test.local', password: body.temporaryPassword }),
      },
      env(),
    );
    const loginBody = await loginRes.json().catch(() => ({}));
    assertEqual(loginRes.status, 200, 'I1 login status');
    const fieldsRes = await signedRequest(
      'GET',
      '/fields',
      { id: created.id, email: 'i1-new@sao-test.local', role: 'VIEWER' },
    );
    assertEqual(fieldsRes.status, 403, 'I1 user ใหม่ต้องโดนบล็อก');
    const fieldsBody = await fieldsRes.json().catch(() => ({}));
    assertEqual(fieldsBody.code, 'MUST_CHANGE_PASSWORD', 'I1 code');
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
