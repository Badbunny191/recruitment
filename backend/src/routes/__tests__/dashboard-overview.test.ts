/**
 * Dashboard Overview — GET /admin/dashboard/overview
 * ===================================================
 * Endpoint เดียวแทน fan-out 5 endpoint ของ Dashboard V1
 * (applications/summary, applications, rounds, rounds/comparison, audit-logs)
 *
 * ครอบคลุม:
 *   1. SUPER_ADMIN → 200 + contract ครบทุก section + errors []
 *   2. pending aggregate ฝั่ง server (total/overdueCount/oldestSubmittedAt)
 *      — boundary 8 วันตรงนิยาม ageInDays ฝั่ง client
 *   3. summary parity กับ endpoint เดิม (byStatus ไม่มี DRAFT, total นับทุกแถว)
 *   4. rounds = view=active (ตัด soft-deleted)
 *   5. comparison parity กับ /rounds/comparison (รวมรอบ soft-deleted, รวม
 *      template ที่ไม่มี PUBLISHED เลย, needsUpdate เฉพาะ ACTIVE) แต่ไม่มี N+1
 *   6. activities (SUPER_ADMIN): 10 รายการใหม่สุดก่อน + display resolve ได้
 *      + ไม่มี payload/ipAddress หลุดออกจาก body (PII)
 *   7. ADMIN / VIEWER → 200 แต่ activities = null และไม่มีข้อมูล audit หลุด
 *   8. ไม่มี token → 401
 *   9. fail-soft: query ของ section ใดล้ม → 200 + errors[...] + ส่วนอื่นปกติ
 *
 * รัน SQL จริงบน better-sqlite3 ผ่าน D1-compatible adapter
 * (prepare/bind/all/run/raw/batch) และ mount adminRoutes จริง ครบ chain:
 * authMiddleware → accountStateGate → handler
 *
 * Run: node --import tsx src/routes/__tests__/dashboard-overview.test.ts
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
// failOn: (sql) => boolean — โยน error ตอน prepare เพื่อจำลอง query ล้มต่อ section
// =============================================================================

function createD1Adapter(sqlite: Database.Database, failOn?: (sqlText: string) => boolean) {
  const makeStatement = (sqlText: string) => {
    if (failOn?.(sqlText)) {
      throw new Error(`SIMULATED_DB_FAILURE: ${sqlText.slice(0, 80)}`);
    }
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

const TEST_JWT_SECRET = 'test-jwt-secret-dashboard-overview';

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

  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT,
    round_id TEXT NOT NULL,
    fullname TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT DEFAULT 'SUBMITTED',
    form_data TEXT NOT NULL DEFAULT '{}',
    submitted_at INTEGER,
    deleted_at INTEGER
  );

  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position_level TEXT NOT NULL,
    open_date INTEGER NOT NULL,
    close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    created_at INTEGER,
    deleted_at INTEGER,
    round_code TEXT
  );

  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at INTEGER
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

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

const NOW_SEC = Math.floor(Date.now() / 1000);
const DAY = 86_400;

// ── template versions: tplA มี v1/v2 PUBLISHED + v3 DRAFT; tplB มีแต่ DRAFT ──
function insertVersion(id: string, templateId: string, versionNumber: number, status: string) {
  sqlite
    .prepare(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES (?, ?, ?, ?)`)
    .run(id, templateId, versionNumber, status);
}
insertVersion('tplA-v1', 'tplA', 1, 'PUBLISHED');
insertVersion('tplA-v2', 'tplA', 2, 'PUBLISHED');
insertVersion('tplA-v3', 'tplA', 3, 'DRAFT');
insertVersion('tplB-v1', 'tplB', 1, 'DRAFT');

// ── rounds ──
function insertRound(opts: {
  id: string;
  title: string;
  versionId: string;
  status: string;
  deletedAt?: number | null;
  roundCode?: string;
}) {
  sqlite
    .prepare(
      `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level,
        open_date, close_date, status, deleted_at, round_code)
       VALUES (?, ?, ?, 'SENIOR', ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.versionId,
      opts.title,
      NOW_SEC - 30 * DAY,
      NOW_SEC + 30 * DAY,
      opts.status,
      opts.deletedAt ?? null,
      opts.roundCode ?? `RC-${opts.id}`,
    );
}
insertRound({ id: 'r-latest', title: 'รอบใช้ล่าสุด', versionId: 'tplA-v2', status: 'ACTIVE' });
insertRound({ id: 'r-outdated-active', title: 'รอบล้าสมัย (เปิดรับ)', versionId: 'tplA-v1', status: 'ACTIVE' });
insertRound({ id: 'r-outdated-closed', title: 'รอบล้าสมัย (ปิดแล้ว)', versionId: 'tplA-v1', status: 'CLOSED' });
insertRound({ id: 'r-no-publish', title: 'รอบ template ไม่มี published', versionId: 'tplB-v1', status: 'ACTIVE' });
insertRound({ id: 'r-deleted', title: 'รอบถูกลบ (แต่ comparison เดิมยังนับ)', versionId: 'tplA-v1', status: 'ACTIVE', deletedAt: NOW_SEC - DAY });

// ── applications ──
function insertApplication(opts: {
  id: string;
  applicationNo: string;
  fullname: string;
  status: string;
  submittedAt?: number | null;
  deletedAt?: number | null;
}) {
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, fullname, email, status, form_data, submitted_at, deleted_at)
       VALUES (?, ?, 'r-latest', ?, ?, ?, '{}', ?, ?)`,
    )
    .run(opts.id, opts.applicationNo, opts.fullname, `${opts.id}@test.com`, opts.status, opts.submittedAt ?? null, opts.deletedAt ?? null);
}

// SUBMITTED 2 ใบ: เก่า 8 วัน (overdue) + 7 วัน 1 ชั่วโมง (ยังไม่ overdue)
insertApplication({ id: 'app-old', applicationNo: 'APP-2026-0001', fullname: 'เก่าแปดวัน', status: 'SUBMITTED', submittedAt: NOW_SEC - 8 * DAY });
insertApplication({ id: 'app-recent', applicationNo: 'APP-2026-0002', fullname: 'เจ็ดวันชมเดียว', status: 'SUBMITTED', submittedAt: NOW_SEC - 7 * DAY - 3600 });
// SUBMITTED ที่ถูกลบ → ห้ามนับทั้ง pending และ summary
insertApplication({ id: 'app-deleted', applicationNo: 'APP-2026-0003', fullname: 'ถูกลบ', status: 'SUBMITTED', submittedAt: NOW_SEC - 20 * DAY, deletedAt: NOW_SEC - DAY });
// DRAFT (submitted_at NULL) → นับใน total แต่ไม่อยู่ใน byStatus (parity endpoint เดิม) และไม่ใช่งานค้าง
insertApplication({ id: 'app-draft', applicationNo: null, fullname: 'ยังร่าง', status: 'DRAFT', submittedAt: null });
insertApplication({ id: 'app-qualified', applicationNo: 'APP-2026-0004', fullname: 'ผ่านแล้ว', status: 'QUALIFIED', submittedAt: NOW_SEC - 3 * DAY });

// ── audit logs: 12 แถว created_at ต่างกัน (ordering deterministic) ──
function insertAuditLog(opts: { id: string; action: string; entityType: string; entityId: string; secondsAgo: number }) {
  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, payload, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, '{"email":"secret@example.com"}', '203.0.113.9', ?)`,
    )
    .run(opts.id, SA_ID, opts.action, opts.entityType, opts.entityId, NOW_SEC - opts.secondsAgo);
}

for (let i = 1; i <= 11; i++) {
  insertAuditLog({ id: `log-${i}`, action: 'LOGIN', entityType: 'TEST_ENTITY_UNKNOWN', entityId: 'x', secondsAgo: 12 - i });
}
// แถวใหม่สุด — APPLICATION ที่ resolve display ได้ (applicationNo + fullname)
insertAuditLog({ id: 'log-12', action: 'UPDATE', entityType: 'APPLICATION', entityId: 'app-old', secondsAgo: 0 });

function auditRowCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get() as any).n;
}

// =============================================================================
// Request helpers
// =============================================================================

async function signedRequest(path: string, jwtPayload: object | null, useD1: any = d1) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwtPayload) {
    const token = await sign(jwtPayload as any, TEST_JWT_SECRET);
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(
    `/api/v1/admin${path}`,
    { method: 'GET', headers },
    { DB: useD1, JWT_SECRET: TEST_JWT_SECRET },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function payloadFor(id: string, email: string, role: string) {
  return { id, email, role, exp: Math.floor(Date.now() / 1000) + 3600 };
}

// fail-soft test — adapter ล้มเมื่อโดน template_versions
// (ส่งเข้า signedRequest เป็น useD1 — app เดิม env คนละชุด)
const failingD1 = createD1Adapter(sqlite, (sqlText) => sqlText.includes('template_versions'));

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Dashboard Overview — GET /admin/dashboard/overview');
  console.log('=================================================\n');

  await test('SUPER_ADMIN → 200 + contract ครบทุก section + errors []', async () => {
    assertEqual(auditRowCount(), 12, 'fixture must seed 12 audit rows');
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    assertEqual(res.status, 200);
    const data = res.body.data;
    assertTrue(data, 'data must be present');
    assertTrue(data.summary && typeof data.summary.total === 'number', 'summary section must exist');
    assertTrue(data.pending && typeof data.pending.total === 'number', 'pending section must exist');
    assertTrue(Array.isArray(data.rounds), 'rounds section must be an array');
    assertTrue(Array.isArray(data.comparison), 'comparison section must be an array');
    assertTrue(data.activities && Array.isArray(data.activities.items), 'activities section must exist for SUPER_ADMIN');
    assertEqual(data.errors.length, 0, 'no section may fail in the happy path');
  });

  await test('pending aggregate ฝั่ง server: total=2, overdue=1, oldest=8 วัน, items 2 แถวใหม่สุดก่อน', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    const pending = res.body.data.pending;
    assertEqual(pending.total, 2, '2 SUBMITTED (ลบแล้ว/DRAFT/QUALIFIED ห้ามนับ)');
    assertEqual(pending.overdueCount, 1, 'เก่า 8 วันเกิน SLA 7 วัน / 7วัน+1ชม ยังไม่เกิน');
    assertEqual(pending.slaDays, 7);
    assertEqual(pending.items.length, 2, 'ส่งเฉพาะแถวตัวอย่าง (≤5) ไม่ใช่ 200 แถวแบบ V1');
    assertEqual(pending.items[0].id, 'app-recent', 'submittedAt ใหม่สุดก่อน');
    assertEqual(pending.items[1].id, 'app-old');
    assertTrue(pending.oldestSubmittedAt, 'oldestSubmittedAt must be present');
    const oldestAgeDays = Math.floor((Date.now() - new Date(pending.oldestSubmittedAt).getTime()) / 86_400_000);
    assertEqual(oldestAgeDays, 8, 'oldest = ใบเก่าสุด 8 วัน');
  });

  await test('summary parity endpoint เดิม: total นับทุกแถว (รวม DRAFT) แต่ byStatus ไม่มี key DRAFT', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    const summary = res.body.data.summary;
    assertEqual(summary.total, 4, 'old + recent + draft + qualified (ตัดที่ถูกลบ)');
    assertEqual(summary.byStatus.SUBMITTED, 2);
    assertEqual(summary.byStatus.QUALIFIED, 1);
    assertEqual(summary.byStatus.REJECTED, 0);
    assertEqual(summary.byStatus.CANCELED, 0);
    assertEqual(summary.byStatus.ARCHIVED, 0);
    assertTrue(!('DRAFT' in summary.byStatus), 'byStatus ต้องไม่มี DRAFT — parity กับ /applications/summary เดิม');
  });

  await test('rounds = view=active: ตัดรอบ soft-deleted', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    const rounds = res.body.data.rounds;
    assertEqual(rounds.length, 4, 'r-deleted ต้องหายไป');
    assertTrue(!rounds.some((r: any) => r.id === 'r-deleted'), 'soft-deleted round ห้ามอยู่ในรายการรอบ');
    assertTrue(rounds.every((r: any) => r.id && typeof r.title === 'string'), 'แต่ละแถวต้องมี id/title');
  });

  await test('comparison parity: 4 แถวที่ flagged ถูกต้อง + รอบใช้ล่าสุดไม่โผล่', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    const comparison = res.body.data.comparison;
    const byId = Object.fromEntries(comparison.map((r: any) => [r.roundId, r]));

    assertEqual(comparison.length, 4, 'r-latest ต้องถูกตัด (ไม่ outdated)');
    assertTrue(!byId['r-latest'], 'รอบที่ใช้ published ล่าสุดห้ามอยู่ใน comparison');

    const outdatedActive = byId['r-outdated-active'];
    assertEqual(outdatedActive.currentVersionNumber, 1);
    assertEqual(outdatedActive.latestVersionNumber, 2);
    assertEqual(outdatedActive.isOutdated, true);
    assertEqual(outdatedActive.needsUpdate, true, 'ACTIVE + outdated → needsUpdate');

    const outdatedClosed = byId['r-outdated-closed'];
    assertEqual(outdatedClosed.isOutdated, true);
    assertEqual(outdatedClosed.needsUpdate, false, 'CLOSED → medium severity path');

    const noPublish = byId['r-no-publish'];
    assertEqual(noPublish.isOutdated, true, 'template ไม่มี PUBLISHED เลย → outdated (parity endpoint เดิม)');
    assertEqual(noPublish.latestVersionNumber, 0);
    assertEqual(noPublish.needsUpdate, true);

    const deleted = byId['r-deleted'];
    assertTrue(deleted, 'comparison เดิมไม่ filter deletedAt — รอบถูกลบต้องยัง flagged (parity)');
    assertEqual(deleted.needsUpdate, true, 'status ACTIVE แม้ลบแล้ว → needsUpdate ตามสูตรเดิม');
  });

  await test('activities (SUPER_ADMIN): 10 รายการใหม่สุดก่อน + display resolve + ไม่หลุด payload/IP', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'));
    const items = res.body.data.activities.items;
    assertEqual(items.length, 10, 'limit 10 เหมือน activityLimit ของ V1');
    assertEqual(items[0].id, 'log-12', 'ใหม่สุดก่อน');
    assertEqual(items[1].id, 'log-11');
    assertEqual(items[9].id, 'log-3');

    const resolved = items[0];
    assertEqual(resolved.display?.name, 'APP-2026-0001', 'APPLICATION log ต้อง resolve เป็น applicationNo');
    assertEqual(resolved.display?.secondary, 'เก่าแปดวัน');

    const raw = JSON.stringify(items);
    assertTrue(!raw.includes('secret@example.com'), 'payload (email) ห้ามออกจาก body');
    assertTrue(!raw.includes('203.0.113.9'), 'ip_address ห้ามออกจาก body');
    assertTrue(!items.some((i: any) => 'payload' in i || 'ipAddress' in i), 'ห้ามมี field payload/ipAddress แม้เป็น null');
  });

  await test('ADMIN → 200 แต่ activities = null และไม่มีข้อมูล audit หลุดเลย', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(ADMIN_ID, 'admin@test.com', 'ADMIN'));
    assertEqual(res.status, 200, 'ADMIN ต้องอ่าน dashboard ได้');
    assertEqual(res.body.data.activities, null);
    assertEqual(res.body.data.errors.length, 0, 'ไม่มี activities ไม่ใช่ error');
    const raw = JSON.stringify(res.body);
    assertTrue(!raw.includes('log-1') && !raw.includes('LOGIN'), 'ต้องไม่มีแถว audit หลุดใน body');
    assertTrue(raw.includes('APP-2026-0002'), 'ส่วนงานค้างยังต้องมาปกติ');
  });

  await test('VIEWER → 200 (dashboard อ่านได้ทุก role ที่ login)', async () => {
    const res = await signedRequest('/dashboard/overview', payloadFor(VIEWER_ID, 'viewer@test.com', 'VIEWER'));
    assertEqual(res.status, 200);
    assertEqual(res.body.data.activities, null);
    assertEqual(res.body.data.summary.total, 4);
  });

  await test('ไม่มี token → 401 (authMiddleware ทำงานก่อน handler)', async () => {
    const res = await signedRequest('/dashboard/overview', null);
    assertEqual(res.status, 401);
    assertTrue(res.body.data === undefined, 'ห้ามมีข้อมูลหลุดเมื่อยังไม่ยืนยันตัวตน');
  });

  await test('fail-soft: query ของ comparison ล้ม → 200 + errors ["comparison"] ส่วนอื่นปกติ', async () => {
    const res = await signedRequest(
      '/dashboard/overview',
      payloadFor(SA_ID, 'sa@test.com', 'SUPER_ADMIN'),
      failingD1,
    );
    assertEqual(res.status, 200, 'section ล้มต้องไม่ทำทั้ง request ตาย');
    const data = res.body.data;
    assertEqual(data.comparison, null);
    assertEqual(data.errors.length, 1, 'ต้องรายงานเฉพาะ section ที่ล้ม');
    assertEqual(data.errors[0], 'comparison');
    assertTrue(data.summary && data.pending && Array.isArray(data.rounds), 'ส่วนอื่นยังต้องมาครบ');
    assertTrue(data.activities, 'activities ไม่เกี่ยวกับ section ที่ล้ม ต้องยังมา');
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
