// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Application Success Page UX — record write (review) + render (success)
 * =======================================================================
 * แผน FE-only (ไม่แตะ backend / API contract):
 *   - review page เขียน record 6 field ลง sessionStorage['lastSubmittedApplication']:
 *       { appNo, email, phone, fullname, roundId, roundTitle, positionLevel }
 *       · fullname  ← draft.formData['field-fullname'] (backend บังคับ 400 ถ้าว่าง
 *                     จึงมีเสมอในใบที่ submit สำเร็จ)
 *       · roundId   ← draft.roundId
 *       · roundTitle/positionLevel ← GET /public/rounds/:id/detail (endpoint เดิม)
 *   - success page แสดง: เลขที่ใบสมัคร / ชื่อผู้สมัคร / ตำแหน่งที่สมัคร /
 *     รอบรับสมัคร / อีเมล / เบอร์โทรศัพท์ + กล่องคำแนะนำแสดง "ค่าจริง" ของ
 *     3 คีย์ค้นหา (format รอบ = "{title} ({positionLevel})" เหมือน dropdown หน้า
 *     /lookup) + ข้อความ "ผ่านหน้าค้นหาใบสมัคร" (public layout ไม่มี nav menu)
 *
 * ครอบคลุม:
 *   R1: submit สำเร็จ → record ครบ 6 field + ลบ draft + push /apply/success
 *   R2: fetch detail ล้ม (500) → ยังเขียน record (roundTitle/positionLevel ว่าง)
 *       และห้ามบล็อก submit
 *   S1: record ใหม่ → แสดงครบ + กล่องคำแนะนำโชว์ค่าจริง + ไม่มีคำว่า "เมนู"
 *   S2: record รูปแบบเก่า (appNo/email/phone) → ไม่ crash, ซ่อนแถวที่ไม่มี
 *   S3: ไม่มี record → empty state ใช้คำว่า "หน้า" ไม่ใช่ "เมนู"
 *   S4: positionLevel ว่าง → fallback title (parity กับ applicant-lookup.service)
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/apply-success-page.test.tsx
 */
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/apply/review' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
// success page ใช้ bare sessionStorage (ไม่ผ่าน window.) — ต้อง set ระดับ global
globalAny.sessionStorage = win.sessionStorage;
globalAny.localStorage = win.localStorage;
try { globalAny.navigator = win.navigator; } catch {}
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;
win.alert = () => {};
win.confirm = () => true;
win.open = () => null;

import Module from 'node:module';
const require = Module.createRequire(import.meta?.url ?? __filename);
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'next/navigation') return require.resolve('./__mocks__/next-navigation.ts');
  if (request === 'next/link') return require.resolve('./__mocks__/next-link.tsx');
  return origResolve.call(this, request, ...args);
};

// ---------- scenario-controllable fetch ----------
const state = {
  detailFail: false,
  detailOmitPositionLevel: false,
  submitCalls: [] as any[],
};
const ROUND = 'round-test';
globalAny.fetch = async (url: string, init: any = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const body = (obj: any, status = 200) => ({ ok: true, status, json: async () => obj });
  if (url.includes('/public/config')) return body({ data: { turnstile: { enabled: false, siteKey: '' } } });
  if (url.includes(`/rounds/${ROUND}/schema`)) {
    return body({
      data: {
        sections: [],
        fields: [
          { fieldId: 'field-fullname', type: 'TEXT', label: 'ชื่อ-นามสกุล', isRequired: true },
          { fieldId: 'field-email', type: 'TEXT', label: 'อีเมล', isRequired: true },
          { fieldId: 'field-phone', type: 'TEXT', label: 'เบอร์โทรศัพท์', isRequired: true },
        ],
      },
    });
  }
  if (url.includes(`/rounds/${ROUND}/detail`)) {
    if (state.detailFail) return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) };
    return body({
      success: true,
      data: {
        id: ROUND,
        title: 'สอบ 2569',
        positionLevel: state.detailOmitPositionLevel ? '' : 'นักวิเคราะห์นโยบาย',
        status: 'ACTIVE',
      },
    });
  }
  if (url.includes('/public/applications/submit') && method === 'POST') {
    state.submitCalls.push(JSON.parse(init.body));
    return body({ success: true, data: { applicationNo: 'APP-2569-0001' } }, 201);
  }
  return body({ data: [] });
};

// ---------- imports (หลัง mock) ----------
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { routerCalls } from './__mocks__/next-navigation';

let applyDraft: any, ReviewPage: any, SuccessPage: any;

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
const assert = (c: any, m: string) => { if (!c) throw new Error(m); };

function setChecked(input: any, value: boolean) {
  // React 18 controlled checkbox: native setter + click dispatch (onChange)
  const setter = Object.getOwnPropertyDescriptor((win as any).HTMLInputElement.prototype, 'checked').set;
  setter.call(input, value);
  act(() => { input.dispatchEvent(new (win as any).Event('click', { bubbles: true })); });
}
function clickButtonByText(label: string) {
  const btns = Array.from(win.document.querySelectorAll('button')) as any[];
  const btn = btns.find((b) => (b.textContent || '').trim().includes(label) && !b.disabled);
  if (!btn) throw new Error(`ไม่พบปุ่ม "${label}" (มี: ${btns.map((b) => `${b.textContent?.trim()}${b.disabled ? '[disabled]' : ''}`).join(' | ')})`);
  act(() => { btn.click(); });
}
function readRecord(): any {
  const raw = win.sessionStorage.getItem('lastSubmittedApplication');
  return raw ? JSON.parse(raw) : null;
}
function seedDraft() {
  applyDraft.saveApplyDraft({
    roundId: ROUND,
    formData: {
      'field-fullname': 'สมชาย ใจดี',
      'field-email': 'somchai@example.com',
      'field-phone': '0812345678',
    },
    attachments: [],
    submissionToken: 'tok-success-1',
  });
}
async function submitThroughReview() {
  mount(<ReviewPage />);
  await flushAll();
  const cb = win.document.getElementById('confirm') as any;
  assert(cb, 'ต้องมี checkbox ยืนยัน (id=confirm)');
  setChecked(cb, true);
  await flushAll();
  clickButtonByText('ยืนยันส่งใบสมัคร');
  // submit → 201 → เขียน record → clear draft/token → router.push
  await flushAll();
  await flushAll();
}

let passed = 0, failed = 0;
const failures: string[] = [];

void (async () => {
console.log('\n═══ Application Success Page UX — record + render ═══\n');

applyDraft = await import('../../lib/applyDraft');
ReviewPage = (await import('../../app/(public)/apply/review/page')).default;
SuccessPage = (await import('../../app/(public)/apply/success/page')).default;

// ── R1: submit สำเร็จ → record ครบ 6 field ──
try {
  console.log('── R1: submit → record ครบ fullname/roundId/roundTitle/positionLevel ──');
  applyDraft.__resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  state.detailFail = false; state.detailOmitPositionLevel = false;
  state.submitCalls.length = 0; routerCalls.length = 0;
  seedDraft();

  await submitThroughReview();

  const rec = readRecord();
  assert(rec !== null, 'R1-1: ต้องเขียน lastSubmittedApplication ลง sessionStorage');
  assert(rec.appNo === 'APP-2569-0001', `R1-2: appNo (ได้ ${rec.appNo})`);
  assert(rec.email === 'somchai@example.com', `R1-3: email (ได้ ${rec.email})`);
  assert(rec.phone === '0812345678', `R1-4: phone (ได้ ${rec.phone})`);
  assert(rec.fullname === 'สมชาย ใจดี', `R1-5: fullname ต้องมาจาก formData['field-fullname'] (ได้ ${rec.fullname})`);
  assert(rec.roundId === ROUND, `R1-6: roundId ต้องมาจาก draft (ได้ ${rec.roundId})`);
  assert(rec.roundTitle === 'สอบ 2569', `R1-7: roundTitle ต้องมาจาก /rounds/:id/detail (ได้ ${rec.roundTitle})`);
  assert(rec.positionLevel === 'นักวิเคราะห์นโยบาย', `R1-8: positionLevel ต้องมาจาก /rounds/:id/detail (ได้ ${rec.positionLevel})`);
  assert(!applyDraft.loadApplyDraft(ROUND), 'R1-9: draft ต้องถูก clear หลัง submit สำเร็จ (พฤติกรรมเดิม)');
  assert(routerCalls.some(([kind, href]) => kind === 'push' && href === '/apply/success'), 'R1-10: ต้อง push /apply/success');
  assert(state.submitCalls.length === 1, 'R1-11: POST submit 1 ครั้ง');

  unmount();
  passed++;
  console.log('✓ R1\n');
} catch (e) {
  failed++; failures.push('R1: ' + (e as Error).message);
  console.log('✗ R1: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── R2: fetch detail ล้ม → record ยังถูกเขียน (roundTitle/positionLevel ว่าง) ──
try {
  console.log('── R2: detail 500 → ไม่บล็อก submit, record ยังครบ ──');
  applyDraft.__resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  state.detailFail = true;
  state.submitCalls.length = 0; routerCalls.length = 0;
  seedDraft();

  await submitThroughReview();

  const rec = readRecord();
  assert(rec !== null, 'R2-1: detail ล้มต้องไม่ทำให้ record หาย');
  assert(rec.appNo === 'APP-2569-0001', 'R2-2: submit ยังสำเร็จ');
  assert(rec.fullname === 'สมชาย ใจดี', 'R2-3: fullname ยังครบ');
  assert(rec.roundId === ROUND, 'R2-4: roundId ยังครบ');
  assert(rec.roundTitle === '' , `R2-5: roundTitle ว่างเมื่อ detail ล้ม (ได้ ${JSON.stringify(rec.roundTitle)})`);
  assert(rec.positionLevel === '' , `R2-6: positionLevel ว่างเมื่อ detail ล้ม (ได้ ${JSON.stringify(rec.positionLevel)})`);
  assert(routerCalls.some(([kind, href]) => kind === 'push' && href === '/apply/success'), 'R2-7: ยัง push /apply/success');

  unmount();
  passed++;
  console.log('✓ R2\n');
} catch (e) {
  failed++; failures.push('R2: ' + (e as Error).message);
  console.log('✗ R2: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── S1: record ใหม่ → แสดงครบ 6 field + กล่องคำแนะนำโชว์ค่าจริง ──
try {
  console.log('── S1: success page แสดงชื่อ/ตำแหน่ง/รอบ + คำแนะนำค่าจริง ──');
  unmount();
  (win.sessionStorage as any).clear?.();
  win.sessionStorage.setItem('lastSubmittedApplication', JSON.stringify({
    appNo: 'APP-2569-0001',
    email: 'somchai@example.com',
    phone: '0812345678',
    fullname: 'สมชาย ใจดี',
    roundId: ROUND,
    roundTitle: 'สอบ 2569',
    positionLevel: 'นักวิเคราะห์นโยบาย',
  }));

  mount(<SuccessPage />);
  await flushAll();
  const t = text();

  assert(t.includes('APP-2569-0001'), 'S1-1: เลขที่ใบสมัคร');
  assert(t.includes('สมชาย ใจดี'), 'S1-2: ชื่อผู้สมัคร (ค่า)');
  assert(t.includes('ชื่อผู้สมัคร'), 'S1-3: label ชื่อผู้สมัคร');
  assert(t.includes('นักวิเคราะห์นโยบาย'), 'S1-4: ตำแหน่งที่สมัคร (ค่า)');
  assert(t.includes('ตำแหน่งที่สมัคร'), 'S1-5: label ตำแหน่งที่สมัคร');
  assert(t.includes('สอบ 2569'), 'S1-6: รอบรับสมัคร (ค่า)');
  assert(t.includes('รอบรับสมัคร'), 'S1-7: label รอบรับสมัคร');
  assert(t.includes('somchai@example.com'), 'S1-8: อีเมล (ค่า)');
  assert(t.includes('0812345678'), 'S1-9: เบอร์โทรศัพท์ (ค่า)');

  // กล่องคำแนะนำ: หัวข้อใหม่ + ค่าจริงของ 3 คีย์ (format รอบ = dropdown หน้า lookup)
  assert(t.includes('ค้นหาใบสมัครในภายหลัง'), 'S1-10: หัวข้อกล่องคำแนะนำใหม่');
  assert(!t.includes('ท่านสามารถใช้ข้อมูลต่อไปนี้'), 'S1-11: ตัด lead-in ประโยคค้างเดิม');
  assert(t.includes('สอบ 2569 (นักวิเคราะห์นโยบาย)'), 'S1-12: รอบในคำแนะนำ = format dropdown "{title} ({positionLevel})"');

  // คำว่า "เมนู" ห้ามปรากฏ (public layout ไม่มี nav) — ต้องเป็น "หน้า"
  assert(!t.includes('เมนู'), 'S1-13: ห้ามมีคำว่า "เมนู"');
  assert(t.includes('หน้า "ค้นหาใบสมัคร"'), 'S1-14: ใช้คำว่า หน้า "ค้นหาใบสมัคร"');

  unmount();
  passed++;
  console.log('✓ S1\n');
} catch (e) {
  failed++; failures.push('S1: ' + (e as Error).message);
  console.log('✗ S1: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── S2: record รูปแบบเก่า → ไม่ crash, ซ่อนแถวที่ไม่มี ──
try {
  console.log('── S2: record เก่า (appNo/email/phone) → degrade ──');
  unmount();
  (win.sessionStorage as any).clear?.();
  win.sessionStorage.setItem('lastSubmittedApplication', JSON.stringify({
    appNo: 'APP-2568-0042',
    email: 'old@example.com',
    phone: '0899999999',
  }));

  mount(<SuccessPage />);
  await flushAll();
  const t = text();

  assert(t.includes('APP-2568-0042'), 'S2-1: แสดงเลขที่ใบสมัครจาก record เก่า');
  assert(!t.includes('ชื่อผู้สมัคร'), 'S2-2: ไม่แสดง label ชื่อผู้สมัครเมื่อไม่มีค่า');
  assert(!t.includes('ตำแหน่งที่สมัคร'), 'S2-3: ไม่แสดง label ตำแหน่งเมื่อไม่มีค่า');
  assert(t.includes('old@example.com'), 'S2-4: อีเมลยังแสดง');
  assert(t.includes('0899999999'), 'S2-5: เบอร์ยังแสดง');

  unmount();
  passed++;
  console.log('✓ S2\n');
} catch (e) {
  failed++; failures.push('S2: ' + (e as Error).message);
  console.log('✗ S2: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── S3: ไม่มี record → empty state ใช้คำว่า "หน้า" ──
try {
  console.log('── S3: ไม่มี record → empty state ──');
  unmount();
  (win.sessionStorage as any).clear?.();

  mount(<SuccessPage />);
  await flushAll();
  const t = text();

  assert(t.includes('ไม่พบข้อมูลการสมัครล่าสุด'), 'S3-1: empty state เดิม');
  assert(!t.includes('เมนู'), 'S3-2: ห้ามมีคำว่า "เมนู"');
  assert(t.includes('หน้า "ค้นหาใบสมัคร"'), 'S3-3: ใช้คำว่า หน้า "ค้นหาใบสมัคร"');

  unmount();
  passed++;
  console.log('✓ S3\n');
} catch (e) {
  failed++; failures.push('S3: ' + (e as Error).message);
  console.log('✗ S3: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── S4: positionLevel ว่าง → fallback title (parity applicant-lookup.service) ──
try {
  console.log('── S4: positionLevel ว่าง → ตำแหน่ง fallback title, รอบไม่มีวงเล็บเปล่า ──');
  unmount();
  (win.sessionStorage as any).clear?.();
  win.sessionStorage.setItem('lastSubmittedApplication', JSON.stringify({
    appNo: 'APP-2569-0007',
    email: 'fallback@example.com',
    phone: '0877777777',
    fullname: 'สมหญิง รื่นรมย์',
    roundId: ROUND,
    roundTitle: 'สอบ 2569',
    positionLevel: '',
  }));

  mount(<SuccessPage />);
  await flushAll();
  const t = text();

  assert(t.includes('สมหญิง รื่นรมย์'), 'S4-1: ชื่อผู้สมัคร');
  assert(t.includes('ตำแหน่งที่สมัคร'), 'S4-2: มี label ตำแหน่ง');
  assert(t.includes('สอบ 2569'), 'S4-3: ค่าตำแหน่ง fallback เป็น title');
  assert(!t.includes(' ()'), 'S4-4: ห้ามมีวงเล็บเปล่าในคำแนะนำ');

  unmount();
  passed++;
  console.log('✓ S4\n');
} catch (e) {
  failed++; failures.push('S4: ' + (e as Error).message);
  console.log('✗ S4: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('All success-page UX tests passed.\n');
})();
