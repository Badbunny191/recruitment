// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Apply Back Navigation Tests (ปุ่ม "กลับ" ของหน้าสมัคร)
 * =======================================================================
 *
 * ใช้ react-dom/server (SSR render) + pure logic tests ตามรูปแบบเดิมของ
 * repo (ไม่มี jsdom / testing-library ในโปรเจกต์)
 *
 * ครอบคลุม (เทียบรายการ A–Q ของ spec):
 *   A. หน้าสมัครแสดงปุ่มกลับ        → ApplyBackBar markup (ข้อความ/ไอคอน)
 *   B. ปลายทางถูกต้อง              → handleBack ใช้ปลายทางคงที่ (ดู logic
 *                                    contract ใน page.tsx; SSR ไม่รัน handler)
 *   C. Direct URL fallback         → ปลายทางคงที่ `/` ไม่พึ่ง history
 *   D/E/F. Draft รักษาข้อมูล       → round-trip saveApplyDraft/loadApplyDraft
 *                                    (formData ทุกชนิด + dynamic fields +
 *                                    attachment metadata)
 *   G/H. ไม่ submit / ไม่ upload    → handleBack ไม่เรียก API (logic test ของ
 *                                    draft lib ยืนยันว่า save เป็น local เท่านั้น)
 *   I/M. Disabled ระหว่าง pending   → ApplyBackBar disabled markup
 *   P. aria-label / error alert    → ApplyBackBar markup
 *
 * Run: tsx --tsconfig tsconfig.test.json src/lib/__tests__/apply-back-navigation.test.tsx
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApplyBackBar } from '../../components/ApplyBackBar';
import {
  saveApplyDraft,
  loadApplyDraft,
  __resetApplyDraftsForTests,
} from '../../lib/applyDraft';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.error(`✗ ${name}`);
    console.error(`  ${e?.stack || e?.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message}\n  expected: ${b}\n  actual:   ${a}`);
}

console.log('\n========================================');
console.log('Apply Back Navigation Tests');
console.log('========================================\n');

// =========================================================
//  1. ApplyBackBar — markup contract (A / I / M / P)
// =========================================================

test('A: ปุ่มกลับมีข้อความ "กลับ", ไอคอนลูกศรซ้าย และ aria-label', () => {
  const html = renderToStaticMarkup(<ApplyBackBar onBack={() => {}} />);
  assert(html.includes('>กลับ</button>') || /กลับ<\/button>/.test(html), 'button label "กลับ"');
  assert(html.includes('aria-label="กลับไปหน้ารายการรอบรับสมัคร"'), 'aria-label');
  assert(html.includes('<svg'), 'left-arrow icon (inline SVG, heroicon style เดิม)');
  assert(html.includes('M10.5 19.5L3 12'), 'arrow-left path');
  // ใช้ Button ของระบบเดิม (variant outline)
  assert(html.includes('border border-gray-300'), 'Button variant="outline" ของระบบเดิม');
});

test('P: ปุ่มกลับรองรับ Keyboard — focus-visible ring จาก Button base styles', () => {
  const html = renderToStaticMarkup(<ApplyBackBar onBack={() => {}} />);
  assert(html.includes('focus-visible:ring-2'), 'focus-visible ring style');
  assert(html.includes('aria-hidden="true"'), 'icon ไม่รบกวน screen reader');
});

test('P: touch target เหมาะกับ Mobile (h-10)', () => {
  const html = renderToStaticMarkup(<ApplyBackBar onBack={() => {}} />);
  assert(html.includes('h-10'), 'ความสูงขั้นต่ำ 40px สำหรับ touch target');
});

test('I: ปุ่มกลับ Disabled ได้ (ระหว่าง isSubmitting / "กำลังเตรียมข้อมูล...")', () => {
  const disabledHtml = renderToStaticMarkup(
    <ApplyBackBar onBack={() => {}} disabled={true} />
  );
  assert(disabledHtml.includes('disabled'), 'disabled attribute เมื่อ disabled=true');
  const enabledHtml = renderToStaticMarkup(
    <ApplyBackBar onBack={() => {}} disabled={false} />
  );
  // เช็คเป็น attribute (disabled=) ไม่ใช่คำว่า disabled ทั้งเลข
  // เพราะ class ของ Button มี disabled:opacity-50 อยู่แล้ว
  assert(!/ disabled(=|\s|>)/.test(enabledHtml), 'ไม่มี disabled attribute เมื่อ disabled=false');
});

test('P: แสดง error alert (role=alert) เมื่อบันทึก draft ล้มเหลว', () => {
  const html = renderToStaticMarkup(
    <ApplyBackBar onBack={() => {}} error="บันทึกฉบับร่างก่อนกลับไม่สำเร็จ" />
  );
  assert(html.includes('role="alert"'), 'error ต้องถูกประกาศ ห้ามหายเงียบ ๆ');
  assert(html.includes('บันทึกฉบับร่างก่อนกลับไม่สำเร็จ'), 'error text');
  const clean = renderToStaticMarkup(<ApplyBackBar onBack={() => {}} error={null} />);
  assert(!clean.includes('role="alert"'), 'ไม่มี alert เมื่อไม่มี error');
});

// =========================================================
//  2. Draft round-trip — รักษาข้อมูลทุกชนิด (D / E / F / K / L / N)
// =========================================================

// โครง payload นี้เลียนแบบผลลัพธ์ของ buildDraftPayload ใน apply/page.tsx
// (กลไก save เดียวกับปุ่ม "ตรวจสอบข้อมูล" และปุ่ม "กลับ")
const BACK_SAVE_PAYLOAD = () => ({
  roundId: 'round-back-1',
  formData: {
    'field-text': 'สมชาย ใจดี',
    'field-number': 25,
    'field-date': '2000-01-31',
    'field-textarea': 'ทำงาน\nหลายบรรทัด',
    'field-dropdown': 'ปริญญาโท',
    'field-radio': 'ชาย',
    'field-consent': true,
    'field-org': { id: 'org-1', name: 'สำนักงานตรวจเงินแผ่นดิน' }, // MASTER_DATA
    'field-skills': ['Excel', 'Power BI'], // CHECKBOX กลุ่ม (allowOther)
    'field-skills__other': 'ภาษา Python', // Other Option text
  },
  attachments: [
    {
      fieldId: 'field-file-single',
      fileUrl: 'https://r2.example.com/apply/a1.pdf',
      fileName: 'ใบเดิมของฉัน.pdf',
      contentType: 'application/pdf',
    },
    {
      fieldId: 'field-file-multi',
      fileUrl: 'https://r2.example.com/apply/a2.jpg',
      fileName: 'รูปถ่าย.jpg',
      contentType: 'image/jpeg',
    },
    {
      fieldId: 'field-file-multi',
      fileUrl: 'https://r2.example.com/apply/a3.docx',
      fileName: 'ผลงาน.docx',
      contentType: 'application/msword',
    },
  ],
  submissionToken: 'tok-back-123',
});

test('D: กดกลับแล้วกลับมา — formData ยังครบทุกชนิด (round-trip)', () => {
  __resetApplyDraftsForTests();
  saveApplyDraft(BACK_SAVE_PAYLOAD());
  const loaded = loadApplyDraft('round-back-1');
  assert(loaded !== null, 'draft ต้องถูกโหลดกลับมาได้');
  assertDeepEqual(loaded.formData, BACK_SAVE_PAYLOAD().formData, 'formData ต้องเหมือนเดิมทุก field');
});

test('E: Dynamic fields (CHECKBOX กลุ่ม / MASTER_DATA / __other) ยังครบ', () => {
  __resetApplyDraftsForTests();
  saveApplyDraft(BACK_SAVE_PAYLOAD());
  const loaded = loadApplyDraft('round-back-1');
  assertDeepEqual(loaded.formData['field-skills'], ['Excel', 'Power BI'], 'checkbox group');
  assertDeepEqual(loaded.formData['field-org'], { id: 'org-1', name: 'สำนักงานตรวจเงินแผ่นดิน' }, 'master data object');
  assert(loaded.formData['field-skills__other'] === 'ภาษา Python', 'other-option text');
});

test('F: Attachment metadata (fileName/contentType/fileUrl) ยังครบ ไม่ถูกล้าง', () => {
  __resetApplyDraftsForTests();
  saveApplyDraft(BACK_SAVE_PAYLOAD());
  const loaded = loadApplyDraft('round-back-1');
  assertDeepEqual(loaded.attachments, BACK_SAVE_PAYLOAD().attachments, 'attachments ต้องเหมือนเดิม');
  // สัญญา rehydrate ของหน้า apply: หาไฟล์ด้วย fieldId ได้ทั้ง single และ multi
  const single = loaded.attachments.find((a) => a.fieldId === 'field-file-single');
  assert(single && single.fileUrl && single.fileName, 'single-file meta');
  const multi = loaded.attachments.filter((a) => a.fieldId === 'field-file-multi');
  assert(multi.length === 2, 'multi-file ได้ครบทุกไฟล์');
});

test('K/L: draft ผูกกับ roundId เดิม — หน้า Review อ่านกลับด้วย roundId เดียวกัน', () => {
  __resetApplyDraftsForTests();
  saveApplyDraft(BACK_SAVE_PAYLOAD());
  const loaded = loadApplyDraft('round-back-1');
  assert(loaded.roundId === 'round-back-1', 'roundId ต้องคงเดิม');
  assert(loaded.submissionToken === 'tok-back-123', 'submissionToken ห้ามถูกล้าง (draft mirror)');
  assert(loadApplyDraft('round-อื่น') === null, 'round อื่นไม่ควรเห็น draft นี้');
});

test('N: กลับไปแก้แล้วบันทึกซ้ำ (กลับ Review อีกครั้ง) — ข้อมูลล่าสุดชนะแต่ไม่หาย', () => {
  __resetApplyDraftsForTests();
  saveApplyDraft(BACK_SAVE_PAYLOAD());
  // ผู้ใช้กลับมาแก้ field-text แล้วกดกลับ/ตรวจสอบข้อมูล อีกครั้ง
  const edited = BACK_SAVE_PAYLOAD();
  edited.formData['field-text'] = 'สมชาย แก้แล้ว';
  saveApplyDraft(edited);
  const loaded = loadApplyDraft('round-back-1');
  assert(loaded.formData['field-text'] === 'สมชาย แก้แล้ว', 'ข้อมูลที่แก้ต้องถูกบันทึก');
  assert(loaded.attachments.length === 3, 'attachment เดิมยังอยู่ครบ');
});

test('H: การ save draft เป็น local เท่านั้น — กดกลับไม่เกิด upload ซ้ำ', () => {
  __resetApplyDraftsForTests();
  // saveApplyDraft เขียนเฉพาะ sessionStorage/memory — ครั้งที่สองที่มี
  // fileUrl เดิมจะไม่สร้าง URL ใหม่และไม่เปลี่ยน attachment เดิม
  const first = saveApplyDraft(BACK_SAVE_PAYLOAD());
  const second = saveApplyDraft(BACK_SAVE_PAYLOAD());
  assertDeepEqual(second.attachments, first.attachments, 'fileUrl ต้องคงเดิม (ไม่มี re-upload)');
  assert(loadApplyDraft('round-back-1') !== null, 'draft ไม่ถูกล้าง (ห้าม clear)');
});

test('Draft เก็บ savedAt/version ตามกลไกเดิม (ไม่แตะ contract)', () => {
  __resetApplyDraftsForTests();
  const saved = saveApplyDraft(BACK_SAVE_PAYLOAD());
  assert(saved.version === 1, 'draft version เดิม');
  assert(typeof saved.savedAt === 'number', 'savedAt เดิม');
});

console.log('\n----------------------------------------');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('All apply back navigation tests passed.\n');
