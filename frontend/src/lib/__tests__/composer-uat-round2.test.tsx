/**
 * Document Composer — UAT Round 2 Targeted Tests
 * =======================================================================
 * ครอบคลุม 2 ปัญหา:
 *   1. Fullscreen Preview ไม่ขึ้นหน้ากระดาษใหม่ (HTML Preview pagination)
 *   2. Dropdown "แทรกข้อมูล" ถูกตัดด้านขวา
 *
 * ⚠️ ไม่ติดตั้ง package ใหม่ — ใช้ pure helper + อ่าน source เท่านั้น
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx src/lib/__tests__/composer-uat-round2.test.tsx
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPaginationScript,
  computePagination,
  PREVIEW_PAGE_GAP_PT,
  PREVIEW_PAGE_HEIGHT_PT,
  PREVIEW_PAGE_WIDTH_PT,
  type PaginationItem,
} from '../../app/(admin)/admin/templates/composer/lib/preview-pagination';
import {
  MENU_ANCHOR_GAP,
  computeMenuPosition,
} from '../../app/(admin)/admin/templates/composer/lib/menu-position';
import { PreviewFrame } from '../../app/(admin)/admin/templates/composer/components/PreviewFrame';
import { InsertDataMenu } from '../../app/(admin)/admin/templates/composer/components/InsertDataMenu';

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
      `${msg} expected to contain ${JSON.stringify(needle)}\n  got: ${String(haystack).slice(0, 400)}`
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
    header: '<div>header</div>',
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

function readComposerSource(relativePath) {
  const root = join(process.cwd(), 'src/app/(admin)/admin/templates/composer');
  return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * สร้าง PaginationItem สำหรับทดสอบ pure engine
 *
 * @param id - id ของ block
 * @param height - ความสูงทั้งก้อน (px)
 * @param unitBottoms - ระยะจากขอบบนของกรอบถึงขอบล่างของแต่ละหน่วย (px)
 */
function makeItem(id, height, unitBottoms): PaginationItem {
  return {
    id,
    originId: id,
    continuation: false,
    height,
    marginTop: 0,
    marginBottom: 0,
    boxHeight: height,
    headerHeight: 0,
    units: unitBottoms.map((bottom, i) => ({
      id: `${id}-u${i}`,
      bottom,
    })),
    explicitBreak: false,
  };
}

// ============================================================== [1]
console.log('========================================');
console.log('Composer UAT Round 2 — Pagination + Dropdown');
console.log('========================================');

section('[1] Pagination script — โครงสร้างพื้นฐาน');

test('script มี page geometry ครบ (A4 + margin)', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  assertContains(script, '"pageWidth":595.28', 'pageWidth');
  assertContains(script, '"pageHeight":841.89', 'pageHeight');
  assertContains(script, '"marginTop":40', 'marginTop');
  assertContains(script, '"marginLeft":40', 'marginLeft');
});

test('script ไม่มี </script> (ปลอดภัยเมื่อฝังใน <script>)', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  assertNotContains(script, '</script', 'ไม่มี closing script tag');
});

test('script คำนวณพื้นที่เนื้อหาจาก page height - margin', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  assertContains(script, 'var CONTENT_H = PAGE_H - MT - MB;', 'content height จาก margin');
});

section('[2] Pagination script — กติกาแบ่งหน้า');

test('Table แบ่งตามแถว (<tr>) และทำ header ซ้ำทุกหน้า', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  // หน่วยของตาราง = แถวใน tbody (declarative ไม่ hard-code กับ class)
  assertContains(script, 'table.tBodies[0]', 'อ่าน tbody ของตาราง');
  assertContains(script, 'kind: "table"', 'ตรวจจับ block ประเภท table');
  assertContains(script, 'item.table.tHead.cloneNode(true)', 'ทำ header ซ้ำทุกหน้า');
  assertContains(script, 'headerEl: table.tHead', 'เก็บ thead ไว้ทำซ้ำ');
});

test('Heading/Field/SystemData/Signature แบ่งตามบรรทัดที่ renderer ส่งมา', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  // หน่วยของ field / systemdata = body wrapper (label+value ต้องอยู่ด้วยกัน)
  assertContains(script, 'dc-field__body', 'แบ่ง Field ที่ body');
  assertContains(script, 'dc-systemdata__body', 'แบ่ง SystemData ที่ body');
  // label + value → หน่วยเดียว (กัน label หลุดไปคนละหน้า)
  assertContains(script, 'dc-field__label', 'จับคู่ label กับ value');
  assertContains(script, 'groups.push([kids[i], kids[i + 1]])', 'label+value = หน่วยเดียว');
});

test('Block ที่วางไม่พอ → ย้ายไปหน้าถัดไป (ไม่ตัดข้อความ)', () => {
  // ⚠️ ทดสอบ "พฤติกรรมจริง" ของ pure engine (computePagination)
  //    ไม่ใช่เช็คสตริงภายใน — เพราะ engine ถูก transpile
  //    ตอนรัน (ฝังลง iframe ผ่าน Function.prototype.toString())
  //    → สตริงในไฟล์ .ts ไม่ตรงกับโค้ดที่รันจริง

  // เตรียม block 1 สูง 100 (พอดีในหน้า) และ block 2 สูง 150
  // → block 2 ไม่พอในหน้าแรก (เหลือ 100) → ต้องย้ายไปหน้า 2 ทั้งก้อน
  const items = [
    makeItem('b1', 100, [50, 100]),
    makeItem('b2', 150, [50, 150]),
  ];
  const pages = computePagination(items, 200);

  assertEqual(pages.length, 2, 'ต้องแบ่งเป็น 2 หน้า');
  assertEqual(pages[0].entries.length, 1, 'หน้า 1 มี block เดียว');
  assertEqual(pages[0].entries[0].itemId, 'b1', 'หน้า 1 = block 1');
  assertEqual(pages[1].entries.length, 1, 'หน้า 2 มี block เดียว');
  assertEqual(pages[1].entries[0].itemId, 'b2', 'หน้า 2 = block 2 (ย้ายทั้งก้อน)');
  // ไม่ตัดข้อความกลางบรรทัด → block 2 ต้องอยู่เป็นก้อนเดียว (unitIds = null)
  assertEqual(pages[1].entries[0].unitIds, null, 'block 2 ไม่ถูกแบ่ง');
  assertEqual(pages[1].entries[0].continuation, false, 'block 2 ไม่ใช่ส่วนต่อ');
});

test('Block ที่ยาวเกินหนึ่งหน้า → แบ่งตามหน่วย (ห้ามตัดข้อความ)', () => {
  // block เดียวสูง 350 หน่วยละ 100 (3 หน่วย) ในหน้าสูง 200
  // → ต้องถูกแบ่งเป็น 2 ส่วน: ส่วนหัว (2 หน่วย) + ส่วนต่อ (1 หน่วย)
  const items = [makeItem('b1', 300, [100, 200, 300])];
  const pages = computePagination(items, 200);

  assertEqual(pages.length, 2, 'ต้องแบ่งเป็น 2 หน้า');
  // ส่วนหัว → ใช้ element เดิมทั้งก้อน
  assertEqual(pages[0].entries[0].unitIds, null, 'ส่วนหัวใช้ element เดิม');
  assertEqual(pages[0].entries[0].continuation, false, 'ส่วนหัวไม่ใช่ส่วนต่อ');
  // ส่วนต่อ → ต้องระบุหน่วยที่ย้ายไป (ไม่ใช่ทั้งก้อน)
  assertTrue(Array.isArray(pages[1].entries[0].unitIds), 'ส่วนต่อต้องระบุ unitIds');
  assertEqual(pages[1].entries[0].continuation, true, 'ส่วนต่อต้องเป็น continuation');
  assertEqual(pages[1].entries[0].itemId, 'b1', 'ส่วนต่ออ้างถึง block เดิม');
});

test('Block เดียวที่สูงเกินหน้าจริง → ยอมให้ล้น (ห้ามทิ้งเนื้อหา)', () => {
  // 1 หน่วย สูง 500 ในหน้าสูง 200 → แบ่งไม่ได้ → ต้อง overflow แต่ยังมีเนื้อหา
  const items = [makeItem('b1', 500, [500])];
  const pages = computePagination(items, 200);

  assertEqual(pages.length, 1, 'มีหน้าเดียว');
  assertEqual(pages[0].entries.length, 1, 'มี block อยู่');
  assertEqual(pages[0].overflow, true, 'ต้องระบุว่าล้น');
  assertEqual(pages[0].entries[0].unitIds, null, 'ไม่ตัดข้อความ');
});

test('เนื้อหาไม่หาย / ไม่ซ้ำ / ลำดับไม่เปลี่ยน', () => {
  const items = [
    makeItem('b1', 100, [50, 100]),
    makeItem('b2', 300, [100, 200, 300]),
    makeItem('b3', 100, [50, 100]),
  ];
  const pages = computePagination(items, 200);

  // ── รวมหน่วยที่ถูกย้ายไปเป็น "ส่วนต่อ" ของแต่ละ block ──────────────
  // (ส่วนต่อถูกย้ายออกจาก element เดิม → element เดิมเหลือแต่หน่วยส่วนหัว)
  const movedToContinuation = {};
  for (const page of pages) {
    for (const entry of page.entries) {
      if (entry.continuation && entry.unitIds) {
        movedToContinuation[entry.itemId] = (movedToContinuation[entry.itemId] ?? []).concat(
          entry.unitIds
        );
      }
    }
  }

  // ── รวมหน่วยที่แสดงผลจริงทุกหน้า ───────────────────────────────────────
  const seen = [];
  for (const page of pages) {
    for (const entry of page.entries) {
      if (entry.unitIds === null) {
        // element เดิมทั้งก้อน → เหลือหน่วยที่ไม่ถูกย้ายไปเป็นส่วนต่อ
        const src = items.find((it) => it.originId === entry.itemId);
        if (!src) continue;
        const moved = new Set(movedToContinuation[entry.itemId] ?? []);
        for (const u of src.units) {
          if (!moved.has(u.id)) seen.push(u.id);
        }
      } else {
        for (const id of entry.unitIds) seen.push(id);
      }
    }
  }

  // ไม่มีหน่วยหาย (2 + 3 + 2 = 7) และไม่มีหน่วยซ้ำ
  assertEqual(seen.length, 7, 'ต้องมีหน่วยครบ 7 ตัว (ไม่มีหน่วยหาย)');
  assertEqual(new Set(seen).size, seen.length, 'ต้องไม่มีหน่วยซ้ำ');

  // ลำดับไม่เปลี่ยน → หน่วยของแต่ละ block ต้องเรียงตามลำดับเดิม
  for (const item of items) {
    const order = seen.filter((id) => id.startsWith(`${item.id}-u`));
    const expected = item.units.map((u) => u.id);
    assertEqual(order.length, expected.length, `หน่วยของ ${item.id} ต้องครบ`);
    assertEqual(order.join(','), expected.join(','), `ลำดับของ ${item.id} ต้องเหมือนเดิม`);
  }
});

test('ทุกหน้าใช้ margin ชุดเดียวกัน', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 28,
    marginRight: 28,
    marginBottom: 28,
    marginLeft: 28,
  });
  // margin ถูกฝังในทุก .dc-page ที่สร้าง
  assertContains(script, 'page.style.padding = MT + "pt " + MR + "pt " + MB + "pt " + ML + "pt";', 'padding เดียวกันทุกหน้า');
});

test('มี footer "หน้า X / N" ทุกหน้า', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  // ป้ายหน้า "หน้า X / N" อยู่นอกกรอบกระดาษ (dc-page__label ไม่ใช่ dc-page__footer)
  assertContains(script, 'dc-page__label', 'มีป้ายเลขหน้า');
  assertContains(script, '"หน้า " + (i + 1) + " / " + total', 'รูปแบบ หน้า X / N');
  // ป้ายต้องถูกผนวกกับ "แผ่นกระดาษ" (sheet) ไม่ใช่ตัว .dc-page
  assertContains(script, 'sheet.appendChild(label)', 'ป้ายอยู่นอกกรอบกระดาษ');
});

test('ไม่มี Automatic Header ในการแบ่งหน้า', () => {
  const script = buildPaginationScript({
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
  });
  assertNotContains(script, 'dc-doc-header', 'ไม่มี automatic header');
});

/*
 * ⚠️ [3] PreviewFrame — CONTINUOUS PREVIEW (เปลี่ยนแนวทาง 2026-10-22)
 *
 * Browser pagination ถูกตัดออกทั้งหมด:
 *   - ไม่ฝัง script วัด/แบ่งหน้า
 *   - ไม่มีภาชนะ dc-pages / dc-source / dc-scaler
 *   - ไม่มี postMessage รายงานจำนวนหน้า
 *   - เอกสารเป็นลำดับยาวเดียว โตตามเนื้อหา
 *
 * 🔑 การแบ่งหน้าจริง = PDF Preview (source of truth)
 *    → ดู PdfPreviewFrame.tsx
 */
section('[3] PreviewFrame — Continuous Preview (ไม่แบ่งหน้าในเบราว์เซอร์)');

test('PreviewFrame ไม่ฝัง script แบ่งหน้า + ไม่มีภาชนะ dc-pages / dc-source', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewFrame, { preview: fakePreview() })
  );
  assertNotContains(html, 'dc-pages', 'ไม่มีภาชนะแบ่งหน้า');
  assertNotContains(html, 'dc-source', 'ไม่มีภาชนะต้นทาง');
  assertNotContains(html, 'dc-scaler', 'ไม่มีการ scale/zoom');
  assertNotContains(html, 'dc-preview-pagination', 'ไม่มี postMessage นับหน้า');
  assertNotContains(html, '<script>', 'ไม่มี script ใน srcdoc');
});

test('PreviewFrame ไม่ใส่ gap / ช่องว่างระหว่างหน้า (ไม่มีหน้าให้เว้น)', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewFrame, { preview: fakePreview() })
  );
  assertNotContains(html, `gap: ${PREVIEW_PAGE_GAP_PT}pt`, 'ไม่มี gap ระหว่างหน้า');
});

test('PreviewFrame คงความกว้าง A4 โดยไม่ fix ความสูง + ไม่มี Automatic Header', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewFrame, { preview: fakePreview() })
  );
  assertContains(html, `width: ${PREVIEW_PAGE_WIDTH_PT}pt`, 'A4 width');
  assertNotContains(html, `min-height: ${PREVIEW_PAGE_HEIGHT_PT}pt`, 'โตตามเนื้อหา ไม่ fix สูง');
  assertNotContains(html, 'AUTOMATIC HEADER', 'ไม่มี automatic header');
});

test('PreviewFrame ใช้ margin จาก page geometry (Page Settings) เดียวกัน', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewFrame, {
      preview: fakePreview({
        page: {
          preset: 'custom',
          marginTop: 28,
          marginRight: 28,
          marginBottom: 28,
          marginLeft: 28,
          contentWidth: 539.28,
          contentHeight: 785.89,
          pageWidth: 595.28,
          pageHeight: 841.89,
        },
      }),
    })
  );
  assertContains(html, 'padding: 28pt 28pt 28pt 28pt', 'padding ตามที่เลือก');
});

section('[4] Dropdown positioning — pure helper');

test('right-aligned: ขอบขวาของเมนู = ขอบขวาของปุ่ม', () => {
  const pos = computeMenuPosition(
    { top: 100, bottom: 132, left: 900, right: 990, width: 90, height: 32 },
    340,
    420,
    { width: 1440, height: 900 }
  );
  assertEqual(pos.left, 990 - 340, 'left = anchor.right - menuWidth');
  assertEqual(pos.clamped, false, 'ไม่ต้อง clamp');
  assertEqual(pos.flipped, false, 'วางด้านล่าง');
});

test('ปุ่มอยู่ใกล้ขอบขวาของ viewport → right-aligned ยังอยู่ในจอ', () => {
  const pos = computeMenuPosition(
    { top: 100, bottom: 132, left: 1330, right: 1420, width: 90, height: 32 },
    340,
    420,
    { width: 1440, height: 900 }
  );
  // right-aligned → ขอบขวาของเมนู = ขอบขวาของปุ่ม = 1420 (ไม่ล้น 1440)
  assertEqual(pos.left, 1420 - 340, 'left = anchor.right - menuWidth');
  assertTrue(pos.left + 340 <= 1440, 'ขอบขวาอยู่ใน viewport');
  assertTrue(pos.left >= 8, 'ขอบซ้ายอยู่ใน viewport');
});

test('ปุ่มล้นขอบจนถึงขวา → clamp เข้าขอบจอ', () => {
  const pos = computeMenuPosition(
    { top: 100, bottom: 132, left: 1380, right: 1470, width: 90, height: 32 },
    340,
    420,
    { width: 1440, height: 900 }
  );
  assertTrue(pos.clamped, 'ต้อง clamp');
  assertTrue(pos.left + 340 <= 1440 - 8, 'ต้องไม่ล้นขอบขวาของ viewport');
  assertTrue(pos.left >= 8, 'ต้องไม่ล้นขอบซ้ายของ viewport');
});

test('หน้าจอแคบ: เมนูกว้างกว่าพื้นที่ → ยังอยู่ใน viewport', () => {
  const pos = computeMenuPosition(
    { top: 50, bottom: 82, left: 30, right: 120, width: 90, height: 32 },
    340,
    420,
    { width: 360, height: 640 }
  );
  assertTrue(pos.left >= 0, 'left ไม่ติดลบ');
  assertTrue(pos.left + 340 <= 360, 'ขอบขวาอยู่ใน viewport');
});

test('พื้นที่ด้านล่างไม่พอ → พลิกเมนูขึ้นด้านบน', () => {
  const pos = computeMenuPosition(
    { top: 700, bottom: 732, left: 600, right: 690, width: 90, height: 32 },
    340,
    420,
    { width: 1440, height: 760 }
  );
  assertEqual(pos.flipped, true, 'ต้องพลิกขึ้น');
  assertTrue(pos.top < 700, 'top อยู่เหนือปุ่ม');
  assertTrue(pos.top >= 8, 'top ไม่ติดขอบจอ');
});

test('มี gap ระหว่างปุ่มกับเมนู', () => {
  const pos = computeMenuPosition(
    { top: 100, bottom: 132, left: 600, right: 690, width: 90, height: 32 },
    340,
    420,
    { width: 1440, height: 900 }
  );
  assertEqual(pos.top, 132 + MENU_ANCHOR_GAP, 'วางต่อใต้ปุ่ม + gap');
});

section('[5] InsertDataMenu — Portal + fixed positioning');

test('InsertDataMenu ใช้ Portal (createPortal) และ position: fixed', () => {
  const src = readComposerSource('components/InsertDataMenu.tsx');
  assertContains(src, "from 'react-dom'", 'import createPortal');
  assertContains(src, 'createPortal(', 'ใช้ Portal');
  assertContains(src, "position: 'fixed'", 'ใช้ position fixed');
  assertContains(src, 'document.body', 'portal ไปที่ body');
});

test('InsertDataMenu ไม่ใช้ absolute ที่ทำให้ล้นขอบ parent', () => {
  const src = readComposerSource('components/InsertDataMenu.tsx');
  assertNotContains(src, 'absolute z-50 left-0', 'เอา absolute left-0 ออก');
});

test('InsertDataMenu คำนวณตำแหน่งจากพื้นที่จริง (getBoundingClientRect)', () => {
  const src = readComposerSource('components/InsertDataMenu.tsx');
  assertContains(src, 'getBoundingClientRect', 'วัดตำแหน่งจริง');
  assertContains(src, 'computeMenuPosition', 'ใช้ helper คำนวณ');
});

test('InsertDataMenu ปิดเมนูเมื่อกดภายนอก / Escape', () => {
  const src = readComposerSource('components/InsertDataMenu.tsx');
  assertContains(src, "addEventListener('mousedown', onDocClick)", 'ปิดเมื่อกดภายนอก');
  assertContains(src, "e.key === 'Escape'", 'ปิดเมื่อกด Escape');
  assertContains(src, 'menuRef.current?.contains(target)', 'ตรวจทั้งปุ่มและตัวเมนู');
});

test('InsertDataMenu ไม่แตะพฤติกรรมการแทรก token', () => {
  const src = readComposerSource('components/InsertDataMenu.tsx');
  assertContains(src, 'insertAtCursor(value, cursor, snippet)', 'insertAtCursor เดิม');
  assertContains(src, 'setSelectionRange(result.caret, result.caret)', 'คืน focus + caret เดิม');
});

section('[6] Regression — ขอบเขตห้ามแตะ');

test('ไม่แตะ Backend PDF Renderer / Legacy PDF route', () => {
  const backendRoot = join(process.cwd(), '..', 'backend/src');
  const descriptorRenderer = readFileSync(
    join(backendRoot, 'lib/document-composer/descriptor-renderer.ts'),
    'utf8'
  );
  assertNotContains(descriptorRenderer, 'dc-pages', 'PDF renderer ไม่ต้องแตะ');
  assertNotContains(descriptorRenderer, 'dc-page__footer', 'PDF renderer ไม่ต้องแตะ');
});

test('ไม่แก้ Page Settings schema (page-settings.ts ยังเหมือนเดิม)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/lib/api/page-settings.ts'),
    'utf8'
  );
  assertContains(src, 'export function resolvePageGeometry', 'ยังมี resolvePageGeometry');
  assertNotContains(src, 'pagination', 'ไม่มี logic pagination ใน schema');
});

test('ไม่แก้ Workspace independent scroll', () => {
  const src = readComposerSource('components/ComposerWorkspace.tsx');
  assertNotContains(src, 'createPortal', 'ไม่แตะ workspace scroll');
});

section('[7] InsertDataMenu — render เป็น Portal ได้ (SSR-safe)');

test('InsertDataMenu render ฝั่ง server ไม่ crash (เมนูยังไม่เปิด)', () => {
  const html = renderToStaticMarkup(
    React.createElement(InsertDataMenu, {
      textareaRef: { current: null },
      value: '',
      onChange: () => {},
      fields: [],
    })
  );
  assertContains(html, 'แทรกข้อมูล', 'ปุ่มยัง render');
  assertNotContains(html, 'role="menu"', 'เมนูยังไม่เปิด');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
