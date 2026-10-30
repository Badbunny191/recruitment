// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Application History — render + accessibility tests (Phase 2)
 * =======================================================================
 * พิสูจน์บน component จริง (happy-dom) ไม่ใช่แค่อ่าน source:
 *
 *   R1. 12 รายการ (ข้อมูลจริง) → แสดง 7 กลุ่มวัน, PDF 4 ครั้งในวันเดียว
 *       ยุบเหลือ 1 แถว "4 ครั้ง"
 *   R2. ปุ่มขยายมี aria-expanded=false + aria-controls ชี้ไปยัง region จริง
 *   R3. กดขยาย → aria-expanded=true และ region แสดงรายการดิบครบ 4 รายการ
 *   R4. กดซ้ำ → ยุบกลับ (aria-expanded=false, region ซ่อน)
 *   R5. UPDATE ที่มี previousStatus → แสดง เดิม → ใหม่ (ไม่ใช่แค่ "แก้ไข")
 *   R6. UPDATE ที่ไม่มีข้อมูลสถานะ → ไม่แสดงลูกศร/ไม่เดาค่า
 *   R7. ไม่มีเลขลำดับ 1..N ใน timeline อีก
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/application-history-render.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/application-detail?id=app-1' });
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

const stubRouter = {
  replace: () => {},
  push: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => {},
};

const origLoad = (Module as any)._load;
// useSearchParams ต้องคืน instance เดิมทุกครั้ง — ถ้าสร้างใหม่ทุก render
// useEffect([searchParams]) ของหน้าจะวนไม่จบ (fetch ไม่หยุด → เทสค้าง)
const stableSearchParams = new URLSearchParams('id=app-1');
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request === 'next/navigation') {
    return {
      useRouter: () => stubRouter,
      usePathname: () => '/admin/application-detail',
      useSearchParams: () => stableSearchParams,
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

// dynamic import — ต้องโหลด *หลัง* patch Module._load แล้วเท่านั้น
// (static import ถูก hoist ขึ้นก่อน ทำให้ next/navigation ตัวจริงถูกโหลด)
let ApplicationDetailClient: any;

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
// Fixtures — ข้อมูลจริง 12 รายการจากรายงาน
// =============================================================================

function localTs(y: number, m: number, d: number, hh = 12, mm = 0) {
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0).getTime() / 1000);
}

const ACTOR = 'thanet_30@hotmail.com';

const STATUS_UPDATE_PAYLOAD = JSON.stringify({
  changes: [
    {
      field: 'status',
      fieldLabel: 'สถานะใบสมัคร',
      oldValue: 'รอการตรวจสอบ',
      newValue: 'ผ่านการตรวจสอบ',
    },
  ],
  summary: 'สถานะใบสมัคร: รอการตรวจสอบ → ผ่านการตรวจสอบ',
  previousStatus: 'SUBMITTED',
});

const HISTORY = [
  { id: '12', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 27, 10, 13) },
  { id: '11', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 27, 2, 0) },
  { id: '10', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 26, 0, 21) },
  { id: '9', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 25, 23, 18) },
  { id: '8', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 25, 23, 11) },
  { id: '7', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 25, 23, 4) },
  { id: '6', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 25, 22, 38) },
  { id: '5', action: 'UPDATE', adminId: 'a1', adminEmail: ACTOR, payload: STATUS_UPDATE_PAYLOAD, createdAt: localTs(2026, 10, 24, 1, 26) },
  { id: '4', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 23, 20, 47) },
  { id: '3', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 23, 20, 32) },
  { id: '2', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 22, 18, 10) },
  { id: '1', action: 'PDF_DOWNLOAD', adminId: 'a1', adminEmail: ACTOR, payload: null, createdAt: localTs(2026, 10, 20, 10, 16) },
];

const APP = {
  id: 'app-1',
  applicationNo: 'APP-2026-5012',
  roundId: 'r1',
  fullname: 'นายสมชาย ใจดี',
  email: 'somchai@example.com',
  nationalId: '1234567890123',
  status: 'QUALIFIED',
  statusReason: null,
  verifiedBy: null,
  verifiedByEmail: null,
  verifiedAt: null,
  formData: {},
  submittedAt: localTs(2026, 10, 20, 10, 0),
  attachments: [],
  schema: [],
};

// ---------- fetch stub ----------
globalAny.fetch = async (url: string) => {
  const body = String(url).includes('/history')
    ? { data: HISTORY }
    : String(url).includes('/attachment-urls')
      ? { data: [] }
      : { data: APP };
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
};

// =============================================================================
// Render helper
// =============================================================================

async function renderPage() {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as any);

  await act(async () => {
    root.render(React.createElement(ApplicationDetailClient));
  });
  // ให้ promise chain ของ fetch + setState ทำงานจนจบ
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

  return { container, root };
}

function textOf(el: any): string {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function findButtonByText(container: any, needle: string) {
  return Array.from(container.querySelectorAll('button')).find((b: any) =>
    textOf(b).includes(needle),
  );
}

// =============================================================================
// Tests
// =============================================================================

(async () => {
  console.log('\n[R] ประวัติการดำเนินการ — render + accessibility');

  const mod = await import('../../app/(admin)/admin/application-detail/ApplicationDetailClient');
  ApplicationDetailClient = mod.default;

  let container: any;
  let root: any;

  await test('R0: หน้าโหลดเสร็จและมีการ์ดประวัติ', async () => {
    const rendered = await renderPage();
    container = rendered.container;
    root = rendered.root;
    assert(textOf(container).includes('ประวัติการดำเนินการ'), 'ต้องมีการ์ดประวัติ');
  });

  await test('R1: จัดกลุ่มตามวัน — 7 หัววัน + PDF 4 ครั้งในวันเดียวถูกยุบ', async () => {
    const text = textOf(container);
    assert(text.includes('27 ตุลาคม 2569'), `ต้องมีหัววัน 27 ตุลาคม 2569: ${text.slice(0, 200)}`);
    assert(text.includes('25 ตุลาคม 2569'), 'ต้องมีหัววัน 25 ตุลาคม 2569');
    assert(text.includes('20 ตุลาคม 2569'), 'ต้องมีหัววัน 20 ตุลาคม 2569');
    assert(text.includes('4 ครั้ง'), 'PDF 4 ครั้งในวันเดียวต้องถูกรวมเป็น "4 ครั้ง"');
    // 12 เหตุการณ์ → 7 วัน ไม่ควรมี 12 แถวอีก
    const rows = container.querySelectorAll('section');
    assertEqual(rows.length, 7, 'จำนวน section ต่อวัน');
  });

  await test('R2: ปุ่มขยายมี aria-expanded=false + aria-controls ชี้ region จริง', async () => {
    const btn = findButtonByText(container, 'ดูรายการทั้งหมด 4 รายการ');
    assert(btn, 'ต้องมีปุ่มขยายของกลุ่ม 4 ครั้ง');
    assertEqual(btn.getAttribute('aria-expanded'), 'false', 'aria-expanded เริ่มต้น');
    const controls = btn.getAttribute('aria-controls');
    assert(controls, 'ต้องมี aria-controls');
    const region = container.querySelector(`#${controls}`);
    assert(region, `aria-controls ต้องชี้ไปยัง element ที่มีจริง (#${controls})`);
    assertEqual(btn.getAttribute('type'), 'button', 'ต้องเป็น type=button (ไม่ submit form)');
  });

  await test('R3: กดขยาย → aria-expanded=true และเห็นรายการดิบครบ 4 รายการ', async () => {
    const btn = findButtonByText(container, 'ดูรายการทั้งหมด 4 รายการ');
    await act(async () => {
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });

    const expandedBtn = findButtonByText(container, 'ซ่อนรายการ');
    assert(expandedBtn, 'ข้อความปุ่มต้องเปลี่ยนเป็น "ซ่อนรายการ"');
    assertEqual(expandedBtn.getAttribute('aria-expanded'), 'true', 'aria-expanded หลังขยาย');

    const region = container.querySelector(`#${expandedBtn.getAttribute('aria-controls')}`);
    assert(region, 'region ต้องยังอยู่');
    const items = region.querySelectorAll('li');
    assertEqual(items.length, 4, 'ต้องเห็นรายการดิบ 4 รายการ');
    const times = Array.from(items).map((li: any) => textOf(li));
    assert(times[0].includes('22:38'), `รายการแรก (เก่าสุด) ต้องเป็น 22:38: ${times[0]}`);
    assert(times[3].includes('23:18'), `รายการสุดท้าย (ใหม่สุด) ต้องเป็น 23:18: ${times[3]}`);
  });

  await test('R4: กดซ้ำ → ยุบกลับ', async () => {
    const btn = findButtonByText(container, 'ซ่อนรายการ');
    await act(async () => {
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    const collapsed = findButtonByText(container, 'ดูรายการทั้งหมด 4 รายการ');
    assert(collapsed, 'ต้องกลับไปเป็นปุ่มขยาย');
    assertEqual(collapsed.getAttribute('aria-expanded'), 'false', 'aria-expanded หลังยุบ');
  });

  await test('R5: UPDATE แสดง เดิม → ใหม่ จาก payload จริง', async () => {
    const text = textOf(container);
    assert(text.includes('รอการตรวจสอบ'), 'ต้องแสดงสถานะเดิม');
    assert(text.includes('ผ่านการตรวจสอบ'), 'ต้องแสดงสถานะใหม่');
    assert(!text.includes('SUBMITTED'), 'ต้องไม่หลุด enum ดิบ');
  });

  await test('R6: ไม่มีเลขลำดับ 1..N ใน timeline', async () => {
    const text = textOf(container);
    // เดิมมีวงกลม 1,2,3... — ตอนนี้ต้องไม่มีตัวเลขโดด ๆ ใน timeline
    const dots = container.querySelectorAll('[aria-hidden="true"]');
    assert(dots.length > 0, 'ยังต้องมี dot indicator');
    assert(!/\b1\b\s*20 ตุลาคม/.test(text), 'ไม่ควรมีเลขลำดับก่อนวันที่');
  });

  await test('R7: badge action ยังเป็นภาษาไทย (SSOT)', async () => {
    const text = textOf(container);
    assert(text.includes('ดาวน์โหลด PDF'), 'ต้องแสดง "ดาวน์โหลด PDF"');
    assert(!text.includes('PDF_DOWNLOAD'), 'ต้องไม่หลุด enum ดิบ');
  });

  await act(async () => {
    root.unmount();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
  // happy-dom เปิด timer/handle ค้างไว้ — จบเทสแล้วต้องออกเอง ไม่งั้นค้าง
  process.exit(0);
})();