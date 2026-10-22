/**
 * Document Composer — Page Break Block (Frontend Tests)
 * =======================================================================
 *
 * เปลี่ยนแนวทาง 2026-10-22: ตัด Browser Pagination → Continuous Preview
 *
 * ครอบคลุม:
 *   [1] Descriptor helpers — createPageBreakBlock / type union / label
 *   [2] Toolbar — มีปุ่ม "+ Page Break"
 *   [3] BlockItem — separator "📄 หน้าใหม่" + draggable/selectable/delete ได้
 *   [4] Continuous Preview — PreviewFrame ไม่แบ่งหน้าในเบราว์เซอร์
 *   [5] PDF Preview — PdfPreviewFrame เรียก renderer ตัวเดียวกับ export
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx \
 *        src/lib/__tests__/composer-page-break.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BlockToolbar } from '../../app/(admin)/admin/templates/composer/components/BlockToolbar';
import { BlockItem } from '../../app/(admin)/admin/templates/composer/components/BlockItem';
import { PreviewFrame } from '../../app/(admin)/admin/templates/composer/components/PreviewFrame';
import {
  createPageBreakBlock,
  createHeadingBlock,
  createEmptyDescriptor,
  parseDescriptor,
} from '../api/template-descriptor';
import { BLOCK_TYPE_LABELS } from '../../app/(admin)/admin/templates/composer/lib/block-operations';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures = [];

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
  if (!v) throw new Error(`${msg} expected truthy`);
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(
      `${msg} expected to contain ${JSON.stringify(needle)}`
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

function renderToolbar() {
  return renderToStaticMarkup(React.createElement(BlockToolbar, { onAdd: noop }));
}

function renderBlockItem(props = {}) {
  return renderToStaticMarkup(
    React.createElement(BlockItem, {
      block: createPageBreakBlock({ id: 'pb1' }),
      index: 1,
      total: 3,
      onChange: noop,
      onMoveUp: noop,
      onMoveDown: noop,
      onDelete: noop,
      ...props,
    })
  );
}

function fakePreview(body = '<p>เนื้อหา</p>') {
  return {
    html: `<html><body>${body}</body></html>`,
    body,
    header: '',
    styles: '.dc-block { margin: 0; }',
    meta: { blockCount: 1, fieldRefCount: 0, missingFieldIds: [], renderedBlocks: [] },
    mode: 'document',
    tokens: [],
    page: {
      preset: 'normal',
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      contentWidth: 515.28,
      contentHeight: 761.89,
      pageWidth: 595.28,
      pageHeight: 841.89,
    },
  };
}

function renderPreviewFrame(preview = fakePreview()) {
  return renderToStaticMarkup(React.createElement(PreviewFrame, { preview }));
}

// ========== TESTS ==========

console.log('========================================');
console.log('Composer Page Break Tests');
console.log('========================================');

// ---------------------------------------------------------------- [1]
section('[1] Descriptor helpers — pageBreak');

test('createPageBreakBlock มีแค่ id + type (ไม่มี height/size)', () => {
  const b = createPageBreakBlock();
  assertEqual(b.type, 'pageBreak', 'type');
  assertTrue(typeof b.id === 'string' && b.id.length > 0, 'ต้องมี id');
  assertEqual(
    Object.keys(b).sort().join(','),
    'id,type',
    'ต้องมีแค่ id + type (ห้ามมี height/offset/size)'
  );
});

test('createPageBreakBlock ใช้ prefix "pb" และ id ไม่ซ้ำ', () => {
  const a = createPageBreakBlock();
  const b = createPageBreakBlock();
  assertTrue(a.id.startsWith('pb'), `id ควรขึ้นต้นด้วย pb, ได้ ${a.id}`);
  assertTrue(a.id !== b.id, 'id ต้องไม่ซ้ำ');
});

test('createPageBreakBlock รับ overrides ได้ (เช่น marginTop)', () => {
  const b = createPageBreakBlock({ id: 'custom-1', marginTop: 8 });
  assertEqual(b.id, 'custom-1', 'id');
  assertEqual(b.marginTop, 8, 'marginTop');
});

test('BLOCK_TYPE_LABELS มี pageBreak', () => {
  assertEqual(BLOCK_TYPE_LABELS.pageBreak, 'Page Break', 'label');
});

test('client-side validation ยอมรับ pageBreak', () => {
  const res = parseDescriptor(
    JSON.stringify({
      version: 1,
      blocks: [createHeadingBlock({ id: 'h1', text: 'ก' }), createPageBreakBlock()],
    })
  );
  assertEqual(res.ok, true, `ต้องผ่าน: ${JSON.stringify(res.issues)}`);
});

test('descriptor ที่มีแต่ pageBreak ก็ผ่าน validation', () => {
  const res = parseDescriptor(
    JSON.stringify({ version: 1, blocks: [createPageBreakBlock()] })
  );
  assertEqual(res.ok, true, 'block เดียว pageBreak ต้องผ่าน');
});

test('createEmptyDescriptor + pageBreak ไม่พัง', () => {
  const d = createEmptyDescriptor();
  d.blocks.push(createPageBreakBlock());
  const res = parseDescriptor(JSON.stringify(d));
  assertEqual(res.ok, true, 'validate');
  assertEqual(res.value.blocks.length, 1, 'blocks');
});

// ---------------------------------------------------------------- [2]
section('[2] Toolbar — ปุ่มเพิ่ม Page Break');

test('toolbar มีปุ่ม Page Break', () => {
  const html = renderToolbar();
  assertContains(html, 'Page Break', 'ปุ่ม Page Break');
});

test('toolbar ยังมีปุ่มเดิมครบ', () => {
  const html = renderToolbar();
  for (const label of [
    'Heading / Text',
    'System Data',
    'Field',
    'Table',
    'Logo',
    'Signature',
    'Page Break',
  ]) {
    assertContains(html, label, `ปุ่ม ${label}`);
  }
});

// ---------------------------------------------------------------- [3]
section('[3] BlockItem — separator + selectable/deletable');

test('pageBreak แสดงเป็น separator "📄 หน้าใหม่"', () => {
  const html = renderBlockItem();
  assertContains(html, 'page-break-separator', 'testid ของ separator');
  assertContains(html, 'หน้าใหม่', 'ข้อความ หน้าใหม่');
});

test('pageBreak แสดง type label "Page Break"', () => {
  const html = renderBlockItem();
  assertContains(html, 'Page Break', 'type label');
});

test('pageBreak ยัง selectable ได้ (data-block-id + data-selected)', () => {
  const html = renderBlockItem();
  assertContains(html, 'data-block-id="pb1"', 'block id');
  assertContains(html, 'data-selected="false"', 'selected attr');
});

test('pageBreak เลือกแล้วมี highlight (เหมือน block อื่น)', () => {
  const html = renderBlockItem({ isSelected: true });
  assertContains(html, 'data-selected="true"', 'selected');
  assertContains(html, 'ring-blue-500', 'ring สีน้ำเนียบ');
});

test('pageBreak ลบได้ (ปุ่มลบ + ย้ายขึ้น/ลงยังอยู่)', () => {
  const html = renderBlockItem();
  assertContains(html, 'ลบ', 'ปุ่มลบ');
  assertContains(html, 'ย้ายขึ้น', 'ปุ่มขึ้น');
  assertContains(html, 'ย้ายลง', 'ปุ่มลง');
});

test('pageBreak ยังถูก mark ด้วย data-no-select (กันคลิกชนปุ่ม)', () => {
  const html = renderBlockItem();
  assertContains(html, 'data-no-select', 'ปุ่มถูก mark');
});

test('pageBreak ไม่มี inline editor ที่แก้ค่าได้ (บอกผู้ใช้ดู PDF)', () => {
  const html = renderBlockItem({ editorOpenRequest: { blockId: 'pb1', nonce: 1 } });
  assertContains(html, 'PDF Preview', 'อธิบายว่าดูผลแบ่งหน้าที่ PDF Preview');
});

// ---------------------------------------------------------------- [4]
section('[4] Continuous Preview — ไม่แบ่งหน้าในเบราว์เซอร์');

test('PreviewFrame ไม่มีภาชนะ/สคริปต์แบ่งหน้า', () => {
  const html = renderPreviewFrame();
  assertNotContains(html, 'dc-pages', 'ไม่มี dc-pages');
  assertNotContains(html, 'dc-source', 'ไม่มี dc-source');
  assertNotContains(html, 'dc-scaler', 'ไม่มี dc-scaler');
  assertNotContains(html, 'dc-preview-pagination', 'ไม่มี postMessage นับหน้า');
  assertNotContains(html, '<script>', 'ไม่มี script');
});

test('PreviewFrame ยังใส่ padding จาก Page Settings', () => {
  const html = renderPreviewFrame();
  assertContains(html, 'padding: 40pt 40pt 40pt 40pt', 'margin จาก backend');
});

test('PreviewFrame ไม่ fix ความสูง (โตตามเนื้อหา)', () => {
  const html = renderPreviewFrame();
  assertNotContains(html, 'min-height: 841.89pt', 'ไม่ fix สูง');
});

test('PreviewFrame คงความกว้าง A4', () => {
  const html = renderPreviewFrame();
  assertContains(html, 'width: 595.28pt', 'A4 width');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}