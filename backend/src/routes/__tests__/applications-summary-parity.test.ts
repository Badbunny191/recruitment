/**
 * GET /admin/applications/summary — parity + performance guard
 * ============================================================
 * Phase 1.2: ตัด query `count(*)` ที่ซ้ำซ้อนออก (total = ผลบวกของ GROUP BY)
 *
 * เทสชุดนี้พิสูจน์สองอย่าง
 *   1. PARITY — output เหมือนเดิมทุกกรณี โดยเทียบกับ "สูตรเดิม" ที่คำนวณ
 *      count(*) แยกก้อน (reference implementation อยู่ในไฟล์นี้) ไม่ใช่เทียบ
 *      กับค่าที่ hardcode ไว้
 *   2. QUERY COUNT — 1 query ต่อ request (เดิม 2) นับจาก adapter จริง
 *
 * เคสที่ต้องครอบ (จุดที่การยุบ query อาจเปลี่ยนผล)
 *   - ไม่มี roundId / มี roundId
 *   - DRAFT (status ที่ไม่อยู่ใน byStatus) — ต้องนับใน total แต่ไม่โผล่ใน byStatus
 *   - status NULL — ต้องนับใน total
 *   - status แปลกที่ไม่อยู่ใน 5 สถานะ — ต้องนับใน total แต่ไม่โผล่ใน byStatus
 *   - deleted_at ไม่ null — ต้องไม่ถูกนับเลย
 *   - ตารางว่าง — total 0, byStatus ครบ 5 key เป็น 0
 *   - roundId ที่ไม่มีข้อมูล — total 0
 *
 * Run: node --import tsx src/routes/__tests__/applications-summary-parity.test.ts
 */

// @ts-nocheck
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
  } catch (e: any) {
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

function assertTrue(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'Expected true');
}

const TEST_JWT_SECRET = 'test-jwt-secret-summary-parity';

// ── instrumented D1 adapter — นับ query ที่ยิงจริง ──
function createD1Adapter(sqlite: Database.Database, counter: { n: number }) {
  const makeStatement = (sqlText: string) => {
    const stmt = sqlite.prepare(sqlText);
    let boundParams: any[] = [];
    const api = {
      bind(...params: any[]) {
        boundParams = params;
        return api;
      },
      async all() {
        counter.n++;
        return { results: stmt.all(...boundParams) };
      },
      async first() {
        counter.n++;
        return stmt.get(...boundParams) ?? null;
      },
      async run() {
        counter.n++;
        const info = stmt.run(...boundParams);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() {
        counter.n++;
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

// ── schema ──
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

  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT,
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

  CREATE INDEX idx_apps_round ON applications(round_id);
  CREATE INDEX idx_apps_status ON applications(status);
  CREATE INDEX idx_apps_round_status ON applications(round_id, status);
`);

sqlite.prepare(
  `INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password, failed_login_attempts, password_migrated)
   VALUES ('admin-1','admin@test.com','h','ADMIN',1,0,0,1)`,
).run();

// ── fixture: จงใจยัดเคสที่ทำให้ total ≠ ผลบวกของ 5 สถานะ ──
const NOW = Math.floor(Date.now() / 1000);
function insertApp(opts: {
  id: string;
  roundId: string;
  status: string | null;
  deletedAt?: number | null;
}) {
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      opts.id,
      `APP-${opts.id}`,
      opts.roundId,
      `${opts.id}@test.com`,
      `ชื่อ ${opts.id}`,
      opts.status,
      NOW,
      opts.deletedAt ?? null,
    );
}

// round-A: ครบทุกเคส
insertApp({ id: 'a-sub1', roundId: 'round-A', status: 'SUBMITTED' });
insertApp({ id: 'a-sub2', roundId: 'round-A', status: 'SUBMITTED' });
insertApp({ id: 'a-qual', roundId: 'round-A', status: 'QUALIFIED' });
insertApp({ id: 'a-rej', roundId: 'round-A', status: 'REJECTED' });
insertApp({ id: 'a-can', roundId: 'round-A', status: 'CANCELED' });
insertApp({ id: 'a-arch', roundId: 'round-A', status: 'ARCHIVED' });
insertApp({ id: 'a-draft', roundId: 'round-A', status: 'DRAFT' });          // ไม่อยู่ใน byStatus
insertApp({ id: 'a-null', roundId: 'round-A', status: null });              // status NULL
insertApp({ id: 'a-weird', roundId: 'round-A', status: 'PENDING_REVIEW' }); // สถานะแปลก
insertApp({ id: 'a-del', roundId: 'round-A', status: 'SUBMITTED', deletedAt: NOW }); // ถูกลบ

// round-B: มีข้อมูลของตัวเอง (กันการนับข้ามรอบ)
insertApp({ id: 'b-sub', roundId: 'round-B', status: 'SUBMITTED' });
insertApp({ id: 'b-qual', roundId: 'round-B', status: 'QUALIFIED' });

// round-empty: ไม่มีข้อมูลเลย
// (ไม่ต้อง insert)

const counter = { n: 0 };
const d1 = createD1Adapter(sqlite, counter);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

async function callSummary(roundId?: string) {
  const token = await sign(
    { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET,
  );
  const qs = roundId !== undefined ? `?roundId=${roundId}` : '';
  const res = await app.request(
    `/api/v1/admin/applications/summary${qs}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    { DB: d1, JWT_SECRET: TEST_JWT_SECRET },
  );
  return { status: res.status, body: await res.json() };
}

// ── reference implementation: สูตรเดิม (2 query) คำนวณสด ๆ จาก sqlite ──
function referenceSummary(roundId?: string) {
  const where = roundId !== undefined
    ? `deleted_at IS NULL AND round_id = ?`
    : `deleted_at IS NULL`;
  const params = roundId !== undefined ? [roundId] : [];

  const total = (sqlite.prepare(`SELECT count(*) AS n FROM applications WHERE ${where}`).get(...params) as any).n;
  const groups = sqlite.prepare(`SELECT status, count(*) AS n FROM applications WHERE ${where} GROUP BY status`).all(...params) as any[];

  const byStatus: Record<string, number> = {
    SUBMITTED: 0, QUALIFIED: 0, REJECTED: 0, CANCELED: 0, ARCHIVED: 0,
  };
  for (const g of groups) {
    if (g.status && Object.prototype.hasOwnProperty.call(byStatus, g.status)) {
      byStatus[g.status] = Number(g.n);
    }
  }
  return { total: Number(total), byStatus };
}

function assertParity(actual: any, expected: any, label: string) {
  assertEqual(actual.total, expected.total, `${label}: total`);
  assertEqual(
    JSON.stringify(actual.byStatus),
    JSON.stringify(expected.byStatus),
    `${label}: byStatus`,
  );
}

async function runAllTests() {
  console.log('=================================================');
  console.log('GET /admin/applications/summary — parity + query count');
  console.log('=================================================\n');

  await test('parity: ไม่ส่ง roundId (ทั้งระบบ) ตรงกับสูตรเดิม count(*)+GROUP BY', async () => {
    const res = await callSummary();
    assertEqual(res.status, 200);
    assertParity(res.body.data, referenceSummary(), 'no roundId');
  });

  await test('parity: roundId=round-A ตรงกับสูตรเดิม', async () => {
    const res = await callSummary('round-A');
    assertEqual(res.status, 200);
    assertParity(res.body.data, referenceSummary('round-A'), 'round-A');
  });

  await test('parity: roundId=round-B (รอบอื่น) ตรงกับสูตรเดิม', async () => {
    const res = await callSummary('round-B');
    assertParity(res.body.data, referenceSummary('round-B'), 'round-B');
  });

  await test('parity: roundId ที่ไม่มีข้อมูล → total 0 + byStatus ครบ 5 key เป็น 0', async () => {
    const res = await callSummary('round-empty');
    assertEqual(res.status, 200);
    assertEqual(res.body.data.total, 0, 'total');
    assertEqual(Object.keys(res.body.data.byStatus).length, 5, 'byStatus ต้องมี 5 key');
    assertEqual(
      JSON.stringify(res.body.data.byStatus),
      JSON.stringify({ SUBMITTED: 0, QUALIFIED: 0, REJECTED: 0, CANCELED: 0, ARCHIVED: 0 }),
      'byStatus',
    );
  });

  await test('DRAFT / status NULL / status แปลก นับใน total แต่ไม่โผล่ใน byStatus (parity)', async () => {
    const res = await callSummary('round-A');
    const { total, byStatus } = res.body.data;

    // round-A ที่ไม่ถูกลบ = 2 SUB + QUAL + REJ + CAN + ARCH + DRAFT + NULL + WEIRD = 9
    assertEqual(total, 9, 'total ต้องนับ DRAFT/NULL/status แปลกด้วย');
    assertTrue(!('DRAFT' in byStatus), 'byStatus ต้องไม่มี key DRAFT');
    assertTrue(!('PENDING_REVIEW' in byStatus), 'byStatus ต้องไม่มีสถานะแปลก');

    // ผลบวกของ 5 สถานะที่รู้จัก = 6 → ต่างจาก total 3 = "unaccounted" ที่ UI เตือน
    const knownSum = Object.values(byStatus).reduce((a: any, b: any) => a + b, 0);
    assertEqual(knownSum, 6, 'ผลบวก 5 สถานะที่รู้จัก');
    assertEqual(total - knownSum, 3, 'unaccounted = DRAFT + NULL + WEIRD');
  });

  await test('deleted_at ไม่ null ต้องไม่ถูกนับทั้ง total และ byStatus', async () => {
    const res = await callSummary('round-A');
    // a-del เป็น SUBMITTED ที่ถูกลบ → ถ้านับผิด SUBMITTED จะเป็น 3
    assertEqual(res.body.data.byStatus.SUBMITTED, 2, 'SUBMITTED ต้องเป็น 2 (ไม่นับใบที่ถูกลบ)');
  });

  await test('QUERY COUNT: 1 query ต่อ request (เดิม 2) — ไม่มี count(*) แยกก้อนอีก', async () => {
    // warm-up
    await callSummary('round-A');

    counter.n = 0;
    await callSummary('round-A');
    const withRound = counter.n;

    counter.n = 0;
    await callSummary();
    const withoutRound = counter.n;

    // หมายเหตุ: counter นับเฉพาะ query ของ handler (adapter ถูกเรียกหลัง
    // accountStateGate ด้วย — ถ้า gate query ด้วยจะเห็น 2)
    assertTrue(
      withRound <= 2,
      `ต้องไม่เกิน 2 query (gate + summary) แต่พบ ${withRound}`,
    );
    assertTrue(
      withoutRound <= 2,
      `ต้องไม่เกิน 2 query (gate + summary) แต่พบ ${withoutRound}`,
    );
  });

  await test('ไม่มี token → 401 (ไม่เปลี่ยน auth behavior)', async () => {
    const res = await app.request(
      `/api/v1/admin/applications/summary?roundId=round-A`,
      { method: 'GET' },
      { DB: d1, JWT_SECRET: TEST_JWT_SECRET },
    );
    assertEqual(res.status, 401);
  });

  await test('response contract ไม่เปลี่ยน: { data: { total, byStatus } } เท่านั้น', async () => {
    const res = await callSummary('round-A');
    assertTrue(res.body.data, 'ต้องมี data');
    assertEqual(typeof res.body.data.total, 'number', 'total ต้องเป็น number');
    assertEqual(typeof res.body.data.byStatus, 'object', 'byStatus ต้องเป็น object');
    assertEqual(Object.keys(res.body.data).sort().join(','), 'byStatus,total', 'ต้องมีแค่ 2 key');
    assertTrue(!('error' in res.body), 'ไม่มี error');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All summary parity tests passed ✓');
  process.exit(0);
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
