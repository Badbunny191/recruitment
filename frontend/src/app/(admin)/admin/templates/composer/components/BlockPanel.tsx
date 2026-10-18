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
  SignatureBlock,
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

// ⚠️ สำคัญ: descriptor.block.fieldId ต้องเป็น fieldMaster.id (FK string)
  // ไม่ใช่ templateFields.id (UUID) — เพื่อให้:
  //   1. fieldMap lookup เจอ (BlockPanel.fieldMap ใช้ fieldId เป็น key)
  //   2. preview-renderer resolve เจอ (fieldIndex ใช้ FieldData.fieldId = fieldMaster.id)
  //   3. save → load → preview คงความถูกต้อง (JSON shape ตรงกับ generator output)
  function makeFieldBlock(field: TemplateFieldLibraryItem): FieldBlock {
    return {
      id: newBlockId('f'),
      type: 'field',
      fieldId: field.fieldId,
      label: undefined,
      align: 'left',
    };
  }

  function makeTableBlock(field: TemplateFieldLibraryItem): TableBlock {
    return {
      id: newBlockId('t'),
      type: 'table',
      fieldId: field.fieldId,
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

function makeSignatureBlock(): SignatureBlock {
  return {
    id: newBlockId('s'),
    type: 'signature',
    roleLabel: 'ผู้สมัคร',
    // Visibility defaults — mirror backend (preview-renderer.ts)
    showName: true,
    showDate: true,
    showTime: false,
    align: 'center',
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

  // Map fieldId (fieldMaster.id) → library item (สำหรับ resolve label/type)
  //
  // สำคัญ: descriptor.block.fieldId = fieldMaster.id (FK string) ไม่ใช่
  // templateFields.id (UUID) — backend generator (descriptor-generator.ts) และ
  // preview-renderer.ts ใช้ fieldMaster.id เป็น identifier ฝั่งเดียว
  //
  // Map จึงต้อง key ด้วย fieldId (FK) ด้วย ไม่ใช่ templateFields.id (UUID)
  // — ไม่งั้น Visual Composer จะ resolve label ไม่เจอและแสดง "(deleted field)"
  const fieldMap = useMemo(() => {
    const m = new Map<string, TemplateFieldLibraryItem>();
    fields.forEach((f) => m.set(f.fieldId, f));
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
    } else if (kind === 'signature') {
      onChange({
        ...descriptor,
        blocks: [...descriptor.blocks, makeSignatureBlock()],
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
            // ──────────────────────────────────────────────────────────────
            // DEBUG (Visual Composer label resolution) — เก็บหลักฐานจริง
            // เพื่อพิสูจน์ว่า bug เกิดจาก:
            //   A) lookup ไม่เจอ (key mismatch)
            //   B) lookup เจอ แต่ labelTh = "" / undefined
            //   C) property ที่ใช้ render ผิดตัว
            // log เฉพาะ block ที่ขึ้น "(deleted field)" — คือ fld ว่าง หรือ
            // fld.labelTh ว่าง/null/undefined
            // ──────────────────────────────────────────────────────────────
            if (
              process.env.NODE_ENV !== 'production' &&
              (block.type === 'field' || block.type === 'table')
            ) {
              const blockFieldId = (block as FieldBlock | TableBlock).fieldId;
              const isMissingLabel =
                !fld ||
                fld.labelTh === undefined ||
                fld.labelTh === null ||
                (typeof fld.labelTh === 'string' && fld.labelTh.trim() === '');
              if (isMissingLabel) {
                // eslint-disable-next-line no-console
                console.log('[BlockPanel][deleted-field-debug]', {
                  blockIndex: idx,
                  blockId: block.id,
                  blockType: block.type,
                  'block.fieldId': blockFieldId,
                  'fieldMap.size': fieldMap.size,
                  'fieldMap.keys()': Array.from(fieldMap.keys()),
                  'fieldMap.has(block.fieldId)': fieldMap.has(blockFieldId),
                  'fieldMap.get(block.fieldId)': fld ?? null,
                  'fieldMap.get(block.fieldId)?.labelTh':
                    fld?.labelTh ?? null,
                  'fieldMap.get(block.fieldId)?.fieldId':
                    fld?.fieldId ?? null,
                  'fieldMap.get(block.fieldId)?.id': fld?.id ?? null,
                });
              }
            }
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
  if (block.type === 'signature') {
    return `Signature: ลงลายมือชื่อ${(block as SignatureBlock).roleLabel ? ` (${(block as SignatureBlock).roleLabel})` : ''}`;
  }
  // logo
  return `Logo (align: ${(block as LogoBlock).align ?? 'left'})`;
}