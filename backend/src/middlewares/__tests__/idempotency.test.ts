/**
 * Idempotency Middleware Tests (R6: replay guard across payloads)
 * รัน: node --import tsx src/middlewares/__tests__/idempotency.test.ts
 *
 * Scope:
 *   - Case 1: เดิม token + เดิม payload → replay response เดิม + status เดิม
 *   - Case 2: เดิม token + ต่าง payload → 409 IDEMPOTENCY_PAYLOAD_MISMATCH
 *   - Case 3: token ใหม่ + เดิม payload → submit ปกติ
 *   - Case 4: token ใหม่ + ใหม่ payload → submit ปกติ
 *   - Key order ไม่มีผลต่อ hash (stable serialization)
 *   - Token key spelling (camelCase vs snake_case) ไม่มีผลต่อ hash
 *   - No-token request → pass through (backward compat)
 *   - Non-2xx first response → slot freed, retry works
 *   - In-flight duplicate → 409 "Submission already processed"
 *   - request-hash unit tests (stableStringify / computeRequestHash)
 *
 * Uses Hono's app.fetch with a stubbed c.env — no D1 / R2 needed because
 * the middleware is self-contained.
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import {
  idempotencyMiddleware,
  __resetIdempotencyStoreForTests,
} from '../idempotency.middleware';
import { computeRequestHash, stableStringify } from '../../lib/request-hash';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`✗ ${name}: ${e?.message ?? e}`);
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

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg} expected ${b}, got ${a}`);
  }
}

const ENV = { IDEMPOTENCY_ENABLED: 'true', IDEMPOTENCY_TTL_SECONDS: '900' };

/**
 * Minimal app: one POST /submit guarded by the idempotency middleware.
 * The handler counts invocations and returns a stable 201 payload so we
 * can assert replay vs. fresh processing.
 */
function makeApp() {
  let invocations = 0;
  const app = new Hono();
  app.post('/submit', idempotencyMiddleware(), async (c) => {
    invocations++;
    const body = await c.req.json();
    return c.json(
      { success: true, applicationNo: `APP-2026-${1000 + invocations}`, echoedRoundId: body?.roundId ?? null },
      201,
    );
  });
  return {
    app,
    getInvocations: () => invocations,
  };
}

function postJson(app, body, headers = {}, env = ENV) {
  return app.request('/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, env);
}

async function run() {
  // =========================================================================
  // request-hash unit tests
  // =========================================================================
  await test('hash: ลำดับ key ไม่มีผลต่อ requestHash', async () => {
    const a = await computeRequestHash({ roundId: 'r1', email: 'a@b.c', formData: { x: '1', y: '2' } });
    const b = await computeRequestHash({ formData: { y: '2', x: '1' }, email: 'a@b.c', roundId: 'r1' });
    assertEqual(a, b, 'key order must not change hash');
    assertTrue(typeof a === 'string' && a.length === 64, 'sha256 hex is 64 chars');
  });

  await test('hash: nested object key order ไม่มีผล', async () => {
    const a = await computeRequestHash({ outer: { inner: { b: 1, a: 2 } } });
    const b = await computeRequestHash({ outer: { inner: { a: 2, b: 1 } } });
    assertEqual(a, b, 'nested key order must not change hash');
  });

  await test('hash: array order มีผลต่อ requestHash', async () => {
    const a = await computeRequestHash({ rows: [1, 2] });
    const b = await computeRequestHash({ rows: [2, 1] });
    assertTrue(a !== b, 'array order must change hash');
  });

  await test('hash: payload ต่างกัน → hash ต่างกัน', async () => {
    const a = await computeRequestHash({ roundId: 'r1', email: 'a@b.c' });
    const b = await computeRequestHash({ roundId: 'r1', email: 'other@b.c' });
    assertTrue(a !== b, 'different payload must change hash');
  });

  await test('hash: token fields ถูก strip ออกก่อน hash', async () => {
    const a = await computeRequestHash({ submissionToken: 'tok-1', roundId: 'r1' });
    const b = await computeRequestHash({ submission_token: 'tok-1', roundId: 'r1' });
    assertEqual(a, b, 'token spelling must not change hash');
    const bare = await computeRequestHash({ roundId: 'r1' });
    assertEqual(a, bare, 'stripped payload equals payload without token');
  });

  await test('hash: null/undefined payload → null', async () => {
    assertEqual(await computeRequestHash(null), null);
    assertEqual(await computeRequestHash(undefined), null);
  });

  await test('stableStringify: deterministic output สำหรับค่าเดิม', () => {
    assertEqual(stableStringify({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
    assertEqual(stableStringify('thai-ค่า'), '"thai-ค่า"');
    assertEqual(stableStringify({}), '{}');
  });

  // =========================================================================
  // Middleware integration tests — the 4 required cases
  // =========================================================================
  const PAYLOAD_A = {
    submissionToken: 'tok-aaa',
    roundId: 'round-1',
    email: 'applicant@test.com',
    formData: { fullName: 'สมชาย ใจดี', position: 'เจ้าหน้าที่' },
  };
  const PAYLOAD_A_REORDERED = {
    formData: { position: 'เจ้าหน้าที่', fullName: 'สมชาย ใจดี' },
    email: 'applicant@test.com',
    roundId: 'round-1',
    submissionToken: 'tok-aaa',
  };
  const PAYLOAD_B = {
    submissionToken: 'tok-aaa',
    roundId: 'round-1',
    email: 'applicant@test.com',
    formData: { fullName: 'สมศรี ใจงาม', position: 'เจ้าหน้าที่' },
  };

  await test('Case 1: token เดิม + payload เดิม (key order ต่าง) → replay response/status เดิม, handler ไม่ถูกเรียกซ้ำ', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();

    const first = await postJson(app, PAYLOAD_A);
    assertEqual(first.status, 201);
    const firstBody = await first.json();
    assertEqual(firstBody.applicationNo, 'APP-2026-1001');

    const replay = await postJson(app, PAYLOAD_A_REORDERED); // same payload, different key order
    assertEqual(replay.status, 201, 'replay must reuse original status');
    const replayBody = await replay.json();
    assertDeepEqual(replayBody, firstBody, 'replay must reuse original body');
    assertEqual(getInvocations(), 1, 'handler must run exactly once');
  });

  await test('Case 2: token เดิม + payload ต่างกัน → 409 IDEMPOTENCY_PAYLOAD_MISMATCH', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();

    const first = await postJson(app, PAYLOAD_A);
    assertEqual(first.status, 201);
    await first.json();

    const mismatch = await postJson(app, PAYLOAD_B);
    assertEqual(mismatch.status, 409, 'payload mismatch must be 409');
    const body = await mismatch.json();
    assertEqual(body.success, false);
    assertEqual(body.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
    assertEqual(body.message, 'Request payload does not match original submission');
    assertEqual(getInvocations(), 1, 'mismatched request must not reach the handler');
  });

  await test('Case 3: token ใหม่ + payload เดิม (ไม่มี token field ใน hash) → submit ปกติ', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();

    const first = await postJson(app, { ...PAYLOAD_A, submissionToken: 'tok-1' });
    assertEqual(first.status, 201);
    await first.json();

    const second = await postJson(app, { ...PAYLOAD_A, submissionToken: 'tok-2' });
    assertEqual(second.status, 201, 'new token must be processed fresh');
    const body = await second.json();
    assertEqual(body.applicationNo, 'APP-2026-1002');
    assertEqual(getInvocations(), 2);
  });

  await test('Case 4: token ใหม่ + payload ใหม่ → submit ปกติ', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();

    const first = await postJson(app, { ...PAYLOAD_A, submissionToken: 'tok-x' });
    assertEqual(first.status, 201);
    await first.json();

    const second = await postJson(app, { ...PAYLOAD_B, submissionToken: 'tok-y' });
    assertEqual(second.status, 201, 'new token + new payload must be processed fresh');
    const body = await second.json();
    assertEqual(body.applicationNo, 'APP-2026-1002');
    assertEqual(getInvocations(), 2);
  });

  await test('token spelling snake_case ตอน replay → hash เดิม (ไม่โดน 409)', async () => {
    __resetIdempotencyStoreForTests();
    const { app } = makeApp();

    const first = await postJson(app, PAYLOAD_A);
    assertEqual(first.status, 201);
    await first.json();

    const replay = await postJson(app, { ...PAYLOAD_A, submissionToken: undefined, submission_token: 'tok-aaa' });
    assertEqual(replay.status, 201, 'token key spelling must not affect the hash comparison');
    const body = await replay.json();
    assertEqual(body.applicationNo, 'APP-2026-1001');
  });

  await test('no-token request → pass through (backward compat)', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();

    const bodyNoToken = { roundId: 'round-1', email: 'x@test.com', formData: {} };
    const r1 = await postJson(app, bodyNoToken);
    const r2 = await postJson(app, bodyNoToken);
    assertEqual(r1.status, 201);
    assertEqual(r2.status, 201);
    assertEqual(getInvocations(), 2, 'no token → middleware is a no-op');
  });

  await test('first response ไม่ 2xx → slot ถูกปล่อย, retry ด้วย payload ใหม่ได้', async () => {
    __resetIdempotencyStoreForTests();
    const app = new Hono();
    app.post('/submit', idempotencyMiddleware(), async (c) => {
      const body = await c.req.json();
      if (body?.fail) return c.json({ success: false, error: 'boom' }, 500);
      return c.json({ success: true }, 201);
    });

    const bad = await postJson(app, { submissionToken: 'tok-fail', fail: true });
    assertEqual(bad.status, 500);
    await bad.json();

    const retry = await postJson(app, { submissionToken: 'tok-fail', fail: false });
    assertEqual(retry.status, 201, 'retry after non-2xx must be processed');
  });

  await test('in-flight duplicate (completed:false) → 409 "Submission already processed"', async () => {
    __resetIdempotencyStoreForTests();
    let releaseFirst;
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const app = new Hono();
    app.post('/submit', idempotencyMiddleware(), async (c) => {
      await gate;
      return c.json({ success: true }, 201);
    });

    const firstPromise = postJson(app, { submissionToken: 'tok-slow', roundId: 'r1' });
    // Give the first request a chance to reserve the slot, then fire the dup.
    await new Promise((r) => setTimeout(r, 20));
    const dup = await postJson(app, { submissionToken: 'tok-slow', roundId: 'r1' });
    assertEqual(dup.status, 409);
    const dupBody = await dup.json();
    assertEqual(dupBody.error, 'Submission already processed');

    releaseFirst();
    const first = await firstPromise;
    assertEqual(first.status, 201);
    await first.json();
  });

  await test('middleware disabled → ไม่ replay เลย (master switch)', async () => {
    __resetIdempotencyStoreForTests();
    const { app, getInvocations } = makeApp();
    const disabledEnv = { IDEMPOTENCY_ENABLED: 'false' };
    const r1 = await postJson(app, { ...PAYLOAD_A, submissionToken: 'tok-off' }, {}, disabledEnv);
    const r2 = await postJson(app, { ...PAYLOAD_A, submissionToken: 'tok-off' }, {}, disabledEnv);
    assertEqual(r1.status, 201);
    assertEqual(r2.status, 201);
    assertEqual(getInvocations(), 2, 'disabled middleware must not intercept');
  });

  console.log(`\nผลรวม: ผ่าน ${passed}, พลาด ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
