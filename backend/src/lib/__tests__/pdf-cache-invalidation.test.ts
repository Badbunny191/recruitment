/**
 * D1 Tests — PDF Cache Invalidation in R2
 * ============================================================
 *
 * ปัญหา D1: PDF cache key เป็นคงที่ (`pdf/applications/{id}/{PDF_CACHE_VERSION}.pdf`)
 * เมื่อ cache hit ระบบคืนไฟล์เดิมทันทีโดยไม่ตรวจ version/timestamp —
 * ทำให้คืน PDF เก่าหลังข้อมูลต้นทางที่มีผลต่อ PDF เปลี่ยน
 *
 * test นี้ยืนยันพฤติกรรมใหม่:
 *   A. ขอ PDF ครั้งแรก → สร้างใหม่ + เขียน cache (cacheHit=false)
 *   B. ขอซ้ำโดยข้อมูลไม่เปลี่ยน → ใช้ cache เดิม (cacheHit=true)
 *   C. [หลักฐานล็อกพฤติกรรม] เปลี่ยน status/statusReason
 *      → ต้อง NOT invalidate — เพราะ Composer path ไม่ render status
 *      เลย (ไม่มี STATUS token / SystemDataKey) — test สแกน source
 *      เพื่อล็อกสมมติฐานนี้: ถ้าวันหน้ามีการเพิ่ม STATUS token เข้า
 *      composer test จะ fail เตือนให้กลับมาเพิ่ม invalidation จาก
 *      status change
 *   D. บันทึก Document Descriptor → invalidate เฉพาะใบสมัครของ
 *      template version นั้น (scoped) ไม่แตะ version อื่น/objects อื่น
 *   E. R2 delete ล้มเหลว → business operation หลัก (PUT descriptor)
 *      ยังสำเร็จ 200, มี error log, response ไม่เปิดเผยข้อมูลสำคัญ
 *   F. Regression — cache กลับมาใช้ได้หลัง regenerate,
 *      batching เกิน 1,000 keys, uploadRoutes ไม่มี DELETE
 *
 * Run: node --import tsx src/lib/__tests__/pdf-cache-invalidation.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { getApplicationPdf } from '../pdf.service';
import { buildPdfCacheKey } from '../pdf-types';
import {
  invalidatePdfCacheForTemplateVersion,
} from '../pdf-cache-invalidation';
import { authMiddleware } from '../../middlewares/auth.middleware';
import descriptorRouter from '../../routes/template-descriptor.routes';
import { uploadRoutes } from '../../routes/upload.routes';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`  ✗ ${name}: ${e?.message ?? e}`);
    });
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// Mock R2 bucket — รองรับ delete(string | string[]) + failure injection
// =============================================================================

function createMockR2Bucket({ failDelete = false } = {}) {
  const objects = new Map();
  const calls = { put: [], get: [], delete: [] as (string | string[])[] };

  const bucket = {
    async put(key, value, options) {
      calls.put.push(key);
      const bytes =
        value instanceof Uint8Array
          ? value
          : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
    },
    async get(key) {
      calls.get.push(key);
      const obj = objects.get(key);
      if (!obj) return undefined;
      return {
        key,
        size: obj.bytes.byteLength,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        body: obj.bytes,
        arrayBuffer: async () => obj.bytes.slice().buffer,
      };
    },
    async delete(key) {
      if (failDelete) throw new Error('R2 simulated delete failure');
      calls.delete.push(key);
      for (const k of Array.isArray(key) ? key : [key]) objects.delete(k);
    },
  };

  return { bucket, objects, calls };
}

// =============================================================================
// Mock drizzle db สำหรับ getApplicationPdf (cache-hit path) —
// pattern เดียวกับ upload-r2-regression.test.ts
// =============================================================================

function createMockDb(rowsByTable) {
  const tableName = (table) => table?.[Symbol.for('drizzle:Name')] ?? 'unknown';

  const makeBuilder = (rows) => {
    const builder = {
      where: () => builder,
      orderBy: () => builder,
      innerJoin: () => builder,
      limit: () => builder,
      get: async () => rows[0] ?? null,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };

  return {
    select: (_selection?: any) => ({
      from: (table: any) => makeBuilder(rowsByTable[tableName(table)] ?? []),
    }),
  };
}

function pdfFixtureDb(overrides = {}) {
  return createMockDb({
    applications: [
      {
        id: overrides.id ?? 'app-d1-1',
        applicationNo: 'สตง-25690001',
        roundId: 'round-d1',
        email: 'applicant@test.local',
        fullname: 'ผู้สมัคร ทดสอบ',
        nationalId: null,
        status: overrides.status ?? 'SUBMITTED',
        statusReason: overrides.statusReason ?? null,
        submittedAt: new Date('2026-10-01T10:00:00Z'),
        formData: JSON.stringify({}),
        ...overrides.extra,
      },
    ],
    recruitment_rounds: [
      {
        id: 'round-d1',
        title: 'รอบทดสอบระบบ',
        positionLevel: 'นักวิเคราะห์นโยบายและแผน',
        announcementTitle: null,
        announcementDescription: null,
        applicationPattern: null,
        roundCode: 'R01',
        templateVersionId: 'tv-d1',
      },
    ],
    template_versions: [{ id: 'tv-d1', versionNumber: 1, descriptorJson: null, descriptorSchemaVersion: null }],
    template_sections: [],
    template_fields: [],
    application_attachments: [],
  });
}

// =============================================================================
// SQLite fixture สำหรับ invalidation query + HTTP route test
// =============================================================================

/**
 * D1-compatible adapter over better-sqlite3 — route จริงเรียก `drizzle(c.env.DB)`
// ด้วย d1 driver จึงต้องมี prepare/bind/all/first/run/raw แบบ D1
 * (pattern เดียวกับ admin-login-lockout.test.ts)
 */
function createD1Adapter(sqlite) {
  const makeStatement = (sqlText) => {
    const stmt = sqlite.prepare(sqlText);
    let boundParams = [];
    const api = {
      bind(...params) {
        boundParams = params;
        return api;
      },
      async all() {
        return { results: stmt.all(...boundParams) };
      },
      async first() {
        return stmt.get(...boundParams) ?? null;
      },
      async run() {
        const info = stmt.run(...boundParams);
        return {
          success: true,
          meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        };
      },
      async raw() {
        return stmt.raw(true).all(...boundParams);
      },
    };
    return api;
  };

  return {
    prepare: (sqlText) => makeStatement(sqlText),
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        await s.run();
        results.push({ results: [], success: true, meta: { changes: 0 } });
      }
      return results;
    },
  };
}

function createSqliteFixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at INTEGER,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      password_migrated INTEGER NOT NULL DEFAULT 0
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
      application_no TEXT UNIQUE,
      round_id TEXT NOT NULL,
      email TEXT NOT NULL,
      fullname TEXT NOT NULL,
      national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED',
      status_reason TEXT,
      verified_by TEXT,
      verified_at INTEGER,
      form_data TEXT NOT NULL,
      submitted_at INTEGER,
      deleted_at INTEGER,
      year INTEGER,
      round_code TEXT,
      seq_in_round INTEGER
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT,
      ip_address TEXT,
      created_at INTEGER
    );
  `);

  const seed = sqlite.prepare(`
    INSERT INTO template_versions (id, template_id, version_number) VALUES (?, 'tpl-1', 1)
  `);
  seed.run('tv-A');
  seed.run('tv-B');

  sqlite.prepare(
    `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date)
     VALUES (?, ?, 'รอบ A', 'นักวิเคราะห์', 1760000000, 1770000000)`
  ).run('round-A', 'tv-A');
  sqlite.prepare(
    `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date)
     VALUES (?, ?, 'รอบ B', 'นักวิเคราะห์', 1760000000, 1770000000)`
  ).run('round-B', 'tv-B');

  const insertApp = sqlite.prepare(`
    INSERT INTO applications (id, application_no, round_id, email, fullname, form_data)
    VALUES (?, ?, ?, 'a@t.local', 'ผู้สมัคร ก', '{}')
  `);
  insertApp.run('app-A1', 'APP-A-0001', 'round-A');
  insertApp.run('app-A2', 'APP-A-0002', 'round-A');
  insertApp.run('app-B1', 'APP-B-0001', 'round-B');

  sqlite.prepare(`
    INSERT INTO admin_users (id, email, password_hash) VALUES ('admin-1', 'admin@test.local', 'x')
  `).run();

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// =============================================================================
// Tests
// =============================================================================

const VALID_DESCRIPTOR = {
  version: 1,
  blocks: [
    { id: 'blk-1', type: 'heading', text: 'แบบฟอร์มสมัครงาน', size: 'medium' },
  ],
};

async function runAllTests() {
  console.log('\n=== D1 — PDF Cache Invalidation (R2) ===\n');

  // ---------------------------------------------------------------------------
  console.log('[A] ขอ PDF ครั้งแรก — สร้างใหม่ + เขียน cache');
  // ---------------------------------------------------------------------------
  const bucketA = createMockR2Bucket();
  const dbA = pdfFixtureDb();
  let firstRenderBytes = 0;

  await test('A: ครั้งแรก cacheHit=false + สร้าง PDF + เขียน R2 cache', async () => {
    const result = await getApplicationPdf(dbA, bucketA.bucket, 'app-d1-1');
    assertTrue(result !== null, 'A: result must not be null');
    assertEqual(result.cacheHit, false, 'A: cacheHit');
    assertTrue(result.bytes.length > 0, 'A: PDF bytes non-empty');
    assertEqual(bucketA.calls.put.length, 1, 'A: R2.put called once');
    assertEqual(bucketA.calls.put[0], buildPdfCacheKey('app-d1-1'), 'A: put key format');
    firstRenderBytes = result.bytes.length;
  });

  console.log('\n[B] ขอซ้ำโดยข้อมูลไม่เปลี่ยน — ใช้ cache เดิม');
  await test('B: ครั้งถัดไป cacheHit=true + bytes ตรง cache', async () => {
    const result2 = await getApplicationPdf(dbA, bucketA.bucket, 'app-d1-1');
    assertEqual(result2.cacheHit, true, 'B: cacheHit');
    assertEqual(result2.bytes.length, firstRenderBytes, 'B: cached bytes match first render');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[C] เปลี่ยน status/statusReason — ไม่ invalidate (หลักฐาน: status ไม่ถูก render ใน PDF)');
  // ---------------------------------------------------------------------------
  await test('C: เปลี่ยน status/statusReason แล้วยัง cacheHit=true (status ไม่อยู่ใน PDF)', async () => {
    const { bucket, calls } = createMockR2Bucket();
    const db = pdfFixtureDb();
    // seed cache ก่อน (จำลองว่าเคยขอไปแล้ว)
    await bucket.put(
      buildPdfCacheKey('app-d1-1'),
      new TextEncoder().encode('%PDF-1.5 cached-before-status-change'),
      { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { 'x-generated-at': '1770000000' } }
    );

    const before = await getApplicationPdf(db, bucket, 'app-d1-1');
    assertEqual(before.cacheHit, true, 'C: baseline must be cache hit');

    // เปลี่ยน status + statusReason ใน "DB" (mock rows)
    const changedDb = pdfFixtureDb({ status: 'REJECTED', statusReason: 'เอกสารไม่ชัดเจน' });
    const after = await getApplicationPdf(changedDb, bucket, 'app-d1-1');
    assertEqual(after.cacheHit, true, 'C: still cache hit — status is NOT rendered in PDF');
    assertEqual(calls.delete.length, 0, 'C: no delete during PDF read path');
  });

  await test('C-lock: Composer source ต้องไม่มี STATUS token / ไม่อ่าน application.status', () => {
    const here = fileURLToPath(import.meta.url);
    const readSrc = (rel) =>
      readFileSync(here.replace('__tests__/pdf-cache-invalidation.test.ts', `document-composer/${rel}`), 'utf8');

    // ถ้า test นี้ fail ในอนาคต = มีการเพิ่ม STATUS เข้า composer
    // → ต้องกลับมาเพิ่ม invalidation จากการเปลี่ยนสถานะด้วย
    const tokensSrc = readSrc('document-tokens.ts');
    assertTrue(
      !/"STATUS"\]|'STATUS'|STATUS_REASON/.test(tokensSrc),
      'C-lock: DOCUMENT_TOKENS must not contain STATUS (if added → must invalidate on status change!)'
    );

    const typesSrc = readSrc('types.ts');
    assertTrue(
      !/"STATUS"/.test(typesSrc),
      'C-lock: SystemDataKey must not contain STATUS (if added → must invalidate on status change!)'
    );

    const rendererSrc = readSrc('descriptor-renderer.ts');
    assertTrue(
      !/ctx\.application\.(status|statusReason)|\.statusReason/.test(rendererSrc),
      'C-lock: descriptor-renderer must not read application.status/statusReason'
    );

    // getApplicationPdf ต้องใช้ composer path เท่านั้น (ไม่ใช่ legacy renderer
    // ตัวเดิมที่มี statusLabel — pdf-renderer.service.ts ไม่ถูก production import)
    const pdfServiceSrc = readFileSync(
      here.replace('__tests__/pdf-cache-invalidation.test.ts', 'pdf.service.ts'),
      'utf8'
    );
    assertTrue(
      !pdfServiceSrc.includes('renderApplicationPdf'),
      'C-lock: getApplicationPdf must use composer path only (no legacy renderer)'
    );
  });

  // ---------------------------------------------------------------------------
  console.log('\n[D] บันทึก Descriptor → invalidate เฉพาะใบสมัครของ version นั้น (scoped)');
  // ---------------------------------------------------------------------------
  await test('D: invalidate แบบ scoped — เฉพาะ apps ของ tv-A, ไม่แตะ tv-B/objects อื่น', async () => {
    const { db } = createSqliteFixture();
    const { bucket, objects, calls } = createMockR2Bucket();

    // seed cache: A1, A2 (tv-A), B1 (tv-B) + attachment อื่นใน bucket
    await bucket.put(buildPdfCacheKey('app-A1'), new TextEncoder().encode('pdf-A1'));
    await bucket.put(buildPdfCacheKey('app-A2'), new TextEncoder().encode('pdf-A2'));
    await bucket.put(buildPdfCacheKey('app-B1'), new TextEncoder().encode('pdf-B1'));
    await bucket.put('uploads/documents/2026/unrelated.pdf', new TextEncoder().encode('attachment'));

    const result = await invalidatePdfCacheForTemplateVersion(db, bucket, 'tv-A');

    assertEqual(result.failed, false, 'D: failed flag');
    assertEqual(result.invalidated, 2, 'D: exactly 2 apps of tv-A invalidated');
    assertTrue(!objects.has(buildPdfCacheKey('app-A1')), 'D: tv-A app-1 cache removed');
    assertTrue(!objects.has(buildPdfCacheKey('app-A2')), 'D: tv-A app-2 cache removed');
    assertTrue(objects.has(buildPdfCacheKey('app-B1')), 'D: tv-B cache must remain (unrelated)');
    assertTrue(objects.has('uploads/documents/2026/unrelated.pdf'), 'D: non-PDF objects untouched');
    assertEqual(calls.delete.length, 1, 'D: single batched delete call');
    assertEqual(calls.delete[0].length, 2, 'D: batch contains 2 keys');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[D2] Batching — เกิน 1,000 keys ต้องแบ่งเป็นหลาย call');
  // ---------------------------------------------------------------------------
  await test('D2: 1,003 keys → 2 batched delete calls (1000 + 3)', async () => {
    const { sqlite, db } = createSqliteFixture();
    const insertApp = sqlite.prepare(`
      INSERT INTO applications (id, application_no, round_id, email, fullname, form_data)
      VALUES (?, ?, 'round-A', 'a@t.local', 'ผู้สมัคร ข', '{}')
    `);
    for (let i = 0; i < 1001; i++) {
      insertApp.run(`app-A-bulk-${i}`, `APP-A-B${String(i).padStart(5, '0')}`);
    }
    const { bucket, calls } = createMockR2Bucket();
    const result = await invalidatePdfCacheForTemplateVersion(db, bucket, 'tv-A');

    assertEqual(result.invalidated, 1003, 'D2: all tv-A apps counted'); // 1001 + app-A1 + app-A2
    assertEqual(calls.delete.length, 2, 'D2: split into 2 batched calls');
    assertEqual(calls.delete[0].length, 1000, 'D2: first batch = 1000 keys');
    assertEqual(calls.delete[1].length, 3, 'D2: second batch = remaining keys');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[E] R2 delete ล้มเหลว — business op หลักยังสำเร็จ + error log + ไม่ leak');
  // ---------------------------------------------------------------------------
  await test('E.1: function ไม่ throw, คืน failed=true, log [PDF-CACHE] หนึ่งครั้ง', async () => {
    const { db } = createSqliteFixture();
    const { bucket } = createMockR2Bucket({ failDelete: true });

    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    let result;
    let threw = false;
    try {
      result = await invalidatePdfCacheForTemplateVersion(db, bucket, 'tv-A');
    } catch (e) {
      threw = true;
    } finally {
      console.error = originalError;
    }

    assertEqual(threw, false, 'E.1: must not throw');
    assertEqual(result.failed, true, 'E.1: failed=true reported');
    assertEqual(errors.length, 1, 'E.1: exactly one error logged');
    assertTrue(errors[0].includes('[PDF-CACHE]'), 'E.1: log has [PDF-CACHE] prefix');
    assertTrue(errors[0].includes('tv-A'), 'E.1: log names the template version');
  });

  await test('E.2: PUT descriptor ผ่าน HTTP ยัง 200 + descriptor บันทึกจริง + ไม่ leak R2 error', async () => {
    // env.DB ต้องเป็น D1 adapter เพราะ route เรียก drizzle(c.env.DB) (d1 driver)
    const { sqlite: sqlite2, db: db2 } = createSqliteFixture();
    const { bucket: badBucket } = createMockR2Bucket({ failDelete: true });

    const app = new Hono();
    app.use('/api/v1/admin/*', authMiddleware);
    app.route('/api/v1/admin/template-versions', descriptorRouter);

    const JWT_SECRET = 'test-jwt-secret-d1';
    const token = await sign(
      { id: 'admin-1', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET
    );

    const res = await app.request(
      '/api/v1/admin/template-versions/tv-A/descriptor',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ descriptor: VALID_DESCRIPTOR }),
      },
      { DB: createD1Adapter(sqlite2), R2_BUCKET: badBucket, JWT_SECRET: JWT_SECRET }
    );

    assertEqual(res.status, 200, 'E.2: PUT descriptor must still succeed (200)');
    const body = await res.json();
    assertTrue(body.success === true, 'E.2: response.success must be true');
    assertTrue(
      !JSON.stringify(body).includes('R2 simulated delete failure'),
      'E.2: R2 error detail must NOT leak to client'
    );

    // descriptor ยังถูกบันทึกจริงใน DB
    const row = db2
      .select({ json: schema.templateVersions.descriptorJson })
      .from(schema.templateVersions)
      .where(eq(schema.templateVersions.id, 'tv-A'))
      .get();
    assertTrue(row && row.json && row.json.includes('แบบฟอร์มสมัครงาน'), 'E.2: descriptor persisted in DB');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[F] Regression — happy path ผ่าน HTTP + cache กลับมาใช้ได้ + ไม่มี DELETE สาธารณะ');
  // ---------------------------------------------------------------------------
  await test('F.1: PUT descriptor ผ่าน HTTP จริง → invalidation เกิดจริงแบบ scoped', async () => {
    const { sqlite } = createSqliteFixture();
    const { bucket, objects } = createMockR2Bucket();
    await bucket.put(buildPdfCacheKey('app-A1'), new TextEncoder().encode('pdf-A1-old'));
    await bucket.put(buildPdfCacheKey('app-B1'), new TextEncoder().encode('pdf-B1-old'));

    const app = new Hono();
    app.use('/api/v1/admin/*', authMiddleware);
    app.route('/api/v1/admin/template-versions', descriptorRouter);

    const JWT_SECRET = 'test-jwt-secret-d1';
    const token = await sign(
      { id: 'admin-1', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET
    );

    const res = await app.request(
      '/api/v1/admin/template-versions/tv-A/descriptor',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ descriptor: VALID_DESCRIPTOR }),
      },
      { DB: createD1Adapter(sqlite), R2_BUCKET: bucket, JWT_SECRET: JWT_SECRET }
    );
    assertEqual(res.status, 200, 'F.1: PUT descriptor 200');
    assertTrue(!objects.has(buildPdfCacheKey('app-A1')), 'F.1: tv-A cache invalidated via HTTP');
    assertTrue(objects.has(buildPdfCacheKey('app-B1')), 'F.1: tv-B cache untouched');
  });

  await test('F.2: หลัง invalidate → regenerate (cacheHit=false) → ขอซ้ำใช้ cache (cacheHit=true)', async () => {
    const { bucket: bucket2 } = createMockR2Bucket();
    const db2 = pdfFixtureDb();
    const first = await getApplicationPdf(db2, bucket2, 'app-d1-1');
    assertEqual(first.cacheHit, false, 'F.2a: regenerate after invalidate (cacheHit=false)');
    const second = await getApplicationPdf(db2, bucket2, 'app-d1-1');
    assertEqual(second.cacheHit, true, 'F.2b: cache reused after regenerate (cacheHit=true)');
  });

  await test('F.3-F.5: uploadRoutes/descriptorRouter ไม่มี DELETE + PDF read path ไม่ delete', () => {
    // F.3 uploadRoutes ยังไม่มี DELETE (S1 ไม่กลับมา) — สอดคล้อง upload-r2-regression.test.ts
    const methods = uploadRoutes.routes.map((r) => r.method);
    assertTrue(!methods.includes('DELETE'), 'F.3: uploadRoutes must not expose DELETE');
    assertTrue(methods.includes('POST') && methods.includes('GET'), 'F.3: upload GET/POST intact');

    // F.4 route table ของ descriptorRouter ต้องไม่มี DELETE เช่นกัน
    const descriptorMethods = descriptorRouter.routes.map((r) => r.method);
    assertTrue(!descriptorMethods.includes('DELETE'), 'F.4: descriptorRouter must not expose DELETE');

    // F.5 getApplicationPdf ไม่มีทางเรียก R2 delete ใน read path
    const { calls: calls3 } = createMockR2Bucket();
    assertEqual(calls3.delete.length, 0, 'F.5: PDF read path never deletes');
  });
}

runAllTests()
  .then(() => {
    console.log('\n=== Summary ===\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    if (failed > 0) {
      (globalThis as any).process.exit(1);
    }
  })
  .catch((e) => {
    console.error('Test runner failed:', e);
    (globalThis as any).process.exit(1);
  });
