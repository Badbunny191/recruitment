/**
 * Document Composer — Block Selection / Highlight (Component Render Tests)
 * =======================================================================
 *
 * ใช้ react-dom/server (SSR render) เพื่อตรวจ markup ที่ render ออกไป
 * โดยไม่ต้องเพิ่ม package ใหม่ (ไม่มี jsdom / testing-library ในโปรเจกต์)
 *
 * ครอบคลุม:
 *   - Toolbar แสดงป้ายตำแหน่งที่จะเพิ่ม ("เพิ่มต่อจาก Block #X" / "เพิ่มต่อท้ายเอกสาร")
 *   - BlockItem แสดงสถานะ selected / newly-added ด้วย data attribute + class
 *   - ปุ่มใน header row / inline editor ถูก mark ด้วย data-no-select
 *     (คลิกแล้วไม่ชนกับการเลือก block)
 *
 * Run: node --import tsx src/lib/__tests__/composer-block-render.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BlockToolbar } from '../../app/(admin)/admin/templates/composer/components/BlockToolbar';
import { BlockItem } from '../../app/(admin)/admin/templates/composer/components/BlockItem';
import {
  createFieldBlock,
  createHeadingBlock,
} from '../api/template-descriptor';

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
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${v}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg} expected falsy, got ${v}`);
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(
      `${msg} expected to contain ${JSON.stringify(needle)}\n  got: ${haystack}`
    );
  }
}

function assertNotContains(haystack, needle, msg = '') {
  if (haystack.includes(needle)) {
    throw new Error(`${msg} expected NOT to contain ${JSON.stringify(needle)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ========== HELPERS ==========

const noop = () => {};

function renderToolbar(insertionHint?: string) {
  return renderToStaticMarkup(
    React.createElement(BlockToolbar, { onAdd: noop, insertionHint })
  );
}

function renderBlockItem(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(BlockItem, {
      block: createHeadingBlock({ id: 'b1', text: 'หัวข้อ' }),
      index: 0,
      total: 3,
      onChange: noop,
      onMoveUp: noop,
      onMoveDown: noop,
      onDelete: noop,
      ...props,
    })
  );
}

// ============================================================== [1]
console.log('========================================');
console.log('Composer Block Render Tests');
console.log('========================================');

section('[1] Toolbar — ป้ายบอกตำแหน่งที่จะเพิ่ม');

test('แสดง hint "เพิ่มต่อจาก Block #3"', () => {
  const html = renderToolbar('เพิ่มต่อจาก Block #3');
  assertContains(html, 'เพิ่มต่อจาก Block #3', 'hint');
  assertContains(html, 'block-toolbar-insertion-hint', 'testid');
});

test('แสดง hint "เพิ่มต่อท้ายเอกสาร"', () => {
  const html = renderToolbar('เพิ่มต่อท้ายเอกสาร');
  assertContains(html, 'เพิ่มต่อท้ายเอกสาร', 'hint');
});

test('ไม่มี hint → ไม่ render element ของ hint', () => {
  const html = renderToolbar(undefined);
  assertNotContains(html, 'block-toolbar-insertion-hint', 'ไม่มี hint');
  // ปุ่มเพิ่ม block ยังต้องอยู่
  assertContains(html, 'Heading / Text', 'ปุ่มยังอยู่');
  assertContains(html, 'System Data', 'ปุ่มยังอยู่');
  assertContains(html, 'Field', 'ปุ่มยังอยู่');
  assertContains(html, 'Table', 'ปุ่มยังอยู่');
  assertContains(html, 'Logo', 'ปุ่มยังอยู่');
  assertContains(html, 'Signature', 'ปุ่มยังอยู่');
});

test('ไม่มี hint → ไม่มีข้อความตำแหน่งค้างไว้', () => {
  const html = renderToolbar(undefined);
  assertNotContains(html, 'เพิ่มต่อจาก Block', 'ไม่มี hint');
});

// ============================================================== [2]
section('[2] BlockItem — สถานะ selected / newly-added');

test('ไม่มี selection → data-selected="false"', () => {
  const html = renderBlockItem({});
  assertContains(html, 'data-selected="false"', 'selected attr');
  assertContains(html, 'data-newly-added="false"', 'newly-added attr');
});

test('selected → data-selected="true" + ring สีน้ำเงิน', () => {
  const html = renderBlockItem({ isSelected: true });
  assertContains(html, 'data-selected="true"', 'selected attr');
  assertContains(html, 'ring-blue-500', 'ring class');
  assertContains(html, 'เลือกอยู่', 'badge');
});

test('newly-added → data-newly-added="true" + ring สีเขียว', () => {
  const html = renderBlockItem({ isNewlyAdded: true });
  assertContains(html, 'data-newly-added="true"', 'newly-added attr');
  assertContains(html, 'ring-emerald-500', 'ring class');
  assertContains(html, 'เพิ่มใหม่', 'badge');
});

test('selected + newly-added → ไฮไลต์ใหม่มี priority สูงกว่า', () => {
  const html = renderBlockItem({ isSelected: true, isNewlyAdded: true });
  assertContains(html, 'ring-emerald-500', 'ring class ใหม่');
  assertNotContains(html, 'ring-blue-500', 'ไม่ควรมี ring สีน้ำเงิน');
});

test('ไม่ selected → ไม่มี ring class', () => {
  const html = renderBlockItem({});
  assertNotContains(html, 'ring-blue-500', 'ไม่มี ring');
  assertNotContains(html, 'ring-emerald-500', 'ไม่มี ring');
});

// ============================================================== [3]
section('[3] BlockItem — ปุ่มไม่ชนกับการเลือก block');

test('โซนปุ่มใน header ถูก mark ด้วย data-no-select', () => {
  const html = renderBlockItem({});
  assertContains(html, 'data-no-select', 'ปุ่มถูก mark');
});

test('inline editor ถูก mark ด้วย data-no-select (กันชนกับ input/textarea)', () => {
  const html = renderBlockItem({ editorOpenRequest: { blockId: 'b1', nonce: 1 } });
  // editor เปิด → ต้องมี data-no-select ครอบ editor
  const count = html.split('data-no-select').length - 1;
  assertTrue(count >= 2, `คาดว่ามี data-no-select อย่างน้อย 2 จุด, ได้ ${count}`);
});

test('ปุ่มแก้ไข / ลบ / ขึ้น-ลง ยังอยู่ครบ', () => {
  const html = renderBlockItem({});
  assertContains(html, 'ย้ายขึ้น', 'ปุ่มขึ้น');
  assertContains(html, 'ย้ายลง', 'ปุ่มลง');
  assertContains(html, 'แก้ไข', 'ปุ่มแก้ไข');
  assertContains(html, 'ลบ', 'ปุ่มลบ');
});

test('block.id ถูกใส่ใน data-block-id (identity จริง ไม่ใช่ index)', () => {
  const html = renderBlockItem({ block: createFieldBlock('f1', { id: 'xyz-1' }) });
  assertContains(html, 'data-block-id="xyz-1"', 'block id');
});

// ============================================================== [4]
section('[4] BlockItem — รองรับ block ทุกประเภท');

test('field block แสดง label จาก field library', () => {
  const html = renderBlockItem({
    block: createFieldBlock('f1', { id: 'b1', label: 'ชื่อ-นามสกุล' }),
  });
  assertContains(html, 'Field', 'type label');
  assertContains(html, 'ชื่อ-นามสกุล', 'field label');
});

test('heading block แสดงข้อความ', () => {
  const html = renderBlockItem({
    block: createHeadingBlock({ id: 'b1', text: 'หัวข้อทดสอบ' }),
  });
  assertContains(html, 'หัวข้อทดสอบ', 'heading text');
});

test('ไม่มี onSelect → ยัง render ได้ปกติ (back-compat)', () => {
  const html = renderBlockItem({ onSelect: undefined });
  assertContains(html, 'data-block-id', 'ยัง render');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
