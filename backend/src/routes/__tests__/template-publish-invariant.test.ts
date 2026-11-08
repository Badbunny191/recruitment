/**
 * Publish Invariant — "1 template = 1 PUBLISHED version" (เสมอ)
 * ============================================================================
 *
 * ที่มา (production incident 2026-10, ยืนยันจาก prod D1 + git):
 *   - tpl-general-001 มี v2-v5 PUBLISHED พร้อมกัน 4 ตัว
 *   - publish ยุคก่อน redesign (8cd02f59, 10-11) แค่ SET PUBLISHED ไม่ archive
 *     → v2/v3/v4 ติดกันเป็น zombie
 *   - โค้ดปัจจุบันยังพา invariant ไม่หาย: auto-archive ใช้ .get() ไม่มี ORDER BY
 *     (เก็บ "แถวใดก็ได้" 1 ตัว — ที่ prod เก็บ v1 ทิ้ง v2-v4), 2 update แยกกัน
 *     ไม่มี transaction (crash window), ไม่มี re-check (race window)
 *   - Clone Round modal auto-select versionOptions[0] = zombie ตัวเก่าสุด
 *     (CC01 current=v5 จะได้ v2 เป็นเป้า clone)
 *   - POST /rounds รับ templateVersionId ใดก็ได้ (ไม่ตรวจ PUBLISHED)
 *
 * การแก้ (แผนอนุมัติ 2026-11-08):
 *   - publish = conditional db.batch() เดียว: [archive-others, publish-self]
 *     archive-others = archive "ทุก" PUBLISHED ของ template ยกเว้นตัวใหม่
 *     (สะสาง legacy state ได้ใน publish แรก) + publish-self มี guard status='DRAFT'
 *   - publishSelf.meta.changes === 0 → 409 VERSION_ALREADY_PUBLISHED (race)
 *   - clone-options: versionOptions = latest published/template (+ current
 *     ถ้าไม่ published) — parity กับ template-version-options.ts ฝั่ง FE
 *   - POST /rounds: บังคับ templateVersionId ต้องเป็น PUBLISHED
 *
 * ครอบคลุม:
 *   P1. publish บน state สะอาด → 200, archivedCount=1, เหลือ 1 PUBLISHED
 *       + audit_logs มี 1 row ชี้ version ใหม่
 *   P2. (fail-when-no-fix) legacy 3-PUBLISHED + publish → archive ทั้งหมด
 *       (archivedCount=3) เหลือ 1 PUBLISHED — เดิมเก็บแถวเดียว → ยัง 3 PUBLISHED
 *   P3. publish ARCHIVED → 400 (guard เดิมคงอยู่)
 *   P4. publish id ไม่มีจริง → 404
 *   P5. (fail-when-no-fix) race จำลอง: publishSelf changes=0 → 409
 *       VERSION_ALREADY_PUBLISHED (เดิมตอบ 200)
 *   P6. (fail-when-no-fix) crash กลาง batch → rollback ทั้งก้อน ไม่มี partial
 *       state (เดิม: update แรกสำเร็จ update สองพัง → 2 PUBLISHED)
 *   P7. (regression) archive endpoint ยังบล็อกเมื่อมี rounds อ้างอิง
 *   P8. invariant SQL (ชุดเดียวกับ workflow probe) — fixture 4-PUBLISHED
 *       ตรวจพบ 1 กลุ่ม; หลัง "cleanup-style" archive → 0 กลุ่ม
 *
 *   R1. (fail-when-no-fix) clone-options กับ template 4-PUBLISHED →
 *       versionOptions = latest เดียว (เดิมคืน 4)
 *   R2. (fail-when-no-fix) round current = version ที่ไม่ published →
 *       options ยังรวม current (เดิมหาย)
 *   R3. (fail-when-no-fix) fallback selection contract: versionOptions[0]
 *       ต้องเป็น latest published เสมอ + isRecommended เฉพาะเลขสูงกว่า current
 *   R4. POST /rounds ด้วย version PUBLISHED → 201 (ทางเดินปกติ)
 *   R5. (fail-when-no-fix) POST /rounds ด้วย DRAFT version → 400
 *       TEMPLATE_VERSION_NOT_PUBLISHED (เดิม 201)
 *   R6. (fail-when-no-fix) POST /rounds ด้วย version ไม่มีจริง → 404
 *       TEMPLATE_VERSION_NOT_FOUND (เดิม 201)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (better-sqlite3
 * in-memory, batch ห่อ transaction จริงเลียน D1 atomicity) แบบเดียวกับ
 * round-clone-numbering.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/template-publish-invariant.test.ts
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

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter (แบบ round-clone-numbering.test.ts) ──────────────
// เพิ่ม 2 ความสามารถที่ publish invariant ต้องใช้:
//   1. batch() ห่อ BEGIN IMMEDIATE/COMMIT/ROLLBACK — เลียน D1 batch atomicity
//   2. fail injection: failOnRun ให้ run() ลำดับที่ N throw (จำลอง crash)
//      forceChangesZero ให้ทุก run รายงาน meta.changes = 0 (จำลองแพ้ race)
function createD1Adapter(sqlite) {
  let failOnRun = 0;
  let runCount = 0;
  let forceChangesZero = false;

  return {
    prepare: (sqlText) => {
      const stmt = sqlite.prepare(sqlText);
      let bound = [];
      return {
        bind(...params) { bound = params; return this; },
        async all() { return { results: stmt.all(...bound) }; },
        async first() { return stmt.get(...bound) ?? null; },
        async run() {
          runCount++;
          if (failOnRun > 0 && runCount >= failOnRun) {
            throw new Error('SIMULATED_D1_CRASH');
          }
          if (forceChangesZero) {
            // จำลอง guard reject แบบ D1 จริง: WHERE ไม่ตรง → no-op + changes=0
            return { success: true, meta: { changes: 0, last_row_id: 0 } };
          }
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        async raw() { return stmt.raw(true).all(...bound); },
      };
    },
    async batch(statements) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const s of statements) {
          const r = await s.run();
          results.push({ results: [], success: true, meta: r.meta });
        }
        sqlite.exec('COMMIT');
      } catch (e) {
        try { sqlite.exec('ROLLBACK'); } catch { /* ไม่มี transaction ค้าง */ }
        throw e;
      }
      return results;
    },
    _setFailOnRun(n) { failOnRun = n; runCount = 0; },
    _setForceChangesZero(v) { forceChangesZero = v; runCount = 0; },
    _reset() { failOnRun = 0; runCount = 0; forceChangesZero = false; },
  };
}

const TEST_JWT_SECRET = 'test-secret-publish-invariant';

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
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT, batch_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at INTEGER,
    descriptor_json TEXT,
    descriptor_schema_version INTEGER,
    descriptor_updated_at INTEGER,
    descriptor_updated_by TEXT,
    pdf_filename_pattern TEXT
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
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
    announcement_title TEXT,
    announcement_description TEXT,
    contact_information TEXT,
    remark TEXT,
    application_pattern TEXT,
    round_code TEXT
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

// ── Fixtures ────────────────────────────────────────────────────────────

sqlite.prepare(`INSERT INTO templates (id, name) VALUES ('tpl-1', 'แบบฟอร์มทดสอบ 2569')`).run();

let versionSeq = 0;
function insertVersion(opts: {
  templateId?: string;
  versionNumber?: number;
  status?: string;
} = {}) {
  versionSeq++;
  const id = `ver-${String(versionSeq).padStart(3, '0')}`;
  sqlite
    .prepare(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES (?, ?, ?, ?)`)
    .run(id, opts.templateId ?? 'tpl-1', opts.versionNumber ?? versionSeq, opts.status ?? 'DRAFT');
  return id;
}

let roundSeq = 0;
function insertRound(opts: {
  versionId: string;
  code?: string | null;
  status?: string;
} = {}) {
  roundSeq++;
  const id = `round-uuid-${String(roundSeq).padStart(3, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO recruitment_rounds
        (id, template_version_id, title, position_level, open_date, close_date, status, deleted_at, application_pattern, round_code)
       VALUES (?, ?, ?, 'ปฏิบัติการ', ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      id,
      opts.versionId,
      `รอบทดสอบ ${roundSeq}`,
      Math.floor(Date.UTC(2026, 5, 1) / 1000),
      Math.floor(Date.UTC(2026, 5, 1) / 1000) + 30 * 86400,
      opts.status ?? 'ACTIVE',
      '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
      opts.code === undefined ? `RC${roundSeq}` : opts.code,
    );
  return id;
}

function versionRow(id: string): any {
  return sqlite.prepare('SELECT * FROM template_versions WHERE id = ?').get(id);
}

function publishedVersions(templateId = 'tpl-1'): any[] {
  return sqlite
    .prepare(`SELECT * FROM template_versions WHERE template_id = ? AND status = 'PUBLISHED' ORDER BY version_number`)
    .all(templateId);
}

function auditRowsFor(entityId: string): any[] {
  return sqlite
    .prepare(`SELECT * FROM audit_logs WHERE entity_type = 'TEMPLATE_VERSION' AND entity_id = ?`)
    .all(entityId);
}

async function rawAdminRequest(method: string, path: string, body?: object) {
  const token = await sign(
    { id: ADMIN_ID, email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
  return app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env());
}

async function adminRequest(method: string, path: string, body?: object) {
  d1._reset();
  return rawAdminRequest(method, path, body);
}

function insertTemplate(id: string, name = 'แบบฟอร์มทดสอบ 2569') {
  sqlite.prepare(`INSERT INTO templates (id, name) VALUES (?, ?)`).run(id, name);
  return id;
}

// ── P: Publish invariant ─────────────────────────────────────────────────

async function runAllTests() {
  console.log('=================================================');
  console.log('Template Publish Invariant — Tests');
  console.log('=================================================\n');

  await test('P1: publish บน state สะอาด → 200, archivedCount=1, เหลือ 1 PUBLISHED + audit 1 row', async () => {
    const tpl = insertTemplate('tpl-p1');
    const vOld = insertVersion({ templateId: tpl, versionNumber: 1, status: 'PUBLISHED' });
    const vNew = insertVersion({ templateId: tpl, versionNumber: 2, status: 'DRAFT' });

    const res = await adminRequest('PATCH', `/api/v1/admin/template-versions/${vNew}/publish`);
    assertEqual(res.status, 200, 'HTTP status');
    const json = await res.json();
    assertEqual(json.success, true, 'response.success');
    assertEqual(json.archivedCount, 1, 'response.archivedCount');

    const published = publishedVersions(tpl);
    assertEqual(published.length, 1, 'ต้องเหลือ 1 PUBLISHED');
    assertEqual(published[0].id, vNew, 'PUBLISHED ตัวเดียวคือ version ใหม่');
    assertEqual(versionRow(vOld).status, 'ARCHIVED', 'ตัวเก่าต้องเป็น ARCHIVED');

    const audits = auditRowsFor(vNew);
    assertEqual(audits.length, 1, 'audit_logs ต้องมี 1 row ชี้ version ใหม่');
    assertEqual(audits[0].action, 'UPDATE', 'action');
  });

  await test('P2 (fail-when-no-fix): legacy 3-PUBLISHED + publish → archive ทั้งหมด เหลือ 1 PUBLISHED', async () => {
    const tpl = insertTemplate('tpl-p2');
    const v1 = insertVersion({ templateId: tpl, versionNumber: 11, status: 'PUBLISHED' });
    const v2 = insertVersion({ templateId: tpl, versionNumber: 12, status: 'PUBLISHED' });
    const v3 = insertVersion({ templateId: tpl, versionNumber: 13, status: 'PUBLISHED' });
    const v4 = insertVersion({ templateId: tpl, versionNumber: 14, status: 'DRAFT' });

    const res = await adminRequest('PATCH', `/api/v1/admin/template-versions/${v4}/publish`);
    assertEqual(res.status, 200, 'HTTP status');
    const json = await res.json();
    assertEqual(json.archivedCount, 3, 'ต้อง archive zombie ทั้ง 3 ตัว');

    const published = publishedVersions(tpl);
    assertEqual(published.length, 1, 'ต้องเหลือ 1 PUBLISHED เสมอ (invariant)');
    assertEqual(published[0].id, v4, 'ตัวที่เหลือคือ version ใหม่');
    assertEqual(versionRow(v1).status, 'ARCHIVED', 'v1');
    assertEqual(versionRow(v2).status, 'ARCHIVED', 'v2');
    assertEqual(versionRow(v3).status, 'ARCHIVED', 'v3');
  });

  await test('P3: publish ARCHIVED → 400 (guard เดิมคงอยู่)', async () => {
    const tpl = insertTemplate('tpl-p3');
    const vA = insertVersion({ templateId: tpl, versionNumber: 21, status: 'ARCHIVED' });
    const res = await adminRequest('PATCH', `/api/v1/admin/template-versions/${vA}/publish`);
    assertEqual(res.status, 400, 'HTTP status');
    assertEqual(publishedVersions(tpl).length, 0, 'ห้ามเปลี่ยนสถานะ');
  });

  await test('P4: publish version ไม่มีจริง → 404', async () => {
    const res = await adminRequest('PATCH', `/api/v1/admin/template-versions/ver-nope/publish`);
    assertEqual(res.status, 404, 'HTTP status');
  });

  await test('P5 (fail-when-no-fix): แพ้ race (publishSelf changes=0) → 409 VERSION_ALREADY_PUBLISHED', async () => {
    const tpl = insertTemplate('tpl-p5');
    insertVersion({ templateId: tpl, versionNumber: 31, status: 'PUBLISHED' });
    const vNew = insertVersion({ templateId: tpl, versionNumber: 32, status: 'DRAFT' });
    // injection ต้องตั้งหลัง reset (adminRequest จะ reset ทับ)
    d1._reset();
    d1._setForceChangesZero(true);

    const res = await rawAdminRequest('PATCH', `/api/v1/admin/template-versions/${vNew}/publish`);
    assertEqual(res.status, 409, 'HTTP status');
    const json = await res.json();
    assertEqual(json.reason, 'VERSION_ALREADY_PUBLISHED', 'reason');

    assertEqual(versionRow(vNew).status, 'DRAFT', 'ห้ามเขียนทับสถานะจริงใน DB');
  });

  await test('P6 (fail-when-no-fix): crash กลาง batch → rollback ไม่มี partial state', async () => {
    const tpl = insertTemplate('tpl-p6');
    const vOld = insertVersion({ templateId: tpl, versionNumber: 41, status: 'PUBLISHED' });
    const vNew = insertVersion({ templateId: tpl, versionNumber: 42, status: 'DRAFT' });
    // run() ลำดับที่ 2 ใน request = publish-self ใน batch (archive-others คือ 1)
    // injection ต้องตั้งหลัง reset (adminRequest จะ reset ทับ)
    d1._reset();
    d1._setFailOnRun(2);

    const res = await rawAdminRequest('PATCH', `/api/v1/admin/template-versions/${vNew}/publish`);
    assertEqual(res.status >= 500, true, `crash ต้องตอบ error ไม่ใช่ success (ได้ ${res.status})`);

    const published = publishedVersions(tpl);
    assertEqual(published.length, 1, `crash กลาง batch ต้อง rollback ทั้งก้อน — ยัง 1 PUBLISHED (เดิมจะได้ 2)`);
    assertEqual(published[0].id, vOld, 'PUBLISHED ที่เหลือคือตัวเดิม');
    assertEqual(versionRow(vNew).status, 'DRAFT', 'version ใหม่ยังเป็น DRAFT');
  });

  await test('P7 (regression): archive endpoint ยังบล็อกเมื่อมี rounds อ้างอิง', async () => {
    const tpl = insertTemplate('tpl-p7');
    const vUsed = insertVersion({ templateId: tpl, versionNumber: 51, status: 'PUBLISHED' });
    insertRound({ versionId: vUsed });

    const res = await adminRequest('PATCH', `/api/v1/admin/template-versions/${vUsed}/archive`);
    assertEqual(res.status, 400, 'HTTP status');
    const json = await res.json();
    assertTrue(String(json.error).includes('referenced by rounds'), 'error ต้องระบุ snapshot policy');
    assertEqual(versionRow(vUsed).status, 'PUBLISHED', 'สถานะไม่เปลี่ยน');
  });

  await test('P8: invariant SQL (ชุดเดียวกับ workflow probe) ตรวจพบ fixture และหลัง cleanup = 0', async () => {
    const t2 = 'tpl-legacy';
    sqlite.prepare(`INSERT INTO templates (id, name) VALUES (?, ?)`).run(t2, 'legacy fixture');
    const z1 = insertVersion({ templateId: t2, versionNumber: 1, status: 'PUBLISHED' });
    insertVersion({ templateId: t2, versionNumber: 2, status: 'PUBLISHED' });
    insertVersion({ templateId: t2, versionNumber: 3, status: 'PUBLISHED' });

    const Q = `SELECT template_id, COUNT(*) AS published_count FROM template_versions
               WHERE status = 'PUBLISHED' GROUP BY template_id HAVING COUNT(*) > 1`;
    // (assert แบบ scope ที่ fixture ของ test นี้ — fixture อื่นอาจทิ้ง zombie ไว้เช่น R1/R3)
    const before = sqlite.prepare(Q).all().filter((r) => r.template_id === t2);
    assertEqual(before.length, 1, 'ต้องตรวจพบ 1 template ที่ผิด invariant');
    assertEqual(before[0].template_id, t2, 'template id ตรง fixture');
    assertEqual(before[0].published_count, 3, 'published_count = 3');

    // cleanup-style: เก็บ latest, archive ที่เหลือ (เหมือน runbook Phase 3)
    sqlite
      .prepare(`UPDATE template_versions SET status = 'ARCHIVED' WHERE template_id = ? AND id != ? AND status = 'PUBLISHED'`)
      .run(t2, z1);
    const after = sqlite.prepare(Q).all().filter((r) => r.template_id === t2);
    assertEqual(after.length, 0, 'หลัง cleanup ต้องไม่มี violation');
  });

  // ── R: Clone Round protection + POST /rounds gate ────────────────────────

  await test('R1 (fail-when-no-fix): clone-options กับ template 4-PUBLISHED → versionOptions = latest เดียว', async () => {
    // เลียน prod จริง: v2-v5 PUBLISHED, รอบ current ผูก v5 (CC01)
    const tpl = insertTemplate('tpl-r1');
    const v2 = insertVersion({ templateId: tpl, versionNumber: 61, status: 'PUBLISHED' });
    const v3 = insertVersion({ templateId: tpl, versionNumber: 62, status: 'PUBLISHED' });
    const v4 = insertVersion({ templateId: tpl, versionNumber: 63, status: 'PUBLISHED' });
    const v5 = insertVersion({ templateId: tpl, versionNumber: 64, status: 'PUBLISHED' });
    const rid = insertRound({ versionId: v5, code: 'CC01' });

    const res = await adminRequest('GET', `/api/v1/admin/rounds/${rid}/clone-options`);
    assertEqual(res.status, 200, 'HTTP status');
    const json = await res.json();
    const options = json.data.versionOptions;

    assertEqual(options.length, 1, `versionOptions ต้องเหลือ latest เดียว (เดิมคืน 4 รวม zombie)`);
    assertEqual(options[0].versionId, v5, 'ตัวเดียวที่เหลือคือ latest published');
    assertEqual(options[0].isRecommended, false, 'current = latest → ไม่มีตัว recommended');
  });

  await test('R2 (fail-when-no-fix): round current = version ที่ไม่ published → options ยังรวม current', async () => {
    const tpl = insertTemplate('tpl-r2');
    const vLatest = insertVersion({ templateId: tpl, versionNumber: 71, status: 'PUBLISHED' });
    const vCurrent = insertVersion({ templateId: tpl, versionNumber: 72, status: 'ARCHIVED' }); // snapshot ที่ถูก archive ทีหลัง
    const rid = insertRound({ versionId: vCurrent, code: 'SNAP1' });

    const res = await adminRequest('GET', `/api/v1/admin/rounds/${rid}/clone-options`);
    assertEqual(res.status, 200, 'HTTP status');
    const json = await res.json();
    const options = json.data.versionOptions;

    const ids = options.map((o) => o.versionId);
    assertTrue(ids.includes(vLatest), 'ต้องมี latest published');
    assertTrue(ids.includes(vCurrent), `ต้องรวม current version ของรอบ (เดิมหาย → Select เสียค่า) — ได้ ${JSON.stringify(ids)}`);

    const current = options.find((o) => o.versionId === vCurrent);
    assertEqual(current.isCurrentVersion, true, 'current ต้องถูก mark');
    const latest = options.find((o) => o.versionId === vLatest);
    assertEqual(latest.isRecommended, false, 'latest (72) ไม่สูงกว่า current (72) → ไม่ recommended');
  });

  await test('R3 (fail-when-no-fix): fallback contract — versionOptions[0] ต้องเป็น latest published', async () => {
    const tpl = insertTemplate('tpl-r3');
    const v2 = insertVersion({ templateId: tpl, versionNumber: 81, status: 'PUBLISHED' });
    const v5 = insertVersion({ templateId: tpl, versionNumber: 82, status: 'PUBLISHED' });
    const rid = insertRound({ versionId: v5, code: 'CC02' });

    const res = await adminRequest('GET', `/api/v1/admin/rounds/${rid}/clone-options`);
    const json = await res.json();
    const options = json.data.versionOptions;

    assertEqual(options[0].versionId, v5, `CloneRoundModal fallback = options[0] — ต้องเป็น latest (เดิม scan order ได้ v2 zombie)`);
    assertTrue(!options.some((o) => o.versionId === v2), 'zombie v2 ห้ามปรากฏใน options');
  });

  await test('R4: POST /rounds ด้วย version PUBLISHED → 201 (ทางเดินปกติ)', async () => {
    const tpl = insertTemplate('tpl-r4');
    const vPub = insertVersion({ templateId: tpl, versionNumber: 91, status: 'PUBLISHED' });

    const res = await adminRequest('POST', `/api/v1/admin/rounds`, {
      templateVersionId: vPub,
      title: 'รอบใหม่ปกติ',
      positionLevel: 'ปฏิบัติการ',
      openDate: Math.floor(Date.UTC(2026, 11, 1) / 1000),
      closeDate: Math.floor(Date.UTC(2026, 11, 15) / 1000),
      status: 'DRAFT',
      roundCode: 'R4OK',
    });
    assertEqual(res.status, 201, 'HTTP status');
    const json = await res.json();
    const row = sqlite.prepare('SELECT * FROM recruitment_rounds WHERE id = ?').get(json.id);
    assertTrue(!!row, 'round ถูกสร้างจริง');
    assertEqual(row.template_version_id, vPub, 'ผูก version ถูกตัว');
  });

  await test('R5 (fail-when-no-fix): POST /rounds ด้วย DRAFT version → 400 TEMPLATE_VERSION_NOT_PUBLISHED', async () => {
    const tpl = insertTemplate('tpl-r5');
    const vDraft = insertVersion({ templateId: tpl, versionNumber: 92, status: 'DRAFT' });

    const res = await adminRequest('POST', `/api/v1/admin/rounds`, {
      templateVersionId: vDraft,
      title: 'รอบผูก DRAFT',
      positionLevel: 'ปฏิบัติการ',
      openDate: Math.floor(Date.UTC(2026, 11, 1) / 1000),
      closeDate: Math.floor(Date.UTC(2026, 11, 15) / 1000),
      status: 'DRAFT',
      roundCode: 'R5NO',
    });
    assertEqual(res.status, 400, 'HTTP status');
    const json = await res.json();
    assertEqual(json.reason, 'TEMPLATE_VERSION_NOT_PUBLISHED', 'reason');

    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM recruitment_rounds WHERE round_code = 'R5NO'`).get().c;
    assertEqual(count, 0, 'ห้ามสร้างรอบค้างไว้');
  });

  await test('R6 (fail-when-no-fix): POST /rounds ด้วย version ไม่มีจริง → 404 TEMPLATE_VERSION_NOT_FOUND', async () => {
    const res = await adminRequest('POST', `/api/v1/admin/rounds`, {
      templateVersionId: 'ver-nope',
      title: 'รอบผูก version หาย',
      positionLevel: 'ปฏิบัติการ',
      openDate: Math.floor(Date.UTC(2026, 11, 1) / 1000),
      closeDate: Math.floor(Date.UTC(2026, 11, 15) / 1000),
      status: 'DRAFT',
      roundCode: 'R6NO',
    });
    assertEqual(res.status, 404, 'HTTP status');
    const json = await res.json();
    assertEqual(json.reason, 'TEMPLATE_VERSION_NOT_FOUND', 'reason');

    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM recruitment_rounds WHERE round_code = 'R6NO'`).get().c;
    assertEqual(count, 0, 'ห้ามสร้างรอบค้างไว้');
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
