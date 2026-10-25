/**
 * Tests: PDF download filename parsing (Migration 028)
 * --------------------------------------------
 * รัน: node --import tsx src/lib/__tests__/pdf-download.test.ts
 *
 * ทดสอบ parseContentDispositionFilename:
 *   - filename* (RFC 5987) มาก่อน filename เสมอ
 *   - decode ภาษาไทยกลับได้ตรงตัว
 *   - Header ไม่มี/malformed → '' (caller ใช้ fallback เลขที่ใบสมัคร)
 *   - path separator / CRLF ปลอดภัย
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { parseContentDispositionFilename } from '../pdf-download';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

const THAI_NAME = 'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf';
const THAI_ENCODED = encodeURIComponent(THAI_NAME);

console.log('\n========================================');
console.log('PDF Download Filename Parsing Tests');
console.log('========================================\n');

test('F1: filename* ภาษาไทย decode ได้ตรงตัว', () => {
  const header = `attachment; filename="application-APP-2026-5025.pdf"; filename*=UTF-8''${THAI_ENCODED}`;
  assertEqual(parseContentDispositionFilename(header), THAI_NAME);
});

test('F2: filename* มาก่อน filename เสมอ (แม้ filename อยู่หลังสุด/หน้าสุด)', () => {
  const header1 = `attachment; filename="application-x.pdf"; filename*=UTF-8''${THAI_ENCODED}`;
  const header2 = `attachment; filename*=UTF-8''${THAI_ENCODED}; filename="application-x.pdf"`;
  assertEqual(parseContentDispositionFilename(header1), THAI_NAME);
  assertEqual(parseContentDispositionFilename(header2), THAI_NAME);
});

test('F3: ไม่มี filename* → ใช้ filename= (ASCII fallback)', () => {
  assertEqual(
    parseContentDispositionFilename('attachment; filename="application-APP-1.pdf"'),
    'application-APP-1.pdf'
  );
  assertEqual(
    parseContentDispositionFilename("attachment; filename='unquoted.pdf'".replace(/'/g, '"')),
    'unquoted.pdf'
  );
});

test('F4: Header ไม่มี / null / ว่าง / ผิดรูปแบบ → ""', () => {
  assertEqual(parseContentDispositionFilename(''), '');
  assertEqual(parseContentDispositionFilename(null), '');
  assertEqual(parseContentDispositionFilename(undefined), '');
  assertEqual(parseContentDispositionFilename('attachment'), '');
  assertEqual(parseContentDispositionFilename('attachment; filename='), '');
});

test('F5: filename* malformed (percent เสีย) → decode แบบปลอดภัย ไม่ throw', () => {
  const malformed = `attachment; filename*=UTF-8''%.pdf`;
  const result = parseContentDispositionFilename(malformed);
  assertEqual(result, '%.pdf');
});

test('F6: path separator ในชื่อ → เอา basename', () => {
  const header = `attachment; filename="application-x.pdf"; filename*=UTF-8''${encodeURIComponent('../../etc/evil.pdf')}`;
  assertEqual(parseContentDispositionFilename(header), 'evil.pdf');
  const header2 = `attachment; filename="..\\..\\win.pdf"`;
  assertEqual(parseContentDispositionFilename(header2), 'win.pdf');
});

test('F7: CRLF / control characters ถูกตัด', () => {
  const header = `attachment; filename="bad\r\nX-Evil: injected.pdf"`;
  const result = parseContentDispositionFilename(header);
  assert(!/[\r\n]/.test(result), `no CRLF: ${JSON.stringify(result)}`);
  // ผลลัพธ์ต้องเป็น basename เดียวเสมอ (ใช้เป็น a.download ได้อย่างเดียว)
  assert(!result.includes('/') && !result.includes('\\'), 'no path separator');
  assertEqual(result, 'badX-Evil: injected.pdf');
});

test('F8: ชื่อ "." / ".." / ว่าง → "" (caller fallback)', () => {
  assertEqual(parseContentDispositionFilename('attachment; filename="."'), '');
  assertEqual(parseContentDispositionFilename('attachment; filename=".."'), '');
  assertEqual(parseContentDispositionFilename('attachment; filename=""'), '');
});

test('F9: legacy header เดิม (filename= ภาษาไทยตรง ๆ ไม่ encode) ยังอ่านได้', () => {
  assertEqual(
    parseContentDispositionFilename(`attachment; filename="${THAI_NAME}"`),
    THAI_NAME
  );
});

console.log('\n----------------------------------------');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
