// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Public Audit Events Tests (Audit Log Foundation — Phase 1)
 * =======================================================================
 * เหตุการณ์ฝั่งผู้สมัครที่เขียน audit ผ่าน audit.service (actor = SYSTEM row
 * จาก Migration 032 — audit_logs.admin_id เป็น NOT NULL FK จึงต้องมี actor
 * เสมือนที่มีจริง):
 *
 *   1. POST /public/uploads/direct สำเร็จ → ATTACHMENT_UPLOAD
 *      (entityId = ledgerId, payload ไม่มี deleteToken, single-encode)
 *   2. POST /direct ไฟล์ไม่ใช่ PDF (400) → ไม่มี audit
 *   3. DELETE /public/uploads/direct/:ledgerId token ถูก → ATTACHMENT_DELETE
 *   4. DELETE token ผิด (403) → ไม่มี audit
 *
 * APPLICATION_SUBMIT ครอบใน submit-duplicate-protection.test.ts (DP8)
 *
 * Run: node --import tsx src/routes/__tests__/public-audit-events.test.ts
 */

import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import { uploadRoutes } from '../upload.routes';
import { SYSTEM_ADMIN_ID } from '../../services/audit.service';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void) {
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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ── Harness (pattern เดียวกับ upload-r2-regression.test.ts) ─────────────
const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT,
    ip_address TEXT, batch_id TEXT, created_at INTEGER
  );
  CREATE TABLE attachment_uploads (
    id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP',
    uploaded_at INTEGER, application_id TEXT, original_filename TEXT,
    delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER
  );
`);

const d1: any = {
  prepare: (sqlText) => {
    const stmt = sqlite.prepare(sqlText);
    let bound = [];
    return {
      bind(...params) { bound = params; return this; },
      async all() { return { results: stmt.all(...bound) }; },
      async first() { return stmt.get(...bound) ?? null; },
      async run() {
        const info = stmt.run(...bound);
        return {
          success: true,
          meta: { changes: Number(info?.changes ?? 0), last_row_id: Number(info?.lastInsertRowid ?? 0) },
        };
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

const objects = new Map<string, { bytes: Uint8Array }>();
const mockR2: any = {
  async put(key: string, value: any) {
    const bytes = value instanceof Uint8Array
      ? value
      : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
    objects.set(key, { bytes });
  },
  async delete(key: string) { objects.delete(key); },
};

const app = new Hono();
app.route('/api/v1/public/uploads', uploadRoutes);

const env = () => ({
  DB: d1,
  R2_BUCKET: mockR2,
  JWT_SECRET: 'test-secret',
  RATE_LIMIT_PER_MINUTE: '1000',
});

const BASE = '/api/v1/public/uploads';

function auditRows(): any[] {
  // rowid = ลำดับการ insert จริง (created_at ไม่มี DEFAULT ใน DDL test → NULL)
  return sqlite.prepare('SELECT * FROM audit_logs ORDER BY rowid').all();
}

async function uploadPdf(name = 'เอกสารทดสอบ.pdf') {
  __resetRateLimitStoreForTests();
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 mock-pdf');
  const form = new FormData();
  form.append('file', new File([pdfBytes], name, { type: 'application/pdf' }));
  return app.request(`${BASE}/direct`, { method: 'POST', body: form }, env());
}

async function runAllTests() {
  console.log('\n=== Public Audit Events (Phase 1) — ATTACHMENT_UPLOAD/DELETE ===\n');

  await test('1: upload สำเร็จ → 201 + audit ATTACHMENT_UPLOAD (SYSTEM actor, single-encode, ไม่มี deleteToken)', async () => {
    assertEqual(auditRows().length, 0, 'เริ่มจากไม่มี audit');

    const res = await uploadPdf();
    const body = await res.json();
    assertEqual(res.status, 201, `status=${res.status} ${JSON.stringify(body)}`);
    assertTrue(body.data.ledgerId, 'ได้ ledgerId');
    assertTrue(body.data.deleteToken, 'ได้ deleteToken');

    const rows = auditRows();
    assertEqual(rows.length, 1, 'มี audit 1 แถว');
    const row = rows[0];
    assertEqual(row.action, 'ATTACHMENT_UPLOAD', 'action');
    assertEqual(row.entity_type, 'ATTACHMENT', 'entity_type');
    assertEqual(row.entity_id, body.data.ledgerId, 'entityId = ledgerId');
    assertEqual(row.admin_id, SYSTEM_ADMIN_ID, 'actor = reserved SYSTEM row');
    assertTrue(!!row.ip_address, 'บันทึก ip_address');

    const payload = JSON.parse(row.payload);
    assertTrue(payload && typeof payload === 'object', 'payload parse 1 ชั้นได้ object');
    assertEqual(payload.fileKey, body.data.fileKey, 'payload.fileKey');
    assertEqual(payload.filename, 'เอกสารทดสอบ.pdf', 'payload.filename');
    assertTrue(typeof payload.sizeBytes === 'number', 'payload.sizeBytes');
    assertTrue(!('deleteToken' in payload), 'ห้ามมี deleteToken ใน payload');
    assertTrue(!JSON.stringify(payload).includes(body.data.deleteToken), 'token ห้ามหลุดลง audit ทุกรูปแบบ');
  });

  await test('2: upload ไม่ใช่ PDF (400) → ไม่มี audit', async () => {
    __resetRateLimitStoreForTests();
    const before = auditRows().length;
    const form = new FormData();
    form.append('file', new File([new Uint8Array(16)], 'evil.exe', { type: 'application/octet-stream' }));
    const res = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env());
    assertEqual(res.status, 400, 'non-PDF ต้อง 400');
    assertEqual(auditRows().length, before, 'ไม่เพิ่ม audit');
  });

  await test('3: DELETE token ถูก → 200 + audit ATTACHMENT_DELETE', async () => {
    const res = await uploadPdf('จะลบ.pdf');
    const body = await res.json();
    assertEqual(res.status, 201, 'upload ก่อนลบ');
    const before = auditRows().length;

    __resetRateLimitStoreForTests();
    const del = await app.request(`${BASE}/direct/${body.data.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': body.data.deleteToken },
    }, env());
    assertEqual(del.status, 200, `status=${del.status} ${await del.text()}`);

    const rows = auditRows();
    assertEqual(rows.length, before + 1, 'เพิ่ม audit 1 แถว');
    const row = rows[rows.length - 1];
    assertEqual(row.action, 'ATTACHMENT_DELETE', 'action');
    assertEqual(row.entity_type, 'ATTACHMENT', 'entity_type');
    assertEqual(row.entity_id, body.data.ledgerId, 'entityId = ledgerId');
    assertEqual(row.admin_id, SYSTEM_ADMIN_ID, 'actor = SYSTEM');
    const payload = JSON.parse(row.payload);
    assertEqual(payload.fileKey, body.data.fileKey, 'payload.fileKey');
  });

  await test('4: DELETE token ผิด (403) → ไม่มี audit', async () => {
    const res = await uploadPdf('อีกไฟล์.pdf');
    const body = await res.json();
    const before = auditRows().length;

    __resetRateLimitStoreForTests();
    const del = await app.request(`${BASE}/direct/${body.data.ledgerId}`, {
      method: 'DELETE',
      headers: { 'X-Attachment-Token': 'wrong-token' },
    }, env());
    assertEqual(del.status, 403, 'token ผิดต้อง 403');
    assertEqual(auditRows().length, before, 'ไม่มี audit เมื่อลบไม่สำเร็จ');
  });

  console.log(`\nผลรวม: ผ่าน ${passed} ไม่ผ่าน ${failed}`);
  if (failed > 0) {
    console.log('รายการที่ล้มเหลว:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void runAllTests();
