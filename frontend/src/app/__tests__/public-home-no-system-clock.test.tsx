// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Public home page — regression: ห้ามแสดง "เวลาระบบ" ทุกช่วงเวลา
 * =====================================================================
 * Decision 2026-11-11: ผู้สมัครสนใจ "เหลือเวลาอีกเท่าไร" มากกว่า
 * "ตอนนี้กี่โมง" — เวลาระบบถูกถอนออกจากหน้าแรกทั้งหมด (คงเหลือเฉพาะ
 * countdown เดิม) test นี้พิสูจน์ว่า:
 *
 *   N1: เหลือ > 1 ชั่วโมง  → ไม่มี "เวลาระบบ" + countdown เดิมครบ
 *   N2: เหลือ < 1 ชั่วโมง  → ไม่มี "เวลาระบบ" + countdown เดิมครบ
 *   N3: เหลือ < 5 นาที     → ไม่มี "เวลาระบบ" (วินาทีอยู่ใน countdown เดิม)
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/app/__tests__/public-home-no-system-clock.test.tsx
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
  globalAny.fetch = async (url: string) => {
    const handled = await handler(String(url), 0);
    const { status, body } = handled;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() { return this; },
    };
  };
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

function payloadBody(groups: { open?: any[]; upcoming?: any[]; closed?: any[] }) {
  return {
    data: groups.open ?? [],
    groups: {
      open: groups.open ?? [],
      upcoming: groups.upcoming ?? [],
      closed: groups.closed ?? [],
    },
    serverTime: Date.now(),
  };
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

await test('N1: เหลือ ~5 ชั่วโมง → ไม่มี "เวลาระบบ" + countdown เดิมครบ', async () => {
  installFetch(() => ({
    status: 200,
    body: payloadBody({ open: [roundFixture('r5h', Date.now() - 60 * MINUTE, Date.now() + 5 * 60 * MINUTE)] }),
  }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), 'clock must NOT appear (remaining > 1 hr)');
    assert(t.includes('เหลือเวลาสมัครอีก'), 'countdown must still render');
  } finally {
    await view.unmount();
  }
});

await test('N2: เหลือ ~45 นาที → ไม่มี "เวลาระบบ" + countdown เดิมครบ', async () => {
  installFetch(() => ({
    status: 200,
    body: payloadBody({ open: [roundFixture('r45', Date.now() - 60 * MINUTE, Date.now() + 45 * MINUTE)] }),
  }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), 'clock must NOT appear (remaining < 1 hr)');
    assertFalse(/\d{2}:\d{2}:\d{2}\u00A0น\./.test(t), 'no HH:MM:SS clock anywhere on home');
    assert(t.includes('เหลือเวลาสมัครอีก'), 'countdown must still render');
  } finally {
    await view.unmount();
  }
});

await test('N3: เหลือ ~3 นาที → ไม่มี "เวลาระบบ" (วินาทีอยู่ใน countdown เดิม)', async () => {
  installFetch(() => ({
    status: 200,
    body: payloadBody({ open: [roundFixture('r3', Date.now() - 60 * MINUTE, Date.now() + 3 * MINUTE)] }),
  }));
  const view = await renderHome();
  try {
    const t = view.text();
    assertFalse(/เวลาระบบ \d/.test(t), 'clock must NOT appear (remaining < 5 min)');
    assert(/เหลือเวลาสมัครอีก/.test(t) && /\d+ วินาที/.test(t), 'seconds countdown must still render');
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
