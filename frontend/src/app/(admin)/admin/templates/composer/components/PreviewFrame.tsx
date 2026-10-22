'use client';

/**
 * PreviewFrame — shared iframe-based HTML preview renderer
 * --------------------------------
 * Document Composer V1 — Live Preview
 *
 * Single source of truth สำหรับ render HTML preview ทั้งใน
 *   - PreviewPanel (compact/thumbnail ด้านขวา)
 *   - PreviewModal (fullscreen A4)
 *
 * ใช้ srcdoc + inline CSS เพื่อให้:
 *   - ไม่ขึ้นกับ external stylesheet
 *   - mode + header toggle ผ่าน backend options (single renderer)
 *   - ไม่มี token logic ซ้ำ (ทุกอย่างจาก backend renderDescriptorToPreview)
 *
 * ── Pagination (UAT fix) ─────────────────────────────────────────────────────
 * เดิม `.dc-page` มีแต่ `min-height` → เนื้อหาที่เกิน A4 ไหลต่อใต้หน้าแรก
 * (ไม่ใช่ pagination จริง) → ตอนนี้ใช้ script วัดความสูงจริงใน iframe
 * แล้วแบ่งเป็นหลายหน้า A4 แยกกัน มีช่องว่างระหว่างหน้า
 *
 * ⚠️ Compact และ Fullscreen ใช้ component นี้ตัวเดียวกัน
 *    → จำนวนหน้า + ลำดับหน้า (หน้า X / N) จึงตรงกันเสมอ
 * ⚠️ ไม่มี Automatic Header ในการแบ่งหน้า (ห้ามนำกลับมา)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewResponse } from '@/lib/api/template-descriptor';
import {
  PREVIEW_PAGE_GAP_PT,
  PREVIEW_PAGE_HEIGHT_PT,
  PREVIEW_PAGE_WIDTH_PT,
  buildPaginationScript,
} from '../lib/preview-pagination';

/**
 * Frame-level CSS ที่ต้องมีเสมอ (ไม่เกี่ยวกับ block layout)
 *
 * CSS ของ block ทั้งหมด (.dc-systemdata, .dc-field, ...) มาจาก backend
 * `preview.styles` เพื่อไม่ให้เกิด CSS drift — ถ้า hardcode ซ้ำที่นี่
 * แก้ backend แล้ว preview จะไม่เปลี่ยน (bug ที่เคยเจอ: rule ที่แก้ใน
 * backend ไม่เคยถูกส่งมาถึง iframe เลย)
 */
const PREVIEW_FRAME_CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 0;
  margin: 0;
  color: #1e293b;
  background: white;
  line-height: 1.5;
}

/*
 * Page box (A4 ในหน่วย pt) — ใช้ตัวเดียวกันทั้ง Compact และ Fullscreen
 *
 * ⚠️ padding ถูกกำหนดจาก resolvePageGeometry() (backend) ผ่าน inline style
 *    ที่ inject ลงใน srcdoc → override ได้โดยไม่ต้องแก้ CSS ที่นี่
 *    (ค่า default 40pt ใช้กรณี backend ยังไม่ส่ง page geometry มา)
 *
 * ⚠️ ห้าม override padding/margin ของ .dc-page ที่นี่ (หรือที่อื่น)
 *    เพราะจะทำให้กระดาษหายขอบ / ไม่ตรงกับ PDF
 */
.dc-page {
  width: 595.28pt;
  min-height: 841.89pt;
  padding: 40pt;
  box-sizing: border-box;
  margin: 0 auto;
  background: white;
}

/*
 * ── Pagination ────────────────────────────────────────────────────────────────
 * .dc-scale-host = ภาชนะนอกสุด (ใช้วัดสเกล + กัน horizontal scrollbar)
 * .dc-scaler     = ภาชนะที่ถูกย่อ/ขยายทั้งชุด (ไม่ให้เกิด horizontal scrollbar)
 * .dc-pages      = ภาชนะของแผ่นกระดาษทั้งหมด (แบ่งหน้าแล้ว)
 * .dc-source     = ภาชนะต้นทาง (ถูก script ย้ายเข้า .dc-flow ของแต่ละหน้า)
 *
 * ทุกหน้าใช้ margin ชุดเดียวกัน (ค่าเดียวกับทุกหน้า)
 * แต่ละแผ่น = "แผ่นกระดาษ" แยกกันชัดเจน (พื้นขาว + เส้นขอบ/เงา + ช่องว่าง)
 */
#dc-scale-host {
  width: 100%;
  overflow-x: hidden;
}
#dc-scaler {
  width: 100%;
}
.dc-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${PREVIEW_PAGE_GAP_PT}pt;
  padding: ${PREVIEW_PAGE_GAP_PT}pt 0;
  width: 100%;
}

/* แผ่นกระดาษ 1 แผ่น = 1 หน้า (label + ตัวกระดาษ) */
.dc-page-sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4pt;
  width: ${PREVIEW_PAGE_WIDTH_PT}pt;
  max-width: 100%;
}

/*
 * ป้าย "หน้า X / N" — อยู่นอกพื้นที่เอกสาร (ไม่ติดไปกับ PDF)
 * ⚠️ ห้ามย้ายเข้า .dc-page เด็ดขาด
 */
.dc-page__label {
  font-size: 9pt;
  color: #64748b;
  letter-spacing: 0.02em;
  user-select: none;
}

/* ตัวกระดาษ — ขนาด A4 เต็ม (595.28pt × 841.89pt) */
.dc-page--paged {
  position: relative;
  min-height: ${PREVIEW_PAGE_HEIGHT_PT}pt;
  width: ${PREVIEW_PAGE_WIDTH_PT}pt;
  max-width: 100%;
  margin: 0;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 6px 18px rgba(15, 23, 42, 0.10);
  /*
   * ⚠️ ห้ามใส่ overflow:hidden ที่นี่
   *    → เนื้อหาที่ยาวเกินหน้าจะถูก clip ทิ้ง (ข้อความหายไป)
   *    → ใช้ min-height (ไม่ fix height) เพื่อให้หน้าโตได้ถ้าจำเป็น
   */
}
.dc-flow {
  display: flow-root;
}
.dc-heading { font-weight: 600; margin: 0; }
.dc-heading.size-small { font-size: 14px; }
.dc-heading.size-medium { font-size: 18px; }
.dc-heading.size-large { font-size: 24px; }
/*
 * ⚠️ เคยมี override .dc-preview / .dc-preview-modal ที่ตั้ง padding: 0
 *    → ทำให้ page box หายขอบ ตอนนี้ page box คือ .dc-page เท่านั้น
 *    ห้ามเพิ่ม rule ที่ override padding/margin ของ .dc-page อีก
 */
.dc-field-label { font-weight: 500; color: #475569; font-size: 12px; margin-bottom: 4px; }
.dc-field-value { font-size: 14px; }
.dc-field-block, .dc-table-block, .dc-logo-block, .dc-heading-block { margin-bottom: 8px; }
.dc-table-block table { border-collapse: collapse; width: 100%; font-size: 12px; }
.dc-table-block th, .dc-table-block td { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: left; }
.dc-table-block th { background: #f1f5f9; font-weight: 600; }
.dc-logo { width: 100%; box-sizing: border-box; }
.dc-logo.dc-align--left   { text-align: left; }
.dc-logo.dc-align--center { text-align: center; }
.dc-logo.dc-align--right  { text-align: right; }
.dc-logo img { display: inline-block; width: 70px; height: auto; }
.dc-logo-block { display: flex; }
.dc-heading.dc-align--left   { text-align: left;   margin-right: auto; }
.dc-heading.dc-align--center { text-align: center; margin-left: auto; margin-right: auto; }
.dc-heading.dc-align--right  { text-align: right;  margin-left: auto; }
.dc-field.dc-align--left   { text-align: left; }
.dc-field.dc-align--center { text-align: center; }
.dc-field.dc-align--right  { text-align: right; }
.dc-field.dc-align--center .dc-control,
.dc-field.dc-align--center .dc-control-group,
.dc-field.dc-align--right  .dc-control,
.dc-field.dc-align--right  .dc-control-group { margin-left: 0; }
.dc-control,
.dc-control--inline {
  font-family: inherit;
}
.dc-control--inline {
  display: inline-flex;
  width: auto;
}
.dc-table-wrap.dc-align--left   { text-align: left; }
.dc-table-wrap.dc-align--center { text-align: center; }
.dc-table-wrap.dc-align--right  { text-align: right; }
.dc-table-wrap.dc-align--center > .dc-table,
.dc-table-wrap.dc-align--right  > .dc-table { display: inline-table; }
`;

export interface PreviewFrameProps {
  /** Full PreviewResponse from backend (includes html/body/header/meta/mode/tokens) */
  preview: PreviewResponse;
  /** Compact mode = no header (just body). A4 Modal = header + body. Default: compact */
  withHeader?: boolean;
  /**
   * iframe class — caller decides sizing
   *
   * ⚠️ ห้าม hard-code ความสูงคงที่ที่นี่
   *    เพราะจะทำให้ Live Preview ใน Workspace ไม่เต็มความสูงที่เหลือ
   *    → ผู้เรียกใช้ควรส่ง w-full h-full เพื่อให้ iframe เต็มพื้นที่ที่ได้รับ
   */
  className?: string;
  /** iframe title (a11y) */
  title?: string;
  /**
   * callback เมื่อทราบจำนวนหน้าที่แบ่งแล้ว
   * (Compact และ Fullscreen รายงานจำนวนหน้าเดียวกัน)
   */
  onPageCount?: (pageCount: number) => void;
  /**
   * ให้ iframe สูงตามเนื้อหาจริง (ใช้กับ Fullscreen ที่มีหลายหน้า)
   *
   * ⚠️ Compact ใช้ h-full (เต็มพื้นที่ที่ได้รับ) → ไม่ส่ง prop นี้
   */
  autoHeight?: boolean;
}

export function PreviewFrame({
  preview,
  withHeader = false,
  className = 'w-full h-full border border-slate-200 rounded bg-white',
  title = 'Document Preview',
  onPageCount,
  autoHeight = false,
}: PreviewFrameProps) {
  const [pageCount, setPageCount] = useState(0);
  /** ความสูงเนื้อหาจริงใน iframe (px) — ใช้เมื่อ autoHeight */
  const [contentHeight, setContentHeight] = useState(0);
  /** ref ของ iframe — ใช้ส่งสัญญาณ scroll reset เข้าไป */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ── รับจำนวนหน้า + ความสูงจาก iframe ผ่าน postMessage ───────────────
  // (script ฝังอยู่ใน srcdoc → ส่งกลับมาที่ parent)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (
        data &&
        typeof data === 'object' &&
        (data as { type?: string }).type === 'dc-preview-pagination'
      ) {
        const count = Number((data as { pageCount?: number }).pageCount ?? 0);
        const height = Number((data as { contentHeight?: number }).contentHeight ?? 0);
        setPageCount((prev) => (prev === count ? prev : count));
        setContentHeight((prev) => (prev === height ? prev : height));
        onPageCount?.(count);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onPageCount]);

  const inner = withHeader
    ? `${preview.header}\n${preview.body}`
    : preview.body;

  const srcDoc = useMemo(() => {
    // ── Backend CSS เป็น single source of truth ──────────────────
    // preview.styles คือ PREVIEW_STYLES ชุดเดียวกับที่ฝังใน preview.html
    // ถ้าไม่ inject ตรงนี้ CSS ของ block (เช่น .dc-systemdata) จะไม่มีใน iframe
    // เลย → แก้ backend แล้ว preview ไม่เปลี่ยน (root cause ที่เจอรอบนี้)
    const backendCss = preview.styles ?? '';

    // ── Page geometry (ขอบกระดาษ) ─────────────────────────────────
    // มาจาก resolvePageGeometry() ฝั่ง backend → ใช้ค่าเดียวกันทั้ง
    // Compact (PreviewPanel) และ Fullscreen (PreviewModal)
    // ถ้า backend ยังไม่ส่งมา → ใช้ค่า default (40pt ทุกด้าน)
    const page = preview.page;
    const marginTop = page?.marginTop ?? 40;
    const marginRight = page?.marginRight ?? 40;
    const marginBottom = page?.marginBottom ?? 40;
    const marginLeft = page?.marginLeft ?? 40;
    const pageWidth = page?.pageWidth ?? PREVIEW_PAGE_WIDTH_PT;
    const pageHeight = page?.pageHeight ?? PREVIEW_PAGE_HEIGHT_PT;
    const padding = `${marginTop}pt ${marginRight}pt ${marginBottom}pt ${marginLeft}pt`;

    const paginationScript = buildPaginationScript({
      pageWidthPt: pageWidth,
      pageHeightPt: pageHeight,
      marginTop,
      marginRight,
      marginBottom,
      marginLeft,
    });

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
${PREVIEW_FRAME_CSS}
${backendCss}
  </style>
</head>
<body>
<div id="dc-scale-host">
  <div id="dc-scaler">
    <div id="dc-pages" class="dc-pages"></div>
  </div>
</div>
<div id="dc-source" class="dc-source" style="width: ${pageWidth}pt; margin: 0 auto; padding: ${padding};">${inner}</div>
<script>
${paginationScript}
</script>
</body>
</html>`;
  }, [inner, preview.mode, preview.styles, preview.page]);

  /**
   * ── Scroll reset เมื่อ srcdoc เปลี่ยน (re-render / สลับโหมด) ────────────
   *
   * Root cause ที่พบ: เมื่อสลับ Form ↔ Document/PDF หรือ re-render
   *   → iframe คง scrollTop เดิมไว้ → ผู้ใช้เปิดมาเจอกลางเอกสาร / ข้อความบางส่วนหาย
   *
   * แก้โดย: ส่งสัญญาณ "เลื่อนกลับด้านบน" เข้า iframe ทุกครั้งที่ srcdoc เปลี่ยน
   *   → ไม่ล้าง descriptor / applicationId / pageSettings (มีแค่ scroll)
   *
   * ⚠️ ต้องประกาศหลัง `srcDoc` — ถ้าอยู่ก่อนจะเจอ TDZ error
   *    ("Cannot access 'srcDoc' before initialization") และ component พังทั้งตัว
   */
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const onLoad = () => {
      try {
        frame.contentWindow?.postMessage(
          { type: 'dc-preview-scroll-top' },
          '*'
        );
      } catch {
        /* ignore (cross-origin / sandbox) */
      }
    };
    frame.addEventListener('load', onLoad);
    // กรณี iframe โหลดเสร็จก่อน effect ทำงาน → ส่งซ้ำอีกครั้ง
    onLoad();
    return () => frame.removeEventListener('load', onLoad);
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title={title}
      className={className}
      data-page-count={pageCount}
      style={
        autoHeight && contentHeight > 0
          ? { height: `${contentHeight}px`, minHeight: '297mm' }
          : undefined
      }
      // ⚠️ sandbox: ใช้ "allow-scripts" เท่านั้น (ไม่ใช้ allow-same-origin)
      //    → script แบ่งหน้าทำงานได้ + postMessage ส่งจำนวนหน้ากลับได้
      //    → แต่ origin ของ iframe เป็น opaque (แยกจาก parent)
      //      → เนื้อหาใน iframe เข้าถึง DOM ของ parent ไม่ได้
      sandbox="allow-scripts"
    />
  );
}
