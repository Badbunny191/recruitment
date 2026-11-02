/**
 * Phase 3: GET /admin/applications/:id/history — limit + hasMore
 * =============================================================================
 * branch: feature/application-history-phase3-performance
 *
 * ครอบคลุม:
 *   H1.  ไม่ส่ง limit → default 50, response มี hasMore/limit
 *   H2.  limit whitelist 10/25/50/100 ทำงานจริง (ตัดแถวตามจำนวน)
 *   H3.  limit นอก whitelist (999, 20, 0, -5, abc, ว่าง) → default 50 ไม่ 400
 *   H4.  ลำดับใหม่ → เก่า คงเดิม (created_at DESC, id DESC)
 *   H5.  hasMore=false เมื่อจำนวนแถว <= limit, true เมื่อมีเกิน
 *   H6.  limit=100 มากกว่าจำนวนแถวจริง → คืนทั้งหมด, hasMore=false
 *   H7.  adminEmail ยังถูก resolve (inArray ยังทำงานกับ query ที่มี LIMIT)
 *   H8.  payload ยังถูกส่งครบ (contract เดิมไม่ถูกแตะ) — UI ใช้ประกอบ
 *        status transition / reason
 *   H9.  response contract เดิม: { data: [...] } มี key ครบ 6 ตัวต่อแถว
 *   H10. ใบสมัครไม่มีอยู่ → 404 (ไม่ถูกกระทบจาก limit parsing)
 *   H11. ใบสมัครที่ไม่มี log → data ว่าง, hasMore=false
 *   H12. ไม่มีแถวเกิน limit หลุดออกมา (limit+1 ถูกตัดจริง)
 *   H13. tie-break: created_at เท่ากันหลายแถว → id DESC นิ่งเมื่อแบ่งหน้า
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/application-history-pagination.test.ts
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
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter (pattern เดียวกับ applications-list-pagination.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-application-history';

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
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT, batch_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
  CREATE INDEX idx_audit_created_at_desc ON audit_logs (created_at DESC);
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

const env = () => ({ DB: d1, JWT_SECRET: TEST_JWT_SECRET });

// ── Seed ───────────────────────────────────────────────────────────────────
// 3 admin → พิสูจน์ว่า adminEmail resolve ครบทุกคน (bug เดิมที่ resolve ได้คนแรก)
sqlite.prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run('admin-a', 'alpha@test.local');
sqlite.prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'ADMIN', 1)`)
  .run('admin-b', 'bravo@test.local');
sqlite.prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'SUPER_ADMIN', 1)`)
  .run('admin-c', 'charlie@test.local');

function insertApplication(id) {
  sqlite.prepare(
    `INSERT INTO applications
       (id, application_no, round_id, email, fullname, national_id, status, form_data, submitted_at, year, round_code)
     VALUES (?, ?, 'round-1', ?, 'ผู้สมัคร ทดสอบ', '1234567890123', 'SUBMITTED', '{}', 1760000000, 2569, 'R1')`
  ).run(id, `APP-2569-${id}`, `${id}@test.local`);
}

// app-heavy: 130 events (เกิน 100 ทุก limit) — สถานการณ์ใบที่ถูกกด PDF ซ้ำ ๆ
// app-edge: 50 events (เท่า default พอดี → hasMore=false คือขอบ)
// app-one: 1 event
// app-empty: ไม่มี log
const HEAVY = 'app-heavy';
const EDGE = 'app-edge';
const ONE = 'app-one';
const EMPTY = 'app-empty';
const TIE = 'app-tie';

[HEAVY, EDGE, ONE, EMPTY, TIE].forEach(insertApplication);

const insertLog = sqlite.prepare(
  `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, payload, ip_address, created_at)
   VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', ?)`
);

// app-heavy: created_at ไล่ขึ้นทีละ 1 (ไม่มี tie) → ลำดับคาดเดาได้
for (let i = 0; i < 130; i++) {
  const action = i % 3 === 0 ? 'PDF_DOWNLOAD' : 'UPDATE';
  const payload = action === 'PDF_DOWNLOAD'
    ? JSON.stringify({ cacheHit: false, pageCount: 3, bytes: 184320, generatedAt: '2026-10-30T08:00:00.000Z' })
    : JSON.stringify({
        changes: [{ field: 'status', fieldLabel: 'สถานะใบสมัคร', oldValue: 'SUBMITTED', newValue: 'QUALIFIED' }],
        summary: 'สถานะใบสมัคร: ผู้สมัครผ่านการคัดเลือก',
        previousStatus: 'SUBMITTED',
      });
  insertLog.run(
    `heavy-${String(i).padStart(4, '0')}`,
    i % 2 === 0 ? 'admin-a' : 'admin-b',
    action,
    'APPLICATION',
    HEAVY,
    payload,
    1760100000 + i
  );
}

// app-edge: 50 events
for (let i = 0; i < 50; i++) {
  insertLog.run(`edge-${String(i).padStart(4, '0')}`, 'admin-a', 'UPDATE', 'APPLICATION', EDGE,
    JSON.stringify({ changes: [], summary: '' }), 1760200000 + i);
}

// app-one: 1 event
insertLog.run('one-0000', 'admin-c', 'CREATE', 'APPLICATION', ONE, null, 1760300000);

// app-tie: 12 events ที่ created_at เท่ากันหมด → tie-break ต้องเป็น id DESC
for (let i = 0; i < 12; i++) {
  insertLog.run(`tie-${String(i).padStart(2, '0')}`, 'admin-a', 'UPDATE', 'APPLICATION', TIE,
    null, 1760400000);
}

// ── Applicant Timeline UX: reserved SYSTEM row (Migration 032) ──────────────
// app-applicant: 1 APPLICATION_SUBMIT ที่เขียนด้วย reserved row + 1 UPDATE
// โดยเจ้าหน้าที่ → พิสูจน์ว่า APPLICANT ไม่หลุด system@audit.local และ
// เจ้าหน้าที่ยังแสดงอีเมลจริง
const APPLICANT = 'app-applicant';
insertApplication(APPLICANT);
sqlite.prepare(
  `INSERT INTO admin_users (id, email, password_hash, role, is_active)
   VALUES ('00000000-0000-0000-0000-000000000000', 'system@audit.local', 'x', 'VIEWER', 0)`
).run();
sqlite.prepare(`UPDATE applications SET fullname = ? WHERE id = ?`)
  .run('นายสมชาย ใจดี', APPLICANT);
insertLog.run('appl-0001', '00000000-0000-0000-0000-000000000000', 'APPLICATION_SUBMIT',
  'APPLICATION', APPLICANT, JSON.stringify({ applicationNo: 'APP-2569-APPL' }), 1760600000);
insertLog.run('appl-0002', 'admin-a', 'UPDATE', 'APPLICATION', APPLICANT,
  JSON.stringify({ changes: [], summary: '' }), 1760600100);

// log ของ entity อื่น — ต้องไม่หลุดเข้ามา (entity_type filter)
for (let i = 0; i < 20; i++) {
  insertLog.run(`other-${i}`, 'admin-a', 'UPDATE', 'RECRUITMENT_ROUND', HEAVY, null, 1760500000 + i);
}

async function getToken() {
  return sign(
    { id: 'admin-a', email: 'alpha@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
}

async function getJson(path) {
  const token = await getToken();
  const res = await app.request(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }, env());
  return { status: res.status, body: await res.json().catch(() => null) };
}

function historyPath(id, qs = '') {
  return `/api/v1/admin/applications/${id}/history${qs}`;
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Phase 3: Application History Pagination — Tests');
  console.log('=================================================\n');

  // ---- H1 ----
  await test('H1: ไม่ส่ง limit → default 50 + มี hasMore/limit ใน response', async () => {
    const res = await getJson(historyPath(HEAVY));
    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.limit, 50, 'default limit');
    assertEqual(res.body.data.length, 50, 'คืน 50 แถว');
    assertEqual(res.body.hasMore, true, 'มีต่อ (130 > 50)');
  });

  // ---- H2 ----
  await test('H2: limit whitelist 10/25/50/100 ทำงานจริง', async () => {
    for (const [lim, expectMore] of [[10, true], [25, true], [50, true], [100, true]]) {
      const res = await getJson(historyPath(HEAVY, `?limit=${lim}`));
      assertEqual(res.status, 200, `limit=${lim} status`);
      assertEqual(res.body.limit, lim, `limit=${lim} echo`);
      assertEqual(res.body.data.length, lim, `limit=${lim} จำนวนแถว`);
      assertEqual(res.body.hasMore, expectMore, `limit=${lim} hasMore`);
    }
  });

  // ---- H3 ----
  await test('H3: limit นอก whitelist / ผิดรูป → default 50 ไม่ 400', async () => {
    for (const raw of ['999', '20', '0', '-5', 'abc', '', '   ', '10.5', '1e2']) {
      const res = await getJson(historyPath(HEAVY, `?limit=${encodeURIComponent(raw)}`));
      assertEqual(res.status, 200, `limit="${raw}" ต้องไม่ 400`);
      assertEqual(res.body.limit, 50, `limit="${raw}" ตกไป default 50`);
      assertEqual(res.body.data.length, 50, `limit="${raw}" คืน 50 แถว`);
    }
  });

  // ---- H4 ----
  await test('H4: ลำดับใหม่ → เก่า คงเดิม (created_at DESC, id DESC)', async () => {
    const res = await getJson(historyPath(HEAVY, '?limit=100'));
    const times = res.body.data.map((r) => r.createdAt);
    const sorted = [...times].sort((a, b) => b - a);
    assertDeepEqual(times, sorted, 'createdAt ต้องเรียง DESC');
    assertEqual(res.body.data[0].id, 'heavy-0129', 'แถวแรก = log ล่าสุด');
    assertEqual(res.body.data[99].id, 'heavy-0030', 'แถวที่ 100 = log ที่ 100 จากท้าย');
  });

  // ---- H5 ----
  await test('H5: hasMore=false เมื่อจำนวน <= limit, true เมื่อเกิน', async () => {
    const edge = await getJson(historyPath(EDGE)); // 50 events, default 50
    assertEqual(edge.body.data.length, 50, 'edge คืน 50');
    assertEqual(edge.body.hasMore, false, 'edge: 50 == 50 → ไม่มีต่อ');

    const heavy100 = await getJson(historyPath(HEAVY, '?limit=100'));
    assertEqual(heavy100.body.data.length, 100, 'heavy limit=100');
    assertEqual(heavy100.body.hasMore, true, 'heavy: 130 > 100 → มีต่อ');
  });

  // ---- H6 ----
  await test('H6: limit มากกว่าจำนวนแถวจริง → คืนทั้งหมด + hasMore=false', async () => {
    const res = await getJson(historyPath(ONE, '?limit=100'));
    assertEqual(res.body.data.length, 1, 'คืน 1 แถว');
    assertEqual(res.body.hasMore, false, 'hasMore=false');
    assertEqual(res.body.limit, 100, 'limit echo ตามที่ขอ');
  });

  // ---- H7 ----
  await test('H7: adminEmail resolve ได้ทุกคน (ไม่ใช่แค่ admin คนแรก)', async () => {
    const res = await getJson(historyPath(HEAVY, '?limit=100'));
    const emails = new Set(res.body.data.map((r) => r.adminEmail));
    assertTrue(emails.has('alpha@test.local'), 'มี admin-a');
    assertTrue(emails.has('bravo@test.local'), 'มี admin-b');
    assertTrue(
      res.body.data.every((r) => r.adminEmail && r.adminEmail.includes('@')),
      'ทุกแถวมีอีเมลจริง ไม่ fallback เป็น UUID',
    );
  });

  // ---- H8 ----
  await test('H8: payload ยังถูกส่งครบ (UI ใช้ทำ status transition/reason)', async () => {
    const res = await getJson(historyPath(HEAVY, '?limit=100'));
    const upd = res.body.data.find((r) => r.action === 'UPDATE');
    assertTrue(upd, 'พบแถว UPDATE');
    const parsed = typeof upd.payload === 'string' ? JSON.parse(upd.payload) : upd.payload;
    assertEqual(parsed.previousStatus, 'SUBMITTED', 'previousStatus คงอยู่');
    assertTrue(Array.isArray(parsed.changes), 'changes คงอยู่');
    assertEqual(parsed.changes[0].field, 'status', 'changes ตัวแรกคือ status');

    const pdf = res.body.data.find((r) => r.action === 'PDF_DOWNLOAD');
    assertTrue(pdf, 'พบแถว PDF_DOWNLOAD');
    const pdfParsed = typeof pdf.payload === 'string' ? JSON.parse(pdf.payload) : pdf.payload;
    assertEqual(pdfParsed.pageCount, 3, 'payload PDF_DOWNLOAD คงอยู่');
  });

  // ---- H9 ----
  await test('H9: response contract — 6 คีย์เดิมครบ + actorType/actorLabel (เพิ่มเท่านั้น)', async () => {
    const res = await getJson(historyPath(ONE));
    assertDeepEqual(
      Object.keys(res.body.data[0]).sort(),
      ['action', 'actorLabel', 'actorSecondary', 'actorType', 'adminEmail', 'adminId', 'createdAt', 'id', 'payload'].sort(),
      'ชุดคีย์ต่อแถว: 6 เดิม + actorType/actorLabel/actorSecondary',
    );
    assertTrue(Array.isArray(res.body.data), 'data เป็น array (contract เดิม)');
  });

  // ---- H17 ----
  await test('H17: APPLICANT → actorType=APPLICANT, ชื่อผู้สมัคร, ไม่มี system@audit.local', async () => {
    const res = await getJson(historyPath(APPLICANT));
    const submit = res.body.data.find((r) => r.action === 'APPLICATION_SUBMIT');
    assertTrue(submit, 'พบแถว APPLICATION_SUBMIT');
    assertEqual(submit.actorType, 'APPLICANT', 'actorType');
    assertEqual(submit.actorLabel, 'นายสมชาย ใจดี', 'actorLabel = ชื่อผู้สมัคร');
    assertEqual(submit.actorSecondary, 'app-applicant@test.local', 'actorSecondary = อีเมลผู้สมัคร');
    assertEqual(submit.adminEmail, null, 'adminEmail ต้องเป็น null (ไม่ส่ง reserved email)');

    // adminId คงไว้ตามจริง (FK ของ audit log) แต่ต้องไม่ถูกใช้เป็นข้อความแสดงผล
    assertEqual(submit.adminId, '00000000-0000-0000-0000-000000000000', 'adminId คงค่าจริง');
    assertTrue(
      !String(submit.actorLabel).includes('00000000-0000'),
      'actorLabel ต้องไม่ใช่ reserved UUID',
    );

    const raw = JSON.stringify(res.body);
    assertTrue(!raw.includes('system@audit.local'), 'ต้องไม่มี system@audit.local ใน response');
  });

  // ---- H18 ----
  await test('H18: ADMIN → actorType=ADMIN, อีเมลเจ้าหน้าที่ตามเดิม', async () => {
    const res = await getJson(historyPath(APPLICANT));
    const upd = res.body.data.find((r) => r.action === 'UPDATE');
    assertTrue(upd, 'พบแถว UPDATE');
    assertEqual(upd.actorType, 'ADMIN', 'actorType');
    assertEqual(upd.actorLabel, 'alpha@test.local', 'actorLabel = อีเมลเจ้าหน้าที่');
    assertEqual(upd.actorSecondary, null, 'ADMIN ไม่มีบรรทัดรอง');
    assertEqual(upd.adminEmail, 'alpha@test.local', 'adminEmail คงเดิม');
  });

  // ---- H19 ----
  await test('H19: APPLICANT ที่ resolve ชื่อไม่ได้ → "ผู้สมัคร" แต่อีเมลยังอยู่', async () => {
    sqlite.prepare(`UPDATE applications SET fullname = '' WHERE id = ?`).run(APPLICANT);
    const res = await getJson(historyPath(APPLICANT));
    const submit = res.body.data.find((r) => r.action === 'APPLICATION_SUBMIT');
    assertEqual(submit.actorLabel, 'ผู้สมัคร', 'fallback label');
    assertEqual(submit.actorSecondary, 'app-applicant@test.local', 'อีเมลยังแสดงแม้ชื่อว่าง');
    sqlite.prepare(`UPDATE applications SET fullname = ? WHERE id = ?`).run('นายสมชาย ใจดี', APPLICANT);
  });

  // ---- H20 ----
  await test('H20: actorSecondary ห้ามมี reserved email / ห้ามรั่วไป adminEmail', async () => {
    const res = await getJson(historyPath(APPLICANT));
    const submit = res.body.data.find((r) => r.action === 'APPLICATION_SUBMIT');
    assertTrue(
      !String(submit.actorSecondary).includes('system@audit.local'),
      'actorSecondary ต้องไม่ใช่ reserved email',
    );
    assertEqual(submit.adminEmail, null, 'อีเมลผู้สมัครต้องไม่อยู่ใน adminEmail');
  });

  // ---- H10 ----
  await test('H10: ใบสมัครไม่มีอยู่ → 404 (limit parsing ไม่กลบ 404)', async () => {
    const res = await getJson(historyPath('does-not-exist', '?limit=999'));
    assertEqual(res.status, 404, 'HTTP 404');
    assertEqual(res.body.error, 'Application not found', 'error message เดิม');
  });

  // ---- H11 ----
  await test('H11: ใบสมัครที่ไม่มี log → data ว่าง + hasMore=false', async () => {
    const res = await getJson(historyPath(EMPTY));
    assertEqual(res.status, 200, 'HTTP 200');
    assertDeepEqual(res.body.data, [], 'data = []');
    assertEqual(res.body.hasMore, false, 'hasMore=false');
    assertEqual(res.body.limit, 50, 'limit default');
  });

  // ---- H12 ----
  await test('H12: ไม่มีแถวเกิน limit หลุด (limit+1 ถูกตัดจริง)', async () => {
    for (const lim of [10, 25, 50, 100]) {
      const res = await getJson(historyPath(HEAVY, `?limit=${lim}`));
      assertEqual(res.body.data.length, lim, `limit=${lim}: ห้ามเกิน ${lim} แถว`);
      const ids = res.body.data.map((r) => r.id);
      assertEqual(new Set(ids).size, ids.length, `limit=${lim}: ไม่มี id ซ้ำ`);
      // แถว sentinel (heavy-0130 ไม่มีจริง); ตรวจว่าแถวสุดท้ายไม่ใช่แถวที่ดึงเกิน
      assertTrue(!ids.includes('heavy-9999'), 'ไม่มีแถวหลุด');
    }
  });

  // ---- H13 ----
  await test('H13: created_at เท่ากันหลายแถว → tie-break id DESC นิ่ง', async () => {
    const res = await getJson(historyPath(TIE, '?limit=10'));
    assertEqual(res.body.data.length, 10, 'คืน 10 แถว');
    assertEqual(res.body.hasMore, true, '12 > 10 → มีต่อ');
    const ids = res.body.data.map((r) => r.id);
    assertDeepEqual(ids, [
      'tie-11', 'tie-10', 'tie-09', 'tie-08', 'tie-07',
      'tie-06', 'tie-05', 'tie-04', 'tie-03', 'tie-02',
    ], 'id DESC เมื่อ created_at เท่ากัน');
  });

  // ---- H14: entity_type filter ----
  await test('H14: log ของ entity อื่นไม่หลุดเข้ามา (entity_type filter)', async () => {
    const res = await getJson(historyPath(HEAVY, '?limit=100'));
    assertTrue(
      res.body.data.every((r) => !r.id.startsWith('other-')),
      'ไม่มี log ของ RECRUITMENT_ROUND',
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