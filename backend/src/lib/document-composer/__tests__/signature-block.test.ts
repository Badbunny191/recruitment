/**
 * Unit Tests: Signature Block
 * --------------------------------------------
 * Feature: Document Composer V1 — Signature Block
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/signature-block.test.ts
 *
 * ทดสอบ SignatureBlock ทั้ง Preview (HTML) และ PDF Render
 * - SignatureBlock เป็น Document Block (เหมือน logo / heading)
 *   - ไม่ใช่ Form Field
 *   - ไม่ใช่ Application Field
 *   - ใช้ข้อมูลจาก Application (fullname, submittedAt)
 *
 * IMPORTANT:
 *   Set TZ=Asia/Bangkok ก่อน import เพื่อให้ date/time formatter
 *   (ที่ใช้ Date local-time methods) ให้ผลลัพธ์ deterministic
 *   ในทุก environment (CI/local/D1)
 */
// Set TZ BEFORE imports that use Date.getHours()/getDate()/etc.
// (cast to any because the test file's minimal process declaration
//  above does not include env)
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import {
  validateDescriptor,
  buildRenderPlan,
  renderPlanToPdf,
  renderDescriptorToPreview,
} from "../index";
import type {
  DocumentDescriptor,
  SignatureBlock,
} from "../types";
import type { ApplicationContext } from "../../pdf-types";

// =============================================================================
// Test framework (mirror existing test files)
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

function assertEqual<T>(actual: T, expected: T, msg = "") {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, msg = "") {
  if (!condition) throw new Error(msg || "Expected true");
}

function assertFalse(condition: boolean, msg = "") {
  if (condition) throw new Error(msg || "Expected false");
}

function assertContains(haystack: string, needle: string, msg = "") {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${msg} expected substring ${JSON.stringify(needle)} not found`
    );
  }
}

// =============================================================================
// Fixtures
// =============================================================================

const SAMPLE_SIGNATURE_BLOCK: SignatureBlock = {
  id: "sig-1",
  type: "signature",
  align: "center",
  roleLabel: "ผู้สมัคร",
  signerNameSource: "application",
  dateSource: "APPLICATION_DATE",
  timeSource: "application",
  marginTop: 12,
  marginBottom: 12,
};

/**
 * Build a minimal ApplicationContext สำหรับ test
 *
 * Default submittedAt = 1767793020 = 2026-01-07T13:37:00Z
 * ใน BKK (UTC+7) จะเป็น 2026-01-07 20:37 (Bangkok time)
 */
function buildAppContext(opts: {
  fullname?: string;
  submittedAt?: number;
}): ApplicationContext {
  return {
    application: {
      id: "app-1",
      applicationNo: "APP-001",
      email: "test@example.com",
      fullname: opts.fullname ?? "นายสมชาย ใจดี",
      nationalId: null,
      status: "SUBMITTED",
      statusReason: null,
      submittedAt: opts.submittedAt ?? 1767793020,
      formData: null,
    },
    round: {
      id: "round-1",
      title: "Test Round",
      positionLevel: "N/A",
      announcementTitle: null,
      announcementDescription: null,
      applicationPattern: null,
      roundCode: null,
    },
    templateVersion: {
      id: "tv-1",
      versionNumber: 1,
    },
    sections: [],
    fields: [],
    attachments: [],
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Signature Block — Unit Tests ===\n");

  // ── 1. Zod schema: accept ─────────────────────────────────────────
  console.log("[1] Zod schema — accept");

  await test("accepts basic signature block", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const result = validateDescriptor(descriptor);
    assertTrue(result.ok);
  });

  await test("accepts signature block with all options", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          align: "left" as const,
          roleLabel: "ผู้รับรอง",
          signerNameSource: "application" as const,
          dateSource: "application" as const,
          timeSource: "application" as const,
          marginTop: 8,
          marginBottom: 8,
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertTrue(result.ok);
  });

  await test("accepts signature block with defaults (no roleLabel)", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertTrue(result.ok);
  });

  // ── 2. Zod schema: reject ────────────────────────────────────────
  console.log("\n[2] Zod schema — reject");

  await test("rejects signature block with empty roleLabel", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          roleLabel: "",
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertFalse(result.ok);
  });

  await test("rejects signature block with bad signerNameSource", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          signerNameSource: "manual", // not "application"
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertFalse(result.ok);
  });

  await test("rejects signature block without id", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          type: "signature" as const,
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertFalse(result.ok);
  });

  // ── 3. Preview rendering — with application data ────────────────
  console.log("\n[3] Preview rendering — with application data");

  await test("renders preview with applicant name (no fallback)", () => {
    const ctx = buildAppContext({
      fullname: "นายสมชาย ใจดี",
      submittedAt: 1767793020, // 2026-01-07 13:37 UTC
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);

    // Should include applicant name in parentheses
    assertContains(preview.body, "(นายสมชาย ใจดี)");
    // Should include "ลงลายมือชื่อ"
    assertContains(preview.body, "ลงลายมือชื่อ");
    // Should include role label
    assertContains(preview.body, "ผู้สมัคร");
    // Should include Thai date — 7 มกราคม 2569
    assertContains(preview.body, "วันที่ 7 มกราคม 2569");
    // showTime defaults to false → time line should NOT be rendered
    assertFalse(
      preview.body.includes("เวลา"),
      "showTime defaults to false → time line must not appear"
    );
    // meta should record 1 rendered block, 0 fieldRef (signature is NOT a field)
    assertEqual(preview.meta.blockCount, 1);
    assertEqual(preview.meta.fieldRefCount, 0);
    assertEqual(preview.meta.renderedBlocks.length, 1);
    assertEqual(preview.meta.renderedBlocks[0].type, "signature");
  });

  await test("renders preview with custom roleLabel", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          roleLabel: "ผู้รับรอง",
          align: "center",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "ผู้รับรอง");
  });

  await test("uses default roleLabel when not provided", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "ผู้สมัคร");
  });

  // ── 4. Preview rendering — fallback ─────────────────────────────
  console.log("\n[4] Preview rendering — fallback");

  await test("fallback name when fullname is empty", () => {
    const ctx = buildAppContext({ fullname: "", submittedAt: 1767793020 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    // Should show placeholder "(ชื่อผู้สมัคร)"
    assertContains(preview.body, "(ชื่อผู้สมัคร)");
    // Should still show date (showDate defaults true)
    assertContains(preview.body, "วันที่ 7 มกราคม 2569");
    // showTime defaults false → no time line
    assertFalse(preview.body.includes("เวลา"), "showTime defaults false");
  });

  await test("fallback name when fullname is whitespace-only", () => {
    const ctx = buildAppContext({ fullname: "   ", submittedAt: 1767793020 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "(ชื่อผู้สมัคร)");
  });

  await test("fallback date/time when submittedAt is 0", () => {
    const ctx = buildAppContext({ submittedAt: 0 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "______________");
  });

  await test("fallback date/time when submittedAt is negative", () => {
    const ctx = buildAppContext({ submittedAt: -1 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "______________");
  });

  // ── 5. Preview: alignment class ─────────────────────────────────
  console.log("\n[5] Preview: alignment");

  await test("align=center produces center alignment class", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "dc-align--center");
  });

  await test("align=left produces left alignment class (default)", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          // no align → default left
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "dc-align--left");
  });

  await test("signature block gets dc-signature CSS class", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, 'class="dc-signature');
  });

  // ── 6. Preview: HTML escaping (XSS safety) ─────────────────────
  console.log("\n[6] Preview: HTML escaping");

  await test("escapes HTML special chars in applicant name", () => {
    const ctx = buildAppContext({ fullname: '<script>alert("xss")</script>' });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertFalse(
      preview.body.includes("<script>alert"),
      "raw <script> must not appear in HTML"
    );
    assertContains(preview.body, "&lt;script&gt;");
  });

  // ── 7. Build render plan: signature command ─────────────────────
  console.log("\n[7] Build render plan");

  await test("signature block produces SignatureRenderCommand", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    // Find the signature command (skip padding commands)
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.blockId, "sig-1");
    assertEqual(sigCmd.roleLabel, "ผู้สมัคร");
    assertEqual(sigCmd.signerName, "นายสมชาย ใจดี");
  });

  await test("plan resolves fullname → signerName", () => {
    const ctx = buildAppContext({ fullname: "นางสาวใจดี มากดี" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.signerName, "นางสาวใจดี มากดี");
  });

  await test("plan resolves submittedAt → Thai date (พ.ศ.) + HH:mm", () => {
    // 2026-01-07T13:37:00Z → unix 1767793020
    // BKK (UTC+7) → 2026-01-07 20:37
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.dateText, "7 มกราคม 2569");
    assertEqual(sigCmd.timeText, "20:37");
    // timeText is always populated; visibility is controlled separately
    assertEqual(sigCmd.isFallback, false);
    // Visibility defaults
    assertEqual(sigCmd.showName, true);
    assertEqual(sigCmd.showDate, true);
    assertEqual(sigCmd.showTime, false);
  });

  await test("plan sets isFallback=true when application data missing", () => {
    const ctx = buildAppContext({ fullname: "", submittedAt: 0 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.signerName, "(ชื่อผู้สมัคร)");
    assertEqual(sigCmd.dateText, "______________");
    assertEqual(sigCmd.timeText, "______________");
    assertEqual(sigCmd.isFallback, true);
  });

  await test("signature is NOT counted as fieldRef", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    assertEqual(plan.meta.blockCount, 1);
    assertEqual(plan.meta.fieldRefCount, 0);
    assertEqual(plan.meta.missingFieldIds.length, 0);
  });

  // ── 8. End-to-end: render signature block to actual PDF bytes ──
  console.log("\n[8] End-to-end PDF");

  await test("descriptor with signature block renders to valid PDF", async () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [SAMPLE_SIGNATURE_BLOCK],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
    // PDF magic header: %PDF-1.
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    assertEqual(header, "%PDF-");
    assertTrue(result.pageCount >= 1);
  });

  await test("descriptor with multiple blocks including signature renders", async () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo", align: "left" },
        {
          id: "h-1",
          type: "heading",
          text: "ใบสมัคร",
          size: "medium",
          bold: true,
          align: "center",
        },
        SAMPLE_SIGNATURE_BLOCK,
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    assertEqual(header, "%PDF-");
  });

  // ── 9. Visibility toggles — showName / showDate / showTime ────
  console.log("\n[9] Visibility toggles");

  await test("default config: showName=true, showDate=true, showTime=false", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          // no toggles — defaults
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.showName, true);
    assertEqual(sigCmd.showDate, true);
    assertEqual(sigCmd.showTime, false);
  });

  await test("preview hides time line when showTime=false (default)", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertFalse(
      preview.body.includes("เวลา"),
      "time line must NOT appear when showTime is false (default)"
    );
  });

  await test("preview shows time line when showTime=true (explicit)", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          showTime: true,
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "เวลา 20:37");
  });

  await test("preview hides name line when showName=false", () => {
    const ctx = buildAppContext({ fullname: "นายสมชาย ใจดี" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          showName: false,
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertFalse(
      preview.body.includes("(นายสมชาย ใจดี)"),
      "name line must NOT appear when showName is false"
    );
    // Should still show role label
    assertContains(preview.body, "ผู้สมัคร");
  });

  await test("preview hides date line when showDate=false", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          showDate: false,
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertFalse(
      preview.body.includes("วันที่"),
      "date line must NOT appear when showDate is false"
    );
  });

  await test("preview matches UAT example: showName+showDate only", () => {
    // UAT example:
    //   ลงลายมือชื่อ ______________________
    //   (นายสมชาย ใจดี)
    //   ผู้สมัคร
    //   วันที่ 7 มกราคม 2569
    //   (NO time line)
    const ctx = buildAppContext({
      fullname: "นายสมชาย ใจดี",
      submittedAt: 1767793020,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          roleLabel: "ผู้สมัคร",
          showName: true,
          showDate: true,
          showTime: false,
          align: "center",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "ลงลายมือชื่อ");
    assertContains(preview.body, "(นายสมชาย ใจดี)");
    assertContains(preview.body, "ผู้สมัคร");
    assertContains(preview.body, "วันที่ 7 มกราคม 2569");
    assertFalse(preview.body.includes("เวลา"), "UAT: no time line");
  });

  await test("all toggles off → only label + role rendered", () => {
    const ctx = buildAppContext({
      fullname: "นายสมชาย ใจดี",
      submittedAt: 1767793020,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          showName: false,
          showDate: false,
          showTime: false,
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "ลงลายมือชื่อ");
    assertContains(preview.body, "ผู้สมัคร");
    assertFalse(preview.body.includes("(นายสมชาย ใจดี)"));
    assertFalse(preview.body.includes("วันที่"));
    assertFalse(preview.body.includes("เวลา"));
  });

  await test("plan propagates showName/showDate/showTime flags correctly", () => {
    const ctx = buildAppContext({});
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "left",
          showName: false,
          showDate: true,
          showTime: true,
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.showName, false);
    assertEqual(sigCmd.showDate, true);
    assertEqual(sigCmd.showTime, true);
  });

  await test("isFallback only true if a SHOWN line has no data", () => {
    // showName=false, showDate=false → no line shown → no fallback
    const ctx = buildAppContext({ fullname: "", submittedAt: 0 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          showName: false,
          showDate: false,
          showTime: false,
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.isFallback, false);
  });

  await test("isFallback=true when shown line has no data", () => {
    const ctx = buildAppContext({ fullname: "", submittedAt: 0 });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          align: "center",
          // showName defaults true → fallback
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const sigCmd = plan.commands.find((c) => c.type === "signature");
    assertTrue(sigCmd !== undefined);
    if (!sigCmd || sigCmd.type !== "signature") return;
    assertEqual(sigCmd.isFallback, true);
  });

  // ── 10. Schema: accept new toggles ──────────────────────────────
  console.log("\n[10] Zod schema — accept toggles");

  await test("accepts signature with all toggles set", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          showName: true,
          showDate: false,
          showTime: true,
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertTrue(result.ok);
  });

  await test("rejects signature with non-boolean showTime", () => {
    const descriptor = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          showTime: "yes", // wrong type
        },
      ],
    };
    const result = validateDescriptor(descriptor);
    assertFalse(result.ok);
  });

  // ── Summary ─────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});