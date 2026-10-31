// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * SignatureEditor — checkbox "แสดงเวลา" (Component Tests)
 * =======================================================================
 *
 * Feature: Signature Block — แสดงเวลา (Asia/Bangkok) ใน PDF Composer
 *
 * ครอบคลุม:
 *   1. checkbox "แสดงเวลา" ต้องมีอยู่ใน UI (default: unchecked — คงพฤติกรรมเดิม)
 *   2. block ที่มี showTime: true → checkbox checked
 *   3. คลิก checkbox → onChange ได้รับ { showTime: true/false }
 *   4. regression: "แสดงชื่อผู้สมัคร" / "แสดงวันที่" ยังทำงานเหมือนเดิม
 *
 * หมายเหตุ: การ render เวลาจริงใน preview/PDF ทดสอบที่ฝั่ง backend
 *   (backend/src/lib/document-composer/__tests__/signature-block.test.ts
 *    section [11] — toggle matrix + Preview/PDF parity)
 *
 * Run: tsx --tsconfig tsconfig.test.json src/lib/__tests__/signature-editor.test.tsx
 */

// ---------- happy-dom environment — ตั้งก่อน import React ----------
import { Window } from 'happy-dom';

const win = new Window({
  url: 'http://localhost:3000/admin/templates',
});
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch { /* Node 24 navigator เป็น getter-only — ข้าม */ }
globalAny.HTMLElement = win.HTMLElement;
try { globalAny.Event = win.Event; } catch { /* already defined */ }
try { globalAny.CustomEvent = win.CustomEvent; } catch { /* already defined */ }
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
(globalAny as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------- imports ----------
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { SignatureEditor } from '../../app/(admin)/admin/templates/composer/components/SignatureEditor';
import { createSignatureBlock } from '../api/template-descriptor';

// ---------- test runner ----------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  } finally {
    // cleanup ทุกครั้งแม้ test throw — กัน orphan React root ค้างบน
    // happy-dom document แล้วไปดึง querySelectorAll ของ test ถัดไป
    while (cleanups.length) {
      try { cleanups.pop()(); } catch { /* best-effort */ }
    }
  }
}

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg || 'expected truthy'} — got ${JSON.stringify(v)}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg || 'expected falsy'} — got ${JSON.stringify(v)}`);
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// ---------- helpers ----------

/**
 * หา input checkbox ใน label ที่มีข้อความตรงกัน (เช่น "แสดงเวลา")
 * เดิน document ที่ happy-dom mount ไว้
 */
function findCheckboxByLabel(text) {
  const labels = Array.from(win.document.querySelectorAll('label'));
  const label = labels.find((l) => (l.textContent || '').includes(text));
  if (!label) return null;
  return label.querySelector('input[type="checkbox"]');
}

/** Mount SignatureEditor หนึ่งครั้ง → คืน { onChangePatches, clickCheckbox } */
const cleanups = [];
function mountEditor(block) {
  const onChangePatches = [];
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = (patch) => onChangePatches.push(patch);
  act(() => {
    root.render(
      React.createElement(SignatureEditor, {
        block,
        onChange,
        fields: [],
        fieldsLoading: false,
        disabled: false,
      })
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    onChangePatches,
    clickCheckbox(text) {
      const input = findCheckboxByLabel(text);
      assertTrue(input, `ต้องเจอ checkbox "${text}"`);
      // จำลอง user click แบบ browser จริง: browser toggle checked
      // (activation behavior) ก่อน แล้วค่อย dispatch "click" —
      // React 18 ChangeEventPlugin สังเคราะห์ onChange ของ checkbox
      // จาก click event + diff ของ _valueTracker เท่านั้น
      // (native "change" บน checkbox ถูก ignore / ต้อง toggle ผ่าน
      //  native setter เพื่อไม่ให้ tracker รู้ค่าใหม่ล่วงหน้า)
      const nativeCheckedSetter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        'checked'
      ).set;
      nativeCheckedSetter.call(input, !input.checked);
      act(() => {
        input.dispatchEvent(new win.Event('click', { bubbles: true }));
      });
    },
  };
}

// ---------- tests ----------

console.log('\n═══ SignatureEditor — "แสดงเวลา" checkbox ═══\n');

test('T1: checkbox "แสดงเวลา" ต้องแสดงใน UI', () => {
  const ed = mountEditor(createSignatureBlock());
  const input = findCheckboxByLabel('แสดงเวลา');
  assertTrue(input, 'ต้องมี label "แสดงเวลา" พร้อม input checkbox');
});

test('T2: default (block ไม่มี showTime) → checkbox unchecked (คงพฤติกรรมเดิม)', () => {
  const ed = mountEditor(createSignatureBlock());
  const input = findCheckboxByLabel('แสดงเวลา');
  assertTrue(input);
  assertFalse(
    input.checked,
    'default ต้องเป็น false — template เก่าต้องไม่เปลี่ยนผลลัพธ์'
  );
});

test('T3: block showTime: true → checkbox checked', () => {
  const ed = mountEditor(createSignatureBlock({ showTime: true }));
  const input = findCheckboxByLabel('แสดงเวลา');
  assertTrue(input);
  assertTrue(input.checked, 'showTime: true ต้องแสดงเป็น checked');
});

test('T4: คลิก "แสดงเวลา" → onChange ได้รับ { showTime: true }', () => {
  const ed = mountEditor(createSignatureBlock());
  ed.clickCheckbox('แสดงเวลา');
  assertEqual(ed.onChangePatches.length, 1, 'ต้องเรียก onChange 1 ครั้ง');
  assertEqual(ed.onChangePatches[0].showTime, true);
});

test('T5: คลิก "แสดงเวลา" (เมื่อ checked) → onChange ได้รับ { showTime: false }', () => {
  const ed = mountEditor(createSignatureBlock({ showTime: true }));
  ed.clickCheckbox('แสดงเวลา');
  assertEqual(ed.onChangePatches.length, 1);
  assertEqual(ed.onChangePatches[0].showTime, false);
});

test('T6: regression — "แสดงชื่อผู้สมัคร" / "แสดงวันที่" ยัง default checked', () => {
  const ed = mountEditor(createSignatureBlock());
  const nameInput = findCheckboxByLabel('แสดงชื่อผู้สมัคร');
  const dateInput = findCheckboxByLabel('แสดงวันที่');
  assertTrue(nameInput, 'ต้องมี checkbox "แสดงชื่อผู้สมัคร"');
  assertTrue(dateInput, 'ต้องมี checkbox "แสดงวันที่"');
  assertTrue(nameInput.checked, 'showName default = true');
  assertTrue(dateInput.checked, 'showDate default = true');
});

test('T7: regression — คลิก "แสดงวันที่" ยังส่ง { showDate: false } ถูกต้อง', () => {
  const ed = mountEditor(createSignatureBlock());
  ed.clickCheckbox('แสดงวันที่');
  assertEqual(ed.onChangePatches.length, 1);
  assertEqual(ed.onChangePatches[0].showDate, false);
});

// ---------- summary ----------

console.log('\n═══ Summary ═══');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
