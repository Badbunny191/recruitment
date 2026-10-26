// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * FULL PAGE Reproduction — หน้า /apply จริงทั้งหน้า บน happy-dom
 * =======================================================================
 * รัน page.tsx จริง (ทุก effect, guard, ref) โดย mock เฉพาะ next/navigation
 * + fetch stub + window.confirm — เพื่อจับสิ่งที่ component harness ยังไม่ครอบ
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/apply-page-full-repro.test.tsx
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
const calls: Array<{ method: string; url: string }> = [];
const UPLOAD_RESPONSE = {
  success: true,
  data: {
    fileUrl: '/api/v1/files/apply/ตอบกลับใหม่.pdf',
    contentType: 'application/pdf',
    ledgerId: 'ledger-new',
    deleteToken: 'tok-new',
    viewUrl: '/api/v1/files/apply/new.pdf?exp=99&sig=y',
  },
};
const SCHEMA_RESPONSE = {
  data: {
    sections: [],
    fields: [
      { fieldId: 'field-file', type: 'FILE', label: 'เอกสารแนบ', isRequired: false, fileConfig: { maxFiles: 1, maxSizeMB: 10 } },
      { fieldId: 'field-name', type: 'TEXT', label: 'ชื่อ', isRequired: false },
    ],
  },
};
globalAny.fetch = async (url: string, init: any = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ method, url });
  if (url.includes('/public/uploads/direct') && method === 'POST') {
    return { ok: true, status: 201, json: async () => UPLOAD_RESPONSE };
  }
  if (url.includes('/public/uploads/direct') && method === 'DELETE') {
    return { ok: true, status: 204, json: async () => ({ success: true }) };
  }
  if (url.includes('/master-data/organizations')) {
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  }
  if (url.includes('/rounds/round-test/schema')) {
    return { ok: true, status: 200, json: async () => SCHEMA_RESPONSE };
  }
  if (url.includes('/rounds/round-test/detail')) {
    return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'round-test', title: 'ทดสอบ', status: 'ACTIVE' } }) };
  }
  return { ok: true, status: 200, json: async () => ({ data: [] }) };
};

// ---------- imports (หลัง mock) ----------
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let applyDraft: any, ApplicationFormPage: any;

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
function clickButtonByText(label: string) {
  const btns = Array.from(win.document.querySelectorAll('button'));
  const btn = btns.find((b) => (b.textContent || '').trim().includes(label));
  if (!btn) throw new Error(`ไม่พบปุ่ม "${label}" (มี: ${btns.map((b) => b.textContent?.trim()).join(' | ')})`);
  act(() => { btn.click(); });
}
function pickFile(name: string) {
  const input = win.document.querySelector('input[type="file"]') as any;
  assert(input, 'ต้องมี file input');
  const file = new (win as any).File(['pdf-bytes'], name, { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => { input.dispatchEvent(new (win as any).Event('change', { bubbles: true })); });
}

const ROUND = 'round-test';

console.log('\n═══ FULL /apply page reproduction ═══\n');

void (async () => {
  applyDraft = await import('../../lib/applyDraft');
  const { saveApplyDraft, loadApplyDraft, __resetApplyDraftsForTests } = applyDraft;
  const pageModule = await import('../../app/(public)/apply/page');
  ApplicationFormPage = pageModule.default;

// ── D1: ลบไฟล์ที่ restore จาก draft — มี guard/ref จริงของหน้า ──
try {
  console.log('── D1: delete flow บนหน้าเต็ม ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;
  saveApplyDraft({
    roundId: ROUND,
    formData: { 'field-name': 'สมชาย' },
    attachments: [{ fieldId: 'field-file', fileUrl: '/api/v1/files/apply/เก่า.pdf', fileName: 'เก่า.pdf', contentType: 'application/pdf', ledgerId: 'ledger-1', deleteToken: 'tok-1', viewUrl: '/api/v1/files/apply/เก่า.pdf?exp=1&sig=x' }],
    submissionToken: 'tok',
  });

  mount(<ApplicationFormPage />);
  await flushAll();

  console.log('  chip แสดง?', text().includes('เก่า.pdf'));
  console.log('  ปุ่มล้างข้อมูล disabled?', (Array.from(win.document.querySelectorAll('button')) as any[]).find((b) => b.textContent?.includes('ล้างข้อมูลทั้งหมด'))?.disabled);
  assert(text().includes('เก่า.pdf'), 'D1-0: chip ต้องแสดงหลัง restore');

  clickButtonByText('ลบไฟล์');
  await flushAll();

  console.log('  หลังลบ → chip?', text().includes('เก่า.pdf'), '| "File not found"?', text().includes('File not found'), '| DELETE calls:', calls.filter((c) => c.method === 'DELETE').length);
  console.log('  หลังลบ → draft attachments:', JSON.stringify(loadApplyDraft(ROUND)?.attachments?.length ?? 'null'));

  assert(calls.some((c) => c.method === 'DELETE'), 'D1-1: DELETE ถูกเรียก');
  assert(!text().includes('เก่า.pdf'), 'D1-2 [CRITICAL]: chip ต้องหายทันที');
  assert(!text().includes('File not found'), 'D1-3: ห้ามแสดง File not found');
  assert((loadApplyDraft(ROUND)?.attachments?.length ?? 0) === 0, 'D1-4: draft สะอาด');

  unmount();
  passed++;
  console.log('✓ D1 delete flow บนหน้าเต็ม\n');
} catch (e) {
  failed++; failures.push('D1: ' + (e as Error).message);
  console.log('✗ D1: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── D2: reset-all บนหน้าเต็ม (window.confirm = true) ──
try {
  console.log('── D2: reset-all flow บนหน้าเต็ม ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;
  saveApplyDraft({
    roundId: ROUND,
    formData: { 'field-name': 'สมชาย' },
    attachments: [{ fieldId: 'field-file', fileUrl: '/api/v1/files/apply/เก่า2.pdf', fileName: 'เก่า2.pdf', contentType: 'application/pdf', ledgerId: 'ledger-2', deleteToken: 'tok-2', viewUrl: '' }],
    submissionToken: 'tok',
  });

  mount(<ApplicationFormPage />);
  await flushAll();
  assert(text().includes('เก่า2.pdf'), 'D2-0: chip ต้องแสดง');

  clickButtonByText('ล้างข้อมูลทั้งหมด');
  await flushAll();

  console.log('  หลัง reset → chip?', text().includes('เก่า2.pdf'), '| DELETE:', calls.filter((c) => c.method === 'DELETE').length, '| draft?', loadApplyDraft(ROUND) !== null);
  console.log('  หลัง reset → ชื่อ input ยังมีค่า "สมชาย"?', (win.document.getElementById('field-name') as any)?.value);

  assert(calls.some((c) => c.method === 'DELETE'), 'D2-1: DELETE ไฟล์ค้าง');
  assert(!text().includes('เก่า2.pdf'), 'D2-2 [CRITICAL]: UI ต้องเคลียร์ทันที');
  assert(loadApplyDraft(ROUND) === null, 'D2-3: draft ถูกลบ');

  unmount();
  passed++;
  console.log('✓ D2 reset-all flow บนหน้าเต็ม\n');
} catch (e) {
  failed++; failures.push('D2: ' + (e as Error).message);
  console.log('✗ D2: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── D3: upload → delete บนหน้าเต็ม ก่อนมี draft (sync no-op) ──
try {
  console.log('── D3: upload → delete ก่อนมี draft ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;

  mount(<ApplicationFormPage />);
  await flushAll();

  pickFile('ใหม่.pdf');
  await flushAll();

  console.log('  หลัง upload → chip?', text().includes('ใหม่.pdf'), '| POST:', calls.filter((c) => c.method === 'POST').length);
  assert(text().includes('ใหม่.pdf'), 'D3-1: upload แล้วต้องเห็น chip');

  clickButtonByText('ลบไฟล์');
  await flushAll();
  console.log('  หลังลบ → chip?', text().includes('ใหม่.pdf'), '| "File not found"?', text().includes('File not found'));

  assert(!text().includes('ใหม่.pdf'), 'D3-2: ลบแล้ว chip หาย');
  assert(!text().includes('File not found'), 'D3-3: ไม่มี error ค้าง');

  unmount();
  passed++;
  console.log('✓ D3 upload→delete ก่อนมี draft\n');
} catch (e) {
  failed++; failures.push('D3: ' + (e as Error).message);
  console.log('✗ D3: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── D4: ลบไฟล์ → กด "ตรวจสอบข้อมูล" → draft ที่บันทึกต้องสะอาด (ไม่ฟื้นไฟล์บน review) ──
try {
  console.log('── D4: delete → ตรวจสอบข้อมูล → draft ต้องสะอาด ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;
  saveApplyDraft({
    roundId: ROUND,
    formData: { 'field-name': 'สมชาย' },
    attachments: [{ fieldId: 'field-file', fileUrl: '/api/v1/files/apply/เก่า3.pdf', fileName: 'เก่า3.pdf', contentType: 'application/pdf', ledgerId: 'ledger-3', deleteToken: 'tok-3', viewUrl: '' }],
    submissionToken: 'tok',
  });

  mount(<ApplicationFormPage />);
  await flushAll();
  assert(text().includes('เก่า3.pdf'), 'D4-0: chip แสดง');

  clickButtonByText('ลบไฟล์');
  await flushAll();
  assert(!text().includes('เก่า3.pdf'), 'D4-1: chip หายก่อน save');

  clickButtonByText('ตรวจสอบข้อมูล');
  await flushAll();
  const d = loadApplyDraft(ROUND);
  console.log('  draft หลัง save:', JSON.stringify({ atts: d?.attachments?.length, name: d?.formData?.['field-name'] }));
  assert((d?.attachments?.length ?? 0) === 0, 'D4-2 [CRITICAL]: draft หลัง save ต้องไม่มีไฟล์ที่ถูกลบ');
  assert(d?.formData?.['field-name'] === 'สมชาย', 'D4-3: formData คงเดิม');

  unmount();
  passed++;
  console.log('✓ D4 delete → save → draft สะอาด\n');
} catch (e) {
  failed++; failures.push('D4: ' + (e as Error).message);
  console.log('✗ D4: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

// ── D5: REGRESSION — backend DELETE ช้า (network จริง) — UI ต้องเคลียร์ทันที ──
// ปัญหา prod รอบ 2 (reproduce ได้กับโค้ดเดิม): handleResetAll รอ resetApplySession
// (DELETE ทั้งหมดผ่าน network) ก่อนเคลียร์ React state → ระหว่างหน้าต่างเวลานั้น
// backend ลบไฟล์เสร็จแล้ว แต่ chip ยังแสดง → กดลบ/เปิดดูซ้ำ → 404
// {"error":"File not found"} (upload.routes.ts:286) แสดงใน FileUpload error
// state และต้อง refresh เอง UI จึงหาย
// Fix: เคลียร์ state ก่อน แล้วค่อย best-effort ลบไฟล์หลังบ้าน
try {
  console.log('── D5: backend DELETE ช้า → UI ต้องเคลียร์ทันที (regression) ──');
  __resetApplyDraftsForTests();
  (win.sessionStorage as any).clear?.();
  calls.length = 0;

  // stub: DELETE ครั้งแรกใช้เวลา 1500ms (server ลบเสร็จก่อนตอบ);
  // DELETE ซ้ำบน ledger เดิม → 404 "File not found" ตรง upload.routes.ts:286
  const deletedLedgers = new Set<string>();
  const fastFetch = globalAny.fetch;
  globalAny.fetch = async (url: string, init: any = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'DELETE' && url.includes('/public/uploads/direct/')) {
      const ledgerId = url.split('/direct/')[1];
      if (deletedLedgers.has(ledgerId)) {
        return { ok: false, status: 404, json: async () => ({ success: false, error: 'File not found' }) };
      }
      deletedLedgers.add(ledgerId);
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return fastFetch(url, init);
  };

  saveApplyDraft({
    roundId: ROUND,
    formData: { 'field-name': 'สมชาย' },
    attachments: [{ fieldId: 'field-file', fileUrl: '/api/v1/files/apply/prod.pdf', fileName: 'prod.pdf', contentType: 'application/pdf', ledgerId: 'ledger-prod', deleteToken: 'tok-prod', viewUrl: '' }],
    submissionToken: 'tok',
  });

  mount(<ApplicationFormPage />);
  await flushAll();
  assert(text().includes('prod.pdf'), 'D5-0: chip แสดง');

  // ผู้ใช้กด "ล้างข้อมูลทั้งหมด" — DELETE ยังค้างใน network
  clickButtonByText('ล้างข้อมูลทั้งหมด');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

  const chipAfter300ms = text().includes('prod.pdf');
  console.log('  +300ms (DELETE ยังค้าง) → chip ยังแสดง?', chipAfter300ms);
  assert(!chipAfter300ms, 'D5-1 [REGRESSION]: UI ต้องเคลียร์ทันทีแม้ backend DELETE ยังไม่ตอบ');

  // ไม่มี chip → ผู้ใช้กดลบซ้ำ/เปิดดูไฟล์ที่ถูกลบไม่ได้อีก → ไม่มีทางเห็น File not found
  assert(!text().includes('File not found'), 'D5-2: ห้ามแสดง File not found');

  // รอ backend cleanup จบ — draft ต้องถูกลบ
  await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
  assert(loadApplyDraft(ROUND) === null, 'D5-3: draft ถูกลบหลัง cleanup เสร็จ');
  assert(deletedLedgers.has('ledger-prod'), 'D5-4: ไฟล์ถูกลบจาก backend จริง');

  // refresh — ไม่มี resurrection
  unmount();
  mount(<ApplicationFormPage />);
  await flushAll();
  assert(!text().includes('prod.pdf'), 'D5-5: หลัง refresh ไม่มี resurrection');

  globalAny.fetch = fastFetch;
  unmount();
  passed++;
  console.log('✓ D5 UI เคลียร์ทันทีแม้ backend ช้า\n');
} catch (e) {
  failed++; failures.push('D5: ' + (e as Error).message);
  console.log('✗ D5: ' + (e as Error).message + '\n');
  try { unmount(); } catch {}
}

console.log(`ผลรวม: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('จบ reproduction suite\n');
})();
