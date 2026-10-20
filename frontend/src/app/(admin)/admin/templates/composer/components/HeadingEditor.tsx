'use client';

/**
 * HeadingEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Heading / Text Block
 *
 * แก้ไขได้ (Requirement A):
 *   - text         → **textarea** หลายบรรทัด + ข้อความผสม token
 *   - size         → small | medium | large
 *   - bold         → ตัวหนา
 *   - italic       → ตัวเอียง
 *   - align        → ซ้าย | กลาง | ขวา
 *   - marginTop / marginBottom → ระยะห่าง (pt)
 *
 * ปุ่ม "แทรกข้อมูล" (InsertDataMenu) แทรก token ณ ตำแหน่งเคอร์เซอร์จริง
 *
 * ใช้ callback แทน state — parent ถือ source of truth (DocumentDescriptor)
 */

import { useRef } from 'react';
import { Label } from '@/components/ui/label';
import type { HeadingBlock } from '@/lib/api/template-descriptor';
import { InsertDataMenu } from './InsertDataMenu';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface HeadingEditorProps {
  block: HeadingBlock;
  onChange: (patch: Partial<HeadingBlock>) => void;
  /** Application Fields ปัจจุบัน — ใช้ในเมนู "แทรกข้อมูล" */
  fields?: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  disabled?: boolean;
}

const SIZE_OPTIONS: Array<{ value: HeadingBlock['size']; label: string }> = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'กลาง' },
  { value: 'large', label: 'ใหญ่' },
];

const ALIGN_OPTIONS: Array<{
  value: NonNullable<HeadingBlock['align']>;
  label: string;
  icon: string;
}> = [
  { value: 'left', label: 'ซ้าย', icon: '⬅' },
  { value: 'center', label: 'กลาง', icon: '⏺' },
  { value: 'right', label: 'ขวา', icon: '➡' },
];

export function HeadingEditor({
  block,
  onChange,
  fields = [],
  fieldsLoading,
  disabled,
}: HeadingEditorProps) {
  // ref ของ textarea → ให้ InsertDataMenu อ่าน selectionStart
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="space-y-2.5 p-3 bg-slate-50 rounded border border-slate-200">
      {/* ── ข้อความ (หลายบรรทัด + ผสม token) ─────────────────────── */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] text-slate-600">
            ข้อความ (รองรับหลายบรรทัด)
          </Label>
          <InsertDataMenu
            textareaRef={textareaRef}
            value={block.text}
            onChange={(text) => onChange({ text })}
            fields={fields}
            fieldsLoading={fieldsLoading}
            disabled={disabled}
          />
        </div>

        <textarea
          ref={textareaRef}
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          rows={4}
          placeholder={'เช่น ใบสมัครรอบ {ROUND_NAME}\nชื่อ-นามสกุล {FIELD:<fieldId>}'}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-y"
        />
        <p className="text-[10px] text-slate-500 leading-relaxed">
          token ที่ระบบยังไม่มีข้อมูลจะแสดงเป็น <code>{'{TOKEN_NAME}'}</code>{' '}
          สีเทาใน Preview และ PDF (ไม่ถูกลบทิ้ง)
        </p>
      </div>

      {/* ── ขนาด + Alignment ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">ขนาด</Label>
          <select
            value={block.size}
            disabled={disabled}
            onChange={(e) =>
              onChange({ size: e.target.value as HeadingBlock['size'] })
            }
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">Alignment</Label>
          <div className="flex gap-1">
            {ALIGN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ align: opt.value })}
                className={`flex-1 h-8 text-xs rounded border transition-colors disabled:opacity-50 ${
                  (block.align ?? 'left') === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
                title={opt.label}
                aria-label={`จัดตำแหน่ง${opt.label}`}
              >
                {opt.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── ตัวหนา / ตัวเอียง ─────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={block.bold ?? false}
            disabled={disabled}
            onChange={(e) => onChange({ bold: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
          />
          <span>ตัวหนา (Bold)</span>
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={block.italic ?? false}
            disabled={disabled}
            onChange={(e) => onChange({ italic: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
          />
          <span>ตัวเอียง (Italic)</span>
        </label>
      </div>

      {/* ── ระยะห่าง ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <NumberRow
          label="ระยะห่างบน (pt)"
          value={block.marginTop}
          onChange={(marginTop) => onChange({ marginTop })}
          disabled={disabled}
        />
        <NumberRow
          label="ระยะห่างล่าง (pt)"
          value={block.marginBottom}
          onChange={(marginBottom) => onChange({ marginBottom })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function NumberRow({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max = 200,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-slate-600">{label}</Label>
      <input
        type="number"
        value={value ?? 0}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          // clamp กันค่าเพี้ยนที่จะทำให้ PDF พัง
          onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  tone = 'slate',
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tone?: 'slate' | 'rose';
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 rounded border-slate-300 disabled:opacity-50 ${
          tone === 'rose' ? 'focus:ring-rose-500' : 'focus:ring-blue-500'
        }`}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-slate-800 leading-tight">
          {label}
        </span>
        {hint && (
          <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function AlignRow({
  align,
  onChange,
  disabled,
}: {
  align: 'left' | 'center' | 'right';
  onChange: (align: 'left' | 'center' | 'right') => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {ALIGN_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 h-8 text-xs rounded border transition-colors disabled:opacity-50 ${
            align === opt.value
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
          }`}
          title={opt.label}
          aria-label={`จัดตำแหน่ง${opt.label}`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}

export { SIZE_OPTIONS, ALIGN_OPTIONS };