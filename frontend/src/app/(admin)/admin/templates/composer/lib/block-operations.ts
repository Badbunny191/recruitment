'use client';

/**
 * Block Operations — pure helpers สำหรับ Document Composer
 * --------------------------------
 * จุดประสงค์:
 *   1. ให้ **identity เป็น `block.id` เสมอ** (ห้ามใช้ array index เป็น identity)
 *      → การเลือก block ยังคงถูกต้องหลัง reorder / delete
 *   2. ทุกฟังก์ชัน **ไม่ mutate** array เดิม (คืนค่า array ใหม่เสมอ)
 *   3. เป็น pure function ทั้งหมด → เขียน test ได้โดยไม่ต้อง render React
 *
 * กฎการเพิ่ม Block (Contextual Insertion):
 *   - มี `selectedBlockId` → แทรกต่อจาก block ที่เลือก (index + 1)
 *   - ไม่มี `selectedBlockId` → ต่อท้าย descriptor
 *
 * ⚠️ ไม่เปลี่ยน schema ของ DocumentDescriptor — helper นี้รับ/คืนค่า
 *    `DocumentBlock[]` เท่านั้น
 */

import type { DocumentBlock } from '@/lib/api/template-descriptor';

// =============================================================================
// Type labels (single source — ใช้ทั้งใน BlockItem / feedback message)
// =============================================================================

export const BLOCK_TYPE_LABELS: Record<DocumentBlock['type'], string> = {
  heading: 'Heading / Text',
  systemData: 'System Data',
  field: 'Field',
  table: 'Table',
  logo: 'Logo',
  signature: 'Signature',
  pageBreak: 'Page Break',
};

// =============================================================================
// Lookup
// =============================================================================

/** หา index ของ block จาก `block.id` — คืน -1 ถ้าไม่พบ */
export function findBlockIndexById(
  blocks: DocumentBlock[],
  blockId: string | null | undefined
): number {
  if (!blockId) return -1;
  return blocks.findIndex((b) => b.id === blockId);
}

// =============================================================================
// Insertion
// =============================================================================

/**
 * ตำแหน่งที่จะแทรก block ใหม่
 * - มี selectedBlockId (และยังมีอยู่จริง) → index ของ block นั้น + 1
 * - ไม่มี → blocks.length (ต่อท้าย)
 */
export function computeInsertIndex(
  blocks: DocumentBlock[],
  selectedBlockId: string | null | undefined
): number {
  const idx = findBlockIndexById(blocks, selectedBlockId);
  if (idx === -1) return blocks.length;
  return idx + 1;
}

/**
 * แทรก block ที่ index (ไม่ mutate ของเดิม)
 * - clamp index ให้อยู่ในช่วง [0, blocks.length]
 */
export function insertBlockAt(
  blocks: DocumentBlock[],
  block: DocumentBlock,
  index: number
): DocumentBlock[] {
  const clamped = Math.max(0, Math.min(index, blocks.length));
  const next = blocks.slice();
  next.splice(clamped, 0, block);
  return next;
}

/**
 * แทรก block ตามกฎ contextual insertion
 *
 * คืนค่า:
 *   - `blocks`          → array ใหม่ (ไม่ mutate ของเดิม)
 *   - `insertedIndex`   → ตำแหน่งที่แทรกจริง
 *   - `selectedBlockId` → id ของ block ใหม่ (กลายเป็น block ที่เลือก)
 */
export function insertBlockWithSelection(
  blocks: DocumentBlock[],
  block: DocumentBlock,
  selectedBlockId: string | null | undefined
): {
  blocks: DocumentBlock[];
  insertedIndex: number;
  selectedBlockId: string;
} {
  const index = computeInsertIndex(blocks, selectedBlockId);
  return {
    blocks: insertBlockAt(blocks, block, index),
    insertedIndex: index,
    selectedBlockId: block.id,
  };
}

// =============================================================================
// Remove / Move
// =============================================================================

/** ลบ block ตาม `block.id` — ไม่ mutate ของเดิม */
export function removeBlockById(
  blocks: DocumentBlock[],
  blockId: string
): DocumentBlock[] {
  const idx = findBlockIndexById(blocks, blockId);
  if (idx === -1) return blocks.slice();
  const next = blocks.slice();
  next.splice(idx, 1);
  return next;
}

/**
 * ย้าย block ขึ้น/ลง ตาม `block.id` — ไม่ mutate ของเดิม
 *
 * หมายเหตุ: คืนค่า array ใหม่ แต่ **ตัว block.id ไม่เปลี่ยน**
 * → selection ที่ผูกกับ id จึงยังคงถูกต้องหลัง reorder
 */
export function moveBlockById(
  blocks: DocumentBlock[],
  blockId: string,
  direction: -1 | 1
): DocumentBlock[] {
  const idx = findBlockIndexById(blocks, blockId);
  if (idx === -1) return blocks.slice();
  const target = idx + direction;
  if (target < 0 || target >= blocks.length) return blocks.slice();
  const next = blocks.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/**
 * selection เดิมยัง valid อยู่ไหม (เช่น หลัง block ถูกลบไปแล้ว)
 */
export function isSelectionStillValid(
  blocks: DocumentBlock[],
  selectedBlockId: string | null | undefined
): boolean {
  if (!selectedBlockId) return false;
  return findBlockIndexById(blocks, selectedBlockId) !== -1;
}

/**
 * คำนวณ selection ใหม่หลังรายการ block เปลี่ยนไป
 *
 * - ถ้า block ที่เลือกยังอยู่ → คืน id เดิม (ย้าย block แล้วยังเลือกตัวเดิม)
 * - ถ้าถูกลบไปแล้ว → คืน null (ล้าง selection)
 */
export function resolveSelection(
  blocks: DocumentBlock[],
  selectedBlockId: string | null | undefined
): string | null {
  if (!selectedBlockId) return null;
  return isSelectionStillValid(blocks, selectedBlockId) ? selectedBlockId : null;
}

// =============================================================================
// Insertion target description (ใช้แสดงบน Toolbar + feedback message)
// =============================================================================

export interface InsertionTarget {
  kind: 'after' | 'end';
  /** เลขบล็อกแบบ 1-based (มีเมื่อ kind === 'after') */
  blockNumber?: number;
  /** ข้อความสั้นสำหรับแสดงบน Toolbar */
  label: string;
}

/**
 * อธิบายว่าการกดเพิ่ม block ครั้งถัดไปจะเพิ่มที่ไหน
 * - `เพิ่มต่อจาก Block #X`  → มี block ที่เลือกอยู่
 * - `เพิ่มต่อท้ายเอกสาร`   → ไม่มี block ที่เลือก
 */
export function describeInsertionTarget(
  blocks: DocumentBlock[],
  selectedBlockId: string | null | undefined
): InsertionTarget {
  const idx = findBlockIndexById(blocks, selectedBlockId);
  if (idx === -1) {
    return { kind: 'end', label: 'เพิ่มต่อท้ายเอกสาร' };
  }
  return {
    kind: 'after',
    blockNumber: idx + 1,
    label: `เพิ่มต่อจาก Block #${idx + 1}`,
  };
}

/**
 * ข้อความแจ้งผู้ใช้หลังเพิ่ม block สำเร็จ
 * เช่น "เพิ่ม Field Block หลัง Block #5 แล้ว"
 */
export function describeInsertionMessage(
  block: DocumentBlock,
  target: InsertionTarget
): string {
  const label = BLOCK_TYPE_LABELS[block.type] ?? 'Block';
  if (target.kind === 'after' && target.blockNumber != null) {
    return `เพิ่ม ${label} Block หลัง Block #${target.blockNumber} แล้ว`;
  }
  return `เพิ่ม ${label} Block ต่อท้ายเอกสารแล้ว`;
}

// =============================================================================
// Editor open request (ให้ parent สั่งเปิด inline editor ของ block ได้)
// =============================================================================

export interface EditorOpenRequest {
  blockId: string;
  /** เพิ่มขึ้นทุกครั้งที่สั่งเปิด — กัน effect ทำงานซ้ำเมื่อ id เดิมถูกเรียกซ้ำ */
  nonce: number;
}

export function createEditorOpenRequest(
  blockId: string,
  nonce: number
): EditorOpenRequest {
  return { blockId, nonce };
}

/** request นี้ถูกมีไว้ให้ block นี้เปิด editor ไหม */
export function shouldOpenEditor(
  request: EditorOpenRequest | null | undefined,
  blockId: string
): boolean {
  return !!request && request.blockId === blockId;
}

// =============================================================================
// Selection click guard
// =============================================================================

/** attribute ที่ใช้กันการคลิกเลือก block */
export const NO_SELECT_ATTRIBUTE = 'data-no-select';

/** element ที่มีเมธอด closest (subset ของ HTMLElement) */
export interface ClosestElement {
  closest?: (selector: string) => unknown | null;
}

/**
 * การคลิกที่ element นี้ควรเลือก block หรือไม่
 *
 * ต้อง **ไม่** เลือกเมื่อคลิกโซน interactive:
 *   - ปุ่มแก้ไข / ปุ่มลบ / ปุ่มขึ้น-ลง
 *   - input / select / textarea ภายใน inline editor
 *
 * โซนเหล่านี้ถูก mark ด้วย `data-no-select` ไว้แล้ว
 */
export function shouldSelectOnClick(
  target: ClosestElement | null | undefined,
  options: { disabled?: boolean; hasHandler?: boolean } = {}
): boolean {
  if (options.disabled) return false;
  if (!options.hasHandler) return false;
  if (!target) return true;
  if (typeof target.closest !== 'function') return true;
  return !target.closest(`[${NO_SELECT_ATTRIBUTE}]`);
}

// =============================================================================
// Auto-scroll
// =============================================================================

/**
 * ตัวเลือกของ scrollIntoView
 *
 * ใช้ `block: 'nearest'` เพื่อไม่ให้หน้ากระโดดแรงเกินไป
 * (ถ้าใช้ 'center' หรือ 'start' หน้าจอจะกระโดดทุกครั้งที่เพิ่ม block)
 */
export const SCROLL_INTO_VIEW_OPTIONS: ScrollIntoViewOptions = {
  behavior: 'smooth',
  block: 'nearest',
};

/** element ที่รองรับการ scroll (subset ของ HTMLElement ที่ต้องใช้) */
export interface ScrollableElement {
  scrollIntoView?: (options?: ScrollIntoViewOptions | boolean) => void;
}

/**
 * เลื่อน element เข้ามาในบริเวณมองเห็น — ปลอดภัยกับ SSR / browser ที่ไม่มี API
 *
 * คืนค่า true ถ้า scroll สำเร็จ / false ถ้าไม่ได้ scroll
 */
export function scrollBlockIntoView(
  element: ScrollableElement | null | undefined
): boolean {
  if (!element) return false;
  if (typeof element.scrollIntoView !== 'function') return false;
  element.scrollIntoView(SCROLL_INTO_VIEW_OPTIONS);
  return true;
}

// =============================================================================
// Auto-scroll (scoped) — เลื่อนเฉพาะพื้นที่ Composer
// =============================================================================

/** element ที่มีข้อมูล geometry พอสำหรับคำนวณ scroll (subset ของ HTMLElement) */
export interface ScrollContainerLike {
  scrollTop: number;
  clientHeight?: number;
  getBoundingClientRect?: () => { top: number; bottom: number };
}

/** element ที่ต้องการ scroll (subset ของ HTMLElement) */
export interface ScrollTargetLike {
  getBoundingClientRect?: () => { top: number; bottom: number };
}

/**
 * หา container ที่เลื่อนได้ที่ใกล้ที่สุดของ element
 *
 * คืน null ถ้าไม่มี (แปลว่าไม่มีพื้นที่เลื่อนเฉพาะ → ใช้ scrollIntoView แทน)
 */
export function findScrollableAncestor(
  element: unknown
): ScrollContainerLike | null {
  let current = element as
    | (Element & { parentElement?: Element | null })
    | null
    | undefined;
  let depth = 0;

  while (current && typeof current.getBoundingClientRect === 'function') {
    const style = readOverflowY(current);
    const scrollable =
      style === 'auto' ||
      style === 'scroll' ||
      (typeof current.scrollTop === 'number' &&
        typeof current.clientHeight === 'number' &&
        current.clientHeight > 0);
    if (scrollable && typeof current.scrollTop === 'number') {
      return current as unknown as ScrollContainerLike;
    }
    current = current.parentElement;
    depth += 1;
    if (depth > 20) break;
  }
  return null;
}

function readOverflowY(element: unknown): string | null {
  try {
    const view = element as { ownerDocument?: { defaultView?: { getComputedStyle?: (el: unknown) => { overflowY?: string } | null } } };
    const getComputedStyle = view?.ownerDocument?.defaultView?.getComputedStyle;
    if (!getComputedStyle) return null;
    const style = getComputedStyle(element);
    return style?.overflowY ?? null;
  } catch {
    return null;
  }
}

/**
 * เลื่อน target เข้ามาในมุมมอง **โดยเลื่อนเฉพาะ container ที่กำหนด**
 *
 * เหตุผล: `scrollIntoView` จะเลื่อนทุก ancestor ที่เลื่อนได้
 * รวมถึงหน้าเว็บ (body) → ทำให้ "ลากทั้งหน้าเว็บ" โดยไม่จำเป็น
 * เมื่อพื้นที่ทำงานถูกออกแบบให้เลื่อนแยกกัน (ก้อนที่ 2)
 *
 * คืนค่า true ถ้าเลื่อนใน container สำเร็จ / false ถ้าไม่มี container
 */
export function scrollWithinContainer(
  target: ScrollTargetLike | null | undefined,
  container: ScrollContainerLike | null | undefined
): boolean {
  if (!target || !container) return false;
  if (typeof target.getBoundingClientRect !== 'function') return false;
  if (typeof container.getBoundingClientRect !== 'function') return false;

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (typeof container.clientHeight === 'number') {
    // ใช้ clientHeight เป็นหลัก (สูงกว่า visible area จริง)
  }

  const visibleTop = containerRect.top;
  const visibleBottom = containerRect.bottom;
  const targetTop = targetRect.top;
  const targetBottom = targetRect.bottom;

  let delta = 0;
  if (targetTop < visibleTop) {
    delta = targetTop - visibleTop;
  } else if (targetBottom > visibleBottom) {
    delta = targetBottom - visibleBottom;
  } else {
    return false; // อยู่ในมุมมองอยู่แล้ว → ไม่ต้องเลื่อน
  }

  container.scrollTop = container.scrollTop + delta;
  return true;
}

// =============================================================================
// Highlight styles
// =============================================================================

export interface BlockHighlightState {
  isSelected: boolean;
  isNewlyAdded: boolean;
}

/**
 * คลาสสำหรับกรอบ block
 *
 * - newly-added มี priority สูงกว่า selected (block ใหม่ถูกเลือกด้วยเสมอ
 *   ตอนเพิ่งเพิ่ม → ให้ไฮไลต์สีเขียวเด่นกว่า)
 * - selected คงอยู่จนกว่าจะเลือก block อื่น
 */
export function getBlockHighlightClasses({
  isSelected,
  isNewlyAdded,
}: BlockHighlightState): string {
  if (isNewlyAdded) {
    return 'ring-2 ring-emerald-500 bg-emerald-50/40 shadow-md';
  }
  if (isSelected) {
    return 'ring-2 ring-blue-500 shadow-md';
  }
  return '';
}
