// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * FileUpload Delete / Reset-All — Interactive Component Reproduction
 * =======================================================================
 *
 * Production validation รอบ 2 (2026-10-27) รายงานว่า fix ee887958 ยังไม่ครบ:
 *   1. กดลบไฟล์ → "File not found" ยังแสดง
 *   2. ปุ่ม "ล้างข้อมูลทั้งหมด" ยังไม่ reset UI ทันที
 *   3. ต้อง refresh หน้าเองจึงหายหมด (และไม่มี file resurrection → draft
 *      sync ทำงาน ปัญหาอยู่ที่ React UI state)
 *
 * Test นี้รัน FileUpload จริง + wiring ที่คัดลอกมาจาก apply/page.tsx
 * (restore effect + onFilesChange → setAttachmentMeta + syncDraftAttachments +
 * formResetCount remount + RHF Controller) บน happy-dom เพื่อพิสูจน์
 * state ไหนยังเหลืออยู่หลัง delete/reset สำเร็จ
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/file-upload-reset-repro.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({
  url: 'http://localhost:3000/apply?id=round-test',
});
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch { /* Node 24 navigator เป็น getter-only — ข้าม */ }
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
(globalAny as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------- imports ----------
import React, { useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useForm, Controller } from 'react-hook-form';
import { FileUpload, UploadedFileMeta } from '../FileUpload';

// fetch stub — DELETE สำเร็จเสมอ + POST upload ตอบตรง contract (FileUpload เช็ค success)
const fetchCalls: Array<{ url: string; init: any }> = [];
let uploadSeq = 0;
globalAny.fetch = async (url: string, init: any = {}) => {
  fetchCalls.push({ url, init });
  if ((init.method || 'GET').toUpperCase() === 'POST' && url.includes('/public/uploads/direct')) {
    uploadSeq++;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: { fileUrl: `/api/v1/files/apply/ใหม่${uploadSeq}.pdf`, contentType: 'application/pdf', ledgerId: `ledger-${uploadSeq}`, deleteToken: `tok-${uploadSeq}`, viewUrl: '' },
      }),
    };
  }
  return { ok: true, status: 204, json: async () => ({ success: true }) };
};

// ---------- applyDraft โหลดหลัง window พร้อม (dynamic import ใน main — CJS ไม่รองรับ top-level await) ----------
let saveApplyDraft: any, loadApplyDraft: any, setDraftFieldAttachments: any, __resetApplyDraftsForTests: any, resetApplySession: any;

// ---------- TEST RUNNER ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

// ---------- Mini-parent — คัดลอก wiring จาก apply/page.tsx เป๊ะ ----------
const FIELD_ID = 'field-file';
const ROUND_ID = 'round-test';

interface DraftLike {
  formData: Record<string, unknown>;
  attachments: Array<{
    fieldId: string;
    fileUrl: string;
    fileName?: string;
    contentType?: string;
    ledgerId?: string;
    deleteToken?: string;
    viewUrl?: string;
  }>;
}

const SCHEMA = [
  {
    fieldId: FIELD_ID,
    type: 'FILE',
    fileConfig: { maxFiles: 1, maxSizeMB: 10 },
    isRequired: false,
  },
];

function ParentHarness({ draft, onLog }: { draft: DraftLike | null; onLog: (msg: string) => void }) {
  const { control, reset, getValues } = useForm();
  const [attachmentMeta, setAttachmentMeta] = useState<Record<string, UploadedFileMeta[]>>({});
  const [draftRestored, setDraftRestored] = useState(false);
  const [formResetCount, setFormResetCount] = useState(0);
  const [lastRhfValue, setLastRhfValue] = useState<string | undefined>(undefined);

  // ── restore effect — คัดลอกจาก page.tsx:490-541 (ตัด schema-loading gate ออกเพราะ SCHEMA คงที่)
  useEffect(() => {
    if (draftRestored) return;
    const d = draft;
    if (!d) {
      setDraftRestored(true);
      return;
    }
    const rehydrated: Record<string, unknown> = { ...d.formData };
    SCHEMA.forEach((field) => {
      if (field.type === 'FILE') {
        const att = d.attachments.find((a) => a.fieldId === field.fieldId);
        if (att) rehydrated[field.fieldId] = att.fileUrl;
      }
    });
    reset(rehydrated);

    const meta: Record<string, UploadedFileMeta[]> = {};
    d.attachments.forEach((att) => {
      if (!meta[att.fieldId]) meta[att.fieldId] = [];
      meta[att.fieldId].push({
        name: att.fileName || 'ไฟล์แนบ',
        url: att.fileUrl,
        contentType: att.contentType,
        ledgerId: att.ledgerId,
        deleteToken: att.deleteToken,
        viewUrl: att.viewUrl,
      });
    });
    setAttachmentMeta(meta);
    setDraftRestored(true);
  }, [draft, reset, draftRestored]);

  // ── sync draft — คัดลอกจาก page.tsx:555-569
  const syncDraftAttachments = (fieldId: string, files: UploadedFileMeta[]) => {
    setDraftFieldAttachments(
      ROUND_ID,
      fieldId,
      files.map((f) => ({
        fileUrl: f.url,
        fileName: f.name,
        contentType: f.contentType,
        ledgerId: f.ledgerId,
        deleteToken: f.deleteToken,
        viewUrl: f.viewUrl,
      }))
    );
  };

  // ── handleResetAll — คัดลอกจาก page.tsx:583-596 (ตัด confirm + ref guards)
  const handleResetAll = async () => {
    await resetApplySession({ attachmentMeta });
    setAttachmentMeta({});
    reset({});
    setFormResetCount((c) => c + 1);
    onLog('resetAll: done');
  };

  return (
    <div>
      <Controller
        name={FIELD_ID}
        control={control}
        render={({ field: { onChange, value } }) => {
          // จับค่า RHF ล่าสุดเพื่อ assert ใน test
          queueMicrotask(() => setLastRhfValue(typeof value === 'string' ? value : ''));
          return (
            <FileUpload
              key={`${FIELD_ID}-${formResetCount}`}
              onUploadSuccess={onChange}
              onFilesChange={(files) => {
                setAttachmentMeta((prev) => ({ ...prev, [FIELD_ID]: files }));
                syncDraftAttachments(FIELD_ID, files);
              }}
              defaultFiles={attachmentMeta[FIELD_ID]}
              accept="application/pdf"
              maxFiles={1}
            />
          );
        }}
      />
      <button id="reset-all" type="button" onClick={() => void handleResetAll()}>
        ล้างข้อมูลทั้งหมด
      </button>
      <span id="rhf-value">{String(lastRhfValue)}</span>
    </div>
  );
}

// ---------- harness helpers ----------
let container: HTMLElement | null = null;
let root: Root | null = null;

function mount(element: React.ReactElement) {
  container = win.document.createElement('div');
  win.document.body.appendChild(container);
  root = createRoot(container!);
  act(() => {
    root!.render(element);
  });
}

function unmount() {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

async function flushAll() {
  await act(async () => {
    await flush();
    await flush();
  });
}

const html = () => container?.innerHTML ?? '';
const text = () => container?.textContent ?? '';

function clickButtonByText(label: string) {
  const buttons = Array.from(win.document.querySelectorAll('button'));
  const btn = buttons.find((b) => (b.textContent || '').includes(label));
  if (!btn) throw new Error(`ไม่พบปุ่ม "${label}"`);
  act(() => {
    btn.click();
  });
}

const DRAFT_WITH_FILE: DraftLike = {
  formData: { 'field-name': 'สมชาย' },
  attachments: [
    {
      fieldId: FIELD_ID,
      fileUrl: '/api/v1/files/apply/test.pdf',
      fileName: 'เก่า.pdf',
      contentType: 'application/pdf',
      ledgerId: 'ledger-1',
      deleteToken: 'tok-1',
      viewUrl: '/api/v1/files/apply/test.pdf?exp=9&sig=x',
    },
  ],
};

// ---------- TESTS ----------
async function testDeleteFlow() {
  console.log('\n── Scenario A: ลบไฟล์ (มี draft อยู่แล้ว) ──');
  __resetApplyDraftsForTests();
  fetchCalls.length = 0;
  (win.sessionStorage as any).clear?.();
  saveApplyDraft({
    roundId: ROUND_ID,
    formData: DRAFT_WITH_FILE.formData,
    attachments: DRAFT_WITH_FILE.attachments,
    submissionToken: 'tok',
  });

  mount(<ParentHarness draft={DRAFT_WITH_FILE} onLog={(m) => console.log('  [log]', m)} />);
  await flushAll();

  assert(text().includes('เก่า.pdf'), 'A0: ก่อนลบ chip ต้องแสดงชื่อไฟล์');
  console.log('  A0 ✓ chip แสดงไฟล์หลัง restore');

  clickButtonByText('ลบไฟล์');
  await flushAll();

  console.log('  after delete → chip ยังแสดงชื่อไฟล์?', text().includes('เก่า.pdf'));
  console.log('  after delete → "File not found" แสดง?', text().includes('File not found'));
  console.log('  after delete → DELETE called?', fetchCalls.length > 0);
  console.log('  after delete → draft attachments:', JSON.stringify(loadApplyDraft(ROUND_ID)?.attachments?.length));

  assert(fetchCalls.length === 1, 'A1: DELETE ต้องถูกเรียก 1 ครั้ง');
  assert(!text().includes('เก่า.pdf'), 'A2 [CRITICAL]: หลังลบสำเร็จ chip ต้องหายจาก UI ทันที');
  assert(!text().includes('File not found'), 'A3: ห้ามมีข้อความ File not found');
  const d = loadApplyDraft(ROUND_ID);
  assert((d?.attachments?.length ?? 0) === 0, 'A4: draft ต้องไม่มี attachment ที่ถูกลบ');

  // RHF value — อ่านจาก span
  const rhf = win.document.getElementById('rhf-value')?.textContent;
  console.log('  after delete → RHF value:', JSON.stringify(rhf));

  unmount();
}

async function testResetAllFlow() {
  console.log('\n── Scenario B: ปุ่ม "ล้างข้อมูลทั้งหมด" ──');
  __resetApplyDraftsForTests();
  fetchCalls.length = 0;
  (win.sessionStorage as any).clear?.();
  saveApplyDraft({
    roundId: ROUND_ID,
    formData: DRAFT_WITH_FILE.formData,
    attachments: DRAFT_WITH_FILE.attachments,
    submissionToken: 'tok',
  });

  mount(<ParentHarness draft={DRAFT_WITH_FILE} onLog={(m) => console.log('  [log]', m)} />);
  await flushAll();

  assert(text().includes('เก่า.pdf'), 'B0: ก่อน reset chip ต้องแสดง');
  clickButtonByText('ล้างข้อมูลทั้งหมด');
  await flushAll();

  console.log('  after reset → chip ยังแสดง?', text().includes('เก่า.pdf'));
  console.log('  after reset → DELETE calls:', fetchCalls.length);
  console.log('  after reset → draft ยังอยู่?', loadApplyDraft(ROUND_ID) !== null);

  assert(fetchCalls.length === 1, 'B1: reset ต้องเรียก DELETE ไฟล์ 1 ครั้ง');
  assert(!text().includes('เก่า.pdf'), 'B2 [CRITICAL]: UI ต้องถูกเคลียร์ทันทีไม่ต้อง refresh');
  assert(loadApplyDraft(ROUND_ID) === null, 'B3: draft ถูกลบ');

  unmount();
}

async function testDeleteWithoutDraft() {
  console.log('\n── Scenario C: ลบไฟล์ก่อนมี draft (sync no-op) แล้วกด reset ──');
  __resetApplyDraftsForTests();
  fetchCalls.length = 0;
  (win.sessionStorage as any).clear?.();

  // draft restore: loadApplyDraft → null → ไม่มีไฟล์ใน component — จำลอง upload แทน:
  // ใช้ handleFileChange ผ่าน input จริง
  mount(<ParentHarness draft={null} onLog={(m) => console.log('  [log]', m)} />);
  await flushAll();

  const input = win.document.querySelector('input[type="file"]') as any;
  assert(input, 'C0: ต้องมี file input');
  const file = new (win as any).File(['pdf-bytes'], 'ใหม่1.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new (win as any).Event('change', { bubbles: true }));
  });
  await flushAll();

  console.log('  after upload → chip?', text().includes('ใหม่.pdf'), '| POST calls:', fetchCalls.length);
  assert(text().includes('ใหม่1.pdf'), 'C1: อัปโหลดแล้วต้องเห็น chip');
  assert(loadApplyDraft(ROUND_ID) === null, 'C2: ยังไม่มี draft (ยังไม่กด save)');

  // ลบไฟล์ — sync no-op (ไม่มี draft)
  clickButtonByText('ลบไฟล์');
  await flushAll();
  console.log('  after delete → chip?', text().includes('ใหม่.pdf'));
  assert(!text().includes('ใหม่1.pdf'), 'C3: ลบแล้ว chip หาย (แม้ไม่มี draft)');

  unmount();
}

console.log('\n═══ FileUpload Delete/Reset Reproduction (happy-dom) ═══\n');

void (async () => {
  const applyDraft = await import('../../lib/applyDraft');
  const applyReset = await import('../../lib/applyReset');
  ({ saveApplyDraft, loadApplyDraft, setDraftFieldAttachments, __resetApplyDraftsForTests } = applyDraft);
  ({ resetApplySession } = applyReset);

  for (const [name, fn] of [
    ['Scenario A: delete flow', testDeleteFlow],
    ['Scenario B: reset-all flow', testResetAllFlow],
    ['Scenario C: upload→delete ก่อนมี draft', testDeleteWithoutDraft],
  ] as Array<[string, () => Promise<void>]>) {
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      failures.push(`${name}: ${(e as Error).message}`);
      console.log(`✗ ${name}: ${(e as Error).message}`);
      try { unmount(); } catch {}
    }
  }
  console.log(`\nผลรวม: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
})();
