// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * FULL PAGE Reproduction — /apply กับ roundId ที่ไม่มีอยู่จริง (backend 404)
 * =======================================================================
 * Backend GET /public/rounds/:id/schema ตอบ 404 ({ error: 'Not found' })
 * ถูกต้องแล้ว (public.routes.ts:265) — หน้า /apply ต้อง render Error State
 * เต็มรูปแบบ "ไม่พบรอบรับสมัคร" + ปุ่มกลับ และห้ามเหลือฟอร์ม / ปุ่ม
 * "ตรวจสอบข้อมูล" / "ล้างข้อมูลทั้งหมด" ให้ผู้ใช้เข้าใจผิดว่ายังสมัครได้
 *
 * โค้ดเดิม (bug): 404 หลุดเข้า .catch → alert + setLoading(false)
 * → schema ยังเป็น [] → render "ไม่พบฟิลด์ในแบบฟอร์ม" พร้อมปุ่มครบ
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/apply-round-not-found.test.tsx
 */
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/apply?id=round-test' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch {}
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

const alerted: string[] = [];
win.alert = (m: string) => { alerted.push(String(m)); };
// page.tsx เรียก bare `alert(...)` — ใน Node global ต้อง stub ที่ globalThis ด้วย
globalAny.alert = (m: string) => { alerted.push(String(m)); };
win.confirm = () => true;

// ---------- mock next/navigation ก่อน import page ----------
import Module from 'node:module';
const require = Module.createRequire(import.meta?.url ?? __filename);
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'next/navigation') {
    return require.resolve('./__mocks__/next-navigation.ts');
  }
  return origResolve.call(this, request, ...args);
};

// ---------- fetch stub ----------
const FETCH_CALLS: string[] = [];
const SCHEMA_200 = {
  data: {
    sections: [],
    fields: [
      { fieldId: 'field-name', type: 'TEXT', label: 'ชื่อ-นามสกุล', isRequired: false },
    ],
  },
};

// mode 'not-found' = /schema ตอบ 404 ตรงตาม backend จริง (public.routes.ts:265)
// mode 'ok'        = positive control — schema ปกติ ต้องได้ฟอร์มครบ
function installFetch(mode: 'not-found' | 'ok') {
  globalAny.fetch = async (url: string, init: any = {}) => {
    FETCH_CALLS.push(String(url));
    if (url.includes('/master-data/organizations')) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    if (url.includes('/rounds/round-test/schema')) {
      if (mode === 'not-found') {
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
      }
      return { ok: true, status: 200, json: async () => SCHEMA_200 };
    }
    if (url.includes('/rounds/round-test/detail')) {
      if (mode === 'not-found') {
        return { ok: false, status: 404, json: async () => ({ success: false, error: 'ไม่พบรอบรับสมัคร' }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'round-test', title: 'ทดสอบ', status: 'ACTIVE' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
}

// ---------- imports (หลัง mock) ----------
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let ApplicationFormPage: any;
let routerCalls: Array<[string, string]>;

let passed = 0, failed = 0;
const failures: string[] = [];
const assert = (c: any, m: string) => { if (!c) throw new Error(m); };

let container: HTMLElement | null = null;
let root: Root | null = null;
function mount(el: React.ReactElement) {
  container = win.document.createElement('div');
  win.document.body.appendChild(container);
  root = createRoot(container!);
  act(() => { root!.render(el); });
}
function unmount() {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null; root = null;
}
const flush = () => new Promise((r) => setTimeout(r, 25));
async function flushAll() {
  await act(async () => { await flush(); await flush(); await flush(); });
}
const text = () => container?.textContent ?? '';
const buttons = () => Array.from(win.document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
function clickButtonByText(label: string) {
  const btns = Array.from(win.document.querySelectorAll('button'));
  const btn = btns.find((b) => (b.textContent || '').trim() === label);
  if (!btn) throw new Error(`ไม่พบปุ่ม "${label}" (มี: ${btns.map((b) => b.textContent?.trim()).join(' | ')})`);
  act(() => { btn.click(); });
}

// ข้อความที่ห้ามปรากฏบนหน้าเมื่อ round ไม่มีอยู่จริง
const FORBIDDEN_STRINGS = [
  'ตรวจสอบข้อมูล',            // ปุ่ม submit ของฟอร์ม
  'ล้างข้อมูลทั้งหมด',         // ปุ่ม reset ของฟอร์ม
  'ไม่พบฟิลด์ในแบบฟอร์ม',      // empty-schema placeholder (สถานะปัจจุบันที่ผิด)
  'ใบสมัครคัดเลือกบุคลากร',    // CardTitle ของฟอร์ม
];
const NOT_FOUND_TITLE = 'ไม่พบรอบรับสมัคร';
const NOT_FOUND_DESC = 'รอบรับสมัครที่ต้องการอาจถูกลบ';

console.log('\n═══ /apply round-not-found (backend 404) reproduction ═══\n');

void (async () => {
  const pageModule = await import('../../app/(public)/apply/page');
  ApplicationFormPage = pageModule.default;
  const navMock = await import('./__mocks__/next-navigation');
  routerCalls = navMock.routerCalls;

// ── N1: schema 404 → Error State เต็มรูปแบบ ห้ามมีฟอร์ม/ปุ่มใดเหลือ ──
try {
  console.log('── N1: schema 404 → ต้องแสดง "ไม่พบรอบรับสมัคร" ไม่มีฟอร์ม/ปุ่มสมัคร ──');
  (win.sessionStorage as any).clear?.();
  alerted.length = 0;
  routerCalls.length = 0;
  FETCH_CALLS.length = 0;
  installFetch('not-found');

  mount(<ApplicationFormPage />);
  await flushAll();

  console.log('  schema เรียกจริง?', FETCH_CALLS.some((u) => u.includes('/rounds/round-test/schema')));
  console.log('  title แสดง?', text().includes(NOT_FOUND_TITLE), '| desc?', text().includes(NOT_FOUND_DESC));
  console.log('  ปุ่มทั้งหมด:', buttons().join(' | '));

  assert(FETCH_CALLS.some((u) => u.includes('/rounds/round-test/schema')), 'N1-0: ต้องเรียก /schema จริง');
  assert(text().includes(NOT_FOUND_TITLE), 'N1-1 [CRITICAL]: ต้องแสดงหัวข้อ "ไม่พบรอบรับสมัคร"');
  assert(text().includes(NOT_FOUND_DESC), 'N1-2: ต้องแสดงคำอธิบายสาเหตุ');
  assert(buttons().includes('กลับหน้าแรก'), 'N1-3: ต้องมีปุ่ม "กลับหน้าแรก"');
  assert(buttons().includes('← กลับหน้ารายการรอบรับสมัคร'), 'N1-4: ต้องมีปุ่มกลับ "← กลับหน้ารายการรอบรับสมัคร" (text link มาตรฐาน)');
  for (const f of FORBIDDEN_STRINGS) {
    assert(!text().includes(f), `N1-5 [CRITICAL]: ห้ามแสดง "${f}" เมื่อ round ไม่มีอยู่จริง`);
  }
  assert(!buttons().includes('← กลับหน้ารอบรับสมัคร'), 'N1-5b: Error State เต็มรูปแบบ ต้องไม่ render ApplyBackBar (text link "กลับหน้ารอบรับสมัคร" ของฟอร์ม)');
  assert(!alerted.some((a) => a.includes('ไม่สามารถโหลดแบบฟอร์มได้')), 'N1-6: ห้าม alert "ไม่สามารถโหลดแบบฟอร์มได้: HTTP 404" (ต้องเป็น error page แทน)');
  assert(routerCalls.every(([kind]) => kind !== 'push' || !String(routerCalls).includes('/apply/review')), 'N1-7: ต้องไม่พาไปหน้า review');

  unmount();
  passed++;
  console.log('✓ N1 error state เต็มรูปแบบ ไม่มีฟอร์ม\n');
} catch (e) {
  failed++; failures.push('N1: ' + (e as Error).message);
  console.log('✗ N1: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── N2: ปุ่มกลับต้อง navigate จริงผ่าน router ──
try {
  console.log('── N2: ปุ่มกลับต้อง router.push จริง ──');
  (win.sessionStorage as any).clear?.();
  routerCalls.length = 0;
  installFetch('not-found');

  mount(<ApplicationFormPage />);
  await flushAll();
  assert(text().includes(NOT_FOUND_TITLE), 'N2-0: ต้องอยู่บน error page ก่อน');

  clickButtonByText('กลับหน้าแรก');
  await flushAll();
  assert(routerCalls.some(([kind, href]) => kind === 'push' && href === '/'), 'N2-1 [CRITICAL]: "กลับหน้าแรก" ต้อง push "/"');

  clickButtonByText('← กลับหน้ารายการรอบรับสมัคร');
  await flushAll();
  assert(routerCalls.some(([kind, href]) => kind === 'push' && href.startsWith('/') && href.includes('#')), 'N2-2: "← กลับหน้ารายการรอบรับสมัคร" ต้อง push ไปยังหน้ารายการรอบ (anchor)');

  unmount();
  passed++;
  console.log('✓ N2 ปุ่มกลับ navigate จริง\n');
} catch (e) {
  failed++; failures.push('N2: ' + (e as Error).message);
  console.log('✗ N2: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── N3: positive control — schema 200 ต้องได้ฟอร์มปกติ (พิสูจน์ harness) ──
try {
  console.log('── N3: positive control — schema 200 ต้องได้ฟอร์มครบ ──');
  (win.sessionStorage as any).clear?.();
  alerted.length = 0;
  installFetch('ok');

  mount(<ApplicationFormPage />);
  await flushAll();

  console.log('  ฟอร์มแสดง?', text().includes('ใบสมัครคัดเลือกบุคลากร'), '| ปุ่ม:', buttons().join(' | '));
  assert(text().includes('ใบสมัครคัดเลือกบุคลากร'), 'N3-1: schema 200 ต้อง render ฟอร์ม');
  assert(buttons().includes('ตรวจสอบข้อมูล'), 'N3-2: schema 200 ต้องมีปุ่ม "ตรวจสอบข้อมูล"');
  assert(buttons().includes('ล้างข้อมูลทั้งหมด'), 'N3-3: schema 200 ต้องมีปุ่ม "ล้างข้อมูลทั้งหมด"');
  assert(text().includes('ชื่อ-นามสกุล'), 'N3-4: field จาก schema ต้อง render');

  unmount();
  passed++;
  console.log('✓ N3 schema ปกติได้ฟอร์มครบ (harness ถูกต้อง)\n');
} catch (e) {
  failed++; failures.push('N3: ' + (e as Error).message);
  console.log('✗ N3: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('จบ reproduction suite\n');
})();
