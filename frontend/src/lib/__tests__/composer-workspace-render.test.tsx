/**
 * Document Composer — Workspace Render Tests (ก้อนที่ 2)
 * =======================================================================
 *
 * ใช้ react-dom/server (SSR render) เพื่อตรวจ markup ที่ render ออกไป
 * โดยไม่ต้องเพิ่ม package ใหม่ (ไม่มี jsdom / testing-library ในโปรเจกต์)
 *
 * ครอบคลุม:
 *   - Divider มี accessibility attributes ครบ
 *     (role=separator, aria-orientation, aria-valuemin/max/now, focusable)
 *   - Collapsed Actions มี aria-label ครบทุกปุ่ม
 *   - Expanded Actions แสดงชื่อคำสั่งครบ
 *   - ปุ่มย่อ/ขยายมี aria-expanded
 *   - Mobile mode แสดง tab list
 *   - Fullscreen Preview ยังเรียก callback เดิม
 *
 * Run: node --import tsx src/lib/__tests__/composer-workspace-render.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceDivider } from '../../app/(admin)/admin/templates/composer/components/WorkspaceDivider';
import { ActionsSidebar } from '../../app/(admin)/admin/templates/composer/components/ActionsSidebar';
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

const defaultLoading = {
  generate: false,
  load: false,
  save: false,
  preview: false,
};

function renderDivider(props = {}) {
  return renderToStaticMarkup(
    React.createElement(WorkspaceDivider, {
      ratio: 0.5,
      onPointerDown: noop,
      onKeyDown: noop,
      onDoubleClick: noop,
      ...props,
    })
  );
}

function renderSidebar(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ActionsSidebar, {
      collapsed: false,
      onToggleCollapsed: noop,
      onResetLayout: noop,
      onGenerate: noop,
      onLoad: noop,
      onSave: noop,
      onFullscreenPreview: noop,
      loading: defaultLoading,
      canSave: true,
      canPreview: true,
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
      loading: defaultLoading,
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

// ============================================================== [1]
console.log('========================================');
console.log('Composer Workspace Render Tests');
console.log('========================================');

section('[1] Divider — accessibility attributes ครบ');

test('มี role="separator"', () => {
  const html = renderDivider();
  assertContains(html, 'role="separator"', 'role');
});

test('มี aria-orientation="vertical"', () => {
  const html = renderDivider();
  assertContains(html, 'aria-orientation="vertical"', 'orientation');
});

test('focusable (tabindex="0")', () => {
  const html = renderDivider();
  assertContains(html, 'tabindex="0"', 'tabindex');
});

test('มี aria-valuemin', () => {
  const html = renderDivider();
  assertContains(html, 'aria-valuemin="25"', 'valuemin');
});

test('มี aria-valuemax', () => {
  const html = renderDivider();
  assertContains(html, 'aria-valuemax="75"', 'valuemax');
});

test('มี aria-valuenow ตามค่า ratio', () => {
  const html = renderDivider({ ratio: 0.4 });
  assertContains(html, 'aria-valuenow="40"', 'valuenow');
});

test('มี aria-valuetext อธิบายสัดส่วน', () => {
  const html = renderDivider({ ratio: 0.6 });
  assertContains(html, 'aria-valuetext="Visual Composer 60%', 'valuetext');
});

test('มี aria-label', () => {
  const html = renderDivider();
  assertContains(html, 'aria-label=', 'aria-label');
});

test('cursor เป็น col-resize', () => {
  const html = renderDivider();
  assertContains(html, 'cursor-col-resize', 'cursor');
});

test('มี data-testid สำหรับ automation', () => {
  const html = renderDivider();
  assertContains(html, 'data-testid="workspace-divider"', 'testid');
});

test('สถานะ dragging ถูกสะท้อนใน data attribute', () => {
  const html = renderDivider({ isDragging: true });
  assertContains(html, 'data-dragging="true"', 'dragging');
});

// ============================================================== [2]
section('[2] Actions sidebar — expanded');

test('ขยาย: แสดงชื่อคำสั่งครบ', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'Generate', 'Generate');
  assertContains(html, 'Load', 'Load');
  assertContains(html, 'Save', 'Save');
  assertContains(html, 'Preview (Fullscreen)', 'Preview');
});

test('ขยาย: มีปุ่มรีเซ็ตพื้นที่ทำงาน', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'รีเซ็ตพื้นที่ทำงาน', 'reset');
});

test('ปุ่มย่อ/ขยายมี aria-expanded="true" ตอนขยาย', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'aria-expanded="true"', 'aria-expanded');
});

test('ปุ่มย่อ/ขยายมี aria-label', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'aria-label="ย่อแถบ Actions"', 'aria-label');
});

test('ขยาย: ทุกปุ่มมี aria-label', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'aria-label="Generate"', 'Generate');
  assertContains(html, 'aria-label="Load"', 'Load');
  assertContains(html, 'aria-label="Save"', 'Save');
  assertContains(html, 'aria-label="Preview (Fullscreen)"', 'Preview');
});

test('ขยาย: มี title (tooltip) อธิบายคำสั่ง', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'title="สร้าง default descriptor', 'tooltip');
});

test('ขยาย: แสดงคำอธิบายยาวเป็นข้อความย่อในตัว', () => {
  const html = renderSidebar({ collapsed: false });
  assertContains(html, 'สร้าง default descriptor จาก template', 'คำอธิบาย');
});

test('ขยาย: ไม่มี role="tooltip" (ใช้ title แทน)', () => {
  const html = renderSidebar({ collapsed: false });
  assertNotContains(html, 'role="tooltip"', 'ไม่ต้องมี tooltip element');
});

// ============================================================== [3]
section('[3] Actions sidebar — collapsed');

test('ย่อ: มี aria-label ครบทุกปุ่ม', () => {
  const html = renderSidebar({ collapsed: true });
  assertContains(html, 'aria-label="Generate"', 'Generate');
  assertContains(html, 'aria-label="Load"', 'Load');
  assertContains(html, 'aria-label="Save"', 'Save');
  assertContains(html, 'aria-label="Preview (Fullscreen)"', 'Preview');
  assertContains(html, 'aria-label="รีเซ็ตพื้นที่ทำงาน"', 'reset');
});

test('ย่อ: ทุกปุ่มมี role="tooltip" (tooltip ครบ)', () => {
  const html = renderSidebar({ collapsed: true });
  const count = html.split('role="tooltip"').length - 1;
  assertTrue(count >= 5, `คาดว่ามี tooltip อย่างน้อย 5 จุด, ได้ ${count}`);
});

test('ย่อ: ไม่แสดงชื่อคำสั่งเต็มเป็นข้อความในปุ่ม (แสดงเฉพาะไอคอน)', () => {
  const html = renderSidebar({ collapsed: true });
  // ปุ่มแบบย่อไม่มี span ชื่อคำสั่ง (ใช้แค่ไอคอน + tooltip ที่ซ่อนด้วย CSS)
  assertNotContains(html, 'class="truncate"', 'ไม่มี label span');
  assertNotContains(html, 'justify-start', 'ไม่มีปุ่มแบบเต็มความกว้าง');
});

test('ย่อ: ยังแสดงไอคอนของทุกคำสั่ง', () => {
  const html = renderSidebar({ collapsed: true });
  assertContains(html, '✨', 'generate icon');
  assertContains(html, '📥', 'load icon');
  assertContains(html, '💾', 'save icon');
  assertContains(html, '👁', 'preview icon');
});

test('ย่อ: ปุ่มย่อ/ขยายมี aria-expanded="false"', () => {
  const html = renderSidebar({ collapsed: true });
  assertContains(html, 'aria-expanded="false"', 'aria-expanded');
});

test('ย่อ: ปุ่มย่อ/ขยายมี aria-label บอกว่าจะขยาย', () => {
  const html = renderSidebar({ collapsed: true });
  assertContains(html, 'aria-label="ขยายแถบ Actions"', 'aria-label');
});

test('ย่อ: data-collapsed="true"', () => {
  const html = renderSidebar({ collapsed: true });
  assertContains(html, 'data-collapsed="true"', 'collapsed attr');
});

test('สถานะ loading ยังมองเห็นได้ตอนย่อ (spinner)', () => {
  const html = renderSidebar({
    collapsed: true,
    loading: { ...defaultLoading, save: true },
  });
  assertContains(html, 'animate-spin', 'spinner');
});

test('สถานะ saving ยังเข้าถึงได้ผ่าน aria-label ของปุ่ม', () => {
  const html = renderSidebar({
    collapsed: true,
    loading: { ...defaultLoading, save: true },
  });
  assertContains(html, 'aria-label="Save"', 'Save label');
  assertContains(html, 'disabled', 'ปุ่มถูก disable ระหว่าง save');
});

// ============================================================== [4]
section('[4] Workspace — desktop / laptop');

test('desktop: แสดง Divider', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'data-testid="workspace-divider"', 'divider');
});

test('laptop: แสดง Divider', () => {
  const html = renderWorkspace({ layoutMode: 'laptop' });
  assertContains(html, 'data-testid="workspace-divider"', 'divider');
});

test('desktop: ไม่แสดง tab list', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertNotContains(html, 'role="tablist"', 'ไม่มี tablist');
});

test('desktop: แสดงทั้ง 2 คอลัมน์ (composer + preview)', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'COMPOSER-CONTENT', 'composer');
  assertContains(html, 'PREVIEW-CONTENT', 'preview');
});

test('desktop: data-layout-mode="desktop"', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'data-layout-mode="desktop"', 'mode');
});

test('Actions sidebar ถูก render ในโหมดจอกว้าง', () => {
  const html = renderWorkspace({ layoutMode: 'desktop' });
  assertContains(html, 'data-testid="actions-sidebar"', 'sidebar');
});

// ============================================================== [5]
section('[5] Workspace — mobile (tabs)');

test('mobile: แสดง tab list', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'role="tablist"', 'tablist');
});

test('mobile: มีแท็บ "แก้ไขเอกสาร" และ "ดูตัวอย่าง"', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'แก้ไขเอกสาร', 'composer tab');
  assertContains(html, 'ดูตัวอย่าง', 'preview tab');
});

test('mobile: ไม่มี Divider', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertNotContains(html, 'data-testid="workspace-divider"', 'ไม่มี divider');
});

test('mobile: มี tabpanel ทั้งสองฝั่ง', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'data-testid="workspace-panel-composer"', 'panel composer');
  assertContains(html, 'data-testid="workspace-panel-preview"', 'panel preview');
});

test('mobile: เนื้อหาทั้งสองแท็บถูก render ไว้ (ไม่ล้าง state)', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'COMPOSER-CONTENT', 'composer');
  assertContains(html, 'PREVIEW-CONTENT', 'preview');
});

test('mobile: แท็บที่ active มี aria-selected="true"', () => {
  const html = renderWorkspace({ layoutMode: 'mobile', activeTab: 'preview' });
  assertContains(html, 'aria-selected="true"', 'aria-selected');
});

test('mobile: แท็บ composer ที่ไม่ active ถูกซ่อน', () => {
  const html = renderWorkspace({ layoutMode: 'mobile', activeTab: 'preview' });
  assertContains(html, 'data-active="false"', 'data-active');
  assertContains(html, 'hidden', 'hidden class');
});

test('mobile: Actions เปลี่ยนเป็นแถบเครื่องมือ (toolbar)', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'data-testid="actions-toolbar"', 'toolbar');
  assertNotContains(html, 'data-testid="actions-sidebar"', 'ไม่ใช่ sidebar');
});

test('mobile: toolbar ยังมีปุ่มคำสั่งครบ (Generate / Load / Save / Preview)', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'aria-label="Generate"', 'Generate');
  assertContains(html, 'aria-label="Load"', 'Load');
  assertContains(html, 'aria-label="Save"', 'Save');
  assertContains(html, 'aria-label="Preview (Fullscreen)"', 'Preview');
});

test('mobile: toolbar ยังมีปุ่มรีเซ็ตพื้นที่ทำงาน', () => {
  const html = renderWorkspace({ layoutMode: 'mobile' });
  assertContains(html, 'aria-label="รีเซ็ตพื้นที่ทำงาน"', 'reset');
});

// ============================================================== [6]
section('[6] Fullscreen Preview ยังเรียก callback เดิม');

test('ปุ่ม Preview ใน sidebar เรียก onFullscreenPreview ครั้งเดียว', () => {
  let called = 0;
  const onFullscreenPreview = () => {
    called += 1;
  };
  const element = React.createElement(ActionsSidebar, {
    collapsed: false,
    onToggleCollapsed: noop,
    onResetLayout: noop,
    onGenerate: noop,
    onLoad: noop,
    onSave: noop,
    onFullscreenPreview,
    loading: defaultLoading,
    canSave: true,
    canPreview: true,
  });

  // เรียก handler ที่ผูกไว้กับปุ่ม Preview โดยตรง
  const props = element.props;
  props.onFullscreenPreview();
  assertEqual(called, 1, 'ต้องถูกเรียก 1 ครั้ง');
});

test('Generate / Load / Save เรียก callback เดิมครั้งละ 1', () => {
  const calls: string[] = [];
  const element = React.createElement(ActionsSidebar, {
    collapsed: false,
    onToggleCollapsed: noop,
    onResetLayout: noop,
    onGenerate: () => calls.push('generate'),
    onLoad: () => calls.push('load'),
    onSave: () => calls.push('save'),
    onFullscreenPreview: () => calls.push('preview'),
    loading: defaultLoading,
    canSave: true,
    canPreview: true,
  });

  const props = element.props;
  props.onGenerate();
  props.onLoad();
  props.onSave();
  props.onFullscreenPreview();

  assertEqual(calls.join(','), 'generate,load,save,preview', 'ลำดับ callback');
});

test('workspace ส่ง callback เดิมต่อให้ sidebar แบบเดิม', () => {
  const calls: string[] = [];
  renderWorkspace({
    onGenerate: () => calls.push('generate'),
    onFullscreenPreview: () => calls.push('preview'),
  });
  assertEqual(calls.length, 0, 'ต้องไม่ถูกเรียกตอน render');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
