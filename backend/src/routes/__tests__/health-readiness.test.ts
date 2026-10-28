/**
 * Health Readiness — GET /health/ready
 * ============================================================================
 *
 * ครอบ endpoint ที่ uptime monitor จะพึ่งพา ถ้ามันโกหก (คืน 200 ตอน D1 ล่ม)
 * ทั้งระบบ monitoring จะไร้ความหมาย — test ชุดนี้จึงเน้น failure path
 * มากกว่า happy path
 *
 * ครอบ:
 *   H1.  /health (liveness) → 200 + status ok + **ไม่แตะ DB เลย**
 *   H2.  /health/ready → 200 เมื่อ D1 ปกติ + checks.db = ok
 *   H3.  /health/ready → 503 เมื่อ D1 throw (failure path หลัก)
 *   H4.  /health/ready → 503 + checks.db = timeout เมื่อ D1 ค้าง
 *   H5.  /health/ready → 503 + checks.jwt_secret = missing เมื่อไม่มี secret
 *   H6.  /health/ready → 503 เมื่อ D1 คืนผลผิดปกติ (ไม่ใช่ 1)
 *   H7.  response ไม่มี SQL / stack / error message หลุด (endpoint public)
 *   H8.  response มี latency_ms + timestamp ตาม contract
 *   H9.  /health ยังตอบได้แม้ D1 พัง (liveness ต้องไม่ผูก dependency)
 *   H10. log ที่เขียนตอน probe ล้มไม่มี PII (national_id/password/token)
 *
 * ใช้ D1 จำลอง 100% — ไม่ deploy ไม่แตะ D1 จริง ไม่ต้องมี network
 *
 * รัน: node --import tsx src/routes/__tests__/health-readiness.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import worker from '../../index';
import { DB_PROBE_TIMEOUT_MS } from '../health.routes';

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

// ── D1 stubs ────────────────────────────────────────────────────────────────

/** D1 ที่ทำงานปกติ — ตอบ SELECT 1 ได้ */
function healthyD1() {
  return {
    calls: [] as string[],
    prepare(sqlText) {
      this.calls.push(sqlText);
      return {
        bind() { return this; },
        async first() { return { ok: 1 }; },
        async all() { return { results: [{ ok: 1 }] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
    },
  };
}

/** D1 ที่ throw ทันที — จำลอง binding หลุด / DB ถูกลบ */
function throwingD1(message = 'D1_ERROR: no such table') {
  return {
    calls: [] as string[],
    prepare(sqlText) {
      this.calls.push(sqlText);
      return {
        bind() { return this; },
        async first() { throw new Error(message); },
        async all() { throw new Error(message); },
        async run() { throw new Error(message); },
      };
    },
  };
}

/** D1 ที่ค้างไม่ยอม return — จำลอง DB hang (ไม่ throw ไม่ตอบ) */
function hangingD1() {
  return {
    calls: [] as string[],
    prepare(sqlText) {
      this.calls.push(sqlText);
      return {
        bind() { return this; },
        async first() { return new Promise(() => {}); },
        async all() { return new Promise(() => {}); },
        async run() { return new Promise(() => {}); },
      };
    },
  };
}

/** D1 ที่ตอบแต่ค่าผิด — จำลอง binding ชี้ผิด database */
function wrongResultD1() {
  return {
    calls: [] as string[],
    prepare(sqlText) {
      this.calls.push(sqlText);
      return {
        bind() { return this; },
        async first() { return { ok: 0 }; },
        async all() { return { results: [{ ok: 0 }] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
    },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

function makeEnv(overrides = {}) {
  return {
    DB: healthyD1(),
    R2_BUCKET: { delete: async () => {} },
    JWT_SECRET: 'test-secret-health',
    ...overrides,
  };
}

async function get(path, env) {
  const res = await worker.fetch(new Request(`https://backend.local${path}`), env, ctx);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body, text };
}

/** ดัก console.error ระหว่างรัน fn — คืนทั้ง log ที่ดักได้และผลลัพธ์ของ fn */
async function captureConsoleError(fn) {
  const original = console.error;
  const captured: string[] = [];
  console.error = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  try {
    const result = await fn();
    return { logs: captured, result };
  } finally {
    console.error = original;
  }
}

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('=================================================');
  console.log('Health Readiness — Tests');
  console.log('=================================================\n');

  // ---- H1: liveness ไม่แตะ DB ----
  await test('H1: /health → 200 + status ok + ไม่แตะ DB เลย', async () => {
    const env = makeEnv();
    const res = await get('/health', env);

    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.status, 'ok', 'body.status');
    assertTrue(typeof res.body.timestamp === 'number', 'มี timestamp เป็น number');
    assertEqual(env.DB.calls.length, 0, `liveness ต้องไม่ยิง query เลย (ยิงไป ${env.DB.calls.length} ครั้ง)`);
  });

  // ---- H2: readiness happy path ----
  await test('H2: /health/ready → 200 + checks.db = ok เมื่อ D1 ปกติ', async () => {
    const env = makeEnv();
    const res = await get('/health/ready', env);

    assertEqual(res.status, 200, 'HTTP status');
    assertEqual(res.body.status, 'ok', 'body.status');
    assertEqual(res.body.checks.db, 'ok', 'checks.db');
    assertEqual(res.body.checks.jwt_secret, 'ok', 'checks.jwt_secret');

    // ยืนยันว่าใช้ SELECT 1 จริง ไม่ใช่ COUNT(*) (ซึ่งจะกิน quota)
    assertEqual(env.DB.calls.length, 1, 'ต้องยิง query 1 ครั้ง');
    assertTrue(/SELECT\s+1/i.test(env.DB.calls[0]), `query ต้องเป็น SELECT 1 (ได้: ${env.DB.calls[0]})`);
    assertTrue(!/COUNT\s*\(/i.test(env.DB.calls[0]), 'ห้ามใช้ COUNT(*) — จะเป็น full table scan');
  });

  // ---- H3: D1 throw → 503 (failure path หลัก) ----
  await test('H3: /health/ready → 503 + checks.db = error เมื่อ D1 throw', async () => {
    const env = makeEnv({ DB: throwingD1() });
    const { logs, result: r } = await captureConsoleError(() => get('/health/ready', env));

    assertEqual(r.status, 503, 'HTTP status ต้องเป็น 503 ไม่ใช่ 200');
    assertEqual(r.body.status, 'degraded', 'body.status');
    assertEqual(r.body.checks.db, 'error', 'checks.db');
    assertTrue(logs.length > 0, 'ต้อง log ฝั่ง server เมื่อ probe ล้ม');
  });

  // ---- H4: D1 ค้าง → timeout → 503 ----
  await test('H4: /health/ready → 503 + checks.db = timeout เมื่อ D1 ค้าง', async () => {
    const env = makeEnv({ DB: hangingD1() });
    const startedAt = Date.now();

    const { result: r } = await captureConsoleError(() => get('/health/ready', env));
    const elapsed = Date.now() - startedAt;

    assertEqual(r.status, 503, 'HTTP status');
    assertEqual(r.body.checks.db, 'timeout', 'checks.db ต้องแยก timeout ออกจาก error');
    assertTrue(
      elapsed >= DB_PROBE_TIMEOUT_MS - 100,
      `ต้องรอจนครบ timeout (${DB_PROBE_TIMEOUT_MS} ms) ก่อนตอบ — ใช้ไป ${elapsed} ms`
    );
    assertTrue(
      elapsed < DB_PROBE_TIMEOUT_MS + 2000,
      `ต้องไม่ค้างเกิน timeout มาก (ใช้ไป ${elapsed} ms)`
    );
  });

  // ---- H5: secret หาย → 503 ----
  await test('H5: /health/ready → 503 + checks.jwt_secret = missing เมื่อไม่มี secret', async () => {
    const env = makeEnv({ JWT_SECRET: '' });
    const res = await get('/health/ready', env);

    assertEqual(res.status, 503, 'HTTP status');
    assertEqual(res.body.checks.jwt_secret, 'missing', 'checks.jwt_secret');
    assertEqual(res.body.checks.db, 'ok', 'db ยังต้องรายงานตามจริง');
  });

  // ---- H6: D1 ตอบผลผิดปกติ ----
  await test('H6: /health/ready → 503 + checks.db = error เมื่อ D1 คืนผลผิดปกติ', async () => {
    const env = makeEnv({ DB: wrongResultD1() });
    const { result: r } = await captureConsoleError(() => get('/health/ready', env));

    assertEqual(r.status, 503, 'HTTP status');
    assertEqual(r.body.checks.db, 'error', 'checks.db');
  });

  // ---- H7: ไม่มีข้อมูลภายในหลุดออก response ----
  await test('H7: response ไม่มี SQL / stack / error message หลุด (endpoint public)', async () => {
    const env = makeEnv({ DB: throwingD1('D1_ERROR: no such table: applications at line 42') });
    const { result: r } = await captureConsoleError(() => get('/health/ready', env));

    const raw = r.text.toLowerCase();
    const leaks = ['d1_error', 'no such table', 'applications', 'at line', 'stack', 'select 1', 'sql'];
    for (const leak of leaks) {
      assertTrue(!raw.includes(leak), `ห้ามมี "${leak}" ใน response: ${r.text}`);
    }

    // ค่าที่อนุญาตให้มีได้มีแค่สถานะระดับหมวด
    assertEqual(r.body.checks.db, 'error', 'checks.db ยังต้องบอกสถานะ');
  });

  // ---- H8: contract ของ response ----
  await test('H8: response มี latency_ms + timestamp + checks ครบตาม contract', async () => {
    const env = makeEnv();
    const res = await get('/health/ready', env);

    assertTrue(typeof res.body.latency_ms === 'number', 'latency_ms เป็น number');
    assertTrue(res.body.latency_ms >= 0, 'latency_ms ต้องไม่ติดลบ');
    assertTrue(typeof res.body.timestamp === 'number', 'timestamp เป็น number');
    assertTrue(res.body.checks && typeof res.body.checks === 'object', 'checks เป็น object');
    assertTrue('db' in res.body.checks, 'checks.db มีอยู่');
    assertTrue('jwt_secret' in res.body.checks, 'checks.jwt_secret มีอยู่');
  });

  // ---- H9: liveness ไม่ผูก dependency ----
  await test('H9: /health ยังตอบ 200 แม้ D1 พัง (liveness ต้องไม่ผูก dependency)', async () => {
    const env = makeEnv({ DB: throwingD1(), JWT_SECRET: '' });
    const res = await get('/health', env);

    assertEqual(res.status, 200, 'liveness ต้องไม่พังตาม dependency');
    assertEqual(res.body.status, 'ok', 'body.status');
    assertEqual(env.DB.calls.length, 0, 'ยังต้องไม่แตะ DB');
  });

  // ---- H10: log ไม่มี PII ----
  await test('H10: log ตอน probe ล้มไม่มี PII (national_id/password/token)', async () => {
    const env = makeEnv({
      DB: throwingD1('D1_ERROR: SELECT national_id, password_hash FROM applications WHERE token = "abc"'),
    });
    const { logs } = await captureConsoleError(() => get('/health/ready', env));

    const joined = logs.join(' ').toLowerCase();
    for (const pii of ['national_id', 'password', 'token', 'abc']) {
      assertTrue(!joined.includes(pii), `log ห้ามมี "${pii}": ${joined}`);
    }
    assertTrue(logs.length > 0, 'ยังต้อง log เพื่อ debug ได้');
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
