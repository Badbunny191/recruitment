'use client';

/**
 * BlockPanel
 * --------------------------------
 * Document Composer — Block List Panel
 *
 * แสดง Block ทั้งหมดใน descriptor.blocks
 * ประกอบด้วย:
 *   - BlockToolbar (ด้านบน)
 *   - รายการ BlockItem (แต่ละประเภทมี editor เฉพาะ)
 *   - Empty state เมื่อไม่มี block
 *
 * Operations:
 *   - add(kind)
 *   - update(index, patch)
 *   - move(index, direction)
 *   - remove(index)
 */

import { useMemo, useState } from 'react';
import { BlockToolbar, type AddBlockKind } from './BlockToolbar';
import { BlockItem } from './BlockItem';
import { FieldPicker } from './FieldPicker';
import {
  createFieldBlock,
  createHeadingBlock,
  createLogoBlock,
  createSignatureBlock,
  createSystemDataBlock,
  createTableBlock,
  type DocumentBlock,
  type DocumentDescriptor,
  type HeadingBlock,
  type LogoBlock,
  type SignatureBlock,
  type SystemDataBlock,
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

  /**
   * Map fieldId (field_master.id) → library item (สำหรับ resolve label/type)
   *
   * สำคัญ: `descriptor.block.fieldId` = `field_master.id` (FK string)
   * **ไม่ใช่** `template_fields.id` (UUID)
   * — backend generator + preview/PDF renderer ใช้ fieldMaster.id เป็น
   *   identifier ฝั่งเดียว
   */
  const fieldMap = useMemo(() => {
    const m = new Map<string, TemplateFieldLibraryItem>();
    fields.forEach((f) => m.set(f.fieldId, f));
    return m;
  }, [fields]);

  // ---------------------------------------------------------------------------
  // Handlers — ทั้งหมดเปลี่ยน immutable (สร้าง array ใหม่)
  // ---------------------------------------------------------------------------

  const append = (block: DocumentBlock) => {
    onChange({ ...descriptor, blocks: [...descriptor.blocks, block] });
  };

  const handleAdd = (kind: AddBlockKind) => {
    if (kind === 'heading') {
      append(createHeadingBlock());
      return;
    }
    if (kind === 'systemData') {
      append(createSystemDataBlock('APPLICATION_NO'));
      return;
    }
    if (kind === 'logo') {
      append(createLogoBlock());
      return;
    }
    if (kind === 'signature') {
      append(createSignatureBlock());
      return;
    }
    // field / table → เปิด picker
    setPickerMode(kind);
    setPickerOpen(true);
  };

  const handlePickerSelect = (field: TemplateFieldLibraryItem) => {
    // fieldId ต้องเป็น fieldMaster.id (FK) — ไม่ใช่ templateFields.id (UUID)
    append(
      pickerMode === 'table'
        ? createTableBlock(field.fieldId)
        : createFieldBlock(field.fieldId)
    );
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
            กด <strong>Generate</strong> เพื่อสร้างอัตโนมัติ หรือเพิ่ม Block
            จากแถบเครื่องมือด้านบน
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {descriptor.blocks.map((block, idx) => {
            const fld =
              block.type === 'field' || block.type === 'table'
                ? fieldMap.get(block.fieldId)
                : undefined;

            return (
              <li key={block.id}>
                <BlockItem
                  block={block}
                  index={idx}
                  total={descriptor.blocks.length}
                  field={fld}
                  fields={fields}
                  fieldsLoading={fieldsLoading}
                  disabled={disabled}
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
    const firstLine = text.split(/\r?\n/)[0];
    const more = text.includes('\n') ? ` (+${text.split(/\r?\n/).length - 1} บรรทัด)` : '';
    return `Heading / Text: "${firstLine}${more}"`;
  }

  if (block.type === 'systemData') {
    const sd = block as SystemDataBlock;
    return `System Data: ${sd.label ?? sd.key} ({${sd.key}})`;
  }

  if (block.type === 'field') {
    const fld = fieldMap.get(block.fieldId);
    const label = fld?.labelTh ?? block.fieldId.slice(0, 12) + '…';
    return `Field: ${label}`;
  }

  if (block.type === 'table') {
    const fld = fieldMap.get(block.fieldId);
    const label = fld?.labelTh ?? block.fieldId.slice(0, 12) + '…';
    return `Table: ${label}`;
  }

  if (block.type === 'signature') {
    const sig = block as SignatureBlock;
    const role = sig.roleLabel ? ` (${sig.roleLabel})` : '';
    return `Signature: ${sig.lineLabel ?? 'ลงลายมือชื่อ'}${role}`;
  }

  // logo
  const logo = block as LogoBlock;
  return `Logo (source: ${logo.source ?? 'organization'}, align: ${logo.align ?? 'left'})`;
}