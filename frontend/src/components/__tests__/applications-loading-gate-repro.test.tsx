// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Applications page — Loading Gate Reproduction Tests
 * ===================================================
 * พิสูจน์ blocker "หน้า /admin/applications ค้าง กำลังโหลด..." บน component จริง (happy-dom)
 *
 * สาเหตุเดิม (ยืนยันด้วยเทสชุดนี้):
 *   loading เริ่มที่ true และทางเดียวที่จะเป็น false คือ finally ของ fetchData
 *   แต่ fetchData early-return ก่อนถึงตรงนั้นเมื่อ selectedRoundId ว่าง
 *   ขณะที่ selectedRoundId มาจาก GET /admin/rounds ที่ไม่มี .catch()
 *   → rounds ล้มเหลว (401/403/500/network) = spinner ค้างตลอดกาล
 *
 * เทสที่ต้องผ่านหลังแก้:
 *   1. rounds ล้มเหลว (500)      → ต้องไม่ค้าง spinner + ต้องบอก error + มีปุ่มลองใหม่
 *   2. rounds 401                → ต้องไม่ค้าง spinner
 *   3. rounds คืนลิสต์ว่าง        → ต้องไม่ค้าง spinner (empty state ไม่ใช่ loading)
 *   4. rounds สำเร็จ (happy path) → ยังโหลดรายการได้เหมือนเดิม (ไม่ regress)
 *   5. ลองอีกครั้งหลัง error      → ยิง rounds ใหม่แล้วกลับมาแสดงข้อมูลได้
 *   6. rounds ค้างตลอดไป          → ต้องแสดง loading (ถูกต้อง) ไม่ใช่ error ปลอม
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/applications-loading-gate-repro.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/applications' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch { /* Node 24 navigator เป็น getter-only */ }
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.localStorage = win.localStorage;
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
(globalAny as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------- Next.js module stubs ----------
import Module from 'module';

const routerCalls: string[] = [];
const stubRouter = {
  replace: (p: string) => { routerCalls.push(`replace:${p}`); },
  push: (p: string) => { routerCalls.push(`push:${p}`); },
  back: () => { routerCalls.push('back'); },
  forward: () => { routerCalls.push('forward'); },
  refresh: () => { routerCalls.push('refresh'); },
  prefetch: () => {},
};

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request === 'next/navigation') {
    return {
      useRouter: () => stubRouter,
      usePathname: () => win.location.pathname,
      useSearchParams: () => new URLSearchParams(win.location.search.replace(/^\?/, '')),
      useParams: () => ({}),
    };
  }
  if (request === 'next/link') {
    const Link = React.forwardRef((props: any, ref: any) => {
      const { href, children, ...rest2 } = props;
      return React.createElement('a', { ...rest2, href, ref }, children);
    });
    return { __esModule: true, default: Link };
  }
  return origLoad.call(this, request, ...rest);
};

// ---------- imports ----------
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// =============================================================================
// Test harness
// =============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// =============================================================================
// JWT helper — useAdminAuth อ่าน payload จาก token โดยไม่ verify
// =============================================================================

function encodeJwtPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(role: string, expOffsetSec = 3600): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

// =============================================================================
// Fetch stub
// =============================================================================

interface FetchCall { url: string }

function installFetch(handler: (url: string, init: any) => { status: number; body: any } | Promise<any>) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u });
    const handled = await handler(u, init);
    // handler คืน Promise ที่ไม่ resolve = จำลอง request ค้าง
    if (handled === 'PENDING') return new Promise(() => {});
    const { status, body } = handled;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() { return this; },
    };
  };
  return calls;
}

const ROUND = {
  id: 'round-1',
  title: 'รอบทดสอบ 2569',
  status: 'ACTIVE',
  deletedAt: null,
  roundCode: 'CHM01',
};

const APP_ROW = {
  id: 'app-1',
  applicationNo: 'APP-2026-0001',
  fullname: 'นายทดสอบ ระบบ',
  email: 'test@example.com',
  status: 'SUBMITTED',
  submittedAt: Math.floor(Date.now() / 1000),
  roundId: 'round-1',
};

/** handler ที่ตอบครบทุก endpoint ของหน้า (happy path) */
function healthyHandler(roundsBody: any = { data: [ROUND] }) {
  return (url: string) => {
    if (url.includes('/admin/rounds')) return { status: 200, body: roundsBody };
    if (url.includes('/admin/applications/summary')) {
      return { status: 200, body: { data: { total: 1, byStatus: { SUBMITTED: 1 } } } };
    }
    if (url.includes('/admin/applications')) {
      return {
        status: 200,
        body: {
          data: [APP_ROW],
          pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        },
      };
    }
    return { status: 404, body: {} };
  };
}

// =============================================================================
// Render helper
// =============================================================================

async function renderApplications() {
  const mod = await import('../../app/(admin)/admin/applications/ApplicationsClient');
  const ApplicationsClient = mod.default;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(React.createElement(ApplicationsClient));
  });
  // ให้ promise ของ loader/fetch ได้ settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
  return {
    text: () => (container.textContent || ''),
    rerender: async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });
    },
    unmount: () => act(async () => root.unmount()),
  };
}

function setSession(role = 'ADMIN') {
  win.location.href = 'http://localhost:3000/admin/applications';
  routerCalls.length = 0;
  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
}

const SPINNER_TEXT = 'กำลังโหลด';

// =============================================================================
// Tests
// =============================================================================

async function main() {
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n── Blocker: loading gate ──');

  await test('rounds ตอบ 500 → ต้องไม่ค้าง spinner + แจ้ง error + มีปุ่มลองอีกครั้ง', async () => {
    setSession();
    installFetch((url) => {
      if (url.includes('/admin/rounds')) return { status: 500, body: { error: 'boom' } };
      return { status: 500, body: {} };
    });
    const ui = await renderApplications();
    const text = ui.text();
    assert(!text.includes(SPINNER_TEXT), 'ต้องไม่ค้าง "กำลังโหลด..." เมื่อ rounds ล้มเหลว');
    assert(text.includes('โหลดรายการรอบรับสมัครไม่สำเร็จ'), 'ต้องแจ้งว่าโหลดรอบไม่สำเร็จ');
    assert(text.includes('ลองอีกครั้ง'), 'ต้องมีทางลองใหม่');
    await ui.unmount();
  });

  await test('rounds ตอบ 401 → ต้องไม่ค้าง spinner', async () => {
    setSession();
    installFetch((url) => {
      if (url.includes('/admin/rounds')) return { status: 401, body: { error: 'Unauthorized' } };
      return { status: 401, body: {} };
    });
    const ui = await renderApplications();
    const text = ui.text();
    assert(!text.includes(SPINNER_TEXT), '401 ต้องไม่ทำให้ spinner ค้าง');
    assert(text.includes('โหลดรายการรอบรับสมัครไม่สำเร็จ'), 'ต้องแจ้ง error');
    await ui.unmount();
  });

  await test('rounds คืนลิสต์ว่าง → ต้องไม่ค้าง spinner และไม่ใช่ error', async () => {
    setSession();
    installFetch(healthyHandler({ data: [] }));
    const ui = await renderApplications();
    const text = ui.text();
    assert(!text.includes(SPINNER_TEXT), 'ไม่มีรอบ = จบการโหลด ไม่ใช่ loading');
    assert(text.includes('ไม่พบรอบรับสมัคร'), 'ต้องแสดง empty state ของรอบ');
    assert(!text.includes('โหลดรายการรอบรับสมัครไม่สำเร็จ'), 'ลิสต์ว่างไม่ใช่ error');
    await ui.unmount();
  });

  await test('rounds สำเร็จ (happy path) → ยังโหลดรายการได้เหมือนเดิม (ไม่ regress)', async () => {
    setSession();
    const calls = installFetch(healthyHandler());
    const ui = await renderApplications();
    const text = ui.text();
    assert(!text.includes(SPINNER_TEXT), 'โหลดเสร็จต้องไม่ค้าง spinner');
    assert(text.includes('APP-2026-0001'), 'ต้องแสดงแถวใบสมัคร');
    assert(text.includes('รอบทดสอบ 2569'), 'ต้องแสดงรอบที่เลือก');
    assertEqual(calls.filter((c) => c.url.includes('/admin/applications?')).length, 1, 'ต้องยิง list 1 ครั้ง');
    await ui.unmount();
  });

  await test('ล้มเหลวก่อน แล้วกด "ลองอีกครั้ง" → กลับมาแสดงข้อมูลได้', async () => {
    setSession();
    let roundsShouldFail = true;
    installFetch((url, init) => {
      if (url.includes('/admin/rounds')) {
        return roundsShouldFail
          ? { status: 500, body: { error: 'boom' } }
          : healthyHandler()(url, init);
      }
      return healthyHandler()(url, init);
    });
    const ui = await renderApplications();
    assert(ui.text().includes('ลองอีกครั้ง'), 'ต้องเห็นปุ่มลองใหม่ก่อน');

    // จำลองผู้ใช้กด "ลองอีกครั้ง"
    roundsShouldFail = false;
    const button = Array.from(win.document.querySelectorAll('button'))
      .find((b: any) => (b.textContent || '').includes('ลองอีกครั้ง'));
    assert(button, 'ต้องหาปุ่มลองอีกครั้งเจอ');
    await act(async () => {
      button.dispatchEvent(new win.Event('click', { bubbles: true }) as any);
    });
    await ui.rerender();

    const text = ui.text();
    assert(!text.includes('โหลดรายการรอบรับสมัครไม่สำเร็จ'), 'หลังลองใหม่ต้องไม่ใช่ error แล้ว');
    assert(text.includes('APP-2026-0001'), 'ต้องกลับมาแสดงข้อมูลได้');
    await ui.unmount();
  });

  await test('rounds ค้างตลอดไป → ต้องแสดง loading ต่อไป (ถูกต้อง) ไม่ใช่ error ปลอม', async () => {
    setSession();
    installFetch((url) => {
      if (url.includes('/admin/rounds')) return 'PENDING';
      return { status: 200, body: { data: [] } };
    });
    const ui = await renderApplications();
    const text = ui.text();
    assert(text.includes(SPINNER_TEXT), 'ระหว่างรอ rounds จริง ๆ ต้องแสดง loading');
    assert(!text.includes('โหลดรายการรอบรับสมัครไม่สำเร็จ'), 'ยังไม่รู้ผล = ต้องไม่สรุปว่า error');
    await ui.unmount();
  });

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All loading-gate tests passed ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
