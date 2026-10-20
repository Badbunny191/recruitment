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
 *  10. Diagnostics ซ่อนโดย default + ปุ่มเปิด
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
import { PreviewFrame } from './PreviewFrame';

export interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Latest preview already fetched (thumbnail) — used as initial cache */
  currentPreview: PreviewResponse | null;
  /** Re-render with current descriptor + new mode/header */
  fetchPreview: (options: { mode: PreviewMode; includeHeader: true }) => Promise<boolean>;
  /** True while a preview fetch is in flight */
  loading: boolean;
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
  useEffect(() => {
    fetchPreviewRef.current = fetchPreview;
  }, [fetchPreview]);

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
      const ok = await fetchPreviewRef.current({
        mode: initialMode,
        includeHeader: true,
      });
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
  }, [open]);

  // ── เมื่อ mode เปลี่ยน → refetch (option: header) ─────────────────
  // ไม่ต้องรอเปลี่ยน mode ให้ cache เดียวกัน — header ก็ true ตลอด
  const handleModeChange = useCallback(
    async (next: PreviewMode) => {
      setMode(next);
      await fetchPreviewRef.current({ mode: next, includeHeader: true });
      // เพิ่มความแน่ใจว่า modalPreview เป็นของ mode ใหม่
      // (จริง ๆ hook จะ setPreviewResult ให้ consumer อ่านผ่าน prop `currentPreview`
      //  แต่เพื่อกัน race เราเก็บ snapshot ไว้ใน local state ผ่าน useEffect ต่อไป)
    },
    []
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
          <DiagnosticsPanel tokens={tokensByMode} />
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
}

function Toolbar({
  mode,
  onModeChange,
  showDiagnostics,
  onToggleDiagnostics,
  loading,
  onClose,
  tokensCount,
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
          title="แสดง/ซ่อน token diagnostics"
        >
          {showDiagnostics ? '🔍' : '🔎'} Diagnostics
          {tokensCount > 0 && (
            <span className="ml-1 text-[10px] text-slate-500">
              ({tokensCount})
            </span>
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
// Diagnostics Panel
// =============================================================================

function DiagnosticsPanel({ tokens }: { tokens: PreviewTokenInfo[] }) {
  if (tokens.length === 0) return null;
  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 shrink-0 max-h-[30vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700">
          🛠 Token Diagnostics
        </span>
        <span className="text-[10px] text-slate-500">
          ห้ามใช้ข้อมูลคนละความหมายทดแทน — token ว่างต้องแสดงเป็น placeholder
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-3 font-medium">Token</th>
            <th className="py-1 pr-3 font-medium">Label</th>
            <th className="py-1 pr-3 font-medium">Value</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.token} className="border-t border-slate-200">
              <td className="py-1 pr-3 font-mono text-[10px] text-slate-700">
                {`{${t.token}}`}
              </td>
              <td className="py-1 pr-3 text-slate-700">{t.label}</td>
              <td className="py-1 pr-3">
                {t.empty ? (
                  <span className="text-slate-400 italic">{t.text}</span>
                ) : (
                  <span className="text-slate-900">{t.text}</span>
                )}
              </td>
              <td className="py-1">
                {t.empty ? (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-medium">
                    PLACEHOLDER
                  </span>
                ) : (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                    RESOLVED
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
