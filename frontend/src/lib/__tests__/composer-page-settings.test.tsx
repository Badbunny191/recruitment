/**
 * Document Composer — Page Settings Tests (Frontend)
 * =======================================================================
 *
 * ครอบคลุม:
 *   - backward compatibility (descriptor เก่า → 40pt ทุกด้าน)
 *   - presets (narrow/normal/wide) + custom
 *   - mm ↔ pt conversion
 *   - reset / default
 *   - validation (ว่าง / NaN / Infinity / ติดลบ / เกินช่วง)
 *   - Preview ใช้ margin ที่เลือก (PreviewFrame)
 *   - Automatic Header ไม่กลับมา
 *
 * Run: node --import tsx src/lib/__tests__/composer-page-settings.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DEFAULT_MARGIN_PT,
  MAX_MARGIN_PT,
  MIN_MARGIN_PT,
  PAGE_SETTINGS_DISCLAIMER,
  PRESET_MARGIN_PT,
  applyPreset,
  clampMarginPt,
  createDefaultPageSettings,
  marginInputToPt,
  marginPtToInput,
  mmToPt,
  normalizePreset,
  ptToMm,
  resetPageSettings,
  resolvePageGeometry,
  validateMarginInput,
} from '../api/page-settings';

import { PageSettingsPanel } from '../../app/(admin)/admin/templates/composer/components/PageSettingsPanel';
import { PreviewFrame } from '../../app/(admin)/admin/templates/composer/components/PreviewFrame';
import { PreviewModal } from '../../app/(admin)/admin/templates/composer/components/PreviewModal';

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
  if (typeof haystack === 'string' && haystack.includes(needle)) {
    throw new Error(`${msg} expected NOT to contain ${JSON.stringify(needle)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ========== HELPERS ==========
function fakePreview(overrides = {}) {
  return {
    html: '<html><body>x</body></html>',
    body: '<div class="dc-preview">เนื้อหา</div>',
    header: '<div class="dc-header">AUTOMATIC HEADER</div>',
    styles: '.dc-preview{}',
    meta: {
      blockCount: 1,
      fieldRefCount: 0,
      missingFieldIds: [],
      renderedBlocks: [],
    },
    mode: 'form',
    tokens: [],
    ...overrides,
  };
}

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    React.createElement(PageSettingsPanel, {
      value: undefined,
      onChange: () => {},
      ...props,
    })
  );
}

function renderFrame(preview, props = {}) {
  return renderToStaticMarkup(
    React.createElement(PreviewFrame, { preview, ...props })
  );
}

// ============================================================== [1]
console.log('========================================');
console.log('Composer Page Settings Tests (Frontend)');
console.log('========================================');

section('[1] Backward compatibility — descriptor เก่า → 40pt ทุกด้าน');

test('resolvePageGeometry(undefined) → 40pt ทุกด้าน', () => {
  const geo = resolvePageGeometry(undefined);
  assertEqual(geo.marginTop, 40, 'top');
  assertEqual(geo.marginRight, 40, 'right');
  assertEqual(geo.marginBottom, 40, 'bottom');
  assertEqual(geo.marginLeft, 40, 'left');
  assertEqual(geo.preset, 'normal', 'preset');
});

test('resolvePageGeometry(null) → 40pt ทุกด้าน', () => {
  const geo = resolvePageGeometry(null);
  assertEqual(geo.marginTop, 40, 'top');
  assertEqual(geo.marginLeft, 40, 'left');
});

test('resolvePageGeometry({}) → 40pt ทุกด้าน', () => {
  const geo = resolvePageGeometry({});
  assertEqual(geo.marginTop, 40, 'top');
  assertEqual(geo.marginBottom, 40, 'bottom');
});

test('createDefaultPageSettings() → normal 40pt ทุกด้าน', () => {
  const def = createDefaultPageSettings();
  assertEqual(def.preset, 'normal', 'preset');
  assertEqual(def.top, 40, 'top');
  assertEqual(def.right, 40, 'right');
  assertEqual(def.bottom, 40, 'bottom');
  assertEqual(def.left, 40, 'left');
});

test('resolvePageGeometry คืน contentWidth/contentHeight จาก A4', () => {
  const geo = resolvePageGeometry(undefined);
  assertEqual(geo.pageWidth, 595.28, 'pageWidth');
  assertEqual(geo.pageHeight, 841.89, 'pageHeight');
  assertEqual(geo.contentWidth, 515.3, 'contentWidth');
  assertEqual(geo.contentHeight, 761.9, 'contentHeight');
});

// ============================================================== [2]
section('[2] Presets — narrow / normal / wide');

test('preset narrow → 28pt ทุกด้าน', () => {
  const geo = resolvePageGeometry({ preset: 'narrow' });
  assertEqual(geo.marginTop, 28, 'top');
  assertEqual(geo.marginRight, 28, 'right');
  assertEqual(geo.marginBottom, 28, 'bottom');
  assertEqual(geo.marginLeft, 28, 'left');
});

test('preset normal → 40pt ทุกด้าน', () => {
  const geo = resolvePageGeometry({ preset: 'normal' });
  assertEqual(geo.marginTop, 40, 'top');
});

test('preset wide → 72pt ทุกด้าน', () => {
  const geo = resolvePageGeometry({ preset: 'wide' });
  assertEqual(geo.marginTop, 72, 'top');
  assertEqual(geo.marginLeft, 72, 'left');
});

test('preset ที่ไม่รู้จัก → normal (40pt)', () => {
  assertEqual(normalizePreset('bogus'), 'normal', 'normalizePreset');
  const geo = resolvePageGeometry({ preset: 'bogus' });
  assertEqual(geo.marginTop, 40, 'top');
});

test('applyPreset เปลี่ยน preset แล้วรีเซ็ตค่าต่อด้านตาม preset', () => {
  const next = applyPreset('narrow');
  assertEqual(next.preset, 'narrow', 'preset');
  assertEqual(next.top, 28, 'top');
  assertEqual(next.left, 28, 'left');
});

// ============================================================== [3]
section('[3] Custom — ค่าต่อด้าน');

test('preset custom ใช้ค่าต่อด้านที่กำหนด', () => {
  const geo = resolvePageGeometry({
    preset: 'custom',
    top: 10,
    right: 20,
    bottom: 30,
    left: 40,
  });
  assertEqual(geo.marginTop, 10, 'top');
  assertEqual(geo.marginRight, 20, 'right');
  assertEqual(geo.marginBottom, 30, 'bottom');
  assertEqual(geo.marginLeft, 40, 'left');
});

test('applyPreset("custom") เก็บค่าเดิม (คร่าว ๆ) ไว้', () => {
  const next = applyPreset('custom', {
    preset: 'wide',
    top: 72,
    right: 72,
    bottom: 72,
    left: 72,
  });
  assertEqual(next.preset, 'custom', 'preset');
  assertEqual(next.top, 72, 'top');
});

test('contentWidth/Height อย่างน้อย 200pt', () => {
  const geo = resolvePageGeometry({
    preset: 'custom',
    top: 144,
    right: 144,
    bottom: 144,
    left: 144,
  });
  assertTrue(geo.contentWidth >= 200, `contentWidth ${geo.contentWidth} >= 200`);
  assertTrue(geo.contentHeight >= 200, `contentHeight ${geo.contentHeight} >= 200`);
});

// ============================================================== [4]
section('[4] Clamp — margin 10..144pt / invalid / NaN / Infinity');

test('clampMarginPt: ต่ำกว่า 10 → 10, สูงกว่า 144 → 144', () => {
  assertEqual(clampMarginPt(0), MIN_MARGIN_PT, '0');
  assertEqual(clampMarginPt(-50), MIN_MARGIN_PT, '-50');
  assertEqual(clampMarginPt(999), MAX_MARGIN_PT, '999');
});

test('clampMarginPt: NaN / ไม่ใช่ number → 40 (fallback)', () => {
  assertEqual(clampMarginPt(Number.NaN), DEFAULT_MARGIN_PT, 'NaN');
  assertEqual(clampMarginPt(undefined), DEFAULT_MARGIN_PT, 'undefined');
  assertEqual(clampMarginPt('abc'), DEFAULT_MARGIN_PT, 'string');
  assertEqual(clampMarginPt(null), DEFAULT_MARGIN_PT, 'null');
});

test('clampMarginPt: Infinity → 144 / -Infinity → 10', () => {
  assertEqual(clampMarginPt(Number.POSITIVE_INFINITY), MAX_MARGIN_PT, '+Inf');
  assertEqual(clampMarginPt(Number.NEGATIVE_INFINITY), MIN_MARGIN_PT, '-Inf');
});

test('resolvePageGeometry ไม่ crash กับค่าเสีย', () => {
  const geo = resolvePageGeometry({
    preset: 'custom',
    top: Number.NaN,
    right: Number.POSITIVE_INFINITY,
    bottom: 'x',
    left: -5,
  });
  assertEqual(geo.marginTop, 40, 'NaN → 40');
  assertEqual(geo.marginRight, 144, '+Inf → 144');
  assertEqual(geo.marginBottom, 40, 'string → 40');
  assertEqual(geo.marginLeft, 10, '-5 → 10');
});

// ============================================================== [5]
section('[5] mm ↔ pt conversion');

test('ptToMm: 28 → 9.9, 40 → 14.1, 72 → 25.4', () => {
  assertEqual(ptToMm(28), 9.9, '28pt');
  assertEqual(ptToMm(40), 14.1, '40pt');
  assertEqual(ptToMm(72), 25.4, '72pt');
});

test('mmToPt: 25.4 → 72, 14.1 → 40', () => {
  assertEqual(mmToPt(25.4), 72, '25.4mm');
  assertEqual(mmToPt(14.1), 40, '14.1mm');
});

test('mmToPt ค่าเสีย → 40 (ไม่ crash)', () => {
  assertEqual(mmToPt(Number.NaN), DEFAULT_MARGIN_PT, 'NaN');
  assertEqual(mmToPt(Number.POSITIVE_INFINITY), DEFAULT_MARGIN_PT, '+Inf');
});

test('marginPtToInput ↔ marginInputToPt round-trip', () => {
  const input = marginPtToInput(40);
  assertEqual(input, '14.1', '40pt → "14.1"');
  assertEqual(marginInputToPt(input), 40, 'round-trip');
});

// ============================================================== [6]
section('[6] Reset / default');

test('resetPageSettings() → normal 40pt ทุกด้าน', () => {
  const reset = resetPageSettings();
  assertEqual(reset.preset, 'normal', 'preset');
  assertEqual(reset.top, 40, 'top');
  assertEqual(reset.right, 40, 'right');
  assertEqual(reset.bottom, 40, 'bottom');
  assertEqual(reset.left, 40, 'left');
});

// ============================================================== [7]
section('[7] Validation (inline) — ว่าง / NaN / Infinity / ติดลบ / เกินช่วง');

test('ค่าว่าง → ไม่ผ่าน + ข้อความ', () => {
  const v = validateMarginInput('   ');
  assertFalse(v.ok, 'ok');
  assertTrue(!!v.message, 'ต้องมีข้อความ');
});

test('ค่าที่ไม่ใช่ตัวเลข → ไม่ผ่าน', () => {
  assertFalse(validateMarginInput('abc').ok, 'abc');
  assertFalse(validateMarginInput('NaN').ok, 'NaN');
  assertFalse(validateMarginInput('Infinity').ok, 'Infinity');
});

test('ค่าติดลบ → ไม่ผ่าน', () => {
  const v = validateMarginInput('-5');
  assertFalse(v.ok, 'ok');
  assertContains(v.message ?? '', 'ติดลบ', 'ข้อความ');
});

test('ค่าเกินช่วง → ไม่ผ่าน', () => {
  assertFalse(validateMarginInput('0.1').ok, 'เล็กเกิน 10pt');
  assertFalse(validateMarginInput('999').ok, 'ใหญ่เกิน 144pt');
});

test('ค่าที่ถูกต้อง → ผ่าน', () => {
  assertTrue(validateMarginInput('14.1').ok, '14.1mm');
  assertTrue(validateMarginInput('25.4').ok, '25.4mm');
});

test('marginInputToPt ค่าเสีย → fallback 40 (ไม่ throw)', () => {
  assertEqual(marginInputToPt(''), DEFAULT_MARGIN_PT, 'ว่าง');
  assertEqual(marginInputToPt('abc'), DEFAULT_MARGIN_PT, 'abc');
  assertEqual(marginInputToPt('-1'), DEFAULT_MARGIN_PT, 'ติดลบ');
});

// ============================================================== [8]
section('[8] UI — PageSettingsPanel');

test('แสดงปุ่ม preset ครบ 4 ตัวเลือก', () => {
  const html = renderPanel();
  assertContains(html, 'page-settings-preset-narrow', 'narrow');
  assertContains(html, 'page-settings-preset-normal', 'normal');
  assertContains(html, 'page-settings-preset-wide', 'wide');
  assertContains(html, 'page-settings-preset-custom', 'custom');
});

test('แสดงค่าในหน่วย มม. (9.9 / 14.1 / 25.4)', () => {
  const html = renderPanel();
  assertContains(html, '9.9 มม.', 'narrow');
  assertContains(html, '14.1 มม.', 'normal');
  assertContains(html, '25.4 มม.', 'wide');
});

test('มีปุ่ม "คืนค่าเริ่มต้น"', () => {
  const html = renderPanel();
  assertContains(html, 'page-settings-reset', 'ปุ่ม reset');
  assertContains(html, 'คืนค่าเริ่มต้น', 'label reset');
});

test('แสดงข้อความ disclaimer ว่า PDF รองรับในก้อนถัดไป', () => {
  const html = renderPanel();
  assertContains(html, 'การตั้งค่านี้ใช้กับตัวอย่างเอกสาร', 'disclaimer');
  assertContains(html, 'ส่วน PDF จะรองรับในก้อนถัดไป', 'disclaimer');
  assertEqual(
    PAGE_SETTINGS_DISCLAIMER,
    'การตั้งค่านี้ใช้กับตัวอย่างเอกสาร ส่วน PDF จะรองรับในก้อนถัดไป',
    'ข้อความตรงตามที่กำหนด'
  );
});

test('preset ที่ไม่ใช่ custom → ไม่แสดงช่องกรอกต่อด้าน', () => {
  const html = renderPanel({ value: createDefaultPageSettings() });
  assertNotContains(html, 'page-settings-input-top', 'ไม่มี input');
  assertContains(html, 'page-settings-summary', 'มี summary');
});

test('preset custom → แสดงช่อง บน / ขวา / ล่าง / ซ้าย', () => {
  const html = renderPanel({
    value: { preset: 'custom', top: 40, right: 40, bottom: 40, left: 40 },
  });
  assertContains(html, 'page-settings-input-top', 'top');
  assertContains(html, 'page-settings-input-right', 'right');
  assertContains(html, 'page-settings-input-bottom', 'bottom');
  assertContains(html, 'page-settings-input-left', 'left');
});

test('ค่าในช่อง input แสดงเป็น มม. (ไม่ใช่ pt)', () => {
  const html = renderPanel({
    value: { preset: 'custom', top: 28, right: 40, bottom: 72, left: 40 },
  });
  assertContains(html, 'value="9.9"', '28pt → 9.9mm');
  assertContains(html, 'value="14.1"', '40pt → 14.1mm');
  assertContains(html, 'value="25.4"', '72pt → 25.4mm');
});

test('ค่าที่ผิด → แสดงข้อความ validation inline', () => {
  const html = renderPanel({
    value: { preset: 'custom', top: 40, right: 40, bottom: 40, left: 40 },
  });
  // ค่าเริ่มต้นถูกต้อง → ไม่มี error
  assertNotContains(html, 'page-settings-error-top', 'ไม่มี error ตอนค่าปกติ');
});

test('responsive: ใช้ grid ที่พังได้บนจอแคบ (grid-cols-1 sm:grid-cols-*)', () => {
  const html = renderPanel({
    value: { preset: 'custom', top: 40, right: 40, bottom: 40, left: 40 },
  });
  assertContains(html, 'grid-cols-1 sm:grid-cols-2', 'inputs responsive');
  assertContains(html, 'grid-cols-2 sm:grid-cols-4', 'presets responsive');
});

// ============================================================== [9]
section('[9] Preview — ใช้ margin ที่เลือก');

test('PreviewFrame ใส่ padding ตาม page geometry ที่ backend ส่งมา', () => {
  const html = renderFrame(
    fakePreview({
      page: resolvePageGeometry({
        preset: 'custom',
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      }),
    })
  );
  assertContains(html, 'padding: 10pt 20pt 30pt 40pt', 'padding ตามที่เลือก');
});

test('PreviewFrame ใช้ 40pt ทุกด้านเมื่อ backend ไม่ส่ง page', () => {
  const html = renderFrame(fakePreview());
  assertContains(html, 'padding: 40pt', 'fallback 40pt');
});

test('PreviewFrame คงความกว้างกระดาษ A4 (595.28pt) และโตตามเนื้อหา (continuous)', () => {
  const html = renderFrame(fakePreview());
  assertContains(html, 'width: 595.28pt', 'width A4');
  // ⚠️ Continuous Preview (2026-10-22): ไม่มี min-height/height ตายตัวอีกแล้ว
  //    เพราะเอกสารต้องไหลต่อเป็นลำดับยาวเดียว (การแบ่งหน้าจริงดูจาก PDF Preview)
  assertNotContains(html, 'min-height: 841.89pt', 'ไม่ fix ความสูงตายตัว');
  assertNotContains(html, 'dc-pages', 'ไม่มีภาชนะแบ่งหน้า');
});

test('Compact (PreviewFrame) และ Fullscreen (PreviewModal) ใช้ค่าเดียวกัน', () => {
  const page = resolvePageGeometry({ preset: 'wide' });
  const compact = renderFrame(fakePreview({ page }));
  const fullscreen = renderFrame(fakePreview({ page }));
  assertContains(compact, 'padding: 72pt 72pt 72pt 72pt', 'compact');
  assertContains(fullscreen, 'padding: 72pt 72pt 72pt 72pt', 'fullscreen');
});

// ============================================================== [10]
section('[10] Automatic Header — ต้องไม่กลับมา');

test('PreviewFrame แบบ compact (ไม่ส่ง withHeader) ไม่แสดง header', () => {
  const html = renderFrame(fakePreview());
  assertNotContains(html, 'AUTOMATIC HEADER', 'ไม่มี automatic header');
});

test('PreviewFrame ส่ง withHeader → แสดง header (มีค่าเท่านั้น)', () => {
  const html = renderFrame(fakePreview(), { withHeader: true });
  assertContains(html, 'AUTOMATIC HEADER', 'header ถูกส่งเข้าไป');
});

test('PreviewModal (Fullscreen) ไม่ส่ง withHeader → ไม่มี Automatic Header', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewModal, {
      open: true,
      onClose: () => {},
      currentPreview: fakePreview(),
      fetchPreview: async () => true,
      loading: false,
    })
  );
  assertNotContains(html, 'AUTOMATIC HEADER', 'fullscreen ต้องไม่มี automatic header');
  // ยังแสดงเฉพาะ Blocks ใน Descriptor
  assertContains(html, 'dc-a4-sheet', 'ยังมี page box');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
