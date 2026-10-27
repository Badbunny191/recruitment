// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * R9 Regression Tests — mustChangePassword frontend handling
 * ===========================================================
 *
 * Backend ตอบ 403 + code MUST_CHANGE_PASSWORD เมื่อ flag เปิดอยู่
 * lib นี้ต้อง:
 *   A. isMustChangePasswordBody — จับ code และ error ทั้งคู่, ไม่จับของอื่น
 *   B. handleMustChangePasswordResponse — 403 + code → set flag + redirect,
 *      403 อื่น / 200 → ไม่ทำอะไร
 *   C. loop guard — อยู่หน้า /admin/change-password แล้ว → ไม่ redirect ซ้ำ
 *   D. fetch interceptor — ครอบ window.fetch ดัก 403 MUST_CHANGE_PASSWORD,
 *      response ที่ caller ได้ยังอ่านได้ครบ, install ซ้ำไม่ซ้อน, uninstall คืนเดิม
 *   E. flag helpers — set/remove localStorage key เดียวกับ login page
 *      ('mustChangePassword')
 *
 * Run: tsx --tsconfig tsconfig.test.json src/lib/__tests__/must-change-password.test.ts
 */

// ทำให้เป็น ES module — ไม่งั้น top-level declarations ชนกับ test ไฟล์อื่น
// ที่เป็น global script (TS2451/TS2393 เช่น application-pattern.test.ts)
export {};

// ---------- fake window — ตั้งก่อน import lib ----------
class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}

const fakeStorage = new FakeStorage();
const fakeLocation: any = { pathname: '/admin/dashboard', assign: (..._args: any[]) => {} };
let assignCalls: string[] = [];
fakeLocation.assign = (url: string) => { assignCalls.push(url); };
(globalThis as any).window = { localStorage: fakeStorage, location: fakeLocation };
(globalThis as any).location = fakeLocation;

// ---------- TEST RUNNER ----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
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
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition: any, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function resetState(pathname = '/admin/dashboard') {
  fakeStorage.clear();
  assignCalls = [];
  fakeLocation.pathname = pathname;
}

async function runAllTests() {
  // lib โหลดหลัง fake window พร้อม (tsx CJS ห้าม top-level await)
  const lib: any = await import('../must-change-password');

  // ---------- A: isMustChangePasswordBody ----------

  await test('A1: จับ body.code = MUST_CHANGE_PASSWORD', () => {
    assertTrue(lib.isMustChangePasswordBody({ success: false, code: 'MUST_CHANGE_PASSWORD' }), 'A1');
  });

  await test('A2: จับ body.error = MUST_CHANGE_PASSWORD (fallback key)', () => {
    assertTrue(lib.isMustChangePasswordBody({ error: 'MUST_CHANGE_PASSWORD' }), 'A2');
  });

  await test('A3: ไม่จับ error code อื่น', () => {
    assertFalse(lib.isMustChangePasswordBody({ code: 'FORBIDDEN' }), 'A3 code อื่น');
    assertFalse(lib.isMustChangePasswordBody({ error: 'Unauthorized' }), 'A3 error อื่น');
  });

  await test('A4: ไม่จับ non-object', () => {
    assertFalse(lib.isMustChangePasswordBody(null), 'A4 null');
    assertFalse(lib.isMustChangePasswordBody('MUST_CHANGE_PASSWORD'), 'A4 string');
    assertFalse(lib.isMustChangePasswordBody(undefined), 'A4 undefined');
  });

  // ---------- B: handleMustChangePasswordResponse ----------

  await test('B1: 403 + MUST_CHANGE_PASSWORD → set flag + redirect ไป /admin/change-password', async () => {
    resetState();
    const res = new Response(
      JSON.stringify({ success: false, code: 'MUST_CHANGE_PASSWORD', message: 'Password change required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
    const handled = await lib.handleMustChangePasswordResponse(res);
    assertTrue(handled, 'B1 ต้อง return true');
    assertEqual(fakeStorage.getItem('mustChangePassword'), 'true', 'B1 flag ต้องถูก set');
    assertEqual(assignCalls.length, 1, 'B1 redirect ครั้งเดียว');
    assertEqual(assignCalls[0], '/admin/change-password', 'B1 ปลายทาง');
  });

  await test('B2: 403 + error code อื่น → ไม่ redirect', async () => {
    resetState();
    const res = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    const handled = await lib.handleMustChangePasswordResponse(res);
    assertFalse(handled, 'B2 return false');
    assertEqual(assignCalls.length, 0, 'B2 ไม่ redirect');
  });

  await test('B3: 200 → ไม่ redirect (เช็คเฉพาะ 403)', async () => {
    resetState();
    const res = new Response(JSON.stringify({ success: true }), { status: 200 });
    const handled = await lib.handleMustChangePasswordResponse(res);
    assertFalse(handled, 'B3 return false');
    assertEqual(assignCalls.length, 0, 'B3 ไม่ redirect');
  });

  // ---------- C: loop guard ----------

  await test('C1: อยู่หน้า /admin/change-password แล้ว → ไม่ redirect ซ้ำ (กัน loop)', async () => {
    resetState('/admin/change-password');
    const res = new Response(JSON.stringify({ code: 'MUST_CHANGE_PASSWORD' }), { status: 403 });
    const handled = await lib.handleMustChangePasswordResponse(res);
    assertFalse(handled, 'C1 ไม่ redirect');
    assertEqual(assignCalls.length, 0, 'C1 ไม่มี assign call');
  });

  // ---------- D: fetch interceptor ----------

  await test('D1: interceptor ดัก 403 MUST_CHANGE_PASSWORD → redirect + response ครบสำหรับ caller', async () => {
    resetState();
    const realBody = { success: false, code: 'MUST_CHANGE_PASSWORD', message: 'Password change required' };
    const originalFetch = async () => new Response(JSON.stringify(realBody), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    (globalThis as any).window.fetch = originalFetch;

    const uninstall = lib.installMustChangePasswordFetchInterceptor();

    const res = await (globalThis as any).window.fetch('http://test.local/api/v1/admin/fields');
    assertEqual(assignCalls.length, 1, 'D1 redirect ถูกเรียก');
    assertEqual(fakeStorage.getItem('mustChangePassword'), 'true', 'D1 flag ถูก set');

    // caller ยังอ่าน body/status ได้ครบ (interceptor ไม่กิน response)
    assertEqual(res.status, 403, 'D1 status คงเดิม');
    const body = await res.json();
    assertEqual(body.code, 'MUST_CHANGE_PASSWORD', 'D1 body ครบ');

    uninstall();
  });

  await test('D2: install ซ้ำ → ไม่ซ้อน wrapper (idempotent)', async () => {
    resetState();
    const originalFetch = async () => new Response('{}', { status: 200 });
    (globalThis as any).window.fetch = originalFetch;

    const uninstall1 = lib.installMustChangePasswordFetchInterceptor();
    const firstWrapper = (globalThis as any).window.fetch;
    const uninstall2 = lib.installMustChangePasswordFetchInterceptor();

    assertTrue((globalThis as any).window.fetch === firstWrapper, 'D2 fetch ไม่ถูก wrap ซ้ำ');
    uninstall2(); // noop
    uninstall1();
    assertTrue((globalThis as any).window.fetch === originalFetch, 'D2 uninstall คืน original');
  });

  await test('D3: uninstall → fetch กลับเป็น original + 403 อื่นไม่โดนแตะ', async () => {
    resetState();
    const originalFetch = async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    (globalThis as any).window.fetch = originalFetch;

    const uninstall = lib.installMustChangePasswordFetchInterceptor();
    await (globalThis as any).window.fetch('http://test.local/api/v1/admin/users');
    assertEqual(assignCalls.length, 0, 'D3 403 อื่นไม่ redirect');

    uninstall();
    assertTrue((globalThis as any).window.fetch === originalFetch, 'D3 fetch ถูก restore');
  });

  // ---------- E: flag helpers ----------

  await test('E1: setMustChangePasswordFlag(true/false) → set/remove key ตาม login page', () => {
    resetState();
    lib.setMustChangePasswordFlag(true);
    assertEqual(fakeStorage.getItem('mustChangePassword'), 'true', 'E1 set');
    assertTrue(lib.readMustChangePasswordFlag(), 'E1 read = true');

    lib.setMustChangePasswordFlag(false);
    assertEqual(fakeStorage.getItem('mustChangePassword'), null, 'E1 remove');
    assertFalse(lib.readMustChangePasswordFlag(), 'E1 read = false');
  });

  await test('E2: flag ตอน mount บนหน้า admin → redirect เงื่อนไขตรง AdminGuard', () => {
    resetState('/admin/users');
    lib.setMustChangePasswordFlag(true);
    assertTrue(lib.readMustChangePasswordFlag() && !lib.isOnChangePasswordPage(), 'E2 ต้อง redirect');

    resetState('/admin/change-password');
    lib.setMustChangePasswordFlag(true);
    assertTrue(lib.isOnChangePasswordPage(), 'E2 หน้า change-password ไม่ redirect (loop guard)');
  });

  // ---------- Summary ----------

  console.log('');
  console.log('=================================================');
  console.log(`ผลรวม: ${passed} ผ่าน, ${failed} ล้มเหลว`);
  console.log('=================================================');

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
