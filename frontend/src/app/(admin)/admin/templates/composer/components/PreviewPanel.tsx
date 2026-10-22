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
 *
 * ก้อนที่ 2 (Responsive Workspace) — UAT fix:
 *   - ไม่ hard-code ความสูงคงที่อีกต่อไป
 *     → ใช้ `flex-1` + `min-h-0` + `h-full` ให้พื้นที่ Preview
 *       ขยายเต็มความสูงที่เหลือของคอลัมน์
 *   - เอกสารยาวให้ scroll ภายใน iframe เอง (ไม่ใช่ scroll ที่ CardContent)
 *
 * ── ⚠️ Continuous Preview (2026-10-22) ──────────────────────────────────────
 *   - ตัด browser pagination ออกทั้งหมด → ไม่มี pageCount ที่นี่แล้ว
 *   - `view` prop เลือกได้ระหว่าง 'html' (continuous) กับ 'pdf' (PDF จริง)
 *   - 🔑 PDF Preview คือ source of truth เรื่องการแบ่งหน้า
 */

import type {
  DocumentDescriptor,
  PreviewResponse,
} from '@/lib/api/template-descriptor';
import { PreviewFrame } from './PreviewFrame';
import { PdfPreviewFrame, type PdfPreviewStatus } from './PdfPreviewFrame';
import { cn } from '@/lib/utils';

export interface PreviewPanelProps {
  preview: PreviewResponse | null;
  loading: boolean;
  /** className เพิ่มเติมของ container */
  className?: string;
  /** โหมด preview: 'html' = continuous HTML (default) | 'pdf' = PDF จริง */
  view?: 'html' | 'pdf';
  /** ── สำหรับ view='pdf' ─────────────────────────────────────────────────── */
  /** Template version id (endpoint pdf-preview) */
  templateVersionId?: string;
  /** Descriptor ปัจจุบัน (ส่งตรง ๆ เพื่อไม่ต้องรอ auto-refresh) */
  descriptor?: DocumentDescriptor | null;
  /** applicationId — ดูข้อมูลผู้สมัครจริงแทนข้อมูลตัวอย่าง */
  applicationId?: string;
  /** callback รายงานสถานะ PDF preview */
  onPdfStatus?: (status: PdfPreviewStatus) => void;
}

export function PreviewPanel({
  preview,
  loading,
  className,
  view = 'html',
  templateVersionId,
  descriptor,
  applicationId,
  onPdfStatus,
}: PreviewPanelProps) {
  if (view === 'pdf') {
    return (
      <PdfPreviewFrame
        className={className}
        templateVersionId={templateVersionId}
        descriptor={descriptor}
        applicationId={applicationId}
        descriptorReady={!!descriptor}
        onStatusChange={onPdfStatus}
      />
    );
  }

  if (loading && !preview) {
    return (
      <div
        className={cn(
          'flex flex-1 min-h-0 items-center justify-center w-full text-slate-500 text-sm',
          className
        )}
      >
        <Spinner />
        <span className="ml-2">กำลัง render preview...</span>
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        className={cn(
          'flex flex-1 min-h-0 items-center justify-center w-full text-slate-400 text-sm',
          'border-2 border-dashed border-slate-200 rounded',
          className
        )}
      >
        แก้ไข Block เพื่อดู preview แบบ live
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 h-full', className)}>
      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 mb-1 shrink-0">
        <span>
          {preview.meta.blockCount} blocks
          {preview.meta.missingFieldIds.length > 0 && (
            <span className="text-amber-600 ml-2">
              ⚠ {preview.meta.missingFieldIds.length} missing
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span>auto-refresh 1.5s</span>
        </span>
      </div>

      {/*
        พื้นที่ Preview — ขยายเต็มความสูงที่เหลือ (flex-1 + min-h-0)
        ⚠️ ห้าม hard-code ความสูงคงที่ที่นี่
           เอกสารยาวให้ scroll ภายใน iframe เอง (continuous)
      */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <PreviewFrame
          preview={preview}
          className="w-full h-full flex-1 min-h-0 border border-slate-200 rounded bg-white"
        />
      </div>

      {preview.meta.missingFieldIds.length > 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-[11px] shrink-0">
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
    </div>
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