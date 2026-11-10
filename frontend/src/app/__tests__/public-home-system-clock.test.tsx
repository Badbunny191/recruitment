// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Public home page — "เวลาระบบ" ใต้ countdown (component-level)
 * =====================================================================
 * รัน component จริง (app/(public)/page.tsx) บน happy-dom พิสูจน์ว่า:
 *
 *   C1: เหลือ ~45 นาที + มี serverTime → แสดง "เวลาระบบ HH:MM น." (ไม่มีวินาที)
 *       และ countdown เดิมยังแสดง (regression)
 *   C2: เหลือ ~3 นาที → "เวลาระบบ HH:MM:SS น." (ระดับวินาที)
 *   C3: เหลือ ~5 ชั่วโมง → ไม่แสดงนาฬิกา (แสดงผลเหมือนเดิม)
 *   C4: รอบปิดแล้ว → ไม่มีนาฬิกา
 *   C5: payload ไม่มี serverTime (fallback) → ไม่แสดงนาฬิกา แม้เหลือ <1 ชม.
 *       (กันแสดงเวลาเครื่องผู้ใช้แล้วติดป้าย "เวลาระบบ")
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/app/__tests__/public-home-system-clock.test.tsx
 */

// ---------- happy-dom environment — ต้องตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch { /* Node 24 navigator is getter-only */ }
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.localStorage = win.localStorage;
globalAny.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

// ---------- Next.js module stubs ----------
import Module from 'module';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request === 'next/link') {
    const Link = React.forwardRef((props: any, ref: any) => {
      const { href, children, ...rest2 } = props;
      return React.createElement('a', { ...rest2, href, ref }, children);
    });
    return { __esModule: true, default: Link };
  }
  if (request === 'next/navigation') {
    return {
      useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
      usePathname: () => '/',
      useSearchParams: () => new URLSearchParams(),
    };
  }
  return origLoad.call(this, request, ...rest);
};

// ---------- imports ----------
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// =============================================================================
// Harness (แบบเดียวกับ public-home-staleness.test.tsx)
// =============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  FAIL ${name}: ${e?.message ?? e}`);
  }
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertFalse(cond: any, msg: string) {
  if (cond) throw new Error(msg);
}

const MINUTE = 60 * 1000;

// ---------- fetch stub ----------
function installFetch(handler: (url: string, callIndex: number) => any) {
  const calls: string[] = [];
  globalAny.fetch = async (url: string) => {
    const u = String(url);
    calls.push(u);
    const handled = await handler(u, calls.length - 1);
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

// ---------- round fixtures ----------
function roundFixture(id: string, openMs: number, closeMs: number) {
  return {
    id,
    title: `รอบ ${id}`,
    positionLevel: 'ปฏิบัติการ',
    openDate: new Date(openMs).toISOString(),
    closeDate: new Date(closeMs).toISOString(),
    status: 'ACTIVE',
    deletedAt: null,
    roundCode: id.toUpperCase(),
  };
}

/** body ของ GET /public/rounds/active — serverTime ใส่/ไม่ใส่ได้ (ทดสอบ fallback) */
function payloadBody(groups: { open?: any[]; upcoming?: any[]; closed?: any[] }, withServerTime = true) {
  const body: any = {
    data: groups.open ?? [],
    groups: {
      open: groups.open ?? [],
      upcoming: groups.upcoming ?? [],
      closed: groups.closed ?? [],
    },
  };
  if (withServerTime) body.serverTime = Date.now();
  return body;
}

// ---------- render helper ----------
async function renderHome() {
  const mod = await import('../(public)/page');
  const HomePage = mod.default;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(React.createElement(HomePage));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
  return {
    text: () => (container.textContent || ''),
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

void (async () => {

await test('C1: เหลือ ~45 นาที + serverTime → เวลาระบบ HH:MM (ไม่มีวินาที) + countdown เดิมยังอยู่', async () => {
  const closeMs = Date.now() + 45 * MINUTE;
  installFetch(() => ({ status: 200, body: payloadBody({ open: [roundFixture('r45', Date.now() - 60 * MINUTE, closeMs)] }) }));
  const view = await renderHome();
  try {
    const t = view.text();
    assert(/เวลาระบบ \d{2}:\d{2}\u00A0น\./.test(t), `expected "เวลาระบบ HH:MM น." in: ${t.slice(0, 400)}`);
    assertFalse(/\d{2}:\d{2}:\d{2}\u00A0น\./.test(t), 'HH:MM window must NOT show seconds');
    assert(t.includes('เหลือเวลาสมัครอีก'), 'countdown must still render (regression)');
  } finally {
    await view.unmount();
  }
});

await test('C2: เหลือ ~3 นาที → เวลาระบบ HH:MM:SS (ระดับวินาที)', async () => {
  const closeMs = Date.now() + 3 * MINUTE;
  installFetch(() => ({ status: 200, body: payloadBody({ open: [roundFixture('r3', Date.now() - 60 * MINUTE, closeMs)] }) }));
  const view = await renderHome();
  try {
    const t = view.text();
    assert(/เวลาระบบ \d{2}:\d{2}:\d{2}\u00A0น\./.test(t), `expected seconds clock in: ${t.slice(0, 400)}`);
  } finally {
    await view.unmount();
  }
});

await test('C3: เหลือ ~5 ชั่วโมง → ไม่แสดงนาฬิกา (แสดงผลเหมือนเดิม)', async () => {
  const closeMs = Date.now() + 5 * 60 * MINUTE;
  installFetch(() => ({ status: 200, body: payloadBody({ open: [roundFixture('r5h', Date.now() - 60 * MINUTE, closeMs)] }) }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), `clock must be hidden: ${t.slice(0, 400)}`);
    assert(t.includes('เหลือเวลาสมัครอีก'), 'countdown must still render');
  } finally {
    await view.unmount();
  }
});

await test('C4: รอบปิดแล้ว → ไม่มีนาฬิกา', async () => {
  const closeMs = Date.now() - 2 * 24 * 60 * MINUTE;
  installFetch(() => ({ status: 200, body: payloadBody({ closed: [roundFixture('rclosed', Date.now() - 9 * 24 * 60 * MINUTE, closeMs)] }) }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), 'closed round must NOT show clock');
  } finally {
    await view.unmount();
  }
});

await test('C5: payload ไม่มี serverTime (fallback) → ไม่แสดงนาฬิกา แม้เหลือ <1 ชม.', async () => {
  const closeMs = Date.now() + 45 * MINUTE;
  installFetch(() => ({ status: 200, body: payloadBody({ open: [roundFixture('rnof', Date.now() - 60 * MINUTE, closeMs)] }, false) }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), 'fallback (no serverTime) must NOT show clock');
    assert(t.includes('เหลือเวลาสมัครอีก'), 'countdown must still render');
  } finally {
    await view.unmount();
  }
});

// ========== SUMMARY ==========

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
if (failed > 0) {
  (globalThis as any).process.exit(1);
}

})();
