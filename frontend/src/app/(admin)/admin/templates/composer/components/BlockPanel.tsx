'use client';

/**
 * BlockPanel
 * --------------------------------
 * Document Composer V1 — Block List Panel
 *
 * แสดง Block ทั้งหมดใน descriptor.blocks
 * ประกอบด้วย:
 *   - BlockToolbar (ด้านบน)
 *   - รายการ BlockItem
 *   - Empty state เมื่อไม่มี block
 *
 * Operations:
 *   - add(kind, fieldId?)
 *   - update(index, patch)
 *   - move(index, direction)
 *   - remove(index)
 */

import { useMemo } from 'react';
import { BlockToolbar, type AddBlockKind } from './BlockToolbar';
import { BlockItem } from './BlockItem';
import { FieldPicker } from './FieldPicker';
import { useState } from 'react';
import type {
  DocumentDescriptor,
  DocumentBlock,
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
} from '@/lib/api/template-descriptor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface BlockPanelProps {
  descriptor: DocumentDescriptor;
  onChange: (next: DocumentDescriptor) => void;
  fields: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  /** ปิดการแก้ไข (เช่นตอนกำลัง save) */
  disabled?: boolean;
  /**
   * ขอ confirm ก่อนลบ — UAT Hardening
   * ถ้าไม่ส่ง → ลบเลย (back-compat สำหรับ caller อื่น)
   */
  onDeleteRequest?: (index: number, summary: string) => void;
}

function newBlockId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function makeHeadingBlock(text = 'หัวข้อใหม่'): HeadingBlock {
  return {
    id: newBlockId('h'),
    type: 'heading',
    text,
    size: 'medium',
    bold: false,
    align: 'left',
  };
}

function makeFieldBlock(field: TemplateFieldLibraryItem): FieldBlock {
  return {
    id: newBlockId('f'),
    type: 'field',
    fieldId: field.id,
    label: undefined,
    align: 'left',
  };
}

function makeTableBlock(field: TemplateFieldLibraryItem): TableBlock {
  return {
    id: newBlockId('t'),
    type: 'table',
    fieldId: field.id,
    align: 'left',
  };
}

function makeLogoBlock(): LogoBlock {
  return {
    id: newBlockId('l'),
    type: 'logo',
    align: 'left',
  };
}

export function BlockPanel({
  descriptor,
  onChange,
  fields,
  fieldsLoading,
  disabled,
  onDeleteRequest,
}: BlockPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'field' | 'table'>('field');

  // Map fieldId → library item (สำหรับ resolve label/type)
  const fieldMap = useMemo(() => {
    const m = new Map<string, TemplateFieldLibraryItem>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  // ---------------------------------------------------------------------------
  // Handlers — ทั้งหมดเปลี่ยน immutable (สร้าง array ใหม่)
  // ---------------------------------------------------------------------------

  const handleAdd = (kind: AddBlockKind) => {
    if (kind === 'heading') {
      onChange({
        ...descriptor,
        blocks: [...descriptor.blocks, makeHeadingBlock()],
      });
    } else if (kind === 'logo') {
      onChange({
        ...descriptor,
        blocks: [...descriptor.blocks, makeLogoBlock()],
      });
    } else {
      // field / table → เปิด picker
      setPickerMode(kind);
      setPickerOpen(true);
    }
  };

  const handlePickerSelect = (field: TemplateFieldLibraryItem) => {
    const block =
      pickerMode === 'table'
        ? makeTableBlock(field)
        : makeFieldBlock(field);
    onChange({ ...descriptor, blocks: [...descriptor.blocks, block] });
  };

  const handleBlockChange = (index: number, patch: Partial<DocumentBlock>) => {
    const next = descriptor.blocks.slice();
    next[index] = { ...next[index], ...patch } as DocumentBlock;
    onChange({ ...descriptor, blocks: next });
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= descriptor.blocks.length) return;
    const next = descriptor.blocks.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...descriptor, blocks: next });
  };

  // ---------------------------------------------------------------------------
  // Delete handler — ใช้ onDeleteRequest ถ้ามี (UAT: confirm dialog)
  //                 ถ้าไม่มี → ลบเลย (back-compat)
  // ---------------------------------------------------------------------------
  const handleDelete = (index: number) => {
    const block = descriptor.blocks[index];
    const summary = describeBlock(block, fieldMap);
    if (onDeleteRequest) {
      onDeleteRequest(index, summary);
    } else {
      const next = descriptor.blocks.slice();
      next.splice(index, 1);
      onChange({ ...descriptor, blocks: next });
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      <BlockToolbar onAdd={handleAdd} disabled={disabled} />

      {descriptor.blocks.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-500">
          <div className="text-3xl mb-2">🧩</div>
          <p className="text-sm font-medium">ยังไม่มี Block</p>
          <p className="text-xs mt-1">
            กด <strong>Generate</strong> เพื่อสร้างอัตโนมัติ หรือเพิ่ม Block จากแถบเครื่องมือด้านบน
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {descriptor.blocks.map((block, idx) => {
            const fld =
              block.type === 'field' || block.type === 'table'
                ? fieldMap.get((block as FieldBlock | TableBlock).fieldId)
                : undefined;
            return (
              <li key={block.id}>
                <BlockItem
                  block={block}
                  index={idx}
                  total={descriptor.blocks.length}
                  fieldLabel={fld?.labelTh}
                  fieldType={fld?.fieldType}
                  onChange={(patch) => handleBlockChange(idx, patch)}
                  onMoveUp={() => handleMove(idx, -1)}
                  onMoveDown={() => handleMove(idx, 1)}
                  onDelete={() => handleDelete(idx)}
                />
              </li>
            );
          })}
        </ol>
      )}

      <FieldPicker
        open={pickerOpen}
        mode={pickerMode}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        fields={fields}
        loading={fieldsLoading}
      />
    </div>
  );
}

/**
 * สร้าง human-readable summary สำหรับ confirm dialog
 */
function describeBlock(
  block: DocumentBlock,
  fieldMap: Map<string, TemplateFieldLibraryItem>
): string {
  if (block.type === 'heading') {
    const text = (block as HeadingBlock).text || '(ไม่มีข้อความ)';
    return `Heading: "${text}"`;
  }
  if (block.type === 'field' || block.type === 'table') {
    const b = block as FieldBlock | TableBlock;
    const fld = fieldMap.get(b.fieldId);
    const label = fld?.labelTh ?? b.fieldId.slice(0, 12) + '…';
    return `${block.type === 'table' ? 'Table' : 'Field'}: ${label}`;
  }
  // logo
  return `Logo (align: ${(block as LogoBlock).align ?? 'left'})`;
}