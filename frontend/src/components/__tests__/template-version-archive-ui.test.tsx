// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Template Builder — Archive Published Version UI Tests
 * ============================================================================
 * พิสูจน์บน "component จริง" (happy-dom): UI เรียก PATCH /admin/template-versions/:id/archive
 * ได้ถูกเงื่อนไข (backend บังคับ status=PUBLISHED + ไม่มี rounds อ้างอิง)
 *
 *   T1.  PUBLISHED + ไม่มีรอบอ้างอิง → ปุ่ม Archive แสดงและกดได้ (enabled)
 *   T2.  PUBLISHED + มีรอบอ้างอิง → ปุ่ม disabled + ข้อความอธิบายสาเหตุ
 *   T3.  DRAFT → ไม่มีปุ่ม Archive (แถว Draft มีแค่ Delete)
 *   T4.  ARCHIVED → ไม่มีปุ่ม Archive (แถว Archived ดูได้อย่างเดียว)
 *   T5.  VIEWER → ไม่มีปุ่ม Archive (canWrite gate, ตรงกับ adminOnlyMiddleware)
 *   T6.  Archive สำเร็จ: confirm ระบุ version+ผลกระทบ → PATCH ถูกยิง → toast success
 *        → version history reload (GET versions ครั้งที่ 2)
 *   T7.  กดยกเลิก confirm → ไม่ยิง PATCH
 *   T8.  HTTP 400 (มี rounds อ้างอิง) → toast error แสดงสาเหตุจาก server
 *   T9.  HTTP 404 → toast error + reload รายการใหม่
 *   T10. HTTP 409 (version ถูกเปลี่ยนสถานะไปก่อน) → toast error
 *   T11. Network error → toast error เชื่อมต่อไม่ได้
 *   T12. โหลดข้อมูล rounds ไม่สำเร็จ → fail-closed: ปุ่ม disabled พร้อมข้อความ
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/template-version-archive-ui.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/templates/builder?id=tpl-1' });
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

// confirm dialog stub — จับข้อความ + ควบคุมผลการยืนยัน
const confirmCalls: string[] = [];
let confirmResult = true;
win.confirm = (msg: any) => { confirmCalls.push(String(msg)); return confirmResult; };
globalAny.confirm = win.confirm;

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
// Test harness (แบบเดียวกับ applications-toolbar-scope.test.tsx)
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

// makeToken แบบเดียวกับ toolbar-scope test (JWT 3 ส่วน)
function makeToken(role: string, expOffsetSec = 3600): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

interface FetchCall { url: string; method: string }

const TPL_ID = 'tpl-1';

function makeVersion(id: string, n: number, status: string) {
  return { id, versionNumber: n, status, createdAt: Math.floor(Date.now() / 1000) - 3600 };
}

const TEMPLATE = { id: TPL_ID, name: 'แบบฟอร์มทดสอบ', description: '', isActive: true };

function makeRound(id: string, templateVersionId: string | null) {
  return { id, title: `รอบ ${id}`, templateVersionId, deletedAt: null, status: 'ACTIVE' };
}

interface FetchOpts {
  versions?: any[];
  rounds?: any[];
  roundsStatus?: number;
  archiveStatus?: number;
  archiveBody?: any;
  archiveReject?: boolean;
}

function installFetch(opts: FetchOpts = {}) {
  const calls: FetchCall[] = [];
  const {
    versions = [makeVersion('ver-1', 1, 'PUBLISHED')],
    rounds = [],
    roundsStatus = 200,
    archiveStatus = 200,
    archiveBody = { success: true },
    archiveReject = false,
  } = opts;

  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url: u, method });

    if (u.includes('/admin/template-versions/') && u.includes('/archive')) {
      if (archiveReject) throw new TypeError('Failed to fetch');
      return json(archiveStatus, archiveBody);
    }
    if (u.includes('/admin/templates/') && u.includes('/versions')) return json(200, { data: versions });
    if (u.includes('/admin/template-fields/')) return json(200, { data: [] });
    if (u.includes('/admin/template-sections/')) return json(200, { data: [] });
    if (u.endsWith('/admin/templates')) return json(200, { data: [TEMPLATE] });
    if (u.includes('/admin/rounds')) return json(roundsStatus, { data: rounds });
    if (u.includes('/admin/fields')) return json(200, { data: [] });
    return json(404, {});
  };

  return {
    calls,
    patchArchiveCalls: () => calls.filter((c) => c.method === 'PATCH' && c.url.includes('/admin/template-versions/') && c.url.includes('/archive')),
    versionsGetCount: () => calls.filter((c) => c.method === 'GET' && c.url.includes(`/admin/templates/${TPL_ID}/versions`)).length,
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

async function settle(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function renderBuilder(role = 'ADMIN') {
  const mod = await import('../../app/(admin)/admin/templates/builder/TemplateBuilderClient');
  const Client = mod.default;
  const toastMod = await import('../../components/ui/toast');

  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken(role));
  alerts.length = 0;
  confirmCalls.length = 0;
  confirmResult = true;

  win.document.body.innerHTML = '';
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(
      React.createElement(
        toastMod.ToastProvider,
        null,
        React.createElement(toastMod.Toaster),
        React.createElement(Client),
      ),
    );
  });
  await settle();
  // Version History collapsed โดย default — คลิกหัวข้อเพื่อ expand ก่อนหาปุ่มในแถว
  const header = Array.from(win.document.querySelectorAll('div')).find(
    (el) => String((el as any).className || '').includes('cursor-pointer') &&
      (el.textContent || '').includes('ประวัติ Version'),
  );
  if (header) {
    await act(async () => { header.click(); });
    await settle();
  }
  return {
    container,
    text: () => (container.textContent || ''),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function allButtons(): any[] {
  return Array.from(win.document.querySelectorAll('button'));
}

function archiveButtons(): any[] {
  return allButtons().filter((b) => (b.textContent || '').trim() === 'Archive');
}

function toastText(): string {
  return Array.from(win.document.querySelectorAll('[role="alert"]'))
    .map((el) => (el as any).textContent || '')
    .join(' | ');
}

async function clickArchive() {
  const btn = archiveButtons()[0];
  assert(btn, 'ไม่พบปุ่ม Archive');
  await act(async () => {
    btn.click();
  });
  await settle();
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('=================================================');
  console.log('Template Builder — Archive Published Version UI — Tests');
  console.log('=================================================\n');

  // ── T1: PUBLISHED + ไม่มีรอบอ้างอิง → ปุ่ม Archive enabled ──
  await test('T1: PUBLISHED ไม่มีรอบอ้างอิง → ปุ่ม Archive แสดงและกดได้', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [makeRound('round-x', 'ver-other')],
    });
    const page = await renderBuilder('ADMIN');
    try {
      const btns = archiveButtons();
      assertEqual(btns.length, 1, 'จำนวนปุ่ม Archive');
      assertEqual(btns[0].disabled, false, 'ปุ่ม Archive ต้อง enabled');
    } finally {
      await page.unmount();
    }
  });

  // ── T2: PUBLISHED + มีรอบอ้างอิง → disabled + ข้อความอธิบาย ──
  await test('T2: PUBLISHED มีรอบอ้างอิง → ปุ่ม disabled + ข้อความอธิบาย', async () => {
    installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [makeRound('round-1', 'ver-1')],
    });
    const page = await renderBuilder('ADMIN');
    try {
      const btns = archiveButtons();
      assertEqual(btns.length, 1, 'จำนวนปุ่ม Archive (disabled ก็ต้องแสดง)');
      assertEqual(btns[0].disabled, true, 'ปุ่มต้อง disabled เมื่อมีรอบอ้างอิง');
      assert(
        page.text().includes('ไม่สามารถ Archive ได้ เนื่องจากมีรอบรับสมัครอ้างอิงอยู่'),
        'ต้องมีข้อความอธิบายสาเหตุแบบ visible',
      );
    } finally {
      await page.unmount();
    }
  });

  // ── T3: DRAFT → ไม่มีปุ่ม Archive ──
  await test('T3: มีทั้ง PUBLISHED และ DRAFT → Archive ปรากฏเฉพาะแถว PUBLISHED (แถว DRAFT มี Delete)', async () => {
    installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED'), makeVersion('ver-2', 2, 'DRAFT')],
      rounds: [],
    });
    const page = await renderBuilder('ADMIN');
    try {
      const count = (label: string) => allButtons().filter((b) => (b.textContent || '').trim() === label).length;
      assertEqual(count('Archive'), 1, 'ปุ่ม Archive ต้องมีแค่แถว PUBLISHED');
      assertEqual(count('Delete'), 1, 'แถว DRAFT ต้องมีปุ่ม Delete');
    } finally {
      await page.unmount();
    }
  });

  // ── T4: ARCHIVED → ไม่มีปุ่ม Archive ──
  await test('T4: มีทั้ง PUBLISHED และ ARCHIVED → Archive ปรากฏเฉพาะแถว PUBLISHED', async () => {
    installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED'), makeVersion('ver-2', 2, 'ARCHIVED')],
      rounds: [],
    });
    const page = await renderBuilder('ADMIN');
    try {
      const count = (label: string) => allButtons().filter((b) => (b.textContent || '').trim() === label).length;
      assertEqual(count('Archive'), 1, 'Archive ต้องมีแค่แถว PUBLISHED (แถว ARCHIVED ห้ามมี)');
      assertEqual(count('View'), 2, 'ทั้งสองแถวต้องมีปุ่ม View (พิสูจน์ว่า render ครบ 2 แถว)');
    } finally {
      await page.unmount();
    }
  });

  // ── T5: VIEWER → ไม่มีปุ่ม Archive ──
  await test('T5: ADMIN เห็นปุ่ม Archive แต่ VIEWER ไม่เห็น (canWrite gate)', async () => {
    installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
    });
    const admin = await renderBuilder('ADMIN');
    let adminCount = -1;
    try {
      adminCount = archiveButtons().length;
    } finally {
      await admin.unmount();
    }
    const viewer = await renderBuilder('VIEWER');
    try {
      assertEqual(adminCount, 1, 'ADMIN ต้องเห็นปุ่ม Archive');
      assertEqual(archiveButtons().length, 0, 'VIEWER ต้องไม่เห็นปุ่ม Archive');
    } finally {
      await viewer.unmount();
    }
  });

  // ── T6: Archive สำเร็จ → PATCH + toast success + reload ──
  await test('T6: ยืนยัน confirm → PATCH archive ถูกยิง → toast success → reload version history', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
    });
    const page = await renderBuilder('ADMIN');
    try {
      assertEqual(fetchCtl.versionsGetCount(), 1, 'โหลดครั้งแรก');
      await clickArchive();

      assertEqual(confirmCalls.length, 1, 'ต้องมี confirm dialog ก่อน archive');
      assert(confirmCalls[0].includes('v1'), 'confirm ต้องระบุ version');
      assert(confirmCalls[0].includes('ผลกระทบ'), 'confirm ต้องระบุผลกระทบ');

      const patches = fetchCtl.patchArchiveCalls();
      assertEqual(patches.length, 1, 'ต้องยิง PATCH archive 1 ครั้ง');
      assert(patches[0].url.includes('/admin/template-versions/ver-1/archive'), 'URL ต้องตรง endpoint');

      assert(toastText().includes('Archive v1 สำเร็จ'), 'ต้องมี toast success');
      assertEqual(fetchCtl.versionsGetCount(), 2, 'ต้อง reload version history หลัง archive');
    } finally {
      await page.unmount();
    }
  });

  // ── T7: ยกเลิก confirm → ไม่ยิง PATCH ──
  await test('T7: กดยกเลิกใน confirm → ไม่มี PATCH', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
    });
    const page = await renderBuilder('ADMIN');
    try {
      const btn = archiveButtons()[0];
      assert(btn, 'ไม่พบปุ่ม Archive');
      confirmResult = false;
      await act(async () => { btn.click(); });
      await settle();

      assertEqual(confirmCalls.length, 1, 'confirm ต้องแสดง');
      assertEqual(fetchCtl.patchArchiveCalls().length, 0, 'ห้ามยิง PATCH เมื่อยกเลิก');
    } finally {
      await page.unmount();
    }
  });

  // ── T8: HTTP 400 (มี rounds) → toast error จาก server ──
  await test('T8: server ตอบ 400 (มีรอบอ้างอิง) → toast error แสดงสาเหตุ', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
      archiveStatus: 400,
      archiveBody: { error: 'Cannot archive version that is referenced by rounds (snapshot policy)', roundsCount: 2 },
    });
    const page = await renderBuilder('ADMIN');
    try {
      await clickArchive();
      assertEqual(fetchCtl.patchArchiveCalls().length, 1, 'PATCH ถูกยิง');
      const toast = toastText();
      assert(toast.includes('ไม่สำเร็จ'), 'ต้องมี toast error');
      assert(toast.includes('อ้างอิงอยู่ 2 รอบ'), `toast ต้องแสดงจำนวนรอบอ้างอิง (got: ${toast})`);
    } finally {
      await page.unmount();
    }
  });

  // ── T9: HTTP 404 → toast error + reload ──
  await test('T9: server ตอบ 404 → toast error และ reload รายการใหม่', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
      archiveStatus: 404,
      archiveBody: { error: 'Version not found' },
    });
    const page = await renderBuilder('ADMIN');
    try {
      assertEqual(fetchCtl.versionsGetCount(), 1, 'โหลดครั้งแรก');
      await clickArchive();
      const toast = toastText();
      assert(toast.includes('ไม่พบ Version'), `toast ต้องบอกว่าไม่พบ version (got: ${toast})`);
      assertEqual(fetchCtl.versionsGetCount(), 2, '404 ต้อง reload รายการใหม่');
    } finally {
      await page.unmount();
    }
  });

  // ── T10: HTTP 409 → toast error conflict ──
  await test('T10: server ตอบ 409 (version ถูกเปลี่ยนสถานะไปก่อน) → toast error', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
      archiveStatus: 409,
      archiveBody: { error: 'Version was changed by another request', reason: 'VERSION_ALREADY_PUBLISHED' },
    });
    const page = await renderBuilder('ADMIN');
    try {
      await clickArchive();
      const toast = toastText();
      assert(toast.includes('ไม่สำเร็จ'), 'ต้องมี toast error');
      assert(toast.includes('ผู้ใช้งานอื่น'), `toast ต้องบอก conflict (got: ${toast})`);
    } finally {
      await page.unmount();
    }
  });

  // ── T11: Network error → toast error ──
  await test('T11: fetch throw (network error) → toast error เชื่อมต่อไม่ได้', async () => {
    const fetchCtl = installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      rounds: [],
      archiveReject: true,
    });
    const page = await renderBuilder('ADMIN');
    try {
      await clickArchive();
      const toast = toastText();
      assert(toast.includes('เชื่อมต่อเซิร์ฟเวอร์'), `toast ต้องบอกว่าเชื่อมต่อไม่ได้ (got: ${toast})`);
    } finally {
      await page.unmount();
    }
  });

  // ── T12: โหลดข้อมูล rounds ไม่สำเร็จ → fail-closed ──
  await test('T12: โหลดข้อมูล rounds ไม่สำเร็จ → ปุ่ม disabled พร้อมข้อความ fail-closed', async () => {
    installFetch({
      versions: [makeVersion('ver-1', 1, 'PUBLISHED')],
      roundsStatus: 500,
    });
    const page = await renderBuilder('ADMIN');
    try {
      const btns = archiveButtons();
      assertEqual(btns.length, 1, 'ปุ่มยังต้องแสดง (แต่ disabled)');
      assertEqual(btns[0].disabled, true, 'ต้อง fail-closed เมื่อตรวจการอ้างอิงไม่ได้');
      assert(
        page.text().includes('ไม่สามารถตรวจสอบการอ้างอิงรอบรับสมัครได้'),
        'ต้องมีข้อความแจ้งว่าตรวจสอบไม่ได้',
      );
    } finally {
      await page.unmount();
    }
  });

  // ── สรุป ──
  console.log('\n=================================================');
  console.log(`ผลรวม: ${passed} ผ่าน / ${failed} พลาด`);
  console.log('=================================================');
  if (failures.length > 0) {
    console.log('\nรายการที่พลาด:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('test harness crash:', e);
  process.exit(1);
});
