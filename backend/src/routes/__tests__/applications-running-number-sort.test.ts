/**
 * Sort "เลขที่ใบสมัคร" = running number จริง ไม่ใช่ string sort
 * =============================================================================
 * branch: feature/applications-sort-export-wysiwyg
 *
 * ปัญหาที่แก้: application_no เป็น TEXT — เรียงด้วย string พังทันทีเมื่อ
 *   - เลขข้าม 9999 (APP-2569-12345 < APP-2569-9999 ในฐานะ string)
 *   - รอบ pattern (SAO-2 > SAO-10 ในฐานะ string)
 * ทางแก้: ORDER BY COALESCE(seq_in_round, NULLIF(เลขท้ายจาก application_no, 0))
 * (buildApplicationRunningNoExpr — lib/applications-list-query.ts)
 *
 * ครอบคลุม:
 *   RN1. desc: เลขมากกว่ามาก่อน ทั้งเคส 9999 vs 12345 (string sort ให้ผลตรงข้าม)
 *   RN2. asc: กลับด้านสมบูรณ์
 *   RN3. pattern row ใช้ seq_in_round เป็น key (application_no ไม่ใช่ APP-)
 *   RN4. application_no NULL / ไม่ลงท้ายเลข → ท้ายสุดเสมอทั้งสองทิศทาง
 *   RN5. ค่า default (ไม่ส่ง sort) = applicationNo-desc เช่นกัน
 *   RN6. แถวเลขซ้ำ (legacy APP- + seq) → tie-break id ASC
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ applications-list-pagination.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/applications-running-number-sort.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
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

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg} expected ${b}, got ${a}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── D1-compatible adapter (แบบเดียวกับ applications-list-pagination.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-running-number-sort';

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0
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

const ADMIN_ID = 'admin-uuid-rn-sort-001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin-rn@test.local');

// ── Seed — ใบสมัครเลขทะลุ 9999 + pattern + ไม่มีเลขที่ ──────────────────────
// ตั้งใจให้ submittedAt เพิ่มตามลำดับ insert (A ต่ำสุด) เพื่อให้ "ถ้าเรียงผิด
// ไปทาง default submittedAt DESC จะได้ลำดับกลับด้าน" → ตรวจจับได้ชัด
let appSeq = 0;
function insertApp(opts: { applicationNo?: string | null; seqInRound?: number | null } = {}) {
  appSeq++;
  const id = `app-rn-${String(appSeq).padStart(4, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO applications
         (id, application_no, round_id, email, fullname, status, form_data,
          submitted_at, deleted_at, year, round_code, seq_in_round)
       VALUES (?, ?, 'round-rn', ?, ?, 'SUBMITTED', '{}', ?, NULL, 2569, 'RN', ?)`
    )
    .run(
      id,
      opts.applicationNo === undefined ? `APP-2569-${String(appSeq).padStart(4, '0')}` : opts.applicationNo,
      `applicant-rn-${appSeq}@test.local`,
      `ผู้สมัคร RN ${appSeq}`,
      1761000000 + appSeq * 100, // เพิ่มตามลำดับ insert
      opts.seqInRound === undefined ? null : opts.seqInRound,
    );
  return id;
}

const rn = {
  // legacy rows (ก่อน migration 019) — seq_in_round NULL, parse เลขท้ายได้
  A_thousand: insertApp({ applicationNo: 'APP-2569-9999' }), // 4 หลัก
  B_tenK: insertApp({ applicationNo: 'APP-2569-12345' }), // 5 หลัก — string sort พังตรงนี้
  C_hundred: insertApp({ applicationNo: 'APP-2569-0100' }),
  E_one: insertApp({ applicationNo: 'APP-2569-0001' }),
  // pattern row — application_no ไม่ใช่รูป APP- แต่มี seq_in_round snapshot
  D_pattern: insertApp({ applicationNo: 'SAO-0002', seqInRound: 50 }),
  // ไม่มีเลขที่เลย — ต้องไปท้ายสุดเสมอ (F insert ก่อน G → tie id ASC = F ก่อน G)
  F_noNo: insertApp({ applicationNo: null }),
  G_noDigit: insertApp({ applicationNo: 'SPECIAL' }),
};

const RN_DESC = [rn.B_tenK, rn.A_thousand, rn.C_hundred, rn.D_pattern, rn.E_one, rn.F_noNo, rn.G_noDigit];
const RN_ASC = [rn.E_one, rn.D_pattern, rn.C_hundred, rn.A_thousand, rn.B_tenK, rn.F_noNo, rn.G_noDigit];

async function getToken() {
  return sign(
    { id: ADMIN_ID, email: 'admin-rn@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
}

async function getIds(query: string) {
  const token = await getToken();
  const res = await app.request(
    `/api/v1/admin/applications?roundId=round-rn${query}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    env(),
  );
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.data.map((r) => r.id);
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Running-number sort — Tests');
  console.log('=================================================\n');

  // ---- RN1: desc — เลขมากก่อน (string sort ให้ผลตรงข้าม) ----
  await test('RN1: sort=applicationNo-desc → 12345 > 9999 > 100 > pattern(50) > 1 (running number จริง)', async () => {
    const ids = await getIds('&sort=applicationNo-desc');
    assertDeepEqual(ids, RN_DESC, 'ลำดับตามรันนิ่ง DESC (ถ้าเป็น string sort จะได้ A มาก่อน B)');
  });

  // ---- RN2: asc กลับด้านสมบูรณ์ ----
  await test('RN2: sort=applicationNo-asc → กลับด้าน + แถวไม่มีเลขยังอยู่ท้าย', async () => {
    const ids = await getIds('&sort=applicationNo-asc');
    assertDeepEqual(ids, RN_ASC, 'ลำดับตามรันนิ่ง ASC (no-number ยังท้าย)');
  });

  // ---- RN3: pattern row ใช้ seq_in_round ----
  await test('RN3: pattern row (SAO-0002, seq=50) เรียงตาม seq_in_round ไม่ใช่ string "0002"', async () => {
    // ถ้าเรียง string "SAO-0002" จะไปอยู่ตำแหน่งตามอักษร 'S' (หลัง APP- ทั้งชุด)
    // แต่รันนิ่ง = 50 → ต้องอยู่ระหว่าง 100 กับ 1 ทั้ง desc
    const ids = await getIds('&sort=applicationNo-desc');
    const pos = ids.indexOf(rn.D_pattern);
    if (pos !== 3) {
      throw new Error(`pattern row ต้องอยู่ index 3 (ระหว่างเลข 100 กับ 1) แต่ได้ ${pos}`);
    }
  });

  // ---- RN4: application_no NULL / ไม่ลงท้ายเลข → ท้ายสุดทั้งสองทิศทาง ----
  await test('RN4: แถวไม่มีเลขที่ (NULL / ไม่ลงท้ายเลข) อยู่ท้ายเสมอ + tie id ASC', async () => {
    const descIds = await getIds('&sort=applicationNo-desc');
    assertDeepEqual(descIds.slice(-2), [rn.F_noNo, rn.G_noDigit], 'desc: ท้ายสุด F, G (id ASC)');
    const ascIds = await getIds('&sort=applicationNo-asc');
    assertDeepEqual(ascIds.slice(-2), [rn.F_noNo, rn.G_noDigit], 'asc: ท้ายสุด F, G (id ASC)');
  });

  // ---- RN5: default (ไม่ส่ง sort) = applicationNo-desc ----
  await test('RN5: ไม่ส่ง sort → default applicationNo-desc ได้ลำดับเดียวกัน', async () => {
    const ids = await getIds('');
    assertDeepEqual(ids, RN_DESC, 'default = เลขที่ใบสมัคร (ใหม่→เก่า)');
  });

  // ---- RN6: /ids endpoint ลำดับเดียวกับ list ----
  await test('RN6: /applications/ids ให้ลำดับ running number เดียวกับ list', async () => {
    const token = await getToken();
    const res = await app.request(
      '/api/v1/admin/applications/ids?roundId=round-rn&sort=applicationNo-desc',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      env(),
    );
    const body = await res.json().catch(() => null);
    assertEqual(res.status, 200, 'HTTP status');
    assertDeepEqual(body.data, RN_DESC, 'ids = list ids (ลำดับเดียวกัน)');
  });

  // ── สรุป ──
  console.log('\n=================================================');
  console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nฟอร์มที่ล้มเหลว:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('=================================================');

  if (failed > 0) process.exit(1);
}

runAllTests();
