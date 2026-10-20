'use client';

/**
 * BlockItem
 * --------------------------------
 * Document Composer — Single Block Card
 *
 * Render block 1 ตัวใน Block Panel พร้อม:
 *   - ▲ Move Up
 *   - ▼ Move Down
 *   - 🗑 Delete
 *   - ✏️ แก้ไข (toggle inline editor)
 *
 * แต่ละประเภท block มี editor เฉพาะ:
 *   - heading / text → HeadingEditor   (หลายบรรทัด + แทรก token)
 *   - systemData     → SystemDataEditor
 *   - field          → FieldEditor
 *   - table          → TableEditor
 *   - logo           → LogoEditor
 *   - signature      → SignatureEditor
 *
 * ใช้ callback ทั้งหมด — parent ถือ source of truth
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  NO_LOGO_TEXT,
  SYSTEM_DATA_LABELS,
  type DocumentBlock,
  type HeadingBlock,
  type FieldBlock,
  type TableBlock,
  type LogoBlock,
  type SignatureBlock,
  type SystemDataBlock,
} from '@/lib/api/template-descriptor';
import { normalizeDateSource } from './SignatureEditor';
import { HeadingEditor, AlignRow } from './HeadingEditor';
import { SystemDataEditor } from './SystemDataEditor';
import { FieldEditor } from './FieldEditor';
import { TableEditor } from './TableEditor';
import { LogoEditor } from './LogoEditor';
import { SignatureEditor } from './SignatureEditor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface BlockItemProps {
  block: DocumentBlock;
  index: number;
  total: number;
  /** resolved field สำหรับ field/table block */
  field?: TemplateFieldLibraryItem;
  /** รายการ field ทั้งหมด — ใช้ใน HeadingEditor (InsertDataMenu) + SignatureEditor */
  fields?: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

const TYPE_META: Record<
  DocumentBlock['type'],
  { icon: string; label: string; tone: string }
> = {
  heading: {
    icon: '📝',
    label: 'Heading / Text',
    tone: 'bg-purple-50 border-purple-200',
  },
  systemData: {
    icon: '🗂️',
    label: 'System Data',
    tone: 'bg-sky-50 border-sky-200',
  },
  field: { icon: '📌', label: 'Field', tone: 'bg-blue-50 border-blue-200' },
  table: {
    icon: '📊',
    label: 'Table',
    tone: 'bg-emerald-50 border-emerald-200',
  },
  logo: { icon: '🖼️', label: 'Logo', tone: 'bg-amber-50 border-amber-200' },
  signature: {
    icon: '✍️',
    label: 'Signature',
    tone: 'bg-rose-50 border-rose-200',
  },
};

export function BlockItem({
  block,
  index,
  total,
  field,
  fields,
  fieldsLoading,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  disabled,
}: BlockItemProps) {
  const [editing, setEditing] = useState(false);
  const meta = TYPE_META[block.type];

  return (
    <div className={`rounded-lg border ${meta.tone} overflow-hidden`}>
      {/* Header row: type + index + actions */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/70">
        <span className="text-base shrink-0">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase text-slate-500">
              {meta.label} #{index + 1}
            </span>
            {block.type === 'logo' && (
              <span className="text-[10px] text-slate-500">
                source: {(block as LogoBlock).source ?? 'organization'}
              </span>
            )}
            {block.type === 'systemData' && (
              <span className="text-[10px] text-slate-500">
                key: {(block as SystemDataBlock).key}
              </span>
            )}
            {block.type === 'field' && field?.fieldType && (
              <span className="text-[10px] text-slate-500">
                ({field.fieldType})
              </span>
            )}
            {block.type === 'table' && field?.fieldType && (
              <span className="text-[10px] text-slate-500">
                ({field.fieldType})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={index === 0 || disabled}
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
            disabled={index === total - 1 || disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
        <BlockSummary block={block} fieldLabel={field?.labelTh} />
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="px-3 py-2 border-t border-slate-200 bg-white/50">
          <BlockEditor
            block={block}
            field={field}
            fields={fields}
            fieldsLoading={fieldsLoading}
            disabled={disabled}
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
    const text = (block as HeadingBlock).text;
    if (!text) {
      return <em className="text-slate-400">ยังไม่ได้ตั้งข้อความ</em>;
    }
    const lines = text.split(/\r?\n/);
    return (
      <span className="text-slate-800">
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line || <em className="text-slate-300">(บรรทัดว่าง)</em>}
          </span>
        ))}
      </span>
    );
  }

  if (block.type === 'systemData') {
    const sd = block as SystemDataBlock;
    return (
      <span className="text-slate-700 text-xs">
        <span className="font-medium">{sd.label || SYSTEM_DATA_LABELS[sd.key]}</span>
        <span className="mx-1 text-slate-400">·</span>
        <code className="font-mono text-sky-700">{`{${sd.key}}`}</code>
        <span className="ml-2 text-[10px] text-slate-500">
          ({sd.layout ?? 'stacked'})
        </span>
      </span>
    );
  }

  if (block.type === 'field') {
    const b = block as FieldBlock;
    return (
      <span className="text-slate-800">
        {b.label || fieldLabel || (
          <em className="text-slate-400">
            (deleted field — กรุณาเลือก field ใหม่)
          </em>
        )}
        <span className="ml-2 text-[10px] text-slate-500">
          {b.layout ?? 'stacked'}
          {b.showLabel === false ? ' · ไม่แสดงป้ายกำกับ' : ''}
        </span>
      </span>
    );
  }

  if (block.type === 'table') {
    const b = block as TableBlock;
    return (
      <span className="text-slate-800">
        {b.label || fieldLabel || (
          <em className="text-slate-400">
            (deleted field — กรุณาเลือก field ใหม่)
          </em>
        )}
        <span className="ml-1 text-[11px] text-emerald-700 font-medium">
          [table]
        </span>
      </span>
    );
  }

  if (block.type === 'signature') {
    const sig = block as SignatureBlock;
    const showName = sig.showName ?? true;
    const showDate = sig.showDate ?? true;
    const dateSource = normalizeDateSource(sig.dateSource);
    const visible: string[] = [];
    if (showName) visible.push('ชื่อ');
    if (showDate && dateSource !== 'none') visible.push('วันที่');
    return (
      <span className="text-slate-700 text-xs">
        <span className="font-medium">{sig.lineLabel ?? 'ลงลายมือชื่อ'}</span>
        <span className="mx-1 text-slate-400">·</span>
        <span>{sig.roleLabel ?? 'ผู้สมัคร'}</span>
        <span className="ml-2 text-[10px] text-slate-500">
          (แสดง: {visible.join(', ') || 'ไม่มี'})
        </span>
        {sig.nameFieldId && (
          <span className="ml-2 text-[10px] text-slate-400">
            ชื่อจาก field: {sig.nameFieldId}
          </span>
        )}
      </span>
    );
  }

  // logo
  const logo = block as LogoBlock;
  const source = logo.source ?? 'organization';
  return (
    <span className="text-slate-600 italic text-xs">
      {source === 'none'
        ? 'ไม่แสดงโลโก้'
        : `โลโก้ (${source === 'upload' ? 'upload — ยังไม่รองรับ' : 'หน่วยงาน'}) — ถ้าไม่มีภาพจะแสดง "${NO_LOGO_TEXT}"`}
    </span>
  );
}

function BlockEditor({
  block,
  field,
  fields,
  fieldsLoading,
  disabled,
  onChange,
}: {
  block: DocumentBlock;
  field?: TemplateFieldLibraryItem;
  fields?: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<DocumentBlock>) => void;
}) {
  const patch = (p: Partial<DocumentBlock>) => onChange(p);

  if (block.type === 'heading') {
    return (
      <HeadingEditor
        block={block as HeadingBlock}
        fields={fields}
        fieldsLoading={fieldsLoading}
        disabled={disabled}
        onChange={(p) => patch(p as Partial<DocumentBlock>)}
      />
    );
  }

  if (block.type === 'systemData') {
    return (
      <SystemDataEditor
        block={block as SystemDataBlock}
        disabled={disabled}
        onChange={(p) => patch(p as Partial<DocumentBlock>)}
      />
    );
  }

  if (block.type === 'field') {
    return (
      <FieldEditor
        block={block as FieldBlock}
        field={field}
        disabled={disabled}
        onChange={(p) => patch(p as Partial<DocumentBlock>)}
      />
    );
  }

  if (block.type === 'table') {
    return (
      <TableEditor
        block={block as TableBlock}
        field={field}
        disabled={disabled}
        onChange={(p) => patch(p as Partial<DocumentBlock>)}
      />
    );
  }

  if (block.type === 'signature') {
    return (
      <SignatureEditor
        block={block as SignatureBlock}
        fields={fields}
        fieldsLoading={fieldsLoading}
        disabled={disabled}
        onChange={(p) => patch(p as Partial<DocumentBlock>)}
      />
    );
  }

  // logo
  return (
    <LogoEditor
      block={block as LogoBlock}
      disabled={disabled}
      onChange={(p) => patch(p as Partial<DocumentBlock>)}
    />
  );
}

/** Legacy wrapper — ใช้โดยจุดอื่นที่ยังต้องการแถว alignment แบบง่าย */
export { AlignRow };