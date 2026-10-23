'use client';

/**
 * PreviewFrame — shared iframe-based HTML preview renderer
 * --------------------------------
 * Document Composer V1 — Live Preview (Continuous Preview)
 *
 * Single source of truth สำหรับ render HTML preview ทั้งใน
 *   - PreviewPanel (compact/thumbnail ด้านขวา)
 *   - PreviewModal (fullscreen)
 *
 * ใช้ srcdoc + inline CSS เพื่อให้:
 *   - ไม่ขึ้นกับ external stylesheet
 *   - mode + header toggle ผ่าน backend options (single renderer)
 *   - ไม่มี token logic ซ้ำ (ทุกอย่างจาก backend renderDescriptorToPreview)
 *
 * ── ⚠️ Continuous Preview (เปลี่ยนแนวทาง 2026-10-22) ────────────────────────────
 *   **ตัด Browser Pagination ออกทั้งหมด**
 *   - ไม่วัด DOM ไม่แบ่งหน้า A4 ในเบราว์เซอร์อีก
 *   - ไม่มี script ฝัง ไม่มีการ scale/zoom ไม่มีการวัดความสูง
 *   - เอกสารเป็น **ลำดับต่อเนื่องยาวเดียว** ในกรอบกระดาษกว้าง A4
 *   - คง Page Settings (margin จาก `preview.page`) เป็น padding ของกรอบ
 *   - คงการแสดงข้อมูลผู้สมัคร, Page Settings, ความเร็ว/เสถียร
 *
 *   🔑 **การแบ่งหน้าจริง = PDF Preview เท่านั้น (source of truth)**
 *      ดู PdfPreviewFrame.tsx — เรียก PDF Renderer ตัวเดียวกับ export
 *      block `pageBreak` ใน HTML preview แสดงเป็น separator `📄 หน้าใหม่`
 *
 * ⚠️ Compact และ Fullscreen ใช้ component นี้ตัวเดียวกัน
 *    → หน้าตาจึงตรงกันเสมอ
 */

import { useEffect, useMemo, useRef } from 'react';
import type { PreviewResponse } from '@/lib/api/template-descriptor';

/**
 * ความกว้าง/สูงกระดาษ A4 (pt) — fallback เมื่อ backend ยังไม่ส่ง page geometry
 *
 * ⚠️ ใช้แค่กำหนด "ความกว้าง" ของกรอบกระดาษเพื่อให้เส้นเนื้อหาตรงกับ A4
 *    ไม่ใช้กำหนดความสูง (continuous → โตตามเนื้อหา)
 */
const PREVIEW_PAGE_WIDTH_PT = 595.28;

/**
 * Frame-level CSS ที่ต้องมีเสมอ (ไม่เกี่ยวกับ block layout)
 *
 * CSS ของ block ทั้งหมด (.dc-systemdata, .dc-field, ...) มาจาก backend
 * `preview.styles` เพื่อไม่ให้เกิด CSS drift — ถ้า hardcode ซ้ำที่นี่
 * แก้ backend แล้ว preview จะไม่เปลี่ยน
 */
const PREVIEW_FRAME_CSS = `
/*
 * ⚠️ font-family ต้องเป็นชุดเดียวกับ PDF Renderer
 *
 * PDF ใช้ TH Sarabun (backend/src/lib/fonts/font-loader.ts)
 * ถ้า iframe ใช้ system font อื่น (เช่น -apple-system)
 * → ตัวอักษรไทยกว้าง/แคบต่างกัน → Preview กับ PDF ดูไม่เหมือนกัน
 *
 * เรียง fallback: Sarabun (ถ้ามี) → Tahoma → sans-serif
 * (Tahoma เป็น fallback เดียวกับที่ backend .dc-preview ใช้)
 */
body {
  font-family: "Sarabun", "Tahoma", sans-serif;
  padding: 0;
  margin: 0;
  color: #0d4572;
  background: white;
  line-height: 1.4;
}

/*
 * กรอบกระดาษ A4 (แบบ continuous — โตตามเนื้อหา)
 *
 * ⚠️ padding ถูกกำหนดจาก resolvePageGeometry() (backend) ผ่าน inline style
 *    ที่ inject ลงใน srcdoc → override ได้โดยไม่ต้องแก้ CSS ที่นี่
 *    (ค่า default 40pt ใช้กรณี backend ยังไม่ส่ง page geometry มา)
 *
 * ⚠️ ห้าม override padding/margin ของ .dc-page ที่นี่ (หรือที่อื่น)
 *    เพราะจะทำให้กระดาษหายขอบ / ไม่ตรงกับ PDF
 *
 * ⚠️ ห้ามใส่ height / min-height ที่ตายตัว
 *    → เอกสารยาวต้องไหลต่อแบบ continuous เพียงอย่างเดียว
 */
.dc-page {
  width: ${PREVIEW_PAGE_WIDTH_PT}pt;
  max-width: 100%;
  padding: 40pt;
  box-sizing: border-box;
  margin: 0 auto;
  background: white;
}

.dc-flow {
  display: flow-root;
}
/*
 * ⚠️ ขนาด/สีของ block ทั้งหมด (heading, field, table, systemData, signature)
 *    มาจาก backend (preview.styles) ตามค่าเดียวกับ PDF renderer
 *    → ห้าม hardcode font-size / line-height ซ้ำที่นี่
 *    (ถ้า hardcode จะ override CSS ของ backend แล้ว Preview เพี้ยนจาก PDF)
 *
 * ที่เหลือด้านล่างคือเพียง alignment ของระดับ container เท่านั้น
 */
.dc-logo.dc-align--left   { text-align: left; }
.dc-logo.dc-align--center { text-align: center; }
.dc-logo.dc-align--right  { text-align: right; }
.dc-heading.dc-align--left   { text-align: left;   margin-right: auto; }
.dc-heading.dc-align--center { text-align: center; margin-left: auto; margin-right: auto; }
.dc-heading.dc-align--right  { text-align: right;  margin-left: auto; }
.dc-field.dc-align--left   { text-align: left; }
.dc-field.dc-align--center { text-align: center; }
.dc-field.dc-align--right  { text-align: right; }
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
}

export function PreviewFrame({
  preview,
  withHeader = false,
  className = 'w-full h-full border border-slate-200 rounded bg-white',
  title = 'Document Preview',
}: PreviewFrameProps) {
  /** ref ของ iframe — ใช้ส่งสัญญาณ scroll reset เข้าไป */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
    const padding = `${marginTop}pt ${marginRight}pt ${marginBottom}pt ${marginLeft}pt`;

    // ⚠️ ไม่มี <script> เลย → ไม่มีการวัด DOM / ไม่มีการแบ่งหน้าในเบราว์เซอร์
    //    Scroll reset ทำผ่าน parent postMessage listener (ด้านล่าง)
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
<div class="dc-page" style="width: ${pageWidth}pt; padding: ${padding};">${inner}</div>
</body>
</html>`;
  }, [inner, preview.mode, preview.styles, preview.page]);

  /**
   * ── Scroll reset เมื่อ srcdoc เปลี่ยน (re-render / สลับโหมด) ────────────
   *
   * Root cause ที่พบ: เมื่อสลับ Form ↔ Document/PDF หรือ re-render
   *   → iframe คง scrollTop เดิมไว้ → ผู้ใช้เปิดมาเจอกลางเอกสาร / ข้อความบางส่วนหาย
   *
   *   * แก้โดย: ส่งสัญญาณ "เลื่อนกลับด้านบน" เข้า iframe ทุกครั้งที่ srcdoc เปลี่ยน
   *   → ไม่ล้าง descriptor / applicationId / pageSettings (มีแค่ scroll)
   *
   * ⚠️ ต้องประกาศหลัง `srcDoc` — ถ้าอยู่ก่อนจะเจอ TDZ error
   *    ("Cannot access 'srcDoc' before initialization") และ component พังทั้งตัว
   */
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const scrollTop = () => {
      try {
        const win = frame.contentWindow;
        win?.scrollTo(0, 0);
        const doc = win?.document;
        if (doc?.documentElement) doc.documentElement.scrollTop = 0;
        if (doc?.body) doc.body.scrollTop = 0;
      } catch {
        /* ignore (opaque origin / sandbox) */
      }
    };

    const onLoad = () => {
      // postMessage ให้ฝั่งใน (ถ้ามี script ในอนาคต) + scroll ตรง ๆ
      try {
        frame.contentWindow?.postMessage(
          { type: 'dc-preview-scroll-top' },
          '*'
        );
      } catch {
        /* ignore */
      }
      scrollTop();
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
      // ⚠️ sandbox: ไม่ใส่ "allow-scripts" (ไม่มี script ใน srcdoc แล้ว)
      //    → srcdoc เนื้อหามาจาก backend ที่ escape HTML แล้ว แต่ก็ไม่จำเป็น
      //      ให้รัน script ในหน้า preview
      //    → เก็บ "allow-same-origin" ไว้เพื่อให้ parent เลื่อน scrollTop ได้
      sandbox="allow-same-origin"
    />
  );
}