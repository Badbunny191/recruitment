// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Public home page — กติกาการจัดการ์ดรอบ (component-level)
 * =======================================================================
 *
 * เทสนี้รัน **component จริง** (`app/(public)/page.tsx`) บน happy-dom
 * เพื่อพิสูจน์ผังการ์ดตามกฎใหม่:
 *
 *   C1: 1 รอบ → การ์ดเดียวถูกครอบ div mx-auto w-full max-w-3xl
 *       (ไม่มี md:col-span-2 เพราะกริดเป็นคอลัมน์เดียว) และกริดไม่มี
 *       md:grid-cols-2
 *   C2: 2 รอบ → grid 2 คอลัมน์, การ์ดเป็นลูกกริดตรง ๆ (ไม่มี wrapper)
 *   C3: 3 รอบ → ใบแรก/ใบที่ 2 ตรง, ใบสุดท้ายถูกครอบ wrapper ที่มี
 *       md:col-span-2 + ความกว้างเท่าคอลัมน์ปกติ (calc((100%_-_20px)/2))
 *       — กึ่งกลางแต่ "ห้ามขยายขนาด" (ไม่มี max-w-3xl)
 *   C4: 4 รอบ → ทุกใบตรง (grid เต็มแถว)
 *   C5: 5 รอบ → 4 ใบแรกตรง, ใบสุดท้ายกึ่งกลางไม่ขยายขนาด (กฎเดียวกับ C3)
 *   C6: 6 รอบ (เลขคู่) → ทุกใบตรง — กัน over-fitting กฎเลขคี่
 *   C7: "กำหนดเปิดรับสมัคร" 1 รอบ → ใช้กฎเดียวกัน (wrapper max-w-3xl)
 *
 * Run: node --import tsx --tsconfig tsconfig.test.json \
 *        src/app/__tests__/public-home-card-centering.test.tsx
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
globalAny.CustomEvent = win.Event;
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

function bkk(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min) - 7 * 60 * 60 * 1000;
}

// ---------- fetch stub ----------
function installFetch(body: any) {
  globalAny.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    clone() { return this; },
  });
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

/** รอบเปิดรับสมัคร — เปิดไปแล้ว 1 วัน, ปิดอีก 7 วัน (phase OPEN เสมอ) */
function openRound(id: string, title: string) {
  return roundFixture(id, title, Date.now() - 24 * 3600 * 1000, Date.now() + 7 * 3600 * 1000);
}

/** รอบจะเปิด — เปิดอีก 3 วัน, ปิดอีก 30 วัน (phase UPCOMING เสมอ) */
function upcomingRound(id: string, title: string) {
  return roundFixture(id, title, Date.now() + 3 * 24 * 3600 * 1000, Date.now() + 30 * 24 * 3600 * 1000);
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
    container,
    text: () => (container.textContent || ''),
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

// ---------- DOM inspectors ----------
function sectionGrid(container: any, labelledBy: string): any {
  const section = container.querySelector(`[aria-labelledby="${labelledBy}"]`);
  assert(section, `ไม่พบ section ${labelledBy}`);
  const grid = Array.from(section.children).find((el: any) =>
    typeof el.className === 'string' && el.className.includes('grid'));
  assert(grid, `ไม่พบกริดการ์ดใน ${labelledBy}`);
  return grid;
}

/** ตรวจโครงลูกของกริด: บิตแรก ๆ เป็น article ตรง, ใบสุดท้ายตามที่คาด */
function inspectGrid(grid: any) {
  const children = Array.from(grid.children) as any[];
  const directArticles = children.filter((el) => el.tagName === 'ARTICLE');
  const wrappers = children.filter(
    (el) => el.tagName === 'DIV' && el.firstElementChild && el.firstElementChild.tagName === 'ARTICLE',
  );
  return { children, directArticles, wrappers };
}

function assertHasClass(el: any, cls: string, msg: string) {
  assert(
    typeof el.className === 'string' && el.className.split(/\s+/).includes(cls),
    `${msg} — ต้องมี class "${cls}" (มีจริง: ${JSON.stringify(el.className)})`,
  );
}

function assertNotHasClass(el: any, cls: string, msg: string) {
  assert(
    !(typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)),
    `${msg} — ต้องไม่มี class "${cls}" (มีจริง: ${JSON.stringify(el.className)})`,
  );
}

/** เคสจำนวน n: ตรวจกริด open-rounds ให้ตรงกติกา (n คี่ → ใบสุดท้ายครอบ wrapper) */
async function assertOpenGridForCount(n: number, labels: string[]) {
  installFetch(payloadBody({ open: labels.map((t) => openRound(`r${t.length}-${labels.indexOf(t)}`, t)) }));

  const view = await renderHome();
  try {
    assert(
      view.text().includes(`กำลังเปิดรับสมัคร ${n} รอบ`),
      `หัวข้อต้องบอกจำนวน ${n} รอบ`,
    );

    const grid = sectionGrid(view.container, 'open-rounds-heading');
    const { children, directArticles, wrappers } = inspectGrid(grid);
    assertEqual(children.length, n, `จำนวนลูกของกริดต้องเป็น ${n}`);

    if (n % 2 === 1) {
      // เลขคี่: ใบสุดท้ายถูกครอบ wrapper — ที่เหลือตรง
      assertEqual(directArticles.length, n - 1, `(${n} รอบ) การ์ดที่เป็นลูกกริดตรงต้องมี ${n - 1}`);
      assertEqual(wrappers.length, 1, `(${n} รอบ) ต้องมี wrapper กึ่งกลาง 1 อัน (เฉพาะใบสุดท้าย)`);
      const w = wrappers[0];
      assertHasClass(w, 'mx-auto', `(${n} รอบ) wrapper ใบสุดท้าย`);
      if (n > 1) {
        // กึ่งกลางแต่ "ห้ามขยายขนาด" — กว้างเท่าคอลัมน์ปกติทุกประการ
        assertHasClass(w, 'md:col-span-2', `(${n} รอบ) wrapper ใบสุดท้ายต้องกินแถวเต็มจึงกึ่งกลางได้`);
        assertHasClass(
          w,
          'md:w-[calc((100%_-_20px)/2)]',
          `(${n} รอบ) ความกว้างต้องเท่าคอลัมน์ปกติพอดี (1fr ของกริด gap-5)`,
        );
        assertNotHasClass(w, 'max-w-3xl', `(${n} รอบ) ห้ามขยายขนาด — ต้องไม่มี max-w-3xl`);
      } else {
        assertHasClass(w, 'max-w-3xl', '(1 รอบ) wrapper การ์ดเดียว');
        assertNotHasClass(w, 'md:col-span-2', '(1 รอบ) กริดคอลัมน์เดียว ห้ามมี md:col-span-2');
      }
      // ใบที่ครอบต้องเป็นการ์ดใบสุดท้ายจริง
      const wrappedTitle = w.querySelector('article')?.textContent || '';
      assert(wrappedTitle.includes(labels[n - 1]), `(${n} รอบ) ใบที่ครอบต้องเป็นการ์ดใบสุดท้าย`);
    } else {
      // เลขคู่: ทุกใบเป็นลูกกริดตรง ๆ — เหมือนเดิมทุกไบต์
      assertEqual(directArticles.length, n, `(${n} รอบ) ทุกการ์ดต้องเป็นลูกกริดตรง`);
      assertEqual(wrappers.length, 0, `(${n} รอบ) เลขคู่ห้ามมี wrapper`);
      assertEqual(grid.className.includes('md:grid-cols-2'), true, `(${n} รอบ) ต้องเป็นกริด 2 คอลัมน์`);
    }

    if (n === 1) {
      assertEqual(grid.className.includes('md:grid-cols-2'), false, '(1 รอบ) กริดต้องเป็นคอลัมน์เดียว');
    }
  } finally {
    await view.unmount();
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n=== Public home: card centering layout rules ===\n');

  // ── C1: 1 รอบ → การ์ดเดียวกึ่งกลาง (max-w-3xl, mx-auto) ───────────
  await test('C1: 1 รอบ → การ์ดเดียวถูกครอบ div mx-auto max-w-3xl (ไม่มี md:col-span-2)', async () => {
    await assertOpenGridForCount(1, ['รอบเดียว']);
  });

  // ── C2: 2 รอบ → grid 2 คอลัมน์ตามเดิม ─────────────────────────────
  await test('C2: 2 รอบ → ทุกการ์ดเป็นลูกกริดตรง (ไม่มี wrapper)', async () => {
    await assertOpenGridForCount(2, ['รอบหนึ่ง', 'รอบสอง']);
  });

  // ── C3: 3 รอบ → ใบสุดท้ายกึ่งกลาง ไม่ขยายขนาด ──────────────────────
  await test('C3: 3 รอบ → 2 ใบแรกตรง, ใบสุดท้ายกึ่งกลางความกว้างเท่าคอลัมน์ปกติ', async () => {
    await assertOpenGridForCount(3, ['รอบหนึ่ง', 'รอบสอง', 'รอบสาม']);
  });

  // ── C4: 4 รอบ → grid 2x2 ปกติ ─────────────────────────────────────
  await test('C4: 4 รอบ → ทุกการ์ดเป็นลูกกริดตรง (2x2 เต็มแถว)', async () => {
    await assertOpenGridForCount(4, ['ก', 'ข', 'ค', 'ง']);
  });

  // ── C5: 5 รอบ → แถวสุดท้าย 1 ใบกึ่งกลาง ไม่ขยายขนาด ────────────────
  await test('C5: 5 รอบ → 4 ใบแรกตรง, ใบสุดท้ายกึ่งกลางความกว้างเท่าคอลัมน์ปกติ', async () => {
    await assertOpenGridForCount(5, ['ก', 'ข', 'ค', 'ง', 'จ']);
  });

  // ── C6: 6 รอบ (เลขคู่) → ไม่มี wrapper แม้ใบสุดท้าย ────────────────
  await test('C6: 6 รอบ → ทุกการ์ดเป็นลูกกริดตรง (กฎเฉพาะเลขคี่)', async () => {
    await assertOpenGridForCount(6, ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ']);
  });

  // ── C7: upcoming 1 รอบ → กฎเดียวกัน ────────────────────────────────
  await test('C7: "กำหนดเปิดรับสมัคร" 1 รอบ → ใช้กฎกึ่งกลางเดียวกัน', async () => {
    installFetch(payloadBody({ upcoming: [upcomingRound('u1', 'รอบจะเปิด')] }));

    const view = await renderHome();
    try {
      assert(view.text().includes('กำหนดเปิดรับสมัคร'), 'ต้องมี section กำหนดเปิดรับสมัคร');

      const grid = sectionGrid(view.container, 'upcoming-rounds-heading');
      const { children, directArticles, wrappers } = inspectGrid(grid);
      assertEqual(children.length, 1, 'ลูกกริดต้องมี 1');
      assertEqual(directArticles.length, 0, 'ต้องไม่มี article ตรง');
      assertEqual(wrappers.length, 1, 'ต้องครอบด้วย wrapper กึ่งกลาง');
      assertHasClass(wrappers[0], 'mx-auto', 'wrapper upcoming');
      assertHasClass(wrappers[0], 'max-w-3xl', 'wrapper upcoming');
      assertNotHasClass(wrappers[0], 'md:col-span-2', 'กริดคอลัมน์เดียว ห้ามมี md:col-span-2');
      assertEqual(grid.className.includes('md:grid-cols-2'), false, '1 รอบกริดต้องเป็นคอลัมน์เดียว');
    } finally {
      await view.unmount();
    }
  });

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n=== Public home card centering: ${passed} passed, ${failed} failed ===\n`);
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
