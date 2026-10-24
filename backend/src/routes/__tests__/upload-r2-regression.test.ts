/**
 * S1 Regression Tests — Public DELETE R2 Endpoint Removal
 * ============================================================
 *
 * หลังจากลบ `DELETE /api/v1/public/uploads/files/:key` (ช่องโหว่ S1:
 * unauthenticated delete จาก bucket เดียวกับ attachment และ PDF cache)
 * test นี้ยืนยันว่า:
 *
 * 1. DELETE endpoint ใช้งานไม่ได้อีก (404) และไม่มีการเรียก R2.delete
 *    ผ่านทางใด ๆ ของ upload routes
 * 2. การ Upload ไฟล์ (POST /direct) ยังทำงานปกติ
 * 3. การอ่านไฟล์แนบ (GET /files/:key) ยังทำงานปกติ
 * 4. การดาวน์โหลด PDF (getApplicationPdf — R2 cache-hit path
 *    เหมือน /applications/download-pdf) ยังทำงานปกติ
 *
 * Run: node --import tsx src/routes/__tests__/upload-r2-regression.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uploadRoutes } from '../upload.routes';
import { getApplicationPdf } from '../../lib/pdf.service';
import { buildPdfCacheKey } from '../../lib/pdf-types';
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
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// Mocks
// =============================================================================

type MockObject = {
  bytes: Uint8Array;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

/**
 * In-memory R2Bucket mock ที่บันทึกทุกการเรียก put/get/delete
 * เพื่อยืนยันว่าไม่มีโค้ดใดเรียก delete ผ่าน HTTP เลย
 */
function createMockR2Bucket() {
  const objects = new Map<string, MockObject>();
  const calls = { put: [] as string[], get: [] as string[], delete: [] as string[] };

  const bucket: any = {
    async put(key: string, value: any, options: any) {
      calls.put.push(key);
      const bytes =
        value instanceof Uint8Array
          ? value
          : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      objects.set(key, {
        bytes,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      });
    },
    async get(key: string) {
      calls.get.push(key);
      const obj = objects.get(key);
      if (!obj) return undefined;
      return {
        key,
        size: obj.bytes.byteLength,
        httpEtag: 'mock-etag',
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        body: obj.bytes,
        arrayBuffer: async () => obj.bytes.slice().buffer,
      };
    },
    async delete(key: string) {
      calls.delete.push(key);
      objects.delete(key);
    },
  };

  return { bucket, objects, calls };
}

/**
 * Mock drizzle/D1 db ให้ตอบ row ตาม table ที่ query (ใช้ symbol ชื่อ table
 * ของ drizzle) — เพียงพอสำหรับ buildApplicationContext ของ PDF cache-hit path
 */
function createMockDb(rowsByTable: Record<string, any[]>) {
  const tableName = (table: any) => table?.[Symbol.for('drizzle:Name')] ?? 'unknown';

  const makeBuilder = (rows: any[]) => {
    const builder: any = {
      where: () => builder,
      orderBy: () => builder,
      innerJoin: () => builder,
      limit: () => builder,
      get: async () => rows[0] ?? null,
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };

  return {
    select: (_selection?: any) => ({
      from: (table: any) => makeBuilder(rowsByTable[tableName(table)] ?? []),
    }),
  };
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('\n=== S1 Regression — Upload/GET/PDF after DELETE removal ===\n');

  const { bucket, objects, calls } = createMockR2Bucket();

  // โครงสร้าง app เหมือน index.ts: mount uploadRoutes ที่ /api/v1/public/uploads
  const app = new Hono();
  app.route('/api/v1/public/uploads', uploadRoutes);

  const env: any = {
    DB: {},
    R2_BUCKET: bucket,
    JWT_SECRET: 'test-secret',
  };

  const BASE = '/api/v1/public/uploads';

  // Seed ข้อมูลจำลองใน bucket: attachment 1 ชิ้น + PDF cache 1 ชิ้น
  const attachmentKey = 'uploads/documents/2026/test-attachment.pdf';
  await bucket.put(attachmentKey, new TextEncoder().encode('%PDF-1.4 attachment-body'), {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { originalFilename: 'test-attachment.pdf' },
  });

  const applicationId = 'app-reg-1';
  const pdfCacheKey = buildPdfCacheKey(applicationId); // pdf/applications/{id}/v1.pdf
  const pdfCacheBytes = new TextEncoder().encode('%PDF-1.5 cached-pdf-body');
  await bucket.put(pdfCacheKey, pdfCacheBytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { 'x-generated-at': '1770000000' },
  });

  // ---------------------------------------------------------------------------
  console.log('[1] DELETE endpoint ถูกลบแล้ว');
  // ---------------------------------------------------------------------------

  await test('1.1 DELETE /files/<attachment key> ตอบ 404 (ไม่มี route)', async () => {
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(attachmentKey)}`,
      { method: 'DELETE' },
      env
    );
    assertEqual(res.status, 404, 'DELETE attachment key must be 404');
  });

  await test('1.2 DELETE /files/<PDF cache key> ตอบ 404', async () => {
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(pdfCacheKey)}`,
      { method: 'DELETE' },
      env
    );
    assertEqual(res.status, 404, 'DELETE PDF cache key must be 404');
  });

  await test('1.3 DELETE ผ่าน unencoded path ก็ตอบ 404', async () => {
    const res = await app.request(`${BASE}/files/${attachmentKey}`, { method: 'DELETE' }, env);
    assertEqual(res.status, 404, 'DELETE unencoded key must be 404');
  });

  await test('1.4 หลังพยายาม DELETE แล้ว object ยังอยู่ครบใน R2', async () => {
    assertTrue(objects.has(attachmentKey), 'attachment must still exist');
    assertTrue(objects.has(pdfCacheKey), 'PDF cache must still exist');
  });

  await test('1.5 ไม่มีการเรียก R2Bucket.delete ผ่าน upload routes เลย', () => {
    assertEqual(calls.delete.length, 0, 'R2 delete must never be called');
  });

  await test('1.6 route table ของ uploadRoutes ไม่มี method DELETE', () => {
    const methods = uploadRoutes.routes.map((r: any) => r.method);
    assertTrue(!methods.includes('DELETE'), `found DELETE in routes: ${methods.join(',')}`);
    assertTrue(methods.includes('POST'), 'POST routes must exist');
    assertTrue(methods.includes('GET'), 'GET routes must exist');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[2] Upload ยังทำงาน (POST /direct)');
  // ---------------------------------------------------------------------------

  let uploadedFileKey = '';

  await test('2.1 multipart PDF → 201 + fileKey รูปแบบ uploads/documents/', async () => {
    __resetRateLimitStoreForTests();
    const pdfBytes = new Uint8Array(2048);
    pdfBytes.set(new TextEncoder().encode('%PDF-1.4 mock-pdf-for-upload'));
    const form = new FormData();
    form.append('file', new File([pdfBytes], 'my-doc.pdf', { type: 'application/pdf' }));

    const res = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env);
    assertEqual(res.status, 201, 'upload must return 201');

    const body = await res.json();
    assertTrue(body.success === true, 'body.success must be true');
    assertTrue(
      /^uploads\/documents\/\d{4}\/[0-9a-f-]{36}-my-doc\.pdf$/.test(body.data.fileKey),
      `unexpected fileKey: ${body.data.fileKey}`
    );
    assertEqual(calls.put.filter((k) => k !== attachmentKey && k !== pdfCacheKey).length, 1,
      'R2.put must be called exactly once for the upload');
    uploadedFileKey = body.data.fileKey;
  });

  await test('2.2 ไฟล์ที่ไม่ใช่ PDF ยังถูกปฏิเสธ (400) — validation ไม่หายไป', async () => {
    __resetRateLimitStoreForTests();
    const form = new FormData();
    form.append('file', new File([new Uint8Array(16)], 'evil.exe', { type: 'application/octet-stream' }));

    const res = await app.request(`${BASE}/direct`, { method: 'POST', body: form }, env);
    assertEqual(res.status, 400, 'non-PDF upload must be 400');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[3] การอ่านไฟล์แนบยังทำงาน (GET /files/:key)');
  // ---------------------------------------------------------------------------

  await test('3.1 GET ไฟล์ที่เพิ่ง upload → 200 + bytes ตรงต้นฉบับ', async () => {
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(uploadedFileKey)}`,
      {},
      env
    );
    assertEqual(res.status, 200, 'GET uploaded file must be 200');
    assertEqual(res.headers.get('Content-Type'), 'application/pdf', 'Content-Type must be pdf');
    const got = new Uint8Array(await res.arrayBuffer());
    assertEqual(got.byteLength, 2048, 'downloaded size must match uploaded size');
  });

  await test('3.2 GET attachment เดิม → 200 (flow แนบไฟล์ใบสมัครไม่กระทบ)', async () => {
    const res = await app.request(
      `${BASE}/files/${encodeURIComponent(attachmentKey)}`,
      {},
      env
    );
    assertEqual(res.status, 200, 'GET seeded attachment must be 200');
    const text = await res.text();
    assertTrue(text.startsWith('%PDF-1.4'), 'attachment content must match');
  });

  await test('3.3 GET key ที่ไม่มี → 404', async () => {
    const res = await app.request(`${BASE}/files/uploads/documents/2026/ghost.pdf`, {}, env);
    assertEqual(res.status, 404, 'GET missing key must be 404');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[4] PDF download ยังทำงาน (getApplicationPdf — เส้นทางเดียวกับ /applications/download-pdf)');
  // ---------------------------------------------------------------------------

  const mockDb = createMockDb({
    applications: [
      {
        id: applicationId,
        applicationNo: 'สตง-25690001',
        roundId: 'round-1',
        email: 'applicant@test.local',
        fullname: 'ผู้สมัคร ทดสอบ',
        nationalId: null,
        status: 'SUBMITTED',
        statusReason: null,
        submittedAt: new Date('2026-10-01T10:00:00Z'),
        formData: JSON.stringify({}),
      },
    ],
    recruitment_rounds: [
      {
        id: 'round-1',
        title: 'รอบทดสอบระบบ',
        positionLevel: 'นักวิเคราะห์นโยบายและแผน',
        announcementTitle: null,
        announcementDescription: null,
        applicationPattern: null,
        roundCode: 'R01',
        templateVersionId: 'tv-1',
      },
    ],
    template_versions: [{ id: 'tv-1', versionNumber: 1 }],
    template_sections: [],
    template_fields: [],
    application_attachments: [],
  });

  await test('4.1 cache-hit: คืน bytes จาก R2 cache ได้ถูกต้อง', async () => {
    const result = await getApplicationPdf(mockDb as any, bucket, applicationId);
    assertTrue(result !== null, 'getApplicationPdf must not return null');
    assertEqual(result.cacheHit, true, 'must be cache hit');
    const text = new TextDecoder().decode(result.bytes);
    assertTrue(text.startsWith('%PDF-1.5 cached-pdf-body'), 'cached bytes must match seeded PDF');
  });

  await test('4.2 getApplicationPdf ไม่เรียก R2.delete (cache ปลอดภัย)', () => {
    assertEqual(calls.delete.length, 0, 'PDF flow must not delete from R2');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[5] Final invariant');
  // ---------------------------------------------------------------------------

  await test('5.1 ตลอดทั้ง suite นี้ R2Bucket.delete ไม่ถูกเรียกแม้แต่ครั้งเดียว', () => {
    assertEqual(calls.delete.length, 0, 'no R2 delete call may occur at all');
  });

  await test('5.2 source ของ upload.routes.ts ไม่มีการลงทะเบียน DELETE route', () => {
    const here = fileURLToPath(import.meta.url);
    const source = readFileSync(here.replace('__tests__/upload-r2-regression.test.ts', 'upload.routes.ts'), 'utf8');
    assertTrue(!/uploadRoutes\.delete\(/.test(source), 'uploadRoutes.delete() must not exist in source');
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
