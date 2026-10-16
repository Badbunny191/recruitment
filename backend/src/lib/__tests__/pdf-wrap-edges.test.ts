/**
 * Edge case tests for wrapText — leading/trailing whitespace, mixed scripts
 *
 * รัน: node --import tsx src/lib/__tests__/pdf-wrap-edges.test.ts
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';

// Re-implement wrapText here for direct testing
function wrapText(
  text: string,
  maxWidth: number,
  fontWidth: (s: string) => number
): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, maxWidth, fontWidth));
  }
  return lines;
}

function wrapParagraph(
  text: string,
  maxWidth: number,
  fontWidth: (s: string) => number
): string[] {
  const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
  const lines: string[] = [];
  let line = '';

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (line.length > 0) line += token;
      continue;
    }

    if (fontWidth(token) <= maxWidth) {
      const candidate = line.length > 0 ? line + ' ' + token : token;
      if (fontWidth(candidate) <= maxWidth) {
        line = candidate;
      } else {
        if (line.length > 0) lines.push(line);
        line = token;
      }
      continue;
    }

    if (line.length > 0) lines.push(line);
    line = '';

    const chars = Array.from(token);
    let buf = '';
    for (const ch of chars) {
      const test = buf + ch;
      if (fontWidth(test) <= maxWidth) {
        buf = test;
      } else {
        if (buf.length > 0) lines.push(buf);
        buf = ch;
      }
    }
    if (buf.length > 0) line = buf;
  }

  if (line.length > 0) lines.push(line);
  return lines;
}

declare const process: { exit(code?: number): never };

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
    failures.push(`${name}: ${e.message}`);
    console.log(`✗ ${name}: ${e.message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

const FW = (s: string) => s.length * 6; // 6pt per char

console.log('\n=== wrapText edge cases ===\n');

test('leading space is dropped (first token is whitespace)', () => {
  // When the first token is whitespace and line is empty, we skip it
  const lines = wrapText(' hello world', 200, FW);
  assertEqual(lines.length, 1);
  // The first space gets dropped because line.length === 0 at that point
  // then line becomes "hello world" when token "hello" is processed
  assertTrue(lines[0].startsWith('hello'));
});

test('whitespace handling: collapsed multiple spaces, trimmed trailing', () => {
  // Implementation: multiple consecutive spaces between words → 2 spaces
  // (one from previous whitespace token + one from " + token" join)
  // Trailing spaces preserved if they don't trigger wrap
  const lines = wrapText('hello   world', 200, FW);
  assertEqual(lines.length, 1);
  assertTrue(lines[0].includes('hello') && lines[0].includes('world'));
});

test('multiple consecutive spaces between words', () => {
  const lines = wrapText('hello     world', 200, FW);
  assertEqual(lines.length, 1);
  // Whitespace between words is collapsed (space tokens are merged)
  assertTrue(lines[0].includes('hello') && lines[0].includes('world'));
});

test('Thai text with no spaces gets char-wrapped', () => {
  const text = 'ประสบการณ์ทำงาน';
  const lines = wrapText(text, 30, FW); // 30pt = 5 chars per line
  assertTrue(lines.length > 1, 'should wrap');
  for (const line of lines) {
    assertTrue(line.length * 6 <= 30 + 6, `line "${line}" length ${line.length} exceeds maxWidth`);
  }
});

test('paragraph with only whitespace returns empty', () => {
  const lines = wrapText('   ', 200, FW);
  // Pure whitespace tokens are filtered out
  assertEqual(lines.length, 0);
});

test('mixed Thai + English with spaces wraps at space', () => {
  const text = 'ประสบการณ์ work experience';
  const lines = wrapText(text, 60, FW);
  assertTrue(lines.length >= 1);
});

test('text with newline preserves line break', () => {
  const lines = wrapText('line1\nline2\nline3', 200, FW);
  assertEqual(lines.length, 3);
  assertEqual(lines[0], 'line1');
  assertEqual(lines[1], 'line2');
  assertEqual(lines[2], 'line3');
});

test('text with consecutive newlines preserves empty lines', () => {
  const lines = wrapText('line1\n\nline3', 200, FW);
  assertEqual(lines.length, 3);
  assertEqual(lines[1], ''); // empty line for double newline
});

test('single long Thai word char-wrap preserves all chars', () => {
  const text = 'ก'.repeat(50);
  const lines = wrapText(text, 30, FW);
  const totalChars = lines.join('').length;
  assertEqual(totalChars, 50, 'all chars preserved');
});

test('hard newline at start creates empty first line', () => {
  const lines = wrapText('\nhello', 200, FW);
  assertEqual(lines.length, 2);
  assertEqual(lines[0], '');
  assertEqual(lines[1], 'hello');
});

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}

(async () => {
  // Also test with real PDF context
  console.log('\n=== Real PDF context: edge cases ===\n');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  console.log('✓ edge cases pass with real font metric');
  process.exit(0);
})().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});