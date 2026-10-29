// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Applications page — Bulk Success Selection Behavior + excludeIds Wire Tests
 * ============================================================================
 * พิสูจน์ behavior บน "component จริง" (happy-dom) ไม่ใช่แค่ state model:
 *
 *   BS-1. bulk status สำเร็จ → selection ถูกล้าง (แถบ bulk หาย, checkbox ไม่ติ๊ก)
 *   BS-2. bulk status ล้มเหลว (4xx) → selection ต้องคงเดิม (ห้ามล้างตอน error)
 *   BS-3. all-filtered + excludeIds → body ที่ยิงขึ้น bulk-status ต้องเป็น
 *         { selector: { kind:'filter', ..., excludeIds:[...] } } — gate เดิม
 *         ("backend ยังไม่รองรับ") ถอดออกแล้ว ต้องส่งได้จริงจาก UI
 *   BS-4. explicit → body ยังเป็นรูป legacy { ids: [...] } (API contract ไม่เปลี่ยน)
 *   BS-5. export-selected แบบ all-filtered → body เป็น { roundId, selector }
 *
 * เหตุผลที่ต้องมีเทสต์ระดับ component: LS7 ใน applications-list-state.test.ts
 * พิสูจน์แค่ "clearSelection() คืน idle" — ไม่พิสูจน์ว่า ApplicationsClient
 * เรียกมันหลัง bulk สำเร็จจริง เทสต์ชุดนี้ปิดช่องนั้น
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/applications-bulk-selection.test.tsx
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

// triggerExcelDownload เรียก URL.createObjectURL(blob) — Node ไม่รับ Blob ของ happy-dom
// (คนละ constructor) → stub ทั้ง createObjectURL/revokeObjectURL และ anchor.click
// เพื่อให้เส้นทาง export-selected วิ่งจบโดยไม่พึ่ง DOM download จริง
const objectUrls: string[] = [];
const origCreateObjectURL = (globalAny.URL as any)?.createObjectURL;
(globalAny.URL as any).createObjectURL = (blob: any) => {
  objectUrls.push('blob:stub');
  return 'blob:stub';
};
(globalAny.URL as any).revokeObjectURL = () => {};
void origCreateObjectURL;

// ---------- Next.js module stubs ----------
import Module from 'module';

const stubRouter = {
  replace: () => {},
  push: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
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
// Fetch stub — บันทึก body ของ bulk-status / export-selected
// =============================================================================

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

/**
 * handler ตอบครบทุก endpoint; ปรับผลของ bulk-status ได้ผ่าน opts
 *   opts.bulkStatus = 'ok' (default) | { status, body }
 */
function installFetch(opts: { bulkStatus?: any } = {}) {
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
    if (u.includes('/admin/applications/bulk-status')) {
      const r = opts.bulkStatus ?? 'ok';
      if (r === 'ok') return json(200, { success: true, updated: 2 });
      return json(r.status, r.body);
    }
    if (u.includes('/admin/applications/export-selected')) {
      // component เรียก res.blob() ผ่าน triggerExcelDownload
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
    bulkCalls: () => calls.filter((c) => c.url.includes('/bulk-status')),
    exportSelectedCalls: () => calls.filter((c) => c.url.includes('/export-selected')),
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

// =============================================================================
// Render + DOM helpers
// =============================================================================

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

/** checkbox ของแถว (aria-label มีเลขใบสมัคร) */
function rowCheckbox(applicationNo: string): any {
  const cb = Array.from(win.document.querySelectorAll('input[type="checkbox"]')).find(
    (c: any) => (c.getAttribute('aria-label') || '').includes(applicationNo),
  );
  assert(cb, `ไม่พบ checkbox ของแถว ${applicationNo}`);
  return cb;
}

/** header checkbox = "เลือกผู้สมัครทั้งหมดตามตัวกรอง" */
function headerCheckbox(): any {
  const cb = Array.from(win.document.querySelectorAll('input[type="checkbox"]')).find(
    (c: any) => (c.getAttribute('aria-label') || '') === 'เลือกผู้สมัครทั้งหมดตามตัวกรอง',
  );
  assert(cb, 'ไม่พบ header checkbox');
  return cb;
}

/**
 * ติ๊ก checkbox ผ่าน React — happy-dom ในโปรเจกต์นี้ไม่ dispatch onChange ของ
 * <input type="text"> จาก synthetic event (ดูหมายเหตุใน summary-decoupling test)
 * แต่ click ของ checkbox ผ่าน React onClick/onChange ได้ตามปกติใน harness นี้
 * ถ้า click ตรง ๆ ไม่ติด ให้ set checked แล้ว dispatch 'click' แทน
 */
async function tickCheckbox(cb: any) {
  await act(async () => {
    cb.click();
  });
  await settle();
}

/** เปิด bulk modal → เลือกสถานะ → กดบันทึก */
async function runBulkStatus(status = 'QUALIFIED') {
  const openBtn = findButton('เปลี่ยนสถานะ');
  assert(!openBtn.disabled, 'ปุ่มเปลี่ยนสถานะต้องกดได้ (selection พร้อม)');
  await act(async () => { openBtn.click(); });
  await settle();

  // modal มี select ของสถานะใหม่
  const selects = Array.from(win.document.querySelectorAll('select')) as any[];
  const statusSelect = selects.find((s) =>
    Array.from(s.options || []).some((o: any) => o.value === status),
  );
  assert(statusSelect, 'ต้องพบ select สถานะใน bulk modal');
  const setter = Object.getOwnPropertyDescriptor(
    (win as any).HTMLSelectElement.prototype, 'value',
  )?.set;
  await act(async () => {
    setter?.call(statusSelect, status);
    statusSelect.dispatchEvent(new (win as any).Event('change', { bubbles: true }));
  });
  await settle();

  const saveBtn = allButtons().find((b) => (b.textContent || '').trim() === 'บันทึก' && !b.disabled);
  assert(saveBtn, 'ต้องพบปุ่มบันทึกที่กดได้ใน bulk modal');
  await act(async () => { saveBtn.click(); });
  await settle();
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n── Bulk success selection behavior (component จริง) ──');

  // ── BS-1: bulk สำเร็จ → selection ถูกล้าง ─────────────────────────────────
  await test('BS-1: bulk status สำเร็จ → selection ถูกล้าง (แถบ bulk หาย + checkbox ไม่ติ๊ก)', async () => {
    setSession();
    const net = installFetch();
    const ui = await renderApplications();

    await tickCheckbox(rowCheckbox('APP-2026-0001'));
    assert(ui.text().includes('เลือกไว้ 1 รายการ'), 'ต้องแสดงแถบ selection หลังติ๊ก');

    await runBulkStatus('QUALIFIED');

    assertEqual(net.bulkCalls().length, 1, 'ต้องยิง bulk-status 1 ครั้ง');
    assert(alerts.some((a) => a.includes('อัปเดตสถานะสำเร็จ')), `ต้องแจ้งสำเร็จ (alerts: ${alerts.join('|')})`);
    // selection ถูกล้าง → แถบ bulk action หาย, checkbox กลับเป็นไม่ติ๊ก
    assert(!ui.text().includes('เลือกไว้ 1 รายการ'), 'แถบ selection ต้องหายหลัง bulk สำเร็จ');
    assertEqual(rowCheckbox('APP-2026-0001').checked, false, 'checkbox ต้องไม่ติ๊ก');
    assertEqual(headerCheckbox().checked, false, 'header checkbox ต้องไม่ checked');
    await ui.unmount();
  });

  // ── BS-2: bulk ล้มเหลว → selection คงเดิม ─────────────────────────────────
  await test('BS-2: bulk status ล้มเหลว (400) → selection ต้องคงเดิม', async () => {
    setSession();
    installFetch({ bulkStatus: { status: 400, body: { message: 'สถานะไม่ถูกต้อง' } } });
    const ui = await renderApplications();

    await tickCheckbox(rowCheckbox('APP-2026-0001'));
    await runBulkStatus('QUALIFIED');

    assert(alerts.some((a) => a.includes('สถานะไม่ถูกต้อง')), 'ต้องแจ้ง error จาก server');
    assert(ui.text().includes('เลือกไว้ 1 รายการ'), 'selection ต้องไม่ถูกล้างตอนล้มเหลว');
    assertEqual(rowCheckbox('APP-2026-0001').checked, true, 'checkbox ต้องยังติ๊กอยู่');
    await ui.unmount();
  });

  console.log('\n── excludeIds wire behavior (client ไม่ block แล้ว) ──');

  // ── BS-3: all-filtered + excludeIds → ส่ง selector พร้อม excludeIds ───────
  await test('BS-3: all-filtered + excludeIds → bulk-status body มี selector.excludeIds', async () => {
    setSession();
    const net = installFetch();
    const ui = await renderApplications();

    // เลือกทั้งหมดตามตัวกรอง (header) แล้วเอา app-2 ออก 1 ใบ
    await tickCheckbox(headerCheckbox());
    assert(ui.text().includes('เลือกทั้งหมด 2 รายการตามตัวกรอง'), 'ต้องเป็น all-filtered');
    await tickCheckbox(rowCheckbox('APP-2026-0002'));
    assert(ui.text().includes('ยกเว้น 1'), 'ต้องนับ excludeIds ในข้อความ');

    // gate เดิมต้องหายไปแล้ว — ปุ่มเปลี่ยนสถานะต้องกดได้
    const openBtn = findButton('เปลี่ยนสถานะ');
    assert(!openBtn.disabled, 'all-filtered + excludeIds ต้อง submit ได้ (gate ถอดแล้ว)');

    await runBulkStatus('QUALIFIED');

    const call = net.bulkCalls()[0];
    assert(call, 'ต้องยิง bulk-status');
    assertEqual(call.body.selector?.kind, 'filter', 'ต้องส่ง selector kind filter');
    assertEqual(call.body.selector?.roundId, 'round-1', 'roundId ต้องติดไปด้วย');
    assert(
      Array.isArray(call.body.selector?.excludeIds) && call.body.selector.excludeIds.includes('app-2'),
      `excludeIds ต้องมี app-2 (ได้: ${JSON.stringify(call.body?.selector)})`,
    );
    assert(!('ids' in (call.body || {})), 'all-filtered ต้องไม่ส่ง ids');
    await ui.unmount();
  });

  // ── BS-4: explicit → legacy { ids } (contract เดิมไม่เปลี่ยน) ─────────────
  await test('BS-4: explicit selection → bulk-status body เป็น { ids } รูป legacy', async () => {
    setSession();
    const net = installFetch();
    const ui = await renderApplications();

    await tickCheckbox(rowCheckbox('APP-2026-0001'));
    await runBulkStatus('QUALIFIED');

    const call = net.bulkCalls()[0];
    assert(call, 'ต้องยิง bulk-status');
    assert(Array.isArray(call.body?.ids), 'explicit ต้องส่ง ids array');
    assert(call.body.ids.includes('app-1'), 'ids ต้องมี app-1');
    assert(!('selector' in (call.body || {})), 'explicit ต้องไม่ส่ง selector (รูป legacy เดิม)');
    await ui.unmount();
  });

  // ── BS-5: export-selected แบบ all-filtered → { roundId, selector } ────────
  await test('BS-5: export-selected (all-filtered + excludeIds) → body เป็น { roundId, selector }', async () => {
    setSession();
    const net = installFetch();
    const ui = await renderApplications();

    await tickCheckbox(headerCheckbox());
    await tickCheckbox(rowCheckbox('APP-2026-0002'));

    const exportBtn = findButton('Export ที่เลือก');
    assert(!exportBtn.disabled, 'export ที่เลือกต้องกดได้ในสถานะ all-filtered + excludeIds');
    await act(async () => { exportBtn.click(); });
    await settle(200);

    const call = net.exportSelectedCalls()[0];
    assert(call, 'ต้องยิง export-selected');
    assertEqual(call.body?.roundId, 'round-1', 'roundId ต้องส่งเสมอ');
    assertEqual(call.body?.selector?.kind, 'filter', 'all-filtered ต้องส่ง selector kind filter');
    assert(
      Array.isArray(call.body?.selector?.excludeIds) && call.body.selector.excludeIds.includes('app-2'),
      'excludeIds ต้องติดไปกับ selector',
    );
    await ui.unmount();
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All bulk-selection tests passed ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
