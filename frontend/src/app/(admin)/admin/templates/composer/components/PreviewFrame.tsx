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
 */

import { useMemo } from 'react';
import type { PreviewResponse } from '@/lib/api/template-descriptor';

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
}

export function PreviewFrame({
  preview,
  withHeader = false,
  className = 'w-full h-full border border-slate-200 rounded bg-white',
  title = 'Document Preview',
}: PreviewFrameProps) {
  const inner = withHeader
    ? `${preview.header}\n${preview.body}`
    : preview.body;

  const srcDoc = useMemo(() => {
    // ── Backend CSS เป็น single source of truth ──────────────────
    // preview.styles คือ PREVIEW_STYLES ชุดเดียวกับที่ฝังใน preview.html
    // ถ้าไม่ inject ตรงนี้ CSS ของ block (เช่น .dc-systemdata) จะไม่มีใน iframe
    // เลย → แก้ backend แล้ว preview ไม่เปลี่ยน (root cause ที่เจอรอบนี้)
    const backendCss = preview.styles ?? '';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
${PREVIEW_FRAME_CSS}
${backendCss}
  </style>
</head>
<body><div class="dc-page">${inner}</div></body>
</html>`;
  }, [inner, preview.mode, preview.styles]);

  return (
    <iframe
      srcDoc={srcDoc}
      title={title}
      className={className}
      sandbox="allow-same-origin"
    />
  );
}
