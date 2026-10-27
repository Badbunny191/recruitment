/**
 * R11: Bulk Status Hardening — POST /admin/applications/bulk-status
 * =======================================================================
 *
 * ปัญหาเดิม (production audit):
 *   1. handler อ่าน body ดิบ ๆ ไม่มี Zod validation — unknown status หลุด
 *      ไปจนเกิด 500 ใน service layer, payload ปลอม/ไม่ครบชิ้นไม่ถูก reject
 *   2. ส่ง status = DRAFT ได้ → ดันสถานะผู้สมัครย้อนกลับไป DRAFT ได้
 *   3. audit log (POST → auditMiddleware) ไม่บันทึก payload อะไรเลย
 *      (เดิม capture body เฉพาะ PATCH/PUT) — ตรวจสอบย้อนหลังไม่ได้
 *
 * การแก้:
 *   - Zod: BulkApplicationStatusUpdateSchema (reuse ApplicationStatusEnum
 *     ผ่าน UpdatableApplicationStatusEnum = exclude DRAFT) — payload ไม่ถูก
 *     ต้อง 400 เสมอ
 *   - DRAFT → 400 พร้อม message เฉพาะ "DRAFT status is not allowed in bulk updates"
 *   - audit payload ครบ: applicationIds + previousStatus (map id→สถานะเดิม)
 *     + newStatus + reason + actor ผ่าน setAuditPayload, action เป็น UPDATE
 *
 * ครอบคลุม:
 *   BS1.  valid bulk update → 200, สถานะเปลี่ยนจริง, audit สร้าง (Case 1)
 *   BS2.  status = DRAFT → 400 message เฉพาะ, ไม่แตะ DB, ไม่มี audit (Case 2)
 *   BS3.  unknown status → 400 (ไม่ใช่ 500), ไม่แตะ DB, ไม่มี audit (Case 3)
 *   BS4.  audit payload มี previousStatus/newStatus/applicationIds/actor (Case 4)
 *   BS5.  malformed payload ทุกรูปแบบ → 400 (Case 5)
 *   BS6.  REJECTED/CANCELED ไม่ระบุเหตุผล → 400 (behavior เดิมคงอยู่)
 *   BS7.  application ที่ถูกลบ (deletedAt) ไม่ถูกอัปเดต (behavior เดิม)
 *   BS8.  response รูปแบบเดิมครบ (success/updated/data) — ไม่ทำลาย contract
 *         (ใช้ QUALIFIED — ARCHIVED เป็น legacy-only แล้ว)
 *   BS9.  PATCH single status ARCHIVED → 400 (validation error, row ไม่เปลี่ยน)
 *   BS10. bulk ARCHIVED → 400 message เฉพาะ (deprecated) + row ไม่เปลี่ยน
 *   BS11. legacy: แถว ARCHIVED เดิมไม่ถูกแตะโดย operation อื่น +
 *         เปลี่ยนออกจาก ARCHIVED ได้ (escape hatch)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ admin-login-lockout.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/bulk-status-validation.test.ts
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

// ── D1-compatible adapter (แบบเดียวกับ admin-login-lockout.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-bulk-status';

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

const ADMIN_ID = 'admin-uuid-0001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin@test.local');

let appSeq = 0;
function insertApplication(opts: { status?: string; deleted?: boolean } = {}) {
  appSeq++;
  const id = `app-uuid-${String(appSeq).padStart(4, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, deleted_at)
       VALUES (?, ?, 'round-1', ?, ?, ?, ?)`
    )
    .run(
      id,
      `APP-2567-${String(appSeq).padStart(4, '0')}`,
      `applicant${appSeq}@test.local`,
      `ผู้สมัคร ${appSeq}`,
      opts.status ?? 'SUBMITTED',
      opts.deleted ? 1760000000 : null
    );
  return id;
}

function appRow(id: string): any {
  return sqlite.prepare('SELECT * FROM applications WHERE id = ?').get(id);
}

function auditRows(): any[] {
  return sqlite.prepare('SELECT * FROM audit_logs ORDER BY created_at, id').all();
}

async function bulkRequest(body: string | object | undefined) {
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
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    },
    env()
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function patchRequest(id: string, body: object) {
  const token = await sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  const res = await app.request(
    `/api/v1/admin/applications/${id}/status`,
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

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('R11: Bulk Status Hardening — Tests');
  console.log('=================================================\n');

  __resetRateLimitStoreForTests();

  // ---- BS1: Case 1 — valid bulk status update ----
  await test('BS1: valid bulk update → 200 + สถานะเปลี่ยนจริง + audit ถูกสร้าง', async () => {
    const id1 = insertApplication({ status: 'SUBMITTED' });
    const id2 = insertApplication({ status: 'SUBMITTED' });

    const res = await bulkRequest({ ids: [id1, id2], status: 'QUALIFIED' });

    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.success, true, 'body.success');
    assertEqual(res.body.updated, 2, 'body.updated');
    assertEqual(appRow(id1).status, 'QUALIFIED', 'row1 status');
    assertEqual(appRow(id2).status, 'QUALIFIED', 'row2 status');
    assertEqual(appRow(id1).verified_by, ADMIN_ID, 'row1 verified_by');

    const audits = auditRows();
    assertEqual(audits.length, 1, 'audit row count');
    assertEqual(audits[0].action, 'UPDATE', 'audit action = UPDATE (ไม่ใช่ CREATE)');
    assertEqual(audits[0].entity_type, 'APPLICATION', 'audit entity_type');
    assertEqual(audits[0].admin_id, ADMIN_ID, 'audit actor column');

    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BS2: Case 2 — status = DRAFT ----
  await test('BS2: status = DRAFT → 400 message เฉพาะ + ไม่แตะ DB + ไม่มี audit', async () => {
    const id = insertApplication({ status: 'QUALIFIED' });

    const res = await bulkRequest({ ids: [id], status: 'DRAFT' });

    assertEqual(res.status, 400, 'HTTP status');
    assertEqual(res.body.success, false, 'body.success');
    assertEqual(res.body.message, 'DRAFT status is not allowed in bulk updates', 'message');
    assertEqual(appRow(id).status, 'QUALIFIED', 'สถานะต้องไม่ถูกดันกลับ DRAFT');
    assertEqual(auditRows().length, 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BS3: Case 3 — unknown status ----
  await test('BS3: unknown status → 400 (ไม่ใช่ 500) + ไม่แตะ DB + ไม่มี audit', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });

    const res = await bulkRequest({ ids: [id], status: 'HACKED_STATUS' });

    assertEqual(res.status, 400, 'HTTP status ต้องเป็น 400 ไม่ใช่ 500');
    assertEqual(res.body.success, false, 'body.success');
    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยน');
    assertEqual(auditRows().length, 0, 'ห้ามสร้าง audit ตอน reject');

    // เคส status เป็น type อื่น (ตัวอย่างการดัน type ผ่านช่องโหว่เดิม)
    const res2 = await bulkRequest({ ids: [id], status: 123 });
    assertEqual(res2.status, 400, 'status ที่ไม่ใช่ string ต้อง 400');
    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยน (type ผิด)');
  });

  // ---- BS4: Case 4 — audit payload ครบ ----
  await test('BS4: audit payload มี previousStatus + newStatus + applicationIds + actor', async () => {
    const id1 = insertApplication({ status: 'SUBMITTED' });
    const id2 = insertApplication({ status: 'QUALIFIED' });

    const res = await bulkRequest({ ids: [id1, id2], status: 'REJECTED', reason: 'เอกสารไม่ครบ' });
    assertEqual(res.status, 200, 'HTTP status');

    const audits = auditRows();
    assertEqual(audits.length, 1, 'audit row count');
    // convention เดิมของระบบ: setAuditPayload รับ JSON string แล้ว drizzle
    // (payload mode 'json') stringify ซ้ำ → คอลัมน์ดิบต้อง parse สองชั้น
    const payload = JSON.parse(JSON.parse(audits[0].payload));
    assertEqual(payload.action, 'BULK_STATUS_UPDATE', 'payload.action');
    assertTrue(Array.isArray(payload.applicationIds), 'มี applicationIds เป็น array');
    assertEqual(payload.applicationIds.length, 2, 'applicationIds ครบ 2 รายการ');
    assertTrue(payload.applicationIds.includes(id1) && payload.applicationIds.includes(id2), 'applicationIds ตรงกับที่ส่งมา');
    assertEqual(payload.newStatus, 'REJECTED', 'มี newStatus');
    assertEqual(payload.previousStatus[id1], 'SUBMITTED', 'previousStatus[id1]');
    assertEqual(payload.previousStatus[id2], 'QUALIFIED', 'previousStatus[id2] (สถานะเดิมต่างกันได้ต่อใบ)');
    assertEqual(payload.actor, ADMIN_ID, 'มี actor');
    assertEqual(payload.reason, 'เอกสารไม่ครบ', 'มี reason');

    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BS5: Case 5 — malformed payload ----
  await test('BS5: malformed payload ทุกรูปแบบ → 400 + ไม่แตะ DB', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });
    const cases: Array<[string, string | object | undefined]> = [
      ['ids หาย', { status: 'QUALIFIED' }],
      ['ids เป็น string', { ids: 'not-an-array', status: 'QUALIFIED' }],
      ['ids ว่าง', { ids: [], status: 'QUALIFIED' }],
      ['ids มี item ว่าง', { ids: [''], status: 'QUALIFIED' }],
      ['status หาย', { ids: [id] }],
      ['body ไม่ใช่ JSON', 'not-json{'],
      ['body เป็น null', 'null'],
      ['ไม่มี body', undefined],
    ];

    for (const [label, body] of cases) {
      const res = await bulkRequest(body);
      assertEqual(res.status, 400, `malformed (${label}) ต้อง 400`);
      assertEqual(res.body.success, false, `malformed (${label}) success=false`);
    }

    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยนจาก malformed payload');
    assertEqual(auditRows().length, 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BS6: REJECTED/CANCELED ไม่ระบุเหตุผล → 400 (behavior เดิม) ----
  await test('BS6: REJECTED ไม่ระบุเหตุผล → 400 (behavior เดิมคงอยู่)', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });

    const res = await bulkRequest({ ids: [id], status: 'REJECTED' });
    assertEqual(res.status, 400, 'HTTP status');
    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยน');

    // ระบุเหตุผล whitespace เท่านั้นก็ต้องไม่ผ่าน (เดิม .trim() แล้วเช็ค)
    const res2 = await bulkRequest({ ids: [id], status: 'REJECTED', reason: '   ' });
    assertEqual(res2.status, 400, 'reason whitespace-only ต้อง 400');

    // CANCELED ต้องมีเหตุผลเช่นกัน
    const res3 = await bulkRequest({ ids: [id], status: 'CANCELED' });
    assertEqual(res3.status, 400, 'CANCELED ไม่ระบุเหตุผลต้อง 400');

    // ระบุเหตุผลแล้วผ่าน
    const res4 = await bulkRequest({ ids: [id], status: 'CANCELED', reason: 'ผู้สมัครขอยกเลิก' });
    assertEqual(res4.status, 200, 'CANCELED ระบุเหตุผลแล้วต้องผ่าน');
    assertEqual(appRow(id).status, 'CANCELED', 'สถานะเปลี่ยนเป็น CANCELED');

    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BS7: application ที่ถูกลบไม่ถูกอัปเดต (behavior เดิม) ----
  await test('BS7: application ที่ถูกลบ (deletedAt) ไม่ถูกอัปเดต', async () => {
    const liveId = insertApplication({ status: 'SUBMITTED' });
    const deletedId = insertApplication({ status: 'SUBMITTED', deleted: true });

    const res = await bulkRequest({ ids: [liveId, deletedId], status: 'QUALIFIED' });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(appRow(liveId).status, 'QUALIFIED', 'ใบปกติถูกอัปเดต');
    assertEqual(appRow(deletedId).status, 'SUBMITTED', 'ใบที่ลบแล้วต้องไม่ถูกแตะ');

    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BS8: response contract เดิมครบ ----
  // (ใช้ QUALIFIED — ARCHIVED เป็น legacy-only จึงไม่ใช้เป็นปลายทางใน contract test)
  await test('BS8: response รูปแบบเดิมครบ (success/updated/data) — ไม่ทำลาย contract', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });

    const res = await bulkRequest({ ids: [id], status: 'QUALIFIED' });
    assertEqual(res.status, 200, 'HTTP status');

    assertEqual(res.body.success, true, 'มี success');
    assertEqual(res.body.updated, 1, 'มี updated = จำนวน ids ที่ส่งมา');
    assertTrue(res.body.data && typeof res.body.data === 'object', 'มี data');
    assertEqual(res.body.data.status, 'QUALIFIED', 'data.status');
    assertEqual(res.body.data.reason, null, 'data.reason = null เมื่อไม่ส่ง');
    assertEqual(res.body.data.verifiedBy, ADMIN_ID, 'data.verifiedBy');
    assertTrue(typeof res.body.data.verifiedAt === 'number', 'data.verifiedAt เป็น unix timestamp');

    sqlite.prepare('DELETE FROM audit_logs').run();
  });

  // ---- BS9: PATCH single status ARCHIVED → 400 (ARCHIVED legacy-only) ----
  await test('BS9: PATCH single status ARCHIVED → 400 (validation error) + row ไม่เปลี่ยน + ไม่มี audit', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });

    const res = await patchRequest(id, { status: 'ARCHIVED' });
    assertEqual(res.status, 400, `HTTP status ต้องเป็น 400 (zod validation) ไม่ใช่ 200/500: ${res.status}`);
    assertTrue(res.body && res.body.success === false, 'body.success = false');
    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยน');
    assertEqual(auditRows().length, 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BS10: bulk ARCHIVED → 400 message เฉพาะ (deprecated) ----
  await test('BS10: bulk status ARCHIVED → 400 message deprecated + row ไม่เปลี่ยน + ไม่มี audit', async () => {
    const id = insertApplication({ status: 'SUBMITTED' });

    const res = await bulkRequest({ ids: [id], status: 'ARCHIVED' });
    assertEqual(res.status, 400, 'HTTP status');
    assertEqual(res.body.success, false, 'body.success');
    assertEqual(res.body.message, 'ARCHIVED status is deprecated and cannot be assigned to new updates', 'message');
    assertEqual(appRow(id).status, 'SUBMITTED', 'สถานะต้องไม่เปลี่ยน');
    assertEqual(auditRows().length, 0, 'ห้ามสร้าง audit ตอน reject');
  });

  // ---- BS11: legacy ARCHIVED ยังทำงานครบ (soft removal ไม่แตะข้อมูลเดิม) ----
  await test('BS11: legacy — แถว ARCHIVED เดิมไม่ถูกแตะโดย operation อื่น + เปลี่ยนออกจาก ARCHIVED ได้ (escape hatch)', async () => {
    const archivedId = insertApplication({ status: 'ARCHIVED' });
    const liveId = insertApplication({ status: 'SUBMITTED' });

    // bulk update ใบอื่น (คนละผู้สมัคร) ต้องไม่กระทบแถว legacy
    const res = await bulkRequest({ ids: [liveId], status: 'QUALIFIED' });
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(appRow(liveId).status, 'QUALIFIED', 'ใบปกติถูกอัปเดต');
    assertEqual(appRow(archivedId).status, 'ARCHIVED', 'แถว legacy ต้องยังเป็น ARCHIVED');

    // escape hatch: เปลี่ยนออกจาก ARCHIVED ไปสถานะอื่นได้ (ปลายทางห้ามเป็น ARCHIVED — zod คุมอยู่)
    const res2 = await patchRequest(archivedId, { status: 'QUALIFIED' });
    assertEqual(res2.status, 200, `escape hatch status=${res2.status} ${JSON.stringify(res2.body)}`);
    assertEqual(appRow(archivedId).status, 'QUALIFIED', 'แถว legacy เปลี่ยนออกจาก ARCHIVED ได้');

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
