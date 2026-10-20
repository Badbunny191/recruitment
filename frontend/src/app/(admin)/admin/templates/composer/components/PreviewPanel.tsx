'use client';

/**
 * PreviewPanel
 * --------------------------------
 * Document Composer V1 — Live Preview Panel (Compact / Thumbnail)
 *
 * Requirements:
 *   - Compact preview on the right (รักษาความ compact สำหรับ auto-refresh)
 *   - ไม่แสดง document header (modal handles that)
 *   - ใช้ shared PreviewFrame — single source of truth กับ fullscreen modal
 */

import type { PreviewResponse } from '@/lib/api/template-descriptor';
import { PreviewFrame } from './PreviewFrame';

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

      <PreviewFrame preview={preview} />

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

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
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
