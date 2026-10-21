/**
 * Document Composer — Workspace Layout Tests (ก้อนที่ 2)
 * ================================================================
 *
 * ครอบคลุม pure logic ของ Responsive Composer Workspace Layout:
 *
 *   1.  ค่าเริ่มต้นของ split อยู่ในช่วงที่กำหนด
 *   2.  split ต่ำกว่าค่าต่ำสุด → clamp
 *   3.  split สูงกว่าค่าสูงสุด → clamp
 *   4.  reset คืนค่า default
 *   5.  malformed localStorage → fallback
 *   6.  sidebar collapsed state อ่าน/บันทึกได้
 *   7.  keyboard resize ซ้าย/ขวา
 *   8.  keyboard resize ไม่เกินขอบเขต
 *   9.  resize state ไม่เปลี่ยน DocumentDescriptor
 *   10. responsive mode เลือก layout ถูกต้อง
 *   11. mobile tab เปลี่ยนโดยไม่ล้าง selection
 *   12. preview trigger signature ไม่เปลี่ยนเมื่อสลับแท็บ
 *   13. safe localStorage (ไม่ throw เมื่อ storage พัง)
 *
 * Run: node --import tsx src/lib/__tests__/composer-workspace-layout.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import {
  buildWorkspaceActions,
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  DEFAULT_WORKSPACE_LAYOUT,
  KEYBOARD_RESIZE_STEP,
  MAX_SPLIT_RATIO,
  MIN_PANEL_WIDTH,
  MIN_SPLIT_RATIO,
  parseStoredSidebarCollapsed,
  parseStoredSplitRatio,
  previewTriggerSignature,
  readWorkspacePreference,
  resetWorkspaceLayout,
  resizeRatioByKey,
  resolveSplitBounds,
  resolveWorkspaceLayoutMode,
  serializeSidebarCollapsed,
  serializeSplitRatio,
  splitRatioFromClientX,
  WORKSPACE_BREAKPOINTS,
  WORKSPACE_STORAGE_KEYS,
  writeWorkspacePreference,
  workspaceUiReducer,
} from '../../app/(admin)/admin/templates/composer/lib/workspace-layout';

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

function assertTrue(v, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${v}`);
}

function assertFalse(v, msg = '') {
  if (v) throw new Error(`${msg} expected falsy, got ${v}`);
}

function assertClose(actual, expected, tolerance, msg = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${msg} expected ~${expected} (±${tolerance}), got ${actual}`
    );
  }
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(
      `${msg} expected to contain ${JSON.stringify(needle)}\n  got: ${haystack}`
    );
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ========== FIXTURES ==========

/** Storage จำลอง (in-memory) */
function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    _dump: () => Object.fromEntries(map.entries()),
  };
}

// ============================================================== [1]
console.log('========================================');
console.log('Composer Workspace Layout — Tests');
console.log('========================================');

section('[1] ค่าเริ่มต้นของ split อยู่ในช่วงที่กำหนด');

test('DEFAULT_SPLIT_RATIO = 0.5', () => {
  assertEqual(DEFAULT_SPLIT_RATIO, 0.5, 'default ratio');
});

test('default ratio อยู่ในช่วง [MIN_SPLIT_RATIO, MAX_SPLIT_RATIO]', () => {
  assertTrue(DEFAULT_SPLIT_RATIO >= MIN_SPLIT_RATIO, 'ต้อง >= min');
  assertTrue(DEFAULT_SPLIT_RATIO <= MAX_SPLIT_RATIO, 'ต้อง <= max');
});

test('default ratio อยู่ในช่วงที่ resolveSplitBounds กำหนด', () => {
  const bounds = resolveSplitBounds(1600);
  assertTrue(
    DEFAULT_SPLIT_RATIO >= bounds.min && DEFAULT_SPLIT_RATIO <= bounds.max,
    `default ต้องอยู่ใน [${bounds.min}, ${bounds.max}]`
  );
});

test('default ratio อยู่ในช่วงที่ resolveSplitBounds กำหนด (พื้นที่แคบ)', () => {
  const bounds = resolveSplitBounds(900);
  assertTrue(
    DEFAULT_SPLIT_RATIO >= bounds.min && DEFAULT_SPLIT_RATIO <= bounds.max,
    `default ต้องอยู่ใน [${bounds.min}, ${bounds.max}]`
  );
});

test('MIN_PANEL_WIDTH = 420 (ตามสเปก)', () => {
  assertEqual(MIN_PANEL_WIDTH, 420, 'min panel width');
});

// ============================================================== [2]
section('[2] split ต่ำกว่าค่าต่ำสุด → clamp');

test('clampSplitRatio(0.1) → ไม่ต่ำกว่า MIN_SPLIT_RATIO', () => {
  const result = clampSplitRatio(0.1);
  assertTrue(result >= MIN_SPLIT_RATIO, 'ต้อง clamp ขึ้น');
  assertEqual(result, MIN_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio(0) → MIN_SPLIT_RATIO', () => {
  assertEqual(clampSplitRatio(0), MIN_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio(-5) → MIN_SPLIT_RATIO', () => {
  assertEqual(clampSplitRatio(-5), MIN_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio ที่พื้นที่กว้างพอ → บังคับ min panel width 420px', () => {
  // container 1200px → 420/1200 = 0.35 → min = 0.35
  const result = clampSplitRatio(0.1, 1200);
  assertClose(result, 420 / 1200, 0.0001, 'min ต้องมาจาก MIN_PANEL_WIDTH');
});

test('clampSplitRatio ที่พื้นที่กว้างพอ → ค่าในช่วงที่ยังคงได้ถูกต้อง', () => {
  const result = clampSplitRatio(0.5, 1200);
  assertClose(result, 0.5, 0.0001, 'ค่าปกติต้องไม่ถูกแก้');
});

// ============================================================== [3]
section('[3] split สูงกว่าค่าสูงสุด → clamp');

test('clampSplitRatio(0.95) → ไม่สูงกว่า MAX_SPLIT_RATIO', () => {
  const result = clampSplitRatio(0.95);
  assertTrue(result <= MAX_SPLIT_RATIO, 'ต้อง clamp ลง');
  assertEqual(result, MAX_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio(1) → MAX_SPLIT_RATIO', () => {
  assertEqual(clampSplitRatio(1), MAX_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio(99) → MAX_SPLIT_RATIO', () => {
  assertEqual(clampSplitRatio(99), MAX_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio ที่พื้นที่กว้างพอ → บังคับ min panel width ของ Preview ด้วย', () => {
  // container 1200px → max = 1 - 0.35 = 0.65
  const result = clampSplitRatio(0.9, 1200);
  assertClose(result, 1 - 420 / 1200, 0.0001, 'max ต้องมาจาก MIN_PANEL_WIDTH');
});

test('clampSplitRatio(NaN) → default', () => {
  assertEqual(clampSplitRatio(NaN), DEFAULT_SPLIT_RATIO, 'ค่า');
});

test('clampSplitRatio(Infinity) → default', () => {
  assertEqual(clampSplitRatio(Infinity), DEFAULT_SPLIT_RATIO, 'ค่า');
});

// ============================================================== [4]
section('[4] reset คืนค่า default');

test('resetWorkspaceLayout คืนค่าเริ่มต้น', () => {
  const result = resetWorkspaceLayout();
  assertEqual(result.splitRatio, DEFAULT_WORKSPACE_LAYOUT.splitRatio, 'splitRatio');
  assertEqual(
    result.sidebarCollapsed,
    DEFAULT_WORKSPACE_LAYOUT.sidebarCollapsed,
    'sidebarCollapsed'
  );
});

test('resetWorkspaceLayout คืนค่าเริ่มต้นแม้ก่อนหน้าเปลี่ยนไปแล้ว', () => {
  const changed = { splitRatio: 0.8, sidebarCollapsed: true };
  const result = resetWorkspaceLayout();
  assertEqual(result.splitRatio, changed.splitRatio ? 0.5 : 0.5, 'splitRatio');
  assertFalse(result.sidebarCollapsed, 'sidebarCollapsed');
});

test('reset คืนค่า default ที่ยังผ่าน clamp ได้', () => {
  const result = resetWorkspaceLayout();
  const clamped = clampSplitRatio(result.splitRatio, 1200);
  assertClose(clamped, result.splitRatio, 0.0001, 'ค่า default ต้อง clamp ไม่เปลี่ยน');
});

// ============================================================== [5]
section('[5] malformed localStorage → fallback');

test('parseStoredSplitRatio(null) → default', () => {
  assertEqual(parseStoredSplitRatio(null), DEFAULT_SPLIT_RATIO, 'null');
});

test('parseStoredSplitRatio(undefined) → default', () => {
  assertEqual(parseStoredSplitRatio(undefined), DEFAULT_SPLIT_RATIO, 'undefined');
});

test('parseStoredSplitRatio("") → default', () => {
  assertEqual(parseStoredSplitRatio(''), DEFAULT_SPLIT_RATIO, 'ค่าว่าง');
});

test('parseStoredSplitRatio("abc") → default', () => {
  assertEqual(parseStoredSplitRatio('abc'), DEFAULT_SPLIT_RATIO, 'ค่าผิดรูป');
});

test('parseStoredSplitRatio("NaN") → default', () => {
  assertEqual(parseStoredSplitRatio('NaN'), DEFAULT_SPLIT_RATIO, 'NaN');
});

test('parseStoredSplitRatio("null") → default', () => {
  assertEqual(parseStoredSplitRatio('null'), DEFAULT_SPLIT_RATIO, 'null string');
});

test('parseStoredSplitRatio("{oops") → default', () => {
  assertEqual(parseStoredSplitRatio('{oops'), DEFAULT_SPLIT_RATIO, 'JSON ผิดรูป');
});

test('parseStoredSplitRatio("0.9") → clamp ลงเป็น MAX', () => {
  assertEqual(parseStoredSplitRatio('0.9'), MAX_SPLIT_RATIO, 'เกินขอบเขต');
});

test('parseStoredSplitRatio("0.1") → clamp ขึ้นเป็น MIN', () => {
  assertEqual(parseStoredSplitRatio('0.1'), MIN_SPLIT_RATIO, 'ต่ำกว่าขอบเขต');
});

test('parseStoredSplitRatio("0.42") → 0.42', () => {
  assertClose(parseStoredSplitRatio('0.42'), 0.42, 0.0001, 'ค่าปกติ');
});

test('readWorkspacePreference กับ storage ที่โยน error → ไม่ throw', () => {
  const broken = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
  let result = 'not-called';
  try {
    result = readWorkspacePreference('x', broken);
  } catch (e) {
    throw new Error(`ต้องไม่ throw: ${e?.message}`);
  }
  assertEqual(result, null, 'ค่า');
});

test('writeWorkspacePreference กับ storage ที่โยน error → false ไม่ throw', () => {
  const broken = {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  let ok = true;
  try {
    ok = writeWorkspacePreference('x', '1', broken);
  } catch (e) {
    throw new Error(`ต้องไม่ throw: ${e?.message}`);
  }
  assertFalse(ok, 'ต้องคืน false');
});

// ============================================================== [6]
section('[6] sidebar collapsed state อ่าน/บันทึกได้');

test('parseStoredSidebarCollapsed("1") → true', () => {
  assertEqual(parseStoredSidebarCollapsed('1'), true, '1');
});

test('parseStoredSidebarCollapsed("true") → true', () => {
  assertEqual(parseStoredSidebarCollapsed('true'), true, 'true');
});

test('parseStoredSidebarCollapsed("0") → false', () => {
  assertEqual(parseStoredSidebarCollapsed('0'), false, '0');
});

test('parseStoredSidebarCollapsed("false") → false', () => {
  assertEqual(parseStoredSidebarCollapsed('false'), false, 'false');
});

test('parseStoredSidebarCollapsed("garbage") → false (fallback)', () => {
  assertEqual(parseStoredSidebarCollapsed('garbage'), false, 'garbage');
});

test('parseStoredSidebarCollapsed(null) → false', () => {
  assertEqual(parseStoredSidebarCollapsed(null), false, 'null');
});

test('serializeSidebarCollapsed(true) → "1"', () => {
  assertEqual(serializeSidebarCollapsed(true), '1', 'serialize');
});

test('serializeSidebarCollapsed(false) → "0"', () => {
  assertEqual(serializeSidebarCollapsed(false), '0', 'serialize');
});

test('เขียนแล้วอ่านกลับได้ค่าเดิม (round trip)', () => {
  const storage = createMemoryStorage();
  writeWorkspacePreference(
    WORKSPACE_STORAGE_KEYS.sidebarCollapsed,
    serializeSidebarCollapsed(true),
    storage
  );
  const raw = readWorkspacePreference(
    WORKSPACE_STORAGE_KEYS.sidebarCollapsed,
    storage
  );
  assertEqual(parseStoredSidebarCollapsed(raw), true, 'round trip');
});

test('ค่า splitRatio เขียน/อ่านกลับได้ค่าเดิม (round trip)', () => {
  const storage = createMemoryStorage();
  writeWorkspacePreference(
    WORKSPACE_STORAGE_KEYS.splitRatio,
    serializeSplitRatio(0.37),
    storage
  );
  const raw = readWorkspacePreference(WORKSPACE_STORAGE_KEYS.splitRatio, storage);
  assertClose(parseStoredSplitRatio(raw), 0.37, 0.0001, 'round trip');
});

test('localStorage key มี namespace ชัดเจน', () => {
  assertContains(WORKSPACE_STORAGE_KEYS.sidebarCollapsed, 'composer.workspace.', 'key');
  assertContains(WORKSPACE_STORAGE_KEYS.splitRatio, 'composer.workspace.', 'key');
});

test('localStorage ไม่เก็บ descriptor / token / ข้อมูลผู้สมัคร', () => {
  const keys = Object.values(WORKSPACE_STORAGE_KEYS);
  keys.forEach((key) => {
    assertFalse(/descriptor|token|applicant|application/i.test(key), `key: ${key}`);
  });
});

// ============================================================== [7]
section('[7] keyboard resize ซ้าย/ขวา');

test('ArrowRight เพิ่มสัดส่วนทีละขั้น', () => {
  const next = resizeRatioByKey(0.5, 'ArrowRight');
  assertClose(next, 0.5 + KEYBOARD_RESIZE_STEP, 0.0001, 'ขวา');
});

test('ArrowLeft ลดสัดส่วนทีละขั้น', () => {
  const next = resizeRatioByKey(0.5, 'ArrowLeft');
  assertClose(next, 0.5 - KEYBOARD_RESIZE_STEP, 0.0001, 'ซ้าย');
});

test('ArrowRight ทำงานจากค่าที่ไม่ใช่ 0.5 ด้วย', () => {
  const next = resizeRatioByKey(0.3, 'ArrowRight');
  assertClose(next, 0.3 + KEYBOARD_RESIZE_STEP, 0.0001, 'ขวา');
});

test('Home → ไปค่าต่ำสุด', () => {
  const next = resizeRatioByKey(0.5, 'Home');
  assertEqual(next, resolveSplitBounds(0).min, 'Home');
});

test('End → ไปค่าสูงสุด', () => {
  const next = resizeRatioByKey(0.5, 'End');
  assertEqual(next, resolveSplitBounds(0).max, 'End');
});

test('ปุ่มอื่นที่ไม่รู้จัก → ค่าเดิม', () => {
  const next = resizeRatioByKey(0.42, 'PageDown');
  assertClose(next, 0.42, 0.0001, 'ไม่เปลี่ยน');
});

// ============================================================== [8]
section('[8] keyboard resize ไม่เกินขอบเขต');

test('ArrowLeft ที่ค่าต่ำสุด → ไม่ต่ำกว่า MIN', () => {
  const next = resizeRatioByKey(MIN_SPLIT_RATIO, 'ArrowLeft');
  assertEqual(next, MIN_SPLIT_RATIO, 'ไม่เกินขอบเขต');
});

test('ArrowRight ที่ค่าสูงสุด → ไม่สูงกว่า MAX', () => {
  const next = resizeRatioByKey(MAX_SPLIT_RATIO, 'ArrowRight');
  assertEqual(next, MAX_SPLIT_RATIO, 'ไม่เกินขอบเขต');
});

test('ArrowRight ซ้ำ ๆ จากค่าสูงสุด → ยังไม่เกิน MAX', () => {
  let value = MAX_SPLIT_RATIO;
  for (let i = 0; i < 10; i += 1) {
    value = resizeRatioByKey(value, 'ArrowRight');
  }
  assertTrue(value <= MAX_SPLIT_RATIO, 'ต้องไม่เกิน MAX');
  assertClose(value, MAX_SPLIT_RATIO, 0.0001, 'ต้องเท่า MAX');
});

test('ArrowLeft ซ้ำ ๆ จากค่าต่ำสุด → ยังไม่ต่ำกว่า MIN', () => {
  let value = MIN_SPLIT_RATIO;
  for (let i = 0; i < 10; i += 1) {
    value = resizeRatioByKey(value, 'ArrowLeft');
  }
  assertTrue(value >= MIN_SPLIT_RATIO, 'ต้องไม่ต่ำกว่า MIN');
  assertClose(value, MIN_SPLIT_RATIO, 0.0001, 'ต้องเท่า MIN');
});

test('keyboard resize ที่พื้นที่แคบ → clamp ตาม MIN_PANEL_WIDTH', () => {
  const next = resizeRatioByKey(0.3, 'ArrowLeft', { containerWidth: 1200 });
  assertTrue(next >= 420 / 1200 - 0.0001, 'ต้องไม่ต่ำกว่า min panel width');
});

test('keyboard resize ที่ค่า NaN → ใช้ default', () => {
  const next = resizeRatioByKey(NaN, 'ArrowRight');
  assertClose(next, DEFAULT_SPLIT_RATIO + KEYBOARD_RESIZE_STEP, 0.0001, 'ค่า');
});

// ============================================================== [9]
section('[9] resize state ไม่เปลี่ยน DocumentDescriptor');

test('helper ของ layout ไม่แตะ descriptor เลย', () => {
  const descriptor = {
    version: 1,
    blocks: [
      { id: 'b1', type: 'heading', text: 'หัวข้อ' },
      { id: 'b2', type: 'field', fieldId: 'f1' },
    ],
  };
  const snapshot = JSON.stringify(descriptor);

  clampSplitRatio(0.9, 1000);
  resizeRatioByKey(0.5, 'ArrowRight', { containerWidth: 1400 });
  resetWorkspaceLayout();
  splitRatioFromClientX(300, { left: 0, width: 1000 });

  assertEqual(JSON.stringify(descriptor), snapshot, 'descriptor ต้องไม่เปลี่ยน');
});

test('splitRatioFromClientX คืนค่าเป็น ratio ไม่แตะ descriptor', () => {
  const result = splitRatioFromClientX(250, { left: 0, width: 1000 });
  assertClose(result, 0.25, 0.0001, 'ratio');
});

test('splitRatioFromClientX ถ้าคลิกนอกพื้นที่ → 0 หรือ 1', () => {
  assertEqual(splitRatioFromClientX(-50, { left: 0, width: 1000 }), 0, 'ซ้ายเกิน');
  assertEqual(splitRatioFromClientX(2000, { left: 0, width: 1000 }), 1, 'ขวาเกิน');
});

test('splitRatioFromClientX พื้นที่ width = 0 → default', () => {
  assertEqual(
    splitRatioFromClientX(100, { left: 0, width: 0 }),
    DEFAULT_SPLIT_RATIO,
    'กันหารด้วย 0'
  );
});

// ============================================================== [10]
section('[10] responsive mode เลือก layout ถูกต้อง');

test('จอกว้างมาก (1920) → desktop', () => {
  assertEqual(resolveWorkspaceLayoutMode(1920), 'desktop', 'desktop');
});

test('จอ 1280 → desktop', () => {
  assertEqual(resolveWorkspaceLayoutMode(1280), 'desktop', 'desktop');
});

test('จอ 1279 → laptop', () => {
  assertEqual(resolveWorkspaceLayoutMode(1279), 'laptop', 'laptop');
});

test('จอ 1024 → laptop', () => {
  assertEqual(resolveWorkspaceLayoutMode(1024), 'laptop', 'laptop');
});

test('จอ 1023 → mobile', () => {
  assertEqual(resolveWorkspaceLayoutMode(1023), 'mobile', 'mobile');
});

test('จอ 768 → mobile', () => {
  assertEqual(resolveWorkspaceLayoutMode(768), 'mobile', 'mobile');
});

test('ค่าแปลก ๆ (0 / NaN) → desktop (fallback ปลอดภัย)', () => {
  assertEqual(resolveWorkspaceLayoutMode(0), 'desktop', '0');
  assertEqual(resolveWorkspaceLayoutMode(NaN), 'desktop', 'NaN');
});

test('breakpoint ตรงกับ Tailwind lg (1024px)', () => {
  assertEqual(WORKSPACE_BREAKPOINTS.laptop, 1024, 'laptop breakpoint');
});

// ============================================================== [11]
section('[11] mobile tab เปลี่ยนโดยไม่ล้าง selection');

test('เปลี่ยนแท็บ → เปลี่ยนเฉพาะ activeTab', () => {
  const state = {
    activeTab: 'composer',
    selectedBlockId: 'b3',
  };
  const next = workspaceUiReducer(state, { type: 'setTab', tab: 'preview' });
  assertEqual(next.activeTab, 'preview', 'แท็บ');
});

test('เปลี่ยนแท็บ → selectedBlockId ไม่หาย', () => {
  const state = {
    activeTab: 'composer',
    selectedBlockId: 'b3',
  };
  const next = workspaceUiReducer(state, { type: 'setTab', tab: 'preview' });
  assertEqual(next.selectedBlockId, 'b3', 'selection ต้องยังอยู่');
});

test('สลับไป-กลับมา → selection ยังอยู่', () => {
  let state = { activeTab: 'composer', selectedBlockId: 'b7' };
  state = workspaceUiReducer(state, { type: 'setTab', tab: 'preview' });
  state = workspaceUiReducer(state, { type: 'setTab', tab: 'composer' });
  assertEqual(state.selectedBlockId, 'b7', 'selection ต้องยังอยู่');
});

test('เลือกแท็บเดิม → state เดิม (ไม่ re-render เกินจำเป็น)', () => {
  const state = { activeTab: 'composer', selectedBlockId: 'b3' };
  const next = workspaceUiReducer(state, { type: 'setTab', tab: 'composer' });
  assertTrue(next === state, 'ต้องคืน state เดิม');
});

// ============================================================== [12]
section('[12] สลับแท็บไม่สร้าง Preview request ใหม่');

test('previewTriggerSignature เปลี่ยนเมื่อ descriptor เปลี่ยน', () => {
  const a = previewTriggerSignature({
    descriptor: { version: 1, blocks: [] },
    descriptorText: '{"version":1,"blocks":[]}',
    isTextValid: true,
    dataSource: { mode: 'sample' },
  });
  const b = previewTriggerSignature({
    descriptor: { version: 1, blocks: [{ id: 'b1' }] },
    descriptorText: '{"version":1,"blocks":[{"id":"b1"}]}',
    isTextValid: true,
    dataSource: { mode: 'sample' },
  });
  assertTrue(a !== b, 'ลายเซ็นต้องต่างกัน');
});

test('previewTriggerSignature เหมือนเดิมเมื่อ layout เปลี่ยน (สลับแท็บ/ลาก divider)', () => {
  const base = {
    descriptor: { version: 1, blocks: [] },
    descriptorText: '{"version":1,"blocks":[]}',
    isTextValid: true,
    dataSource: { mode: 'sample' },
  };
  // layout ไม่ได้อยู่ใน input ของ previewTriggerSignature เลย
  const before = previewTriggerSignature(base);
  const after = previewTriggerSignature(base);
  assertEqual(before, after, 'ลายเซ็นต้องเหมือนเดิม');
});

test('previewTriggerSignature เปลี่ยนเมื่อ data source เปลี่ยน', () => {
  const a = previewTriggerSignature({
    descriptor: null,
    isTextValid: false,
    dataSource: { mode: 'sample' },
  });
  const b = previewTriggerSignature({
    descriptor: null,
    isTextValid: false,
    dataSource: { mode: 'real' },
  });
  assertTrue(a !== b, 'ลายเซ็นต้องต่างกัน');
});

test('previewTriggerSignature เปลี่ยนเมื่อ isTextValid เปลี่ยน', () => {
  const a = previewTriggerSignature({
    descriptor: null,
    isTextValid: false,
    dataSource: null,
  });
  const b = previewTriggerSignature({
    descriptor: null,
    isTextValid: true,
    dataSource: null,
  });
  assertTrue(a !== b, 'ลายเซ็นต้องต่างกัน');
});

// ============================================================== [13]
section('[13] Actions wiring — callback เดิมถูกเรียกตามเดิม');

test('buildWorkspaceActions คืน callback เดิมทุกตัว (อ้างอิงเดียวกัน)', () => {
  const onGenerate = () => {};
  const onLoad = () => {};
  const onSave = () => {};
  const onFullscreenPreview = () => {};

  const actions = buildWorkspaceActions({
    onGenerate,
    onLoad,
    onSave,
    onFullscreenPreview,
  });

  assertTrue(actions.onGenerate === onGenerate, 'onGenerate');
  assertTrue(actions.onLoad === onLoad, 'onLoad');
  assertTrue(actions.onSave === onSave, 'onSave');
  assertTrue(
    actions.onFullscreenPreview === onFullscreenPreview,
    'onFullscreenPreview'
  );
});

test('เรียก onFullscreenPreview ผ่าน buildWorkspaceActions ยังเรียก callback เดิม', () => {
  let called = 0;
  const original = () => {
    called += 1;
  };
  const actions = buildWorkspaceActions({
    onGenerate: () => {},
    onLoad: () => {},
    onSave: () => {},
    onFullscreenPreview: original,
  });

  actions.onFullscreenPreview();
  assertEqual(called, 1, 'ต้องถูกเรียก 1 ครั้ง');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
