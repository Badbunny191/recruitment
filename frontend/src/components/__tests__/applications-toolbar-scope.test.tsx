// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Applications page — Toolbar Scope Reorganization (Option C) Tests
 * ============================================================================
 * พิสูจน์บน "component จริง" (happy-dom): action แยกตาม "ขอบเขตของข้อมูล"
 *
 *   TS-1. ไม่มี selection (ADMIN) → toolbar มีเฉพาะ "ตามตัวกรอง": Export Excel +
 *         PDF ตามตัวกรอง — ไม่มีปุ่ม "ที่เลือก" ลอยอยู่
 *   TS-2. มี selection (ADMIN) → Bulk Action Bar = ศูนย์ปฏิบัติการ: Export ที่เลือก
 *         + PDF ที่เลือก + เปลี่ยนสถานะ (ปุ่มที่เลือกอยู่ใน bar เท่านั้น ไม่ซ้ำใน toolbar)
 *   TS-3. มี selection (VIEWER) → bar ยังโผล่ (PDF ใช้ได้ทุก role — สิทธิ์เดิม)
 *         แต่ไม่มีปุ่มที่ต้องสิทธิ์เขียน: Export ที่เลือก / เปลี่ยนสถานะ / Export Excel
 *   TS-4. ไม่มี selection (VIEWER) → toolbar มี "PDF ตามตัวกรอง" ไม่มี "Export Excel"
 *   TS-5. ยกเลิก selection → bar หาย, ปุ่ม "ที่เลือก" หายทั้งหมด
 *   TS-6. ปุ่ม action ทั้งหมด whitespace-nowrap (label ไม่ขึ้น 2 บรรทัด)
 *   TS-7. Export Excel (ตามตัวกรอง) ยิง GET /export ด้วย roundId เดิม (behavior คงเดิม)
 *   TS-8. PDF ที่เลือก เปิด dialog ยืนยันถูกโหมด (behavior คงเดิม)
 *
 * หลักการ: ย้ายปุ่ม = ย้าย UI เท่านั้น — handler/disabled logic/สิทธิ์ต้องเหมือนเดิม
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/applications-toolbar-scope.test.tsx
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

const alerts: string[] = [];
win.alert = (msg: any) => { alerts.push(String(msg)); };
globalAny.alert = win.alert;

// triggerExcelDownload เรียก URL.createObjectURL — stub แบบเดียวกับ bulk-selection test
(globalAny.URL as any).createObjectURL = () => 'blob:stub';
(globalAny.URL as any).revokeObjectURL = () => {};

// ---------- Next.js module stubs ----------
import Module from 'module';

const stubRouter = {
  replace: () => {}, push: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {},
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
// Test harness (แบบเดียวกับ applications-bulk-selection.test.tsx)
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

function encodeJwtPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(role: string, expOffsetSec = 3600): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

interface FetchCall { url: string; method: string; body: any }

const ROUND = { id: 'round-1', title: 'รอบทดสอบหนึ่ง', status: 'ACTIVE', deletedAt: null, roundCode: 'CHM01' };

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

const ROWS = [makeRow('app-1', 'APP-2026-0001'), makeRow('app-2', 'APP-2026-0002')];
const SUMMARY_BODY = { data: { total: 2, byStatus: { SUBMITTED: 2 } } };

function installFetch() {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    let body: any = null;
    if (init && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url: u, method: (init?.method || 'GET').toUpperCase(), body });

    if (u.includes('/admin/rounds')) return json(200, { data: [ROUND] });
    if (u.includes('/admin/applications/summary')) return json(200, SUMMARY_BODY);
    if (u.includes('/admin/applications/export?')) {
      // GET export ตามตัวกรอง — ตอบ xlsx-like blob ให้ flow จบ
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'attachment; filename="export.xlsx"' },
        json: async () => ({}),
        blob: async () => new (win as any).Blob(['x']),
        clone() { return this; },
      };
    }
    if (u.includes('/admin/applications/export-selected')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'attachment; filename="export.xlsx"' },
        json: async () => ({}),
        blob: async () => new (win as any).Blob(['x']),
        clone() { return this; },
      };
    }
    if (u.includes('/admin/applications')) {
      return json(200, {
        data: ROWS,
        pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
      });
    }
    return json(404, {});
  };
  return {
    calls,
    exportFilteredCalls: () => calls.filter((c) => c.url.includes('/admin/applications/export?')),
  };
}

function json(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    clone() { return this; },
  };
}

async function renderApplications() {
  const mod = await import('../../app/(admin)/admin/applications/ApplicationsClient');
  const ApplicationsClient = mod.default;
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
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function settle(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function setSession(role = 'ADMIN') {
  win.location.href = 'http://localhost:3000/admin/applications';
  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
  alerts.length = 0;
}

function allButtons(): any[] {
  return Array.from(win.document.querySelectorAll('button'));
}

function findButton(label: string): any {
  const btn = allButtons().find((b) => (b.textContent || '').trim().includes(label));
  assert(btn, `ไม่พบปุ่ม "${label}" (มี: ${allButtons().map((b) => (b.textContent || '').trim()).join(' | ')})`);
  return btn;
}

/** จำนวนปุ่มที่ text ตรง label (ใช้พิสูจน์ "อยู่ใน bar เท่านั้น ไม่ซ้ำ toolbar") */
function countButtons(label: string): number {
  return allButtons().filter((b) => (b.textContent || '').trim().includes(label)).length;
}

function rowCheckbox(applicationNo: string): any {
  const cb = Array.from(win.document.querySelectorAll('input[type="checkbox"]')).find(
    (c: any) => (c.getAttribute('aria-label') || '').includes(applicationNo),
  );
  assert(cb, `ไม่พบ checkbox ของแถว ${applicationNo}`);
  return cb;
}

async function tickCheckbox(cb: any) {
  await act(async () => {
    cb.click();
  });
  await settle();
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('=================================================');
  console.log('Applications Toolbar Scope (Option C) — Tests');
  console.log('=================================================\n');

  // ── TS-1: ไม่มี selection (ADMIN) → toolbar เฉพาะ "ตามตัวกรอง" ──
  await test('TS-1: ไม่เลือกอะไร (ADMIN) → toolbar มี Export Excel + PDF ตามตัวกรอง ไม่มีปุ่ม "ที่เลือก"', async () => {
    setSession('ADMIN');
    installFetch();
    const ui = await renderApplications();
    assert(findButton('Export Excel'), 'toolbar ต้องมี Export Excel');
    assert(findButton('PDF ตามตัวกรอง'), 'toolbar ต้องมี PDF ตามตัวกรอง');
    assertEqual(countButtons('Export ที่เลือก'), 0, 'ห้ามมี Export ที่เลือก (ต้องเลือกก่อนจึงเห็นใน bar)');
    assertEqual(countButtons('PDF ที่เลือก'), 0, 'ห้ามมี PDF ที่เลือกลอยใน toolbar');
    assert(!ui.text().includes('เลือกไว้'), 'ไม่มี Bulk Action Bar เมื่อยังไม่เลือก');
    await ui.unmount();
  });

  // ── TS-2: มี selection (ADMIN) → bar = ศูนย์ปฏิบัติการ ──
  await test('TS-2: เลือก 1 ใบ (ADMIN) → bar มี Export ที่เลือก + PDF ที่เลือก + เปลี่ยนสถานะ (ตัวเดียวต่อปุ่ม)', async () => {
    setSession('ADMIN');
    installFetch();
    const ui = await renderApplications();
    await tickCheckbox(rowCheckbox('APP-2026-0001'));

    assert(ui.text().includes('เลือกไว้ 1 รายการ'), 'bar ต้องแสดงจำนวนที่เลือก');
    assertEqual(countButtons('Export ที่เลือก'), 1, 'Export ที่เลือก อยู่ใน bar เท่านั้น');
    assertEqual(countButtons('PDF ที่เลือก'), 1, 'PDF ที่เลือก อยู่ใน bar เท่านั้น');
    assertEqual(countButtons('เปลี่ยนสถานะ'), 1, 'เปลี่ยนสถานะ อยู่ใน bar เท่านั้น');
    assert(findButton('Export ที่เลือก') && findButton('PDF ที่เลือก'), 'ปุ่ม bar ครบ');
    // toolbar ระดับ "ตามตัวกรอง" ยังอยู่ครบ (ยัง export ทั้งชุดได้ขณะเลือกอยู่)
    assert(findButton('Export Excel'), 'toolbar ยังมี Export Excel');
    assert(findButton('PDF ตามตัวกรอง'), 'toolbar ยังมี PDF ตามตัวกรอง');
    await ui.unmount();
  });

  // ── TS-3: มี selection (VIEWER) → bar โผล่แต่มีแค่ PDF ที่เลือก ──
  await test('TS-3: เลือก 1 ใบ (VIEWER) → bar มี PDF ที่เลือก แต่ไม่มีปุ่มสิทธิ์เขียน (สิทธิ์เดิมไม่เปลี่ยน)', async () => {
    setSession('VIEWER');
    installFetch();
    const ui = await renderApplications();
    await tickCheckbox(rowCheckbox('APP-2026-0001'));

    assert(ui.text().includes('เลือกไว้ 1 รายการ'), 'VIEWER ต้องเห็น bar (PDF ใช้ได้ทุก role)');
    assertEqual(countButtons('PDF ที่เลือก'), 1, 'PDF ที่เลือก ต้องมีให้ VIEWER');
    assertEqual(countButtons('Export ที่เลือก'), 0, 'Export ที่เลือก (Excel) ห้ามโชว์สำหรับ VIEWER');
    assertEqual(countButtons('เปลี่ยนสถานะ'), 0, 'เปลี่ยนสถานะ ห้ามโชว์สำหรับ VIEWER');
    assertEqual(countButtons('Export Excel'), 0, 'Export Excel ห้ามโชว์สำหรับ VIEWER');
    await ui.unmount();
  });

  // ── TS-4: ไม่มี selection (VIEWER) → toolbar มีแค่ PDF ตามตัวกรอง ──
  await test('TS-4: ไม่เลือกอะไร (VIEWER) → toolbar มี PDF ตามตัวกรอง ไม่มี Export Excel', async () => {
    setSession('VIEWER');
    installFetch();
    const ui = await renderApplications();
    assert(findButton('PDF ตามตัวกรอง'), 'PDF ตามตัวกรอง ต้องมี (ทุก role)');
    assertEqual(countButtons('Export Excel'), 0, 'Export Excel ห้ามโชว์สำหรับ VIEWER');
    await ui.unmount();
  });

  // ── TS-5: ยกเลิก selection → bar หาย ──
  await test('TS-5: กด "ยกเลิก" ใน bar → bar หาย + ปุ่ม "ที่เลือก" หายทั้งหมด', async () => {
    setSession('ADMIN');
    installFetch();
    const ui = await renderApplications();
    await tickCheckbox(rowCheckbox('APP-2026-0001'));
    assert(findButton('PDF ที่เลือก'), 'ก่อนยกเลิกต้องมีปุ่ม');

    const cancelBtn = allButtons().find((b) => (b.textContent || '').trim() === 'ยกเลิก');
    assert(cancelBtn, 'ต้องพบปุ่มยกเลิกใน bar');
    await act(async () => { cancelBtn.click(); });
    await settle();

    assertEqual(countButtons('PDF ที่เลือก'), 0, 'PDF ที่เลือก ต้องหายหลังยกเลิก');
    assertEqual(countButtons('Export ที่เลือก'), 0, 'Export ที่เลือก ต้องหายหลังยกเลิก');
    assert(!ui.text().includes('เลือกไว้'), 'bar ต้องหาย');
    await ui.unmount();
  });

  // ── TS-6: ปุ่ม action ทั้งหมด whitespace-nowrap ──
  await test('TS-6: ปุ่ม action ทั้ง 4 (toolbar 2 + bar 3) มี whitespace-nowrap กัน label 2 บรรทัด', async () => {
    setSession('ADMIN');
    installFetch();
    const ui = await renderApplications();
    assert(
      findButton('Export Excel').className.includes('whitespace-nowrap'),
      'Export Excel ต้อง nowrap',
    );
    assert(
      findButton('PDF ตามตัวกรอง').className.includes('whitespace-nowrap'),
      'PDF ตามตัวกรอง ต้อง nowrap',
    );
    await tickCheckbox(rowCheckbox('APP-2026-0001'));
    assert(findButton('Export ที่เลือก').className.includes('whitespace-nowrap'), 'Export ที่เลือก ต้อง nowrap');
    assert(findButton('PDF ที่เลือก').className.includes('whitespace-nowrap'), 'PDF ที่เลือก ต้อง nowrap');
    assert(findButton('เปลี่ยนสถานะ').className.includes('whitespace-nowrap'), 'เปลี่ยนสถานะ ต้อง nowrap');
    await ui.unmount();
  });

  // ── TS-7: Export Excel ยิง endpoint เดิมด้วย roundId ──
  await test('TS-7: กด Export Excel → GET /admin/applications/export พร้อม roundId (behavior คงเดิม)', async () => {
    setSession('ADMIN');
    const net = installFetch();
    const ui = await renderApplications();
    const btn = findButton('Export Excel');
    assert(!btn.disabled, 'Export Excel ต้องกดได้');
    await act(async () => { btn.click(); });
    await settle(200);

    const call = net.exportFilteredCalls()[0];
    assert(call, 'ต้องยิง GET /admin/applications/export');
    assertEqual(call.method, 'GET', 'ต้องเป็น GET (ตามตัวกรอง)');
    assert(call.url.includes('roundId=round-1'), 'roundId ต้องติดไป');
    await ui.unmount();
  });

  // ── TS-8: PDF ที่เลือก เปิด dialog โหมด selected ──
  await test('TS-8: กด PDF ที่เลือก → dialog ยืนยันเปิดในโหมด "ที่เลือก" (behavior คงเดิม)', async () => {
    setSession('ADMIN');
    installFetch();
    const ui = await renderApplications();
    await tickCheckbox(rowCheckbox('APP-2026-0001'));

    const btn = findButton('PDF ที่เลือก');
    await act(async () => { btn.click(); });
    await settle();

    assert(ui.text().includes('ดาวน์โหลด PDF ที่เลือก'), 'dialog ต้องเปิดในโหมด ที่เลือก');
    await ui.unmount();
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All toolbar-scope tests passed ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
