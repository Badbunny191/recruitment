// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Dashboard Round Filter — component reproduction tests (happy-dom)
 * ==================================================================
 * ทดสอบ dropdown filter รอบบน Executive Dashboard บน component จริง
 * (pattern เดียวกับ dashboard-blockers-repro.test.tsx — stub next/navigation
 * ที่ Module._load + fetch stub บันทึกทุก request)
 *
 *   C1. เปิดหน้ามาพร้อม ?roundId=r-1 → fetch แนบ roundId + dropdown preselect
 *   C2. เลือก "ทั้งหมด" → URL ไม่มี roundId + fetch ไม่แนบ param (default ไม่เขียนลง URL)
 *   C3. เปลี่ยน round → request เพิ่ม "ตัวเดียว" (endpoint เดียวกัน + ?roundId=)
 *       และห้ามยิง endpoint เก่า/ต่อ widget (perf requirement)
 *   C4. ?roundId= ชี้รอบที่ไม่มี → self-heal: fetch ครั้งเดียวเพิ่มกลับ "ทั้งหมด"
 *       + แสดง notice + URL ถูกล้าง (loop-safe)
 *   C5. KPI ฝั่ง global (รอบที่เปิดรับ) คงค่าเดิมแม้ filter รอบ (ห้าม filter rounds)
 *
 * V4 (Dashboard Layout V4 — Round Bar บน main @ ad4eaf5a):
 *   R1. widget จัดกลุ่มตามสถานะ ใช้งานอยู่ → ร่าง → ปิดแล้ว (+ นับในหัวกลุ่ม)
 *   R2. click-to-filter — คลิกแถวรอบใน widget = เลือกรอบ (1 request + URL sync)
 *   R3. highlight "กำลังดู" แถวเดียวคือรอบที่เลือก + trigger โชว์รหัส·ชื่อ
 *   R4. dropdown — option 2 บรรทัด + badge สถานะ + หัวกลุ่มครบ 3 กลุ่ม
 *   R5. ค้นหาใน dropdown — กรองเหลือ option เดียว
 *   R6. Round Bar label "รอบรับสมัคร" + Scope Banner คงอยู่ใต้ bar
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/dashboard-round-filter-repro.test.tsx
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

// ---------- Next.js module stubs (URL-aware) ----------
// ต่างจาก blockers test: router.replace ต้องอัปเดต currentUrl จริง เพราะ
// DashboardClient sync roundId กลับจาก searchParams (Back/Forward รองรับ)
import Module from 'module';

let currentUrl = 'http://localhost:3000/admin/dashboard';
const routerCalls: string[] = [];

function normalizeUrl(p: string): string {
  return p.startsWith('http') ? p : `http://localhost:3000${p}`;
}

const stubRouter = {
  replace: (p: string) => {
    routerCalls.push(`replace:${p}`);
    currentUrl = normalizeUrl(p);
  },
  push: (p: string) => { routerCalls.push(`push:${p}`); currentUrl = normalizeUrl(p); },
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
      usePathname: () => new URL(currentUrl).pathname,
      useSearchParams: () => new URLSearchParams(new URL(currentUrl).search),
      useParams: () => ({}),
    };
  }
  if (request === 'next/link') {
    const React = require('react');
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
// JWT helper (useAdminAuth อ่าน payload จาก localStorage token โดยไม่ verify)
// =============================================================================

function encodeJwtPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(role: string): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + 3600 };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

// =============================================================================
// Fetch stub — บันทึกทุก request + จำลอง backend ตาม ?roundId=
// =============================================================================

function installFetch(handler: (url: string) => { status: number; body: any }) {
  const calls: string[] = [];
  globalAny.fetch = async (url: string, _init: any = {}) => {
    const u = String(url);
    calls.push(u);
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

const NOW_SEC = Math.floor(Date.now() / 1000);
const DAY = 86_400;

/** 4 รอบครบ 3 สถานะ (V4 ทดสอบกลุ่ม): 2 ACTIVE เปิดรับ + 1 DRAFT + 1 CLOSED
 *  การ์ด KPI "รอบที่เปิดรับ" value ยัง = 2 (นับเฉพาะ open/closing-soon/overdue)
 *  แต่ hint "${activeRounds.length} รอบในช่วงนี้" = 4 — ต้องไม่ถูก filter ทั้งคู่ (C5) */
const ROUNDS_FIXTURE = [
  {
    id: 'r-1', title: 'รอบ A', roundCode: 'RC-A', status: 'ACTIVE', positionLevel: 'SENIOR',
    openDate: NOW_SEC - 30 * DAY, closeDate: NOW_SEC + 30 * DAY, deletedAt: null,
  },
  {
    id: 'r-2', title: 'รอบ B', roundCode: 'RC-B', status: 'ACTIVE', positionLevel: 'SENIOR',
    openDate: NOW_SEC - 30 * DAY, closeDate: NOW_SEC + 30 * DAY, deletedAt: null,
  },
  {
    id: 'r-draft', title: 'รอบร่าง', roundCode: 'RC-D', status: 'DRAFT', positionLevel: 'SENIOR',
    openDate: NOW_SEC + 10 * DAY, closeDate: NOW_SEC + 40 * DAY, deletedAt: null,
  },
  {
    id: 'r-closed', title: 'รอบปิดแล้ว', roundCode: 'RC-C', status: 'CLOSED', positionLevel: 'SENIOR',
    openDate: NOW_SEC - 60 * DAY, closeDate: NOW_SEC - 10 * DAY, deletedAt: null,
  },
];

function pendingBody(total: number) {
  return {
    total,
    overdueCount: total > 0 ? 1 : 0,
    oldestSubmittedAt: total > 0 ? NOW_SEC - 2 * DAY : null,
    slaDays: 7,
    items:
      total > 0
        ? [{ id: 'a1', applicationNo: 'APP-1', fullname: 'ก', status: 'SUBMITTED', submittedAt: NOW_SEC - DAY }]
        : [],
  };
}

function overviewBody(role: string | null, roundId: string | null) {
  const base: any = {
    // จำลอง backend: ไม่มี roundId = ทั้งหมด (10 ใบ) / r-1 = เฉพาะรอบ (4 ใบ) /
    // roundId อื่น = ศูนย์ (backend ไม่ validate — parity /applications/summary)
    summary:
      roundId === 'r-1'
        ? { total: 4, byStatus: { SUBMITTED: 2, QUALIFIED: 2 } }
        : roundId
          ? { total: 0, byStatus: { SUBMITTED: 0, QUALIFIED: 0 } }
          : { total: 10, byStatus: { SUBMITTED: 3, QUALIFIED: 7 } },
    pending: pendingBody(roundId === 'r-1' ? 1 : roundId ? 0 : 3),
    rounds: ROUNDS_FIXTURE,
    comparison: [],
    activities: null,
    errors: [],
  };
  if (role === 'SUPER_ADMIN') {
    base.activities = {
      items: [
        {
          id: 'l1', action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: 'e1',
          createdAt: NOW_SEC - 60, display: { name: 'APP-2026-5012', secondary: 'นายสมชาย' },
        },
      ],
    };
  }
  return { data: base };
}

/** บทบาท JWT จาก Authorization header (activities ตาม role — เหมือน backend จริง) */
function decodeJwtRole(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const json = Buffer.from(authHeader.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function roundFilterHandler(getAuth: () => string | undefined) {
  return (url: string) => {
    if (!url.includes('/admin/dashboard/overview')) return { status: 404, body: {} };
    // fetch URL เป็น relative (API_URL ว่างใน test) — new URL ต้องใส่ base เสมอ
    const roundId = new URL(url, 'http://localhost:3000').searchParams.get('roundId');
    return { status: 200, body: overviewBody(decodeJwtRole(getAuth()), roundId) };
  };
}

const LEGACY_ENDPOINTS = [
  '/admin/applications/summary',
  '/admin/applications?',
  '/admin/rounds/comparison',
  '/admin/rounds?',
  '/admin/audit-logs',
];

// =============================================================================
// Render helpers
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
  return {
    container,
    text: () => (container.textContent || ''),
    select: () => container.querySelector('#dashboard-round-filter'),
    unmount: () => act(async () => root.unmount()),
  };
}

/** เปิด panel ของ RoundSelect (คลิก trigger — interaction เดียวกับผู้ใช้จริง) */
async function openRoundPanel(ui: { container: HTMLElement }) {
  const trigger = ui.container.querySelector('#dashboard-round-filter');
  assert(trigger, 'trigger ของ RoundSelect ต้องมีอยู่ (#dashboard-round-filter)');
  await act(async () => {
    (trigger as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
}

/** เลือกรอบแบบเดียวกับผู้ใช้: เปิด panel → คลิก option ('' = "ทั้งหมด") */
async function selectRound(ui: { container: HTMLElement }, value: string) {
  await openRoundPanel(ui);
  const option = value
    ? ui.container.querySelector(`[data-testid="dashboard-round-option"][data-value="${value}"]`)
    : ui.container.querySelector('[data-testid="dashboard-round-option-all"]');
  assert(option, `ต้องมี option รอบ "${value || 'ทั้งหมด'}" ใน panel`);
  await act(async () => {
    (option as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

function setSession(role: string, url = 'http://localhost:3000/admin/dashboard') {
  currentUrl = url;
  routerCalls.length = 0;
  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
}

/** ติดตั้ง fetch stub ที่บันทึกทุก call + ส่ง Authorization ให้ handler */
function installRecordingFetch(): string[] {
  const calls: string[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    lastAuth = init?.headers?.Authorization;
    calls.push(String(url));
    const { status, body } = roundFilterHandler(() => lastAuth)(String(url));
    return { ok: status < 400, status, json: async () => body, clone() { return this; } };
  };
  return calls;
}

let lastAuth: string | undefined;

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('=================================================');
  console.log('Dashboard Round Filter — component repro tests');
  console.log('=================================================\n');

  await test('C1: เปิดหน้าพร้อม ?roundId=r-1 → fetch แนบ roundId + dropdown preselect รอบนั้น', async () => {
    setSession('ADMIN', 'http://localhost:3000/admin/dashboard?roundId=r-1');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    assertEqual(calls.length, 1, 'โหลดครั้งเดียว = request เดียว');
    assert(calls[0].includes('/admin/dashboard/overview?roundId=r-1'), 'ต้องแนบ ?roundId= ตั้งแต่ request แรก');
    const trigger = ui.select();
    assert(trigger, 'ต้องมี dropdown รอบ');
    const triggerText = (trigger as HTMLElement).textContent ?? '';
    assert(triggerText.includes('รอบ A'), `trigger ต้อง preselect รอบจาก URL (พบ: "${triggerText}")`);
    await ui.unmount();
  });

  await test('C3: เปลี่ยน round → request เพิ่มตัวเดียว (endpoint เดียว + ?roundId=) ไม่มี fan-out', async () => {
    setSession('ADMIN');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    assertEqual(calls.length, 1, 'โหลดครั้งเดียว = request เดียว');

    await selectRound(ui, 'r-1');

    const overviewCalls = calls.filter((u) => u.includes('/admin/dashboard/overview'));
    assertEqual(overviewCalls.length, 2, 'เปลี่ยน round 1 ครั้ง = request เพิ่ม 1 เท่านั้น');
    assert(overviewCalls[1].includes('roundId=r-1'), 'request ใหม่ต้องแนบ ?roundId=r-1');
    for (const legacy of LEGACY_ENDPOINTS) {
      assertEqual(calls.filter((u) => u.includes(legacy)).length, 0, `ห้ามยิง endpoint เก่า: ${legacy}`);
    }
    assert(routerCalls.some((c) => c.startsWith('replace:') && c.includes('roundId=r-1')), 'URL ต้อง sync ?roundId=r-1');
    await ui.unmount();
  });

  await test('C2: เลือก "ทั้งหมด" → URL ไม่มี roundId + fetch ไม่แนบ param (default ไม่เขียนลง URL)', async () => {
    setSession('ADMIN');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    await selectRound(ui, 'r-1');
    await selectRound(ui, '');

    const last = calls[calls.length - 1];
    assert(last.includes('/admin/dashboard/overview'), 'ต้องยิง endpoint เดิม');
    assert(!last.includes('roundId'), '"ทั้งหมด" ต้องไม่แนบ roundId เลย');
    const replaced = routerCalls.filter((c) => c.startsWith('replace:')).pop() ?? '';
    assert(!replaced.includes('roundId'), 'URL หลังเลือกทั้งหมดต้องไม่มี roundId');
    await ui.unmount();
  });

  await test('C4: ?roundId= ชี้รอบที่ไม่มี → self-heal กลับทั้งหมด 1 ครั้ง + notice + URL ถูกล้าง', async () => {
    setSession('ADMIN', 'http://localhost:3000/admin/dashboard?roundId=r-gone');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    assertEqual(calls.length, 2, 'fetch แรก (ตาม URL) + heal กลับทั้งหมด = 2 request เท่านั้น (ไม่ loop)');
    assert(calls[0].includes('roundId=r-gone'), 'request แรกต้องตาม URL ก่อน');
    assert(!calls[1].includes('roundId'), 'request ที่สอง (heal) ต้องไม่มี roundId');
    assert(ui.text().includes('รอบที่เลือกไม่พบแล้ว'), 'ต้องแจ้งเหตุผลของการกลับไปทั้งหมด');
    const replaced = routerCalls.filter((c) => c.startsWith('replace:')).pop() ?? '';
    assert(!replaced.includes('roundId'), 'URL หลัง heal ต้องไม่มี roundId');
    assertEqual(
      ((ui.select() as HTMLElement).textContent ?? '').trim(),
      'ทั้งหมด (ทุกรอบ)',
      'dropdown ต้องกลับเป็น ทั้งหมด',
    );
    await ui.unmount();
  });

  await test('C5: KPI ฝั่ง global ("รอบที่เปิดรับ" = 2 รอบ) คงค่าเดิมแม้ filter รอบ r-1', async () => {
    setSession('ADMIN');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    // fixture มี 4 รอบ (2 ACTIVE + 1 DRAFT + 1 CLOSED) — hint KPI #3 "รอบในช่วงนี้" = 4
    // (value ยัง = 2 เพราะนับเฉพาะ open/closing-soon/overdue — คงเดิมตามข้อห้ามแก้ KPI #3)
    assert(ui.text().includes('4 รอบในช่วงนี้'), 'ก่อน filter: KPI #3 ต้องเห็นรอบทั้งหมด 4 รอบ');

    await selectRound(ui, 'r-1');

    assert(ui.text().includes('4 รอบในช่วงนี้'), 'หลัง filter r-1: KPI #3 ต้องยังเห็น 4 รอบ (rounds ไม่ถูก filter)');
    assert(routerCalls.some((c) => c.includes('roundId=r-1')), 'และ filter ต้องถูกใช้จริง');
    await ui.unmount();
  });

  console.log('\n=== V4: Round Bar / กลุ่มสถานะ / click-to-filter / highlight ===');

  await test('R1: widget จัดกลุ่มตามสถานะ ใช้งานอยู่ → ร่าง → ปิดแล้ว (+ นับจำนวนในหัวกลุ่ม)', async () => {
    setSession('ADMIN');
    installRecordingFetch();
    const ui = await renderDashboard();
    // dropdown ยังไม่เปิด → group testid ทั้งหมดเป็นของ widget
    const keys = [...ui.container.querySelectorAll('[data-testid^="dashboard-round-group-"]')].map(
      (el) => el.getAttribute('data-testid'),
    );
    assertEqual(
      keys.join(','),
      'dashboard-round-group-active,dashboard-round-group-draft,dashboard-round-group-closed',
      'ลำดับกลุ่มต้องเป็น ใช้งานอยู่ → ร่าง → ปิดแล้ว',
    );
    const text = ui.text();
    assert(text.includes('ใช้งานอยู่ (2)'), 'กลุ่มใช้งานอยู่ = 2 รอบ');
    assert(text.includes('ร่าง (1)'), 'กลุ่มร่าง = 1 รอบ');
    assert(text.includes('ปิดแล้ว (1)'), 'กลุ่มปิดแล้ว = 1 รอบ');
    assert(text.includes('รอบรับสมัครทั้งหมด'), 'widget title ต้องเป็น "รอบรับสมัครทั้งหมด"');
    await ui.unmount();
  });

  await test('R2: click-to-filter — คลิกแถวรอบใน widget → ยิง 1 request + URL sync ?roundId=', async () => {
    setSession('ADMIN');
    const calls = installRecordingFetch();
    const ui = await renderDashboard();
    const row = ui.container.querySelector('[data-testid="dashboard-round-row"][data-value="r-1"]');
    assert(row, 'ต้องมีแถวรอบ r-1 ใน widget');
    await act(async () => {
      (row as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const overviewCalls = calls.filter((u) => u.includes('/admin/dashboard/overview'));
    assertEqual(overviewCalls.length, 2, 'คลิกรอบ 1 ครั้ง = request เพิ่ม 1 เท่านั้น');
    assert(overviewCalls[1].includes('roundId=r-1'), 'request ต้องแนบ ?roundId=r-1');
    assert(
      routerCalls.some((c) => c.startsWith('replace:') && c.includes('roundId=r-1')),
      'URL ต้อง sync ?roundId=r-1',
    );
    await ui.unmount();
  });

  await test('R3: highlight "กำลังดู" แถวเดียวคือรอบที่เลือก + trigger โชว์รหัส·ชื่อ', async () => {
    setSession('ADMIN');
    installRecordingFetch();
    const ui = await renderDashboard();
    await selectRound(ui, 'r-1');
    const viewing = ui.container.querySelectorAll('[data-testid="dashboard-round-viewing"]');
    assertEqual(viewing.length, 1, 'ต้องมี chip "กำลังดู" แถวเดียว');
    const row = ui.container.querySelector('[data-testid="dashboard-round-row"][data-value="r-1"]');
    assert(row, 'ต้องมีแถวรอบ r-1');
    assert((row as HTMLElement).textContent?.includes('กำลังดู'), 'chip ต้องอยู่ที่แถว r-1');
    assertEqual(
      (row as HTMLElement).getAttribute('aria-pressed'),
      'true',
      'แถวที่เลือกต้อง aria-pressed=true',
    );
    const trigger = ui.container.querySelector('#dashboard-round-filter') as HTMLElement | null;
    assert(trigger?.textContent?.includes('รอบ A'), 'trigger ต้องโชว์รอบที่เลือก');
    await ui.unmount();
  });

  await test('R4: dropdown — option 2 บรรทัด (รหัส/วันปิด) + badge สถานะ + หัวกลุ่มครบ 3 กลุ่ม', async () => {
    setSession('ADMIN');
    installRecordingFetch();
    const ui = await renderDashboard();
    await openRoundPanel(ui);
    const panel = ui.container.querySelector('[data-testid="dashboard-round-panel"]');
    assert(panel, 'ต้องมี panel หลังเปิด trigger');
    assert(
      panel!.querySelector('[data-testid="dashboard-round-option-all"]'),
      'ต้องมี "ทั้งหมด (ทุกรอบ)" pin บนสุด',
    );
    for (const key of ['active', 'draft', 'closed']) {
      assert(
        panel!.querySelector(`[data-testid="dashboard-round-group-${key}"]`),
        `panel ต้องมีหัวกลุ่ม ${key}`,
      );
    }
    const draftOpt = panel!.querySelector(
      '[data-testid="dashboard-round-option"][data-value="r-draft"]',
    ) as HTMLElement | null;
    assert(draftOpt, 'ต้องมี option รอบร่าง');
    const optText = draftOpt.textContent ?? '';
    assert(optText.includes('รอบร่าง'), 'บรรทัดแรก = ชื่อรอบ');
    assert(optText.includes('RC-D'), 'บรรทัดรองต้องมีรหัสรอบ');
    assert(optText.includes('ร่าง'), 'option ต้องมี badge สถานะ "ร่าง"');
    await ui.unmount();
  });

  await test('R5: ค้นหาใน dropdown — "รอบ A" เหลือ option รอบเดียว', async () => {
    setSession('ADMIN');
    installRecordingFetch();
    const ui = await renderDashboard();
    await openRoundPanel(ui);
    const search = ui.container.querySelector(
      '[data-testid="dashboard-round-search"]',
    ) as HTMLInputElement | null;
    assert(search, 'ต้องมีช่องค้นหาใน panel');
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(search, 'รอบ A');
      search.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    const roundOptions = [
      ...ui.container.querySelectorAll('[data-testid="dashboard-round-panel"] [data-testid="dashboard-round-option"]'),
    ];
    assertEqual(roundOptions.length, 1, 'ค้นหา "รอบ A" ต้องเหลือ option รอบเดียว (ไม่นับ "ทั้งหมด")');
    assertEqual(roundOptions[0].getAttribute('data-value'), 'r-1');
    await ui.unmount();
  });

  await test('R6: Round Bar label "รอบรับสมัคร" + Scope Banner อยู่ใต้ bar (คงไว้ตาม V4)', async () => {
    setSession('ADMIN');
    installRecordingFetch();
    const ui = await renderDashboard();
    assert(ui.text().includes('รอบรับสมัคร'), 'label ต้องมองเห็นทุก breakpoint (ไม่ซ่อนบนมือถือ)');
    const banner = ui.container.querySelector('[data-testid="dashboard-scope-banner"]') as HTMLElement | null;
    assert(banner, 'ต้องมี Scope Banner');
    assert(banner.textContent?.includes('กำลังแสดง:'), 'banner ต้องบอกขอบเขตที่กำลังแสดง');
    assert(banner.textContent?.includes('ทุก Recruitment Round'), 'default = ทุก Recruitment Round');
    await ui.unmount();
  });

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
}

main().catch((e) => {
  console.error('Test runner failed:', e);
  (globalThis as any).process.exit(1);
});
