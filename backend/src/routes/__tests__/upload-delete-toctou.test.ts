/**
 * Regression: DELETE /public/uploads/direct/:ledgerId TOCTOU race with submit
 * ===========================================================================
 *
 * ก่อนแก้: handler อ่าน row (TEMP) → ลบ R2 object → mark DELETED แบบไม่มี
 * guard status — ถ้า submit promote แถว TEMP → ACTIVE ระหว่างช่วงอ่านกับ
 * mark ไฟล์ของใบสมัครที่เพิ่ง submit จะถูกลบจาก R2 ถาวร (data loss)
 *
 * หลังแก้: mark DELETED ก่อนด้วย WHERE status='TEMP' — ถ้าถูก promote ไป
 * แล้ว UPDATE กระทบ 0 แถว → 409 และ R2 object ต้องยังอยู่ครบ
 *
 * จำลอง race ด้วย D1 adapter ที่ promote แถว "ระหว่าง" SELECT กับ UPDATE-mark
 * ใช้ Hono app จริง + better-sqlite3 + in-memory R2 mock
 *
 * Run: node --import tsx src/routes/__tests__/upload-delete-toctou.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import { uploadRoutes } from '../upload.routes';
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
  if (!condition) throw new Error(msg || 'assertion failed');
}

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

/**
 * Adapter จำลอง race: เมื่อ handler รัน "UPDATE attachment_uploads ... deleted_at"
 * (mark DELETED) เป็นครั้งแรก ให้ promote แถวเป็น ACTIVE ก่อน 1 ครั้ง —
 * เลียนแบบ submit ที่ promote แล้วระหว่างช่วง handler SELECT (เห็น TEMP)
 * กับ mark — guarded UPDATE ต้องกระทบ 0 แถว
 */
function createRaceD1Adapter(sqlite, raceRowId: string) {
  let raced = false;
  return {
    prepare: (sqlText) => {
      const stmt = sqlite.prepare(sqlText);
      let bound = [];
      return {
        bind(...params) { bound = params; return this; },
        async all() { return { results: stmt.all(...bound) }; },
        async first() { return stmt.get(...bound) ?? null; },
        async run() {
          const isMarkUpdate = /update/i.test(sqlText)
            && /attachment_uploads/i.test(sqlText)
            && /deleted_at/i.test(sqlText);
          if (!raced && isMarkUpdate) {
            raced = true;
            sqlite.prepare(
              "UPDATE attachment_uploads SET status = 'ACTIVE', application_id = 'app-race-1', activated_at = strftime('%s','now') WHERE status = 'TEMP'",
            ).run();
          }
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

function createMockR2Bucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket: any = {
    async put(key: string, value: any) {
      const bytes = value instanceof Uint8Array
        ? value
        : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      objects.set(key, bytes);
    },
    async get(key: string) {
      return objects.get(key);
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket, objects };
}

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE attachment_uploads (
    id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP',
    uploaded_at INTEGER, application_id TEXT, original_filename TEXT,
    delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER
  );
`);

const { bucket, objects } = createMockR2Bucket();
const app = new Hono();
app.route('/api/v1/public/uploads', uploadRoutes);

const env = (adapter) => ({ DB: adapter, R2_BUCKET: bucket, JWT_SECRET: 'toctou-test-secret' });
const BASE = '/api/v1/public/uploads';

async function uploadViaRoute(adapter) {
  __resetRateLimitStoreForTests();
  const form = new FormData();
  form.append('file', new File([new TextEncoder().encode('%PDF-1.4 toctou-test')], 'toctou.pdf', { type: 'application/pdf' }));
  const res = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env(adapter));
  assertEqual(res.status, 201, 'upload must be 201');
  const body = await res.json();
  return body.data;
}

async function runAllTests() {
  console.log('\n=== Upload DELETE TOCTOU — race with submit promote ===\n');

  await test('R1. ปกติ: ลบ TEMP สำเร็จ → 200, R2 โดนลบ, ledger DELETED', async () => {
    const adapter = createD1Adapter(sqlite);
    const data = await uploadViaRoute(adapter);
    const res = await app.request(
      `${BASE}/direct/${data.ledgerId}`,
      { method: 'DELETE', headers: { 'X-Attachment-Token': data.deleteToken } },
      env(adapter),
    );
    assertEqual(res.status, 200, 'delete TEMP must be 200');
    assertTrue(!objects.has(data.fileKey), 'R2 object must be removed');
    const row = sqlite.prepare('SELECT status FROM attachment_uploads WHERE id = ?').get(data.ledgerId);
    assertEqual(row.status, 'DELETED');
  });

  await test('R2. TOCTOU: submit promote ระหว่าง SELECT กับ mark → 409 + R2 object ยังอยู่ + ledger ACTIVE', async () => {
    const raceAdapter = createRaceD1Adapter(sqlite, 'led-race-1');
    // seed แถว TEMP ด้วย adapter ปกติ แล้วใช้ race adapter ตอน DELETE
    const seedAdapter = createD1Adapter(sqlite);
    __resetRateLimitStoreForTests();
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('%PDF-1.4 race')], 'race.pdf', { type: 'application/pdf' }));
    const up = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env(seedAdapter));
    assertEqual(up.status, 201, 'seed upload must be 201');
    const data = (await up.json()).data;

    const res = await app.request(
      `${BASE}/direct/${data.ledgerId}`,
      { method: 'DELETE', headers: { 'X-Attachment-Token': data.deleteToken } },
      env(raceAdapter),
    );
    assertEqual(res.status, 409, 'promoted row must 409, not delete the R2 object');
    assertTrue(objects.has(data.fileKey), 'R2 object must SURVIVE — file belongs to a submitted application now');
    const row = sqlite.prepare('SELECT status, application_id FROM attachment_uploads WHERE id = ?').get(data.ledgerId);
    assertEqual(row.status, 'ACTIVE', 'ledger row must remain ACTIVE');
    assertEqual(row.application_id, 'app-race-1');
  });

  await test('R3. mark สำเร็จแต่ R2.delete โยน error → mark ค้าง DELETED และ GET ทาง app ต้องไม่เจอ (fail-safe)', async () => {
    const adapter = createD1Adapter(sqlite);
    const data = await uploadViaRoute(adapter);
    const failingBucket = {
      async put() {},
      async get() {},
      async delete() { throw new Error('r2 unavailable'); },
    };
    const res = await app.request(
      `${BASE}/direct/${data.ledgerId}`,
      { method: 'DELETE', headers: { 'X-Attachment-Token': data.deleteToken } },
      { DB: adapter, R2_BUCKET: failingBucket, JWT_SECRET: 'toctou-test-secret' },
    );
    assertEqual(res.status, 500, 'r2 failure must surface as 500');
    const row = sqlite.prepare('SELECT status FROM attachment_uploads WHERE id = ?').get(data.ledgerId);
    assertEqual(row.status, 'DELETED', 'ledger already marked DELETED — object unreachable via app (fail-safe orphan)');
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    failures.forEach((f) => console.error(`  FAIL: ${f}`));
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
