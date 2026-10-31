'use client';

/**
 * SignatureEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Signature Block — ส่วนจัดหน้าลายมือชื่อ / วันที่
 *
 * UX Improvement:
 *   - จัด UI ใหม่ให้กระชับ เตี้ย ใช้งานง่ายเหมือน Field Block
 *   - ส่วนที่ใช้บ่อยแสดงปกติ: Font Size, Alignment, Show Name, Show Date, Show Time
 *   - ยุบตัวเลือกขั้นสูงเข้า Collapse: lineLabel, lineStyle, roleLabel, dateLabel, dateSource
 */

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  type SignatureBlock,
  type SignatureDateSource,
  type Size,
} from '@/lib/api/template-descriptor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface SignatureEditorProps {
  block: SignatureBlock;
  onChange: (patch: Partial<SignatureBlock>) => void;
  /** Application Fields ปัจจุบัน — ใช้เลือก nameFieldId */
  fields?: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  disabled?: boolean;
}

const SIZE_OPTIONS: Array<{ value: Size; label: string }> = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'กลาง' },
  { value: 'large', label: 'ใหญ่' },
];

const ALIGN_OPTIONS: Array<{
  value: NonNullable<SignatureBlock['align']>;
  label: string;
  icon: string;
}> = [
  { value: 'left', label: 'ซ้าย', icon: '⬅' },
  { value: 'center', label: 'กลาง', icon: '⏺' },
  { value: 'right', label: 'ขวา', icon: '➡' },
];

/**
 * Normalize `dateSource` — descriptor เก่าอาจเก็บค่า legacy `"application"`
 * ซึ่ง backend map เป็น APPLICATION_DATE
 */
export function normalizeDateSource(
  raw: SignatureBlock['dateSource']
): SignatureDateSource {
  return raw === 'PRINT_DATE' || raw === 'none' ? raw : 'APPLICATION_DATE';
}

export function SignatureEditor({
  block,
  onChange,
  fields = [],
  fieldsLoading,
  disabled,
}: SignatureEditorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dateSource = normalizeDateSource(block.dateSource);
  const showName = block.showName ?? true;
  const showDate = block.showDate ?? true;
  const showTime = block.showTime ?? false;

  return (
    <div className="space-y-2 p-2.5 bg-rose-50/40 rounded border border-rose-200">
      {/* ── ส่วนที่ใช้บ่อย: ขนาดตัวอักษร + Alignment ─────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600 font-medium">ขนาดตัวอักษร</Label>
          <div className="flex gap-1">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ size: opt.value })}
                className={`flex-1 h-7 text-xs rounded border transition-colors disabled:opacity-50 ${
                  (block.size ?? 'medium') === opt.value
                    ? 'bg-rose-600 text-white border-rose-600 font-medium'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600 font-medium">ตำแหน่ง (Alignment)</Label>
          <div className="flex gap-1">
            {ALIGN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ align: opt.value })}
                className={`flex-1 h-7 text-xs rounded border transition-colors disabled:opacity-50 ${
                  (block.align ?? 'center') === opt.value
                    ? 'bg-rose-600 text-white border-rose-600 font-medium'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
                title={opt.label}
              >
                {opt.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── ส่วนที่ใช้บ่อย: การแสดงชื่อ + แสดงวันที่ + แสดงเวลา ───────── */}
      <div className="flex items-center gap-4 pt-0.5">
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={showName}
            disabled={disabled}
            onChange={(e) => onChange({ showName: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
          />
          <span>แสดงชื่อผู้สมัคร</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={showDate}
            disabled={disabled}
            onChange={(e) => onChange({ showDate: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
          />
          <span>แสดงวันที่</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={showTime}
            disabled={disabled}
            onChange={(e) => onChange({ showTime: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
          />
          <span>แสดงเวลา</span>
        </label>
      </div>

      {/* ── ตัวเลือกขั้นสูง (Collapse) ─────────────────────────────── */}
      <div className="pt-1 border-t border-rose-200/60">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center justify-between w-full py-0.5 text-[10px] font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          <span>ตั้งค่าขั้นสูง (ข้อความ, เส้น, แหล่งวันที่)</span>
          <span className="text-slate-400 font-mono text-[9px]">
            {showAdvanced ? '▲ ซ่อน' : '▼ แก้ไข'}
          </span>
        </button>

        {showAdvanced && (
          <div className="space-y-2 pt-1.5 mt-1 border-t border-dashed border-rose-200">
            {/* lineLabel + roleLabel */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[9px] text-slate-600">ป้ายกำกับเส้น (lineLabel)</Label>
                <input
                  type="text"
                  value={block.lineLabel ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ lineLabel: e.target.value || undefined })
                  }
                  placeholder="ลงลายมือชื่อ"
                  className="flex h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                />
              </div>

              <div className="space-y-0.5">
                <Label className="text-[9px] text-slate-600">ป้ายกำกับบทบาท (roleLabel)</Label>
                <input
                  type="text"
                  value={block.roleLabel ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ roleLabel: e.target.value || undefined })
                  }
                  placeholder="ผู้สมัคร"
                  className="flex h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* lineStyle */}
            <div className="space-y-0.5">
              <Label className="text-[9px] text-slate-600">รูปแบบเส้น (lineStyle)</Label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={block.lineStyle ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ lineStyle: e.target.value || undefined })
                  }
                  placeholder="........................................"
                  className="flex h-7 flex-1 rounded border border-slate-300 bg-white px-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      lineStyle: '........................................',
                    })
                  }
                  className="h-7 px-2 text-[10px] rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50"
                  title="รีเซ็ตเป็นเส้นประมาณ 40 จุด"
                >
                  จุด
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange({ lineStyle: '________________________' })
                  }
                  className="h-7 px-2 text-[10px] rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50"
                  title="ใช้ขีดล่างแทนจุด"
                >
                  ขีด
                </button>
              </div>
            </div>

            {/* dateLabel + dateSource */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[9px] text-slate-600">ป้ายกำกับวันที่ (dateLabel)</Label>
                <input
                  type="text"
                  value={block.dateLabel ?? ''}
                  disabled={disabled || !showDate}
                  onChange={(e) =>
                    onChange({ dateLabel: e.target.value || undefined })
                  }
                  placeholder="วันที่"
                  className="flex h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                />
              </div>

              <div className="space-y-0.5">
                <Label className="text-[9px] text-slate-600">แหล่งข้อมูลวันที่ (dateSource)</Label>
                <select
                  value={dateSource}
                  disabled={disabled || !showDate}
                  onChange={(e) =>
                    onChange({
                      dateSource: e.target.value as SignatureDateSource,
                    })
                  }
                  className="flex h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                >
                  <option value="APPLICATION_DATE">วันที่สมัคร (ค่าเริ่มต้น)</option>
                  <option value="PRINT_DATE">วันที่พิมพ์</option>
                  <option value="none">ไม่แสดงวันที่</option>
                </select>
              </div>
            </div>

            {/* nameFieldId + showParentheses */}
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-0.5">
                <Label className="text-[9px] text-slate-600">ฟิลด์ชื่อผู้สมัคร (nameFieldId)</Label>
                <select
                  value={block.nameFieldId ?? ''}
                  disabled={disabled || fieldsLoading}
                  onChange={(e) =>
                    onChange({ nameFieldId: e.target.value || undefined })
                  }
                  className="flex h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
                >
                  <option value="">ใช้ชื่อจากใบสมัคร (อัตโนมัติ)</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.fieldId}>
                      {f.labelTh}
                      {f.fieldType ? ` (${f.fieldType})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer pb-1.5 text-[10px] text-slate-600 select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={block.showParentheses ?? true}
                  disabled={disabled || !showName}
                  onChange={(e) =>
                    onChange({ showParentheses: e.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
                />
                <span>ใส่วงเล็บ ( )</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SignatureEditor;
