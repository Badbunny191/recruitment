'use client';

/**
 * HeadingEditor
 * --------------------------------
 * Document Composer V1 — Inline Heading Editor
 *
 * แก้ไข heading properties:
 *   - text (string)
 *   - size (small | medium | large)
 *   - bold (boolean)
 *   - align (left | center | right)
 *
 * ใช้ callback แทน state — parent ถือ source of truth (DocumentDescriptor)
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HeadingBlock } from '@/lib/api/template-descriptor';

export interface HeadingEditorProps {
  block: HeadingBlock;
  onChange: (patch: Partial<HeadingBlock>) => void;
}

const SIZE_OPTIONS: Array<{ value: HeadingBlock['size']; label: string }> = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'กลาง' },
  { value: 'large', label: 'ใหญ่' },
];

const ALIGN_OPTIONS: Array<{ value: NonNullable<HeadingBlock['align']>; label: string; icon: string }> = [
  { value: 'left', label: 'ซ้าย', icon: '⬅' },
  { value: 'center', label: 'กลาง', icon: '⏺' },
  { value: 'right', label: 'ขวา', icon: '➡' },
];

export function HeadingEditor({ block, onChange }: HeadingEditorProps) {
  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded border border-slate-200">
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">ข้อความ</Label>
        <Input
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="เช่น ข้อมูลผู้สมัคร"
          className="h-8 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">ขนาด</Label>
          <select
            value={block.size}
            onChange={(e) =>
              onChange({ size: e.target.value as HeadingBlock['size'] })
            }
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onClick={() => onChange({ align: opt.value })}
                className={`flex-1 h-8 text-xs rounded border transition-colors ${
                  block.align === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
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

      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={block.bold ?? false}
          onChange={(e) => onChange({ bold: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>ตัวหนา (Bold)</span>
      </label>
    </div>
  );
}