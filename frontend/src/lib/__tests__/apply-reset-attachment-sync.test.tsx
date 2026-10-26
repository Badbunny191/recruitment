// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Apply Reset + Attachment↔Draft Sync Tests (2026-10-27)
 * =======================================================================
 *
 * Issue 1 — ลบไฟล์แล้ว Refresh ไฟล์กลับมา + "File not found"
 * ---------------------------------------------------------------
 * Root cause (ก่อน fix): FileUpload.handleRemove เคลียร์เฉพาะ live state
 * (local files + attachmentMeta + RHF ผ่าน onUploadSuccess) แต่ draft ใน
 * sessionStorage ที่บันทึกไว้ก่อนหน้ายังคง attachment เดิม — restore
 * effect ของ /apply โหลด draft เก่าหลัง Refresh จึงฟื้นไฟล์ที่ถูกลบจาก R2
 * กลับมาใน UI และ submit ส่ง fileUrl ตายไปให้ backend
 *
 * Fix: sync รายการไฟล์ของ field ลง draft ทันทีที่เปลี่ยน (upload/remove)
 * ผ่าน setDraftFieldAttachments — draft = สิ่งที่ผู้ใช้เห็นเสมอ
 *
 * Issue 2 — ปุ่ม "ล้างข้อมูลทั้งหมด"
 * ---------------------------------------------------------------
 * resetApplySession: ลบไฟล์ที่อัปโหลดค้างจาก backend (best-effort, เฉพาะ
 * ไฟล์ที่มี ledgerId+deleteToken) + ล้าง applyDraft:* ทุก key +
 * submissionToken — จากนั้น page เคลียร์ React state เอง
 *
 * ทดสอบผ่าน production storage path จริง: ตั้ง fake window.sessionStorage
 * ก่อน dynamic import เพื่อให้ applyDraft/submissionToken ใช้ sessionStorage
 * (ไม่ใช่ memoryFallback) เหมือนใน browser
 *
 * Run: tsx --tsconfig tsconfig.test.json src/lib/__tests__/apply-reset-attachment-sync.test.tsx
 */

// ---------- fake window.sessionStorage — ตั้งก่อน import ฝั่ง storage ----------
class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}
const fakeStorage = new FakeStorage();
(globalThis as any).window = { sessionStorage: fakeStorage };

// ---------- imports (storage modules โหลดหลัง fake window พร้อม) ----------
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplyResetBar } from '../../components/ApplyResetBar';

const MAIN_API = 'http://test.local/api/v1';

async function loadModules() {
  const applyDraft = await import('../../lib/applyDraft');
  const applyReset = await import('../../lib/applyReset');
  const submissionToken = await import('../../lib/submissionToken');
  return { applyDraft, applyReset, submissionToken };
}

// ---------- TEST RUNNER ----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.error(`✗ ${name}`);
      console.error(`  ${e?.stack || e?.message}`);
    }
  })();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message}\n  expected: ${b}\n  actual:   ${a}`);
}

async function main() {
  const { applyDraft, applyReset, submissionToken } = await loadModules();
  const {
    saveApplyDraft,
    loadApplyDraft,
    listDraftRoundIds,
    setDraftFieldAttachments,
    clearAllApplyDrafts,
    __resetApplyDraftsForTests,
  } = applyDraft;
  const { RESET_CONFIRM_MESSAGE, resetApplySession } = applyReset;
  const { writeSubmissionToken, readSubmissionToken, clearSubmissionToken } = submissionToken;

  console.log('\n========================================');
  console.log('Apply Reset + Attachment-Draft Sync Tests');
  console.log('========================================\n');

  const draftInput = (roundId, extra = {}) => ({
    roundId,
    formData: { 'field-name': `ค่าของรอบ ${roundId}` },
    attachments: [],
    submissionToken: `token-${roundId}`,
    ...extra,
  });

  const resetAll = () => {
    __resetApplyDraftsForTests();
    fakeStorage['map'].clear();
    clearSubmissionToken();
  };

  // =========================================================
  //  1. Attachment → Draft sync (Issue 1)
  // =========================================================

  await test('S1 [regression]: ลบไฟล์ (sync []) แล้ว draft ต้องไม่มี attachment เดิม — Refresh ต้องไม่ฟื้นไฟล์', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-s1', {
      attachments: [{
        fieldId: 'field-file',
        fileUrl: '/api/v1/files/apply/deleted.pdf',
        fileName: 'เก่า.pdf',
        contentType: 'application/pdf',
        ledgerId: 'ledger-1',
        deleteToken: 'tok-del',
        viewUrl: '/api/v1/files/apply/deleted.pdf?exp=1&sig=x',
      }],
    }));
    // จำลอง flow จริง: DELETE สำเร็จ → FileUpload.updateFiles([]) → onFilesChange([]) → sync
    const synced = setDraftFieldAttachments('round-s1', 'field-file', []);
    assert(synced !== null, 'sync ต้องคืน draft ที่อัปเดตแล้ว');
    assertDeepEqual(synced.attachments, [], 'draft ต้องไม่มี attachment ของไฟล์ที่ถูกลบ');
    // จำลอง Refresh — restore effect อ่าน draft ใหม่
    const reloaded = loadApplyDraft('round-s1');
    assert(reloaded !== null, 'draft ยังต้องมีอยู่ (ข้อมูลฟอร์มไม่หาย)');
    assert(
      !reloaded.attachments.some((a) => a.fileUrl === '/api/v1/files/apply/deleted.pdf'),
      'หลัง Refresh ไฟล์ที่ถูกลบต้องไม่กลับมาใน draft'
    );
    // formData + token คงเดิม — sync เฉพาะ attachments เท่านั้น
    assertDeepEqual(reloaded.formData, { 'field-name': 'ค่าของรอบ round-s1' }, 'formData คงเดิม');
    assert(reloaded.submissionToken === 'token-round-s1', 'submissionToken คงเดิม');
  });

  await test('S2: multi-file ลบ 1 จาก 2 — เหลือเฉพาะไฟล์ที่ยังอยู่จริง', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-s2', {
      attachments: [
        { fieldId: 'field-multi', fileUrl: '/f/a.pdf', fileName: 'a.pdf' },
        { fieldId: 'field-multi', fileUrl: '/f/b.pdf', fileName: 'b.pdf' },
        { fieldId: 'field-other', fileUrl: '/f/c.pdf', fileName: 'c.pdf' },
      ],
    }));
    const synced = setDraftFieldAttachments('round-s2', 'field-multi', [
      { fileUrl: '/f/b.pdf', fileName: 'b.pdf' },
    ]);
    assertDeepEqual(
      synced.attachments.map((a) => [a.fieldId, a.fileUrl]),
      [['field-other', '/f/c.pdf'], ['field-multi', '/f/b.pdf']],
      'ไฟล์ field อื่นคงเดิม + field นี้เหลือ b.pdf'
    );
  });

  await test('S3: ไม่มี draft (ยังไม่เคย save) — sync เป็น no-op และไม่สร้าง draft ใหม่', async () => {
    resetAll();
    const result = setDraftFieldAttachments('round-s3', 'field-file', []);
    assert(result === null, 'ไม่มี draft → คืน null');
    assert(listDraftRoundIds().length === 0, 'ห้ามสร้าง draft ใหม่จากการ sync');
  });

  await test('S4: upload path — sync รายการไฟล์ใหม่ลง draft พร้อม capability (ledgerId/deleteToken/viewUrl)', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-s4'));
    const synced = setDraftFieldAttachments('round-s4', 'field-file', [
      {
        fileUrl: '/f/new.pdf',
        fileName: 'ใหม่.pdf',
        contentType: 'application/pdf',
        ledgerId: 'ledger-9',
        deleteToken: 'tok-9',
        viewUrl: '/f/new.pdf?exp=1&sig=y',
      },
    ]);
    assert(synced.attachments.length === 1, 'draft ต้องมีไฟล์ที่เพิ่งอัปโหลด');
    assertDeepEqual(
      synced.attachments[0],
      {
        fieldId: 'field-file',
        fileUrl: '/f/new.pdf',
        fileName: 'ใหม่.pdf',
        contentType: 'application/pdf',
        ledgerId: 'ledger-9',
        deleteToken: 'tok-9',
        viewUrl: '/f/new.pdf?exp=1&sig=y',
      },
      'capability ต้องเก็บครบเพื่อลบได้หลัง restore'
    );
  });

  await test('S5: sync รอบหนึ่ง — draft ของรอบอื่นไม่ถูกกระทบ', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-a', {
      attachments: [{ fieldId: 'field-file', fileUrl: '/f/a1.pdf' }],
    }));
    saveApplyDraft(draftInput('round-b', {
      attachments: [{ fieldId: 'field-file', fileUrl: '/f/b1.pdf' }],
    }));
    setDraftFieldAttachments('round-a', 'field-file', []);
    assert(loadApplyDraft('round-a').attachments.length === 0, 'round-a ถูก sync');
    assert(loadApplyDraft('round-b').attachments.length === 1, 'round-b ต้องคงเดิม');
  });

  // =========================================================
  //  2. clearAllApplyDrafts (Issue 2 — applyDraft:* ทุก key)
  // =========================================================

  await test('C1: clearAllApplyDrafts ลบ applyDraft:* ทุก key แต่ไม่แตะ key อื่น', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-c1'));
    saveApplyDraft(draftInput('round-c2'));
    saveApplyDraft(draftInput('round-c3'));
    fakeStorage.setItem('submissionToken', 'tok-c');
    fakeStorage.setItem('lastSubmittedApplication', '{"appNo":"R-1"}');
    const removed = clearAllApplyDrafts();
    assert(removed === 3, `ต้องลบ 3 draft (ได้ ${removed})`);
    assert(listDraftRoundIds().length === 0, 'ไม่เหลือ draft ใด');
    assert(fakeStorage.getItem('submissionToken') === 'tok-c', 'submissionToken ไม่โดน (จัดการโดย clearSubmissionToken)');
    assert(fakeStorage.getItem('lastSubmittedApplication') !== null, 'key อื่นไม่โดน');
  });

  // =========================================================
  //  3. resetApplySession (Issue 2 — logic)
  // =========================================================

  await test('R1: ลบไฟล์ที่มี capability จริงผ่าน DELETE + X-Attachment-Token แล้วล้าง draft + token', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-r1', {
      attachments: [{ fieldId: 'field-file', fileUrl: '/f/a.pdf' }],
    }));
    writeSubmissionToken('tok-r1');
    const calls = [];
    const fetchStub = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    };
    const result = await resetApplySession({
      attachmentMeta: {
        'field-file': [{ ledgerId: 'ledger-a', deleteToken: 'tok-a' }],
        'field-photo': [{ ledgerId: 'ledger-b', deleteToken: 'tok-b' }],
      },
      apiUrl: MAIN_API,
      fetchImpl: fetchStub,
    });
    assert(calls.length === 2, `ต้องเรียก DELETE 2 ครั้ง (ได้ ${calls.length})`);
    assertDeepEqual(calls[0].url, `${MAIN_API}/public/uploads/direct/ledger-a`, 'DELETE path');
    assertDeepEqual(calls[0].init.method, 'DELETE', 'method');
    assertDeepEqual(calls[0].init.headers, { 'X-Attachment-Token': 'tok-a' }, 'header capability');
    assert(result.deletedFiles === 2 && result.failedFiles === 0, 'สรุปผลการลบ');
    assert(result.clearedDrafts === 1, 'draft ถูกล้าง');
    assert(loadApplyDraft('round-r1') === null, 'draft หายจริง');
    assert(readSubmissionToken() === null, 'submissionToken ถูกล้าง');
  });

  await test('R2: ลบไฟล์ล้มเหลว (network/500) — best-effort: นับ failed แต่ draft + token ยังถูกล้าง ไม่ throw', async () => {
    resetAll();
    saveApplyDraft(draftInput('round-r2'));
    writeSubmissionToken('tok-r2');
    const fetchStub = async () => {
      throw new Error('network down');
    };
    const result = await resetApplySession({
      attachmentMeta: {
        'field-file': [
          { ledgerId: 'ledger-x', deleteToken: 'tok-x' },
          { ledgerId: 'ledger-y', deleteToken: 'tok-y' },
        ],
      },
      apiUrl: MAIN_API,
      fetchImpl: fetchStub,
    });
    assert(result.deletedFiles === 0 && result.failedFiles === 2, `failed ต้องเป็น 2 (ได้ ${result.failedFiles})`);
    assert(loadApplyDraft('round-r2') === null, 'state ฝั่ง client ต้องถูกล้างเสมอ');
    assert(readSubmissionToken() === null, 'token ถูกล้าง');
  });

  await test('R3: ไฟล์เก่า (draft รูปแบบเดิม ไม่มี ledgerId/deleteToken) — ไม่เรียก DELETE', async () => {
    resetAll();
    let called = 0;
    const fetchStub = async () => { called++; return { ok: true }; };
    const result = await resetApplySession({
      attachmentMeta: {
        'field-file': [{ url: '/f/legacy.pdf' }, { ledgerId: undefined, deleteToken: undefined }],
      },
      apiUrl: MAIN_API,
      fetchImpl: fetchStub,
    });
    assert(called === 0, `ห้ามเรียก DELETE (เรียก ${called} ครั้ง)`);
    assert(result.deletedFiles === 0, 'ไม่มีไฟล์ที่ลบได้');
  });

  await test('R4: ข้อความยืนยันตรงตาม spec เป๊ะ', async () => {
    assertDeepEqual(
      RESET_CONFIRM_MESSAGE,
      'การดำเนินการนี้จะล้างข้อมูลและไฟล์แนบที่ยังไม่ได้ส่งทั้งหมด ต้องการดำเนินการต่อหรือไม่',
      'ข้อความยืนยัน'
    );
  });

  // =========================================================
  //  4. ApplyResetBar — markup contract (SSR)
  // =========================================================

  await test('M1: ปุ่มมีข้อความ "ล้างข้อมูลทั้งหมด" + aria-label + type="button"', async () => {
    const html = renderToStaticMarkup(<ApplyResetBar onReset={() => {}} />);
    assert(html.includes('ล้างข้อมูลทั้งหมด'), 'ข้อความปุ่ม');
    assert(html.includes('aria-label="ล้างข้อมูลทั้งหมด"'), 'aria-label');
    assert(html.includes('type="button"'), 'ห้ามเป็น submit (อยู่ใน <form>)');
  });

  await test('M2: busy — แสดง "กำลังล้างข้อมูล..." + disabled + aria-busy', async () => {
    const html = renderToStaticMarkup(<ApplyResetBar onReset={() => {}} busy={true} />);
    assert(html.includes('กำลังล้างข้อมูล...'), 'busy label');
    assert(html.includes('aria-busy="true"'), 'aria-busy');
    assert(/disabled/.test(html), 'disabled ระหว่างล้าง');
  });

  await test('M3: disabled prop — ปุ่ม disabled และไม่อยู่ในสถานะ busy', async () => {
    const html = renderToStaticMarkup(<ApplyResetBar onReset={() => {}} disabled={true} />);
    assert(/disabled/.test(html), 'disabled attribute');
    assert(!html.includes('กำลังล้างข้อมูล...'), 'ไม่ใช่สถานะ busy');
  });

  console.log('\n----------------------------------------');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(` - ${f}`));
    process.exit(1);
  }
  console.log('All apply reset + attachment sync tests passed.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
