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
 * Inline CSS ที่ใช้ใน iframe (เหมือนเดิม — โหมด Form
 * ต้องการ rule สำหรับ alignment และ form controls ที่ backend ไม่ได้ pack ไว้)
 *
 * หมายเหตุ: backend renderer มี style block ครบอยู่แล้วใน PreviewResponse.html
 * → CSS ที่นี่เป็น "รายงานเสริม" สำหรับ compact preview (ที่ใช้แค่ body)
 *   เพื่อให้ alignment/control spacing คงเดิมช่วง compat
 */
const PREVIEW_FRAME_CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 16px;
  margin: 0;
  color: #1e293b;
  background: white;
  line-height: 1.5;
}
.dc-heading { font-weight: 600; margin: 0; }
.dc-heading.size-small { font-size: 14px; }
.dc-heading.size-medium { font-size: 18px; }
.dc-heading.size-large { font-size: 24px; }
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
  /** iframe class — caller decides sizing */
  className?: string;
  /** iframe title (a11y) */
  title?: string;
  /** Height class for compact (e.g. h-[500px]) */
  compactHeight?: string;
}

export function PreviewFrame({
  preview,
  withHeader = false,
  className = 'w-full h-[500px] border border-slate-200 rounded bg-white',
  title = 'Document Preview',
  compactHeight,
}: PreviewFrameProps) {
  const inner = withHeader
    ? `${preview.header}\n${preview.body}`
    : preview.body;

  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
${PREVIEW_FRAME_CSS}
${preview.mode === 'form' ? '' : ''}
  </style>
</head>
<body>${inner}</body>
</html>`;
  }, [inner, preview.mode]);

  return (
    <iframe
      srcDoc={srcDoc}
      title={title}
      className={compactHeight ? `${className} ${compactHeight}` : className}
      sandbox="allow-same-origin"
    />
  );
}
