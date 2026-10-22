'use client';

/**
 * PageSettingsPanel
 * --------------------------------
 * Document Composer — UI "ตั้งค่าหน้ากระดาษ"
 *
 * ⚠️ ขอบเขต (สำคัญ — ห้ามลบข้อความนี้)
 *   - การตั้งค่านี้มีผลกับ **ตัวอย่างเอกสาร (Preview)** เท่านั้น
 *   - ส่วน PDF จะรองรับในก้อนถัดไป
 *
 * ── หน่วยวัด ─────────────────────────────────────────────────────────────
 *   - UI แสดงผลเป็น **มม.**
 *   - Descriptor เก็บค่าเป็น **pt**
 *
 * ── สิ่งที่ห้ามทำในไฟล์นี้ ────────────────────────────────────────────────
 *   - ห้ามแตะ Block selection / contextual insertion
 *   - ห้ามแตะ Workspace layout
 */

import { useCallback, useMemo, useState } from 'react';
import {
  MARGIN_SIDE_LABELS,
  PAGE_SETTINGS_DISCLAIMER,
  PRESET_LABELS,
  PRESET_MARGIN_PT,
  applyPreset,
  clampMarginPt,
  createDefaultPageSettings,
  marginInputToPt,
  marginPtToInput,
  normalizePreset,
  ptToMm,
  resetPageSettings,
  validateMarginInput,
  type MarginSide,
  type PageMarginPresetKey,
  type PageSettings,
} from '@/lib/api/page-settings';
import { cn } from '@/lib/utils';

/** ลำดับด้านที่แสดงใน UI */
const SIDES: MarginSide[] = ['top', 'right', 'bottom', 'left'];

export interface PageSettingsPanelProps {
  /** ค่าปัจจุบันใน descriptor (อาจ undefined = descriptor เก่า) */
  value?: PageSettings | null;
  /** เรียกเมื่อค่าเปลี่ยน (ได้รับค่าใหม่แบบ pt ทั้งชุด) */
  onChange: (next: PageSettings) => void;
  /** ปิดการแก้ไข (เช่นตอนกำลัง save) */
  disabled?: boolean;
}

/**
 * แปลงค่าที่เก็บไว้ → ค่าที่แสดงใน UI
 * - descriptor เก่าที่ไม่มี pageSettings → normal (40pt ทุกด้าน)
 */
function toUiState(value?: PageSettings | null): PageSettings {
  if (!value) return createDefaultPageSettings();
  const preset = normalizePreset(value.preset);
  return {
    preset,
    top: clampMarginPt(value.top),
    right: clampMarginPt(value.right),
    bottom: clampMarginPt(value.bottom),
    left: clampMarginPt(value.left),
  };
}

export function PageSettingsPanel({
  value,
  onChange,
  disabled = false,
}: PageSettingsPanelProps) {
  const current = useMemo(() => toUiState(value), [value]);

  // ค่าในช่อง input (mm) — แยกจาก descriptor เพื่อให้พิมพ์คร่าว ๆ ได้
  const [drafts, setDrafts] = useState<Record<MarginSide, string> | null>(null);

  const inputValue = useCallback(
    (side: MarginSide): string => {
      if (drafts) return drafts[side];
      return marginPtToInput(current[side]);
    },
    [drafts, current]
  );

  const handlePresetChange = useCallback(
    (preset: PageMarginPresetKey) => {
      setDrafts(null);
      onChange(applyPreset(preset, current));
    },
    [current, onChange]
  );

  const handleSideChange = useCallback(
    (side: MarginSide, raw: string) => {
      const nextDrafts: Record<MarginSide, string> = {
        top: inputValue('top'),
        right: inputValue('right'),
        bottom: inputValue('bottom'),
        left: inputValue('left'),
        [side]: raw,
      };
      setDrafts(nextDrafts);

      // ค่าเสีย → ยังไม่ commit (แสดง validation inline)
      const validation = validateMarginInput(raw);
      if (!validation.ok) return;

      onChange({
        ...current,
        preset: 'custom',
        [side]: marginInputToPt(raw),
      });
    },
    [current, inputValue, onChange]
  );

  const handleReset = useCallback(() => {
    setDrafts(null);
    onChange(resetPageSettings());
  }, [onChange]);

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-3 space-y-3"
      data-testid="page-settings-panel"
      aria-label="ตั้งค่าหน้ากระดาษ"
    >
      {/* ── หัวข้อ + ปุ่มรีเซ็ต ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span aria-hidden="true">📐</span>
          <span>ตั้งค่าหน้ากระดาษ</span>
        </h3>
        <button
          type="button"
          onClick={handleReset}
          disabled={disabled}
          className="text-[11px] px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="page-settings-reset"
        >
          คืนค่าเริ่มต้น
        </button>
      </div>

      {/* ── ข้อความเตือน (ห้ามลบ — ป้องกันผู้ใช้เข้าใจผิด) ── */}
      <p
        className="text-[11px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5"
        data-testid="page-settings-disclaimer"
      >
        {PAGE_SETTINGS_DISCLAIMER}
      </p>

      {/* ── ตัวเลือก preset ── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
        role="group"
        aria-label="เลือกรูปแบบขอบกระดาษ"
      >
        {(Object.keys(PRESET_LABELS) as PageMarginPresetKey[]).map(
          (preset) => {
            const active = current.preset === preset;
            const presetMargin =
              preset === 'custom' ? null : PRESET_MARGIN_PT[preset];
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetChange(preset)}
                disabled={disabled}
                aria-pressed={active}
                title={PRESET_LABELS[preset].hint}
                data-testid={`page-settings-preset-${preset}`}
                className={cn(
                  'text-[11px] px-2 py-1.5 rounded border transition-colors text-left',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  active
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                )}
              >
                <span className="block font-medium">
                  {PRESET_LABELS[preset].label}
                </span>
                {presetMargin !== null && (
                  <span
                    className={cn(
                      'block text-[10px]',
                      active ? 'text-blue-100' : 'text-slate-500'
                    )}
                  >
                    {ptToMm(presetMargin)} มม.
                  </span>
                )}
              </button>
            );
          }
        )}
      </div>

      {/* ── ช่องกรอกค่าต่อด้าน (แสดงเมื่อเลือก custom) ── */}
      {current.preset === 'custom' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SIDES.map((side) => {
            const validation = validateMarginInput(inputValue(side));
            return (
              <div key={side} className="space-y-0.5">
                <label
                  htmlFor={`page-margin-${side}`}
                  className="block text-[11px] text-slate-600"
                >
                  {MARGIN_SIDE_LABELS[side]} (มม.)
                </label>
                <input
                  id={`page-margin-${side}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0}
                  value={inputValue(side)}
                  disabled={disabled}
                  onChange={(e) => handleSideChange(side, e.target.value)}
                  data-testid={`page-settings-input-${side}`}
                  aria-invalid={!validation.ok}
                  className={cn(
                    'w-full text-xs px-2 py-1 rounded border font-mono',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    validation.ok
                      ? 'border-slate-300 text-slate-800'
                      : 'border-red-400 bg-red-50 text-red-800'
                  )}
                />
                {!validation.ok && validation.message && (
                  <p
                    className="text-[10px] text-red-600"
                    data-testid={`page-settings-error-${side}`}
                  >
                    {validation.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="text-[11px] text-slate-500"
          data-testid="page-settings-summary"
        >
          ขอบกระดาษ {ptToMm(current.top)} มม. ทุกด้าน — เลือก “กำหนดเอง”
          เพื่อปรับทีละด้าน
        </p>
      )}
    </section>
  );
}
