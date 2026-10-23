'use client';

/**
 * FieldEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Field Block — ข้อมูลที่ผู้สมัครกรอกจริง
 *
 * ตั้งค่าได้ (Requirement E):
 *   - custom label     → ป้ายกำกับเฉพาะ block นี้ (ว่าง = ใช้ชื่อจาก Field Master)
 *   - showLabel        → ซ่อน/แสดงป้ายกำกับ
 *   - showRequired     → แสดงเครื่องหมาย " *" ของฟิลด์บังคับ
 *   - layout           → stacked (label บน / value ล่าง) | inline (บรรทัดเดียว)
 *   - alignment        → ซ้าย | กลาง | ขวา
 *   - spacing          → marginTop / marginBottom (pt)
 *   - valueStyle       → small | medium | large
 *
 * ── MASTER_DATA ค่าเดี่ยว ────────────────────────────────────────────────
 * "สังกัดปัจจุบัน" เป็น MASTER_DATA แบบ single-select ค่าเดียว
 * → แสดงเป็น display label จาก object ({ id, name })
 * **ห้าม** JSON.stringify และ**ห้าม**กลายเป็น Table (Requirement F)
 */

import { Label } from '@/components/ui/label';
import type { FieldBlock, Size } from '@/lib/api/template-descriptor';
import { AlignRow, NumberRow, ToggleRow } from './HeadingEditor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface FieldEditorProps {
  block: FieldBlock;
  onChange: (patch: Partial<FieldBlock>) => void;
  /** resolved field จาก Template Version (label/type/required) */
  field?: TemplateFieldLibraryItem;
  disabled?: boolean;
}

const SIZE_OPTIONS: Array<{ value: Size; label: string }> = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'กลาง' },
  { value: 'large', label: 'ใหญ่' },
];

export function FieldEditor({
  block,
  onChange,
  field,
  disabled,
}: FieldEditorProps) {
  const effectiveLabel = block.label || field?.labelTh || block.fieldId;
  const showLabel = block.showLabel ?? true;
  const showRequired = block.showRequired ?? true;

  return (
    <div className="space-y-2.5 p-3 bg-blue-50/50 rounded border border-blue-200">
      {/* ── field reference (read-only) ─────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">ฟิลด์ที่อ้างอิง</Label>
        <div className="flex items-center gap-2">
          <code className="block flex-1 text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 break-all font-mono">
            {block.fieldId}
          </code>
          {field?.isRequired && (
            <span className="text-[10px] text-red-600 font-medium shrink-0">
              บังคับ *
            </span>
          )}
        </div>
        {field ? (
          <p className="text-[10px] text-slate-500 mt-1">
            {field.labelTh}
            {field.fieldType ? ` · ${field.fieldType}` : ''}
          </p>
        ) : (
          <p className="text-[10px] text-amber-700 mt-1">
            ⚠️ ไม่พบฟิลด์นี้ใน Template Version — Preview/PDF จะข้าม block นี้
          </p>
        )}
        <p className="text-[10px] text-slate-500 mt-1">
          การเปลี่ยน fieldId ต้องลบ block นี้แล้วเพิ่มใหม่ผ่าน +Field
        </p>
      </div>

      {/* ── custom label + showLabel ────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            ป้ายกำกับเฉพาะ block นี้ (custom label)
          </Label>
          <input
            type="text"
            value={block.label ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ label: e.target.value || undefined })
            }
            placeholder={field?.labelTh ?? 'ปล่อยว่างเพื่อใช้ชื่อจาก Field Master'}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer pb-1.5 whitespace-nowrap">
          <input
            type="checkbox"
            checked={showLabel}
            disabled={disabled}
            onChange={(e) => onChange({ showLabel: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
          />
          <span>แสดงป้ายกำกับ</span>
        </label>
      </div>

      {/* ── showRequired ────────────────────────────────────────── */}
      {field?.isRequired && (
        <ToggleRow
          label='แสดงเครื่องหมาย " *" (showRequired)'
          hint='ฟิลด์นี้เป็นฟิลด์บังคับ — แสดง/ซ่อนเครื่องหมายได้'
          checked={showRequired}
          disabled={disabled || !showLabel}
          onChange={(showRequired) => onChange({ showRequired })}
        />
      )}

      {/* ── layout ──────────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">การจัดวาง label + ค่า</Label>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ layout: 'stacked' })}
            title="ป้ายกำกับบนบรรทัด ค่าอยู่บรรทัดถัดไป"
            className={`flex-1 h-8 text-xs rounded border transition-colors disabled:opacity-50 ${
              (block.layout ?? 'stacked') === 'stacked'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            stacked
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ layout: 'inline' })}
            title="ป้ายกำกับและค่าอยู่บรรทัดเดียวกัน"
            className={`flex-1 h-8 text-xs rounded border transition-colors disabled:opacity-50 ${
              (block.layout ?? 'stacked') === 'inline'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            inline
          </button>
        </div>
        <p className="text-[10px] text-slate-500 leading-tight">
          ตัวอย่าง:{' '}
          <span className="font-mono">
            {showLabel ? `${effectiveLabel}: ` : ''}
            {(block.layout ?? 'stacked') === 'inline' ? '___' : '(___ บรรทัดถัดไป)'}
          </span>
        </p>
      </div>

      {/* ── labelStyle / valueStyle ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">ขนาดป้ายกำกับ</Label>
          <select
            value={block.labelStyle ?? 'small'}
            disabled={disabled}
            onChange={(e) => onChange({ labelStyle: e.target.value as Size })}
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
          <Label className="text-[10px] text-slate-600">ขนาดตัวอักษรของค่า</Label>
          <select
            value={block.valueStyle ?? 'medium'}
            disabled={disabled}
            onChange={(e) => onChange({ valueStyle: e.target.value as Size })}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── alignment ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Alignment</Label>
        <AlignRow
          align={block.align ?? 'left'}
          onChange={(align) => onChange({ align })}
          disabled={disabled}
        />
      </div>

      {/* ── spacing ─────────────────────────────────────────────── */}
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

export default FieldEditor;