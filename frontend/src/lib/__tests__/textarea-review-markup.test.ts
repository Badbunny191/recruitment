// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Review Page TEXTAREA Markup Contract Tests
 * =======================================================================
 *
 * ครอบคลุมเทียบรายการ AN–AP ของ spec (repo ไม่มี jsdom/testing-library
 * จึงทดสอบเป็น source contract — ยืนยันว่า markup ที่ render คำตอบ
 * ใช้ CSS ที่รักษา newline + กันข้อความติดกันล้นกรอบ):
 *
 *   AN. Newline ถูกแสดง      → whitespace-pre-wrap
 *   AO. บรรทัดว่างยังอยู่     → whitespace-pre-wrap (collapse ไม่ได้)
 *   AP. ข้อความยาวไม่เว้นวรรคไม่ล้น → break-words (overflow-wrap: break-word)
 *   AQ. ข้อมูลจริงไม่ถูก mutate → cell render ค่าจาก RHF state ตรง ๆ
 *                               (ไม่มี replace/trim ใน renderFieldValue ของ string)
 *
 * Run: node --import tsx src/lib/__tests__/textarea-review-markup.test.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reviewPagePath = join(__dirname, '..', '..', 'app', '(public)', 'apply', 'review', 'page.tsx');
const source = readFileSync(reviewPagePath, 'utf8');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) throw new Error(msg);
}

test('AN/AO: ค่าที่ render ใช้ whitespace-pre-wrap (newline และบรรทัดว่างคงอยู่)', () => {
  assertTrue(
    source.includes('whitespace-pre-wrap'),
    'review page ต้องมี whitespace-pre-wrap ในช่องแสดงคำตอบ'
  );
});

test('AP: ใช้ break-words กันข้อความไม่มีช่องว่างล้นกรอบ', () => {
  assertTrue(
    source.includes('break-words'),
    'review page ต้องมี break-words (overflow-wrap: break-word)'
  );
});

test('AN+AP: อยู่ใน element เดียวกัน (renderFieldRow)', () => {
  const match = source.match(/<div className="text-sm text-slate-900[^"]*"[^>]*>/);
  assertTrue(match, 'ไม่พบ div แสดงค่าใน renderFieldRow');
  assertTrue(
    match[0].includes('whitespace-pre-wrap') && match[0].includes('break-words'),
    `div แสดงค่าต้องมีทั้งสอง class ได้: ${match[0]}`
  );
});

test('AQ: ไม่มีการ trim/replace คำตอบ string ใน review page', () => {
  assertTrue(
    !source.includes('.replace(/\\s+/g'),
    'ห้าม normalize whitespace ของคำตอบใน review'
  );
  assertTrue(
    !/String\(raw\)\s*\.trim\(\)/.test(source),
    'ห้าม trim คำตอบที่ render'
  );
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
