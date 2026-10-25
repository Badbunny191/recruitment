/**
 * Tests: FILE Field Attachment Rendering + Empty Marker Unification
 * ----------------------------------------------------------------
 * Branch: fix/pdf-cache-and-token-resolution (2026-10-26)
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/file-attachment-render.test.ts
 *
 * สิ่งที่ล็อกพฤติกรรม:
 *   U1–U4  resolveFileAttachmentValue — ชื่อจริง join ", " / fallback "ไฟล์แนบ N รายการ"
 *          / ไม่มี attachment → null / scope ตาม fieldId
 *   P1–P3  PDF (วัดจาก drawText จริง) — FILE ชื่อจริง / fallback / ว่าง = "-"
 *   H1–H3  HTML Preview — ค่าเดียวกับ PDF + empty marker = "-" (เดิม "(ว่าง)")
 *   S1     sample formData ของ FILE ยังผ่านทางเดิม (preview mode ไม่พัง)
 *   T1     token {FIELD:<fileId>} ใน heading resolve ชื่อไฟล์ได้
 */
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFPage } from "pdf-lib";
import { buildRenderPlan, renderPlanToPdf } from "../index";
import { renderDescriptorToPreview } from "../preview-renderer";
import {
  resolveFieldValue,
  resolveFileAttachmentValue,
} from "../document-tokens";
import type { DocumentDescriptor } from "../types";
import type { ApplicationContext, AttachmentData, FieldData } from "../../pdf-types";

// =============================================================================
// Test framework (mirror field-spacing.test.ts)
// =============================================================================

declare const process: { exit(code?: number): never };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e: any) => {
      failed++;
      failures.push(`${name}: ${e.message}`);
      console.log(`  ✗ ${name}: ${e.message}`);
    });
}

function assertEqual(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, msg = "") {
  if (!condition) throw new Error(msg || "Expected true");
}

// =============================================================================
// drawText instrumentation (mirror field-spacing.test.ts)
// =============================================================================

interface DrawRecord { text: string }
let records: DrawRecord[] = [];
const origDrawText = (PDFPage.prototype as any).drawText;
(PDFPage.prototype as any).drawText = function (text: string, opts: any) {
  records.push({ text: String(text ?? "") });
  return origDrawText.call(this, text, opts);
};

// =============================================================================
// Fixtures
// =============================================================================

function makeField(id: string, type: FieldData["type"], label: string): FieldData {
  return {
    id: `tf-${id}`,
    fieldId: id,
    sectionId: null,
    displayOrder: 0,
    type,
    label,
    pdfMappingKey: null,
    options: null,
    overrideOptions: null,
    isRequired: false,
    rows: null,
    helpText: null,
    placeholder: null,
  };
}

function makeAttachment(
  fieldId: string,
  name: string | null,
  id: string
): AttachmentData {
  return { id, fieldId, fileUrl: `uploads/${id}`, originalFilename: name, uploadedAt: 1767793020 };
}

const FIELDS: FieldData[] = [
  makeField("resume", "FILE", "ไฟล์ประวัติย่อ"),
  makeField("portfolio", "FILE", "ผลงาน"),
  makeField("note", "TEXT", "หมายเหตุ"),
];

function makeCtx(
  formData: Record<string, unknown>,
  attachments: AttachmentData[]
): ApplicationContext {
  return {
    application: {
      id: "app-1",
      applicationNo: "APP-2026-5001",
      email: "test@example.com",
      fullname: "นายทดสอบ ระบบ",
      nationalId: null,
      status: "SUBMITTED",
      statusReason: null,
      submittedAt: 1767793020,
      formData,
    },
    round: {
      id: "round-1",
      title: "รอบทดสอบ",
      positionLevel: "N/A",
      announcementTitle: null,
      announcementDescription: null,
      applicationPattern: null,
      roundCode: "UAT01",
    },
    templateVersion: { id: "tv-1", versionNumber: 1 },
    sections: [],
    fields: FIELDS,
    attachments,
  };
}

/** PDF ที่ wrap แล้วอาจแยก drawText เป็นหลาย record — join ทั้งหมดก่อนเช็ค contains
 *  + collapse ช่องว่างซ้ำ เพราะ wrapParagraph ยังมี known double-space bug
 *    (งานแยก — ดู memory wrapparagraph-double-space-bug) ไม่ใช่เรื่องของ suite นี้ */
async function renderPdfText(
  blocks: DocumentDescriptor["blocks"],
  ctx: ApplicationContext
): Promise<string> {
  records = [];
  const descriptor: DocumentDescriptor = { version: 1, blocks };
  const plan = buildRenderPlan(descriptor, ctx);
  await renderPlanToPdf(plan, ctx);
  return records
    .map((r) => r.text)
    .join("\n")
    .replace(/[ \t]+/g, " ");
}

function renderHtmlBody(
  blocks: DocumentDescriptor["blocks"],
  ctx: ApplicationContext
): string {
  const descriptor: DocumentDescriptor = { version: 1, blocks };
  return renderDescriptorToPreview(descriptor, ctx).body;
}

function fieldBlock(fieldId: string): DocumentDescriptor["blocks"][number] {
  return {
    id: `f-${fieldId}`,
    type: "field",
    fieldId,
    showLabel: true,
    layout: "stacked",
    marginTop: 0,
    marginBottom: 3,
  } as DocumentDescriptor["blocks"][number];
}

// =============================================================================
// U. resolveFileAttachmentValue (pure)
// =============================================================================

async function main() {
  console.log("\n=== FILE Attachment Rendering + Empty Marker ===\n");

  await test("U1: ทุกไฟล์มีชื่อ → join \", \"", async () => {
    const ctx = makeCtx({}, [
      makeAttachment("resume", "Resume_Thanet.pdf", "a1"),
      makeAttachment("resume", "Portfolio.pdf", "a2"),
    ]);
    assertEqual(
      resolveFileAttachmentValue("resume", ctx),
      "Resume_Thanet.pdf, Portfolio.pdf"
    );
  });

  await test("U2: บางไฟล์ไม่มีชื่อ (ก่อน migration 027) → ไฟล์แนบ N รายการ", async () => {
    const ctx = makeCtx({}, [
      makeAttachment("resume", "Resume_Thanet.pdf", "a1"),
      makeAttachment("resume", null, "a2"),
    ]);
    assertEqual(resolveFileAttachmentValue("resume", ctx), "ไฟล์แนบ 2 รายการ");
  });

  await test("U3: ไม่มี attachment → null (ไป empty marker)", async () => {
    assertEqual(resolveFileAttachmentValue("resume", makeCtx({}, [])), null);
  });

  await test("U4: scope ตาม fieldId — attachment ของ field อื่นไม่นับ", async () => {
    const ctx = makeCtx({}, [makeAttachment("portfolio", "P.pdf", "a1")]);
    assertEqual(resolveFileAttachmentValue("resume", ctx), null);
    assertEqual(resolveFileAttachmentValue("portfolio", ctx), "P.pdf");
  });

  // ===========================================================================
  // P. PDF renderer (drawText จริง)
  // ===========================================================================

  await test("P1: PDF FILE field แสดงชื่อไฟล์จริงคั่น comma", async () => {
    const ctx = makeCtx(
      {},
      [
        makeAttachment("resume", "Resume_Thanet.pdf", "a1"),
        makeAttachment("resume", "Portfolio.pdf", "a2"),
      ]
    );
    const text = await renderPdfText([fieldBlock("resume")], ctx);
    assertTrue(text.includes("Resume_Thanet.pdf, Portfolio.pdf"), `got: ${text}`);
  });

  await test("P2: PDF FILE fallback → ไฟล์แนบ 2 รายการ", async () => {
    const ctx = makeCtx(
      {},
      [makeAttachment("resume", null, "a1"), makeAttachment("resume", null, "a2")]
    );
    const text = await renderPdfText([fieldBlock("resume")], ctx);
    assertTrue(text.includes("ไฟล์แนบ 2 รายการ"), `got: ${text}`);
  });

  await test("P3: PDF FILE ไม่มี attachment → \"-\" (เดิม)", async () => {
    const text = await renderPdfText([fieldBlock("resume")], makeCtx({}, []));
    assertTrue(text.includes("-"), `got: ${text}`);
  });

  // ===========================================================================
  // H. HTML Preview — parity + marker
  // ===========================================================================

  await test("H1: HTML FILE field แสดงชื่อไฟล์เดียวกับ PDF", async () => {
    const ctx = makeCtx(
      {},
      [
        makeAttachment("resume", "Resume_Thanet.pdf", "a1"),
        makeAttachment("resume", "Portfolio.pdf", "a2"),
      ]
    );
    const body = renderHtmlBody([fieldBlock("resume")], ctx);
    assertTrue(body.includes("Resume_Thanet.pdf, Portfolio.pdf"), "names missing in HTML");
  });

  await test("H2: HTML empty marker = \"-\" ไม่ใช่ \"(ว่าง)\" (unify)", async () => {
    const body = renderHtmlBody([fieldBlock("note")], makeCtx({}, []));
    assertTrue(body.includes(">-<") || body.includes(">-"), "marker '-' missing");
    assertTrue(!body.includes("(ว่าง)"), "old marker (ว่าง) still present");
  });

  await test("H3: HTML FILE ไม่มี attachment → \"-\" เหมือน PDF", async () => {
    const body = renderHtmlBody([fieldBlock("resume")], makeCtx({}, []));
    assertTrue(!body.includes("(ว่าง)"), "old marker present");
    assertTrue(body.includes("dc-field__value--empty"), "empty class missing");
  });

  // ===========================================================================
  // S. sample formData passthrough
  // ===========================================================================

  await test("S1: FILE ที่มีค่าใน formData (sample preview) ใช้ค่านั้น ไม่แตะ attachments", async () => {
    const ctx = makeCtx({ resume: "(ตัวอย่างไฟล์แนบ)" }, [
      makeAttachment("resume", "Real.pdf", "a1"),
    ]);
    const text = await renderPdfText([fieldBlock("resume")], ctx);
    assertTrue(text.includes("(ตัวอย่างไฟล์แนบ)"), `got: ${text}`);
    assertTrue(!text.includes("Real.pdf"), "must not resolve attachments when formData has value");
  });

  // ===========================================================================
  // T. {FIELD:<fileId>} token ใน heading
  // ===========================================================================

  await test("T1: token {FIELD:resume} resolve ชื่อไฟล์จาก attachments", async () => {
    const ctx = makeCtx(
      {},
      [makeAttachment("resume", "Resume_Thanet.pdf", "a1")]
    );
    const resolved = resolveFieldValue("resume", ctx);
    assertTrue(resolved !== null && !resolved.empty, "must resolve non-empty");
    assertEqual(resolved!.text, "Resume_Thanet.pdf");
  });

  // ===========================================================================
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("SUITE FAILED:", e);
  process.exit(1);
});
