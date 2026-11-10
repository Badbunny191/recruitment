/**
 * serverTime ใน response เดิม (ST = Server Time)
 * =======================================================================
 * เป้าหมาย: หน้า /apply แสดง banner "เหลือเวลารับสมัครอีก" และ error state
 * แสดงหลักฐาน "เวลาของระบบขณะได้รับคำขอ" โดยไม่สร้าง endpoint ใหม่ —
 * serverTime/closeDate ต้องมากับ response เดิม:
 *
 *   ST1. GET /rounds/:id/detail → 200 พร้อม serverTime (ใช้ทำ offset ของ banner)
 *   ST2. GET /rounds/:id/schema รอบปิดแล้ว → 403 ALREADY_CLOSED พร้อม
 *        serverTime + closeDate (error card ของ /apply)
 *   ST3. POST /applications/submit รอบปิดแล้ว → 403 ALREADY_CLOSED พร้อม
 *        serverTime + closeDate (กล่อง error ของ /apply/review)
 *   ST4. GET /rounds/active ยังคงมี serverTime + groups (regression RV1)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ submit-archived-round.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/server-time-in-responses.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../../routes/public.routes';
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
    failures.push(`${e?.message ?? e}`);
    console.log(`  ✗ ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg = '') {
  if (!cond) throw new Error(msg || 'expected true');
}

// ── D1-compatible adapter (แบบเดียวกับ submit-archived-round.test.ts) ──
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

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, title TEXT NOT NULL,
    position_level TEXT NOT NULL, open_date INTEGER NOT NULL, close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE', created_at INTEGER, deleted_at INTEGER,
    announcement_title TEXT, announcement_description TEXT, contact_information TEXT,
    remark TEXT, application_pattern TEXT, round_code TEXT
  );
  CREATE TABLE application_submit_failures (
    id TEXT PRIMARY KEY, ref_code TEXT NOT NULL, round_id TEXT, email TEXT, fullname TEXT,
    submission_token TEXT, category TEXT NOT NULL, reason_code TEXT, error_message TEXT NOT NULL,
    http_status INTEGER NOT NULL, ip_address TEXT, cf_ray TEXT, user_agent TEXT, created_at INTEGER NOT NULL
  );
`);

// ── Seed ──
//   round-st-open   : ACTIVE กำลังเปิด (2024-12-31 → 2027-01-01)
//   round-st-closed : ACTIVE แต่เลย close_date มาแล้ว (2025-10-31) → ALREADY_CLOSED
sqlite.exec(`
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code, announcement_title)
    VALUES ('round-st-open','tv-1','รอบเปิดรับ (ST)','ระดับต้น',1735603200,1798761600,'ACTIVE','STO01','ประกาศรับสมัคร');
  INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-st-closed','tv-1','รอบปิดแล้ว (ST)','ระดับต้น',1735603200,1761859200,'ACTIVE','STC01');
`);

const app = new Hono();
app.route('/api/v1/public', publicRoutes);

const d1 = createD1Adapter(sqlite);
const env = () => ({
  DB: d1,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000',
});

const req = async (method: string, path: string, body?: any) => {
  __resetRateLimitStoreForTests();
  return app.request(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }, env());
};

// ═══ รัน ═══ (ครอบด้วย async IIFE — repo ไม่ใช้ top-level await ใน CJS test)
void (async () => {

await test('ST1: GET /rounds/:id/detail → 200 พร้อม serverTime (offset ของ banner /apply)', async () => {
  const res = await req('GET', '/api/v1/public/rounds/round-st-open/detail');
  const text = await res.text();
  assertEqual(res.status, 200, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertTrue(typeof json.serverTime === 'number' && Number.isFinite(json.serverTime), 'serverTime must be finite number');
  assertTrue(json.data && json.data.closeDate !== undefined && json.data.closeDate !== null, 'data.closeDate must exist');
  assertTrue(json.success === true, 'success must be true');
});

await test('ST2: GET /schema รอบปิดแล้ว → 403 ALREADY_CLOSED + serverTime + closeDate', async () => {
  const res = await req('GET', '/api/v1/public/rounds/round-st-closed/schema');
  const text = await res.text();
  assertEqual(res.status, 403, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertEqual(json.reason, 'ALREADY_CLOSED');
  assertEqual(json.error, 'ปิดรับสมัครแล้ว');
  assertTrue(typeof json.serverTime === 'number' && Number.isFinite(json.serverTime), '403 body must carry serverTime');
  assertTrue(json.closeDate !== undefined && json.closeDate !== null, '403 body must carry closeDate');
});

await test('ST3: POST /submit รอบปิดแล้ว → 403 ALREADY_CLOSED + serverTime + closeDate (review page)', async () => {
  const res = await req('POST', '/api/v1/public/applications/submit', {
    roundId: 'round-st-closed',
    formData: { 'field-email': 'st3@test.local', 'field-fullname': 'ผู้สมัครสังเคราะห์' },
    attachments: [],
  });
  const text = await res.text();
  assertEqual(res.status, 403, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertEqual(json.reason, 'ALREADY_CLOSED');
  assertTrue(typeof json.serverTime === 'number' && Number.isFinite(json.serverTime), 'submit 403 must carry serverTime');
  assertTrue(json.closeDate !== undefined && json.closeDate !== null, 'submit 403 must carry closeDate');
  // closeDate อาจเป็น ISO string (drizzle mode:'timestamp' → Date → JSON) หรือ number
  const closeMs = typeof json.closeDate === 'number' ? json.closeDate : Date.parse(json.closeDate);
  assertEqual(closeMs, 1761859200 * 1000, 'closeDate must match the seeded round');
});

await test('ST4: GET /rounds/active ยังคงมี serverTime + groups (regression RV1)', async () => {
  const res = await req('GET', '/api/v1/public/rounds/active');
  const text = await res.text();
  assertEqual(res.status, 200, `status=${res.status} ${text}`);
  const json = JSON.parse(text);
  assertTrue(typeof json.serverTime === 'number', 'serverTime must still exist on /rounds/active');
  assertTrue(json.groups && Array.isArray(json.groups.open) && Array.isArray(json.groups.closed), 'groups shape unchanged');
});

// ========== SUMMARY ==========

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

})();
