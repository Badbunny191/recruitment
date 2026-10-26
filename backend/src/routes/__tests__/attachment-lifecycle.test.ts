/**
 * Attachment Lifecycle Tests (Migration 029) — TEMP → ACTIVE → DELETED
 * =======================================================================
 *
 * ครอบคลุม 3 ปัญหาที่ปิดในงานเดียว:
 *   1. Orphan Files   → upload ลง ledger TEMP / cron GC เก็บ TEMP เกิน 7 วัน
 *   2. Delete หลอก    → DELETE /public/uploads/direct/:ledgerId ลบจริงทั้ง
 *                       R2 object + ledger (ต้องมี delete token, TEMP เท่านั้น)
 *   3. Public Access  → GET /public/uploads/files/:key ต้องมี signed URL
 *                       (HMAC-SHA256) + ledger DELETED ต้อง 404
 *
 * ใช้ Hono app จริง + better-sqlite3 (D1 adapter) + in-memory R2 mock
 * 100% ข้อมูลสังเคราะห์ ไม่ deploy ไม่แตะ D1/R2 จริง
 *
 * Run: node --import tsx src/routes/__tests__/attachment-lifecycle.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import { uploadRoutes } from '../upload.routes';
import { insertTempLedger, buildPromoteAttachmentsStatements, hashDeleteToken } from '../../lib/attachment-ledger';
import { signAttachmentKey, verifyAttachmentSignature } from '../../lib/attachment-signing';
import { cleanupExpiredTempAttachments } from '../../lib/attachment-cleanup';
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

// ── D1-compatible adapter (แบบเดียวกับ submit-required-file.test.ts) ──
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

// ── In-memory R2 mock ──
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
      const bytes = objects.get(key);
      if (!bytes) return undefined;
      return {
        key,
        size: bytes.byteLength,
        httpEtag: 'mock-etag',
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {},
        body: bytes,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket, objects };
}

// ── Setup ──
const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE attachment_uploads (
    id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP',
    uploaded_at INTEGER, application_id TEXT, original_filename TEXT,
    delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER
  );
  CREATE TABLE applications (id TEXT PRIMARY KEY, application_no TEXT UNIQUE);
`);

const d1 = createD1Adapter(sqlite);
const db = drizzle(d1);
const { bucket, objects } = createMockR2Bucket();

const app = new Hono();
app.route('/api/v1/public/uploads', uploadRoutes);

const SECRET = 'test-secret-attachment-lifecycle';
const env = () => ({ DB: d1, R2_BUCKET: bucket, JWT_SECRET: SECRET });

const BASE = '/api/v1/public/uploads';

function ledgerRow(id: string) {
  return sqlite.prepare('SELECT * FROM attachment_uploads WHERE id = ?').get(id);
}
function ledgerRowByKey(r2Key: string) {
  return sqlite.prepare('SELECT * FROM attachment_uploads WHERE r2_key = ?').get(r2Key);
}

/** helper: upload ผ่าน route จริง → คืน data + reset rate limit ก่อนทุกครั้ง */
async function uploadFile(name = 'เอกสารทดสอบ.pdf') {
  __resetRateLimitStoreForTests();
  const form = new FormData();
  form.append('file', new File([new TextEncoder().encode('%PDF-1.4 lifecycle-test')], name, { type: 'application/pdf' }));
  const res = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env());
  assertEqual(res.status, 201, `upload "${name}" must be 201`);
  const body = await res.json();
  assertTrue(body.success === true, 'upload must succeed');
  return body.data;
}

/** signed path ของ key ด้วย TTL ที่คุมเอง */
async function signedPath(key: string, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await signAttachmentKey(key, exp, SECRET);
  return `${BASE}/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

async function runAllTests() {
  console.log('\n=== Attachment Lifecycle — TEMP → ACTIVE → DELETED ===\n');

  // =========================================================================
  console.log('[A] Upload → TEMP ledger');
  // =========================================================================

  let uploaded: any;

  await test('A1. POST /direct → 201 พร้อม ledgerId + deleteToken + viewUrl', async () => {
    uploaded = await uploadFile('ใบสมัคร-ทดสอบ.pdf');
    assertTrue(typeof uploaded.ledgerId === 'string' && uploaded.ledgerId.length > 10, `ledgerId: ${uploaded.ledgerId}`);
    assertTrue(typeof uploaded.deleteToken === 'string' && uploaded.deleteToken.length >= 32, 'deleteToken must be long random');
    assertTrue(uploaded.viewUrl.includes('?exp=') && uploaded.viewUrl.includes('&sig='), `viewUrl must carry signature: ${uploaded.viewUrl}`);
    assertTrue(uploaded.viewUrl.startsWith('/api/v1/public/uploads/files/'), 'viewUrl is a relative API path');
  });

  await test('A2. ledger row สถานะ TEMP + r2_key + hash ของ token', () => {
    const row = ledgerRow(uploaded.ledgerId);
    assertTrue(!!row, 'ledger row must exist');
    assertEqual(row.status, 'TEMP');
    assertEqual(row.r2_key, uploaded.fileKey);
    assertEqual(row.application_id, null, 'TEMP must not be bound to an application');
    assertTrue(!!row.delete_token_hash && /^[0-9a-f]{64}$/.test(row.delete_token_hash), 'delete_token_hash = sha256 hex');
    assertTrue(objects.has(uploaded.fileKey), 'object must be in R2');
  });

  await test('A3. delete token เก็บเป็น SHA-256 ของ token จริง (ตรวจ cross-check)', async () => {
    const row = ledgerRow(uploaded.ledgerId);
    assertEqual(row.delete_token_hash, await hashDeleteToken(uploaded.deleteToken));
  });

  // =========================================================================
  console.log('\n[B] GET /files/:key — ต้องมี signed URL เท่านั้น');
  // =========================================================================

  await test('B1. ไม่มี signature → 403 (ปิดปัญหา public access)', async () => {
    const res = await app.request(`${BASE}/files/${encodeURIComponent(uploaded.fileKey)}`, {}, env());
    assertEqual(res.status, 403, 'unsigned GET must be 403');
  });

  await test('B2. signature ผิด → 403', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(uploaded.fileKey)}?exp=${exp}&sig=${'a'.repeat(64)}`,
      {}, env(),
    );
    assertEqual(res.status, 403, 'wrong signature must be 403');
  });

  await test('B3. signature ถูกแต่หมดอายุ → 403', async () => {
    const res = await app.request(await signedPath(uploaded.fileKey, -600), {}, env());
    assertEqual(res.status, 403, 'expired signature must be 403');
  });

  await test('B4. valid signature บนไฟล์ TEMP → 200 + bytes ตรง', async () => {
    const res = await app.request(await signedPath(uploaded.fileKey), {}, env());
    assertEqual(res.status, 200);
    assertEqual(res.headers.get('Cache-Control'), 'private, max-age=3600', 'cache must be private (ไม่ใช่ public 1 ปีแบบเดิม)');
    const text = await res.text();
    assertTrue(text.startsWith('%PDF-1.4'), 'body must match uploaded content');
  });

  await test('B5. valid signature บนไฟล์ legacy (ไม่มี ledger row) → 200 (backward compat)', async () => {
    const legacyKey = 'uploads/documents/2025/legacy-file-เก่า.pdf';
    await bucket.put(legacyKey, new TextEncoder().encode('%PDF-1.4 legacy'));
    const res = await app.request(await signedPath(legacyKey), {}, env());
    assertEqual(res.status, 200, 'legacy object with valid signature must still be served');
  });

  await test('B6. signature ถูกแต่ ledger เป็น DELETED → 404 (แม้ object ยังอยู่)', async () => {
    const key = 'uploads/documents/2026/deleted-target.pdf';
    await bucket.put(key, new TextEncoder().encode('%PDF-1.4 gone'));
    sqlite.prepare("INSERT INTO attachment_uploads (id, r2_key, status) VALUES (?, ?, 'DELETED')")
      .run('ledger-dead', key);
    const res = await app.request(await signedPath(key), {}, env());
    assertEqual(res.status, 404, 'DELETED ledger must block access');
    assertTrue(objects.has(key), 'object may linger in R2 — access control is the ledger');
  });

  await test('B7. signature ของ key อื่น ไม่ใช้กับ key นี้ได้ (ตรวจ HMAC binding)', async () => {
    const otherKey = 'uploads/documents/2026/other.pdf';
    await bucket.put(otherKey, new TextEncoder().encode('%PDF-1.4 other'));
    const exp = Math.floor(Date.now() / 1000) + 600;
    const foreignSig = await signAttachmentKey(uploaded.fileKey, exp, SECRET);
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(otherKey)}?exp=${exp}&sig=${foreignSig}`,
      {}, env(),
    );
    assertEqual(res.status, 403, 'signature minted for another key must be rejected');
  });

  // =========================================================================
  console.log('\n[C] Submit → promote TEMP → ACTIVE');
  // =========================================================================

  const applicationId = 'app-lifecycle-1';

  await test('C1. promote ผ่าน fileUrl (encoded ไทย) → ACTIVE + application_id', async () => {
    const fileUrl = `/api/v1/public/uploads/files/${encodeURIComponent(uploaded.fileKey)}`;
    const statements = buildPromoteAttachmentsStatements(db, {
      applicationId,
      fileUrls: [fileUrl],
    });
    assertEqual(statements.length, 1, 'one UPDATE per attachment');
    await db.batch(statements);
    const row = ledgerRow(uploaded.ledgerId);
    assertEqual(row.status, 'ACTIVE');
    assertEqual(row.application_id, applicationId);
    assertTrue(!!row.activated_at, 'activated_at must be set');
  });

  await test('C2. promote fileUrl ที่ไม่มีใน ledger → ไม่ throw, 0 แถว (legacy ผ่านได้)', async () => {
    const statements = buildPromoteAttachmentsStatements(db, {
      applicationId,
      fileUrls: [`/api/v1/public/uploads/files/${encodeURIComponent('uploads/documents/2025/ghost.pdf')}`],
    });
    await db.batch(statements); // must not throw
    assertTrue(true);
  });

  await test('C3. promote ซ้ำ → ยัง ACTIVE (guard WHERE status=TEMP, ไม่ revert)', async () => {
    const statements = buildPromoteAttachmentsStatements(db, {
      applicationId: 'app-other',
      fileUrls: [`/api/v1/public/uploads/files/${encodeURIComponent(uploaded.fileKey)}`],
    });
    await db.batch(statements);
    const row = ledgerRow(uploaded.ledgerId);
    assertEqual(row.status, 'ACTIVE');
    assertEqual(row.application_id, applicationId, 'application_id must NOT be overwritten by a second promote');
  });

  // =========================================================================
  console.log('\n[D] DELETE /direct/:ledgerId — ลบจริง (R2 + ledger)');
  // =========================================================================

  await test('D1. ไม่แนบ token → 403', async () => {
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/${uploaded.ledgerId}`, { method: 'DELETE' }, env());
    assertEqual(res.status, 403);
  });

  await test('D2. token ผิด → 403 และไฟล์ยังอยู่', async () => {
    const tempUpload = await uploadFile('token-ผิด.pdf');
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/${tempUpload.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': 'wrong-token' },
    }, env());
    assertEqual(res.status, 403);
    assertTrue(objects.has(tempUpload.fileKey), 'object must survive a wrong-token delete');
    assertEqual(ledgerRow(tempUpload.ledgerId).status, 'TEMP');
  });

  let freshUpload: any;

  await test('D3. token ถูกต้อง (TEMP) → 200 + R2 object ถูกลบ + ledger DELETED', async () => {
    freshUpload = await uploadFile('จะลบไฟล์นี้.pdf');
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/${freshUpload.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': freshUpload.deleteToken },
    }, env());
    assertEqual(res.status, 200, `delete must succeed: ${res.status}`);
    assertTrue(!objects.has(freshUpload.fileKey), 'R2 object must really be deleted (ไม่ใช่แค่ state)');
    assertEqual(ledgerRow(freshUpload.ledgerId).status, 'DELETED');
    assertTrue(!!ledgerRow(freshUpload.ledgerId).deleted_at, 'deleted_at must be set');
  });

  await test('D4. ลบซ้ำ (DELETED แล้ว) → 404', async () => {
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/${freshUpload.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': freshUpload.deleteToken },
    }, env());
    assertEqual(res.status, 404);
  });

  await test('D5. ลบไฟล์ ACTIVE → 409 (ห้ามลบของที่ submit แล้ว)', async () => {
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/${uploaded.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': uploaded.deleteToken },
    }, env());
    assertEqual(res.status, 409);
    assertTrue(objects.has(uploaded.fileKey), 'ACTIVE object must survive');
  });

  await test('D6. legacy row (ไม่มี delete_token_hash) → 403 แม้ token อะไรมาก็ตาม', async () => {
    const key = 'uploads/documents/2025/legacy-no-token.pdf';
    sqlite.prepare("INSERT INTO attachment_uploads (id, r2_key, status, delete_token_hash) VALUES (?, ?, 'TEMP', NULL)")
      .run('ledger-legacy', key);
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/ledger-legacy`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': 'anything' },
    }, env());
    assertEqual(res.status, 403);
  });

  await test('D7. ledgerId ไม่มีอยู่ → 404', async () => {
    __resetRateLimitStoreForTests();
    const res = await app.request(`${BASE}/direct/no-such-ledger-id`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': 'x' },
    }, env());
    assertEqual(res.status, 404);
  });

  // =========================================================================
  console.log('\n[E] Cron cleanup — TEMP เกิน 7 วัน (idempotent)');
  // =========================================================================

  await test('E1. TEMP เก่าเกิน 7 วัน → ลบ R2 + mark DELETED', async () => {
    const key = 'uploads/documents/2026/old-temp.pdf';
    await bucket.put(key, new TextEncoder().encode('%PDF-1.4 old'));
    // เก็บเป็น unix seconds จริง (8 วันก่อน) ให้ตรงกับ unixepoch() ของคอลัมน์
    const uploadedAtSec = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    sqlite.prepare(
      "INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at) VALUES (?, ?, 'TEMP', ?)",
    ).run('ledger-old', key, uploadedAtSec);

    const result = await cleanupExpiredTempAttachments(db, bucket);
    assertEqual(result.deleted, 1, `one TEMP must be deleted: ${JSON.stringify(result)}`);
    assertTrue(!objects.has(key), 'old TEMP object must be removed from R2');
    assertEqual(ledgerRow('ledger-old').status, 'DELETED');
    assertTrue(!!ledgerRow('ledger-old').deleted_at, 'deleted_at must be set by cleanup');
  });

  await test('E2. TEMP อายุยังน้อย → ไม่ถูกแตะ', async () => {
    const entry = await insertTempLedger(db, { r2Key: 'uploads/documents/2026/young.pdf', originalFilename: 'young.pdf' });
    await cleanupExpiredTempAttachments(db, bucket);
    assertEqual(ledgerRow(entry.ledgerId).status, 'TEMP', 'young TEMP must survive');
  });

  await test('E3. ACTIVE เก่าแค่ไหนก็ไม่ถูกแตะ (ของจริงในใบสมัคร)', async () => {
    const key = 'uploads/documents/2026/old-active.pdf';
    await bucket.put(key, new TextEncoder().encode('%PDF-1.4 active'));
    sqlite.prepare(
      "INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at, application_id) VALUES (?, ?, 'ACTIVE', ?, ?)",
    ).run('ledger-active-old', key, Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, applicationId);
    await cleanupExpiredTempAttachments(db, bucket);
    assertEqual(ledgerRow('ledger-active-old').status, 'ACTIVE');
    assertTrue(objects.has(key), 'ACTIVE object must survive cleanup');
  });

  await test('E4. รันซ้ำ → scanned 0 (idempotent, ไม่ error)', async () => {
    const result = await cleanupExpiredTempAttachments(db, bucket);
    assertEqual(result.scanned, 0, `second run must find nothing: ${JSON.stringify(result)}`);
    assertEqual(result.deleted, 0);
    assertEqual(result.errors, 0);
  });

  await test('E5. R2.delete ล้มเหลว → นับ error + แถวยัง TEMP (รอบหน้า retry)', async () => {
    const key = 'uploads/documents/2026/r2-fails.pdf';
    const oldDate = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    sqlite.prepare(
      "INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at) VALUES (?, ?, 'TEMP', ?)",
    ).run('ledger-r2fail', key, oldDate);
    const failingBucket = {
      delete: async () => { throw new Error('R2 unavailable'); },
    };
    const result = await cleanupExpiredTempAttachments(db, failingBucket);
    assertEqual(result.errors, 1);
    assertEqual(ledgerRow('ledger-r2fail').status, 'TEMP', 'row must stay TEMP for the next run');
  });

  // =========================================================================
  console.log('\n[F] Signing primitives');
  // =========================================================================

  await test('F1. sign → verify roundtrip ผ่าน', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = await signAttachmentKey('k.pdf', exp, SECRET);
    assertEqual(await verifyAttachmentSignature('k.pdf', exp, sig, SECRET), true);
  });

  await test('F2. secret ต่างกัน → verify ไม่ผ่าน', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = await signAttachmentKey('k.pdf', exp, SECRET);
    assertEqual(await verifyAttachmentSignature('k.pdf', exp, sig, 'other-secret'), false);
  });

  await test('F3. exp รูปแบบเพี้ยน → verify ไม่ผ่าน', async () => {
    const sig = await signAttachmentKey('k.pdf', 123, SECRET);
    assertEqual(await verifyAttachmentSignature('k.pdf', NaN as any, sig, SECRET), false);
    assertEqual(await verifyAttachmentSignature('k.pdf', 0, sig, SECRET), false);
    assertEqual(await verifyAttachmentSignature('k.pdf', 123, '', SECRET), false);
  });

  // =========================================================================
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
}

runAllTests().catch((e) => {
  console.error('Test runner failed:', e);
  (globalThis as any).process.exit(1);
});
