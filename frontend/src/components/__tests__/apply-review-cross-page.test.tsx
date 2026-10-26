// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * CROSS-PAGE Reproduction — apply (ลบไฟล์) → review โดยไม่ refresh
 * =======================================================================
 * จุดเดียวที่ผู้ใช้ "เห็น File not found" ได้คือกด "เปิดดู" ของไฟล์ที่ถูกลบ
 * บนหน้า review (backend ตอบ 404 {"error":"File not found"}) — test นี้จึง
 * รันสองหน้าจริงต่อกันใน window เดียว (sessionStorage ร่วมกัน) เลียน
 * Next.js client navigation (unmount → mount)
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/apply-review-cross-page.test.tsx
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

const calls: Array<{ method: string; url: string }> = [];
const SCHEMA_RESPONSE = {
  data: {
    sections: [],
    fields: [
      { fieldId: 'field-file', type: 'FILE', label: 'เอกสารแนบ', isRequired: false, fileConfig: { maxFiles: 3, maxSizeMB: 10 } },
      { fieldId: 'field-name', type: 'TEXT', label: 'ชื่อ', isRequired: false },
    ],
  },
};
globalAny.fetch = async (url: string, init: any = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ method, url });
  const body = async (obj: any) => ({ ok: true, status: 200, json: async () => obj });
  if (url.includes('/public/uploads/direct') && method === 'POST') {
    const n = calls.filter((c) => c.method === 'POST').length;
    return {
      ok: true, status: 201,
      json: async () => ({
        success: true,
        data: { fileUrl: `/api/v1/files/apply/ไฟล์${n}.pdf`, contentType: 'application/pdf', ledgerId: `ledger-${n}`, deleteToken: `tok-${n}`, viewUrl: `/api/v1/files/apply/ไฟล์${n}.pdf?exp=9&sig=x` },
      }),
    };
  }
  if (url.includes('/public/uploads/direct') && method === 'DELETE') return { ok: true, status: 204, json: async () => ({ success: true }) };
  if (url.includes('/master-data/organizations')) return body({ data: [] });
  if (url.includes('/rounds/round-test/schema')) return body(SCHEMA_RESPONSE);
  if (url.includes('/rounds/round-test/detail')) return body({ success: true, data: { id: 'round-test', title: 'ทดสอบ', status: 'ACTIVE' } });
  if (url.includes('/public/config')) return body({ data: { turnstile: { enabled: false, siteKey: '' } } });
  return body({ data: [] });
};

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let applyDraft: any, ApplyPage: any, ReviewPage: any;

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
function clickButtonByText(label: string) {
  const btns = Array.from(win.document.querySelectorAll('button')) as any[];
  const btn = btns.find((b) => (b.textContent || '').trim().includes(label) && !b.disabled);
  if (!btn) throw new Error(`ไม่พบปุ่ม "${label}" (มี: ${btns.map((b) => `${b.textContent?.trim()}${b.disabled ? '[disabled]' : ''}`).join(' | ')})`);
  act(() => { btn.click(); });
}
function pickFiles(names: string[]) {
  const input = win.document.querySelector('input[type="file"]') as any;
  assert(input, 'ต้องมี file input');
  const files = names.map((n) => new (win as any).File(['pdf-bytes'], n, { type: 'application/pdf' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => { input.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
}
const assert = (c: any, m: string) => { if (!c) throw new Error(m); };

const ROUND = 'round-test';
let passed = 0, failed = 0;
const failures: string[] = [];

console.log('\n═══ Cross-page: apply(ลบไฟล์) → review ═══\n');

void (async () => {
  applyDraft = await import('../../lib/applyDraft');
  const { saveApplyDraft, loadApplyDraft, __resetApplyDraftsForTests } = applyDraft;
  ApplyPage = (await import('../../app/(public)/apply/page')).default;
  ReviewPage = (await import('../../app/(public)/apply/review/page')).default;

// ── E1: ลบไฟล์บน apply → mount review (ไม่ refresh) → review ต้องไม่แสดงไฟล์ที่ถูกลบ ──
try {
  console.log('── E1: ลบไฟล์ → review ไม่ refresh ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;
  saveApplyDraft({
    roundId: ROUND,
    formData: { 'field-name': 'สมชาย' },
    attachments: [{ fieldId: 'field-file', fileUrl: '/api/v1/files/apply/เก่า.pdf', fileName: 'เก่า.pdf', contentType: 'application/pdf', ledgerId: 'ledger-1', deleteToken: 'tok-1', viewUrl: '/api/v1/files/apply/เก่า.pdf?exp=1&sig=x' }],
    submissionToken: 'tok',
  });

  // หน้า apply — restore draft → ลบไฟล์ (maxFiles=3 → ปุ่ม X รายไฟล์)
  mount(<ApplyPage />);
  await flushAll();
  assert(text().includes('เก่า.pdf'), 'E1-0: chip แสดงหลัง restore');
  const xBtn = (Array.from(win.document.querySelectorAll('button')) as any[])
    .find((b) => (b.className || '').includes('text-red-500') && b.querySelector('svg'));
  assert(xBtn, 'E1-0b: ต้องมีปุ่มลบรายไฟล์ (X)');
  act(() => { xBtn.click(); });
  await flushAll();
  assert(!text().includes('เก่า.pdf'), 'E1-1: chip หายหลังลบ');
  unmount();

  // หน้า review — เลียน Next route change (mount ใหม่, sessionStorage เดิม)
  mount(<ReviewPage />);
  await flushAll();
  const reviewText = text();
  console.log('  review แสดง เก่า.pdf?', reviewText.includes('เก่า.pdf'));
  console.log('  review text:', JSON.stringify(reviewText.slice(0, 500)));
  console.log('  review มีลิงก์ เปิดดู?', reviewText.includes('เปิดดู'));

  assert(!reviewText.includes('เก่า.pdf'), 'E1-2 [CRITICAL]: review ห้ามแสดงไฟล์ที่ถูกลบ (จุดที่ผู้ใช้เห็น File not found ผ่านเปิดดู)');
  assert(reviewText.includes('ไม่ได้กรอก'), 'E1-3: FILE field ต้องแสดงว่าง (ไม่ได้กรอก) หลังไฟล์ถูกลบ');

  unmount();
  passed++;
  console.log('✓ E1\n');
} catch (e) {
  failed++; failures.push('E1: ' + (e as Error).message);
  console.log('✗ E1: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── E2: multi-file (maxFiles=3) — upload 2 → ลบ 1 → UI + draft ──
try {
  console.log('── E2: multi-file ลบ 1 จาก 2 ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;
  // draft ว่าง + save ครั้งแรกก่อน เพื่อให้มี draft ให้ sync
  saveApplyDraft({ roundId: ROUND, formData: {}, attachments: [], submissionToken: 'tok' });

  mount(<ApplyPage />);
  await flushAll();
  pickFiles(['a.pdf', 'b.pdf']);
  await flushAll();

  console.log('  หลัง upload 2 ไฟล์ → a?', text().includes('a.pdf'), '| b?', text().includes('b.pdf'));
  assert(text().includes('a.pdf') && text().includes('b.pdf'), 'E2-1: เห็นทั้งสองไฟล์');
  const draft1 = loadApplyDraft(ROUND);
  assert(draft1.attachments.length === 2, `E2-2: draft ต้องมี 2 (ได้ ${draft1.attachments.length})`);

  // ลบไฟล์แรก (ปุ่ม X ในรายการ multi-file — ปุ่มแรกใน file list)
  const removeBtns = (Array.from(win.document.querySelectorAll('button')) as any[])
    .filter((b) => b.closest('.space-y-2') !== null && b.querySelector('svg') && (b.className || '').includes('text-red-500'));
  assert(removeBtns.length >= 1, `E2-3: ต้องมีปุ่มลบรายไฟล์ (เจอ ${removeBtns.length})`);
  act(() => { removeBtns[0].click(); });
  await flushAll();

  console.log('  หลังลบ 1 → a?', text().includes('a.pdf'), '| b?', text().includes('b.pdf'), '| draft:', JSON.stringify(loadApplyDraft(ROUND)?.attachments?.map((a) => a.fileName)));
  assert((loadApplyDraft(ROUND)?.attachments?.length ?? 0) === 1, 'E2-4: draft เหลือ 1');

  unmount();
  passed++;
  console.log('✓ E2\n');
} catch (e) {
  failed++; failures.push('E2: ' + (e as Error).message);
  console.log('✗ E2: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
})();
