// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Dashboard V2 (single endpoint) — Blocker Reproduction Tests
 * ===========================================================
 * พิสูจน์ blocker ของ Executive Dashboard บน component จริง (happy-dom)
 * คงเป้าหมายเดิมของ V1 ทั้งหมด แต่โครงสร้างข้อมูลเป็น endpoint เดียว
 * GET /admin/dashboard/overview (แทน fan-out 5 endpoint)
 *
 *   1. Audit Log exposure — role ที่ไม่ใช่ SUPER_ADMIN ต้องไม่เห็นกิจกรรม
 *      (backend ส่ง activities: null ให้ role อื่นอยู่แล้ว) และไม่มี request
 *      ใดไปยัง endpoint audit-logs อีกต่อไป
 *   1b. Fan-out — โหลดหนึ่งครั้งต้องยิง request สด ๆ 1 request เท่านั้น
 *      และห้ามยิง endpoint เก่าทั้ง 5 (regression ของการลด fan-out)
 *   2. 401 redirect behavior — endpoint ตอบ 401 → ต้องพาไป /admin/login
 *      (ล้าง session) ไม่ใช่แสดง "โหลดข้อมูลไม่สำเร็จ"
 *   3. KPI false-green state — ระหว่าง loading / เมื่อ section ล้ม
 *      (fail-soft: null + errors[]) ต้องไม่แสดง 0 หรือข้อความ
 *      "ทันสมัยทั้งหมด" ที่อ่านได้ว่า "ปกติ"
 *   4. Pending count — ต้องมาจาก backend.total (ชุดเต็ม) โดยไม่มีคำเตือน
 *      "คำนวณจาก N ใบแรก" อีกต่อไป (server aggregate จากชุดเต็มทั้งหมด)
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
// ปลายทาง stub ฝั่งล่าง decode payload ได้เพื่อจำลองพฤติกรรม backend ต่อ role
// =============================================================================

function encodeJwtPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtRole(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const parts = authHeader.slice(7).split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function makeToken(role: string, expOffsetSec = 3600): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

// =============================================================================
// Fetch stub — บันทึกทุก request + ตอบตาม scenario ที่กำหนด
// =============================================================================

interface FetchCall { url: string; status?: number }

function installFetch(handler: (url: string, init: any) => { status: number; body: any }) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u });
    const { status, body } = handler(u, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() { return this; },
    };
  };
  return calls;
}

/** payload ปกติที่ backend ควรตอบ (activities ตาม role — fail-soft ต่อ section) */
function overviewBody(role: string | null, overrides: any = {}) {
  const base: any = {
    summary: { total: 10, byStatus: { SUBMITTED: 3, QUALIFIED: 7 } },
    pending: {
      total: 3,
      overdueCount: 1,
      oldestSubmittedAt: Math.floor(Date.now() / 1000) - 2 * 86400,
      slaDays: 7,
      items: [
        {
          id: 'a1',
          applicationNo: 'APP-1',
          fullname: 'ก',
          status: 'SUBMITTED',
          submittedAt: Math.floor(Date.now() / 1000) - 86400,
        },
      ],
    },
    rounds: [],
    comparison: [],
    activities: null,
    errors: [],
  };
  if (role === 'SUPER_ADMIN') {
    base.activities = {
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
    };
  }
  return { data: { ...base, ...overrides } };
}

/** ตอบข้อมูลปกติครบ (activities เฉพาะ SUPER_ADMIN — จำลอง backend จริง) */
function healthyHandler(url: string, init: any) {
  if (url.includes('/admin/dashboard/overview')) {
    return { status: 200, body: overviewBody(decodeJwtRole(init?.headers?.Authorization)) };
  }
  return { status: 404, body: {} };
}

const LEGACY_ENDPOINTS = [
  '/admin/applications/summary',
  '/admin/applications?',
  '/admin/rounds/comparison',
  '/admin/rounds?',
  '/admin/audit-logs',
];

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
  // ให้ promise ของ loader ได้ settle
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

  await test('ADMIN: ยิง request เดียวไป overview และไม่ยิง endpoint audit-logs/endpoint เก่าเลย', async () => {
    setSession('ADMIN');
    const calls = installFetch(healthyHandler);
    const ui = await renderDashboard();
    assertEqual(calls.length, 1, 'ต้องยิง request เดียว (single endpoint)');
    assert(calls[0].url.includes('/admin/dashboard/overview'), 'ต้องชี้ /admin/dashboard/overview');
    for (const legacy of LEGACY_ENDPOINTS) {
      assertEqual(calls.filter((c) => c.url.includes(legacy)).length, 0, `ห้ามยิง endpoint เก่า: ${legacy}`);
    }
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

  await test('VIEWER: ไม่เห็นกิจกรรมและ body ที่ server ส่งไม่มี audit (activities: null)', async () => {
    setSession('VIEWER');
    let sentBody: any = null;
    installFetch((url, init) => {
      const res = healthyHandler(url, init);
      if (url.includes('/admin/dashboard/overview')) sentBody = res.body;
      return res;
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('กิจกรรมล่าสุด'), 'VIEWER ต้องไม่เห็นกิจกรรม');
    assertEqual(sentBody?.data?.activities ?? null, null, 'backend ต้องส่ง activities: null ให้ VIEWER');
    await ui.unmount();
  });

  await test('SUPER_ADMIN: ยังเห็นกิจกรรมล่าสุดตามเดิม (ไม่ regress)', async () => {
    setSession('SUPER_ADMIN');
    const calls = installFetch(healthyHandler);
    const ui = await renderDashboard();
    const text = ui.text();
    assert(text.includes('กิจกรรมล่าสุด'), 'SUPER_ADMIN ต้องยังเห็นหัวข้อ');
    assert(text.includes('APP-2026-5012'), 'SUPER_ADMIN ต้องยังเห็นข้อมูล');
    assertEqual(calls.filter((c) => c.url.includes('/admin/dashboard/overview')).length, 1, 'ต้องเรียก 1 ครั้ง');
    await ui.unmount();
  });

  // =============================================================================
  // BLOCKER 2 — 401 redirect behavior
  // =============================================================================

  console.log('\n── Blocker 2: 401 redirect ──');

  await test('401 จาก overview → ล้าง session และพาไป /admin/login', async () => {
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

  await test('fail-soft: comparison ล้ม (errors:["comparison"]) → การ์ด Template ต้องไม่เขียว/ไม่บอก "ทันสมัยทั้งหมด" และส่วนอื่นยังแสดง', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url, init) => {
      if (url.includes('/admin/dashboard/overview')) {
        return { status: 200, body: overviewBody('SUPER_ADMIN', { comparison: null, errors: ['comparison'] }) };
      }
      return { status: 404, body: {} };
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ทันสมัยทั้งหมด'), 'ต้องไม่บอกว่าทันสมัยเมื่อยังไม่รู้ผล');
    assert(text.includes('โหลดข้อมูลไม่สำเร็จ'), 'ต้องแจ้งว่าโหลดไม่สำเร็จ (เฉพาะ section นั้น)');
    assert(text.includes('รอบที่เปิดรับ'), 'ส่วนรอบที่เปิดรับต้องยังแสดง');
    assert(text.includes('ภาพรวมใบสมัคร'), 'ส่วน KPI ต้องยังแสดง');
    await ui.unmount();
  });

  await test('fail-soft: pending ล้ม (errors:["pending"]) → การ์ด "รอการตรวจสอบ" ต้องไม่แสดง 0', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url, init) => {
      if (url.includes('/admin/dashboard/overview')) {
        return { status: 200, body: overviewBody('SUPER_ADMIN', { pending: null, errors: ['pending'] }) };
      }
      return { status: 404, body: {} };
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ไม่มีงานค้าง'), 'ต้องไม่ยืนยันว่าไม่มีงานค้างเมื่อโหลดไม่สำเร็จ');
    assert(text.includes('โหลดข้อมูลไม่สำเร็จ'), 'ต้องแจ้ง error ของ section');
    await ui.unmount();
  });

  await test('ยังโหลดอยู่ (fetch ไม่ resolve) → ต้องไม่แสดง 0 ก่อนข้อมูลมา', async () => {
    setSession('SUPER_ADMIN');
    // overview ค้างตลอดไป → ทุกการ์ดต้องอยู่ใน loading state ไม่ใช่ 0
    globalAny.fetch = async () => new Promise(() => {});
    const ui = await renderDashboard();
    const text = ui.text();
    assert(!text.includes('ไม่มีงานค้าง'), 'ระหว่าง loading ต้องไม่สรุปว่าไม่มีงานค้าง');
    assert(!text.includes('ค้างนานสุด'), 'ระหว่าง loading ต้องไม่แสดง hint ที่อ่านเป็นข้อมูลจริง');
    await ui.unmount();
  });

  await test('pending count มาจาก backend.total (250) — ไม่มีคำเตือน "จาก N ใบแรก" อีกต่อไป', async () => {
    setSession('SUPER_ADMIN');
    installFetch((url, init) => {
      if (url.includes('/admin/dashboard/overview')) {
        const body = overviewBody('SUPER_ADMIN');
        body.data.pending = {
          total: 250,
          overdueCount: 12,
          oldestSubmittedAt: Math.floor(Date.now() / 1000) - 20 * 86400,
          slaDays: 7,
          items: [
            { id: 'a1', applicationNo: 'APP-1', fullname: 'ก', status: 'SUBMITTED', submittedAt: Math.floor(Date.now() / 1000) - 86400 },
          ],
        };
        return { status: 200, body };
      }
      return { status: 404, body: {} };
    });
    const ui = await renderDashboard();
    const text = ui.text();
    assert(text.includes('250'), 'ต้องแสดง 250 จาก backend.total');
    assert(!text.includes('ใบแรก'), 'server aggregate จากชุดเต็ม — ต้องไม่มีคำเตือน subset');
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
