'use client';

/**
 * BlockPanel
 * --------------------------------
 * Document Composer — Block List Panel
 *
 * แสดง Block ทั้งหมดใน descriptor.blocks
 * ประกอบด้วย:
 *   - BlockToolbar (ด้านบน) + ป้ายบอกตำแหน่งที่จะเพิ่ม
 *   - รายการ BlockItem (แต่ละประเภทมี editor เฉพาะ)
 *   - Empty state เมื่อไม่มี block
 *
 * Operations:
 *   - add(kind)        → เพิ่มต่อจาก block ที่เลือก (ไม่มีการเลือก → ต่อท้าย)
 *   - update(blockId)  → แก้ไข block
 *   - move(blockId)    → ย้ายขึ้น/ลง
 *   - remove(blockId)  → ลบ block
 *
 * ── Contextual Insertion ────────────────────────────────────────────────
 * ผู้ใช้คลิกเลือก block ได้ (state `selectedBlockId`) แล้ว:
 *   1. กดเพิ่ม block → แทรกต่อจาก block ที่เลือก
 *   2. ไม่มีการเลือก → ต่อท้าย descriptor
 *   3. หลังเพิ่ม → block ใหม่ถูกเลือก + เปิด editor + scroll เข้ามา + ไฮไลต์
 *
 * ⚠️ Identity ใช้ `block.id` เสมอ (ห้ามใช้ array index) → การย้าย/ลบ
 *    ไม่ทำให้ selection ผิดตัว
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlockToolbar, type AddBlockKind } from './BlockToolbar';
import { BlockItem } from './BlockItem';
import { FieldPicker } from './FieldPicker';
import { useOptionalToast } from '@/components/ui/toast';
import {
  createFieldBlock,
  createHeadingBlock,
  createLogoBlock,
  createPageBreakBlock,
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
import {
  createEditorOpenRequest,
  describeInsertionMessage,
  describeInsertionTarget,
  findBlockIndexById,
  insertBlockWithSelection,
  moveBlockById,
  removeBlockById,
  resolveSelection,
  type EditorOpenRequest,
} from '../lib/block-operations';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

/** ระยะเวลาที่ไฮไลต์ block ใหม่ (ms) */
const NEW_BLOCK_HIGHLIGHT_MS = 2500;

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

  // ---------------------------------------------------------------------------
  // Selection state — อยู่ใน BlockPanel (ไม่ต้องข้าม component)
  // ---------------------------------------------------------------------------
  /** block.id ของ block ที่ผู้ใช้เลือกอยู่ */
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  /** block.id ของ block ที่เพิ่งถูกเพิ่ม (ไฮไลต์ชั่วคราว) */
  const [newlyAddedBlockId, setNewlyAddedBlockId] = useState<string | null>(null);
  /** สั่งให้ BlockItem เปิด inline editor */
  const [editorOpenRequest, setEditorOpenRequest] =
    useState<EditorOpenRequest | null>(null);
  /** ข้อความ feedback ล่าสุด (inline เสริมจาก toast) */
  const [feedback, setFeedback] = useState<string | null>(null);
  /**
   * block ที่เลือก ณ ตอนที่กดเปิด Field/Table Picker
   * → ใช้เป็นจุด anchor ตอนแทรก block ที่เลือกจาก picker
   */
  const [pickerAnchorId, setPickerAnchorId] = useState<string | null>(null);

  const toast = useOptionalToast();

  /** ใช้กัน timer ค้างเมื่อ component unmount */
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** timer ของข้อความ feedback (ซ่อนอัตโนมัติ) */
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** nonce ของ editorOpenRequest — เพิ่มขึ้นทุกครั้ง (ไม่พึ่ง Date.now ที่อาจซ้ำ) */
  const requestNonceRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Cleanup timers เมื่อ unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // ล้าง selection ถ้า block ที่เลือกถูกลบไปแล้ว
  // (ครอบคลุมทั้งลบทันที และลบผ่าน confirm dialog ของ ComposerClient)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedBlockId) return;
    const next = resolveSelection(descriptor.blocks, selectedBlockId);
    if (next === selectedBlockId) return;
    setSelectedBlockId(next);
  }, [descriptor.blocks, selectedBlockId]);

  // ---------------------------------------------------------------------------
  // ล้าง highlight ถ้า block ที่เพิ่งเพิ่มถูกลบไปก่อนหมดเวลาไฮไลต์
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!newlyAddedBlockId) return;
    if (findBlockIndexById(descriptor.blocks, newlyAddedBlockId) !== -1) return;
    setNewlyAddedBlockId(null);
  }, [descriptor.blocks, newlyAddedBlockId]);

  /**
   * Map fieldId (field_master.id) → library item (สำหรับ resolve label/type)
   *
   * สำคัญ: `descriptor.block.fieldId` = `field_master.id` (FK string)
   *   **ไม่ใช่** `template_fields.id` (UUID)
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

  /**
   * เพิ่ม block ใหม่ตามกฎ contextual insertion
   *
   * - มี block ที่เลือก → แทรกต่อจาก block นั้น
   * - ไม่มี → ต่อท้าย descriptor
   *
   * หลังเพิ่ม: เลือก block ใหม่ + เปิด editor + scroll + ไฮไลต์ + แจ้งผู้ใช้
   */
  const insertBlock = useCallback(
    (block: DocumentBlock, anchorBlockId: string | null) => {
      const target = describeInsertionTarget(descriptor.blocks, anchorBlockId);
      const result = insertBlockWithSelection(
        descriptor.blocks,
        block,
        anchorBlockId
      );

      onChange({ ...descriptor, blocks: result.blocks });

      // เลือก block ใหม่
      setSelectedBlockId(result.selectedBlockId);
      // เปิด editor ของ block ใหม่
      requestNonceRef.current += 1;
      setEditorOpenRequest(
        createEditorOpenRequest(result.selectedBlockId, requestNonceRef.current)
      );
      // ไฮไลต์ชั่วคราว
      setNewlyAddedBlockId(result.selectedBlockId);
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(() => {
        setNewlyAddedBlockId((current) =>
          current === result.selectedBlockId ? null : current
        );
        highlightTimerRef.current = null;
      }, NEW_BLOCK_HIGHLIGHT_MS);

      // แจ้งตำแหน่งที่เพิ่ม
      const message = describeInsertionMessage(block, target);
      setFeedback(message);
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = setTimeout(() => {
        setFeedback((current) => (current === message ? null : current));
        feedbackTimerRef.current = null;
      }, NEW_BLOCK_HIGHLIGHT_MS);

      toast?.showToast({
        title: message,
        description:
          target.kind === 'after'
            ? `เพิ่มต่อจาก Block #${target.blockNumber}`
            : 'เพิ่มต่อท้ายเอกสาร',
        variant: 'success',
      });
    },
    [descriptor, onChange, toast]
  );

  const handleAdd = (kind: AddBlockKind) => {
    if (kind === 'field' || kind === 'table') {
      // เปิด picker — จำ anchor (block ที่เลือก) ไว้ก่อน
      setPickerAnchorId(selectedBlockId);
      setPickerMode(kind);
      setPickerOpen(true);
      return;
    }

    const anchor = selectedBlockId;
    if (kind === 'heading') {
      insertBlock(createHeadingBlock(), anchor);
      return;
    }
    if (kind === 'systemData') {
      insertBlock(createSystemDataBlock('APPLICATION_NO'), anchor);
      return;
    }
    if (kind === 'logo') {
      insertBlock(createLogoBlock(), anchor);
      return;
    }
    if (kind === 'signature') {
      insertBlock(createSignatureBlock(), anchor);
      return;
    }
    if (kind === 'pageBreak') {
      insertBlock(createPageBreakBlock(), anchor);
      return;
    }
  };

  const handlePickerSelect = (field: TemplateFieldLibraryItem) => {
    // fieldId ต้องเป็น fieldMaster.id (FK) — ไม่ใช่ templateFields.id (UUID)
    insertBlock(
      pickerMode === 'table'
        ? createTableBlock(field.fieldId)
        : createFieldBlock(field.fieldId),
      pickerAnchorId
    );
    setPickerAnchorId(null);
  };

  const handleBlockChange = (blockId: string, patch: Partial<DocumentBlock>) => {
    const idx = findBlockIndexById(descriptor.blocks, blockId);
    if (idx === -1) return;
    const next = descriptor.blocks.slice();
    next[idx] = { ...next[idx], ...patch } as DocumentBlock;
    onChange({ ...descriptor, blocks: next });
  };

  const handleMove = (blockId: string, direction: -1 | 1) => {
    const next = moveBlockById(descriptor.blocks, blockId, direction);
    onChange({ ...descriptor, blocks: next });
    // selection ผูกกับ block.id → ย้ายแล้วยังเลือกตัวเดิมอยู่
  };

  // ---------------------------------------------------------------------------
  // Delete handler — ใช้ onDeleteRequest ถ้ามี (UAT: confirm dialog)
  //                 ถ้าไม่มี → ลบเลย (back-compat)
  // ---------------------------------------------------------------------------
  const handleDelete = (index: number) => {
    const block = descriptor.blocks[index];
    if (!block) return;
    const summary = describeBlock(block, fieldMap);
    if (onDeleteRequest) {
      onDeleteRequest(index, summary);
    } else {
      onChange({
        ...descriptor,
        blocks: removeBlockById(descriptor.blocks, block.id),
      });
      // ล้าง selection ถ้าลบ block ที่เลือกอยู่
      setSelectedBlockId((current) => (current === block.id ? null : current));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const insertionTarget = describeInsertionTarget(descriptor.blocks, selectedBlockId);

  return (
    <div className="space-y-3">
      <BlockToolbar
        onAdd={handleAdd}
        disabled={disabled}
        insertionHint={insertionTarget.label}
      />

      {/* Inline feedback (เสริมจาก toast — ใช้เป็น live region สำหรับ screen reader) */}
      <div aria-live="polite" className="min-h-[0px]">
        {feedback && (
          <p
            data-testid="block-panel-feedback"
            className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1"
          >
            {feedback}
          </p>
        )}
      </div>

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
                  isSelected={selectedBlockId === block.id}
                  isNewlyAdded={newlyAddedBlockId === block.id}
                  editorOpenRequest={editorOpenRequest}
                  onSelect={(blockId) => setSelectedBlockId(blockId)}
                  onChange={(patch) => handleBlockChange(block.id, patch)}
                  onMoveUp={() => handleMove(block.id, -1)}
                  onMoveDown={() => handleMove(block.id, 1)}
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
        onClose={() => {
          setPickerOpen(false);
          setPickerAnchorId(null);
        }}
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
