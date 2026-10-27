/**
 * R12: Audit Change Detection Hardening — computeChanges
 * =======================================================================
 *
 * ปัญหาเดิม (production audit):
 *   computeChanges ตีความ field ที่ "ไม่ได้ส่งมา" (undefined) ใน PATCH
 *   แบบ partial update เป็น "เปลี่ยนค่า" ทำให้ audit log มี false diff:
 *
 *     PATCH { isActive: false }  →  diff ออกมา 3 ช่อง
 *       email: "user@test.com" → null   ← หลอก (ไม่ได้ส่งมา)
 *       phone: "0812345678"    → null   ← หลอก (ไม่ได้ส่งมา)
 *
 *   และเงื่อนไขเดิม `(!oldVal && !newVal)` ใช้ falsy check กลืนค่าจริง:
 *     0 → null, false → '', '' → null  ... ถูกข้ามโดยไม่สร้าง diff
 *     ทั้งที่เป็นการเปลี่ยนค่าจริง (ละเมิด null/explicit-value semantics)
 *
 * การแก้ (backend/src/lib/change-tracking.ts):
 *   - undefined (ทั้งสองฝั่ง) = "ไม่ได้ส่งมา" → ข้าม ห้ามสร้าง diff
 *   - ตัด falsy check ทิ้ง — null/false/0/'' เป็น "ค่า" ที่ต้องสร้าง diff
 *     เมื่อเทียบกับค่าอื่น (เท่ากันเป๊ะ ๆ ยังถูกข้ามด้วย === เหมือนเดิม)
 *   - nested object คง behavior เดิม: เทียบด้วย reference (===)
 *
 * ครอบคลุม:
 *   CT1.  undefined field → ไม่มี diff (เคสหลักตามโจทย์ + key ไม่มีเลย)
 *   CT2.  null field → มี diff (X→null, null→X, null→null ไม่มี diff)
 *   CT3.  false value → มี diff (true→false, false→true, false→false ไม่มี)
 *   CT4.  0 value → มี diff (5→0, 0→null, 0→0 ไม่มี)
 *   CT5.  empty string → มี diff ('note'→'', ''→'x', ''→null, ''→'' ไม่มี)
 *   CT6.  เปลี่ยนค่าจริง → มี diff พร้อมค่าเดิม/ใหม่ถูกต้อง
 *   CT7.  nested object อ้าง object เดิม (ไม่เปลี่ยน) → ไม่มี diff
 *   CT8.  nested object คนละ reference (เปลี่ยน) → มี diff
 *   CT9.  partial PATCH ผสม (เปลี่ยนจริง + ไม่ส่งบาง field) → เฉพาะที่เปลี่ยนจริง
 *   CT10. internal fields (id/createdAt/updatedAt/_) ยังถูกข้ามเหมือนเดิม
 *
 *  fail-when-no-fix: CT1/CT4(0→null)/CT5(''→null) ต้องพังกับโค้ดเดิม
 *
 * รัน: node --import tsx src/lib/__tests__/change-tracking.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import assert from 'node:assert';
import { computeChanges } from '../change-tracking';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  FAIL ${name}: ${e?.message ?? e}`);
  }
}

function assertChange(changes: any[], field: string, oldValue: any, newValue: any, label: string) {
  const found = changes.find((c) => c.field === field);
  assert.ok(found, `${label}: ต้องมี diff ของ field "${field}"`);
  assert.strictEqual(found.oldValue, oldValue, `${label}: oldValue ของ ${field}`);
  assert.strictEqual(found.newValue, newValue, `${label}: newValue ของ ${field}`);
}

async function runAllTests() {
  console.log('\n=== R12: computeChanges change detection ===\n');

  // ---------------------------------------------------------------- CT1
  await test('CT1a: undefined field (ส่งมาเป็น undefined ชัด ๆ) → ไม่มี diff (เคสหลักตามโจทย์)', async () => {
    // Before ของโจทย์: old มี 3 field, PATCH ส่งแค่ isActive
    // caller (admin.routes.ts) สร้าง new object โดยมี key ครบแต่ value = undefined
    const changes = computeChanges(
      { isActive: true, email: 'user@test.com', phone: '0812345678' },
      { isActive: false, email: undefined, phone: undefined },
      'ADMIN_USER'
    );

    assert.strictEqual(changes.length, 1, `ต้องมี diff เดียวคือ isActive (ได้ ${changes.length}: ${changes.map((c) => c.field).join(',')})`);
    assertChange(changes, 'isActive', 'เปิดใช้งาน', 'ปิดใช้งาน', 'CT1a');
  });

  await test('CT1b: field ไม่มี key ใน newValues เลย → ไม่มี diff', async () => {
    const changes = computeChanges(
      { isActive: true, email: 'user@test.com', phone: '0812345678' },
      { isActive: false },
      'ADMIN_USER'
    );

    assert.strictEqual(changes.length, 1, `ต้องมี diff เดียว (ได้ ${changes.length})`);
    assertChange(changes, 'isActive', 'เปิดใช้งาน', 'ปิดใช้งาน', 'CT1b');
  });

  await test('CT1c: oldVal เป็น undefined (field ใหม่ใน new snapshot) → ไม่มี diff', async () => {
    const changes = computeChanges(
      { isActive: true },
      { isActive: true, email: 'user@test.com' },
      'ADMIN_USER'
    );
    assert.strictEqual(changes.length, 0, `undefined ฝั่งใดฝั่งหนึ่ง = ไม่ได้ส่ง/ไม่มีข้อมูลเดิม (ได้ ${changes.length})`);
  });

  // ---------------------------------------------------------------- CT2
  await test('CT2a: X → null เป็นการเปลี่ยนจริง → มี diff', async () => {
    const changes = computeChanges(
      { phone: '0812345678' },
      { phone: null },
      'ADMIN_USER'
    );
    assert.strictEqual(changes.length, 1, `null คือค่าหนึ่ง ต้องได้ diff (ได้ ${changes.length})`);
    assertChange(changes, 'phone', '0812345678', null, 'CT2a');
  });

  await test('CT2b: null → X เป็นการเปลี่ยนจริง → มี diff', async () => {
    const changes = computeChanges(
      { phone: null },
      { phone: '0812345678' },
      'ADMIN_USER'
    );
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'phone', null, '0812345678', 'CT2b');
  });

  await test('CT2c: null → null (ค่าเดิมเป๊ะ) → ไม่มี diff', async () => {
    const changes = computeChanges({ phone: null }, { phone: null }, 'ADMIN_USER');
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  // ---------------------------------------------------------------- CT3
  await test('CT3a: true → false → มี diff (false เป็นค่าจริง)', async () => {
    const changes = computeChanges({ isActive: true }, { isActive: false }, 'ADMIN_USER');
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'isActive', 'เปิดใช้งาน', 'ปิดใช้งาน', 'CT3a');
  });

  await test('CT3b: false → true → มี diff', async () => {
    const changes = computeChanges({ isActive: false }, { isActive: true }, 'ADMIN_USER');
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'isActive', 'ปิดใช้งาน', 'เปิดใช้งาน', 'CT3b');
  });

  await test('CT3c: false → false (ค่าเดิมเป๊ะ) → ไม่มี diff', async () => {
    const changes = computeChanges({ isActive: false }, { isActive: false }, 'ADMIN_USER');
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  // ---------------------------------------------------------------- CT4
  await test('CT4a: 5 → 0 → มี diff (0 เป็นค่าจริง)', async () => {
    const changes = computeChanges({ displayOrder: 5 }, { displayOrder: 0 }, 'POSITION');
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'displayOrder', '5', '0', 'CT4a');
  });

  await test('CT4b: 0 → null → มี diff (โค้ดเดิม falsy check กลืนเคสนี้)', async () => {
    const changes = computeChanges({ displayOrder: 0 }, { displayOrder: null }, 'POSITION');
    assert.strictEqual(changes.length, 1, `0 กับ null คนละค่า ต้องได้ diff (ได้ ${changes.length})`);
    assertChange(changes, 'displayOrder', '0', null, 'CT4b');
  });

  await test('CT4c: 0 → 0 (ค่าเดิมเป๊ะ) → ไม่มี diff', async () => {
    const changes = computeChanges({ displayOrder: 0 }, { displayOrder: 0 }, 'POSITION');
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  // ---------------------------------------------------------------- CT5
  await test('CT5a: "note" → "" → มี diff (empty string เป็นค่าจริง)', async () => {
    const changes = computeChanges({ remark: 'note' }, { remark: '' }, 'RECRUITMENT_ROUND');
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'remark', 'note', '', 'CT5a');
  });

  await test('CT5b: "" → "x" → มี diff', async () => {
    const changes = computeChanges({ remark: '' }, { remark: 'x' }, 'RECRUITMENT_ROUND');
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'remark', '', 'x', 'CT5b');
  });

  await test('CT5c: "" → null → มี diff (โค้ดเดิม falsy check กลืนเคสนี้)', async () => {
    const changes = computeChanges({ remark: '' }, { remark: null }, 'RECRUITMENT_ROUND');
    assert.strictEqual(changes.length, 1, `'' กับ null คนละค่า ต้องได้ diff (ได้ ${changes.length})`);
    assertChange(changes, 'remark', '', null, 'CT5c');
  });

  await test('CT5d: "" → "" (ค่าเดิมเป๊ะ) → ไม่มี diff', async () => {
    const changes = computeChanges({ remark: '' }, { remark: '' }, 'RECRUITMENT_ROUND');
    assert.strictEqual(changes.length, 0, `ได้ ${changes.length}`);
  });

  // ---------------------------------------------------------------- CT6
  await test('CT6: เปลี่ยนค่าจริง → มี diff พร้อม old/new ถูกต้อง', async () => {
    const changes = computeChanges(
      { email: 'a@test.com' },
      { email: 'b@test.com' },
      'ADMIN_USER'
    );
    assert.strictEqual(changes.length, 1, `ได้ ${changes.length}`);
    assertChange(changes, 'email', 'a@test.com', 'b@test.com', 'CT6');
  });

  // ---------------------------------------------------------------- CT7
  await test('CT7: nested object อ้าง reference เดิม (ไม่เปลี่ยน) → ไม่มี diff', async () => {
    const meta = { tags: ['a'], nested: { deep: 1 } };
    const changes = computeChanges({ meta }, { meta }, 'ADMIN_USER');
    assert.strictEqual(changes.length, 0, `คง behavior เดิม (=== แบบ reference) (ได้ ${changes.length})`);
  });

  // ---------------------------------------------------------------- CT8
  await test('CT8: nested object คนละ reference (เปลี่ยน) → มี diff', async () => {
    const changes = computeChanges(
      { meta: { tags: ['a'] } },
      { meta: { tags: ['b'] } },
      'ADMIN_USER'
    );
    assert.strictEqual(changes.length, 1, `คง behavior เดิม — คนละ reference ถือว่าเปลี่ยน (ได้ ${changes.length})`);
    assert.ok(changes[0].field === 'meta', 'CT8: field ต้องเป็น meta');
  });

  // ---------------------------------------------------------------- CT9
  await test('CT9: partial PATCH ผสม → มีเฉพาะ field ที่เปลี่ยนจริง', async () => {
    const changes = computeChanges(
      { name: 'A', remark: 'old-remark', isActive: true, displayOrder: 3 },
      { name: 'B', remark: undefined, isActive: false, displayOrder: undefined },
      'POSITION'
    );
    const fields = changes.map((c) => c.field).sort();
    assert.deepStrictEqual(fields, ['isActive', 'name'], `ต้องได้แค่ name + isActive (ได้ ${fields.join(',')})`);
  });

  // ---------------------------------------------------------------- CT10
  await test('CT10: internal fields (id/createdAt/updatedAt/_) ยังถูกข้ามเหมือนเดิม', async () => {
    const changes = computeChanges(
      { id: 'x', createdAt: 1, updatedAt: 1, _internal: 'a', name: 'A' },
      { id: 'y', createdAt: 2, updatedAt: 2, _internal: 'b', name: 'B' },
      'ADMIN_USER'
    );
    const fields = changes.map((c) => c.field);
    assert.deepStrictEqual(fields, ['name'], `ต้องได้แค่ name (ได้ ${fields.join(',')})`);
  });

  console.log('');
  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
