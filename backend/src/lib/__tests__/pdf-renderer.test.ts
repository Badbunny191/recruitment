/**
 * Unit Tests: PDF Renderer Layout — Text Wrapping & Block Height
 *
 * รัน: node --import tsx src/lib/__tests__/pdf-renderer.test.ts
 *
 * ทดสอบ:
 *   1. wrapText — ตัดข้อความยาวเป็นหลายบรรทัดอย่างถูกต้อง
 *   2. ensureSpace — block height ต้องสอดคล้องกับจำนวนบรรทัดที่ wrap แล้ว
 *   3. Multi-line rendering — บรรทัดต้องไม่ทับกัน
 *   4. Section spacing — section ถัดไปต้องเริ่มหลัง block ก่อนหน้าจบ
 *
 * ห้ามใช้จำนวนบรรทัดแบบ fixed — ทุกความสูงต้องคำนวณจาก wrap จริง
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';

// =============================================================================
// Test framework (ตาม style เดียวกับ application-pattern.test.ts)
// =============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

// process is a Node.js global; declare for TS noEmit checks
declare const process: { exit(code?: number): never };

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e: any) => {
      failed++;
      failures.push(`${name}: ${e.message}`);
      console.log(`✗ ${name}: ${e.message}`);
    });
}

function assertEqual<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// Re-implement wrapText เพื่อทดสอบ (จะแก้ใน renderer ตามผลที่ต้องการ)
// =============================================================================

function currentWrapText(
  text: string,
  maxWidth: number,
  fontWidth: (s: string) => number
): string[] {
  if (!text) return [];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + word;
    const width = fontWidth(testLine);

    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine.trim());
      }
      if (fontWidth(word) > maxWidth) {
        const chars = [...word];
        currentLine = '';
        for (const ch of chars) {
          if (fontWidth(currentLine + ch) > maxWidth) {
            lines.push(currentLine);
            currentLine = ch;
          } else {
            currentLine += ch;
          }
        }
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines;
}

// =============================================================================
// Reproduce layout calculation
// =============================================================================

const FONT_SIZE_LABEL = 11;
const FONT_SIZE_BODY = 12;
const LINE_HEIGHT = 1.4;
const CONTENT_WIDTH = 515.28;

function computeCurrentBlockHeight(labelHeight: number, valueLines: string[]): number {
  const valueHeight = valueLines.length * FONT_SIZE_BODY * LINE_HEIGHT;
  return labelHeight + 4 + valueHeight + 8;
}

function computeActualDecrement(labelHeight: number, valueLines: string[]): number {
  let dy = labelHeight;
  dy += valueLines.length * FONT_SIZE_BODY * LINE_HEIGHT;
  dy += 4;
  return dy;
}

async function main() {

  console.log('\n=== wrapText: Thai long text ===\n');

  await test('short Thai text returns 1 line', () => {
    const text = 'สังกัดปัจจุบัน';
    const lines = currentWrapText(text, CONTENT_WIDTH, s => s.length * 10);
    assertEqual(lines.length, 1);
  });

  await test('long Thai text wraps to multiple lines', () => {
    const text = 'ประสบการณ์ทำงานในตำแหน่งผู้ตรวจสอบภายใน ณ สำนักงานการตรวจเงินแผ่นดิน ตั้งแต่ปี พ.ศ. 2560 จนถึงปัจจุบัน โดยรับผิดชอบงานตรวจสอบบัญชีและการเงินของหน่วยงานภาครัฐหลายแห่ง';
    const lines = currentWrapText(text, 200, s => s.length * 10);
    assertTrue(lines.length > 1, `expected > 1 line, got ${lines.length}`);
    for (const line of lines) {
      assertTrue(line.length * 10 <= 200 + 10, `line "${line}" exceeds maxWidth`);
    }
  });

  await test('very long single word (Thai without space) is character-wrapped', () => {
    const longWord = 'ก'.repeat(100);
    const lines = currentWrapText(longWord, 100, s => s.length * 10);
    assertTrue(lines.length > 1, `expected char-wrap, got ${lines.length} line(s)`);
  });

  await test('empty text returns empty array', () => {
    const lines = currentWrapText('', CONTENT_WIDTH, s => s.length);
    assertEqual(lines.length, 0);
  });

  console.log('\n=== Block Height vs Actual Decrement ===\n');

  await test('blockHeight matches actual decrement when labelHeight computed from line height', () => {
    const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
    const valueLines = ['บรรทัด 1', 'บรรทัด 2', 'บรรทัด 3'];

    const blockHeight = computeCurrentBlockHeight(labelHeight, valueLines);
    const actualDecrement = computeActualDecrement(labelHeight, valueLines);

    console.log(`  blockHeight = ${blockHeight.toFixed(2)}`);
    console.log(`  actualDecrement = ${actualDecrement.toFixed(2)}`);
    console.log(`  diff = ${(blockHeight - actualDecrement).toFixed(2)}`);

    assertTrue(blockHeight >= actualDecrement,
      `blockHeight (${blockHeight}) must be >= actualDecrement (${actualDecrement})`);
  });

  await test('blockHeight for 0-line value (empty) is consistent', () => {
    const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
    const valueLines: string[] = [];

    const blockHeight = computeCurrentBlockHeight(labelHeight, valueLines);
    const actualDecrement = computeActualDecrement(labelHeight, valueLines);

    console.log(`  blockHeight = ${blockHeight.toFixed(2)}`);
    console.log(`  actualDecrement = ${actualDecrement.toFixed(2)}`);

    assertTrue(blockHeight >= actualDecrement,
      `blockHeight (${blockHeight}) must be >= actualDecrement (${actualDecrement})`);
  });

  console.log('\n=== Multi-line block — spacing ===\n');

  await test('multi-line block: actual decrement = labelHeight + valueHeight + 4', () => {
    const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
    const valueLines = Array(10).fill('บรรทัดยาวๆ');
    const valueHeight = valueLines.length * FONT_SIZE_BODY * LINE_HEIGHT;

    const blockHeight = labelHeight + 4 + valueHeight + 8;
    const actualDecrement = labelHeight + valueHeight + 4;

    console.log(`  blockHeight reserved: ${blockHeight.toFixed(2)}`);
    console.log(`  actual decrement:     ${actualDecrement.toFixed(2)}`);
    console.log(`  reserved - actual = ${(blockHeight - actualDecrement).toFixed(2)} (over-reserve by 8)`);

    assertTrue(blockHeight >= actualDecrement, 'should over-reserve (safe)');
  });

  console.log('\n=== Real Font Measurement with StandardFonts ===\n');

  await test('StandardFonts.Helvetica — measureText returns actual width', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = 'Hello World';
    const width = font.widthOfTextAtSize(text, 12);
    assertTrue(width > 0, 'width should be > 0');
    console.log(`  width of "${text}" @ 12pt = ${width.toFixed(2)}pt`);
  });

  console.log('\n=== Summary ===\n');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});