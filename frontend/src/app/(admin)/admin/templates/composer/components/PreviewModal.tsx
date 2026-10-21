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
 *   4. Mode toggle: Form ↔ Document/PDF
 *   5. Header ครบ: logo (หรือ "ยังไม่มีโลโก้") + title + appno + position
 *   6. Token resolve ไม่ได้ → placeholder สีเทา (จัดการฝั่ง renderer)
 *   7. Table เป็น <table> จริง (rendered by server renderer)
 *   8. Right thumbnail = compact preview เดิม (ไม่เปลี่ยน PreviewPanel)
 *   9. Single source of truth: backend renderer ตัวเดียวกัน
 *       (consumer FE เปลี่ยนแค่ options = mode + includeHeader)
 *  10. "ตรวจสอบข้อมูลเอกสาร" ซ่อนโดย default + ปุ่มเปิด
 *      - ปุ่มแสดงจำนวนที่ยังขาด: "ตรวจสอบข้อมูลเอกสาร: ยังขาด N"
 *      - สถานะ: "มีข้อมูลแล้ว" / "ยังไม่มีข้อมูล"
 *      - ไม่อยู่ใน PDF เด็ดขาด
 *      - ไม่ assert จำนวนตายตัว — รายการขึ้นกับ token ที่ descriptor ใช้จริง
 *  11. ESC + close button ปิด modal
 *  12. Responsive: จอเล็ก → scroll ภายใน modal ไม่บีบ
 *
 * Data Flow:
 *   ComposerClient ส่ง `descriptor` + `currentPreview` (cached, mode=form, no header)
 *   → modal เรียก runPreview({ mode, includeHeader: true }) ทุกครั้งที่ mode เปลี่ยน
 *   → ใช้ shared `PreviewFrame` (srcdoc) เพื่อ render HTML เดียวกัน
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type {
  PreviewResponse,
  PreviewMode,
  PreviewTokenInfo,
} from '@/lib/api/template-descriptor';
import { TOKEN_SOURCE_LABELS } from '@/lib/api/template-descriptor';
import { PreviewFrame } from './PreviewFrame';

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
  /**
   * Block mode control until first frame is ready.
   * (ปุ่ม mode จะถูก disable ถ้า modal เพิ่งเปิด + fetch ยังไม่เสร็จ)
   */
}

export function PreviewModal({
  open,
  onClose,
  currentPreview,
  fetchPreview,
  loading,
  dataSource = 'sample',
  selectedApplication = null,
}: PreviewModalProps) {
  // ── mode state (default = 'form' ตามที่ผู้ใช้คุ้นเคยจาก compact) ──
  const [mode, setMode] = useState<PreviewMode>(currentPreview?.mode ?? 'form');

  // ── diagnostics ซ่อนโดย default (Req 10) ──
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ── preview state (HTML ที่จะ render ใน modal) ──
  const [modalPreview, setModalPreview] = useState<PreviewResponse | null>(
    currentPreview
  );

  // ── ref เพื่อกัน stale closure ──
  const fetchPreviewRef = useRef(fetchPreview);
  const dataSourceRef = useRef(dataSource);
  const selectedApplicationRef = useRef(selectedApplication);
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
      return;
    }

    let cancelled = false;
    // initial fetch (mode default = form, header = true)
    const initialMode: PreviewMode = currentPreview?.mode ?? 'form';
    setMode(initialMode);
    (async () => {
      const ok = await fetchPreviewRef.current(
        { mode: initialMode, includeHeader: true },
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

  // ── เมื่อ mode เปลี่ยน → refetch (option: header) ─────────────────
  const handleModeChange = useCallback(
    async (next: PreviewMode) => {
      setMode(next);
      await fetchPreviewRef.current(
        { mode: next, includeHeader: true },
        applicationId
      );
    },
    [applicationId]
  );

  // ── sync modalPreview กับ currentPreview ที่ hook refresh แล้ว ────
  useEffect(() => {
    if (!open) return;
    if (
      currentPreview &&
      currentPreview.mode === mode &&
      currentPreview.header.length > 0
    ) {
      setModalPreview(currentPreview);
    }
  }, [currentPreview, mode, open]);

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
        className="relative z-10 flex flex-col bg-slate-100 rounded-lg shadow-2xl ring-1 ring-slate-200 overflow-hidden max-w-[95vw] max-h-[95vh] w-[1100px] h-[820px]"
      >
        {/* ── Toolbar ───────────────────────────────────────────── */}
        <Toolbar
          mode={mode}
          onModeChange={handleModeChange}
          showDiagnostics={showDiagnostics}
          onToggleDiagnostics={() => setShowDiagnostics((s) => !s)}
          loading={loading}
          onClose={onClose}
          tokensCount={tokensByMode.length}
          missingCount={missingCount}
        />

        {/* ── Stage (A4 paper) ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-auto px-6 py-6 grid place-items-center bg-slate-200">
          {isReady && modalPreview ? (
            <A4Page preview={modalPreview} />
          ) : (
            <StageSkeleton loading={loading} />
          )}
        </div>

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
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void | Promise<void>;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  loading: boolean;
  onClose: () => void;
  tokensCount: number;
  /** จำนวน token ที่ยังไม่มีข้อมูลจริง */
  missingCount: number;
}

function Toolbar({
  mode,
  onModeChange,
  showDiagnostics,
  onToggleDiagnostics,
  loading,
  onClose,
  tokensCount,
  missingCount,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-slate-700">📄 Preview</span>
        <span className="text-[11px] text-slate-400 truncate">
          A4 Document Composer
        </span>
        {loading && (
          <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-medium">
            <Spinner /> กำลัง render…
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Mode toggle */}
        <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
          <ModeButton
            label="Form"
            icon="📝"
            active={mode === 'form'}
            disabled={loading}
            onClick={() => onModeChange('form')}
          />
          <ModeButton
            label="Document / PDF"
            icon="📄"
            active={mode === 'document'}
            disabled={loading}
            onClick={() => onModeChange('document')}
          />
        </div>

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
 * A4 sheet 210×297mm
 * - ใช้ fixed mm dimensions ผ่าน CSS class .dc-a4-sheet
 * - เงา + ขอบกระดาษ + padding เหมือนเอกสารจริง
 * - ใช้ PreviewFrame (srcdoc) เพื่อแชร์ renderer ตัวเดียวกับ thumbnail
 */
function A4Page({ preview }: { preview: PreviewResponse }) {
  return (
    <div className="dc-a4-sheet">
      <PreviewFrame preview={preview} />
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
