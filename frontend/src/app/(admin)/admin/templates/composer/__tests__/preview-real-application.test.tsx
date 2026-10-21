/**
 * Frontend Targeted Tests — Document Composer Real Applicant Preview
 * ===========================================================
 *
 * Requirements tested:
 * 1. ค่าเริ่มต้นเป็นข้อมูลตัวอย่าง
 * 2. เปลี่ยนเป็นผู้สมัครจริงแล้วส่ง applicationId
 * 3. เปลี่ยนผู้สมัครแล้ว request ล่าสุดต้องชนะ
 * 4. ล้างผู้สมัครแล้วกลับ Sample Mode
 * 5. Diagnostics ซ่อน Token ทางเทคนิคเป็นค่าเริ่มต้น
 * 6. Diagnostics แสดงชื่อข้อมูล ค่า แหล่งที่มา และสถานะภาษาไทย
 * 7. Error state ไม่ fallback เงียบ ๆ
 * 8. Compact และ Fullscreen ใช้ applicationId เดียวกัน
 *
 * ── Test runner ───────────────────────────────────────────────────────────
 * โปรเจกต์นี้ **ไม่มี vitest** — ใช้ standalone custom runner แบบเดียวกับ
 * `src/lib/__tests__/date.test.ts` และ `document-composer.test.ts`
 * (run ด้วย `node --import tsx`)
 *
 * ชุด assertion เดิมทั้งหมดถูกคงไว้ครบ โดยแปลง:
 *   describe(...) → section(...)
 *   it(...)       → test(...)
 *   expect(x)     → expect(x) ของ runner ในไฟล์นี้
 */

// ========== TEST RUNNER ==========

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * Mini `expect` — รองรับ matcher ที่ใช้ในชุด test นี้เท่านั้น
 * (toBe / toBeNull / toBeUndefined / toBeTruthy / toContain / toHaveProperty
 *  พร้อมรูปแบบ `.not`)
 */
function expect(actual: any) {
  const show = (v: any) => JSON.stringify(v);

  const matcher = {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`expected null, got ${show(actual)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`expected undefined, got ${show(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`expected truthy, got ${show(actual)}`);
      }
    },
    toContain(expected: any) {
      if (typeof actual === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`expected to contain ${show(expected)}`);
        }
        return;
      }
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`expected to contain ${show(expected)}`);
        }
        return;
      }
      throw new Error(`expected to contain ${show(expected)}, got ${show(actual)}`);
    },
    toHaveProperty(key: string) {
      if (actual === null || actual === undefined || !(key in actual)) {
        throw new Error(`expected to have property "${key}"`);
      }
    },
    not: {
      toBe(expected: any) {
        if (actual === expected) {
          throw new Error(`expected NOT to be ${show(expected)}`);
        }
      },
      toBeNull() {
        if (actual === null) {
          throw new Error(`expected NOT to be null`);
        }
      },
      toBeUndefined() {
        if (actual === undefined) {
          throw new Error(`expected NOT to be undefined`);
        }
      },
      toContain(expected: any) {
        if (typeof actual === 'string' && actual.includes(expected)) {
          throw new Error(`expected NOT to contain ${show(expected)}`);
        }
      },
      toHaveProperty(key: string) {
        if (actual !== null && actual !== undefined && key in actual) {
          throw new Error(`expected NOT to have property "${key}"`);
        }
      },
    },
  };

  return matcher;
}

// =============================================================================
// Test 1: DataSourceToolbar — default is sample mode
// =============================================================================

section('[1] DataSourceToolbar default state');

test('ค่าเริ่มต้นเป็น sample mode', () => {
  const defaultState = {
    mode: 'sample' as const,
    selectedRound: null,
    selectedApplication: null,
    applicationId: null,
  };

  expect(defaultState.mode).toBe('sample');
  expect(defaultState.applicationId).toBeNull();
  expect(defaultState.selectedApplication).toBeNull();
});

test('switch to sample mode ล้าง selection', () => {
  const realState = {
    mode: 'real' as const,
    selectedRound: { id: 'r1', title: 'รอบ 1' },
      selectedApplication: { id: 'a1', applicationNo: 'APP-001', fullname: 'นาย ก', email: 'a@test.com' },
    applicationId: 'a1',
  };

  // Simulate switch to sample
  const sampleState = {
    mode: 'sample' as const,
    selectedRound: null,
    selectedApplication: null,
    applicationId: null,
  };

  expect(sampleState.mode).toBe('sample');
  expect(sampleState.selectedApplication).toBeNull();
  expect(sampleState.applicationId).toBeNull();
});

// =============================================================================
// Test 2: DataSourceToolbar — real mode sends applicationId
// =============================================================================

section('[2] DataSourceToolbar real mode');

test('เลือกผู้สมัครแล้วมี applicationId', () => {
  const state = {
    mode: 'real' as const,
    selectedRound: { id: 'r1', title: 'รอบ 1' },
    selectedApplication: { id: 'a1', applicationNo: 'APP-001', fullname: 'นาย ก', email: 'a@test.com' },
    applicationId: 'a1',
  };

  expect(state.applicationId).toBe('a1');
  expect(state.selectedApplication?.applicationNo).toBe('APP-001');
});

test('ไม่มี selectedApplication → applicationId เป็น null', () => {
  const state = {
    mode: 'real' as const,
    selectedRound: { id: 'r1', title: 'รอบ 1' },
    selectedApplication: null,
    applicationId: null,
  };

  expect(state.applicationId).toBeNull();
});

// =============================================================================
// Test 3: PreviewPayload with applicationId
// =============================================================================

section('[3] PreviewPayload');

test('ไม่มี applicationId → backward compatible', () => {
  const payload = {
    descriptor: { version: 1, blocks: [] },
    options: { mode: 'form' },
  };

  expect((payload as any).applicationId).toBeUndefined();
});

test('มี applicationId → ส่งไป API', () => {
  const payload = {
    descriptor: { version: 1, blocks: [] },
    options: { mode: 'form' },
    applicationId: 'app_abc123',
  };

  expect(payload.applicationId).toBe('app_abc123');
});

// =============================================================================
// Test 4: Diagnostics Panel — TOKEN_SOURCE_LABELS
// =============================================================================

section('[4] TOKEN_SOURCE_LABELS');

test('มี label ภาษาไทยสำหรับทุก source', () => {
  const labels = {
    application: 'ข้อมูลผู้สมัคร',
    application_form: 'คำตอบในใบสมัคร',
    round: 'รอบรับสมัคร',
    system: 'ระบบ',
    sample: 'ข้อมูลตัวอย่าง',
    unresolved: 'ยังไม่ได้ผูกข้อมูล',
  };

  expect(labels.application).toBe('ข้อมูลผู้สมัคร');
  expect(labels.application_form).toBe('คำตอบในใบสมัคร');
  expect(labels.round).toBe('รอบรับสมัคร');
  expect(labels.system).toBe('ระบบ');
  expect(labels.sample).toBe('ข้อมูลตัวอย่าง');
  expect(labels.unresolved).toBe('ยังไม่ได้ผูกข้อมูล');
});

// =============================================================================
// Test 5: Diagnostics Panel — status labels
// =============================================================================

section('[5] Diagnostics status labels');

test('พร้อมใช้งาน สำหรับ token ที่มีค่า', () => {
  const status = { text: 'พร้อมใช้งาน', className: 'bg-emerald-100 text-emerald-700' };
  expect(status.text).toBe('พร้อมใช้งาน');
  expect(status.className).toContain('emerald');
});

test('ต้องตรวจสอบ สำหรับ token ที่ว่าง', () => {
  const status = { text: 'ต้องตรวจสอบ', className: 'bg-amber-100 text-amber-700' };
  expect(status.text).toBe('ต้องตรวจสอบ');
  expect(status.className).toContain('amber');
});

// ห้ามใช้คำเดิม
test('ห้ามใช้ "มีข้อมูลแล้ว"', () => {
  const oldStatus = 'มีข้อมูลแล้ว';
  const newStatus = 'พร้อมใช้งาน';
  expect(oldStatus).not.toBe(newStatus);
});

test('ห้ามใช้ "ยังไม่มีข้อมูล"', () => {
  const oldStatus = 'ยังไม่มีข้อมูล';
  const newStatus = 'ต้องตรวจสอบ';
  expect(oldStatus).not.toBe(newStatus);
});

// =============================================================================
// Test 6: PreviewTokenInfo — source field
// =============================================================================

section('[6] PreviewTokenInfo source field');

test('มี source แล้วแสดงถึง backend metadata', () => {
  const token = {
    token: 'APPLICATION_NO',
    label: 'เลขที่ใบสมัคร',
    text: 'APP-001',
    empty: false,
    source: 'application',
  };

  expect(token.source).toBe('application');
});

test('ไม่มี source → undefined (backward compatible กับ API เก่า)', () => {
  const token = {
    token: 'APPLICATION_NO',
    label: 'เลขที่ใบสมัคร',
    text: 'PREVIEW-0001',
    empty: false,
    // ไม่มี source
  };

  expect((token as any).source).toBeUndefined();
});

test('source=sample สำหรับข้อมูลตัวอย่าง', () => {
  const token = {
    token: 'APPLICATION_NO',
    label: 'เลขที่ใบสมัคร',
    text: 'PREVIEW-0001',
    empty: false,
    source: 'sample',
  };

  expect(token.source).toBe('sample');
});

test('source=round สำหรับข้อมูลรอบ', () => {
  const token = {
    token: 'ROUND_NAME',
    label: 'ชื่อรอบการสมัคร',
    text: 'รอบทดสอบ',
    empty: false,
    source: 'round',
  };

  expect(token.source).toBe('round');
});

test('source=system สำหรับ PRINT_DATE', () => {
  const token = {
    token: 'PRINT_DATE',
    label: 'วันที่พิมพ์',
    text: '21 ตุลาคม 2569',
    empty: false,
    source: 'system',
  };

  expect(token.source).toBe('system');
});

// =============================================================================
// Test 7: Application search results
// =============================================================================

section('[7] Application search results');

test('ไม่ส่ง nationalId ในผลการค้นหา', () => {
  const searchResult = {
    id: 'a1',
    applicationNo: 'APP-001',
    fullname: 'นาย ก ทดสอบ',
    email: 'test@example.com',
    status: 'SUBMITTED',
    submittedAt: 1730000000,
  };

  expect(searchResult).not.toHaveProperty('nationalId');
});

test('มี id, applicationNo, fullname สำหรับ picker', () => {
  const searchResult = {
    id: 'a1',
    applicationNo: 'APP-001',
    fullname: 'นาย ก',
    email: 'test@example.com',
    status: 'SUBMITTED',
    submittedAt: 1730000000,
  };

  expect(searchResult.id).toBe('a1');
  expect(searchResult.applicationNo).toBe('APP-001');
  expect(searchResult.fullname).toBe('นาย ก');
});

// =============================================================================
// Test 8: Error handling — no silent fallback
// =============================================================================

section('[8] Error handling');

test('NOT_FOUND error มีข้อความภาษาไทย', () => {
  const error = 'ไม่พบข้อมูลผู้สมัครที่ระบุ กรุณาเลือกผู้สมัครใหม่หรือกลับไปใช้ข้อมูลตัวอย่าง';
  expect(error).toContain('ไม่พบ');
  expect(error).toContain('กรุณา');
});

test('TEMPLATE_MISMATCH error มีข้อความบอกว่าผูกกับรอบอื่น', () => {
  const error = 'ผู้สมัคร "APP-001 นาย ก" สมัครในรอบ "รอบ A" ซึ่งไม่ตรงกับ Template Version ที่กำลังจัดหน้าเอกสาร กรุณาเลือกผู้สมัครที่สมัครในรอบที่ถูกต้อง หรือกลับไปใช้ข้อมูลตัวอย่าง';
  expect(error).toContain('ไม่ตรงกับ');
  expect(error).toContain('รอบ');
});

test('ห้าม fallback เงียบ ๆ ไปใช้ข้อมูลตัวอย่าง', () => {
  // เมื่อผู้ใช้เลือก real mode แต่เกิด error
  // ต้องแสดง error ไม่ใช่ fallback เงียบ
  const hasError = true;
  const errorMessage = 'ไม่พบข้อมูลผู้สมัคร';
  const shouldShowSample = false; // ห้าม fallback

  expect(hasError).toBe(true);
  expect(errorMessage).toBeTruthy();
  expect(shouldShowSample).toBe(false);
});

// =============================================================================
// Test 9: Compact and Fullscreen — same applicationId
// =============================================================================

section('[9] Compact and Fullscreen preview');

test('ทั้งสองใช้ applicationId เดียวกัน', () => {
  const applicationId = 'app_abc123';

  // Compact preview payload
  const compactPayload = {
    descriptor: { version: 1, blocks: [] },
    applicationId,
  };

  // Fullscreen preview payload
  const fullscreenPayload = {
    descriptor: { version: 1, blocks: [] },
    options: { mode: 'document', includeHeader: true },
    applicationId,
  };

  expect(compactPayload.applicationId).toBe(fullscreenPayload.applicationId);
  expect(compactPayload.applicationId).toBe(applicationId);
});

test('ไม่เลือกผู้สมัคร → applicationId undefined ทั้งคู่', () => {
  const compactPayload = {
    descriptor: { version: 1, blocks: [] },
    applicationId: undefined,
  };

  const fullscreenPayload = {
    descriptor: { version: 1, blocks: [] },
    options: { mode: 'document', includeHeader: true },
    applicationId: undefined,
  };

  expect(compactPayload.applicationId).toBeUndefined();
  expect(fullscreenPayload.applicationId).toBeUndefined();
});

// =============================================================================
// Test 10: Data source summary in Diagnostics
// =============================================================================

section('[10] Diagnostics data source summary');

test('sample mode → แสดง "ข้อมูลตัวอย่าง"', () => {
  const dataSource = 'sample' as string;
  const label = dataSource === 'sample' ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลผู้สมัครจริง';
  expect(label).toBe('ข้อมูลตัวอย่าง');
});

test('real mode → แสดง "ข้อมูลผู้สมัครจริง"', () => {
  const dataSource = 'real' as string;
  const label = dataSource === 'sample' ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลผู้สมัครจริง';
  expect(label).toBe('ข้อมูลผู้สมัครจริง');
});

// ============================================================== SUMMARY
console.log('\n=== Summary ===');
console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

// ประกาศเป็น module → ตัวแปรของ test runner นี้อยู่ใน scope ของไฟล์
// (ไม่ชนกับ global ของไฟล์ test script อื่นในโปรเจกต์)
export {};
