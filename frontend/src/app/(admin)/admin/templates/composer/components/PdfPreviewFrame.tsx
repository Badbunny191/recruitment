'use client';

/**
 * PdfPreviewFrame — PDF Preview จริง (Source of Truth เรื่องการแบ่งหน้า)
 * --------------------------------------------
 * Document Composer — PDF Preview Mode (2026-10-22)
 *
 * 🎯 เป้าหมาย
 *   HTML Preview ถูกลดรูปเป็น **Continuous Preview** (ไม่แบ่งหน้าในเบราว์เซอร์)
 *   → การแบ่งหน้าจริงจึงต้องดูจาก **PDF จริง** ที่สร้างโดย renderer ตัวเดียวกับ export
 *
 * ⚠️ ขอบเขต (ห้ามละเมิด)
 *   - ใช้ Descriptor **ปัจจุบัน** เป็น input (ไม่แตะ DB / data ผู้สมัคร)
 *   - เรียก PDF Renderer ตัวเดียวกับ export (`buildRenderPlan` → `renderPlanToPdf`)
 *   - block `pageBreak` → ขึ้นหน้าใหม่ทันที (ไม่คำนวณความสูง)
 *   - Page Settings (margin preset/custom) ถูกส่งไปครบ → PDF ตรงกับของจริง
 *   - จำนวนหน้าที่แสดง = `X-Pdf-Page-Count` จาก renderer (ไม่เดาเอง)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DocumentDescriptor,
  PdfPreviewResponse,
} from '@/lib/api/template-descriptor';
import { previewTemplateDescriptorPdf } from '@/lib/api/template-descriptor';
import { cn } from '@/lib/utils';

export type PdfPreviewStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; pageCount: number }
  | { state: 'error'; message: string };

export interface PdfPreviewFrameProps {
  /** Template version id — ใช้เรียก endpoint pdf-preview */
  templateVersionId?: string;
  /**
   * Descriptor ปัจจุบัน (ยังไม่ save ก็ได้)
   * - ถ้าไม่ส่ง → component จะไม่ render จนกว่าจะได้
   */
  descriptor?: DocumentDescriptor | null;
  /** applicationId (ถ้าต้องการดูข้อมูลผู้สมัครจริงแทนข้อมูลตัวอย่าง) */
  applicationId?: string;
  /** iframe class — caller decides sizing */
  className?: string;
  /** true ถ้า descriptor ยังพร้อม render (ใช้กรณี parent ส่ง descriptor ผ่าน ref/context) */
  descriptorReady?: boolean;
  /** callback รายงานสถานะ (หน้า count / error) */
  onStatusChange?: (status: PdfPreviewStatus) => void;
  /** debounce ms ก่อนยิง renderer (default 800ms — PDF ช้ากว่า HTML) */
  debounceMs?: number;
}

export function PdfPreviewFrame({
  templateVersionId,
  descriptor,
  applicationId,
  className,
  descriptorReady = false,
  onStatusChange,
  debounceMs = 800,
}: PdfPreviewFrameProps) {
  const [status, setStatus] = useState<PdfPreviewStatus>({ state: 'idle' });
  const [pdf, setPdf] = useState<PdfPreviewResponse | null>(null);

  /** object URL ปัจจุบัน — ต้อง revoke เมื่อเปลี่ยน/ปิด */
  const urlRef = useRef<string | null>(null);

  const ready = !!templateVersionId && (!!descriptor || descriptorReady);

  // ── ยิง PDF renderer เมื่อ descriptor เปลี่ยน (debounced) ────────────────
  useEffect(() => {
    if (!ready) return;
    if (!descriptor || descriptor.blocks.length === 0) {
      setStatus({ state: 'idle' });
      return;
    }

    let cancelled = false;
    setStatus({ state: 'loading' });

    const timer = setTimeout(async () => {
      const res = await previewTemplateDescriptorPdf(templateVersionId!, {
        descriptor: descriptor!,
        applicationId,
      });

      if (cancelled) {
        // ผลลัพธ์มาช้า — ปล่อย URL ทิ้งทันที
        if (res.ok) URL.revokeObjectURL(res.data.url);
        return;
      }

      if (!res.ok) {
        setStatus({ state: 'error', message: res.error.error });
        setPdf(null);
        return;
      }

      // เปลี่ยน URL เดิม → revoke ก่อน (กัน memory leak)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = res.data.url;
      setPdf(res.data);
      setStatus({ state: 'ready', pageCount: res.data.pageCount });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, templateVersionId, descriptor, applicationId, debounceMs]);

  // ── cleanup เมื่อ unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  // ── รายงานสถานะให้ parent ──────────────────────────────────────────────────
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // ── เปิด/ปิด PDF ใน fullscreen tab ───────────────────────────────────────
  const handleOpen = useCallback(() => {
    if (pdf?.url) window.open(pdf.url, '_blank', 'noopener,noreferrer');
  }, [pdf]);

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 mb-1 shrink-0 gap-2">
        <span className="flex items-center gap-1">
          {status.state === 'ready' ? (
            <>
              <span data-testid="pdf-page-count">📄 {status.pageCount} หน้า</span>
              <span className="text-slate-400">(PDF จริง)</span>
            </>
          ) : status.state === 'loading' ? (
            <span className="text-blue-600">กำลังสร้าง PDF…</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-slate-400">แบ่งหน้าจริงตาม PDF</span>
          <button
            type="button"
            onClick={handleOpen}
            disabled={!pdf}
            className="text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
            title="เปิด PDF เต็มหน้าจอ"
          >
            เปิดเต็มจอ ↗
          </button>
        </span>
      </div>

      {/* PDF canvas */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {pdf ? (
          <iframe
            key={pdf.url}
            src={pdf.url}
            title="PDF Preview (แบ่งหน้าจริง)"
            data-testid="pdf-preview-frame"
            className="w-full h-full flex-1 min-h-0 border border-slate-200 rounded bg-slate-100"
          />
        ) : (
          <div className="flex flex-1 min-h-0 items-center justify-center w-full text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded">
            {status.state === 'error' ? (
              <span className="text-red-600">PDF Preview ผิดพลาด: {status.message}</span>
            ) : status.state === 'loading' ? (
              <span className="flex items-center gap-2">
                <Spinner />
                กำลังเรียก PDF Renderer…
              </span>
            ) : (
              'เพิ่ม Block เพื่อดู PDF Preview'
            )}
          </div>
        )}
      </div>
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