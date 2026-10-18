'use client';

/**
 * BlockItem
 * --------------------------------
 * Document Composer V1 — Single Block Card
 *
 * Render block 1 ตัวใน Block Panel พร้อม:
 *   - ▲ Move Up
 *   - ▼ Move Down
 *   - 🗑 Delete
 *   - ✏️ Edit (toggle inline editor)
 *
 * แต่ละประเภท block:
 *   - logo:     แสดง placeholder + ปุ่ม toggle align
 *   - heading:  HeadingEditor inline
 *   - field:    แสดง label (readonly)
 *   - table:    แสดง label + "(table)" (readonly)
 *
 * ใช้ callback ทั้งหมด — parent ถือ source of truth
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { HeadingEditor } from './HeadingEditor';
import type {
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
} from '@/lib/api/template-descriptor';

export interface BlockItemProps {
  block: DocumentBlock;
  index: number;
  total: number;
  fieldLabel?: string; // resolved label สำหรับ field/table block
  fieldType?: string;  // resolved type field
  onChange: (patch: Partial<DocumentBlock>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

const TYPE_META: Record<
  DocumentBlock['type'],
  { icon: string; label: string; tone: string }
> = {
  heading: { icon: '📝', label: 'Heading', tone: 'bg-purple-50 border-purple-200' },
  field: { icon: '📌', label: 'Field', tone: 'bg-blue-50 border-blue-200' },
  table: { icon: '📊', label: 'Table', tone: 'bg-emerald-50 border-emerald-200' },
  logo: { icon: '🖼️', label: 'Logo', tone: 'bg-amber-50 border-amber-200' },
};

export function BlockItem({
  block,
  index,
  total,
  fieldLabel,
  fieldType,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: BlockItemProps) {
  const [editing, setEditing] = useState(false);
  const meta = TYPE_META[block.type];

  return (
    <div className={`rounded-lg border ${meta.tone} overflow-hidden`}>
      {/* Header row: type + index + actions */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/70">
        <span className="text-base shrink-0">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-slate-500">
              {meta.label} #{index + 1}
            </span>
            {block.type === 'logo' && (
              <span className="text-[10px] text-slate-500">
                align: {(block as LogoBlock).align ?? 'left'}
              </span>
            )}
            {(block.type === 'field' || block.type === 'table') && fieldType && (
              <span className="text-[10px] text-slate-500">
                ({fieldType})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={index === 0}
            className="h-7 w-7 p-0"
            title="ย้ายขึ้น"
            aria-label="ย้ายขึ้น"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="h-7 w-7 p-0"
            title="ย้ายลง"
            aria-label="ย้ายลง"
          >
            ↓
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            className="h-7 px-2 text-[11px]"
            title={editing ? 'ซ่อนรายละเอียด' : 'แก้ไข'}
            aria-label={editing ? 'ซ่อนรายละเอียด' : 'แก้ไข'}
          >
            {editing ? 'ซ่อนรายละเอียด' : 'แก้ไข'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50"
            title="ลบ Block"
            aria-label="ลบ Block"
          >
            ลบ
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-3 py-2 text-sm">
        <BlockSummary
          block={block}
          fieldLabel={fieldLabel}
        />
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="px-3 py-2 border-t border-slate-200 bg-white/50">
          <BlockEditor
            block={block}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function BlockSummary({
  block,
  fieldLabel,
}: {
  block: DocumentBlock;
  fieldLabel?: string;
}) {
  if (block.type === 'heading') {
    return (
      <span className="text-slate-800">
        {(block as HeadingBlock).text || (
          <em className="text-slate-400">ยังไม่ได้ตั้งข้อความ</em>
        )}
      </span>
    );
  }
  if (block.type === 'field' || block.type === 'table') {
    return (
      <span className="text-slate-800">
        {fieldLabel || (
          <em className="text-slate-400">
            (deleted field — กรุณาเลือก field ใหม่)
          </em>
        )}
        {block.type === 'table' && (
          <span className="ml-1 text-[11px] text-emerald-700 font-medium">
            [table]
          </span>
        )}
      </span>
    );
  }
  // logo
  return (
    <span className="text-slate-600 italic text-xs">
      SAO Logo
    </span>
  );
}

function BlockEditor({
  block,
  onChange,
}: {
  block: DocumentBlock;
  onChange: (patch: Partial<DocumentBlock>) => void;
}) {
  if (block.type === 'heading') {
    return (
      <HeadingEditor
        block={block as HeadingBlock}
        onChange={(patch) => onChange(patch as Partial<DocumentBlock>)}
      />
    );
  }
  if (block.type === 'field' || block.type === 'table') {
    const b = block as FieldBlock | TableBlock;
    return (
      <div className="space-y-2 p-3 bg-slate-50 rounded border border-slate-200">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">fieldId</Label>
          <code className="block text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 break-all">
            {b.fieldId}
          </code>
          <p className="text-[10px] text-slate-500 mt-1">
            การเปลี่ยน fieldId ต้องลบ block นี้แล้วเพิ่มใหม่ผ่าน +Field/+Table
          </p>
        </div>
        {(block.type === 'field') && (
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-600">label override (ไม่บังคับ)</Label>
            <input
              type="text"
              value={(b as FieldBlock).label || ''}
              onChange={(e) =>
                onChange({ label: e.target.value } as Partial<DocumentBlock>)
              }
              placeholder="ปล่อยว่างเพื่อใช้ชื่อจาก Field Master"
              className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        <AlignRow
          align={b.align ?? 'left'}
          onChange={(align) =>
            onChange({ align } as Partial<DocumentBlock>)
          }
        />
      </div>
    );
  }
  // logo
  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded border border-slate-200">
      <Label className="text-[10px] text-slate-600">Alignment</Label>
      <AlignRow
        align={(block as LogoBlock).align ?? 'left'}
        onChange={(align) =>
          onChange({ align } as Partial<DocumentBlock>)
        }
      />
    </div>
  );
}

function AlignRow({
  align,
  onChange,
}: {
  align: 'left' | 'center' | 'right';
  onChange: (align: 'left' | 'center' | 'right') => void;
}) {
  const opts: Array<{ value: typeof align; label: string; icon: string }> = [
    { value: 'left', label: 'ซ้าย', icon: '⬅' },
    { value: 'center', label: 'กลาง', icon: '⏺' },
    { value: 'right', label: 'ขวา', icon: '➡' },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 h-8 text-xs rounded border transition-colors ${
            align === opt.value
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
          }`}
          title={opt.label}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}