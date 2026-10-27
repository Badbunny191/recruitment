/**
 * R10: Round Integrity Hardening — Clone roundCode + Numbering settings lock
 * =======================================================================
 *
 * ปัญหาเดิม (audit):
 *   A. POST /admin/rounds/:id/clone คัดลอก round_code เดิมไปรอบใหม่เสมอ
 *      โดยไม่เรียก validateRoundCode และไม่ตรวจความซ้ำ — clone รอบปีเดียวกัน
 *      ได้ duplicate round_code ทุกครั้ง (เลขที่ใบสมัคร {YEAR}-{ROUND_CODE}-… ซ้ำข้ามรอบ)
 *      และ "ให้ admin เปลี่ยนเองทีหลัง" ใช้ไม่ได้จริงเพราะ PATCH ละทิ้ง field
 *   B. PATCH /admin/rounds/:id ละทิ้ง roundCode/applicationPattern เสมอ
 *      (immutable-ignore) แม้รอบยังไม่มีผู้สมัครที่ validate ผ่านแล้ว
 *      → UI แก้ได้แต่ไม่เคย save เงียบ ๆ
 *
 * การแก้:
 *   - clone: รับ roundCode (optional) → validateRoundCode + ตรวจซ้ำรายปี
 *     เหมือน POST /rounds; ไม่ส่งและต้นทางมีรหัส → 409 ROUND_CODE_REQUIRED
 *     พร้อม suggestedRoundCode; legacy (รหัส null) คง null ได้
 *   - clone-options: แนบ roundCode ปัจจุบัน + suggestedRoundCode (CODE+A..Z)
 *   - PATCH: ยังไม่มีผู้สมัคร → บันทึก roundCode/applicationPattern จริง;
 *     มีผู้สมัคร → 409 ROUND_CODE_LOCKED / PATTERN_LOCKED (คงเดิม);
 *     เช็คซ้ำใช้ปีของ openDate "ใหม่" ถ้า request เปลี่ยนวันพร้อมกัน
 *
 * ครอบคลุม:
 *   CL1. clone รอบมีรหัส ไม่ส่ง roundCode → 409 ROUND_CODE_REQUIRED + suggestion
 *        (fail-when-no-fix: เดิมได้ 201 + duplicate round_code)
 *   CL2. clone ส่ง roundCode ใหม่ → 201, DB เก็บรหัสใหม่, status DRAFT
 *   CL3. clone ส่งรหัสที่ถูกใช้แล้วในปีเดียวกัน → 409 ROUND_CODE_CONFLICT
 *   CL4. clone ส่งรหัสไม่ถูกรูปแบบ → 400 INVALID_ROUND_CODE
 *   CL5. clone legacy round (round_code NULL) ไม่ส่ง roundCode → 201 คง NULL
 *   CL6. clone-options คืน roundCode + suggestedRoundCode
 *   CL7. clone ด้วยรหัสตัวพิมพ์เล็ก/ช่องว่าง → normalize เป็น UPPERCASE
 *   PA1. PATCH roundCode รอบไม่มีผู้สมัคร → 200 และ DB เปลี่ยนจริง
 *        (fail-when-no-fix: เดิม 200 แต่ค่าเดิม — silent ignore)
 *   PA2. PATCH applicationPattern รอบไม่มีผู้สมัคร → 200 และ DB เปลี่ยนจริง
 *   PA3. PATCH roundCode รอบมีผู้สมัคร → 409 ROUND_CODE_LOCKED, ค่าไม่เปลี่ยน
 *   PA4. PATCH applicationPattern รอบมีผู้สมัคร → 409 PATTERN_LOCKED
 *   PA5. PATCH roundCode ซ้ำกับรอบอื่นปีเดียวกัน → 409 ROUND_CODE_CONFLICT
 *   PA6. PATCH roundCode ไม่ถูกรูปแบบ → 400 INVALID_ROUND_CODE
 *   PA7. PATCH เปลี่ยน openDate ไปอีกปีพร้อมรหัสที่ซ้ำปีนั้น → 409 (เช็คด้วยปีใหม่)
 *   PA8. PATCH roundCode ค่าเดิม → 200 ปกติ (ไม่โดน lock/conflict)
 *   PA9. PATCH roundCode สำเร็จ → audit payload มี diff roundCode เดิม→ใหม่
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ bulk-status-validation.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/round-clone-numbering.test.ts
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

const TEST_JWT_SECRET = 'test-secret-round-clone';

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

sqlite
  .prepare(`INSERT INTO templates (id, name) VALUES ('tpl-1', 'Template A')`)
  .run();
sqlite
  .prepare(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES ('ver-1', 'tpl-1', 1, 'PUBLISHED')`)
  .run();

// ปี ค.ศ. 2026 (unix seconds) — openDate ในเดือนมิถุนายน 2026
const YEAR_2026 = Date.UTC(2026, 5, 1) / 1000;
const YEAR_2027 = Date.UTC(2027, 5, 1) / 1000;

let roundSeq = 0;
function insertRound(opts: {
  code?: string | null;
  pattern?: string | null;
  status?: string;
  openDate?: number;
  deleted?: boolean;
} = {}) {
  roundSeq++;
  const id = `round-uuid-${String(roundSeq).padStart(3, '0')}`;
  sqlite
    .prepare(
      `INSERT INTO recruitment_rounds
        (id, template_version_id, title, position_level, open_date, close_date, status, deleted_at, application_pattern, round_code)
       VALUES (?, 'ver-1', ?, 'ปฏิบัติการ', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `รอบทดสอบ ${roundSeq}`,
      opts.openDate ?? YEAR_2026,
      (opts.openDate ?? YEAR_2026) + 30 * 86400,
      opts.status ?? 'DRAFT',
      opts.deleted ? Math.floor(Date.now() / 1000) : null,
      opts.pattern === undefined ? '{YEAR}-{ROUND_CODE}-{RUNNING:4}' : opts.pattern,
      opts.code === undefined ? null : opts.code,
    );
  return id;
}

function insertApplication(roundId: string, n: number) {
  sqlite
    .prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data)
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', '{}')`
    )
    .run(`app-${roundId}-${n}`, `APP-2026-${String(n).padStart(4, '0')}`, roundId, `a${n}@t.local`, `ผู้สมัคร ${n}`);
}

function roundRow(id: string): any {
  return sqlite.prepare('SELECT * FROM recruitment_rounds WHERE id = ?').get(id);
}

function roundCount(): number {
  return sqlite.prepare('SELECT count(*) AS c FROM recruitment_rounds').get().c;
}

async function adminRequest(method: string, path: string, body?: object) {
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

// ── CL: Clone round roundCode integrity ─────────────────────────────────

async function runAllTests() {

await test('CL1 (fail-when-no-fix): clone รอบมีรหัส ไม่ส่ง roundCode → 409 ROUND_CODE_REQUIRED + suggestedRoundCode', async () => {
  const src = insertRound({ code: 'CHM01' });
  const before = roundCount();
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    title: 'รอบ Clone',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_REQUIRED');
  assertEqual(json.suggestedRoundCode, 'CHM01A', 'suggestion');
  assertEqual(roundCount(), before, 'ห้ามสร้างรอบใหม่เมื่อ reject');
});

await test('CL2: clone ส่ง roundCode ใหม่ → 201, DB เก็บรหัสใหม่ สถานะ DRAFT', async () => {
  const src = insertRound({ code: 'CL2A' });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    title: 'รอบ Clone CL2',
    roundCode: 'CL2B',
  });
  assertEqual(res.status, 201, 'status');
  const json = await res.json();
  assertEqual(json.roundCode, 'CL2B', 'response roundCode');
  const clone = roundRow(json.id);
  assertTrue(!!clone, 'clone row exists');
  assertEqual(clone.round_code, 'CL2B');
  assertEqual(clone.status, 'DRAFT');
  assertEqual(clone.application_pattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}');
});

await test('CL3: clone ส่งรหัสที่ถูกใช้แล้วในปีเดียวกัน → 409 ROUND_CODE_CONFLICT', async () => {
  const src = insertRound({ code: 'CL3A' });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    roundCode: 'CL3A', // ชนรอบต้นทางเอง (ปีเดียวกัน)
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_CONFLICT');
  assertEqual(json.existingRoundId, src, 'existingRoundId ชี้รอบต้นทาง');
});

await test('CL4: clone ส่งรหัสไม่ถูกรูปแบบ (2 ตัว) → 400 INVALID_ROUND_CODE', async () => {
  const src = insertRound({ code: 'CL4A' });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    roundCode: 'AB',
  });
  assertEqual(res.status, 400, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'INVALID_ROUND_CODE');
});

await test('CL5: clone legacy round (round_code NULL) ไม่ส่ง roundCode → 201 คง NULL', async () => {
  const src = insertRound({ code: null, pattern: null });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    title: 'Legacy Clone',
  });
  assertEqual(res.status, 201, 'status');
  const json = await res.json();
  assertEqual(json.roundCode, null, 'legacy คง null');
  assertEqual(roundRow(json.id).round_code, null);
});

await test('CL6: clone-options คืน roundCode ปัจจุบัน + suggestedRoundCode', async () => {
  const src = insertRound({ code: 'CL6A' });
  const res = await adminRequest('GET', `/api/v1/admin/rounds/${src}/clone-options`);
  assertEqual(res.status, 200, 'status');
  const json = await res.json();
  assertEqual(json.data.originalRound.roundCode, 'CL6A');
  assertEqual(json.data.suggestedRoundCode, 'CL6AA', 'suggestion = CODE+A');
  // legacy round → suggestion เป็น null
  const legacy = insertRound({ code: null, pattern: null });
  const res2 = await adminRequest('GET', `/api/v1/admin/rounds/${legacy}/clone-options`);
  const json2 = await res2.json();
  assertEqual(json2.data.originalRound.roundCode, null);
  assertEqual(json2.data.suggestedRoundCode, null, 'legacy ไม่มี suggestion');
});

await test('CL7: clone ส่งรหัสตัวพิมพ์เล็ก/ช่องว่าง → normalize UPPERCASE', async () => {
  const src = insertRound({ code: 'CL7A' });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    roundCode: ' cl7b ',
  });
  assertEqual(res.status, 201, 'status');
  const json = await res.json();
  assertEqual(json.roundCode, 'CL7B');
  assertEqual(roundRow(json.id).round_code, 'CL7B');
});

await test('CL8: clone รหัสซ้ำแต่คนละปี (คนละ openDate) → 201 ได้', async () => {
  // รอบอื่นใช้รหัส 'CL8A' แต่ปี 2027 → clone รอบปี 2026 ใช้รหัสเดียวกันได้ตามกติกา unique รายปี
  insertRound({ code: 'CL8A', openDate: YEAR_2027 });
  const src = insertRound({ code: 'CL8Z' });
  const res = await adminRequest('POST', `/api/v1/admin/rounds/${src}/clone`, {
    templateVersionId: 'ver-1',
    roundCode: 'CL8A',
  });
  assertEqual(res.status, 201, 'status (รหัสซ้ำคนละปียอมให้)');
});

// ── PA: PATCH numbering settings lock ───────────────────────────────────

await test('PA1 (fail-when-no-fix): PATCH roundCode รอบไม่มีผู้สมัคร → 200 และ DB เปลี่ยนจริง', async () => {
  const r = insertRound({ code: 'PA1A' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'PA1B' });
  assertEqual(res.status, 200, 'status');
  assertEqual(roundRow(r).round_code, 'PA1B', 'roundCode ต้องถูกบันทึก (เดิม silent ignore คงค่าเดิม)');
});

await test('PA2: PATCH applicationPattern รอบไม่มีผู้สมัคร → 200 และ DB เปลี่ยนจริง', async () => {
  const r = insertRound({ code: 'PA2A' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, {
    applicationPattern: '{ROUND_CODE}-{RUNNING:3}',
  });
  assertEqual(res.status, 200, 'status');
  assertEqual(roundRow(r).application_pattern, '{ROUND_CODE}-{RUNNING:3}');
});

await test('PA3: PATCH roundCode รอบมีผู้สมัคร → 409 ROUND_CODE_LOCKED, ค่าไม่เปลี่ยน', async () => {
  const r = insertRound({ code: 'PA3A' });
  insertApplication(r, 1);
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'PA3B' });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_LOCKED');
  assertEqual(roundRow(r).round_code, 'PA3A', 'ค่าเดิมคงอยู่');
});

await test('PA4: PATCH applicationPattern รอบมีผู้สมัคร → 409 PATTERN_LOCKED', async () => {
  const r = insertRound({ code: 'PA4A' });
  insertApplication(r, 1);
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, {
    applicationPattern: '{YEAR}-{RUNNING:4}',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'PATTERN_LOCKED');
});

await test('PA5: PATCH roundCode ซ้ำกับรอบอื่นปีเดียวกัน → 409 ROUND_CODE_CONFLICT', async () => {
  insertRound({ code: 'PA5TAKEN' });
  const r = insertRound({ code: 'PA5A' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'PA5TAKEN' });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_CONFLICT');
  assertEqual(roundRow(r).round_code, 'PA5A', 'ไม่บันทึก');
});

await test('PA6: PATCH roundCode ไม่ถูกรูปแบบ → 400 INVALID_ROUND_CODE', async () => {
  const r = insertRound({ code: 'PA6A' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'มีตัวไทย!!' });
  assertEqual(res.status, 400, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'INVALID_ROUND_CODE');
});

await test('PA7: PATCH เปลี่ยน openDate ไปอีกปีพร้อมรหัสที่ซ้ำปีนั้น → 409 (เช็คด้วยปีใหม่)', async () => {
  // 'PA7TAKEN' มีอยู่ปี 2027 เท่านั้น — เดิมเช็คด้วยปี 2026 (openDate เดิม) จึงหลุด
  insertRound({ code: 'PA7TAKEN', openDate: YEAR_2027 });
  const r = insertRound({ code: 'PA7A', openDate: YEAR_2026 });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, {
    openDate: YEAR_2027,
    roundCode: 'PA7TAKEN',
  });
  assertEqual(res.status, 409, 'status');
  const json = await res.json();
  assertEqual(json.reason, 'ROUND_CODE_CONFLICT');
  assertEqual(roundRow(r).round_code, 'PA7A', 'ไม่บันทึก');
});

await test('PA8: PATCH roundCode ค่าเดิม → 200 ปกติ (ไม่โดน lock/conflict)', async () => {
  const r = insertRound({ code: 'PA8A' });
  insertApplication(r, 1); // มีผู้สมัคร แต่ส่งค่าเดิม → ไม่ใช่การเปลี่ยน
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'PA8A', title: 'ชื่อใหม่' });
  assertEqual(res.status, 200, 'status');
  assertEqual(roundRow(r).round_code, 'PA8A');
  assertEqual(roundRow(r).title, 'ชื่อใหม่');
});

await test('PA9: PATCH roundCode สำเร็จ → audit payload มี diff roundCode เดิม→ใหม่', async () => {
  const r = insertRound({ code: 'PA9A' });
  const res = await adminRequest('PATCH', `/api/v1/admin/rounds/${r}`, { roundCode: 'PA9B' });
  assertEqual(res.status, 200, 'status');
  const row = sqlite
    .prepare(`SELECT payload FROM audit_logs WHERE entity_id = ? AND action = 'UPDATE' ORDER BY created_at DESC LIMIT 1`)
    .get(r);
  assertTrue(!!row, 'มี audit log');
  const payload = JSON.parse(row.payload);
  assertTrue(
    JSON.stringify(payload).includes('PA9A') && JSON.stringify(payload).includes('PA9B'),
    `audit payload ต้องมีค่าเดิม/ใหม่: ${row.payload}`
  );
});

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n=== Round Clone + Numbering Hardening: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILED TESTS:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
