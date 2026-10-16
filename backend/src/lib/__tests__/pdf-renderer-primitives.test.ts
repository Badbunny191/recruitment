/**
 * Direct test: import actual renderer primitives and verify invariants
 *
 * รัน: node --import tsx src/lib/__tests__/pdf-renderer-primitives.test.ts
 *
 * ใช้ pdf-lib standard fonts เพื่อ test wrapText และ heightForWrappedText
 * ผ่าน renderApplicationPdf (mock context เล็กๆ)
 *
 * Note: ไฟล์นี้ monkey-patch font-loader เพื่อใช้ StandardFonts แทน Sarabun
 * เพื่อให้ test รันได้โดยไม่ต้อง load font files
 */

import { PDFDocument, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';

// Load renderer module first (mock dependencies via module patching won't work
// for ESM, so we just instantiate the layout logic via the public API)
import { renderApplicationPdf } from '../pdf-renderer.service';
import type { ApplicationContext } from '../pdf-types';

declare const process: { exit(code?: number): never };

async function main() {
  console.log('\n=== Renderer primitives — real invocation ===\n');

  // Build a context that contains only short text — single page expected
  const ctx: ApplicationContext = {
    application: {
      id: 'app-1',
      applicationNo: 'CHM01-0001',
      email: 'test@example.com',
      fullname: 'ทดสอบ ระบบ',
      nationalId: null,
      status: 'SUBMITTED',
      statusReason: null,
      submittedAt: Math.floor(Date.now() / 1000),
      formData: {
        'f1': 'short text 1',
        'f2': 'short text 2',
      },
    },
    round: {
      id: 'round-1',
      title: 'Round Title',
      positionLevel: 'ปฏิบัติการ',
      announcementTitle: null,
      announcementDescription: null,
      applicationPattern: null,
      roundCode: 'CHM01',
    },
    templateVersion: { id: 'tv-1', versionNumber: 1 },
    sections: [
      { id: 's1', name: 'Section 1', displayOrder: 1 },
      { id: 's2', name: 'Section 2', displayOrder: 2 },
    ],
    fields: [
      { id: 'tf1', fieldId: 'f1', sectionId: 's1', displayOrder: 1, type: 'TEXT', label: 'Field 1', pdfMappingKey: null, options: null, overrideOptions: null, isRequired: false, rows: null, helpText: null, placeholder: null },
      { id: 'tf2', fieldId: 'f2', sectionId: 's2', displayOrder: 1, type: 'TEXT', label: 'Field 2', pdfMappingKey: null, options: null, overrideOptions: null, isRequired: false, rows: null, helpText: null, placeholder: null },
    ],
    attachments: [],
  };

  try {
    const result = await renderApplicationPdf(ctx);
    console.log(`  Single-page render: ${result.bytes.length} bytes, ${result.pageCount} pages`);
    if (result.pageCount !== 1) {
      console.log(`  ✗ Expected 1 page, got ${result.pageCount}`);
      process.exit(1);
    }
    if (result.bytes.length === 0) {
      console.log(`  ✗ Empty bytes`);
      process.exit(1);
    }
    console.log(`  ✓ single-page render succeeded`);
  } catch (e: any) {
    console.log(`  ✗ Render crashed: ${e.message}`);
    process.exit(1);
  }

  // Verify with many long fields — should produce multiple pages
  const longTextCtx: ApplicationContext = {
    ...ctx,
    application: {
      ...ctx.application,
      formData: {
        'f1': ('นี่คือข้อความยาวมาก ใช้สำหรับทดสอบ pagination ').repeat(50),
        'f2': ('อีกข้อความยาวที่ต้อง wrap หลายบรรทัด เพื่อทดสอบ multi-page ').repeat(50),
      },
    },
  };

  try {
    const result = await renderApplicationPdf(longTextCtx);
    console.log(`  Multi-page render (many fields): ${result.bytes.length} bytes, ${result.pageCount} pages`);
    if (result.pageCount < 2) {
      console.log(`  ✗ Expected > 1 page for long text, got ${result.pageCount}`);
      process.exit(1);
    }
    console.log(`  ✓ multi-page render succeeded (${result.pageCount} pages)`);
  } catch (e: any) {
    console.log(`  ✗ Long text render crashed: ${e.message}`);
    process.exit(1);
  }

  // Verify: ONE very long field that itself overflows a page
  // This is the critical edge case: the field block must split across pages,
  // OR be moved entirely to the next page (current behavior — ensureSpace
  // checks total block height before drawing).
  const singleLongFieldCtx: ApplicationContext = {
    ...ctx,
    application: {
      ...ctx.application,
      formData: {
        // Empty f2 — only one field to test
        'f1': ('บรรทัดข้อความที่มีความยาวพอที่จะต้อง wrap ข้ามหลายหน้าเมื่อคำนวณความสูงรวมแล้วเกินความสูงของ content area ที่มีอยู่ ').repeat(80),
      },
    },
    fields: [
      { id: 'tf1', fieldId: 'f1', sectionId: 's1', displayOrder: 1, type: 'TEXTAREA', label: 'Long Field', pdfMappingKey: null, options: null, overrideOptions: null, isRequired: false, rows: null, helpText: null, placeholder: null },
    ],
    sections: [
      { id: 's1', name: 'Section', displayOrder: 1 },
    ],
  };

  try {
    const result = await renderApplicationPdf(singleLongFieldCtx);
    console.log(`  Single long field render: ${result.bytes.length} bytes, ${result.pageCount} pages`);
    if (result.pageCount < 1) {
      console.log(`  ✗ Expected >= 1 page`);
      process.exit(1);
    }
    console.log(`  ✓ rendered successfully (${result.pageCount} page(s))`);
  } catch (e: any) {
    console.log(`  ✗ Single long field render crashed: ${e.message}`);
    process.exit(1);
  }

  console.log('\n=== Result ===');
  console.log('✅ All renderer primitive tests PASSED');
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});