'use client';

/**
 * PreviewModal — Fullscreen A4 Document Composer Preview
 * --------------------------------
 * Document Composer V1 — Live Preview UX
 *
 * Requirements (Re-validated 2026-10):
 *   1. Visual Composer — ไม่แตะ (handled in ComposerClient)
 *   2. ปุ่ม Preview → เปิด Fullscreen A4 Modal
 *   3. A4 aspect (210×297mm) + พื้นหลังเหมือนเอกสารจริง + ขอบกระดาษ
 *   4. 🔑 HTML Preview = **เอกสาร** เสมอ (ไม่ใช่ฟอร์ม)
 *      - ไม่มีตัวสลับ Form ↔ Document ใน toolbar แล้ว
 *      - ไม่มี input / textarea / select / checkbox / radio ใน preview
 *      → เป้าหมาย: HTML Preview กับ PDF Preview มีหน้าตาใกล้เคียงกันที่สุด
 *   5. ไม่แสดง Automatic Header (โลโก้/ชื่อเอกสาร/วันที่สมัคร/ตำแหน่ง)
 *      → ทั้ง Compact และ Fullscreen แสดงเฉพาะ Blocks ใน Descriptor
 *   6. Token resolve ไม่ได้ → placeholder สีเทา (จัดการฝั่ง renderer)
 *   7. Table เป็น <table> จริง (rendered by server renderer)
 *   8. Right thumbnail = compact preview เดิม (ไม่เปลี่ยน PreviewPanel)
 *   9. Single source of truth: backend renderer ตัวเดียวกัน
 *       (consumer FE เปลี่ยนแค่ options = includeHeader)
 *  10. "ตรวจสอบข้อมูลเอกสาร" ซ่อนโดย default + ปุ่มเปิด
 *      - ปุ่มแสดงจำนวนที่ยังขาด: "ตรวจสอบข้อมูลเอกสาร: ยังขาด N"
 *      - สถานะ: "มีข้อมูลแล้ว" / "ยังไม่มีข้อมูล"
 *      - ไม่อยู่ใน PDF เด็ดขาด
 *      - ไม่ assert จำนวนตายตัว — รายการขึ้นกับ token ที่ descriptor ใช้จริง
 *  11. ESC + close button ปิด modal
 *  12. Responsive: จอเล็ก → scroll ภายใน modal ไม่บีบ
 *
 * Data Flow:
 *   ComposerClient ส่ง `descriptor` + `currentPreview` (cached, no header)
 *   → modal เรียก runPreview({ mode: 'document', includeHeader: true })
 *   → แต่ **ไม่ render** Automatic Header (ไม่ส่ง withHeader ให้ PreviewFrame)
 *   → ใช้ shared `PreviewFrame` (srcdoc) เพื่อ render HTML เดียวกัน
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type {
  DocumentDescriptor,
  PreviewResponse,
  PreviewMode,
  PreviewTokenInfo,
} from '@/lib/api/template-descriptor';
import { TOKEN_SOURCE_LABELS } from '@/lib/api/template-descriptor';
import { PreviewFrame } from './PreviewFrame';
import {
  PdfPreviewFrame,
  type PdfPreviewStatus,
} from './PdfPreviewFrame';

/**
 * 🔑 โหมดของ HTML Preview — เป็นเอกสารเสมอ
 *
 * Preview render field เป็น "ป้ายกำกับ + ค่า" เหมือน PDF
 * ไม่มีฟอร์ม (input / textarea / select / checkbox / radio) อยู่ใน preview
 * → จึงไม่ต้องมีตัวสลับโหมด Form ↔ Document ใน toolbar อีกต่อไป
 */
const PREVIEW_MODE: PreviewMode = 'document';

export interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Latest preview already fetched (thumbnail) — used as initial cache */
  currentPreview: PreviewResponse | null;
  /** Re-render with current descriptor + new mode/header */
  fetchPreview: (options: { mode: PreviewMode; includeHeader: true }, applicationId?: string) => Promise<boolean>;
  /** True while a preview fetch is in flight */
  loading: boolean;
  /** Data source mode for diagnostics */
  dataSource?: 'sample' | 'real';
  /** Current selected application for display */
  selectedApplication?: { id?: string; applicationNo: string; fullname: string } | null;
  /** ── สำหรับโหมด PDF Preview (source of truth เรื่องการแบ่งหน้า) ──────────── */
  /** Template version id → endpoint `/descriptor/pdf-preview` */
  templateVersionId?: string;
  /** Descriptor ปัจจุบัน (ยังไม่ save ก็ได้) */
  descriptor?: DocumentDescriptor | null;
}

export function PreviewModal({
  open,
  onClose,
  currentPreview,
  fetchPreview,
  loading,
  dataSource = 'sample',
  selectedApplication = null,
  templateVersionId,
  descriptor,
}: PreviewModalProps) {
  // ── diagnostics ซ่อนโดย default (Req 10) ──
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ── โหมด stage: 'html' = continuous HTML | 'pdf' = PDF จริง (source of truth) ──
  const [stageView, setStageView] = useState<'html' | 'pdf'>('html');

  // ── สถานะ PDF preview (จำนวนหน้าจริงจาก renderer) ──
  const [pdfStatus, setPdfStatus] = useState<PdfPreviewStatus>({ state: 'idle' });

  // ── preview state (HTML ที่จะ render ใน modal) ──
  const [modalPreview, setModalPreview] = useState<PreviewResponse | null>(
    currentPreview
  );

  // ── ref เพื่อกัน stale closure ──
  const fetchPreviewRef = useRef(fetchPreview);
  const dataSourceRef = useRef(dataSource);
  const selectedApplicationRef = useRef(selectedApplication);
  /** ref ของ stage (ช่องที่ scroll เอกสาร) */
  const stageRef = useRef<HTMLDivElement | null>(null);

  /**
   * เลื่อน stage กลับด้านบน
   *
   * ⚠️ ห้ามล้าง descriptor / applicationId / pageSettings — มีแค่ scroll เท่านั้น
   */
  const resetStageScroll = useCallback(() => {
    const el = stageRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    fetchPreviewRef.current = fetchPreview;
  }, [fetchPreview]);
  useEffect(() => {
    dataSourceRef.current = dataSource;
  }, [dataSource]);
  useEffect(() => {
    selectedApplicationRef.current = selectedApplication;
  }, [selectedApplication]);

  // Get applicationId from selectedApplication
  const applicationId = selectedApplication?.id ?? undefined;

  // ── เมื่อ modal เปิด → fetch preview ครั้งแรก ─────────────────────
  useEffect(() => {
    if (!open) {
      // ปิด modal → reset state ให้พร้อม re-open
      setModalPreview(currentPreview);
      setShowDiagnostics(false);
      setStageView('html');
      return;
    }

    let cancelled = false;
    // 🔑 Preview เป็นเอกสารเสมอ → ขอ mode: 'document' (ไม่มี form control)
    (async () => {
      const ok = await fetchPreviewRef.current(
        { mode: PREVIEW_MODE, includeHeader: true },
        applicationId
      );
      if (cancelled) return;
      // ใช้ cached currentPreview ที่เพิ่ง refresh
      if (ok) {
        setModalPreview((prev) => prev ?? currentPreview);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicationId]);

  // ── sync modalPreview กับ currentPreview ที่ hook refresh แล้ว ────
  useEffect(() => {
    if (!open) return;
    if (currentPreview && currentPreview.header.length > 0) {
      setModalPreview(currentPreview);
    }
  }, [currentPreview, open]);

  /**
   * ── Scroll reset เมื่อเนื้อหา preview เปลี่ยน ────────────────────────────
   *
   * Root cause (UAT): เมื่อสลับ Form ↔ Document/PDF หรือ re-render
   *   → stage คง scrollTop เดิม → preview "เปิดค้าง" ที่กลางเอกสาร
   *   → ผู้ใช้มองไม่เห็นว่าเนื้อหาช่วงบนหายไปหรืออยู่
   *
   * แก้โดยเลื่อน stage กลับด้านบนทุกครั้งที่ body เปลี่ยน
   *   ⚠️ ห้ามล้าง descriptor / applicationId / pageSettings
   */
  useEffect(() => {
    if (!open) return;
    resetStageScroll();
  }, [open, modalPreview?.body, resetStageScroll]);

  // ── ESC key (Req 11) ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── body scroll lock ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

// ── diagnostics entries (memo) ──────────────────────────────────
const tokensByMode: PreviewTokenInfo[] = useMemo(
    () => modalPreview?.tokens ?? [],
    [modalPreview]
  );

  /**
   * จำนวน token ที่**ยังไม่มีข้อมูลจริง** (Requirement I.12)
   *
   * ปุ่มแสดง "ตรวจสอบข้อมูลเอกสาร: ยังขาด N"
   * → นับเฉพาะ `empty === true` (ยังไม่มีข้อมูล)
   */
  const missingCount = useMemo(
    () => tokensByMode.filter((t) => t.empty).length,
    [tokensByMode]
  );

  if (!open) return null;

  const isReady = modalPreview !== null && !loading;
  const showDiagnosticsPanel = showDiagnostics && isReady;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal container — ใช้ flex column เพื่อแยก toolbar/stage/diagnostics */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Document preview"
        className="relative z-10 flex flex-col bg-slate-100 rounded-lg shadow-2xl ring-1 ring-slate-200 overflow-hidden max-w-[95vw] max-h-[95vh] w-[1100px] h-[95vh]"
      >
        {/* ── Toolbar ───────────────────────────────────────────── */}
        <Toolbar
          stageView={stageView}
          onStageViewChange={setStageView}
          showDiagnostics={showDiagnostics}
          onToggleDiagnostics={() => setShowDiagnostics((s) => !s)}
          loading={loading}
          onClose={onClose}
          missingCount={missingCount}
          pdfStatus={pdfStatus}
        />

        {/* ── Stage ─────────────────────────────────────────────── */}
        {stageView === 'pdf' ? (
          /*
           * 🔑 PDF Preview — source of truth เรื่องการแบ่งหน้า
           *    เรียก PDF Renderer ตัวเดียวกับ export ผ่าน PdfPreviewFrame
           */
          <div className="flex-1 min-h-0 px-3 py-2 bg-slate-200">
            <PdfPreviewFrame
              className="rounded bg-white overflow-hidden"
              templateVersionId={templateVersionId}
              descriptor={descriptor}
              applicationId={applicationId}
              onStatusChange={setPdfStatus}
            />
          </div>
        ) : (
          /* Continuous HTML preview — โตตามเนื้อหา ไม่แบ่งหน้าในเบราว์เซอร์ */
          <div
            ref={stageRef}
            className="flex-1 overflow-y-auto overflow-x-auto px-6 py-6 grid place-items-start bg-slate-200"
          >
            {isReady && modalPreview ? (
              <A4Page preview={modalPreview} />
            ) : (
              <StageSkeleton loading={loading} />
            )}
          </div>
        )}

        {/* ── Diagnostics strip (ท้าย modal, ซ่อนโดย default) ── */}
        {showDiagnosticsPanel && (
          <DiagnosticsPanel tokens={tokensByMode} dataSource={dataSource} />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Toolbar
// =============================================================================

interface ToolbarProps {
  /** โหมด stage: 'html' = continuous HTML | 'pdf' = PDF จริง */
  stageView: 'html' | 'pdf';
  onStageViewChange: (v: 'html' | 'pdf') => void;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  loading: boolean;
  onClose: () => void;
  /** จำนวน token ที่ยังไม่มีข้อมูลจริง */
  missingCount: number;
  /** สถานะ PDF preview (จำนวนหน้าจริงจาก renderer) */
  pdfStatus: PdfPreviewStatus;
}

function Toolbar({
  stageView,
  onStageViewChange,
  showDiagnostics,
  onToggleDiagnostics,
  loading,
  onClose,
  missingCount,
  pdfStatus,
}: ToolbarProps) {
  const pdfPageCount = pdfStatus.state === 'ready' ? pdfStatus.pageCount : 0;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-slate-700">📄 Preview</span>
        <span className="text-[11px] text-slate-400 truncate">
          Document Composer
        </span>
        {/* จำนวนหน้าจริง — มาจาก PDF renderer เท่านั้น */}
        {stageView === 'pdf' && pdfPageCount > 0 && (
          <span
            data-testid="modal-page-count"
            className="text-[11px] text-slate-500 shrink-0"
          >
            {pdfPageCount} หน้า (PDF จริง)
          </span>
        )}
        {loading && stageView === 'html' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-medium">
            <Spinner /> กำลัง render…
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Stage view toggle — PDF จริง = source of truth การแบ่งหน้า */}
        <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
          <ModeButton
            label="ต่อเนื่อง"
            icon="↕"
            active={stageView === 'html'}
            onClick={() => onStageViewChange('html')}
          />
          <ModeButton
            label="PDF จริง"
            icon="📄"
            active={stageView === 'pdf'}
            onClick={() => onStageViewChange('pdf')}
          />
        </div>

        {/* 🔑 ไม่มี Form/Document toggle แล้ว — HTML Preview เป็นเอกสารเสมอ
            (ไม่มี form control) ส่วนการแบ่งหน้าจริงดูจาก PDF จริง ด้านบน */}

        {/* Diagnostics toggle */}
        <button
          type="button"
          onClick={onToggleDiagnostics}
          className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
            showDiagnostics
              ? 'bg-amber-100 border-amber-300 text-amber-800'
              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
          title="แสดง/ซ่อนรายการตรวจสอบข้อมูลเอกสาร"
          aria-expanded={showDiagnostics}
        >
          {showDiagnostics ? '🔍' : '🔎'} ตรวจสอบข้อมูลเอกสาร
          {missingCount > 0 ? (
            <span className="ml-1 text-[10px] font-medium text-amber-700">
              ยังขาด {missingCount}
            </span>
          ) : (
            <span className="ml-1 text-[10px] text-emerald-700">ครบแล้ว</span>
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded p-2 leading-none"
        >
          <span aria-hidden="true" className="text-base">✕</span>
        </button>
      </div>
    </div>
  );
}

function ModeButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-xs px-2.5 py-1 rounded transition-colors ${
        active
          ? 'bg-white text-slate-900 shadow-sm font-medium'
          : 'text-slate-500 hover:text-slate-700'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className="mr-1">{icon}</span>
      {label}
    </button>
  );
}

// =============================================================================
// A4 Page
// =============================================================================

/**
 * A4 sheet 210×297mm (แบบ CONTINUOUS)
 *
 * ⚠️ เปลี่ยนแนวทาง 2026-10-22: ตัด browser pagination ออก
 *   - ไม่แบ่งหน้าในเบราว์เซอร์ / ไม่มีการวัดความสูง
 *   - ความสูงขึ้นตามเนื้อหา (ไม่ fix เป็น 297mm)
 *   - คงขนาด A4 (210mm) + พื้นหลัง/เงาเหมือนเอกสารจริง
 *   - ใช้ PreviewFrame (srcdoc) เพื่อแชร์ renderer ตัวเดียวกับ thumbnail
 *
 * ⚠️ ไม่ส่ง withHeader → ไม่แสดง Automatic Header
 *    (โลโก้/ยังไม่มีโลโก้, ชื่อเอกสาร "Document", วันที่สมัคร, {POSITION_NAME})
 *    ทั้ง Compact และ Fullscreen แสดงเฉพาะ Blocks ที่อยู่ใน Descriptor
 *    (page box .dc-page + padding จาก Page Settings อยู่ใน PreviewFrame)
 */
function A4Page({ preview }: { preview: PreviewResponse }) {
  return (
    <div className="dc-a4-sheet">
      <PreviewFrame preview={preview} className="w-full" />
    </div>
  );
}

// =============================================================================
// Stage skeleton (loading)
// =============================================================================

function StageSkeleton({ loading }: { loading: boolean }) {
  return (
    <div className="dc-a4-sheet animate-pulse">
      <div className="h-full bg-white rounded shadow-md flex items-center justify-center">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Spinner />
            <span>กำลัง render preview...</span>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">ยังไม่มี preview</div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Diagnostics Panel — "ตรวจสอบข้อมูลเอกสาร"
// =============================================================================

/**
 * แผงตรวจสอบข้อมูลเอกสาร (เดิมชื่อ "Token Diagnostics")
 *
 * Requirement I.12:
 *   - ซ่อนเป็นค่าเริ่มต้น (คุมที่ parent)
 *   - **ไม่อยู่ใน PDF** — เป็น debug strip ของ UI เท่านั้น
 *   - ห้าม assert จำนวนตายตัว → รายการขึ้นกับ token ที่ descriptor ใช้จริง
 *
 * ── ไม่ใช้ข้อมูลคนละความหมายทดแทน ────────────────────────────────────────
 * token ที่ยังไม่มีข้อมูลจะแสดงเป็น placeholder เสมอ ไม่ใช้ค่าอื่นมาแทน
 * (Requirement K.10)
 */
function DiagnosticsPanel({ tokens, dataSource = 'sample' }: { tokens: PreviewTokenInfo[]; dataSource?: 'sample' | 'real' }) {
  if (tokens.length === 0) return null;

  const ready = tokens.filter((t) => !t.empty).length;
  const needsCheck = tokens.filter((t) => t.empty).length;

  const dataSourceLabel =
    dataSource === 'sample'
      ? 'ข้อมูลตัวอย่าง'
      : 'ข้อมูลผู้สมัครจริง';

  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 shrink-0 max-h-[30vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700">
          🛠 ตรวจสอบข้อมูลที่จะใช้ในเอกสาร
        </span>
        <span className="text-[10px] text-slate-500">
          {needsCheck > 0
            ? `พร้อมใช้งาน ${ready} รายการ · ต้องตรวจสอบ ${needsCheck} รายการ`
            : `พร้อมใช้งาน ${ready} รายการ`}
        </span>
      </div>

      {/* Data source summary */}
      <div className="mb-2 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-[11px]">
        <span className="text-slate-600">แหล่งข้อมูล: </span>
        <span className={`font-medium ${dataSource === 'sample' ? 'text-slate-600' : 'text-blue-700'}`}>
          {dataSourceLabel}
        </span>
      </div>

      {/* Table: ข้อมูล | ค่าที่จะแสดง | แหล่งที่มา | สถานะ */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-3 font-medium">ข้อมูล</th>
            <th className="py-1 pr-3 font-medium">ค่าที่จะแสดง</th>
            <th className="py-1 pr-3 font-medium">แหล่งที่มา</th>
            <th className="py-1 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const sourceLabel = t.source
              ? TOKEN_SOURCE_LABELS[t.source]
              : 'ไม่ระบุ';
            const isEmpty = t.empty;
            const statusBadge = isEmpty
              ? { text: 'ต้องตรวจสอบ', className: 'bg-amber-100 text-amber-700' }
              : { text: 'พร้อมใช้งาน', className: 'bg-emerald-100 text-emerald-700' };

            return (
              <tr key={t.token} className="border-t border-slate-200">
                <td className="py-1 pr-3 text-slate-700">{t.label}</td>
                <td className="py-1 pr-3">
                  {t.empty ? (
                    <span className="text-slate-400 italic">{t.text}</span>
                  ) : (
                    <span className="text-slate-900">{t.text}</span>
                  )}
                </td>
                <td className="py-1 pr-3 text-slate-500 text-[11px]">{sourceLabel}</td>
                <td className="py-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadge.className}`}>
                    {statusBadge.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Technical details collapsible */}
      <details className="mt-2">
        <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-700">
          รายละเอียดทางเทคนิค
        </summary>
        <div className="mt-1 pt-1 border-t border-slate-200">
          <table className="w-full text-[10px] text-slate-400">
            <tbody>
              {tokens.map((t) => (
                <tr key={`tech-${t.token}`} className="border-t border-slate-100">
                  <td className="py-0.5 pr-2 font-mono">{`{${t.token}}`}</td>
                  <td className="py-0.5 pr-2 text-slate-500">{t.text}</td>
                  <td className="py-0.5 pr-2">{t.empty ? '(ว่าง)' : '(มีค่า)'}</td>
                  <td className="py-0.5">{t.source ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
        แผงนี้ใช้ตรวจสอบเฉพาะในหน้าจอจัดหน้าเอกสาร
        <strong>ไม่ถูกพิมพ์ลง PDF</strong> และไม่ใช้ข้อมูลคนละความหมายทดแทน
      </p>
    </div>
  );
}

// =============================================================================
// Spinner (local — กัน import cycle กับ PreviewPanel)
// =============================================================================

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
