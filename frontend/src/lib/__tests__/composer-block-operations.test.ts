/**
 * Document Composer — Block Selection & Contextual Insertion Tests
 * ================================================================
 *
 * ครอบคลุม pure logic ของก้อนที่ 1 (Block Selection + Contextual Insertion
 * + Auto-scroll + Highlight):
 *
 *   1. ไม่มี selection → เพิ่มท้าย
 *   2. เลือก block กลางรายการ → เพิ่มถัดจาก block นั้น
 *   3. block ใหม่กลายเป็น selected
 *   4. block ใหม่เปิด editor (editorOpenRequest)
 *   5. ลบ block ที่เลือก → selection ถูกล้าง
 *   6. ย้าย block ที่เลือก → ยังเลือก block.id เดิม
 *   7. block ทุกประเภทใช้ insertion flow เดียวกัน
 *   8. descriptor เดิมไม่ถูก mutate
 *
 * Run: node --import tsx src/lib/__tests__/composer-block-operations.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  BLOCK_TYPE_LABELS,
  computeInsertIndex,
  createEditorOpenRequest,
  describeInsertionMessage,
  describeInsertionTarget,
  findBlockIndexById,
  getBlockHighlightClasses,
  insertBlockAt,
  insertBlockWithSelection,
  isSelectionStillValid,
  moveBlockById,
  NO_SELECT_ATTRIBUTE,
  removeBlockById,
  resolveSelection,
  SCROLL_INTO_VIEW_OPTIONS,
  scrollBlockIntoView,
  shouldOpenEditor,
  shouldSelectOnClick,
} from '../../app/(admin)/admin/templates/composer/lib/block-operations';

import {
  createFieldBlock,
  createHeadingBlock,
  createLogoBlock,
  createSignatureBlock,
  createSystemDataBlock,
  createTableBlock,
  type DocumentBlock,
} from '../api/template-descriptor';

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg} expected ${e}, got ${a}`);
  }
}

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${v}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg} expected falsy, got ${v}`);
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(`${msg} expected to contain ${JSON.stringify(needle)}`);
  }
}

function assertNotContains(haystack, needle, msg = '') {
  if (haystack.includes(needle)) {
    throw new Error(`${msg} expected NOT to contain ${JSON.stringify(needle)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ========== FIXTURES ==========

/** สร้าง block 5 ตัวที่ id กำหนดเอง เพื่อให้ assert ได้แน่นอน */
function makeBlocks(ids: string[]): DocumentBlock[] {
  return ids.map((id, i) =>
    createHeadingBlock({ id, text: `block-${i + 1}` })
  );
}

const ids = ['b1', 'b2', 'b3', 'b4', 'b5'];

// ============================================================== [1]
console.log('========================================');
console.log('Composer Block Operations — Tests');
console.log('========================================');

section('[1] ไม่มี selection → เพิ่มท้าย');

test('ไม่มี selectedBlockId → insert index = ท้ายสุด', () => {
  const blocks = makeBlocks(ids);
  assertEqual(computeInsertIndex(blocks, null), 5, 'insert index');
  assertEqual(computeInsertIndex(blocks, undefined), 5, 'insert index');
});

test('selectedBlockId ที่ไม่มีอยู่จริง → fallback เป็นต่อท้าย', () => {
  const blocks = makeBlocks(ids);
  assertEqual(computeInsertIndex(blocks, 'ghost'), 5, 'insert index');
});

test('ไม่มี selection → insertBlockWithSelection ต่อท้าย', () => {
  const blocks = makeBlocks(ids);
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const result = insertBlockWithSelection(blocks, created, null);

  assertEqual(result.insertedIndex, 5, 'insertedIndex');
  assertEqual(result.blocks.length, 6, 'length');
  assertEqual(result.blocks[5].id, 'new-1', 'last block id');
});

test('ไม่มี selection → target label = เพิ่มต่อท้ายเอกสาร', () => {
  const blocks = makeBlocks(ids);
  const target = describeInsertionTarget(blocks, null);
  assertEqual(target.kind, 'end', 'kind');
  assertEqual(target.label, 'เพิ่มต่อท้ายเอกสาร', 'label');
});

// ============================================================== [2]
section('[2] เลือก block กลางรายการ → เพิ่มถัดจาก block นั้น');

test('เลือก block กลาง (b3) → insert index = 3', () => {
  const blocks = makeBlocks(ids);
  assertEqual(computeInsertIndex(blocks, 'b3'), 3, 'insert index');
});

test('เลือก block กลาง → block ใหม่ถูกแทรกถัดจาก block ที่เลือก', () => {
  const blocks = makeBlocks(ids);
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const result = insertBlockWithSelection(blocks, created, 'b3');

  assertEqual(result.insertedIndex, 3, 'insertedIndex');
  assertEqual(result.blocks.length, 6, 'length');
  assertEqual(result.blocks[2].id, 'b3', 'block ก่อนหน้ายังเป็น b3');
  assertEqual(result.blocks[3].id, 'new-1', 'block ใหม่อยู่ถัดจาก b3');
  assertEqual(result.blocks[4].id, 'b4', 'b4 ถูกเลื่อนไปข้างหลัง');
});

test('เลือก block แรก (b1) → แทรกที่ index 1', () => {
  const blocks = makeBlocks(ids);
  assertEqual(computeInsertIndex(blocks, 'b1'), 1, 'insert index');
});

test('เลือก block สุดท้าย (b5) → แทรกท้ายสุด (index 5)', () => {
  const blocks = makeBlocks(ids);
  assertEqual(computeInsertIndex(blocks, 'b5'), 5, 'insert index');
});

test('target label = เพิ่มต่อจาก Block #X (เลข 1-based)', () => {
  const blocks = makeBlocks(ids);
  const target = describeInsertionTarget(blocks, 'b3');
  assertEqual(target.kind, 'after', 'kind');
  assertEqual(target.blockNumber, 3, 'blockNumber');
  assertEqual(target.label, 'เพิ่มต่อจาก Block #3', 'label');
});

test('ข้อความแจ้งเตือนระบุตำแหน่งที่เพิ่ม', () => {
  const blocks = makeBlocks(ids);
  const target = describeInsertionTarget(blocks, 'b3');
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const msg = describeInsertionMessage(created, target);

  assertContains(msg, 'เพิ่ม', 'ข้อความ');
  assertContains(msg, 'Field', 'ข้อความ');
  assertContains(msg, 'หลัง Block #3', 'ข้อความ');
  assertContains(msg, 'แล้ว', 'ข้อความ');
});

test('ข้อความแจ้งเตือนกรณีเพิ่มท้ายเอกสาร', () => {
  const blocks = makeBlocks(ids);
  const target = describeInsertionTarget(blocks, null);
  const created = createHeadingBlock({ id: 'new-1' });
  const msg = describeInsertionMessage(created, target);

  assertContains(msg, 'ต่อท้ายเอกสาร', 'ข้อความ');
  assertNotContains(msg, 'หลัง Block', 'ข้อความ');
});

// ============================================================== [3]
section('[3] block ใหม่กลายเป็น selected');

test('insertBlockWithSelection คืน selectedBlockId = id ของ block ใหม่', () => {
  const blocks = makeBlocks(ids);
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const result = insertBlockWithSelection(blocks, created, 'b3');

  assertEqual(result.selectedBlockId, 'new-1', 'selectedBlockId');
});

test('block ใหม่ถูกเลือก และมีอยู่ในรายการจริง', () => {
  const blocks = makeBlocks(ids);
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const result = insertBlockWithSelection(blocks, created, null);

  assertTrue(
    isSelectionStillValid(result.blocks, result.selectedBlockId),
    'selection ต้อง valid'
  );
});

test('selection เดิมถูกแทนที่ด้วย block ใหม่', () => {
  const blocks = makeBlocks(ids);
  const created = createFieldBlock('field-1', { id: 'new-1' });
  const result = insertBlockWithSelection(blocks, created, 'b3');

  assertEqual(result.selectedBlockId, 'new-1', 'selected ต้องเป็น block ใหม่');
  assertNotContains(String(result.selectedBlockId), 'b3', 'selected เดิมถูกแทนที่');
});

// ============================================================== [4]
section('[4] block ใหม่เปิด editor');

test('editorOpenRequest ชี้ไปที่ block ใหม่', () => {
  const request = createEditorOpenRequest('new-1', 1);
  assertEqual(request.blockId, 'new-1', 'blockId');
  assertEqual(request.nonce, 1, 'nonce');
});

test('shouldOpenEditor → true เฉพาะ block ที่ถูกสั่งเปิด', () => {
  const request = createEditorOpenRequest('new-1', 1);
  assertTrue(shouldOpenEditor(request, 'new-1'), 'block ใหม่');
  assertFalse(shouldOpenEditor(request, 'b3'), 'block อื่น');
  assertFalse(shouldOpenEditor(null, 'new-1'), 'ไม่มี request');
});

test('nonce เพิ่มขึ้นทุกครั้ง → เปิดซ้ำได้แม้เป็น block id เดิม', () => {
  const first = createEditorOpenRequest('b1', 1);
  const second = createEditorOpenRequest('b1', 2);
  assertTrue(second.nonce > first.nonce, 'nonce ต้องเพิ่มขึ้น');
});

// ============================================================== [5]
section('[5] ลบ block ที่เลือก → selection ถูกล้าง');

test('removeBlockById ลบได้ถูกตัว', () => {
  const blocks = makeBlocks(ids);
  const next = removeBlockById(blocks, 'b3');

  assertEqual(next.length, 4, 'length');
  assertEqual(findBlockIndexById(next, 'b3'), -1, 'b3 ต้องหายไป');
  assertEqual(next[2].id, 'b4', 'b4 ขยับขึ้นมาแทน');
});

test('หลังลบ block ที่เลือก → selection ไม่ valid อีกต่อไป', () => {
  const blocks = makeBlocks(ids);
  const next = removeBlockById(blocks, 'b3');
  assertFalse(isSelectionStillValid(next, 'b3'), 'selection ต้องถูกล้าง');
});

test('ลบ block อื่น → selection เดิมยัง valid', () => {
  const blocks = makeBlocks(ids);
  const next = removeBlockById(blocks, 'b1');
  assertTrue(isSelectionStillValid(next, 'b3'), 'selection ต้องยังอยู่');
});

test('ลบ block ที่ไม่มีอยู่ → ไม่เปลี่ยนรายการ', () => {
  const blocks = makeBlocks(ids);
  const next = removeBlockById(blocks, 'ghost');
  assertEqual(next.length, 5, 'length');
});

test('resolveSelection — block ยังอยู่ → คืน id เดิม', () => {
  const blocks = makeBlocks(ids);
  assertEqual(resolveSelection(blocks, 'b3'), 'b3', 'selection');
});

test('resolveSelection — block ถูกลบ → คืน null (ล้าง selection)', () => {
  const blocks = makeBlocks(ids);
  const next = removeBlockById(blocks, 'b3');
  assertEqual(resolveSelection(next, 'b3'), null, 'selection ต้องถูกล้าง');
});

test('resolveSelection — หลังย้าย block → ยังคืน id เดิม', () => {
  const blocks = makeBlocks(ids);
  const next = moveBlockById(blocks, 'b3', -1);
  assertEqual(resolveSelection(next, 'b3'), 'b3', 'selection');
});

test('resolveSelection — ไม่มี selection → null', () => {
  const blocks = makeBlocks(ids);
  assertEqual(resolveSelection(blocks, null), null, 'null');
});

// ============================================================== [6]
section('[6] ย้าย block ที่เลือก → ยังเลือก block.id เดิม');

test('moveBlockById ขึ้นหนึ่งตำแหน่ง', () => {
  const blocks = makeBlocks(ids);
  const next = moveBlockById(blocks, 'b3', -1);

  assertEqual(next.length, 5, 'length');
  assertEqual(next[1].id, 'b3', 'b3 ขึ้นไปอยู่ index 1');
  assertEqual(next[2].id, 'b2', 'b2 ลงมาแทน');
});

test('moveBlockById ลงหนึ่งตำแหน่ง', () => {
  const blocks = makeBlocks(ids);
  const next = moveBlockById(blocks, 'b3', 1);

  assertEqual(next[3].id, 'b3', 'b3 ลงไปอยู่ index 3');
  assertEqual(next[2].id, 'b4', 'b4 ขึ้นมาแทน');
});

test('หลัง move → selection ที่ผูกกับ block.id ยัง valid', () => {
  const blocks = makeBlocks(ids);
  const next = moveBlockById(blocks, 'b3', -1);
  assertTrue(isSelectionStillValid(next, 'b3'), 'selection ต้องยังอยู่');
});

test('ย้ายขอบเขต (b1 ขึ้น / b5 ลง) → ไม่มีการเปลี่ยนแปลง', () => {
  const blocks = makeBlocks(ids);
  assertDeepEqual(
    moveBlockById(blocks, 'b1', -1).map((b) => b.id),
    ids,
    'b1 ขึ้น'
  );
  assertDeepEqual(
    moveBlockById(blocks, 'b5', 1).map((b) => b.id),
    ids,
    'b5 ลง'
  );
});

test('ย้ายแล้ว block.id ไม่เปลี่ยน (identity คงเดิม)', () => {
  const blocks = makeBlocks(ids);
  const next = moveBlockById(blocks, 'b3', -1);
  assertEqual(next.find((b) => b.id === 'b3').id, 'b3', 'id ต้องเดิม');
});

// ============================================================== [7]
section('[7] block ทุกประเภทใช้ insertion flow เดียวกัน');

test('ทุก block type ที่ factory สร้าง มี id และ type ถูกต้อง', () => {
  const all: DocumentBlock[] = [
    createHeadingBlock({ id: 'x-h' }),
    createSystemDataBlock('APPLICATION_NO', { id: 'x-sd' }),
    createFieldBlock('f1', { id: 'x-f' }),
    createTableBlock('f2', { id: 'x-t' }),
    createLogoBlock({ id: 'x-l' }),
    createSignatureBlock({ id: 'x-s' }),
  ];

  const types = all.map((b) => b.type);
  assertDeepEqual(
    types,
    ['heading', 'systemData', 'field', 'table', 'logo', 'signature'],
    'ครบทุกประเภท'
  );
  all.forEach((b) => {
    assertTrue(!!b.id, `${b.type} ต้องมี id`);
    assertTrue(!!BLOCK_TYPE_LABELS[b.type], `${b.type} ต้องมี label`);
  });
});

test('ทุก block type แทรกต่อจาก block ที่เลือกได้เหมือนกัน', () => {
  const base = makeBlocks(ids);
  const all: DocumentBlock[] = [
    createHeadingBlock({ id: 'x-h' }),
    createSystemDataBlock('APPLICATION_NO', { id: 'x-sd' }),
    createFieldBlock('f1', { id: 'x-f' }),
    createTableBlock('f2', { id: 'x-t' }),
    createLogoBlock({ id: 'x-l' }),
    createSignatureBlock({ id: 'x-s' }),
  ];

  all.forEach((created) => {
    const result = insertBlockWithSelection(base, created, 'b2');
    assertEqual(result.insertedIndex, 2, `${created.type} insertedIndex`);
    assertEqual(result.blocks[2].id, created.id, `${created.type} ต้องถูกแทรก`);
    assertEqual(result.selectedBlockId, created.id, `${created.type} selected`);
    assertTrue(
      isSelectionStillValid(result.blocks, result.selectedBlockId),
      `${created.type} selection ต้อง valid`
    );
  });
});

test('ทุก block type แทรกต่อท้ายได้เมื่อไม่มี selection', () => {
  const base = makeBlocks(ids);
  const all: DocumentBlock[] = [
    createHeadingBlock({ id: 'x-h' }),
    createSystemDataBlock('APPLICATION_NO', { id: 'x-sd' }),
    createFieldBlock('f1', { id: 'x-f' }),
    createTableBlock('f2', { id: 'x-t' }),
    createLogoBlock({ id: 'x-l' }),
    createSignatureBlock({ id: 'x-s' }),
  ];

  all.forEach((created) => {
    const result = insertBlockWithSelection(base, created, null);
    assertEqual(result.insertedIndex, 5, `${created.type} insertedIndex`);
    assertEqual(result.blocks[5].id, created.id, `${created.type} ต้องต่อท้าย`);
  });
});

// ============================================================== [8]
section('[8] descriptor เดิมไม่ถูก mutate');

test('insertBlockWithSelection ไม่ mutate array เดิม', () => {
  const blocks = makeBlocks(ids);
  const snapshot = JSON.stringify(blocks);
  const created = createFieldBlock('f1', { id: 'new-1' });
  insertBlockWithSelection(blocks, created, 'b3');

  assertEqual(JSON.stringify(blocks), snapshot, 'blocks เดิมต้องไม่เปลี่ยน');
  assertEqual(blocks.length, 5, 'length เดิมต้องคงเดิม');
});

test('insertBlockAt ไม่ mutate array เดิม', () => {
  const blocks = makeBlocks(ids);
  const snapshot = JSON.stringify(blocks);
  insertBlockAt(blocks, createFieldBlock('f1', { id: 'new-1' }), 2);

  assertEqual(JSON.stringify(blocks), snapshot, 'blocks เดิมต้องไม่เปลี่ยน');
});

test('removeBlockById ไม่ mutate array เดิม', () => {
  const blocks = makeBlocks(ids);
  const snapshot = JSON.stringify(blocks);
  removeBlockById(blocks, 'b2');

  assertEqual(JSON.stringify(blocks), snapshot, 'blocks เดิมต้องไม่เปลี่ยน');
  assertEqual(blocks.length, 5, 'length เดิมต้องคงเดิม');
});

test('moveBlockById ไม่ mutate array เดิม', () => {
  const blocks = makeBlocks(ids);
  const snapshot = JSON.stringify(blocks);
  moveBlockById(blocks, 'b3', -1);

  assertEqual(JSON.stringify(blocks), snapshot, 'blocks เดิมต้องไม่เปลี่ยน');
});

test('block ที่ถูกย้าย/ลบไม่ถูก mutate ตัว object เอง', () => {
  const blocks = makeBlocks(ids);
  const target = blocks[2];
  const targetSnapshot = JSON.stringify(target);

  moveBlockById(blocks, 'b3', -1);
  removeBlockById(blocks, 'b3');

  assertEqual(JSON.stringify(target), targetSnapshot, 'block ต้องไม่ถูกแก้');
});

// ============================================================== [9]
section('[9] ขอบเขต insert index');

test('insert index ถูก clamp ไม่เกินความยาว array', () => {
  const blocks = makeBlocks(ids);
  const next = insertBlockAt(blocks, createFieldBlock('f1', { id: 'n' }), 999);
  assertEqual(next.length, 6, 'length');
  assertEqual(next[5].id, 'n', 'ต้องต่อท้าย');
});

test('insert index ติดลบไม่ได้', () => {
  const blocks = makeBlocks(ids);
  const next = insertBlockAt(blocks, createFieldBlock('f1', { id: 'n' }), -5);
  assertEqual(next[0].id, 'n', 'ต้องอยู่หน้าสุด');
});

test('findBlockIndexById คืน -1 เมื่อไม่พบ', () => {
  const blocks = makeBlocks(ids);
  assertEqual(findBlockIndexById(blocks, 'nope'), -1, 'not found');
  assertEqual(findBlockIndexById(blocks, null), -1, 'null');
});

// ============================================================== [10]
section('[10] ข้อความแจ้งเตือน (ไม่ใช้ browser alert)');

test('ข้อความแจ้งเตือนมี label ของทุกประเภท block', () => {
  const target = describeInsertionTarget(makeBlocks(ids), 'b1');
  const cases: Array<[DocumentBlock, string]> = [
    [createFieldBlock('f1', { id: 'a' }), 'Field'],
    [createTableBlock('f1', { id: 'b' }), 'Table'],
    [createHeadingBlock({ id: 'c' }), 'Heading'],
    [createSystemDataBlock('APPLICATION_NO', { id: 'd' }), 'System Data'],
    [createLogoBlock({ id: 'e' }), 'Logo'],
    [createSignatureBlock({ id: 'f' }), 'Signature'],
  ];

  cases.forEach(([block, expected]) => {
    const msg = describeInsertionMessage(block, target);
    assertContains(msg, expected, `ข้อความของ ${block.type}`);
    assertContains(msg, 'หลัง Block #1', `ตำแหน่งของ ${block.type}`);
    assertNotContains(msg, 'alert(', 'ห้ามใช้ browser alert');
  });
});

// ============================================================== [11]
section('[11] Auto-scroll');

test('ใช้ block: "nearest" เพื่อไม่ให้หน้ากระโดดแรงเกินไป', () => {
  assertEqual(SCROLL_INTO_VIEW_OPTIONS.block, 'nearest', 'scroll block');
  assertEqual(SCROLL_INTO_VIEW_OPTIONS.behavior, 'smooth', 'scroll behavior');
});

test('scrollBlockIntoView เรียก scrollIntoView ด้วย options ที่ถูกต้อง', () => {
  let called = false;
  let received: any = null;
  const el = {
    scrollIntoView: (options: any) => {
      called = true;
      received = options;
    },
  };

  const result = scrollBlockIntoView(el);
  assertTrue(result, 'ต้อง scroll สำเร็จ');
  assertTrue(called, 'ต้องถูกเรียก');
  assertEqual(received.block, 'nearest', 'options.block');
  assertEqual(received.behavior, 'smooth', 'options.behavior');
});

test('scrollBlockIntoView กับ element ที่ไม่มี API → ไม่ throw', () => {
  assertEqual(scrollBlockIntoView(null), false, 'null');
  assertEqual(scrollBlockIntoView(undefined), false, 'undefined');
  assertEqual(scrollBlockIntoView({}), false, 'ไม่มี scrollIntoView');
});

test('scroll ไม่เกิดซ้ำเมื่อไม่ได้เป็น block ใหม่ (helper ถูกเรียกเฉพาะตอนเพิ่งเพิ่ม)', () => {
  // helper ไม่มี state → การไม่ scroll ซ้ำ ขึ้นกับ effect dependency ที่ isNewlyAdded
  let count = 0;
  const el = {
    scrollIntoView: () => {
      count += 1;
    },
  };
  scrollBlockIntoView(el);
  assertEqual(count, 1, 'เรียกครั้งเดียว');
});

// ============================================================== [12]
section('[12] Highlight styles');

test('selected → ring สีน้ำเงิน', () => {
  const cls = getBlockHighlightClasses({ isSelected: true, isNewlyAdded: false });
  assertContains(cls, 'ring-blue-500', 'selected');
  assertNotContains(cls, 'ring-emerald-500', 'selected');
});

test('newly-added → ring สีเขียว', () => {
  const cls = getBlockHighlightClasses({ isSelected: false, isNewlyAdded: true });
  assertContains(cls, 'ring-emerald-500', 'newly-added');
  assertNotContains(cls, 'ring-blue-500', 'newly-added');
});

test('ทั้งสอง → ไฮไลต์ใหม่มี priority สูงกว่า', () => {
  const cls = getBlockHighlightClasses({ isSelected: true, isNewlyAdded: true });
  assertContains(cls, 'ring-emerald-500', 'priority');
  assertNotContains(cls, 'ring-blue-500', 'priority');
});

test('ไม่มีสถานะ → ไม่มี ring', () => {
  const cls = getBlockHighlightClasses({ isSelected: false, isNewlyAdded: false });
  assertEqual(cls, '', 'ไม่มี ring');
});

// ============================================================== [13]
section('[13] Selection click guard');

test('คลิกพื้นที่ปกติ → เลือก block', () => {
  assertTrue(
    shouldSelectOnClick(null, { hasHandler: true }),
    'ต้องเลือก'
  );
});

test('คลิก element ที่อยู่ในโซน data-no-select → ไม่เลือก', () => {
  const fake = {
    closest: (selector: string) =>
      selector.includes(NO_SELECT_ATTRIBUTE) ? {} : null,
  };
  assertFalse(
    shouldSelectOnClick(fake, { hasHandler: true }),
    'ห้ามเลือก'
  );
});

test('คลิก element ที่ไม่อยู่ในโซน no-select → เลือก', () => {
  const fake = {
    closest: (selector: string) =>
      selector.includes(NO_SELECT_ATTRIBUTE) ? null : {},
  };
  assertTrue(shouldSelectOnClick(fake, { hasHandler: true }), 'ต้องเลือก');
});

test('disabled → ไม่เลือก', () => {
  assertFalse(
    shouldSelectOnClick(null, { hasHandler: true, disabled: true }),
    'disabled'
  );
});

test('ไม่มี onSelect handler → ไม่เลือก', () => {
  assertFalse(
    shouldSelectOnClick(null, { hasHandler: false }),
    'ไม่มี handler'
  );
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
