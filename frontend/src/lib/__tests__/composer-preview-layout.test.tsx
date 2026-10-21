/**
 * Document Composer — Live Preview Layout Structure Tests (ก้อนที่ 2 UAT fix)
 * =======================================================================
 *
 * ปัญหาที่พบจาก UAT บน Browser จริง:
 *   Card ฝั่ง Live Preview สูงเต็ม แต่พื้นที่ iframe จบกลางคอลัมน์
 *   → เหลือพื้นที่ว่างท้องล่างจำนวนมาก
 *
 * Root cause (พิสูจน์จาก DOM/computed styles):
 *   1. `CardContent` ของ Card ฝั่ง Preview เป็น block container
 *      (ไม่ใช่ flex) → child (`PreviewPanel`) ไม่ได้รับ remaining height
 *   2. `PreviewPanel` ไม่มี `flex-1` / `h-full` → สูงตามเนื้อหาเท่านั้น
 *   3. wrapper ของ Preview มี `min-h-[280px]` (ความสูงตายตัว) → ห้ามไป
 *   4. `overflow-y-auto` อยู่ผิดชั้น (ที่ CardContent) — scroll ต้องอยู่ใน iframe
 *   5. PreviewFrame default class เป็น `h-[500px]` (ความสูงตายตัว)
 *
 * ไฟล์นี้พิสูจน์ **โครงสร้าง class** ของ hierarchy ดังกล่าว
 * โดยไม่ต้องเพิ่ม package ใหม่ (react-dom/server + อ่าน source ไฟล์)
 *
 * Run: node --import tsx src/lib/__tests__/composer-preview-layout.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PreviewPanel } from '../../app/(admin)/admin/templates/composer/components/PreviewPanel';
import { PreviewFrame } from '../../app/(admin)/admin/templates/composer/components/PreviewFrame';
import { ComposerWorkspace } from '../../app/(admin)/admin/templates/composer/components/ComposerWorkspace';

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

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${v}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg} expected falsy, got ${v}`);
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
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

const fakePreview = {
  html: '<html><body>x</body></html>',
  body: '<div class="dc-preview">เนื้อหา</div>',
  header: '<div>header</div>',
  styles: '.dc-preview{}',
  meta: {
    blockCount: 2,
    fieldRefCount: 1,
    missingFieldIds: [],
    renderedBlocks: [],
  },
  mode: 'form',
  tokens: [],
};

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    React.createElement(PreviewPanel, {
      preview: fakePreview,
      loading: false,
      ...props,
    })
  );
}

function renderFrame(props = {}) {
  return renderToStaticMarkup(
    React.createElement(PreviewFrame, {
      preview: fakePreview,
      ...props,
    })
  );
}

function renderWorkspace(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ComposerWorkspace, {
      layoutMode: 'desktop',
      activeTab: 'composer',
      onTabChange: noop,
      sidebarCollapsed: false,
      onToggleSidebar: noop,
      onResetLayout: noop,
      onGenerate: noop,
      onLoad: noop,
      onSave: noop,
      onFullscreenPreview: noop,
      loading: {
        generate: false,
        load: false,
        save: false,
        preview: false,
      },
      canSave: true,
      canPreview: true,
      composerContent: React.createElement('div', null, 'COMPOSER-CONTENT'),
      previewContent: React.createElement('div', null, 'PREVIEW-CONTENT'),
      splitRatio: 0.5,
      isDragging: false,
      dividerProps: {
        onKeyDown: noop,
        onPointerDown: noop,
        onDoubleClick: noop,
      },
      containerRef: { current: null },
      ...props,
    })
  );
}

/** อ่าน source file ของ composer เพื่อพิสูจน์ว่าไม่มี fixed height เหลือ */
function readComposerSource(relativePath) {
  const root = join(process.cwd(), 'src/app/(admin)/admin/templates/composer');
  return readFileSync(join(root, relativePath), 'utf8');
}

// ============================================================== [1]
console.log('========================================');
console.log('Composer Live Preview Layout Tests');
console.log('========================================');

section('[1] Preview column — flex column + min-h-0');

test('desktop: คอลัมน์ Preview เป็น flex column และมี min-h-0', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  // คอลัมน์ Preview (ขวา) ใช้ pl-1 (คอลัมน์ composer ใช้ pr-1) → แยกได้
  assertContains(html, 'min-w-0 min-h-0 flex flex-col pl-1 h-full', 'preview column classes');
});

test('desktop: คอลัมน์ Preview อยู่ใน container ที่มี min-h-0 + flex-1', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'flex items-stretch min-w-0 min-h-0 flex-1', 'container classes');
});

test('desktop: คอลัมน์ Preview อยู่ในแถวที่กำหนดความสูงจริง (items-stretch)', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'flex items-stretch min-h-0', 'row classes');
});

// ============================================================== [2]
section('[2] Preview content wrapper — flex-1 + min-h-0');

test('PreviewPanel root เป็น flex column ที่มี flex-1 และ min-h-0', () => {
  const html = renderPanel();
  assertContains(html, 'flex flex-col flex-1 min-h-0', 'panel root classes');
});

test('PreviewPanel root ไม่มี height/min-height แบบคงที่', () => {
  const html = renderPanel();
  assertNotContains(html, 'min-h-[240px]', 'ไม่มี min-h ตายตัว');
  assertNotContains(html, 'min-h-[280px]', 'ไม่มี min-h ตายตัว');
  assertNotContains(html, 'h-[', 'ไม่มี height ตายตัว');
});

test('metadata (บรรทัด blocks / auto-refresh) อยู่บนและไม่ยืดขยาย', () => {
  const html = renderPanel();
  assertContains(html, 'shrink-0', 'metadata ต้อง shrink-0');
  assertContains(html, 'auto-refresh 1.5s', 'metadata ถูก render');
});

test('wrapper ของ Preview เป็น flex-1 + min-h-0 (ขยายเต็มพื้นที่ที่เหลือ)', () => {
  const html = renderPanel();
  assertContains(html, 'flex flex-1 min-h-0 min-w-0 overflow-hidden', 'wrapper classes');
});

test('PreviewPanel ไม่มี overflow-y-auto ที่ชั้นนอก (scroll อยู่ใน iframe)', () => {
  const html = renderPanel();
  assertNotContains(html, 'overflow-y-auto', 'ไม่มี overflow ที่ชั้นนอก');
});

test('PreviewPanel ว่าง (ยังไม่มี preview) ก็เต็มพื้นที่', () => {
  const html = renderPanel({ preview: null, loading: false });
  assertContains(html, 'flex flex-1 min-h-0', 'empty state ต้องเต็มพื้นที่');
  assertNotContains(html, 'min-h-[240px]', 'ไม่มี min-h ตายตัว');
});

test('PreviewPanel ตอน loading ก็เต็มพื้นที่', () => {
  const html = renderPanel({ preview: null, loading: true });
  assertContains(html, 'flex flex-1 min-h-0', 'loading state ต้องเต็มพื้นที่');
  assertNotContains(html, 'min-h-[240px]', 'ไม่มี min-h ตายตัว');
});

// ============================================================== [3]
section('[3] PreviewFrame / iframe — สูงเต็ม parent');

test('iframe มี width 100% และ height 100% ของพื้นที่ที่ได้รับ', () => {
  const html = renderFrame();
  assertContains(html, 'w-full', 'width 100%');
  assertContains(html, 'h-full', 'height 100%');
});

test('PreviewFrame default class ไม่มีความสูงตายตัว', () => {
  const html = renderFrame();
  assertNotContains(html, 'h-[500px]', 'ไม่มี h-[500px]');
  assertNotContains(html, 'min-h-[', 'ไม่มี min-h ตายตัว');
});

test('iframe ที่อยู่ใน PreviewPanel มีทั้ง w-full และ h-full', () => {
  const html = renderPanel();
  assertContains(html, 'w-full h-full', 'iframe ต้อง w-full h-full');
});

// ============================================================== [4]
section('[4] ไม่มี fixed height เหลือในไฟล์ของ Workspace/Preview');

test('PreviewPanel.tsx ไม่มี min-h-[280px] / min-h-[240px] / h-[...]', () => {
  const src = readComposerSource('components/PreviewPanel.tsx');
  assertNotContains(src, 'min-h-[280px]', 'PreviewPanel');
  assertNotContains(src, 'min-h-[240px]', 'PreviewPanel');
  assertNotContains(src, 'h-[500px]', 'PreviewPanel');
});

test('PreviewFrame.tsx ไม่มี h-[500px] (default class) และไม่มี compactHeight', () => {
  const src = readComposerSource('components/PreviewFrame.tsx');
  assertNotContains(src, 'h-[500px]', 'PreviewFrame');
  assertNotContains(src, 'compactHeight', 'PreviewFrame');
});

test('ComposerClient.tsx: CardContent ของ Preview เป็น flex column', () => {
  const src = readComposerSource('ComposerClient.tsx');
  assertContains(
    src,
    'flex-1 min-h-0 flex flex-col overflow-hidden',
    'CardContent ของ preview ต้องเป็น flex column'
  );
});

test('ComposerClient.tsx: Card ของ Preview เป็น flex column + h-full + overflow-hidden', () => {
  const src = readComposerSource('ComposerClient.tsx');
  assertContains(
    src,
    'flex flex-col min-h-0 h-full overflow-hidden',
    'Card ของ preview ต้องเป็น flex column เต็มความสูง'
  );
});

// ============================================================== [5]
section('[5] Mobile Preview tab — ใช้ full available height');

test('mobile: tabpanel ที่ active ใช้ flex + flex-1 + min-h-0', () => {
  const html = renderWorkspace({ layoutMode: 'mobile', activeTab: 'preview' });
  assertContains(html, 'flex flex-1', 'tabpanel ต้อง flex-1');
  assertContains(html, 'flex-col min-h-0', 'tabpanel ต้อง min-h-0');
});

test('mobile: container ของแท็บเป็น flex-1 + min-h-0', () => {
  const html = renderWorkspace({ layoutMode: 'mobile', activeTab: 'preview' });
  assertContains(html, 'flex flex-col min-h-0 flex-1', 'mobile container');
});

test('mobile: workspace ถูกกำหนดความสูงจากการวัดจริง (ไม่ใช่สูงตามเนื้อหา)', () => {
  const html = renderWorkspace({
    layoutMode: 'mobile',
    activeTab: 'preview',
    workspaceHeight: 640,
  });
  assertContains(html, 'height:640px', 'mobile ต้องใช้ความสูงที่วัดได้');
});

test('mobile: tabpanel ของ preview ถูก render และ active', () => {
  const html = renderWorkspace({ layoutMode: 'mobile', activeTab: 'preview' });
  assertContains(html, 'data-testid="workspace-panel-preview"', 'preview panel');
  assertContains(html, 'PREVIEW-CONTENT', 'preview content');
});

// ============================================================== [6]
section('[6] Regression — โครงสร้างเดิมยังอยู่ครบ');

test('desktop: Actions sidebar ยังอยู่', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'data-testid="actions-sidebar"', 'sidebar');
});

test('desktop: Divider ยังอยู่', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'data-testid="workspace-divider"', 'divider');
});

test('mobile: ยังเป็น tab แบบเดิม (ไม่มี divider)', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'role="tablist"', 'tablist');
  assertNotContains(html, 'data-testid="workspace-divider"', 'ไม่มี divider');
});

test('PreviewPanel ยังแสดง metadata และ missing fields', () => {
  const html = renderPanel({
    preview: {
      ...fakePreview,
      meta: { ...fakePreview.meta, missingFieldIds: ['f1'] },
    },
  });
  assertContains(html, 'blocks', 'metadata');
  assertContains(html, 'Missing Fields:', 'missing fields');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
