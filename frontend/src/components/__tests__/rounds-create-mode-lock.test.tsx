// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Rounds Page — Create Mode False-Lock Regression Tests
 * ============================================================================
 * Bug (production): หน้า "สร้างรอบรับสมัครใหม่" ถูกล็อกตลอดเวลา
 * แสดง "ล็อกชั่วคราว — ตรวจสอบจำนวนผู้สมัครไม่ได้" ทำให้กรอกไม่ได้เลย
 *
 * สาเหตุ: create mode (editing = null) → editingPolicy = null
 *         → effectivePolicy = editingPolicy ?? LOCKED_POLICY → locked = true
 * ทั้งที่ create mode ไม่มีรอบให้ตรวจ policy ตั้งแต่แรก
 *
 * เทสชุดนี้พิสูจน์บน "component จริง" (happy-dom) ว่า
 *
 *   C1. create mode: title / positionLevel กรอกได้ (ไม่ disabled)
 *   C2. create mode: ช่อง roundCode เป็น input จริง (ไม่ใช่ read-only "—")
 *   C3. create mode: ApplicationPatternField อยู่ในโหมดแก้ไข (มี preset card)
 *   C4. create mode: ไม่มีข้อความ lock ใด ๆ ในฟอร์ม
 *   C5. create mode: submit → POST /admin/rounds พร้อม roundCode + pattern
 *
 *   E1. edit mode + policy locked: ยังล็อก (title/positionLevel disabled)
 *   E2. edit mode + policy locked: เหตุผล HAS_APPLICATIONS แสดงถูกต้อง
 *   E3. edit mode + POLICY_UNAVAILABLE: ข้อความ "ล็อกชั่วคราว" ยังแสดงถูกต้อง
 *   E4. edit mode + policy ไม่ล็อก: แก้ได้ (title enabled, roundCode input)
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/rounds-create-mode-lock.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/rounds' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch { /* Node 24 navigator เป็น getter-only */ }
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.localStorage = win.localStorage;
globalAny.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
(globalAny as any).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: string[] = [];
win.alert = (msg: any) => { alerts.push(String(msg)); };
globalAny.alert = win.alert;

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
    const Link = ReactRef.forwardRef((props: any, ref: any) => {
      const { href, children, ...rest2 } = props;
      return ReactRef.createElement('a', { ...rest2, href, ref }, children);
    });
    return { __esModule: true, default: Link };
  }
  return origLoad.call(this, request, ...rest);
};

// ---------- imports ----------
// ⚠️ React ต้องถูก import แบบ dynamic "หลัง" happy-dom ถูกติดตั้งลง globalThis
// แล้วเท่านั้น — ถ้าใช้ static import ข้างบน ReactDOM จะ capture global ของ Node
// (ไม่มี document) ทำให้ event ที่ dispatch ไปไม่ถึง onChange ของ React เลย
// (DOM value เปลี่ยนจริง แต่ state ไม่ขยับ → payload ว่าง)
let React: any;
let createRoot: any;
let act: any;

async function bootstrapReact() {
  if (React) return;
  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react-dom/test-utils'));
}

/** ref ของ React สำหรับ module stub (ตั้งค่าหลัง bootstrap) */
const ReactRef: any = new Proxy({}, {
  get: (_t, prop) => React[prop],
});

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

function encodeJwtPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(role: string, expOffsetSec = 3600): string {
  const payload = { id: 'u1', email: 'a@b.c', role, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return `${encodeJwtPayload({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPayload(payload)}.sig`;
}

// =============================================================================
// Fixtures — numberingPolicy ตามที่ backend แนบมากับ GET /admin/rounds
// =============================================================================

const PUBLISHED_VERSIONS = [
  { id: 'ver-1', versionNumber: 1, status: 'PUBLISHED', templateId: 'tpl-1', templateName: 'แบบฟอร์มทดสอบ' },
];

const POLICY_LOCKED = {
  locked: true,
  reason: 'HAS_APPLICATIONS',
  activeApplicationCount: 3,
  isLegacy: false,
  editable: { applicationPattern: false, roundCode: false },
};

const POLICY_UNAVAILABLE = {
  locked: true,
  reason: 'POLICY_UNAVAILABLE',
  activeApplicationCount: 0,
  isLegacy: false,
  editable: { applicationPattern: false, roundCode: false },
};

const POLICY_EDITABLE = {
  locked: false,
  reason: 'EDITABLE',
  activeApplicationCount: 0,
  isLegacy: false,
  editable: { applicationPattern: true, roundCode: true },
};

function makeRound(overrides: any = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id: 'round-1',
    templateVersionId: 'ver-1',
    templateId: 'tpl-1',
    templateName: 'แบบฟอร์มทดสอบ',
    versionNumber: 1,
    versionStatus: 'PUBLISHED',
    title: 'รอบทดสอบ',
    positionLevel: 'ปฏิบัติการ',
    openDate: nowSec - 86400,
    closeDate: nowSec + 86400 * 30,
    status: 'DRAFT',
    createdAt: nowSec - 3600,
    deletedAt: null,
    applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
    roundCode: 'CHM01',
    numberingPolicy: POLICY_EDITABLE,
    ...overrides,
  };
}

// =============================================================================
// Fetch stub
// =============================================================================

interface FetchCall { url: string; method: string; body: any }

function json(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    clone() { return this; },
  };
}

function installFetch(rounds: any[]) {
  const calls: FetchCall[] = [];
  globalAny.fetch = async (url: string, init: any = {}) => {
    const u = String(url);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init?.body });

    if (u.includes('/admin/rounds-with-version-info')) return json(200, { data: [] });
    if (u.includes('/admin/template-versions/published')) return json(200, { data: PUBLISHED_VERSIONS });
    if (u.includes('/admin/rounds') && method === 'POST') return json(201, { data: { id: 'round-new' } });
    if (u.includes('/admin/rounds')) return json(200, { data: rounds });
    return json(404, {});
  };
  return calls;
}

// =============================================================================
// Render + interaction helpers
// =============================================================================

async function settle(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let currentRoot: any = null;

async function renderRoundsPage(rounds: any[] = []) {
  await bootstrapReact();
  const calls = installFetch(rounds);

  win.localStorage.clear();
  win.localStorage.setItem('adminToken', makeToken('ADMIN'));
  alerts.length = 0;
  win.document.body.innerHTML = '';

  const mod = await import('../../app/(admin)/admin/rounds/page');
  const RoundsPage = mod.default;

  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);
  currentRoot = root;

  await act(async () => {
    root.render(React.createElement(RoundsPage));
  });
  await settle(150);

  return { calls, container };
}

async function unmountCurrent() {
  if (currentRoot) {
    await act(async () => currentRoot.unmount());
    currentRoot = null;
  }
  win.document.body.innerHTML = '';
}

function byId(id: string) {
  return win.document.querySelector(`#${id}`) as any;
}

function setNativeValue(el: any, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

async function typeInto(el: any, value: string) {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
}

async function selectOption(el: any, value: string) {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  });
}

async function clickEl(el: any) {
  await act(async () => { el.click(); });
  await settle(80);
}

/** เปิด dialog สร้างรอบใหม่จากปุ่ม header */
async function openCreateDialog() {
  const buttons = Array.from(win.document.querySelectorAll('button'));
  const createBtn = buttons.find((b) => (b.textContent || '').includes('สร้างรอบใหม่'));
  assert(createBtn, 'ต้องพบปุ่ม "+ สร้างรอบใหม่"');
  await clickEl(createBtn);
}

/** เปิด dialog แก้ไขจาก ActionMenu ของแถวแรก */
async function openEditDialog() {
  const trigger = win.document.querySelector('button[aria-haspopup="menu"]');
  assert(trigger, 'ต้องพบปุ่ม ActionMenu ของแถว');
  await clickEl(trigger);

  const items = Array.from(win.document.querySelectorAll('[role="menuitem"]'));
  const editItem = items.find((el) => (el.textContent || '').includes('แก้ไข'));
  assert(editItem, `ต้องพบเมนู "แก้ไข" (พบ ${items.length} รายการ)`);
  await clickEl(editItem);
  await settle(80);
}

function bodyText() {
  return win.document.body.textContent || '';
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  // ---------------------------------------------------------------------------
  console.log('\n── Create mode: ต้องไม่ถูกล็อก (bug หลัก) ──');
  // ---------------------------------------------------------------------------

  await test('C1: create mode — title และ positionLevel กรอกได้ (ไม่ disabled)', async () => {
    await renderRoundsPage([]);
    await openCreateDialog();

    const title = byId('title');
    const positionLevel = byId('positionLevel');
    assert(title, 'ต้องพบ input #title');
    assert(positionLevel, 'ต้องพบ input #positionLevel');
    assertEqual(title.disabled, false, '#title ต้องไม่ถูก disable ใน create mode');
    assertEqual(positionLevel.disabled, false, '#positionLevel ต้องไม่ถูก disable ใน create mode');

    await unmountCurrent();
  });

  await test('C2: create mode — roundCode เป็น input จริง (ไม่ใช่ read-only "—")', async () => {
    await renderRoundsPage([]);
    await openCreateDialog();

    const roundCode = byId('roundCode');
    assert(roundCode, 'ต้องพบ input #roundCode ใน create mode (ไม่ใช่บล็อก read-only)');
    assertEqual(roundCode.disabled, false, '#roundCode ต้องกรอกได้');
    assertEqual(roundCode.readOnly, false, '#roundCode ต้องไม่เป็น readOnly');

    await unmountCurrent();
  });

  await test('C3: create mode — ApplicationPatternField อยู่ในโหมดแก้ไข (มี preset card)', async () => {
    await renderRoundsPage([]);
    await openCreateDialog();

    // preset "custom" มี sample text เป็น ASCII → ใช้เป็น marker ว่า field ไม่ถูก lock
    assert(bodyText().includes('Custom Pattern'), 'ต้องเห็น preset card (field ไม่ถูก lock)');
    assert(byId('applicationPattern'), 'ต้องพบ input #applicationPattern');

    await unmountCurrent();
  });

  await test('C4: create mode — ไม่มีข้อความ lock ใด ๆ ในฟอร์ม', async () => {
    await renderRoundsPage([]);
    await openCreateDialog();

    const text = bodyText();
    assert(!text.includes('ล็อกชั่วคราว'), 'ต้องไม่พบ "ล็อกชั่วคราว" ใน create mode');
    assert(!text.includes('ตรวจสอบจำนวนผู้สมัครไม่ได้'), 'ต้องไม่พบ "ตรวจสอบจำนวนผู้สมัครไม่ได้"');
    assert(!text.includes('ล็อกเนื่องจากมีผู้สมัครแล้ว'), 'ต้องไม่พบข้อความล็อกเนื่องจากมีผู้สมัคร');

    await unmountCurrent();
  });

  await test('C5: create mode — submit ยิง POST /admin/rounds พร้อม roundCode + applicationPattern', async () => {
    const { calls } = await renderRoundsPage([]);
    await openCreateDialog();

    assert(byId('roundCode'), 'ต้องพบ input #roundCode ก่อน submit (create mode ต้องกรอกได้)');
    await typeInto(byId('title'), 'รอบใหม่ทดสอบ');
    await typeInto(byId('positionLevel'), 'ชำนาญการ');
    await typeInto(byId('roundCode'), 'NEW01');
    await typeInto(byId('openDate'), '2026-12-01T09:00');
    await typeInto(byId('closeDate'), '2026-12-31T17:00');
    await selectOption(byId('templateVersionId'), 'ver-1');

    const form = win.document.querySelector('form');
    assert(form, 'ต้องพบ <form>');
    await act(async () => {
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle(150);

    const postCalls = calls.filter((c) => c.method === 'POST' && c.url.includes('/admin/rounds'));
    assertEqual(postCalls.length, 1, 'ต้องยิง POST /admin/rounds 1 ครั้ง');
    const payload = JSON.parse(postCalls[0].body);
    assertEqual(payload.roundCode, 'NEW01', 'payload.roundCode');
    assertEqual(payload.title, 'รอบใหม่ทดสอบ', 'payload.title');
    assertEqual(payload.positionLevel, 'ชำนาญการ', 'payload.positionLevel');
    assertEqual(payload.templateVersionId, 'ver-1', 'payload.templateVersionId');
    assert(payload.applicationPattern, 'payload.applicationPattern ต้องไม่ว่าง');
    assertEqual(alerts.length, 0, `ต้องไม่มี alert error (ได้: ${alerts.join(' | ')})`);

    await unmountCurrent();
  });

  // ---------------------------------------------------------------------------
  console.log('\n── Edit mode: ต้องยังทำงานเหมือนเดิม (ไม่ regress) ──');
  // ---------------------------------------------------------------------------

  await test('E1: edit mode + policy locked — ยังล็อก (title/positionLevel disabled)', async () => {
    await renderRoundsPage([makeRound({ numberingPolicy: POLICY_LOCKED })]);
    await openEditDialog();

    assertEqual(byId('title').disabled, true, '#title ต้องถูก disable เมื่อ policy locked');
    assertEqual(byId('positionLevel').disabled, true, '#positionLevel ต้องถูก disable เมื่อ policy locked');
    assert(!byId('roundCode'), 'ต้องไม่มี input #roundCode เมื่อล็อก (แสดง read-only แทน)');

    await unmountCurrent();
  });

  await test('E2: edit mode + policy locked — เหตุผล HAS_APPLICATIONS แสดงถูกต้อง', async () => {
    await renderRoundsPage([makeRound({ numberingPolicy: POLICY_LOCKED })]);
    await openEditDialog();

    const text = bodyText();
    assert(text.includes('รอบนี้มีผู้สมัครแล้ว 3 คน'), 'ต้องแสดงจำนวนผู้สมัครจาก policy');
    assert(text.includes('ล็อกเนื่องจากมีผู้สมัครแล้ว'), 'ต้องแสดงเหตุผล HAS_APPLICATIONS');
    assert(!text.includes('ล็อกชั่วคราว'), 'ต้องไม่ใช่ข้อความ POLICY_UNAVAILABLE');

    await unmountCurrent();
  });

  await test('E3: edit mode + POLICY_UNAVAILABLE — ข้อความ "ล็อกชั่วคราว" ยังแสดงถูกต้อง', async () => {
    await renderRoundsPage([makeRound({ numberingPolicy: POLICY_UNAVAILABLE })]);
    await openEditDialog();

    const text = bodyText();
    assert(text.includes('ไม่สามารถตรวจสอบจำนวนผู้สมัครได้'), 'ต้องแสดงหัวข้อ POLICY_UNAVAILABLE');
    assert(
      text.includes('ล็อกชั่วคราว — ตรวจสอบจำนวนผู้สมัครไม่ได้'),
      'ต้องแสดงข้อความ lock ของ POLICY_UNAVAILABLE',
    );
    assertEqual(byId('title').disabled, true, 'POLICY_UNAVAILABLE ต้องยัง fail-closed');

    await unmountCurrent();
  });

  await test('E4: edit mode + policy ไม่ล็อก — แก้ได้ (title enabled, roundCode input)', async () => {
    await renderRoundsPage([makeRound({ numberingPolicy: POLICY_EDITABLE })]);
    await openEditDialog();

    assertEqual(byId('title').disabled, false, '#title ต้องแก้ได้เมื่อ policy ไม่ล็อก');
    assertEqual(byId('positionLevel').disabled, false, '#positionLevel ต้องแก้ได้เมื่อ policy ไม่ล็อก');
    const roundCode = byId('roundCode');
    assert(roundCode, 'ต้องพบ input #roundCode เมื่อ policy ไม่ล็อก');
    assertEqual(roundCode.disabled, false, '#roundCode ต้องแก้ได้');
    assert(!bodyText().includes('ล็อกชั่วคราว'), 'ต้องไม่พบข้อความล็อก');

    await unmountCurrent();
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
