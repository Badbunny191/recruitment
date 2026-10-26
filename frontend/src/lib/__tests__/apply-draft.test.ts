// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Apply Draft Tests — loadLatestApplyDraft (prod bug 2026-10-27)
 * =======================================================================
 *
 * Review page แสดง "ไม่พบข้อมูลฉบับร่าง" ทั้งที่ผู้ใช้เพิ่งกด
 * "ตรวจสอบข้อมูล" — root cause: แท็บมี draft มากกว่า 1 รอบ (draft ถูก
 * ลบเฉพาะตอน submit สำเร็จ แต่การกด "กลับ"/"ตรวจสอบข้อมูล" แล้วไม่ submit
 * ทิ้ง draft ไว้) เดิม review โหลดเมื่อมี draft รอบเดียวเท่านั้น
 *
 * Fix: loadLatestApplyDraft() — เลือก draft ที่ savedAt ล่าสุดจากทุก
 * draft ที่ยังใช้ได้ error เมื่อไม่มี draft ใช้ได้เลยเท่านั้น
 *
 *   A. ไม่มี draft → null
 *   B. draft เดียว → ได้ draft นั้น
 *   C. หลาย draft (repro เดิม) → ได้ใบ savedAt ล่าสุด — ไม่ error
 *   D. draft เสีย/เวอร์ชันเก่าปนอยู่ → ข้าม แล้วเอาใบที่ใช้ได้ที่ล่าสุด
 *   E. draft ทั้งหมดเสีย → null (review error ได้)
 *   F. savedAt เท่ากัน → ตัดสินแบบ deterministic (ใบแรกที่เจอชนะ)
 *
 * Run: node --import tsx src/lib/__tests__/apply-draft.test.ts
 */

import {
  saveApplyDraft,
  loadApplyDraft,
  loadLatestApplyDraft,
  listDraftRoundIds,
  __resetApplyDraftsForTests,
  __writeRawApplyDraftForTests,
} from '../applyDraft';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

/** คุม Date.now เพื่อให้ savedAt ต่างกันแน่นอนในแต่ละ save */
function withFakeTime(ms, fn) {
  const original = Date.now;
  Date.now = () => ms;
  try {
    fn();
  } finally {
    Date.now = original;
  }
}

const draftInput = (roundId, extra = {}) => ({
  roundId,
  formData: { 'field-name': `ค่าของรอบ ${roundId}` },
  attachments: [],
  submissionToken: `token-${roundId}`,
  ...extra,
});

// Node (tsx) ไม่มี window → applyDraft ใช้ memoryFallback อัตโนมัติ
// รีเซ็ตทุกเคสกัน state ตกค้าง
function freshState() {
  __resetApplyDraftsForTests();
}

// =========================================================
//  A. ไม่มี draft
// =========================================================

test('A: ไม่มี draft เลย → null (review error ได้ตาม contract)', () => {
  freshState();
  assertEqual(loadLatestApplyDraft(), null, 'ต้องเป็น null');
  assertEqual(listDraftRoundIds().length, 0, 'ไม่มีรอบค้าง');
});

// =========================================================
//  B. draft เดียว
// =========================================================

test('B: draft เดียว → ได้ draft นั้นทันที', () => {
  freshState();
  withFakeTime(1000, () => saveApplyDraft(draftInput('round-a')));
  const latest = loadLatestApplyDraft();
  assertEqual(latest?.roundId, 'round-a', 'ต้องได้รอบเดียวที่มี');
  assertEqual(latest?.submissionToken, 'token-round-a', 'token ต้องตามมาด้วย');
});

// =========================================================
//  C. หลาย draft — repro เดิม
// =========================================================

test('C: 2 drafts (กด "กลับ" รอบ A แล้วสมัครรอบ B) → ได้ใบล่าสุด ไม่ error', () => {
  freshState();
  // รอบ A: กรอกแล้วกด "กลับ" (หรือ ตรวจสอบข้อมูล แล้วไม่ submit)
  withFakeTime(1000, () => saveApplyDraft(draftInput('round-a')));
  // รอบ B: กรอกครบ → กด "ตรวจสอบข้อมูล" (เพิ่ง save ล่าสุด)
  withFakeTime(2000, () => saveApplyDraft(draftInput('round-b')));
  assertEqual(listDraftRoundIds().length, 2, 'ต้องมี 2 drafts ในแท็บเดียวกัน — สถานการณ์ที่เคยทำ review error');
  const latest = loadLatestApplyDraft();
  assertEqual(latest?.roundId, 'round-b', 'ต้อง resume ใบที่ savedAt ล่าสุด');
  assertEqual(latest?.formData['field-name'], 'ค่าของรอบ round-b', 'ข้อมูลต้องเป็นของรอบ B');
});

test('C2: สลับลำดับการ save (ใบเก่า save ทีหลังใน key อื่น) → ยังเลือกตาม savedAt', () => {
  freshState();
  withFakeTime(5000, () => saveApplyDraft(draftInput('round-x')));
  withFakeTime(1000, () => saveApplyDraft(draftInput('round-y')));
  // listDraftRoundIds อาจคืนตามลำดับ key ไม่ใช่เวลา — ต้องตัดสินด้วย savedAt
  const latest = loadLatestApplyDraft();
  assertEqual(latest?.roundId, 'round-x', 'savedAt 5000 ต้องชนะ ไม่ว่าลำดับ key');
});

// =========================================================
//  D. draft เสีย/เวอร์ชันเก่าปนอยู่ (ฉีดผ่าน __writeRawApplyDraftForTests)
// =========================================================

test('D: JSON เสีย 1 ใบ + ใบใช้ได้ → ข้ามใบเสีย เอาใบที่ใช้ได้', () => {
  freshState();
  __writeRawApplyDraftForTests('round-corrupt', '{not-json');
  withFakeTime(1000, () => saveApplyDraft(draftInput('round-ok')));
  const latest = loadLatestApplyDraft();
  assertEqual(latest?.roundId, 'round-ok', 'ใบเสียต้องไม่บล็อกใบที่ใช้ได้');
});

test('D2: draft version เก่า (loadApplyDraft ลบทิ้ง) + ใบใช้ได้ → เลือกใบที่ใช้ได้', () => {
  freshState();
  __writeRawApplyDraftForTests(
    'round-old',
    JSON.stringify({ version: 999, roundId: 'round-old', formData: {}, attachments: [], submissionToken: 't', savedAt: 9999 }),
  );
  withFakeTime(1000, () => saveApplyDraft(draftInput('round-ok')));
  const latest = loadLatestApplyDraft();
  assertEqual(latest?.roundId, 'round-ok', 'ใบ version เก่า (savedAt ใหม่กว่าด้วยซ้อน) ต้องไม่ถูกเลือก');
  assertTrue(!listDraftRoundIds().includes('round-old'), 'ใบ version เก่าต้องถูกลบทิ้งตาม loadApplyDraft');
});

// =========================================================
//  E. ทุกใบใช้ไม่ได้ → null
// =========================================================

test('E: draft ทั้งหมดเสีย → null (review error ตาม contract)', () => {
  freshState();
  __writeRawApplyDraftForTests('round-corrupt-1', '{not-json');
  __writeRawApplyDraftForTests('round-corrupt-2', 'null');
  assertEqual(loadLatestApplyDraft(), null, 'ไม่มี draft ที่ใช้ได้ → null');
});

// =========================================================
//  F. savedAt เท่ากัน — deterministic
// =========================================================

test('F: savedAt เท่ากันทุกใบ → ใบแรกตามลำดับการเดิน keys ชนะ (ไม่ throw)', () => {
  freshState();
  withFakeTime(1000, () => {
    saveApplyDraft(draftInput('round-1'));
    saveApplyDraft(draftInput('round-2'));
  });
  const ids = listDraftRoundIds();
  assertEqual(ids.length, 2, 'ต้องมี 2 ใบ');
  const latest = loadLatestApplyDraft();
  assertTrue(ids.includes(latest.roundId), 'ต้องได้ใบใดใบหนึ่งที่มีอยู่จริง');
});

// =========================================================
console.log('\n========================================');
if (failed > 0) {
  console.log(`FAIL: ${failed} failed, ${passed} passed`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log(`PASS: all ${passed} tests passed`);
}
