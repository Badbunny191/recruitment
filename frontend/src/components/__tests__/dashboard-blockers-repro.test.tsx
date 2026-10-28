// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Dashboard V1 — Blocker Reproduction Tests
 * =========================================
 * พิสูจน์ blocker 3 ข้อของ Executive Dashboard V1 บน component จริง
 * (ไม่ใช่แค่ pure logic) ด้วย happy-dom แบบเดียวกับ test อื่นในระบบ
 *
 *   1. Audit Log exposure — role ที่ไม่ใช่ SUPER_ADMIN ต้องไม่เห็นกิจกรรม
 *      และต้องไม่ยิง request ไป /admin/audit-logs เลย
 *   2. 401 redirect behavior — endpoint ตอบ 401 → ต้องพาไป /admin/login
 *      (ล้าง session) ไม่ใช่แสดง "โหลดข้อมูลไม่สำเร็จ"
 *   3. KPI false-green state — ระหว่าง loading / เมื่อ error ต้องไม่แสดง
 *      ตัวเลข 0 หรือข้อความ "ทันสมัยทั้งหมด" ที่อ่านได้ว่า "ปกติ"
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/dashboard-blockers-repro.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/dashboard' });
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
// หน้า dashboard ใช้ useRole() → useAdminAuth() → useRouter/usePathname
// และ <Link> — ทั้งคู่ต้องมี App Router context ซึ่งไม่มีใน happy-dom
// จึง intercept ที่ module loader แทนการพึ่ง context จริง
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
      useSearchParams: () => new URLSearchParams(),
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
// JWT helper — สร้าง token ปลอมที่มี role ตามต้องการ (ไม่ต้องมี signature จริง)
// useAdminAuth อ่าน payload จาก token โดยไม่ verify (backend verify อยู่แล้ว)
// =============================================================================

function makeToken(role: string, expOffsetSec = 3600): string {
  const enc = (o: any) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

// =============================================================================
// Fetch stub — บันทึกทุก request + ตอบตาม scenario ที่กำหนด
// =============================================================================

interface FetchCall { url: string; status?: number }

function installFetch(handler: (url: string) => { status: number; body: any }) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string) => {
    const u = String(url);
    calls.push({ url: u });
    const { status, body } = handler(u);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() { return this; },
    };
  };
  return calls;
}

/** ตอบข้อมูลปกติครบทุก endpoint */
function healthyHandler(url: string) {
  if (url.includes('/admin/applications/summary')) {
    return { status: 200, body: { data: { total: 10, byStatus: { SUBMITTED: 3, QUALIFIED: 7 } } } };
  }
  if (url.includes('/admin/applications?')) {
    return {
      status: 200,
      body: {
        data: [
          { id: 'a1', applicationNo: 'APP-1', fullname: 'ก', status: 'SUBMITTED', submittedAt: Math.floor(Date.now() / 1000) - 86400 },
        ],
        pagination: { page: 1, pageSize: 200, total: 3, totalPages: 1 },
      },
    };
  }
  if (url.includes('/admin/rounds/comparison')) {
    return { status: 200, body: { data: [] } };
  }
  if (url.includes('/admin/rounds')) {
    return { status: 200, body: { data: [] } };
  }
  if (url.includes('/admin/audit-logs')) {
    return {
      status: 200,
      body: {
        items: [
          {
            id: 'l1',
            action: 'PDF_DOWNLOAD',
            entityType: 'APPLICATION',
            entityId: 'e1',
            createdAt: Math.floor(Date.now() / 1000) - 60,
            display: { name: 'APP-2026-5012', secondary: 'นายสมชาย' },
          },
        ],
        total: 1,
      },
    };
  }
  return { status: 404, body: {} };
}

// =============================================================================
// Render helper
// =============================================================================

async function renderDashboard() {
  const mod = await import('../../app/(admin)/admin/dashboard/page');
  const DashboardPage = mod.default;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(React.createElement(DashboardPage));
  });
  // ให้ promise ของ loader ทั้ง 5 ตัวได้ settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
  return {
    text: () => (container.textContent || ''),
    unmount: () => act(async () => root.unmount()),
  };
}

function setSession(role: string) {
  // reset สถานะข้ามเทส: location + storage + router calls
  win.location.href = 'http://localhost:3000/admin/dashboard';
  routerCalls.length = 0;
  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
}

async function main() {
  // =============================================================================
  // BLOCKER 1 — Audit Log exposure
  // =============================================================================

  console.log('\n── Blocker 1: Audit Log exposure ──');

  await test('ADMIN: ไม่ยิง request ไป /admin/audit-logs เลย', async () => {
    setSession('ADMIN');
    const calls = installFetch(healthyHandler);
    const ui = await renderDashboard();
    const auditCalls = calls.filter((c) => c.url.includes('/admin/audit-logs'));
    assertEqual(auditCalls.length, 0, 'ต้องไม่เรียก endpoint audit-logs');
    await ui.unmount();
  });

  await test('ADMIN: ไม่เห็นหัวข้อ "กิจกรรมล่าสุด" และไม่เห็นข้อมูล audit', async () => {
    setSession('ADMIN');
    installFetch(healthyHandler);
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('กิจกรรมล่าสุด'), 'ต้องไม่เห็นหัวข้อกิจกรรมล่าสุด');
    assert(!text.includes('APP-2026-5012'), 'ต้องไม่เห็น entity ของ audit log');
    assert(!text.includes('ดู Audit Log'), 'ต้องไม่เห็นลิงก์ไปหน้า Audit Log');
    await ui.unmount();
  });

  await test('VIEWER: ไม่เห็นกิจกรรมและไม่ยิง audit endpoint', async () => {
    setSession('VIEWER');
    const calls = installFetch(healthyHandler);
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('กิจกรรมล่าสุด'), 'VIEWER ต้องไม่เห็นกิจกรรม');
    assertEqual(calls.filter((c) => c.url.includes('/admin/audit-logs')).length, 0);
    await ui.unmount();
  });

  await test('SUPER_ADMIN: ยังเห็นกิจกรรมล่าสุดตามเดิม (ไม่ regress)', async () => {
    setSession('SUPER_ADMIN');
    const calls = installFetch(healthyHandler);
    const ui = await renderDashboard();
    const text = ui.text();
    assert(text.includes('กิจกรรมล่าสุด'), 'SUPER_ADMIN ต้องยังเห็นหัวข้อ');
    assert(text.includes('APP-2026-5012'), 'SUPER_ADMIN ต้องยังเห็นข้อมูล');
    assertEqual(calls.filter((c) => c.url.includes('/admin/audit-logs')).length, 1, 'ต้องเรียก 1 ครั้ง');
    await ui.unmount();
  });

  // =============================================================================
  // BLOCKER 2 — 401 redirect behavior
  // =============================================================================

  console.log('\n── Blocker 2: 401 redirect ──');

  await test('401 ทุก endpoint → ล้าง session และพาไป /admin/login', async () => {
    setSession('SUPER_ADMIN');
    installFetch(() => ({ status: 401, body: { error: 'Invalid Token' } }));
    const ui = await renderDashboard();
    assertEqual(win.location.pathname, '/admin/login', 'ต้องถูกพาไปหน้า login');
    assertEqual(win.localStorage.getItem('adminToken'), null, 'ต้องล้าง token');
    await ui.unmount();
  });

  await test('401 → ไม่แสดงข้อความ "โหลดข้อมูลไม่สำเร็จ" หลอกผู้ใช้', async () => {
    setSession('SUPER_ADMIN');
    installFetch(() => ({ status: 401, body: { error: 'Invalid Token' } }));
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('โหลดข้อมูลไม่สำเร็จ'), 'ต้องไม่แสดง error ปลอมระหว่างถูกพาไป login');
    await ui.unmount();
  });

  await test('500 (ไม่ใช่ 401) → ยังแสดง error ตามปกติ ไม่ redirect', async () => {
    setSession('SUPER_ADMIN');
    installFetch(() => ({ status: 500, body: {} }));
    const ui = await renderDashboard();
    assertEqual(win.location.pathname, '/admin/dashboard', 'ต้องไม่ออกจาก dashboard');
    assert(ui.text().includes('โหลดข้อมูลไม่สำเร็จ'), 'ต้องแจ้ง error จริง');
    await ui.unmount();
  });

  // =============================================================================
  // BLOCKER 3 — KPI false-green state
  // =============================================================================

  console.log('\n── Blocker 3: KPI false-green ──');

  await test('comparison error → การ์ด Template ต้องไม่เขียว/ไม่บอก "ทันสมัยทั้งหมด"', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url) => {
      if (url.includes('/admin/rounds/comparison')) return { status: 500, body: {} };
      return healthyHandler(url);
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ทันสมัยทั้งหมด'), 'ต้องไม่บอกว่าทันสมัยเมื่อยังไม่รู้ผล');
    assert(text.includes('โหลดข้อมูลไม่สำเร็จ'), 'ต้องแจ้งว่าโหลดไม่สำเร็จ');
    await ui.unmount();
  });

  await test('pending error → การ์ด "รอการตรวจสอบ" ต้องไม่แสดง 0', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url) => {
      if (url.includes('/admin/applications?')) return { status: 500, body: {} };
      return healthyHandler(url);
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ไม่มีงานค้าง'), 'ต้องไม่ยืนยันว่าไม่มีงานค้างเมื่อโหลดไม่สำเร็จ');
    await ui.unmount();
  });

  await test('pending ยังโหลดอยู่ (summary เสร็จแล้ว) → ต้องไม่แสดง 0 ก่อนข้อมูลมา', async () => {
    setSession('SUPER_ADMIN');
    // applications ค้างตลอดไป → การ์ดต้องอยู่ใน loading state ไม่ใช่ 0
    globalAny.fetch = async (url: string) => {
      const u = String(url);
      if (u.includes('/admin/applications?')) {
        return new Promise(() => {}); // never resolves
      }
      const { status, body } = healthyHandler(u);
      return { ok: true, status, json: async () => body, clone() { return this; } };
    };
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ไม่มีงานค้าง'), 'ระหว่าง loading ต้องไม่สรุปว่าไม่มีงานค้าง');
    assert(!text.includes('ค้างนานสุด'), 'ระหว่าง loading ต้องไม่แสดง hint ที่อ่านเป็นข้อมูลจริง');
    await ui.unmount();
  });

  await test('pending count มาจาก pagination.total (250) ไม่ใช่จำนวนแถวที่โหลดมา (1)', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url) => {
      if (url.includes('/admin/applications?')) {
        return {
          status: 200,
          body: {
            data: [
              { id: 'a1', applicationNo: 'APP-1', fullname: 'ก', status: 'SUBMITTED', submittedAt: Math.floor(Date.now() / 1000) - 86400 },
            ],
            pagination: { page: 1, pageSize: 200, total: 250, totalPages: 2 },
          },
        };
      }
      return healthyHandler(url);
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(text.includes('250'), 'ต้องแสดง 250 จาก pagination.total');
    assert(text.includes('จาก 1 ใบแรก'), 'ต้องบอกว่าคำนวณจาก subset');
    await ui.unmount();
  });

  // =============================================================================
  // Summary
  // =============================================================================

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All blocker tests passed ✓');
  process.exit(0);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
