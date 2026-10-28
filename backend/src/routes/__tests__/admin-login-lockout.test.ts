/**
 * S2 Regression Tests — Admin Login Lockout + Login Rate Limit
 * ============================================================
 *
 * ก่อนหน้านี้ POST /admin/auth/login:
 *   - ไม่มี rate limit
 *   - รหัสผ่านผิดคืน 401 ทันทีโดยไม่เพิ่ม failed_login_attempts
 *   - ไม่มีจุดใดตั้ง locked_until เป็นเวลาอนาคต (ล็อกไม่เกิดเลย)
 *   → ผู้โจมตี brute force รหัสผ่านแอดมินได้ไม่จำกัดในระดับ application
 *
 * test นี้ยืนยันพฤติกรรมใหม่:
 *   A. รหัสผ่านผิด 1 ครั้ง → 401 + failed_login_attempts = 1
 *   B. ผิดครบ threshold (5) → บัญชีถูกล็อก, locked_until เป็นอนาคต
 *   C. ล็อกอยู่ → 423, ไม่เรียก bcrypt, ไม่ออก JWT, ไม่ขยายเวลาล็อก
 *   D. พ้นเวลาล็อก → login ถูกต้องได้สำเร็จ + counters ถูกรีเซ็ต
 *      และผิดหลังพ้นเวลาล็อก → เริ่มนับใหม่ที่ 1
 *   E. Login สำเร็จก่อน threshold → counters รีเซ็ต
 *   F. อีเมลไม่มีในระบบ vs รหัสผ่านผิดของอีเมลจริง → response ตรงกันเปี๊ยะ
 *   G. ผู้ใช้ถูก disable (isActive=false) → login ไม่ได้, ไม่ออก JWT
 *   H. Rate limit เฉพาะ login endpoint: เกิน 10/min/IP → 429
 *      และ endpoint อื่น / IP อื่นไม่กระทบ
 *   I. Regression: change-password / reset-password / force-change-password /
 *      disable ยังทำงาน และ reset-password/disable ล้าง counters ให้ด้วย
 *
 * รัน SQL จริงบน better-sqlite3 ผ่าน D1-compatible adapter
 * (prepare/bind/all/run/raw/batch) เพื่อให้ atomic UPDATE + CASE
 * ทำงานด้วย SQL semantics จริงเหมือนบน D1
 *
 * Run: node --import tsx src/routes/__tests__/admin-login-lockout.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
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
      // D1 batch ไม่ถูกใช้ใน flows ที่ test นี้ครอบคลุม — รันตามลำดับพอ
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

const TEST_JWT_SECRET = 'test-jwt-secret-s2';
const PASSWORD = 'TestP@ssw0rd!S2';

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
  failedLoginAttempts?: number;
  lockedUntil?: number | null;
}) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password,
        failed_login_attempts, locked_until, password_migrated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      id,
      opts.email,
      await hashPassword(opts.password ?? PASSWORD),
      opts.role ?? 'ADMIN',
      opts.isActive ?? 1,
      opts.mustChangePassword ?? 0,
      opts.failedLoginAttempts ?? 0,
      opts.lockedUntil ?? null,
    );
  return id;
}

function rowByEmail(email: string): any {
  return sqlite.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
}

// ── Login audit helpers ──────────────────────────────────────────────
function auditRows(): any[] {
  return sqlite.prepare('SELECT * FROM audit_logs ORDER BY created_at, id').all();
}

function loginAuditRows(action: string, adminId?: string): any[] {
  const rows = auditRows().filter(
    (r) => r.entity_type === 'ADMIN_USER' && r.action === action,
  );
  return adminId ? rows.filter((r) => r.admin_id === adminId) : rows;
}

// convention เดิมของระบบ: payload ถูก stringify แล้ว drizzle (mode: 'json')
// อาจ stringify ซ้ำ → แกะได้ทั้งสองชั้น
function parseAuditPayload(raw: string | null): any {
  if (raw == null) return null;
  const once = JSON.parse(raw);
  return typeof once === 'string' ? JSON.parse(once) : once;
}

// adapter ที่ทำให้ INSERT INTO audit_logs ล้ม — ใช้พิสูจน์ fail-soft
function createAuditFailingAdapter() {
  return {
    prepare: (sqlText: string) => {
      if (/insert\s+into\s+["']?audit_logs/i.test(sqlText)) {
        throw new Error('simulated audit_logs insert failure');
      }
      return d1.prepare(sqlText);
    },
    batch: d1.batch.bind(d1),
  };
}

async function login(email: string, password: string, ip = '198.51.100.1') {
  const res = await app.request(
    '/api/v1/admin/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ email, password }),
    },
    env(),
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function signedRequest(
  method: string,
  path: string,
  jwtPayload: object,
  body?: object,
  ip = '198.51.100.1',
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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// นับจำนวนครั้งที่ route เรียก bcrypt.compare — ใช้พิสูจน์ว่า "ล็อกอยู่ → ไม่เรียก bcrypt"
// patch บน default export object ของ bcryptjs ตัวเดียวกับที่ admin.routes ใช้
const origCompare = bcrypt.compare.bind(bcrypt);
let compareCallCount = 0;
bcrypt.compare = async (pw: string, hash: string) => {
  compareCallCount++;
  return origCompare(pw, hash);
};

// =============================================================================
// Tests (รันตามลำดับ — ใช้ shared DB + rate-limit store ร่วมกัน)
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('S2: Admin Login Lockout + Rate Limit — Tests');
  console.log('=================================================\n');

  // ---- A: รหัสผ่านผิด 1 ครั้ง ----
  await test('A1: รหัสผ่านผิด 1 ครั้ง → 401 + failed_login_attempts = 1', async () => {
    __resetRateLimitStoreForTests();
    const email = 'a1@sao-test.local';
    await insertUser({ email });

    const before = compareCallCount;
    const { status, body } = await login(email, 'WrongP@ssw0rd!X', 'ip-a1');
    assertEqual(status, 401, 'A1 status');
    assertEqual(body.error, 'Invalid credentials', 'A1 generic error');
    assertTrue(!('token' in body), 'A1 ต้องไม่ออก token');
    assertEqual(compareCallCount - before, 1, 'A1 control: route ต้องเรียก bcrypt.compare 1 ครั้ง (พิสูจน์ว่า patch ทำงาน)');

    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 1, 'A1 counter');
    assertEqual(row.locked_until, null, 'A1 ยังไม่ล็อก');
    assertEqual(row.last_login_at, null, 'A1 ห้ามอัปเดต last_login_at');
  });

  // ---- B: ผิดจนถึง threshold → ล็อก ----
  await test('B1: ผิด 4 ครั้ง → ยังไม่ล็อก', async () => {
    __resetRateLimitStoreForTests();
    const email = 'b1@sao-test.local';
    await insertUser({ email });

    for (let i = 0; i < 4; i++) {
      const { status } = await login(email, 'WrongP@ssw0rd!X', 'ip-b1');
      assertEqual(status, 401, `B1 attempt #${i + 1} ต้องเป็น 401`);
    }
    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 4, 'B1 counter = 4');
    assertEqual(row.locked_until, null, 'B1 ยังไม่ล็อก');
  });

  await test('B2: ผิดครั้งที่ 5 → บัญชีถูกล็อก, locked_until เป็นอนาคต (~15 นาที)', async () => {
    __resetRateLimitStoreForTests();
    const email = 'b2@sao-test.local';
    await insertUser({ email });

    for (let i = 0; i < 5; i++) {
      const { status, body } = await login(email, 'WrongP@ssw0rd!X', 'ip-b2');
      assertEqual(status, 401, `B2 attempt #${i + 1} ต้องยังเป็น 401 (ตัวตอบไม่บอกว่าเพิ่งถูกล็อก)`);
      assertEqual(body.error, 'Invalid credentials', `B2 attempt #${i + 1} generic body`);
    }

    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 5, 'B2 counter = 5');
    const lockedUntilMs = row.locked_until * 1000;
    assertTrue(lockedUntilMs > Date.now(), 'B2 locked_until ต้องเป็นอนาคต');
    const fifteenMin = 15 * 60 * 1000;
      assertTrue(
      Math.abs(lockedUntilMs - (Date.now() + fifteenMin)) < 60 * 1000,
      'B2 locked_until ≈ now + 15 นาที',
    );
  });

  // ---- C: ล็อกอยู่ → 423, ไม่ bcrypt, ไม่ JWT ----
  await test('C1: Login ระหว่างถูกล็อก (แม้รหัสถูกต้อง) → 423 + ไม่เรียก bcrypt + ไม่ออก JWT + ไม่ขยายเวลาล็อก', async () => {
    __resetRateLimitStoreForTests();
    const email = 'c1@sao-test.local';
    await insertUser({ email });
    for (let i = 0; i < 5; i++) {
      await login(email, 'WrongP@ssw0rd!X', 'ip-c1');
    }
    const lockedRow = rowByEmail(email);
    const lockedUntilBefore = lockedRow.locked_until;
    assertTrue(lockedUntilBefore !== null, 'C1 pre-condition: บัญชีถูกล็อกแล้ว');

    const before = compareCallCount;
    const { status, body } = await login(email, PASSWORD, 'ip-c1');
    assertEqual(status, 423, 'C1 status ต้องเป็น 423');
    assertEqual(body.error, 'Account Locked', 'C1 error');
    assertTrue(!('token' in body), 'C1 ต้องไม่ออก token');
    assertEqual(compareCallCount - before, 0, 'C1 ต้องไม่เรียก bcrypt.compare เลย (423 กลับก่อนถึง bcrypt)');

    const row = rowByEmail(email);
    assertEqual(row.locked_until, lockedUntilBefore, 'C1 เวลาล็อกต้องไม่ถูกขยาย');
    assertEqual(row.failed_login_attempts, 5, 'C1 counter ไม่เพิ่มระหว่างล็อก');
    assertEqual(row.last_login_at, null, 'C1 ห้ามอัปเดต last_login_at');
  });

  // ---- D: พ้นเวลาล็อก ----
  await test('D1: พ้นเวลาล็อก + รหัสถูกต้อง → login สำเร็จ + counters รีเซ็ต', async () => {
    __resetRateLimitStoreForTests();
    const email = 'd1@sao-test.local';
    await insertUser({ email });
    sqlite
      .prepare('UPDATE admin_users SET failed_login_attempts = 5, locked_until = ? WHERE email = ?')
      .run(Math.floor(Date.now() / 1000) - 5, email); // จำลองล็อกที่เพิ่งหมดเวลา

    const { status, body } = await login(email, PASSWORD, 'ip-d1');
    assertEqual(status, 200, 'D1 status');
    assertTrue(typeof body.token === 'string' && body.token.length > 0, 'D1 ต้องออก JWT');

    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 0, 'D1 counter กลับเป็น 0');
    assertEqual(row.locked_until, null, 'D1 locked_until กลับเป็น null');
    assertTrue(row.last_login_at !== null, 'D1 last_login_at ถูกอัปเดต');
  });

  await test('D2: พ้นเวลาล็อก + รหัสผิด → นับใหม่ที่ 1 (clean slate) ไม่ล็อกซ้ำทันที', async () => {
    __resetRateLimitStoreForTests();
    const email = 'd2@sao-test.local';
    await insertUser({ email });
    sqlite
      .prepare('UPDATE admin_users SET failed_login_attempts = 5, locked_until = ? WHERE email = ?')
      .run(Math.floor(Date.now() / 1000) - 5, email);

    const { status } = await login(email, 'WrongP@ssw0rd!X', 'ip-d2');
    assertEqual(status, 401, 'D2 status');

    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 1, 'D2 counter เริ่มนับใหม่ที่ 1');
    assertEqual(row.locked_until, null, 'D2 ต้องไม่ล็อกซ้ำทันที');
  });

  // ---- E: สำเร็จก่อน threshold → รีเซ็ต ----
  await test('E1: ผิด 2 ครั้งแล้ว login สำเร็จ → counters รีเซ็ตเป็น 0/null', async () => {
    __resetRateLimitStoreForTests();
    const email = 'e1@sao-test.local';
    await insertUser({ email });

    await login(email, 'WrongP@ssw0rd!X', 'ip-e1');
    await login(email, 'WrongP@ssw0rd!X', 'ip-e1');
    assertEqual(rowByEmail(email).failed_login_attempts, 2, 'E1 pre-condition counter = 2');

    const { status, body } = await login(email, PASSWORD, 'ip-e1');
    assertEqual(status, 200, 'E1 status');
    assertTrue(typeof body.token === 'string', 'E1 ออก JWT');

    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 0, 'E1 counter = 0');
    assertEqual(row.locked_until, null, 'E1 locked_until = null');
  });

  // ---- F: ไม่เปิดเผยว่าอีเมลมีในระบบหรือไม่ ----
  await test('F1: อีเมลไม่มีในระบบ vs อีเมลจริง+รหัสผิด → status + body ตรงกันทุกประการ', async () => {
    __resetRateLimitStoreForTests();
    const realEmail = 'f1-real@sao-test.local';
    await insertUser({ email: realEmail });

    const notFound = await login('f1-ghost@sao-test.local', 'WrongP@ssw0rd!X', 'ip-f1');
    const wrongPw = await login(realEmail, 'WrongP@ssw0rd!X', 'ip-f1');

    assertEqual(notFound.status, 401, 'F1 ghost status');
    assertEqual(wrongPw.status, 401, 'F1 real status');
    assertEqual(JSON.stringify(notFound.body), JSON.stringify(wrongPw.body), 'F1 body ต้องเหมือนกันเปี๊ยะ (กัน enumeration)');
    assertTrue(!('token' in notFound.body) && !('token' in wrongPw.body), 'F1 ไม่ออก token');
  });

  // ---- G: disabled user ----
  await test('G1: isActive=false → login ไม่ได้ (403) + ไม่ออก JWT', async () => {
    __resetRateLimitStoreForTests();
    const email = 'g1@sao-test.local';
    await insertUser({ email, isActive: 0 });

    const { status, body } = await login(email, PASSWORD, 'ip-g1');
    assertEqual(status, 403, 'G1 status (contract เดิม: disabled = 403)');
    assertTrue(!('token' in body), 'G1 ต้องไม่ออก token');
  });

  // ---- H: rate limit เฉพาะ login endpoint ----
  await test('H1: เรียก login เกิน 10 ครั้ง/นาทีจาก IP เดียว → ครั้งที่ 11 ได้ 429', async () => {
    __resetRateLimitStoreForTests();
    const ip = '203.0.113.10';
    for (let i = 1; i <= 10; i++) {
      const { status } = await login('h1-ghost@sao-test.local', 'WrongP@ssw0rd!X', ip);
      assertEqual(status, 401, `H1 request #${i} ต้องผ่าน limiter (401 จาก credential) ไม่ใช่ 429`);
    }
    const { status, body } = await login('h1-ghost@sao-test.local', 'WrongP@ssw0rd!X', ip);
    assertEqual(status, 429, 'H1 request #11 ต้องเป็น 429');
    assertTrue(!('token' in body), 'H1 ไม่ออก token');
  });

  await test('H2: Rate limit ไม่กระทบ endpoint อื่น (แม้ IP เดียวกัน) และไม่กระทบ IP อื่น', async () => {
    const ip = '203.0.113.11';
    for (let i = 0; i < 10; i++) {
      await login('h2-ghost@sao-test.local', 'WrongP@ssw0rd!X', ip);
    }
    const blocked = await login('h2-ghost@sao-test.local', 'WrongP@ssw0rd!X', ip);
    assertEqual(blocked.status, 429, 'H2 pre-condition: IP นี้ถูก limit ที่ login แล้ว');

    // endpoint อื่นจาก IP เดียวกัน: auth middleware ตอบ 401 (ไม่ใช่ 429)
    // → พิสูจน์ว่า limiter ไม่ติดที่ admin endpoint อื่น
    const other = await app.request(
      '/api/v1/admin/fields',
      { headers: { 'cf-connecting-ip': ip } },
      env(),
    );
    assertEqual(other.status, 401, 'H2 /fields จาก IP ที่ถูก limit ที่ login → ต้องเป็น 401 จาก auth ไม่ใช่ 429');

    // IP อื่นยัง login ได้ (limit เป็น per-IP)
    const otherIp = await login('h2-ghost@sao-test.local', 'WrongP@ssw0rd!X', '203.0.113.99');
    assertEqual(otherIp.status, 401, 'H2 IP อื่นต้องผ่าน limiter (401 จาก credential)');
  });

  // ---- I: Regression บน auth/user management flows ----
  await test('I1: change-password ยังทำงาน — เปลี่ยนรหัสผ่านสำเร็จ + รหัสใหม่ login ได้ + รหัสเก่าใช้ไม่ได้', async () => {
    __resetRateLimitStoreForTests();
    const email = 'i1@sao-test.local';
    const userId = await insertUser({ email });
    const newPassword = 'NewS2#Passw0rd';

    const jwtPayload = { id: userId, email, role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 };
    const res = await signedRequest('POST', '/auth/change-password', jwtPayload, {
      currentPassword: PASSWORD,
      newPassword,
      confirmPassword: newPassword,
    }, 'ip-i1');
    assertEqual(res.status, 200, `I1 change-password ต้องสำเร็จ (ได้ ${res.status}: ${JSON.stringify(res.body)})`);

    const row = rowByEmail(email);
    assertEqual(row.must_change_password, 0, 'I1 mustChangePassword ถูกรีเซ็ต');
    assertEqual(row.failed_login_attempts, 0, 'I1 counter รีเซ็ต');

    const newLogin = await login(email, newPassword, 'ip-i1b');
    assertEqual(newLogin.status, 200, 'I1 login ด้วยรหัสใหม่ต้องสำเร็จ');
    const oldLogin = await login(email, PASSWORD, 'ip-i1b');
    assertEqual(oldLogin.status, 401, 'I1 รหัสเก่าต้องใช้ไม่ได้');
  });

  await test('I2: reset-password ยังทำงาน — ออกรหัสชั่วคราว + ล้าง lockout counters + ล็อกอินด้วยรหัสชั่วคราวได้', async () => {
    __resetRateLimitStoreForTests();
    const superAdminId = await insertUser({ email: 'i2-sa@sao-test.local', role: 'SUPER_ADMIN' });
    const email = 'i2-target@sao-test.local';
    const targetId = await insertUser({ email });
    // เตรียม target ให้ถูกล็อกอยู่ — reset ต้องปลดล็อกให้
    sqlite
      .prepare('UPDATE admin_users SET failed_login_attempts = 5, locked_until = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) + 600, targetId);

    const saJwt = { id: superAdminId, email: 'i2-sa@sao-test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 };
    const res = await signedRequest('POST', `/users/${targetId}/reset-password`, saJwt, undefined, 'ip-i2');
    assertEqual(res.status, 200, `I2 reset-password ต้องสำเร็จ (ได้ ${res.status}: ${JSON.stringify(res.body)})`);
    assertTrue(typeof res.body.temporaryPassword === 'string' && res.body.temporaryPassword.length >= 8, 'I2 ต้องคืนรหัสชั่วคราว');

    const row = rowByEmail(email);
    assertEqual(row.must_change_password, 1, 'I2 mustChangePassword = true');
    assertEqual(row.failed_login_attempts, 0, 'I2 counter ถูกล้าง');
    assertEqual(row.locked_until, null, 'I2 locked_until ถูกล้าง (ปลดล็อก)');

    const reLogin = await login(email, res.body.temporaryPassword, 'ip-i2b');
    assertEqual(reLogin.status, 200, 'I2 login ด้วยรหัสชั่วคราวต้องสำเร็จหลัง reset');
    assertEqual(reLogin.body.user?.mustChangePassword, true, 'I2 ต้องได้รับ flag mustChangePassword');
  });

  await test('I3: force-change-password ยังทำงาน — toggle mustChangePassword ได้', async () => {
    __resetRateLimitStoreForTests();
    const superAdminId = await insertUser({ email: 'i3-sa@sao-test.local', role: 'SUPER_ADMIN' });
    const email = 'i3-target@sao-test.local';
    const targetId = await insertUser({ email, mustChangePassword: 1 });

    const saJwt = { id: superAdminId, email: 'i3-sa@sao-test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 };
    const res = await signedRequest(
      'POST',
      `/users/${targetId}/force-change-password`,
      saJwt,
      { userId: targetId, mustChangePassword: false },
      'ip-i3',
    );
    assertEqual(res.status, 200, `I3 force-change-password ต้องสำเร็จ (ได้ ${res.status}: ${JSON.stringify(res.body)})`);
    assertEqual(rowByEmail(email).must_change_password, 0, 'I3 flag ถูกเปลี่ยนเป็น false');
  });

  await test('I4: disable user ยังทำงาน — is_active=0 + ล้าง counters + login ไม่ได้', async () => {
    __resetRateLimitStoreForTests();
    const superAdminId = await insertUser({ email: 'i4-sa@sao-test.local', role: 'SUPER_ADMIN' });
    const email = 'i4-target@sao-test.local';
    const targetId = await insertUser({ email });
    sqlite
      .prepare('UPDATE admin_users SET failed_login_attempts = 3, locked_until = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) + 600, targetId);

    const saJwt = { id: superAdminId, email: 'i4-sa@sao-test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 };
    const res = await signedRequest(
      'POST',
      `/users/${targetId}/disable`,
      saJwt,
      { userId: targetId, reason: 'S2 regression test' },
      'ip-i4',
    );
    assertEqual(res.status, 200, `I4 disable ต้องสำเร็จ (ได้ ${res.status}: ${JSON.stringify(res.body)})`);

    const row = rowByEmail(email);
    assertEqual(row.is_active, 0, 'I4 is_active = 0');
    assertEqual(row.failed_login_attempts, 0, 'I4 counter ถูกล้าง');
    assertEqual(row.locked_until, null, 'I4 locked_until ถูกล้าง');

    const loginAttempt = await login(email, PASSWORD, 'ip-i4b');
    assertEqual(loginAttempt.status, 403, 'I4 disabled user login ต้องได้ 403');
    assertTrue(!('token' in loginAttempt.body), 'I4 ต้องไม่ออก JWT');
  });

  // ---- L: Login audit events (LOGIN / LOGIN_FAILED / ACCOUNT_LOCKED) ----
  await test('L1: login สำเร็จ → audit action LOGIN + entityType ADMIN_USER + payload มี email/IP ไม่มี credential', async () => {
    __resetRateLimitStoreForTests();
    const email = 'l1@sao-test.local';
    const userId = await insertUser({ email });

    const { status } = await login(email, PASSWORD, 'ip-l1');
    assertEqual(status, 200, 'L1 status');

    const rows = loginAuditRows('LOGIN', userId);
    assertEqual(rows.length, 1, 'L1 ต้องมี LOGIN audit row 1 แถว');
    assertEqual(rows[0].entity_id, userId, 'L1 entityId = adminId (ให้ display resolver หาเจอ)');
    assertEqual(rows[0].ip_address, 'ip-l1', 'L1 ipAddress จาก cf-connecting-ip');

    const payload = parseAuditPayload(rows[0].payload);
    assertEqual(payload.email, email, 'L1 payload.email');

    // ห้ามมี credential ใด ๆ ใน payload
    const raw = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ['password', 'hash', 'token', 'jwt', 'temporary']) {
      assertTrue(!raw.includes(forbidden), `L1 payload ห้ามมีคำว่า "${forbidden}"`);
    }
  });

  await test('L2: รหัสผ่านผิด → audit action LOGIN_FAILED + failedAttempts ตรงกับ counter จริง', async () => {
    __resetRateLimitStoreForTests();
    const email = 'l2@sao-test.local';
    const userId = await insertUser({ email });

    await login(email, 'WrongP@ssw0rd!X', 'ip-l2');
    await login(email, 'WrongP@ssw0rd!X', 'ip-l2');

    const rows = loginAuditRows('LOGIN_FAILED', userId);
    assertEqual(rows.length, 2, 'L2 ต้องมี LOGIN_FAILED 2 แถว');
    // created_at เป็น unixepoch (วินาที) → หลายแถวในวินาทีเดียวกัน tie-break ด้วย uuid
    // สุ่ม ลำดับจึงไม่คงที่ → เทียบเป็น set ไม่ใช่ตาม index
    const attempts = rows.map((r) => parseAuditPayload(r.payload).failedAttempts).sort((a, b) => a - b);
    assertEqual(JSON.stringify(attempts), JSON.stringify([1, 2]), 'L2 failedAttempts = 1 แล้ว 2');
    assertEqual(rowByEmail(email).failed_login_attempts, 2, 'L2 counter จริง = 2 (atomic UPDATE ยังทำงานเดิม)');
    assertEqual(loginAuditRows('ACCOUNT_LOCKED', userId).length, 0, 'L2 ยังไม่ล็อก → ไม่มี ACCOUNT_LOCKED');
  });

  await test('L3: ผิดครั้งที่ 5 → LOGIN_FAILED + ACCOUNT_LOCKED (lockReason + lockedUntil อนาคต)', async () => {
    __resetRateLimitStoreForTests();
    const email = 'l3@sao-test.local';
    const userId = await insertUser({ email });

    for (let i = 0; i < 5; i++) {
      await login(email, 'WrongP@ssw0rd!X', 'ip-l3');
    }

    const failedRows = loginAuditRows('LOGIN_FAILED', userId);
    assertEqual(failedRows.length, 5, 'L3 LOGIN_FAILED 5 แถว');
    const attempts = failedRows
      .map((r) => parseAuditPayload(r.payload).failedAttempts)
      .sort((a, b) => a - b);
    assertEqual(JSON.stringify(attempts), JSON.stringify([1, 2, 3, 4, 5]), 'L3 failedAttempts สะสม 1→5 ครบ');

    const lockedRows = loginAuditRows('ACCOUNT_LOCKED', userId);
    assertEqual(lockedRows.length, 1, 'L3 ACCOUNT_LOCKED 1 แถว (ครั้งที่ครบ threshold เท่านั้น)');

    const payload = parseAuditPayload(lockedRows[0].payload);
    assertEqual(payload.lockReason, 'MAX_FAILED_ATTEMPTS', 'L3 lockReason');
    assertEqual(payload.failedAttempts, 5, 'L3 payload.failedAttempts');
    assertTrue(typeof payload.lockedUntil === 'string', 'L3 lockedUntil เป็น ISO string');
    assertTrue(new Date(payload.lockedUntil).getTime() > Date.now(), 'L3 lockedUntil เป็นอนาคต');

    // atomicity เดิมต้องไม่ถูกกระทบ
    const row = rowByEmail(email);
    assertEqual(row.failed_login_attempts, 5, 'L3 counter = 5');
    assertTrue(row.locked_until * 1000 > Date.now(), 'L3 locked_until เป็นอนาคต');
  });

  await test('L4: email ไม่มีในระบบ → 401 เหมือนเดิม แต่ไม่เขียน audit ใด ๆ', async () => {
    __resetRateLimitStoreForTests();
    const before = auditRows().length;

    const { status, body } = await login('l4-ghost@sao-test.local', 'WrongP@ssw0rd!X', 'ip-l4');
    assertEqual(status, 401, 'L4 status');
    assertEqual(body.error, 'Invalid credentials', 'L4 generic body');

    assertEqual(auditRows().length, before, 'L4 ต้องไม่มี audit row ใหม่เลย (skip ตามคำตัดสิน)');
  });

  await test('L5: audit insert ล้ม → login ยังสำเร็จ 200 + ออก JWT (fail-soft)', async () => {
    __resetRateLimitStoreForTests();
    const email = 'l5@sao-test.local';
    await insertUser({ email });

    const failingEnv = { DB: createAuditFailingAdapter(), JWT_SECRET: TEST_JWT_SECRET };
    const res = await app.request(
      '/api/v1/admin/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': 'ip-l5' },
        body: JSON.stringify({ email, password: PASSWORD }),
      },
      failingEnv,
    );
    const body = await res.json().catch(() => ({}));

    assertEqual(res.status, 200, `L5 audit พังต้องไม่ทำให้ login พัง (ได้ ${res.status})`);
    assertTrue(typeof body.token === 'string' && body.token.length > 0, 'L5 ต้องยังออก JWT');

    // และ login ยังทำงานปกติเมื่อ audit กลับมาปกติ
    __resetRateLimitStoreForTests();
    const ok = await login(email, PASSWORD, 'ip-l5b');
    assertEqual(ok.status, 200, 'L5 login ปกติยังทำงาน');
  });

  console.log('\n=== Summary ===\n');
  console.log(`Total: ${passed} passed, ${failed} failed`);
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
