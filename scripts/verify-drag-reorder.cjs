/**
 * Quick verification script for the drag-reorder + displayOrder normalization logic
 * used in TemplateBuilderClient.
 *
 * Run: node scripts/verify-drag-reorder.cjs
 *
 * This script mimics the logic in `handleDragReorder` and `normalizeDisplayOrder`
 * without React or @dnd-kit, so we can verify:
 *   1. After dragging an item from one position to another, the new global
 *      field array uses a contiguous 1..N displayOrder (no holes).
 *   2. Dragging item 5 to the top does NOT leave the old displayOrder intact
 *      (no `1, 2, 3, 4, 8` artefacts).
 *   3. Repeating the same drag many times always converges on 1..N.
 */

/**
 * @typedef {{ fieldId: string, displayOrder: number, sectionId: string | null }} Field
 * @typedef {{ id: string, displayOrder: number }} Section
 */

/**
 * @param {Field[]} fields
 * @returns {Field[]}
 */
function renumber(fields) {
  return fields.map((f, i) => ({ ...f, displayOrder: i + 1 }));
}

/**
 * @param {Section[]} sections
 * @param {Field[]} allFields
 * @param {number} sectionIdx
 * @param {string[]} newSectionOrderIds
 * @returns {Field[]}
 */
function handleDragReorder(sections, allFields, sectionIdx, newSectionOrderIds) {
  const section = sections[sectionIdx];
  if (!section) return allFields;
  const byId = new Map(allFields.map((f) => [f.fieldId, f]));
  const newFields = [];
  const used = new Set();

  sections.forEach((sec) => {
    const secFields =
      sec.id === section.id
        ? newSectionOrderIds.map((fid) => byId.get(fid)).filter(Boolean)
        : allFields.filter((f) => f.sectionId === sec.id);
    secFields.forEach((f) => {
      newFields.push(f);
      used.add(f.fieldId);
    });
  });

  allFields.forEach((f) => {
    if (!used.has(f.fieldId) && !f.sectionId) {
      newFields.push(f);
    }
  });

  return renumber(newFields);
}

/**
 * @param {string} label
 * @param {Field[]} fields
 * @returns {boolean}
 */
function checkSequential(label, fields) {
  const orders = fields.map((f) => f.displayOrder);
  const expected = fields.map((_, i) => i + 1);
  const ok = orders.every((o, i) => o === expected[i]);
  console.log(`${ok ? '[OK] ' : '[FAIL] '} ${label} -> [${orders.join(', ')}]`);
  if (!ok) {
    console.log(`   expected [${expected.join(', ')}]`);
  }
  return ok;
}

// === Test Setup: 5 fields in section A, 2 fields in section B, 1 orphan ===
const sections = [
  { id: 'sec-a', displayOrder: 1 },
  { id: 'sec-b', displayOrder: 2 },
];

let fields = [
  { fieldId: 'f1', displayOrder: 1, sectionId: 'sec-a' },
  { fieldId: 'f2', displayOrder: 2, sectionId: 'sec-a' },
  { fieldId: 'f3', displayOrder: 3, sectionId: 'sec-a' },
  { fieldId: 'f4', displayOrder: 4, sectionId: 'sec-a' },
  { fieldId: 'f5', displayOrder: 5, sectionId: 'sec-a' },
  { fieldId: 'f6', displayOrder: 6, sectionId: 'sec-b' },
  { fieldId: 'f7', displayOrder: 7, sectionId: 'sec-b' },
  { fieldId: 'f8', displayOrder: 8, sectionId: null },
];

console.log('\n=== Initial state ===');
checkSequential('Initial', fields);

// === Test 2: ลาก 5 ไปบนสุดใน section A ===
console.log('\n=== Test: ลาก field 5 ไปบนสุดใน Section A ===');
fields = handleDragReorder(sections, fields, 0, ['f5', 'f1', 'f2', 'f3', 'f4']);
const t2 = checkSequential('After drag 5->top in sec A', fields);
const t2_5first = fields[0].fieldId === 'f5';
console.log(`${t2_5first ? '[OK] ' : '[FAIL] '} f5 อยู่บนสุด (displayOrder=${fields[0].displayOrder})`);

// === Test 3: ลาก field 1 ลงล่างสุดใน section A ===
console.log('\n=== Test: ลาก field 1 ลงล่างสุดใน Section A ===');
fields = handleDragReorder(sections, fields, 0, ['f5', 'f2', 'f3', 'f4', 'f1']);
const t3 = checkSequential('After drag 1->bottom in sec A', fields);

// === Test 4: ลากหลายครั้งติดกัน ===
console.log('\n=== Test: ลาก 10 ครั้งติดกัน (สลับตำแหน่งแบบสุ่ม) ===');
let allOk = true;
for (let i = 0; i < 10; i++) {
  // Random shuffle within section A
  const order = ['f1', 'f2', 'f3', 'f4', 'f5'].sort(() => Math.random() - 0.5);
  fields = handleDragReorder(sections, fields, 0, order);
  const ok = fields.every((f, idx) => f.displayOrder === idx + 1);
  if (!ok) {
    console.log(`[FAIL] Iteration ${i + 1}: [${fields.map((f) => f.displayOrder).join(', ')}]`);
    allOk = false;
  }
}
console.log(`${allOk ? '[OK] ' : '[FAIL] '} 10 ครั้งติดกัน displayOrder ยังคงต่อเนื่อง`);

// === Test 5: drag from middle ===
console.log('\n=== Test: ลาก field ตรงกลาง (f3) ไปบนสุด ===');
fields = handleDragReorder(sections, fields, 0, ['f3', 'f1', 'f2', 'f4', 'f5']);
const t5 = checkSequential('After drag middle->top', fields);

// === Test 6: regression - bug 1,2,3,4,8 ต้องไม่เกิด ===
console.log('\n=== Regression: bug 1,2,3,4,8 ต้องไม่เกิด ===');
fields = handleDragReorder(sections, fields, 0, ['f5', 'f3', 'f1', 'f2', 'f4']);
const noHoles = fields.every((f, idx) => f.displayOrder === idx + 1);
const noJumps = !fields.some(f => f.displayOrder > fields.length);
console.log(`${noHoles && noJumps ? '[OK] ' : '[FAIL] '} ไม่มี holes และไม่มี displayOrder > N`);

// === Test 7: drag with orphans present ===
console.log('\n=== Test: orphan field (f8) ยังอยู่ท้ายสุด ===');
fields = handleDragReorder(sections, fields, 1, ['f7', 'f6']);
const lastIsOrphan = fields[fields.length - 1].fieldId === 'f8';
console.log(`${lastIsOrphan ? '[OK] ' : '[FAIL] '} f8 (orphan) ยังคงอยู่ลำดับสุดท้าย`);

// === Final ===
console.log('\n=== Final state ===');
checkSequential('Final', fields);

const allPassed =
  t2 && t2_5first && t3 && allOk && t5 && noHoles && noJumps && lastIsOrphan;
console.log(`\n${allPassed ? '[ALL PASS] ' : '[SOME FAIL] '} Verify tests =`);
process.exit(allPassed ? 0 : 1);