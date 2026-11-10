// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Public home page — badge staleness + countdown (component-level)
 * =======================================================================
 *
 * เทสนี้รัน **component จริง** (`app/(public)/page.tsx`) บน happy-dom
 * ไม่ใช่แค่ helper — เพื่อพิสูจน์ว่าอาการที่ผู้ใช้เห็นหายจริง:
 *
 *   S1 (fail-when-no-fix): เปิดหน้าไว้ รอบปิดไปแล้ว → กลับเข้าแท็บ
 *      ต้องมี fetch ครั้งที่ 2 (เดิม: fetch ครั้งเดียวตลอดชีวิตของหน้า)
 *   S2: หลัง refetch ที่บอกว่าปิดแล้ว → badge เปลี่ยนเป็น "ปิดรับสมัครแล้ว"
 *      และไม่มีการ์ด "กำลังเปิดรับสมัคร 1 รอบ" ค้างอยู่
 *   S3: ระหว่างที่ยังไม่ refetch (snapshot เก่า) แต่เลย closeDate แล้ว
 *      → หน้าไม่แสดง "กำลังเปิดรับสมัคร N รอบ" (badge ต้องไม่โกหก)
 *   S4: countdown ในช่วง 5 นาทีสุดท้ายแสดงวินาทีจริง
 *   S5: ปิดแล้ว → "ปิดรับสมัครแล้ว" ไม่ใช่ "น้อยกว่า 1 นาที"
 *   S6: focus event ก็ trigger refetch (ไม่ใช่แค่ visibilitychange)
 *   S7: throttle — focus + visibilitychange ติดกันใน 15 วิ → fetch ครั้งเดียว
 *   S8: refetch ที่ล้มเหลว (network) ไม่ลบข้อมูลที่แสดงอยู่ (silent refresh)
 *   S9: ไม่มี polling — ปล่อยเวลาไป 60 วิ โดยไม่มี event/deadline → ไม่มี fetch เพิ่ม
 *
 * Run: node --import tsx --tsconfig tsconfig.test.json \
 *        src/app/__tests__/public-home-staleness.test.tsx
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
// Harness
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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const BKK = 7 * 60 * 60 * 1000;
function bkk(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min) - BKK;
}

// ---------- fetch stub ----------
interface FetchCall { url: string }

function installFetch(handler: (url: string, callIndex: number) => any) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string) => {
    const u = String(url);
    const idx = calls.length;
    calls.push({ url: u });
    const handled = await handler(u, idx);
    if (handled === 'PENDING') return new Promise(() => {});
    if (handled === 'REJECT') throw new Error('network down');
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
function roundFixture(id: string, title: string, openMs: number, closeMs: number) {
  return {
    id,
    title,
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
    settle: async (ms = 120) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    },
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

/** จำลอง "กลับเข้าแท็บ" */
async function fireVisibilityVisible() {
  Object.defineProperty(win.document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => {
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 120));
  });
}

/** จำลอง "หน้าต่างได้ focus" */
async function fireFocus() {
  await act(async () => {
    win.dispatchEvent(new win.Event('focus'));
    await new Promise((r) => setTimeout(r, 120));
  });
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n=== Public home: badge staleness + countdown ===\n');

  // ── S1: refetch on visibilitychange ────────────────────────────────
  await test('S1 (fail-when-no-fix): กลับเข้าแท็บหลังรอบปิด → มี fetch ครั้งที่ 2', async () => {
    const closeMs = Date.now() - 60_000; // ปิดไปแล้ว 1 นาที
    const calls = installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบที่ปิดแล้ว', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    assertEqual(calls.length, 1, 'ตอน mount ต้อง fetch 1 ครั้ง');

    // เดินเวลาให้พ้น throttle 15 วิ
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    offset += 20_000;

    await fireVisibilityVisible();
    Date.now = realNow;

    assertEqual(calls.length, 2, 'ต้องมี fetch ครั้งที่ 2 (เดิมไม่มีเลยตลอดชีวิตของหน้า)');
    await view.unmount();
  });

  // ── S2: badge flips to closed after refetch ────────────────────────
  await test('S2: หลัง refetch ที่บอกว่าปิดแล้ว → badge เป็น "ปิดรับสมัครแล้ว"', async () => {
    const closeMs = Date.now() - 60_000;
    const calls = installFetch((_u, idx) => {
      if (idx === 0) {
        // snapshot แรก: ยังบอกว่าเปิด (ข้อมูลเก่า)
        return { status: 200, body: payloadBody({ open: [roundFixture('r1', 'รอบทดสอบ S2', bkk(2026, 11, 1), closeMs)] }) };
      }
      // หลัง refetch: backend บอกว่าปิดแล้ว
      return { status: 200, body: payloadBody({ closed: [roundFixture('r1', 'รอบทดสอบ S2', bkk(2026, 11, 1), closeMs)] }) };
    });

    const view = await renderHome();

    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    offset += 20_000;
    await fireVisibilityVisible();
    Date.now = realNow;
    await view.settle();

    assertEqual(calls.length, 2, 'ต้อง refetch');
    const text = view.text();
    assert(!text.includes('กำลังเปิดรับสมัคร 1 รอบ'), `ต้องไม่มีการ์ดเปิดรับสมัครค้าง: ${text.slice(0, 200)}`);
    assert(text.includes('ปิดรับสมัครแล้ว'), `ต้องแสดง "ปิดรับสมัครแล้ว": ${text.slice(0, 300)}`);
    await view.unmount();
  });

  // ── S3: stale snapshot must not claim open ─────────────────────────
  await test('S3 (fail-when-no-fix): snapshot ยังเก่าแต่เลย closeDate → ไม่บอก "กำลังเปิดรับสมัคร 1 รอบ"', async () => {
    const closeMs = Date.now() - 60_000;
    installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบที่ปิดแล้ว S3', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    const text = view.text();

    assert(
      !text.includes('กำลังเปิดรับสมัคร 1 รอบ'),
      `badge ต้องไม่โกหกว่ากำลังเปิด: ${text.slice(0, 300)}`,
    );
    assert(
      text.includes('ปิดรับสมัครแล้ว'),
      `ต้องบอกว่าปิดแล้ว: ${text.slice(0, 300)}`,
    );
    await view.unmount();
  });

  // ── S4: countdown shows seconds in final 5 minutes ─────────────────
  await test('S4: เหลือ 4 นาที 52 วินาที → แสดงวินาทีจริง', async () => {
    const closeMs = Date.now() + (4 * 60 + 52) * 1000;
    installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบใกล้ปิด S4', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    const text = view.text();

    assert(
      /\d+ นาที \d+ วินาที/.test(text),
      `ต้องเห็นรูปแบบ "N นาที N วินาที": ${text.slice(0, 400)}`,
    );
    assert(
      !text.includes('น้อยกว่า 1 นาที'),
      `ต้องไม่เหลือข้อความเดิม: ${text.slice(0, 400)}`,
    );
    await view.unmount();
  });

  // ── S5: closed shows explicit text ─────────────────────────────────
  await test('S5: ปิดแล้ว → "ปิดรับสมัครแล้ว" ไม่ใช่ "น้อยกว่า 1 นาที"', async () => {
    const closeMs = Date.now() - 5_000;
    installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบปิด S5', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    const text = view.text();
    assert(text.includes('ปิดรับสมัครแล้ว'), `ต้องมีข้อความปิดรับสมัครแล้ว: ${text.slice(0, 300)}`);
    assert(!text.includes('น้อยกว่า 1 นาที'), 'ต้องไม่มีข้อความเดิม');
    await view.unmount();
  });

  // ── S6: focus also triggers refetch ────────────────────────────────
  await test('S6: focus event ก็ trigger refetch (ไม่ใช่แค่ visibilitychange)', async () => {
    const closeMs = Date.now() + 60 * 60_000;
    const calls = installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบ S6', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    assertEqual(calls.length, 1, 'mount = 1');

    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    offset += 20_000;
    await fireFocus();
    Date.now = realNow;

    assertEqual(calls.length, 2, 'focus ต้อง trigger refetch');
    await view.unmount();
  });

  // ── S7: throttle ───────────────────────────────────────────────────
  await test('S7: focus + visibilitychange ติดกันภายใน 15 วิ → fetch ครั้งเดียว', async () => {
    const closeMs = Date.now() + 60 * 60_000;
    const calls = installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบ S7', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    assertEqual(calls.length, 1, 'mount = 1');

    // ยังไม่พ้น throttle → ทั้งสอง event ต้องไม่ยิง
    await fireVisibilityVisible();
    await fireFocus();
    assertEqual(calls.length, 1, 'ต้องถูก throttle');

    // พ้น throttle แล้ว → ยิงได้ 1 ครั้ง
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    offset += 20_000;
    await fireVisibilityVisible();
    await fireFocus();
    Date.now = realNow;

    assertEqual(calls.length, 2, 'พ้น throttle แล้วยิงได้ครั้งเดียว (ไม่ใช่สอง)');
    await view.unmount();
  });

  // ── S8: silent refresh failure keeps data ──────────────────────────
  await test('S8: refetch ล้มเหลว → ไม่ลบข้อมูลที่แสดงอยู่ และไม่ขึ้น error state', async () => {
    const closeMs = Date.now() + 60 * 60_000;
    installFetch((_u, idx) => {
      if (idx === 0) {
        return { status: 200, body: payloadBody({ open: [roundFixture('r1', 'รอบ S8', bkk(2026, 11, 1), closeMs)] }) };
      }
      return 'REJECT';
    });

    const view = await renderHome();
    assert(view.text().includes('รอบ S8'), 'ต้องแสดงข้อมูลรอบก่อน');

    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    offset += 20_000;
    await fireVisibilityVisible();
    Date.now = realNow;
    await view.settle();

    const text = view.text();
    assert(text.includes('รอบ S8'), `ข้อมูลเดิมต้องยังอยู่: ${text.slice(0, 300)}`);
    assert(
      !text.includes('โหลดข้อมูลรอบรับสมัครไม่สำเร็จ'),
      'silent refresh ที่ล้มเหลวต้องไม่ทับด้วย error state',
    );
    await view.unmount();
  });

  // ── S9: no polling ─────────────────────────────────────────────────
  await test('S9: ไม่มี polling — ไม่มี event และ deadline ไกล → ไม่มี fetch เพิ่ม', async () => {
    const closeMs = Date.now() + 6 * 60 * 60_000; // อีก 6 ชั่วโมง
    const calls = installFetch(() => ({
      status: 200,
      body: payloadBody({ open: [roundFixture('r1', 'รอบ S9', bkk(2026, 11, 1), closeMs)] }),
    }));

    const view = await renderHome();
    assertEqual(calls.length, 1, 'mount = 1');

    // เดินเวลา 60 วิจริง ๆ (tick เดิน แต่ไม่มี network)
    await view.settle(1_000);
    assertEqual(calls.length, 1, 'ห้ามมี polling — ต้องไม่มี fetch เพิ่มเลย');
    await view.unmount();
  });

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n=== Public home: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILED TESTS:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
