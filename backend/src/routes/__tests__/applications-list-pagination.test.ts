/**
 * Phase 1-3: GET /admin/applications — column projection + optional pagination
 * =============================================================================
 * branch: feature/applications-server-pagination
 *
 * ครอบคลุม:
 *   PG1.  ไม่ส่ง page → behavior เดิม: คืนทุกแถว, ไม่มี pagination ใน response
 *   PG2.  response มี 7 คอลัมน์ที่อนุมัติเท่านั้น (ไม่มี formData / nationalId /
 *         statusReason / verifiedBy / verifiedAt / deletedAt / year /
 *         roundCode / seqInRound)
 *   PG3.  sort default = submittedAt DESC (tie-break id ASC)
 *   PG4.  page=1&pageSize=N → data N แถว + pagination {page,pageSize,total,totalPages}
 *   PG5.  page=2 → แถวต่อจากหน้า 1, ไม่ซ้ำ, ครบทุกแถวเมื่อรวมกัน
 *   PG6.  page เกินขอบ → data ว่าง แต่ pagination.total ยังถูกต้อง
 *   PG7.  page/pageSize ไม่ valid (0, -1, abc, pageSize>200) → 400
 *   PG8.  filters roundId/status/search ทำงาน + deletedAt ถูกกรองออก
 *   PG9.  GET /applications/ids → array ของ id, filter เดียวกัน, ลำดับเดียวกับ list
 *   PG10. /applications/ids ไม่ถูกจับโดย /applications/:id (route order)
 *   PG11. ids ตรงกับ id ของ list แบบเต็ม (ไม่ paginate) ทุกตัว ทุกลำดับ
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ bulk-status-validation.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/applications-list-pagination.test.ts
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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg} expected ${b}, got ${a}`);
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

const TEST_JWT_SECRET = 'test-secret-apps-list-pagination';

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

const ADMIN_ID = 'admin-uuid-list-0001';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run(ADMIN_ID, 'admin@test.local');

// ── Seed ข้อมูลสังเคราะห์ ──────────────────────────────────────────────────
// 7 แถวใน round-1 (submittedAt ลดหลั่นกันชัดเจน), 2 แถวใน round-2,
// 1 แถว deleted, 1 แถว DRAFT — รวม 11 แถวในตาราง
let appSeq = 0;
function insertApplication(opts: {
  roundId?: string;
  status?: string;
  deleted?: boolean;
  submittedAt?: number;
  fullname?: string;
} = {}) {
  appSeq++;
  const id = `app-list-${String(appSeq).padStart(4, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO applications
         (id, application_no, round_id, email, fullname, national_id, status,
          form_data, submitted_at, deleted_at, year, round_code, seq_in_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2569, ?, ?)`
    )
    .run(
      id,
      `APP-2569-${String(appSeq).padStart(4, '0')}`,
      opts.roundId ?? 'round-1',
      `applicant${appSeq}@test.local`,
      opts.fullname ?? `ผู้สมัคร ${appSeq}`,
      `123456789012${appSeq}`,
      opts.status ?? 'SUBMITTED',
      JSON.stringify({ big: 'x'.repeat(500), seq: appSeq }), // formData ก้อนใหญ่ — ต้องไม่หลุดมาใน list
      opts.submittedAt ?? 1760000000 + appSeq * 100,
      opts.deleted ? 1760999999 : null,
      opts.roundId === 'round-2' ? 'R2' : 'R1',
      appSeq
    );
  return id;
}

// round-1: 7 แถว (submittedAt 1760000100..1760000700 — เรียงตามลำดับ insert)
const r1 = {
  a: insertApplication({ status: 'SUBMITTED' }),
  b: insertApplication({ status: 'QUALIFIED' }),
  c: insertApplication({ status: 'SUBMITTED', fullname: 'สมชาย ค้นหาเจอ' }),
  d: insertApplication({ status: 'REJECTED' }),
  e: insertApplication({ status: 'SUBMITTED' }),
  f: insertApplication({ status: 'QUALIFIED' }),
  g: insertApplication({ status: 'SUBMITTED' }),
};
// round-2: 2 แถว
const r2 = {
  h: insertApplication({ roundId: 'round-2', status: 'SUBMITTED' }),
  i: insertApplication({ roundId: 'round-2', status: 'QUALIFIED' }),
};
// deleted 1 แถว (round-1) + DRAFT 1 แถว (round-1)
const deletedId = insertApplication({ status: 'SUBMITTED', deleted: true });
const draftId = insertApplication({ status: 'DRAFT' });

// ── round-3: ชุดทดสอบ server-side sort (Phase 1) ───────────────────────────
// ตั้งใจให้ชื่อเป็น ASCII ที่ case ต่างกัน → พิสูจน์ว่า COLLATE NOCASE ทำงาน
// (ถ้าเป็น BINARY collation ลำดับจะเพี้ยนเป็น Bravo, Delta, alpha, charlie)
// และมีชื่อซ้ำ (echo/ECHO) → พิสูจน์ tie-break submittedAt DESC, id ASC
const r3 = {
  alpha: insertApplication({ roundId: 'round-3', fullname: 'alpha', submittedAt: 1760001000 }),
  bravo: insertApplication({ roundId: 'round-3', fullname: 'Bravo', submittedAt: 1760002000 }),
  charlie: insertApplication({ roundId: 'round-3', fullname: 'charlie', submittedAt: 1760003000 }),
  delta: insertApplication({ roundId: 'round-3', fullname: 'Delta', submittedAt: 1760004000 }),
  dupOld: insertApplication({ roundId: 'round-3', fullname: 'echo', submittedAt: 1760005000 }),
  dupNew: insertApplication({ roundId: 'round-3', fullname: 'ECHO', submittedAt: 1760006000 }),
};

// แถว submittedAt = NULL — client เดิมคำนวณเป็น NaN แล้วจัดไว้ "ท้าย" เสมอ
// ทั้ง asc และ desc; server ต้องให้ผลเหมือนกัน (nulls last)
appSeq++;
const r3Null = `app-list-${String(appSeq).padStart(4, '0')}`;
sqlite
  .prepare(
    `INSERT INTO applications
       (id, application_no, round_id, email, fullname, national_id, status,
        form_data, submitted_at, deleted_at, year, round_code, seq_in_round)
     VALUES (?, ?, 'round-3', ?, 'zzz-null', '1234567890129', 'SUBMITTED', '{}', NULL, NULL, 2569, 'R1', ?)`
  )
  .run(r3Null, `APP-2569-${String(appSeq).padStart(4, '0')}`, `applicant${appSeq}@test.local`, appSeq);

async function getToken() {
  return sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
}

async function getJson(path: string) {
  const token = await getToken();
  const res = await app.request(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }, env());
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ลำดับ expected ของ round-1 (ไม่รวม deleted): submittedAt DESC
// insert order a..g → submittedAt เพิ่มทีละ 100 → DESC = g,f,e,d,c,b,a (+draft ล่าสุด)
const ROUND1_DESC = [draftId, r1.g, r1.f, r1.e, r1.d, r1.c, r1.b, r1.a];

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Phase 1-3: Applications List Pagination — Tests');
  console.log('=================================================\n');

  // ---- PG1: ไม่ส่ง page = behavior เดิม ----
  await test('PG1: no page param → ทุกแถว, ไม่มี pagination key', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1');
    assertEqual(res.status, 200, 'HTTP status');
    assertTrue(Array.isArray(res.body.data), 'data เป็น array');
    assertEqual(res.body.data.length, 8, 'จำนวนแถว round-1 (7 + DRAFT, ไม่รวม deleted)');
    assertEqual(res.body.pagination, undefined, 'ไม่มี pagination เมื่อไม่ส่ง page');
  });

  // ---- PG2: contract คอลัมน์ใหม่ — 7 ตัวเท่านั้น ----
  await test('PG2: rows มี 7 คอลัมน์ที่อนุมัติ ไม่มี formData และไม่มีคอลัมน์ที่ตัดออก', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1');
    const row = res.body.data.find((r) => r.id === r1.a);
    assertTrue(row, 'พบแถวที่ seed ไว้');

    const EXPECTED = ['id', 'applicationNo', 'fullname', 'email', 'status', 'submittedAt', 'roundId'];
    assertDeepEqual(Object.keys(row).sort(), [...EXPECTED].sort(), 'ชุดคอลัมน์ต้องตรงเป๊ะ (ไม่มีเกิน ไม่มีขาด)');

    for (const col of EXPECTED) {
      assertTrue(col in row, `คอลัมน์ ${col} ต้องมีใน response`);
    }

    // คอลัมน์ที่ตัดออกต้องไม่โผล่กลับมา
    const REMOVED = ['formData', 'nationalId', 'statusReason', 'verifiedBy', 'verifiedAt',
      'deletedAt', 'year', 'roundCode', 'seqInRound'];
    for (const col of REMOVED) {
      assertEqual(row[col], undefined, `คอลัมน์ ${col} ต้องไม่อยู่ใน response`);
      assertTrue(!(col in row), `คอลัมน์ ${col} ต้องไม่มี key ด้วย`);
    }

    assertEqual(row.id, r1.a, 'id ตรง');
    assertEqual(row.roundId, 'round-1', 'roundId ตรง');
  });

  // ---- PG3: sort default = submittedAt DESC ----
  await test('PG3: default sort = submittedAt DESC (tie-break id ASC)', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1');
    const ids = res.body.data.map((r) => r.id);
    assertDeepEqual(ids, ROUND1_DESC, 'ลำดับ submittedAt DESC');
    // ตรวจ submittedAt ไม่เพิ่ม
    const times = res.body.data.map((r) => r.submittedAt);
    for (let i = 1; i < times.length; i++) {
      assertTrue(times[i - 1] >= times[i], `submittedAt ต้องไม่เพิ่มขึ้นที่ index ${i}`);
    }
  });

  // ---- PG4: page=1&pageSize=3 ----
  await test('PG4: page=1&pageSize=3 → 3 แถว + pagination ครบ', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1&page=1&pageSize=3');
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.data.length, 3, 'จำนวนแถว = pageSize');
    assertDeepEqual(res.body.data.map((r) => r.id), ROUND1_DESC.slice(0, 3), 'แถว = 3 อันดับแรก');
    assertDeepEqual(res.body.pagination, { page: 1, pageSize: 3, total: 8, totalPages: 3 }, 'pagination object');
  });

  // ---- PG5: page=2 ต่อเนื่อง ไม่ซ้ำ ----
  await test('PG5: page 1+2+3 รวมกัน = ชุดเต็ม ไม่ซ้ำ ไม่หาย', async () => {
    const p1 = await getJson('/api/v1/admin/applications?roundId=round-1&page=1&pageSize=3');
    const p2 = await getJson('/api/v1/admin/applications?roundId=round-1&page=2&pageSize=3');
    const p3 = await getJson('/api/v1/admin/applications?roundId=round-1&page=3&pageSize=3');
    const combined = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((r) => r.id);
    assertDeepEqual(combined, ROUND1_DESC, 'รวม 3 หน้า = ชุดเต็มเรียงเดิม');
    assertEqual(new Set(combined).size, combined.length, 'ไม่มี id ซ้ำ');
    assertEqual(p2.body.pagination.page, 2, 'pagination.page สะท้อน request');
  });

  // ---- PG6: page เกินขอบ ----
  await test('PG6: page เกิน totalPages → data ว่าง, total คงเดิม', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1&page=99&pageSize=3');
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.data.length, 0, 'data ว่าง');
    assertEqual(res.body.pagination.total, 8, 'total ยังนับครบ');
    assertEqual(res.body.pagination.totalPages, 3, 'totalPages');
  });

  // ---- PG7: invalid page/pageSize → 400 ----
  await test('PG7: page/pageSize ไม่ valid → 400', async () => {
    for (const qs of ['page=0', 'page=-1', 'page=abc', 'page=1.5',
      'page=1&pageSize=0', 'page=1&pageSize=-5', 'page=1&pageSize=xyz',
      'page=1&pageSize=201']) {
      const res = await getJson(`/api/v1/admin/applications?roundId=round-1&${qs}`);
      assertEqual(res.status, 400, `?${qs} → 400`);
      assertTrue(typeof res.body.error === 'string' && res.body.error.length > 0, `?${qs} → error message`);
    }
    // pageSize=200 = ขอบบน ต้องผ่าน
    const ok = await getJson('/api/v1/admin/applications?roundId=round-1&page=1&pageSize=200');
    assertEqual(ok.status, 200, 'pageSize=200 (max) → 200');
  });

  // ---- PG8: filters ----
  await test('PG8: roundId/status/search filter ถูกต้อง + deleted ถูกกรอง', async () => {
    // roundId
    const r2res = await getJson('/api/v1/admin/applications?roundId=round-2');
    assertDeepEqual(r2res.body.data.map((r) => r.id).sort(), [r2.h, r2.i].sort(), 'round-2 ได้ 2 แถว');

    // status
    const qual = await getJson('/api/v1/admin/applications?roundId=round-1&status=QUALIFIED');
    assertDeepEqual(qual.body.data.map((r) => r.id).sort(), [r1.b, r1.f].sort(), 'QUALIFIED ใน round-1 = 2 แถว');

    // search (fullname)
    const found = await getJson(`/api/v1/admin/applications?search=${encodeURIComponent('สมชาย')}`);
    assertEqual(found.body.data.length, 1, 'search เจอ 1 แถว');
    assertEqual(found.body.data[0].id, r1.c, 'search เจอแถวที่ถูก');

    // deleted ไม่โผล่ที่ไหนเลย
    const all = await getJson('/api/v1/admin/applications');
    assertTrue(!all.body.data.some((r) => r.id === deletedId), 'แถว deleted ต้องไม่อยู่ใน list');
    // DRAFT ยังโผล่ (semantics เดิม — endpoint นี้ไม่กรอง DRAFT)
    assertTrue(all.body.data.some((r) => r.id === draftId), 'DRAFT ยังอยู่ใน list (behavior เดิม)');

    // filter + pagination ทำงานร่วมกัน
    const paged = await getJson('/api/v1/admin/applications?roundId=round-1&status=SUBMITTED&page=1&pageSize=2');
    // SUBMITTED ใน round-1 = a, c, e, g (draft = DRAFT, deleted ถูกกรอง)
    assertEqual(paged.body.pagination.total, 4, 'total ของ SUBMITTED ใน round-1');
    assertEqual(paged.body.data.length, 2, 'data = pageSize');
  });

  // ---- PG9: /applications/ids ----
  await test('PG9: /applications/ids → array ของ id, filter + ลำดับเดียวกับ list', async () => {
    const res = await getJson('/api/v1/admin/applications/ids?roundId=round-1');
    assertEqual(res.status, 200, 'HTTP status');
    assertTrue(Array.isArray(res.body.data), 'data เป็น array');
    assertDeepEqual(res.body.data, ROUND1_DESC, 'id เรียง submittedAt DESC เหมือน list');
    assertTrue(res.body.data.every((x) => typeof x === 'string'), 'ทุกตัวเป็น string id');

    // filter ตรงกับ list
    const qual = await getJson('/api/v1/admin/applications/ids?roundId=round-1&status=QUALIFIED');
    assertDeepEqual(qual.body.data.sort(), [r1.b, r1.f].sort(), 'ids + status filter');

    // deleted ไม่โผล่
    assertTrue(!res.body.data.includes(deletedId), 'deleted id ต้องไม่อยู่ใน ids');
  });

  // ---- PG10: route order — /ids ไม่ถูกจับโดย /:id ----
  await test('PG10: /applications/ids ไม่ตกไป /applications/:id', async () => {
    const res = await getJson('/api/v1/admin/applications/ids');
    assertEqual(res.status, 200, 'HTTP status (ไม่ใช่ 404/500 จาก :id handler)');
    assertTrue(Array.isArray(res.body.data), 'response เป็น ids array ไม่ใช่ detail object');
    // ถ้าหลุดไป /:id จะได้ object ที่มี error หรือ application detail — ไม่ใช่ array ของ id ทั้งตาราง
    assertTrue(res.body.data.length >= 10, 'ได้ id ทั้งหมด (ไม่ filter) ≥ 10 แถวที่ไม่ deleted');
  });

  // ---- PG11: ids ≡ full list ids ----
  await test('PG11: ids ตรงกับ id ของ list เต็มทุกตัวทุกลำดับ', async () => {
    const [list, ids] = await Promise.all([
      getJson('/api/v1/admin/applications'),
      getJson('/api/v1/admin/applications/ids'),
    ]);
    assertDeepEqual(ids.body.data, list.body.data.map((r) => r.id), 'ids = list ids (ลำดับเดียวกัน)');
  });

  // ===========================================================================
  // Phase 1: server-side sort
  // ===========================================================================

  // ---- PG12: sort=submittedAt-asc ----
  await test('PG12: sort=submittedAt-asc → ลำดับเก่า→ใหม่ + tie-break id ASC', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-1&sort=submittedAt-asc');
    assertEqual(res.status, 200, 'HTTP status');
    assertDeepEqual(
      res.body.data.map((r) => r.id),
      [...ROUND1_DESC].reverse(),
      'ลำดับกลับจาก default (submittedAt ASC, id ASC)',
    );
  });

  // ---- PG13: sort=fullname-asc (NOCASE) ----
  await test('PG13: sort=fullname-asc → A-Z แบบ case-insensitive + tie-break', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-3&sort=fullname-asc');
    assertEqual(res.status, 200, 'HTTP status');
    assertDeepEqual(
      res.body.data.map((r) => r.id),
      // alpha, Bravo, charlie, Delta (NOCASE) → echo/ECHO เท่ากัน →
      // tie-break submittedAt DESC → dupNew (ใหม่กว่า) มาก่อน dupOld → null ท้ายสุด
      [r3.alpha, r3.bravo, r3.charlie, r3.delta, r3.dupNew, r3.dupOld, r3Null],
      'NOCASE asc + tie-break submittedAt DESC, id ASC + null ท้าย',
    );
  });

  // ---- PG14: sort=fullname-desc (NOCASE) ----
  await test('PG14: sort=fullname-desc → Z-A แบบ case-insensitive + tie-break', async () => {
    const res = await getJson('/api/v1/admin/applications?roundId=round-3&sort=fullname-desc');
    assertEqual(res.status, 200, 'HTTP status');
    assertDeepEqual(
      res.body.data.map((r) => r.id),
      // zzz-null มาก่อน (ชื่อมากที่สุด) → echo/ECHO เท่ากัน → tie-break
      // submittedAt DESC → dupNew ก่อน dupOld → แล้วจึง Delta, charlie, Bravo, alpha
      [r3Null, r3.dupNew, r3.dupOld, r3.delta, r3.charlie, r3.bravo, r3.alpha],
      'NOCASE desc + tie-break',
    );
  });

  // ---- PG15: sort ที่ไม่รู้จัก → default (ไม่ 400) ----
  await test('PG15: sort ที่ไม่รู้จัก/ว่าง → fallback default submittedAt-desc', async () => {
    for (const qs of ['sort=', 'sort=unknown', 'sort=fullname', 'sort=id-asc', 'sort=submittedAt']) {
      const res = await getJson(`/api/v1/admin/applications?roundId=round-1&${qs}`);
      assertEqual(res.status, 200, `?${qs} → 200 (ไม่ throw)`);
      assertDeepEqual(
        res.body.data.map((r) => r.id),
        ROUND1_DESC,
        `?${qs} → ลำดับ default`,
      );
    }
  });

  // ---- PG16: sort + pagination ต่อเนื่อง ไม่ซ้ำ ไม่หาย ----
  await test('PG16: sort ทุกค่า + page 1..N → union = ชุดเต็ม ไม่ซ้ำ ไม่หาย', async () => {
    for (const sort of ['submittedAt-desc', 'submittedAt-asc', 'fullname-asc', 'fullname-desc']) {
      const full = await getJson(`/api/v1/admin/applications?roundId=round-3&sort=${sort}`);
      const expected = full.body.data.map((r) => r.id);

      const collected = [];
      for (let page = 1; page <= 3; page++) {
        const res = await getJson(
          `/api/v1/admin/applications?roundId=round-3&sort=${sort}&page=${page}&pageSize=3`,
        );
        collected.push(...res.body.data.map((r) => r.id));
      }
      assertDeepEqual(collected, expected, `sort=${sort}: รวมทุกหน้า = ชุดเต็มเรียงเดิม`);
      assertEqual(new Set(collected).size, collected.length, `sort=${sort}: ไม่มี id ซ้ำ`);
    }
  });

  // ---- PG17: /ids รับ sort เดียวกัน ----
  await test('PG17: /applications/ids รับ ?sort= และลำดับตรงกับ list', async () => {
    for (const sort of ['submittedAt-desc', 'submittedAt-asc', 'fullname-asc', 'fullname-desc']) {
      const [list, ids] = await Promise.all([
        getJson(`/api/v1/admin/applications?roundId=round-3&sort=${sort}`),
        getJson(`/api/v1/admin/applications/ids?roundId=round-3&sort=${sort}`),
      ]);
      assertDeepEqual(
        ids.body.data,
        list.body.data.map((r) => r.id),
        `sort=${sort}: ids = list ids`,
      );
    }
  });

  // ---- PG18: sort + filter + pagination ทำงานร่วมกัน ----
  await test('PG18: sort + status filter + pagination ทำงานร่วมกัน', async () => {
    const res = await getJson(
      '/api/v1/admin/applications?roundId=round-1&status=SUBMITTED&sort=fullname-asc&page=1&pageSize=2',
    );
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.pagination.total, 4, 'total ของ SUBMITTED ใน round-1');
    assertEqual(res.body.data.length, 2, 'data = pageSize');
    assertTrue(
      res.body.data.every((r) => r.status === 'SUBMITTED'),
      'ทุกแถวเป็น SUBMITTED',
    );
    // ลำดับต้องเป็น fullname asc จริง (เทียบกับชุดเต็มที่ sort เดียวกัน)
    const full = await getJson('/api/v1/admin/applications?roundId=round-1&status=SUBMITTED&sort=fullname-asc');
    assertDeepEqual(
      res.body.data.map((r) => r.id),
      full.body.data.slice(0, 2).map((r) => r.id),
      'หน้า 1 = 2 อันดับแรกของชุดที่ sort แล้ว',
    );
  });

  // ── สรุป ──
  console.log('\n=================================================');
  console.log(`ผลการทดสอบ: ผ่าน ${passed} / FAIL ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('ทุกกรณีผ่าน ✅');
}

runAllTests().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
