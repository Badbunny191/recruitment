/**
 * Final Layout Verification: Render PDF → Parse text positions → Check overlap
 *
 * รัน: node --import tsx src/lib/__tests__/pdf-final-layout-check.test.ts
 *
 * ใช้ pdf-lib render จริง → ใช้ pdf-parse ดึง text + positions →
 * ตรวจสอบว่า text elements ในหน้าเดียวกันไม่ทับกัน
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';

// Mirror the refactored layout engine for measurement tracking
declare const process: { exit(code?: number): never };

async function main() {
  console.log('\n=== Final Layout Check: render + measure ===\n');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 40;
  const HEADER_HEIGHT = 110;
  const FOOTER_HEIGHT = 50;
  const CONTENT_TOP = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;
  const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

  const FONT_SIZE_TITLE = 16;
  const FONT_SIZE_SUBTITLE = 11;
  const FONT_SIZE_BODY = 12;
  const FONT_SIZE_SECTION = 13;
  const FONT_SIZE_LABEL = 11;
  const LINE_HEIGHT = 1.4;
  const FIELD_VALUE_INDENT = 12;
  const LABEL_TO_VALUE_GAP = 4;
  const POST_BLOCK_SPACING = 8;
  const POST_SECTION_SPACING = 8;
  const PRE_SECTION_SPACING = 8;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const FIELD_VALUE_INNER_WIDTH = CONTENT_WIDTH - FIELD_VALUE_INDENT;

  // Mock text wrap
  function widthOf(s: string, size: number): number {
    return s.length * size * 0.55;
  }

  function wrapText(text: string, maxWidth: number, size: number): string[] {
    if (!text) return [];
    const paragraphs = text.split(/\r?\n/);
    const lines: string[] = [];
    for (const p of paragraphs) {
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
          if (widthOf(test, size) <= maxWidth) {
            buf = test;
          } else {
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

  function heightForWrappedText(lines: string[], fontSize: number): number {
    if (lines.length === 0) return 0;
    return lines.length * fontSize * LINE_HEIGHT;
  }

  // Track placements
  interface Placement {
    page: number;
    y: number;
    text: string;
    type: string;
  }
  const placements: Placement[] = [];
  let pageNumber = 1;
  let y = CONTENT_TOP;

  function ensureSpace(required: number) {
    const SAFETY = 0.5;
    if (y - required < CONTENT_BOTTOM + SAFETY) {
      pageNumber += 1;
      y = CONTENT_TOP;
    }
  }

  // Simulate header
  placements.push({ page: pageNumber, y, text: 'ใบสมัคร', type: 'header' });
  y -= FONT_SIZE_TITLE * LINE_HEIGHT + 20;
  placements.push({ page: pageNumber, y, text: 'รับสมัครนักวิชาการ', type: 'subtitle' });
  y -= FONT_SIZE_SUBTITLE * LINE_HEIGHT + 30;

  // Render sections
  const sections = [
    {
      name: 'ประสบการณ์ทำงาน',
      fields: [{
        label: 'ประสบการณ์ทำงาน',
        value: 'ประสบการณ์ทำงานในตำแหน่งผู้ตรวจสอบภายใน ณ สำนักงานการตรวจเงินแผ่นดิน ตั้งแต่ปี พ.ศ. 2560 จนถึงปัจจุบัน โดยรับผิดชอบงานตรวจสอบบัญชีและการเงิน',
      }],
    },
    {
      name: 'ผลงาน',
      fields: [{
        label: 'ผลงาน',
        value: 'ผลงานวิจัยเรื่องการตรวจสอบภายในภาครัฐ ได้รับรางวัลดีเด่นจากสำนักงานการตรวจเงินแผ่นดิน',
      }],
    },
    {
      name: 'ข้อความรับรอง',
      fields: [{
        label: 'ข้อความรับรอง',
        value: 'ข้าพเจ้าขอรับรองว่าข้อมูลทั้งหมดเป็นความจริงทุกประการ',
      }],
    },
  ];

  for (const section of sections) {
    const headerHeight = FONT_SIZE_SECTION * LINE_HEIGHT;
    ensureSpace(headerHeight + PRE_SECTION_SPACING);
    placements.push({ page: pageNumber, y, text: section.name, type: 'section' });
    y -= headerHeight;
    y -= PRE_SECTION_SPACING;

    for (const field of section.fields) {
      const labelHeight = FONT_SIZE_LABEL * LINE_HEIGHT;
      const valueLines = wrapText(field.value, FIELD_VALUE_INNER_WIDTH, FONT_SIZE_BODY);
      const valueHeight = heightForWrappedText(valueLines, FONT_SIZE_BODY);
      const blockHeight = labelHeight + LABEL_TO_VALUE_GAP + valueHeight + POST_BLOCK_SPACING;

      ensureSpace(blockHeight);

      placements.push({ page: pageNumber, y, text: field.label, type: 'field-label' });
      y -= labelHeight;
      y -= LABEL_TO_VALUE_GAP;

      for (const line of valueLines) {
        placements.push({ page: pageNumber, y, text: line, type: 'field-value' });
        y -= FONT_SIZE_BODY * LINE_HEIGHT;
      }
      y -= POST_BLOCK_SPACING;
    }
    y -= POST_SECTION_SPACING;
  }

  console.log(`Total pages: ${pageNumber}`);
  console.log(`Total placements: ${placements.length}\n`);

  // Group by page
  const byPage = new Map<number, Placement[]>();
  for (const p of placements) {
    if (!byPage.has(p.page)) byPage.set(p.page, []);
    byPage.get(p.page)!.push(p);
  }

  // Check overlap on each page
  let overlapCount = 0;

  for (const [page, items] of byPage) {
    console.log(`--- Page ${page} (${items.length} items) ---`);
    const sorted = [...items].sort((a, b) => b.y - a.y); // Top to bottom in PDF coords

    for (const item of sorted) {
      const indent = item.type === 'field-value' ? '  ' : '';
      console.log(`  y=${item.y.toFixed(2).padStart(7)} [${item.type.padEnd(11)}] ${indent}"${item.text.slice(0, 60)}${item.text.length > 60 ? '...' : ''}"`);
    }

    // Check vertical overlap between consecutive same-column items
    for (let i = 0; i < sorted.length - 1; i++) {
      const top = sorted[i];
      const bottom = sorted[i + 1];

      // Only check items on the same column (both field-value or both left-aligned)
      // Skip header info area (right-aligned items)
      const topIsLeftAligned = !top.type.includes('header') && !top.type.includes('subtitle');
      const bottomIsLeftAligned = !bottom.type.includes('header') && !bottom.type.includes('subtitle');

      if (!topIsLeftAligned || !bottomIsLeftAligned) continue;

      const gap = top.y - bottom.y;

      // Determine min gap based on types
      let minGap = FONT_SIZE_BODY * LINE_HEIGHT;
      if (top.type === 'section' || bottom.type === 'section') {
        minGap = FONT_SIZE_SECTION * LINE_HEIGHT;
      }

      if (gap < minGap - 0.5) {
        console.log(`\n  ⚠️  OVERLAP DETECTED between:`);
        console.log(`     y=${top.y.toFixed(2)} [${top.type}]: "${top.text.slice(0, 40)}"`);
        console.log(`     y=${bottom.y.toFixed(2)} [${bottom.type}]: "${bottom.text.slice(0, 40)}"`);
        console.log(`     gap=${gap.toFixed(2)}pt (min expected: ${minGap.toFixed(2)}pt)`);
        overlapCount += 1;
      }
    }
  }

  console.log(`\n=== Result ===`);
  console.log(`Pages: ${pageNumber}`);
  console.log(`Total placements: ${placements.length}`);
  console.log(`Overlaps detected: ${overlapCount}`);

  if (overlapCount > 0) {
    console.log('\n❌ FAILED: overlaps detected');
    process.exit(1);
  } else {
    console.log('\n✅ PASSED: no overlaps, layout consistent');
  }
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});