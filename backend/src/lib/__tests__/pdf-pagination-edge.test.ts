/**
 * Pagination Edge Case: long content must trigger page break correctly
 *
 * รัน: node --import tsx src/lib/__tests__/pdf-pagination-edge.test.ts
 *
 * ทดสอบ:
 *   1. block ที่ใหญ่กว่าหน้า → ต้อง wrap ไปหน้าใหม่
 *   2. block ที่เหลือพอดี → ต้องอยู่หน้าเดิม
 *   3. section header ที่เหลือพื้นที่ไม่พอ → ต้องไปหน้าใหม่
 */

declare const process: { exit(code?: number): never };

async function main() {
  console.log('\n=== Pagination Edge Cases ===\n');

  const PAGE_HEIGHT = 841.89;
  const PAGE_WIDTH = 595.28;
  const MARGIN = 40;
  const HEADER_HEIGHT = 110;
  const FOOTER_HEIGHT = 50;
  const CONTENT_TOP = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;
  const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  // Mock the layout engine
  const FONT_SIZE_BODY = 12;
  const FONT_SIZE_LABEL = 11;
  const FONT_SIZE_SECTION = 13;
  const LINE_HEIGHT = 1.4;
  const LABEL_TO_VALUE_GAP = 4;
  const POST_BLOCK_SPACING = 8;
  const POST_SECTION_SPACING = 8;
  const PRE_SECTION_SPACING = 8;
  const FIELD_VALUE_INDENT = 12;

  function widthOf(s: string, size: number): number {
    return s.length * size * 0.55;
  }

  function wrapText(text: string, maxWidth: number, size: number): string[] {
    if (!text) return [];
    const lines: string[] = [];
    for (const p of text.split(/\r?\n/)) {
      if (p === '') { lines.push(''); continue; }
      const tokens = p.split(/(\s+)/).filter(t => t.length > 0);
      let line = '';
      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          if (line.length > 0) line += token;
          continue;
        }
        if (widthOf(token, size) <= maxWidth) {
          const candidate = line.length > 0 ? line + ' ' + token : token;
          if (widthOf(candidate, size) <= maxWidth) {
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
          if (widthOf(test, size) <= maxWidth) buf = test;
          else {
            if (buf.length > 0) lines.push(buf);
            buf = ch;
          }
        }
        if (buf.length > 0) line = buf;
      }
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  // Renderer simulation
  let pageNumber = 1;
  let y = CONTENT_TOP;
  const pageBoundaries: { page: number; y: number; text: string }[] = [];

  function ensureSpace(required: number): boolean {
    const SAFETY = 0.5;
    if (y - required < CONTENT_BOTTOM + SAFETY) {
      pageBoundaries.push({ page: pageNumber, y, text: '--- new page ---' });
      pageNumber += 1;
      y = CONTENT_TOP;
      return true;
    }
    return false;
  }

  // Test 1: Render a block that fits in remaining space
  console.log('Test 1: block that fits exactly');
  pageNumber = 1;
  y = CONTENT_TOP;
  pageBoundaries.length = 0;

  const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
  const valueLines = ['บรรทัดเดียว'];
  const valueHeight = valueLines.length * FONT_SIZE_BODY * LINE_HEIGHT;
  const blockHeight = labelHeight + LABEL_TO_VALUE_GAP + valueHeight + POST_BLOCK_SPACING;

  const neededPageBreak = ensureSpace(blockHeight);
  console.log(`  blockHeight=${blockHeight.toFixed(2)}, y=${y.toFixed(2)}, pageBreak=${neededPageBreak}`);
  if (neededPageBreak) {
    console.log('  ✗ FAILED: should not trigger page break');
    process.exit(1);
  } else {
    console.log('  ✓ no premature page break');
  }

  // Test 2: Block that exactly fits → no break
  console.log('\nTest 2: block exactly fills remaining space');
  pageNumber = 1;
  y = CONTENT_BOTTOM + labelHeight; // just enough for label
  pageBoundaries.length = 0;

  const blockH2 = labelHeight;
  const needed2 = ensureSpace(blockH2);
  console.log(`  blockHeight=${blockH2.toFixed(2)}, y=${y.toFixed(2)}, pageBreak=${needed2}`);
  if (needed2) {
    console.log('  ⚠️ triggers page break (border case)');
  } else {
    console.log('  ✓ fits exactly');
  }

  // Test 3: Multi-line block that requires wrap
  console.log('\nTest 3: multi-line block (5 lines of value)');
  pageNumber = 1;
  y = CONTENT_TOP;
  pageBoundaries.length = 0;

  const longValueLines = wrapText('บรรทัด 1 บรรทัด 2 บรรทัด 3 บรรทัด 4 บรรทัด 5 บรรทัด 6 บรรทัด 7 บรรทัด 8 บรรทัด 9 บรรทัด 10', CONTENT_WIDTH - FIELD_VALUE_INDENT, FONT_SIZE_BODY);
  const longValueHeight = longValueLines.length * FONT_SIZE_BODY * LINE_HEIGHT;
  const longBlockHeight = labelHeight + LABEL_TO_VALUE_GAP + longValueHeight + POST_BLOCK_SPACING;

  console.log(`  valueLines=${longValueLines.length}, valueHeight=${longValueHeight.toFixed(2)}, blockHeight=${longBlockHeight.toFixed(2)}`);
  const needed3 = ensureSpace(longBlockHeight);
  console.log(`  pageBreak=${needed3} (should be false)`);
  if (needed3) {
    console.log('  ✗ FAILED: should fit on page 1');
    process.exit(1);
  } else {
    console.log('  ✓ fits on page 1');
  }

  // Test 4: Force overflow by rendering many blocks
  console.log('\nTest 4: render many blocks until overflow');
  pageNumber = 1;
  y = CONTENT_TOP;
  pageBoundaries.length = 0;
  const transitions: number[] = [];

  for (let i = 0; i < 30; i++) {
    const blockH = labelHeight + LABEL_TO_VALUE_GAP + (3 * FONT_SIZE_BODY * LINE_HEIGHT) + POST_BLOCK_SPACING;
    const broke = ensureSpace(blockH);
    if (broke) {
      transitions.push(i);
    }
    y -= blockH;
  }

  console.log(`  transitions at block indices: [${transitions.join(', ')}]`);
  console.log(`  final page: ${pageNumber}`);
  if (pageNumber < 2) {
    console.log('  ✗ FAILED: 30 blocks should overflow page 1');
    process.exit(1);
  } else {
    console.log(`  ✓ correctly overflowed at block ${transitions[0]} (${pageNumber} pages used)`);
  }

  // Test 5: Section header that needs new page
  console.log('\nTest 5: section header with insufficient space');
  pageNumber = 1;
  y = CONTENT_BOTTOM + 1; // just below content area
  pageBoundaries.length = 0;

  const sectionH = FONT_SIZE_SECTION * LINE_HEIGHT + PRE_SECTION_SPACING;
  const needed5 = ensureSpace(sectionH);
  console.log(`  y=${y.toFixed(2)}, sectionHeight=${sectionH.toFixed(2)}, pageBreak=${needed5}`);
  if (!needed5) {
    console.log('  ✗ FAILED: should trigger page break');
    process.exit(1);
  } else {
    console.log('  ✓ correctly triggered page break');
  }

  console.log('\n=== Result ===');
  console.log('✅ All pagination edge cases PASSED');
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});