/**
 * Regression: TEMPLATE_VERSION audit entityId ผิด (BULK/NEW / templateId)
 * =======================================================================
 *
 * ที่มา: Audit Display Review — audit log ของ TEMPLATE_VERSION 2 จุดชี้ entity
 * ผิด ทำให้ audit-display resolver หา template_versions ไม่เจอ → หน้า Audit
 * Logs / Dashboard Activities แสดง fallback "BULK/NEW" หรือ UUID ย่อแทนชื่อ
 * template + เลข version
 *
 * ── ปัญหา #1 (UPDATE) ────────────────────────────────────────────────────
 *   PUT /admin/template-versions/:versionId — path param ชื่อ :versionId
 *   แต่ auditMiddleware อ่าน c.req.param('id') → undefined → entityId = 'BULK/NEW'
 *
 * ── ปัญหา #2 (CREATE) ────────────────────────────────────────────────────
 *   POST /admin/templates/:id/versions — :id ใน path คือ templateId แต่ entity
 *   จริงคือ version ที่เพิ่งสร้าง (versionId = uuidv4() ใน handler) →
 *   entityId = templateId → resolver ค้น template_versions.id ด้วย templateId
 *   → ไม่เจอ → fallback UUID ย่อของ *template* (ทั้งอ่านไม่ออกและชี้ผิด entity)
 *
 * แนวทางแก้ (write-path เท่านั้น — ห้ามแก้ historical audit logs):
 *   auditMiddleware อ่าน c.get('auditEntityId') นำหน้า param('id') — route
 *   handler ที่ entity id ไม่ได้อยู่ใน path เป็น :id ตั้งค่านี้เอง
 *
 * ครอบคลุม:
 *   TV1. PUT :versionId → entityId = versionId (ไม่ใช่ BULK/NEW), action = UPDATE
 *   TV2. POST /templates/:id/versions → entityId = versionId ที่ response คืน
 *        (ไม่ใช่ templateId), action = CREATE
 *   TV3. (middleware unit) ไม่ตั้ง override → ยังใช้ param('id') ตามเดิม
 *   TV4. (middleware unit) ตั้ง override → ชนะ param('id')
 *   TV5. (middleware unit) ไม่มี :id และไม่ตั้ง override → 'BULK/NEW' เหมือนเดิม
 *   TV6. (middleware unit) response 4xx → ไม่เขียน audit (พฤติกรรมเดิมคงอยู่)
 *
 * ใช้ข้อมูลสังเคราะห์ 100% — รัน route จริงบน Hono กับ D1 จำลอง (in-memory)
 * แบบเดียวกับ audit-fail-soft-and-create-user.test.ts ไม่ deploy ไม่แตะ D1 จริง
 *
 * รัน: node --import tsx src/routes/__tests__/template-version-audit-entity.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../admin.routes';
import { auditMiddleware } from '../../middlewares/audit.middleware';

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

// ── D1-compatible adapter (แบบเดียวกับ audit-fail-soft-and-create-user.test.ts) ──
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

const TEST_JWT_SECRET = 'test-secret-template-version-audit';

// DDL ครบทุกคอลัมน์ที่ drizzle select/insert อ้างถึงใน path ที่ทดสอบ
// (drizzle .select().from(templateVersions) ดึงคอลัมน์ mapped ทั้งหมด — ขาด = SQL error)
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
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at INTEGER DEFAULT (unixepoch()),
    descriptor_json TEXT,
    descriptor_schema_version INTEGER,
    descriptor_updated_at INTEGER,
    descriptor_updated_by TEXT,
    pdf_filename_pattern TEXT
  );
  CREATE TABLE template_sections (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    section_id TEXT,
    display_order INTEGER NOT NULL,
    is_required INTEGER DEFAULT 1,
    override_options TEXT,
    override_label_th TEXT,
    help_text TEXT,
    placeholder TEXT,
    validation_rules TEXT,
    rows INTEGER,
    min_length INTEGER,
    max_length INTEGER,
    validation_message TEXT,
    allow_other INTEGER
  );
`);

const d1 = createD1Adapter(sqlite);

const app = new Hono();
app.route('/api/v1/admin', adminRoutes);

// แอปย่อยสำหรับทดสอบ auditMiddleware โดยตรง (unit) — ไม่พึ่ง admin route chain
const ACTOR_ID = 'actor-uuid-0001';
const mwApp = new Hono();
mwApp.use('/mw/*', async (c, next) => {
  c.set('jwtPayload', { id: ACTOR_ID, email: 'actor@test.local', role: 'SUPER_ADMIN' });
  await next();
});
mwApp.post('/mw/widgets/:id', auditMiddleware('WIDGET'), (c) => c.json({ ok: true }, 201));
mwApp.post('/mw/override/:id', auditMiddleware('WIDGET'), (c) => {
  c.set('auditEntityId', 'custom-entity-id');
  return c.json({ ok: true }, 201);
});
mwApp.post('/mw/no-id', auditMiddleware('WIDGET'), (c) => c.json({ ok: true }, 201));
mwApp.post('/mw/fail/:id', auditMiddleware('WIDGET'), (c) => c.json({ error: 'x' }, 400));

const env = () => ({
  DB: d1,
  JWT_SECRET: TEST_JWT_SECRET,
});

const SUPER_ADMIN_ID = 'superadmin-uuid-0001';
const TEMPLATE_ID = 'template-uuid-1000-1000-1000-1000';
const VERSION_ID = 'version-uuid-2000-2000-2000-2000';

sqlite
  .prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES (?, ?, 'x', 'SUPER_ADMIN', 1)`)
  .run(SUPER_ADMIN_ID, 'superadmin@test.local');

function auditRows(entityType = 'TEMPLATE_VERSION'): any[] {
  return sqlite.prepare('SELECT * FROM audit_logs WHERE entity_type = ?').all(entityType);
}

function clearAudit() {
  sqlite.prepare('DELETE FROM audit_logs').run();
}

async function superAdminToken() {
  return await sign(
    { id: SUPER_ADMIN_ID, email: 'superadmin@test.local', role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET
  );
}

async function requestAdmin(method: string, path: string, body?: object) {
  const token = await superAdminToken();
  const res = await app.request(
    `/api/v1/admin${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'cf-connecting-ip': '198.51.100.9',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    env()
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function runAllTests() {
  console.log('\n=== Regression: TEMPLATE_VERSION audit entityId (BULK/NEW / templateId) ===\n');

  // ---- TV1: PUT /template-versions/:versionId → entityId = versionId ----
  await test('TV1: PUT /template-versions/:versionId → audit entityId = versionId (ไม่ใช่ BULK/NEW)', async () => {
    clearAudit();
    sqlite
      .prepare(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES (?, ?, 1, 'DRAFT')`)
      .run(VERSION_ID, TEMPLATE_ID);

    const res = await requestAdmin('PUT', `/template-versions/${VERSION_ID}`, {
      sections: [{ tempId: 's1', name: 'ข้อมูลทั่วไป', displayOrder: 1 }],
      fields: [{ fieldId: 'field-master-1', sectionId: 's1', displayOrder: 1 }],
    });
    assertEqual(res.status, 200, `HTTP status: ${JSON.stringify(res.body)}`);
    assertEqual(res.body?.versionId, VERSION_ID, 'response ต้องคืน versionId เดียวกับ path');

    const rows = auditRows();
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว (entityType=TEMPLATE_VERSION)');
    assertEqual(rows[0].action, 'UPDATE', 'action จาก HTTP method PUT');
    assertEqual(rows[0].entity_id, VERSION_ID, '❌ พฤติกรรมเดิม (ก่อนแก้): entityId = BULK/NEW เพราะ param ชื่อ :versionId');
    assertTrue(rows[0].entity_id !== 'BULK/NEW', 'entityId ห้ามเป็น sentinel BULK/NEW');
  });

  // ---- TV2: POST /templates/:id/versions → entityId = versionId ที่ response คืน ----
  await test('TV2: POST /templates/:templateId/versions → audit entityId = versionId (ไม่ใช่ templateId)', async () => {
    clearAudit();

    const res = await requestAdmin('POST', `/templates/${TEMPLATE_ID}/versions`, {
      templateId: TEMPLATE_ID,
      fields: [{ fieldId: 'field-master-1', displayOrder: 1 }], // Mode C: fields only
    });
    assertEqual(res.status, 201, `HTTP status: ${JSON.stringify(res.body)}`);
    const newVersionId = res.body?.versionId;
    assertTrue(typeof newVersionId === 'string' && newVersionId.length > 0, 'response ต้องคืน versionId');

    // sanity: version ถูกสร้างจริง
    const ver = sqlite.prepare('SELECT id FROM template_versions WHERE id = ?').get(newVersionId);
    assertTrue(!!ver, 'version ต้องถูกสร้างจริงใน DB');

    const rows = auditRows();
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว (entityType=TEMPLATE_VERSION)');
    assertEqual(rows[0].action, 'CREATE', 'action จาก HTTP method POST');
    assertEqual(
      rows[0].entity_id,
      newVersionId,
      `❌ พฤติกรรมเดิม (ก่อนแก้): entityId = templateId (${TEMPLATE_ID}) เพราะ :id ใน path คือ template`,
    );
    assertTrue(rows[0].entity_id !== TEMPLATE_ID, 'entityId ห้ามเป็น templateId');
  });

  // ---- TV3: (unit) ไม่ตั้ง override → param('id') ตามเดิม ----
  await test('TV3: middleware ไม่มี override → ยังใช้ param(:id) ตามพฤติกรรมเดิม', async () => {
    clearAudit();
    const res = await mwApp.request('/mw/widgets/widget-1234', { method: 'POST' }, env());
    assertEqual(res.status, 201, 'HTTP status');

    const rows = auditRows('WIDGET');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');
    assertEqual(rows[0].entity_id, 'widget-1234', 'entityId = param(:id)');
    assertEqual(rows[0].action, 'CREATE', 'action จาก POST');
  });

  // ---- TV4: (unit) override ชนะ param(:id) ----
  await test('TV4: middleware c.set(auditEntityId) ชนะ param(:id)', async () => {
    clearAudit();
    const res = await mwApp.request('/mw/override/path-id-9999', { method: 'POST' }, env());
    assertEqual(res.status, 201, 'HTTP status');

    const rows = auditRows('WIDGET');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');
    assertEqual(rows[0].entity_id, 'custom-entity-id', 'entityId = override จาก handler');
  });

  // ---- TV5: (unit) ไม่มี :id และไม่มี override → BULK/NEW ----
  await test("TV5: middleware ไม่มี :id ใน path และไม่มี override → 'BULK/NEW' เหมือนเดิม", async () => {
    clearAudit();
    const res = await mwApp.request('/mw/no-id', { method: 'POST' }, env());
    assertEqual(res.status, 201, 'HTTP status');

    const rows = auditRows('WIDGET');
    assertEqual(rows.length, 1, 'ต้องมี audit row 1 แถว');
    assertEqual(rows[0].entity_id, 'BULK/NEW', 'sentinel เดิมต้องคงอยู่ (เช่น POST /admin/users)');
  });

  // ---- TV6: (unit) 4xx → ไม่เขียน audit ----
  await test('TV6: response 4xx → ไม่เขียน audit row (พฤติกรรมเดิมคงอยู่)', async () => {
    clearAudit();
    const res = await mwApp.request('/mw/fail/ignored-id', { method: 'POST' }, env());
    assertEqual(res.status, 400, 'HTTP status');

    const rows = auditRows('WIDGET');
    assertEqual(rows.length, 0, 'ห้ามเขียน audit เมื่อ request ล้มเหลว');
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
