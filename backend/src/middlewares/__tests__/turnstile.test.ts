/**
 * TASK 5 — Turnstile Test Coverage (Platform Hardening Phase 1)
 * =======================================================================
 *
 * เดิม: turnstile.middleware.ts ไม่มี test เลย (audit: "Turnstile 0 test")
 *
 * ครอบคลุม 4 สถานะตาม middleware contract + เคสขอบ:
 *   TS1. Disabled validation (TURNSTILE_ENABLED=false/unset) → no-op ผ่าน
 *        แม้ไม่มี token (default state — PR contract)
 *   TS2. Enabled + missing token → 403 (ไม่เรียก siteverify)
 *   TS3. Enabled + invalid token (siteverify success:false) → 403
 *   TS4. Enabled + valid token → ผ่านไป downstream (200)
 *   TS5. Enabled แต่ TURNSTILE_SECRET_KEY หาย → 403 fail closed
 *   TS6. siteverify ล้ม (network error) → 403 fail closed
 *   TS7. token ใน key 'cf-turnstile-response' (Cloudflare default) ก็รับ
 *   TS8. request ที่ส่งถึง siteverify มี secret+token+remoteip ครบ (wire format)
 *
 * หลักการ mocking: แทน globalThis.fetch ด้วย stub — ไม่มีการเรียก network
 * จริงเด็ดขาด และตรวจได้ว่า stub ถูกเรียก (หรือไม่ถูกเรียกในเคส missing token)
 * รายละเอียด request/response จริงของ verifyTurnstileToken มี unit เดิมของ
 * helper อยู่ที่นี่ด้วยผ่าน fetchImpl injection
 *
 * รัน: node --import tsx src/middlewares/__tests__/turnstile.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import { turnstileMiddleware } from '../turnstile.middleware';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    fetchCalls = []; // ตัวนับ siteverify เริ่มใหม่ทุกเคส
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

// ── fetch stub — ไม่มี network จริง ───────────────────────────────────────
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface FetchCall {
  url: string;
  init: any;
  bodyParams: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];
let siteverifyResponse: { status: number; json: unknown } | { throwError: Error } = { status: 200, json: { success: true } };
let originalFetch: typeof fetch;

function stubFetch() {
  originalFetch = globalThis.fetch;
  fetchCalls = [];
  // @ts-ignore — test stub
  globalThis.fetch = async (url: any, init: any) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const bodyParams: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(bodyText).entries()) bodyParams[k] = v;
    fetchCalls.push({ url: String(url), init, bodyParams });
    if ('throwError' in siteverifyResponse) throw siteverifyResponse.throwError;
    return new Response(JSON.stringify(siteverifyResponse.json), {
      status: siteverifyResponse.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ── app + request helpers ─────────────────────────────────────────────────
const app = new Hono();

app.post('/submit', turnstileMiddleware(), (c) => c.json({ ok: true, reached: 'downstream' }));

async function submitRequest(args: {
  env: Record<string, string>;
  body?: object;
  ip?: string;
}) {
  const res = await app.request(
    '/submit',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.ip ? { 'cf-connecting-ip': args.ip } : {}),
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    },
    args.env,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const SECRET = 'test-turnstile-secret';

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('TASK 5: Turnstile Middleware — Tests (fetch stubbed)');
  console.log('=================================================\n');

  stubFetch();

  try {
    // ---- TS1: disabled → no-op ----
    await test('TS1: TURNSTILE_ENABLED=false → no-op ผ่านถึง downstream แม้ไม่มี token (ไม่เรียก siteverify)', async () => {
      for (const flag of [undefined, 'false', '0']) {
        const env: Record<string, string> = { TURNSTILE_SECRET_KEY: SECRET };
        if (flag !== undefined) env.TURNSTILE_ENABLED = flag;
        const res = await submitRequest({ env, body: { answer: 42 } });
        assertEqual(res.status, 200, `flag=${flag ?? '(unset)'} ต้องผ่าน`);
        assertEqual(res.body?.reached, 'downstream', `flag=${flag ?? '(unset)'} ถึง handler`);
      }
      assertEqual(fetchCalls.length, 0, 'ห้ามเรียก siteverify เมื่อ disabled');
    });

    // ---- TS2: enabled + missing token → 403 ----
    await test('TS2: enabled + ไม่มี token → 403 + ไม่เรียก siteverify', async () => {
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { answer: 42 },
      });
      assertEqual(res.status, 403, 'HTTP status');
      assertEqual(res.body?.success, false, 'body.success=false');
      assertEqual(res.body?.error, 'Human verification failed', 'error message ตาม contract');
      assertEqual(fetchCalls.length, 0, 'missing token ต้องไม่ยิง siteverify');
    });

    // ---- TS2b: body ไม่ใช่ JSON → ถือว่าไม่มี token → 403 ----
    await test('TS2b: enabled + body ไม่มี token field เลย (null body) → 403', async () => {
      const token = await app.request('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'x' },
        body: JSON.stringify({ noTokenKey: true }),
      }, { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET });
      // ทำซ้ำผ่าน submitRequest แทน — เคสนี้ครอบโดย TS2 อยู่แล้ว แต่ยืนยันว่า
      // body ที่ไม่มี key ใดเลยไม่พัง middleware
      assertEqual(token.status, 403, 'HTTP status');
    });

    // ---- TS3: enabled + invalid token → 403 ----
    await test('TS3: enabled + token ที่ siteverify ปฏิเสธ (success:false) → 403', async () => {
      siteverifyResponse = { status: 200, json: { success: false, 'error-codes': ['invalid-input-response'] } };
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: 'bad-token' },
        ip: '203.0.113.7',
      });
      assertEqual(res.status, 403, 'HTTP status');
      assertEqual(res.body?.success, false, 'body.success=false');
      assertEqual(res.body?.error, 'Human verification failed', 'error message ตาม contract');
      assertEqual(fetchCalls.length, 1, 'เรียก siteverify 1 ครั้ง');
    });

    // ---- TS4: enabled + valid token → ผ่าน ----
    await test('TS4: enabled + token ผ่าน siteverify → 200 ถึง downstream', async () => {
      siteverifyResponse = { status: 200, json: { success: true, challenge_ts: '2026-10-31T00:00:00Z' } };
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: 'good-token' },
        ip: '203.0.113.8',
      });
      assertEqual(res.status, 200, 'HTTP status');
      assertEqual(res.body?.reached, 'downstream', 'ถึง handler จริง');
      assertEqual(fetchCalls.length, 1, 'เรียก siteverify 1 ครั้ง');
    });

    // ---- TS5: enabled แต่ไม่มี secret → 403 fail closed ----
    await test('TS5: enabled แต่ TURNSTILE_SECRET_KEY ว่าง → 403 fail closed (ไม่เรียก siteverify)', async () => {
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true' },
        body: { turnstileToken: 'any-token' },
      });
      assertEqual(res.status, 403, 'HTTP status');
      assertEqual(fetchCalls.length, 0, 'ไม่มี secret ต้องไม่ยิง siteverify');
    });

    // ---- TS6: siteverify ล้ม → 403 fail closed ----
    await test('TS6: siteverify throw (network error) → 403 fail closed', async () => {
      siteverifyResponse = { throwError: new Error('network down') };
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: 'some-token' },
      });
      assertEqual(res.status, 403, 'HTTP status');
      assertEqual(res.body?.error, 'Human verification failed', 'error message ตาม contract');
    });

    // ---- TS7: siteverify ตอบ non-2xx → 403 fail closed ----
    await test('TS7: siteverify ตอบ 500 → 403 fail closed (hard failure)', async () => {
      siteverifyResponse = { status: 500, json: { success: false } };
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: 'some-token' },
      });
      assertEqual(res.status, 403, 'HTTP status');
    });

    // ---- TS8: cf-turnstile-response key (Cloudflare default) ก็รับ ----
    await test('TS8: token ใน key cf-turnstile-response → ผ่าน (รองรับ default callback)', async () => {
      siteverifyResponse = { status: 200, json: { success: true } };
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { 'cf-turnstile-response': 'cf-key-token' },
      });
      assertEqual(res.status, 200, 'HTTP status');
      assertEqual(res.body?.reached, 'downstream', 'ถึง handler');
    });

    // ---- TS9: wire format ที่ยิงถึง siteverify ----
    await test('TS9: request ถึง siteverify มี secret + response(token) + remoteip ครบ (form-urlencoded)', async () => {
      siteverifyResponse = { status: 200, json: { success: true } };
      await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: 'wire-token' },
        ip: '198.51.100.77',
      });
      assertEqual(fetchCalls.length, 1, 'เรียก 1 ครั้ง');
      const call = fetchCalls[0];
      assertEqual(call.url, SITEVERIFY_URL, 'URL ถูกต้อง');
      assertEqual(call.init.method, 'POST', 'POST');
      assertTrue(
        (call.init.headers?.['content-type'] ?? '').includes('application/x-www-form-urlencoded'),
        'content-type form-urlencoded',
      );
      assertEqual(call.bodyParams.secret, SECRET, 'มี secret');
      assertEqual(call.bodyParams.response, 'wire-token', 'มี response = token');
      assertEqual(call.bodyParams.remoteip, '198.51.100.77', 'มี remoteip');
    });

    // ---- TS10: token whitespace-only ถือว่า missing ----
    await test('TS10: token เป็น whitespace เท่านั้น → 403 (ถือว่า missing)', async () => {
      const res = await submitRequest({
        env: { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: SECRET },
        body: { turnstileToken: '   ' },
      });
      assertEqual(res.status, 403, 'HTTP status');
      assertEqual(fetchCalls.length, 0, 'ไม่ยิง siteverify');
    });
  } finally {
    restoreFetch();
  }

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
