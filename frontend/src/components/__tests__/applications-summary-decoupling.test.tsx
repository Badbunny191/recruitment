// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Applications page — Summary Decoupling Tests (Phase 1.2)
 * =======================================================
 * พิสูจน์ว่า summary (ตัวเลข KPI) แยกจาก list (แถวของตาราง) จริง
 *
 * สัญญาที่ต้องเป็นจริง:
 *   1. summary ไม่ refetch เมื่อ page เปลี่ยน
 *   2. summary ไม่ refetch เมื่อ search เปลี่ยน
 *   3. summary ไม่ refetch เมื่อ sort เปลี่ยน
 *   4. summary refetch เมื่อ round เปลี่ยน
 *   5. ตาราง render ได้แม้ summary ยังโหลด (ไม่ถูก gate)
 *   6. KPI loading state ถูกต้อง (skeleton เฉพาะตอน summary ยังไม่มา)
 *
 * วิธีนับ: นับ "network call จริง" จาก fetch stub (URL-based) ไม่ใช่ state ภายใน
 * component — เทสจึงไม่ผูกกับชื่อ state และจับ regression ได้ตรงจุด
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/applications-summary-decoupling.test.tsx
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
// Fetch stub — นับ call แยกตามชนิด endpoint
// =============================================================================

const SUMMARY_MARK = '/admin/applications/summary';

function isSummary(url: string) { return url.includes(SUMMARY_MARK); }
function isList(url: string) { return url.includes('/admin/applications?'); }
function isRounds(url: string) { return url.includes('/admin/rounds'); }

interface FetchCall { url: string }

/**
 * handler คืน:
 *   { status, body }  → ตอบปกติ
 *   'PENDING'         → request ค้างตลอดไป (จำลอง summary ที่ช้า/ไม่กลับ)
 */
function installFetch(handler: (url: string, init: any) => any) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u });
    const handled = await handler(u, init);
    if (handled === 'PENDING') return new Promise(() => {});
    const { status, body } = handled;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() { return this; },
    };
  };
  return {
    calls,
    summaryCalls: () => calls.filter((c) => isSummary(c.url)),
    listCalls: () => calls.filter((c) => isList(c.url)),
    roundsCalls: () => calls.filter((c) => isRounds(c.url)),
  };
}

const ROUND_1 = { id: 'round-1', title: 'รอบทดสอบหนึ่ง', status: 'ACTIVE', deletedAt: null, roundCode: 'CHM01' };
const ROUND_2 = { id: 'round-2', title: 'รอบทดสอบสอง', status: 'ACTIVE', deletedAt: null, roundCode: 'CHM02' };

function makeRow(id: string, no: string) {
  return {
    id,
    applicationNo: no,
    fullname: `ผู้สมัคร ${no}`,
    email: `${id}@example.com`,
    status: 'SUBMITTED',
    submittedAt: Math.floor(Date.now() / 1000),
    roundId: 'round-1',
  };
}

const ROW_1 = makeRow('app-1', 'APP-2026-0001');
const ROW_2 = makeRow('app-2', 'APP-2026-0002');

const SUMMARY_BODY = { data: { total: 42, byStatus: { SUBMITTED: 7, QUALIFIED: 20, REJECTED: 5, CANCELED: 4, ARCHIVED: 6 } } };

/** handler ครบทุก endpoint; summary/list/rounds ปรับได้ผ่าน opts */
function makeHandler(opts: {
  rounds?: any[];
  summary?: any;
  list?: any;
} = {}) {
  const rounds = opts.rounds ?? [ROUND_1, ROUND_2];
  return (url: string) => {
    if (isRounds(url)) return { status: 200, body: { data: rounds } };
    if (isSummary(url)) {
      return opts.summary === 'PENDING' ? 'PENDING' : { status: 200, body: opts.summary ?? SUMMARY_BODY };
    }
    if (isList(url)) {
      return {
        status: 200,
        body: opts.list ?? {
          data: [ROW_1, ROW_2],
          pagination: { page: 1, pageSize: 10, total: 42, totalPages: 5 },
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
  // ล้าง DOM ก่อนทุกครั้ง — ไม่งั้น container ของเทสก่อนหน้าค้างและ querySelectorAll
  // จะนับ KPI ของหลาย instance ปนกัน
  win.document.body.innerHTML = '';
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(React.createElement(ApplicationsClient));
  });
  await settle();
  return {
    container,
    text: () => (container.textContent || ''),
    settle,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** ให้ promise ของ fetch + debounce (300ms ของ SearchInput) ได้ settle */
async function settle(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function setSession(role = 'ADMIN') {
  win.location.href = 'http://localhost:3000/admin/applications';
  routerCalls.length = 0;
  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
}

// ---------- DOM helpers ----------

function allButtons(): any[] {
  return Array.from(win.document.querySelectorAll('button'));
}

/** กดปุ่มหมายเลขหน้าของ Pagination (ต้องตรงทั้ง label และคลาส w-9 ของปุ่มหน้า) */
async function clickPageNumber(page: number) {
  const btn = allButtons().find(
    (b) => (b.textContent || '').trim() === String(page) && (b.className || '').includes('w-9'),
  );
  assert(btn, `ไม่พบปุ่มหน้า ${page}`);
  await act(async () => { btn.click(); });
  await settle();
}

/**
 * ปุ่ม sort = ปุ่มที่ข้อความขึ้นต้นด้วย label ของ SortDropdown ("เรียงตาม")
 * หรือชื่อ option ที่เลือกอยู่ — ข้อความจริงมีลูกศรทิศทางต่อท้าย (เช่น "ล่าสุด↓")
 * จึงต้องเทียบแบบขึ้นต้น ไม่ใช่เท่ากันทั้งก้อน
 */
const SORT_LABELS = ['เรียงตาม', 'ล่าสุด', 'เก่าสุด', 'ชื่อ A-Z', 'ชื่อ Z-A'];

function findSortTrigger(): any {
  const btn = allButtons().find((b) => {
    const t = (b.textContent || '').trim();
    return SORT_LABELS.some((label) => t.startsWith(label));
  });
  assert(btn, `ไม่พบปุ่ม sort (มี: ${allButtons().map((b) => (b.textContent || '').trim()).join(' | ')})`);
  return btn;
}

/** เปลี่ยน page size ผ่าน native select ของ Pagination */
async function selectPageSize(size: number) {
  const select = win.document.querySelector('select') as any;
  assert(select, 'ต้องมี select ของ page size');
  const setter = Object.getOwnPropertyDescriptor(
    (win as any).HTMLSelectElement.prototype, 'value',
  )?.set;
  await act(async () => {
    setter?.call(select, String(size));
    select.dispatchEvent(new (win as any).Event('change', { bubbles: true }));
  });
  await settle();
}

/** เปิด round selector แล้วเลือกรอบตามชื่อ */
async function pickRound(title: string) {
  // ปุ่ม trigger = ปุ่มแรกที่มีชื่อรอบปัจจุบันหรือ "-- เลือกรอบ --"
  const trigger = allButtons().find((b) => {
    const t = (b.textContent || '');
    return t.includes('รอบทดสอบ') || t.includes('-- เลือกรอบ --');
  });
  assert(trigger, 'ต้องมีปุ่มเลือกокруг');
  await act(async () => { trigger.click(); });
  await settle();
  // ในลิสต์ dropdown มีปุ่มที่มีชื่อรอบเป้าหมาย
  const option = allButtons().find((b) => (b.textContent || '').includes(title));
  assert(option, `ต้องพบตัวเลือกรอบ "${title}"`);
  await act(async () => { option.click(); });
  await settle();
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n── Phase 1.2: summary decoupling ──');

  // ── 1. page เปลี่ยน → summary ต้องไม่ refetch ─────────────────────────────
  await test('summary ไม่ refetch เมื่อ page เปลี่ยน', async () => {
    setSession();
    const net = installFetch(makeHandler());
    const ui = await renderApplications();

    assertEqual(net.summaryCalls().length, 1, 'mount → summary 1 ครั้ง');
    const listBefore = net.listCalls().length;

    // total 42 / pageSize 10 = 5 หน้า → มีปุ่มหน้า 2
    await clickPageNumber(2);

    assert(net.listCalls().length > listBefore, 'การเปลี่ยนหน้าต้องยิง list ใหม่');
    assertEqual(net.summaryCalls().length, 1, 'เปลี่ยนหน้าแล้ว summary ต้องไม่ถูกยิงซ้ำ');
    await ui.unmount();
  });

  // ── 2. search เปลี่ยน → summary ต้องไม่ refetch ───────────────────────────
  // ⚠️ หมายเหตุเรื่องวิธีทดสอบ:
  //   ใน happy-dom ของโปรเจกต์นี้ React ไม่ dispatch onChange ของ <input type="text">
  //   จาก synthetic event (onInput ยิง แต่ onChange ไม่ยิง — พิสูจน์แล้วด้วย probe
  //   แยก: click/change ของ <select> ทำงานปกติ จึงไม่ใช่ปัญหาเรื่อง bubbling)
  //   การพิมพ์ผ่าน DOM จึงจำลองไม่ได้จริงใน harness นี้
  //   → พิสูจน์ข้อนี้ด้วย 2 ทางที่ตรวจได้จริงแทน:
  //     (2a) search ที่มาจาก URL (เส้นทาง hydrate จริงของหน้า) ไม่ทำให้ summary ยิงเพิ่ม
  //     (2b) dependency ของ effect summary ไม่มี search อยู่เลย (อ่านจาก source)
  await test('summary ไม่ refetch เมื่อ search เปลี่ยน (ผ่าน URL hydrate)', async () => {
    setSession();
    // โหลดหน้าพร้อม ?q= ใน URL — หน้า hydrate search จาก URL แล้วยิง list ด้วย search นั้น
    win.location.href = 'http://localhost:3000/admin/applications?q=สมชาย';
    const net = installFetch(makeHandler());
    const ui = await renderApplications();

    const list = net.listCalls();
    assert(list.length >= 1, 'ต้องยิง list อย่างน้อย 1 ครั้ง');
    assert(
      list[0].url.includes('search=') || list[0].url.includes('q='),
      `list ต้องยิงพร้อมเงื่อนไขค้นหา (ได้: ${list[0].url})`,
    );
    assertEqual(net.summaryCalls().length, 1, 'summary ต้องยิงครั้งเดียว ไม่สนใจ search');
    assert(
      !net.summaryCalls()[0].url.includes('search='),
      'summary ต้องไม่อิง search ใน URL เลย',
    );
    await ui.unmount();
  });

  await test('effect ของ summary ไม่มี search/sort/page/pageSize ใน dependency', async () => {
    // อ่าน source ตรง ๆ — requirement ข้อนี้เป็นเรื่อง "โครงสร้าง dependency"
    // ซึ่งตรวจได้แม่นกว่าการนับ network call
    const fs = await import('fs');
    const path = await import('path');
    const file = path.resolve(
      process.cwd(),
      'src/app/(admin)/admin/applications/ApplicationsClient.tsx',
    );
    const src = fs.readFileSync(file, 'utf8');

    // 1) fetchSummary ต้องขึ้นกับ selectedRoundId (+ API_URL) เท่านั้น
    const fetchSummaryDeps = src.match(/const fetchSummary = useCallback\([\s\S]*?\}, \[([^\]]*)\]\);/);
    assert(fetchSummaryDeps, 'ต้องพบ useCallback ของ fetchSummary');
    const deps = fetchSummaryDeps[1];
    assert(deps.includes('selectedRoundId'), 'fetchSummary ต้องขึ้นกับ selectedRoundId');
    for (const forbidden of ['search', 'statusFilter', 'sortId', 'currentPage', 'pageSize']) {
      assert(
        !new RegExp(`\\b${forbidden}\\b`).test(deps),
        `fetchSummary ต้องไม่ขึ้นกับ ${forbidden} (deps: ${deps})`,
      );
    }

    // 2) effect ที่เรียก fetchSummary ต้องมี dep แค่ fetchSummary
    const summaryEffect = src.match(/useEffect\(\(\) => \{\s*fetchSummary\(\);\s*\}, \[([^\]]*)\]\);/);
    assert(summaryEffect, 'ต้องพบ effect ที่เรียก fetchSummary');
    assertEqual(
      summaryEffect[1].trim(),
      'fetchSummary',
      'effect ของ summary ต้องขึ้นกับ fetchSummary ตัวเดียว',
    );
  });

  // ── 3. sort เปลี่ยน → summary ต้องไม่ refetch ─────────────────────────────
  await test('summary ไม่ refetch เมื่อ sort เปลี่ยน', async () => {
    setSession();
    const net = installFetch(makeHandler());
    const ui = await renderApplications();

    assertEqual(net.summaryCalls().length, 1, 'mount → summary 1 ครั้ง');
    const listBefore = net.listCalls().length;

    // เปิด SortDropdown แล้วเลือก "ชื่อ A-Z"
    const sortTrigger = findSortTrigger();
    await act(async () => { sortTrigger.click(); });
    await settle();
    const option = allButtons().find((b) => (b.textContent || '').trim().includes('ชื่อ A-Z'));
    assert(option, 'ต้องพบตัวเลือก sort "ชื่อ A-Z"');
    await act(async () => { option.click(); });
    await settle();

    assert(net.listCalls().length > listBefore, 'เปลี่ยน sort ต้องยิง list ใหม่');
    assertEqual(net.summaryCalls().length, 1, 'เปลี่ยน sort แล้ว summary ต้องไม่ถูกยิงซ้ำ');
    await ui.unmount();
  });

  // ── 3b. pageSize เปลี่ยน → summary ต้องไม่ refetch (โจทย์ระบุ pageSize ด้วย) ──
  await test('summary ไม่ refetch เมื่อ pageSize เปลี่ยน', async () => {
    setSession();
    const net = installFetch(makeHandler());
    const ui = await renderApplications();

    assertEqual(net.summaryCalls().length, 1, 'mount → summary 1 ครั้ง');
    const listBefore = net.listCalls().length;

    await selectPageSize(25);

    assert(net.listCalls().length > listBefore, 'เปลี่ยน pageSize ต้องยิง list ใหม่');
    assertEqual(net.summaryCalls().length, 1, 'เปลี่ยน pageSize แล้ว summary ต้องไม่ถูกยิงซ้ำ');
    await ui.unmount();
  });

  // ── 4. round เปลี่ยน → summary ต้อง refetch ───────────────────────────────
  await test('summary refetch เมื่อ round เปลี่ยน', async () => {
    setSession();
    const net = installFetch(makeHandler());
    const ui = await renderApplications();

    assertEqual(net.summaryCalls().length, 1, 'mount → summary 1 ครั้ง');

    await pickRound(ROUND_2.title);

    assertEqual(net.summaryCalls().length, 2, 'เปลี่ยนรอบ → summary ต้องยิงใหม่ 1 ครั้ง');
    const last = net.summaryCalls()[net.summaryCalls().length - 1].url;
    assert(last.includes('roundId=round-2'), `summary ต้องยิงด้วยรอบใหม่ (ได้: ${last})`);
    await ui.unmount();
  });

  // ── 5. ตาราง render ได้แม้ summary ยังโหลด ────────────────────────────────
  await test('table render ได้แม้ summary ยังโหลด', async () => {
    setSession();
    installFetch(makeHandler({ summary: 'PENDING' }));
    const ui = await renderApplications();

    const text = ui.text();
    assert(text.includes(ROW_1.applicationNo), 'ตารางต้องแสดงแถวได้แม้ summary ค้าง');
    assert(text.includes(ROW_2.applicationNo), 'ตารางต้องแสดงครบทุกแถวของหน้า');
    assert(!text.includes('กำลังโหลด...'), 'ตารางต้องไม่ค้าง spinner เพราะรอ summary');
    await ui.unmount();
  });

  // ── 6. KPI loading state ถูกต้อง ──────────────────────────────────────────
  await test('KPI แสดง skeleton ระหว่างรอ summary แล้วหายเมื่อข้อมูลมา', async () => {
    setSession();
    installFetch(makeHandler({ summary: 'PENDING' }));
    const ui = await renderApplications();

    const cards = Array.from(win.document.querySelectorAll('[data-testid="kpi-card"]'));
    assertEqual(cards.length, 6, 'ต้องมี KPI 6 ใบ');
    const skeletons = win.document.querySelectorAll('[data-testid="kpi-skeleton"]');
    assertEqual(skeletons.length, 6, 'summary ยังไม่มา → ทุกใบต้องเป็น skeleton');
    cards.forEach((c: any) => {
      assertEqual(c.getAttribute('data-kpi-loading'), 'true', 'การ์ดต้องบอกว่ากำลังโหลด');
    });
    // skeleton ต้องไม่โชว์เลข 0 ปลอม (ดูที่การ์ด KPI โดยตรง ไม่ใช่ทั้งหน้า
    // เพราะหน้าทั้งหน้ามี "0" จากที่อื่นได้ เช่น จำนวนที่เลือก)
    cards.forEach((c: any) => {
      const nums = (c.textContent || '').replace(/[^0-9]/g, '');
      assertEqual(nums, '', 'ระหว่างโหลดการ์ดต้องไม่โชว์ตัวเลขใด ๆ');
    });
    await ui.unmount();
  });

  await test('KPI แสดงตัวเลขจริงหลัง summary กลับมา (ไม่มี skeleton ค้าง)', async () => {
    setSession();
    installFetch(makeHandler());
    const ui = await renderApplications();

    const skeletons = win.document.querySelectorAll('[data-testid="kpi-skeleton"]');
    assertEqual(skeletons.length, 0, 'summary มาแล้ว → ต้องไม่มี skeleton เหลือ');
    const cards = Array.from(win.document.querySelectorAll('[data-testid="kpi-card"]'));
    assertEqual(cards.length, 6, 'ต้องมี KPI 6 ใบ');
    cards.forEach((c: any) => {
      assertEqual(c.getAttribute('data-kpi-loading'), 'false', 'การ์ดต้องบอกว่าโหลดเสร็จ');
    });
    const text = ui.text();
    assert(text.includes('42'), 'ต้องแสดงยอดรวมจาก summary (42)');
    assert(text.includes('20'), 'ต้องแสดงยอด QUALIFIED (20)');
    await ui.unmount();
  });

  await test('KPI loading ไม่ปนกับ loading ของตาราง (แยกกันจริง)', async () => {
    setSession();
    // list ค้าง แต่ summary กลับมาแล้ว → KPI ต้องโชว์เลข, ตารางยัง spinner
    installFetch((url) => {
      if (isRounds(url)) return { status: 200, body: { data: [ROUND_1] } };
      if (isSummary(url)) return { status: 200, body: SUMMARY_BODY };
      if (isList(url)) return 'PENDING';
      return { status: 404, body: {} };
    });
    const ui = await renderApplications();

    const skeletons = win.document.querySelectorAll('[data-testid="kpi-skeleton"]');
    assertEqual(skeletons.length, 0, 'summary มาแล้ว → KPI ต้องไม่ใช่ skeleton แม้ตารางยังโหลด');
    assert(ui.text().includes('42'), 'KPI ต้องแสดงตัวเลขแล้ว');
    assert(ui.text().includes('กำลังโหลด...'), 'ตารางยังต้องแสดง spinner ของตัวเอง');
    await ui.unmount();
  });

  // ── 7. summary 500 → KPI error, table ยังใช้งานได้ ────────────────────────
  await test('summary 500 → KPI แสดง error และ table ยัง render/ใช้งานได้', async () => {
    setSession();
    const net = installFetch((url) => {
      if (isRounds(url)) return { status: 200, body: { data: [ROUND_1, ROUND_2] } };
      if (isSummary(url)) return { status: 500, body: { message: 'Internal Server Error' } };
      if (isList(url)) {
        return {
          status: 200,
          body: { data: [ROW_1, ROW_2], pagination: { page: 1, pageSize: 10, total: 42, totalPages: 5 } },
        };
      }
      return { status: 404, body: {} };
    });
    const ui = await renderApplications();

    // KPI ต้องเป็น error state — ไม่ใช่ skeleton ค้าง และไม่ใช่เลข 0 หลอก
    const cards = Array.from(win.document.querySelectorAll('[data-testid="kpi-card"]'));
    assertEqual(cards.length, 6, 'ต้องมี KPI 6 ใบ');
    cards.forEach((c: any) => {
      assertEqual(c.getAttribute('data-kpi-error'), 'true', 'การ์ดต้องอยู่ใน error state');
      assertEqual(c.getAttribute('data-kpi-loading'), 'false', 'summary จบแล้ว (500) ต้องไม่ค้าง loading');
    });
    const errors = win.document.querySelectorAll('[data-testid="kpi-error"]');
    assertEqual(errors.length, 6, 'ทุกการ์ดต้องแสดงเครื่องหมาย error แทนตัวเลข');
    assert(!!win.document.querySelector('[data-testid="kpi-error-banner"]'), 'ต้องมี banner แจ้ง error');

    // ตารางต้องไม่เกี่ยว — ยัง render ครบ และ pagination ยังกดได้
    const text = ui.text();
    assert(text.includes(ROW_1.applicationNo), 'ตารางต้องแสดงแถวแม้ summary 500');
    assert(text.includes(ROW_2.applicationNo), 'ตารางต้องแสดงครบทุกแถว');
    assert(!text.includes('กำลังโหลด...'), 'ตารางต้องไม่ค้าง spinner เพราะ summary ล้ม');

    const listBefore = net.listCalls().length;
    await clickPageNumber(2);
    assert(net.listCalls().length > listBefore, 'ตารางยังเปลี่ยนหน้าได้แม้ summary error');
    assertEqual(net.summaryCalls().length, 1, 'เปลี่ยนหน้าต้องไม่ยิง summary ซ้ำ (แม้ครั้งก่อนจะ 500)');
    await ui.unmount();
  });

  await test('กด "ลองอีกครั้ง" ที่ KPI error → ยิง summary ใหม่และหาย error เมื่อสำเร็จ', async () => {
    setSession();
    let summaryShouldFail = true;
    const net = installFetch((url) => {
      if (isRounds(url)) return { status: 200, body: { data: [ROUND_1] } };
      if (isSummary(url)) {
        return summaryShouldFail
          ? { status: 500, body: { message: 'Internal Server Error' } }
          : { status: 200, body: SUMMARY_BODY };
      }
      if (isList(url)) {
        return {
          status: 200,
          body: { data: [ROW_1], pagination: { page: 1, pageSize: 10, total: 42, totalPages: 5 } },
        };
      }
      return { status: 404, body: {} };
    });
    const ui = await renderApplications();
    assert(!!win.document.querySelector('[data-testid="kpi-error-banner"]'), 'เริ่มด้วย error banner');

    summaryShouldFail = false;
    const retry = allButtons().find((b) => (b.textContent || '').trim() === 'ลองอีกครั้ง');
    assert(retry, 'ต้องมีปุ่มลองอีกครั้งใน banner');
    await act(async () => { retry.click(); });
    await settle();

    assertEqual(net.summaryCalls().length, 2, 'กดลองอีกครั้ง → summary ต้องยิงใหม่');
    assert(!win.document.querySelector('[data-testid="kpi-error-banner"]'), 'สำเร็จแล้ว banner ต้องหาย');
    assertEqual(win.document.querySelectorAll('[data-testid="kpi-error"]').length, 0, 'ต้องไม่มี error mark เหลือ');
    assert(ui.text().includes('42'), 'KPI ต้องแสดงตัวเลขจริงหลัง retry สำเร็จ');
    await ui.unmount();
  });

  // ── 8. requirement 5: ห้ามสรุป "ไม่พบรายการ" ก่อนรู้ผลจริง ────────────────
  await test('ระหว่าง list ยังโหลด → footer ต้องไม่สรุป "ไม่พบรายการ"', async () => {
    setSession();
    installFetch((url) => {
      if (isRounds(url)) return { status: 200, body: { data: [ROUND_1] } };
      if (isSummary(url)) return { status: 200, body: SUMMARY_BODY };
      if (isList(url)) return 'PENDING'; // list ยังไม่กลับ
      return { status: 404, body: {} };
    });
    const ui = await renderApplications();

    const text = ui.text();
    assert(text.includes('กำลังโหลด'), 'ตารางต้องแสดง loading ระหว่างรอ list');
    assert(
      !text.includes('ไม่พบรายการ'),
      'ห้ามสรุป "ไม่พบรายการ" ก่อน list กลับมา (นี่คือข้อมูลเท็จ)',
    );
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
  console.log('All summary-decoupling tests passed ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
