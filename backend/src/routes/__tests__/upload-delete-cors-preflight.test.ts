/**
 * Upload Delete CORS Preflight Regression Test
 * ==============================================
 *
 * ปิดบั๊ก prod: กด "ลบไฟล์" ผู้สมัครขึ้น
 * "NetworkError when attempting to fetch resource"
 *
 * Root cause: cors({ allowHeaders }) ใน src/index.ts ไม่มี X-Attachment-Token
 * → preflight OPTIONS ตอบ 204 แต่ Access-Control-Allow-Headers ไม่รวม header
 *   ที่ browser ขอ (Access-Control-Request-Headers: x-attachment-token)
 * → browser บล็อกก่อนส่ง DELETE จริง (upload รอดเพราะ POST multipart เป็น
 *   CORS simple request ไม่ต้อง preflight)
 *
 * Test นี้ยิง preflight ผ่าน worker entry จริง (default export ของ src/index.ts)
 * เพื่อครอบ CORS config ตรงจุดเดิมที่พัง — preflight ถูกตอบที่ middleware
 * ก่อนถึง route จึงไม่ต้องมี D1/R2 จริง
 *
 * Run: node --import tsx src/routes/__tests__/upload-delete-cors-preflight.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import worker from '../../index';

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

const ORIGIN = 'http://localhost:3001';
const env = {};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

async function preflight(path: string, requestMethod: string, requestHeaders?: string) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    'Access-Control-Request-Method': requestMethod,
  };
  if (requestHeaders) headers['Access-Control-Request-Headers'] = requestHeaders;
  return worker.fetch(
    new Request(`https://backend.local${path}`, { method: 'OPTIONS', headers }),
    env,
    ctx
  );
}

console.log('\n═══ Upload Delete CORS Preflight Regression ═══\n');

void (async () => {

await test('preflight DELETE + X-Attachment-Token → 204 และ Allow-Headers รวม header ที่ขอ (regression หลัก)', async () => {
  const res = await preflight('/api/v1/public/uploads/direct/some-ledger-id', 'DELETE', 'x-attachment-token');
  assertEqual(res.status, 204, 'status');
  const allowed = (res.headers.get('Access-Control-Allow-Headers') || '').toLowerCase();
  assertTrue(allowed.split(',').map((h) => h.trim()).includes('x-attachment-token'),
    `Access-Control-Allow-Headers ต้องมี x-attachment-token (ได้: "${allowed}")`);
});

await test('preflight DELETE → Access-Control-Allow-Methods รวม DELETE', async () => {
  const res = await preflight('/api/v1/public/uploads/direct/some-ledger-id', 'DELETE');
  assertEqual(res.status, 204, 'status');
  const methods = (res.headers.get('Access-Control-Allow-Methods') || '').toUpperCase();
  assertTrue(methods.split(',').map((m) => m.trim()).includes('DELETE'),
    `Allow-Methods ต้องมี DELETE (ได้: "${methods}")`);
});

await test('preflight ยังอนุญาต headers เดิมครบ (ไม่ทำ config เดิมพัง)', async () => {
  const res = await preflight('/api/v1/public/uploads/direct/some-ledger-id', 'DELETE',
    'content-type, authorization, x-requested-with');
  const allowed = (res.headers.get('Access-Control-Allow-Headers') || '').toLowerCase();
  for (const h of ['content-type', 'authorization', 'x-requested-with']) {
    assertTrue(allowed.split(',').map((x) => x.trim()).includes(h), `ต้องยังมี ${h} (ได้: "${allowed}")`);
  }
});

await test('preflight POST upload (ไม่มี custom header) → 204 ปกติ', async () => {
  const res = await preflight('/api/v1/public/uploads/direct', 'POST');
  assertEqual(res.status, 204, 'status');
  assertTrue(res.headers.get('Access-Control-Allow-Origin') !== null, 'ต้องมี Access-Control-Allow-Origin');
});

console.log(`\nผลรวม: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
})();
