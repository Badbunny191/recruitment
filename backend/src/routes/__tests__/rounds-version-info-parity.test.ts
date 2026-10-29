/**
 * GET /admin/rounds-with-version-info — subset parity + query count
 * ============================================================
 * เดิม endpoint วิ่ง 4+V queries (rounds + templates + versions + field_master
 * + template_fields ต่อ 1 version แบบ sequential) แต่ consumer เดียว
 * (rounds/page.tsx) อ่านแค่ 6 ฟิลด์: roundId, currentVersion.{id,versionNumber},
 * latestPublishedVersion.{id,versionNumber}, hasNewerVersion — ที่เหลือ
 * (fields/status/template/roundTitle/roundStatus) เป็น dead payload
 *
 * เทสชุดนี้พิสูจน์สองอย่าง
 *   1. PARITY — output ตรงกับ "สูตรเดิม" ที่คำนวณสดจาก sqlite (reference
 *      implementation อยู่ในไฟล์นี้) จำกัดเฉพาะ 4 keys ที่ consumer อ่าน
 *      (subset contract — FE เก่า/ใหม่รันกับ BE ใหม่ได้ทันที)
 *   2. QUERY COUNT — 1 db.batch (2 SELECT) + 1 gate query ต่อ request
 *      (เดิม 14 queries ที่ prod V=10)
 *
 * เคส semantics ที่ต้องคงเป๊ะ (จุดที่การยุบ query อาจเปลี่ยนผล)
 *   - current == latest published → latestPublishedVersion = null
 *   - current เป็น DRAFT ที่ versionNumber สูงกว่า latest published
 *     → latestPublishedVersion ยังโผล่ แต่ hasNewerVersion = false
 *   - current เป็น ARCHIVED ที่ versionNumber สูงกว่า latest published → false
 *   - template ไม่มี PUBLISHED เลย → latestPublishedVersion = null
 *   - templateVersionId ชี้ version ที่ไม่มีจริง → currentVersion = null
 *     และ hasNewerVersion หลุดจาก JSON (สูตรเดิมให้ undefined)
 *   - ห้าม leak version ข้าม template
 *
 * Run: node --import tsx src/routes/__tests__/rounds-version-info-parity.test.ts
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

const TEST_JWT_SECRET = 'test-jwt-secret-rounds-version-info';

// ── instrumented D1 adapter — แยกนับ single query / batch / statement ใน batch ──
// batch ต้องคืนผลจริงต่อ statement (drizzle mapResult อ่าน .results)
// นับแบบเดียวกับ D1 จริง: batch = 1 RPC ไม่ว่ามีกี่ statement
function createD1Adapter(sqlite: Database.Database, counter: { single: number; batch: number; batchStmts: number }) {
  const makeStatement = (sqlText: string) => {
    const stmt = sqlite.prepare(sqlText);
    let boundParams: any[] = [];
    const exec = () => ({ results: stmt.all(...boundParams) });
    const api = {
      bind(...params: any[]) {
        boundParams = params;
        return api;
      },
      async all() {
        counter.single++;
        return exec();
      },
      async first() {
        counter.single++;
        return stmt.get(...boundParams) ?? null;
      },
      async run() {
        counter.single++;
        const info = stmt.run(...boundParams);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() {
        counter.single++;
        return stmt.raw(true).all(...boundParams);
      },
      // ให้ batch execute โดยไม่นับเป็น single RPC
      __exec: exec,
    };
    return api;
  };
  return {
    prepare: (sqlText: string) => makeStatement(sqlText),
    async batch(statements: any[]) {
      counter.batch++;
      const results = [];
      for (const s of statements) {
        counter.batchStmts++;
        results.push(s.__exec ? s.__exec() : await s.all());
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

  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT'
  );

  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL
  );
`);

sqlite.prepare(
  `INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password, failed_login_attempts, password_migrated)
   VALUES ('admin-1','admin@test.com','h','ADMIN',1,0,0,1)`,
).run();

// ── fixture: 2 templates, 8 versions ครบทุกสถานะ, 7 rounds ──
function insertVersion(id: string, templateId: string, versionNumber: number, status: string) {
  sqlite.prepare(
    `INSERT INTO template_versions (id, template_id, version_number, status) VALUES (?, ?, ?, ?)`,
  ).run(id, templateId, versionNumber, status);
}
function insertRound(id: string, templateVersionId: string) {
  sqlite.prepare(
    `INSERT INTO recruitment_rounds (id, template_version_id) VALUES (?, ?)`,
  ).run(id, templateVersionId);
}

// T1: published 1,2 + DRAFT 3
insertVersion('v1', 'T1', 1, 'PUBLISHED');
insertVersion('v2', 'T1', 2, 'PUBLISHED');
insertVersion('v3', 'T1', 3, 'DRAFT');
// T2: ไม่มี PUBLISHED เลย
insertVersion('v4', 'T2', 1, 'DRAFT');
// T3: published 1,2,5 + ARCHIVED 6 — version number สูงสุดเป็น ARCHIVED
insertVersion('v5', 'T3', 1, 'PUBLISHED');
insertVersion('v6', 'T3', 2, 'PUBLISHED');
insertVersion('v7', 'T3', 5, 'PUBLISHED');
insertVersion('v8', 'T3', 6, 'ARCHIVED');

insertRound('r-current-latest', 'v2');    // ใช้ latest published อยู่แล้ว
insertRound('r-older-published', 'v1');   // หลัง latest published 1 version
insertRound('r-draft-ahead', 'v3');       // DRAFT 3 > published 2
insertRound('r-no-published', 'v4');      // template ไม่มี published
insertRound('r-older-cross', 'v5');       // T3 published 1 → latest published 5
insertRound('r-archived-current', 'v8');  // ARCHIVED 6 > published 5
insertRound('r-missing-version', 'v-404'); // ชี้ version ที่ไม่มีจริง

const counter = { single: 0, batch: 0, batchStmts: 0 };
const d1 = createD1Adapter(sqlite, counter);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

async function callVersionInfo() {
  const token = await sign(
    { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET,
  );
  const res = await app.request(
    `/api/v1/admin/rounds-with-version-info`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    { DB: d1, JWT_SECRET: TEST_JWT_SECRET },
  );
  return { status: res.status, body: await res.json() };
}

// ── reference implementation: สูตรเดิม จำกัดเฉพาะ 4 keys ที่ consumer อ่าน ──
function referenceVersionInfo() {
  const rounds = sqlite.prepare(`SELECT id, template_version_id FROM recruitment_rounds`).all() as any[];
  const versions = sqlite.prepare(`SELECT id, template_id, version_number, status FROM template_versions`).all() as any[];
  return rounds.map(round => {
    const currentVersion = versions.find(v => v.id === round.template_version_id);
    const publishedVersions = versions
      .filter(v => v.template_id === currentVersion?.template_id && v.status === 'PUBLISHED')
      .sort((a, b) => b.version_number - a.version_number);
    const latestPublished = publishedVersions[0];
    return {
      roundId: round.id,
      currentVersion: currentVersion ? {
        id: currentVersion.id,
        versionNumber: currentVersion.version_number,
      } : null,
      latestPublishedVersion: latestPublished && latestPublished.id !== currentVersion?.id ? {
        id: latestPublished.id,
        versionNumber: latestPublished.version_number,
      } : null,
      hasNewerVersion: latestPublished && currentVersion && latestPublished.version_number > currentVersion.version_number,
    };
  });
}

function findItem(data: any[], roundId: string) {
  return data.find((r: any) => r.roundId === roundId);
}

async function runAllTests() {
  console.log('=================================================');
  console.log('GET /admin/rounds-with-version-info — parity + query count');
  console.log('=================================================\n');

  await test('parity: ทั้งอาร์เรย์ตรงกับสูตรเดิม (subset 4 keys)', async () => {
    const res = await callVersionInfo();
    assertEqual(res.status, 200);
    assertEqual(res.body.data.length, 7, 'ต้องได้ครบ 7 rounds');
    assertEqual(
      JSON.stringify(res.body.data),
      JSON.stringify(referenceVersionInfo()),
      'parity กับสูตรเดิม',
    );
  });

  await test('round ใช้ latest published อยู่แล้ว → latestPublishedVersion = null', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-current-latest');
    assertEqual(item.currentVersion.versionNumber, 2, 'current = v2');
    assertEqual(item.latestPublishedVersion, null, 'ไม่มี published ที่ใหม่กว่า');
    assertEqual(item.hasNewerVersion, false, 'hasNewerVersion false');
  });

  await test('round หลัง latest published → warning object ตรงที่ FE อ่าน', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-older-published');
    assertEqual(JSON.stringify(item.currentVersion), JSON.stringify({ id: 'v1', versionNumber: 1 }), 'current v1');
    assertEqual(JSON.stringify(item.latestPublishedVersion), JSON.stringify({ id: 'v2', versionNumber: 2 }), 'latest published v2');
    assertEqual(item.hasNewerVersion, true, 'hasNewerVersion true');
  });

  await test('DRAFT versionNumber สูงกว่า latest published → latestPublishedVersion โผล่ แต่ hasNewerVersion false', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-draft-ahead');
    assertEqual(item.currentVersion.versionNumber, 3, 'current = DRAFT v3');
    assertEqual(JSON.stringify(item.latestPublishedVersion), JSON.stringify({ id: 'v2', versionNumber: 2 }), 'latest published ยังเป็น v2');
    assertEqual(item.hasNewerVersion, false, 'ต้อง false — สูตรเดิมเทียบ versionNumber ฝั่ง published กับ current');
  });

  await test('template ไม่มี PUBLISHED เลย → latestPublishedVersion = null + hasNewerVersion หลุดจาก JSON', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-no-published');
    assertEqual(item.latestPublishedVersion, null, 'latestPublishedVersion null');
    assertTrue(!('hasNewerVersion' in item), 'สูตรเดิมให้ undefined → หลุดจาก JSON');
  });

  await test('ห้าม leak version ข้าม template (T1 ไม่เห็น T3)', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-older-published');
    assertEqual(item.latestPublishedVersion.id, 'v2', 'ต้องเป็น published ล่าสุดของ T1 เท่านั้น');
  });

  await test('ARCHIVED current สูงกว่า latest published → hasNewerVersion false', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-archived-current');
    assertEqual(item.currentVersion.versionNumber, 6, 'current = ARCHIVED v8 (num 6)');
    assertEqual(JSON.stringify(item.latestPublishedVersion), JSON.stringify({ id: 'v7', versionNumber: 5 }), 'latest published v7 (num 5)');
    assertEqual(item.hasNewerVersion, false, '5 > 6 เป็นเท็จ — ต้อง false');
  });

  await test('templateVersionId ชี้ version ที่ไม่มีจริง → currentVersion null + hasNewerVersion หลุดจาก JSON', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-missing-version');
    assertEqual(item.currentVersion, null, 'currentVersion null');
    assertEqual(item.latestPublishedVersion, null, 'latestPublishedVersion null');
    assertTrue(!('hasNewerVersion' in item), 'สูตรเดิมให้ undefined → หลุดจาก JSON');
  });

  await test('subset contract: 1 item มีแค่ 4 keys, version มีแค่ id+versionNumber (ไม่ส่ง fields/status/template กลับ)', async () => {
    const res = await callVersionInfo();
    const item = findItem(res.body.data, 'r-older-published');
    assertEqual(
      Object.keys(item).sort().join(','),
      'currentVersion,hasNewerVersion,latestPublishedVersion,roundId',
      'item ต้องมีแค่ 4 keys',
    );
    assertEqual(Object.keys(item.currentVersion).sort().join(','), 'id,versionNumber', 'currentVersion 2 keys');
    assertEqual(Object.keys(item.latestPublishedVersion).sort().join(','), 'id,versionNumber', 'latestPublishedVersion 2 keys');
    const raw = JSON.stringify(res.body.data);
    for (const deadKey of ['"fields"', '"roundTitle"', '"roundStatus"', '"template"']) {
      assertTrue(!raw.includes(deadKey), `ห้ามมี dead payload ${deadKey}`);
    }
  });

  await test('QUERY COUNT: 1 db.batch (2 SELECT) + 1 gate query — ไม่มี loop ต่อ version', async () => {
    // warm-up แล้วนับรอบใหม่
    await callVersionInfo();
    counter.single = 0; counter.batch = 0; counter.batchStmts = 0;
    await callVersionInfo();
    assertEqual(counter.batch, 1, `batch ต้องยิงครั้งเดียว (พบ ${counter.batch})`);
    assertEqual(counter.batchStmts, 2, `batch ต้องมี 2 statements (พบ ${counter.batchStmts})`);
    assertEqual(counter.single, 1, `นอก batch ต้องเหลือแค่ gate query (พบ ${counter.single})`);
  });

  await test('ไม่มี token → 401 (ไม่เปลี่ยน auth behavior)', async () => {
    const res = await app.request(
      `/api/v1/admin/rounds-with-version-info`,
      { method: 'GET' },
      { DB: d1, JWT_SECRET: TEST_JWT_SECRET },
    );
    assertEqual(res.status, 401);
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All rounds-with-version-info parity tests passed ✓');
  process.exit(0);
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
