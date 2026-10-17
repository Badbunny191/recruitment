'use client';

/**
 * PreviewPanel
 * --------------------------------
 * Document Composer V1 — Live Preview Panel
 *
 * iframe srcdoc + meta (block count, missing fields)
 * - รับ body string จาก preview API response
 * - มี loading / empty state
 */

import type { PreviewResponse } from '@/lib/api/template-descriptor';

export interface PreviewPanelProps {
  preview: PreviewResponse | null;
  loading: boolean;
}

export function PreviewPanel({ preview, loading }: PreviewPanelProps) {
  if (loading && !preview) {
    return (
      <div className="flex items-center justify-center h-[500px] text-slate-500 text-sm">
        <Spinner />
        <span className="ml-2">กำลัง render preview...</span>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex items-center justify-center h-[500px] text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded">
        แก้ไข Block เพื่อดู preview แบบ live
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 mb-1">
        <span>
          {preview.meta.blockCount} blocks
          {preview.meta.missingFieldIds.length > 0 && (
            <span className="text-amber-600 ml-2">
              ⚠ {preview.meta.missingFieldIds.length} missing
            </span>
          )}
        </span>
        <span>auto-refresh 1.5s</span>
      </div>

      <PreviewFrame body={preview.body} />

      {preview.meta.missingFieldIds.length > 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-[11px]">
          <p className="font-semibold text-amber-800">Missing Fields:</p>
          <ul className="mt-1 space-y-0.5">
            {preview.meta.missingFieldIds.map((fid) => (
              <li key={fid} className="text-amber-700 font-mono">
                {fid}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function PreviewFrame({ body }: { body: string }) {
  const srcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
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
        .dc-logo-block { display: flex; }
      </style>
    </head>
    <body>${body}</body>
    </html>
  `;

  return (
    <iframe
      srcDoc={srcDoc}
      title="Document Preview"
      className="w-full h-[500px] border border-slate-200 rounded bg-white"
      sandbox="allow-same-origin"
    />
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}