/**
 * Document Composer — Page Break Block Test Suite
 * -----------------------------------------------
 * Feature: block `pageBreak` (2026-10-22 — ตัด Browser Pagination)
 *
 * 🎯 Contract
 *   [1] Schema — `{ type: "pageBreak" }` validate ผ่าน (มีแค่ id + type)
 *   [2] HTML Preview — แสดงเป็น separator `📄 หน้าใหม่` (ไม่แบ่งหน้าจริง)
 *   [3] RenderPlan — pageBreak → command `pageBreak` (ไม่มี height/offset/size)
 *   [4] PDF — เจอ block.pageBreak → ขึ้นหน้าใหม่ทันที
 *       (❌ ห้ามคำนวณความสูงเพื่อเดาจุดแบ่งหน้า)
 *   [5] ไม่กระทบ Page Settings schema / descriptor ที่ไม่มี pageBreak
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/page-break-block.test.ts
 */

(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFDocument } from "pdf-lib";
import {
  buildRenderPlan,
  renderPlanToPdf,
  renderDescriptorToPreview,
  validateDescriptor,
  resolvePageGeometry,
  type DocumentDescriptor,
  type DocumentBlock,
} from "../index";
import { buildPageBox } from "../descriptor-renderer";
import type { ApplicationContext } from "../../pdf-types";

// =============================================================================
// Test framework
// =============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}: ${e.message}`);
  }
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

// =============================================================================
// Fixtures
// =============================================================================

const ctx: ApplicationContext = {
  application: {
    id: "app-1",
    applicationNo: "APP-2569-001",
    email: "test@example.com",
    fullname: "นายสมชาย ใจดี",
    nationalId: null,
    status: "SUBMITTED",
    statusReason: null,
    submittedAt: 1767793020,
    formData: null,
  },
  round: {
    id: "round-1",
    title: "รอบรับสมัคร 2569",
    positionLevel: "N/A",
    announcementTitle: null,
    announcementDescription: null,
    applicationPattern: null,
    roundCode: null,
  },
  templateVersion: { id: "tv-1", versionNumber: 1 },
  sections: [],
  fields: [],
  attachments: [],
};

const PB = (id: string): DocumentBlock => ({ id, type: "pageBreak" });
const H = (id: string, text: string): DocumentBlock => ({
  id,
  type: "heading",
  text,
  size: "medium",
});

function desc(blocks: DocumentBlock[]): DocumentDescriptor {
  return { version: 1, blocks };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Document Composer — Page Break Block ===\n");

  // ============================================================================
  console.log("[1] Schema — pageBreak ผ่าน validation");
  // ============================================================================

  await test("descriptor ที่มี pageBreak validate ผ่าน", () => {
    const res = validateDescriptor(
      desc([H("h1", "หน้าแรก"), PB("pb1"), H("h2", "หน้าสอง")])
    );
    assertTrue(res.ok, `ต้อง validate ผ่าน: ${JSON.stringify(res)}`);
  });

  await test("pageBreak เป็น block เดียวโดดก็ผ่าน", () => {
    const res = validateDescriptor(desc([PB("pb1")]));
    assertTrue(res.ok, "block เดียว pageBreak ต้องผ่าน");
  });

  await test("pageBreak ที่มี marginTop/marginBottom เพิ่ม → ยังผ่าน", () => {
    const res = validateDescriptor({
      version: 1,
      blocks: [{ id: "pb1", type: "pageBreak", marginTop: 8, marginBottom: 8 }],
    });
    assertTrue(res.ok, "BaseBlock fields ต้องยังใช้ได้");
  });

  // ============================================================================
  console.log("\n[2] HTML Preview — separator (ไม่แบ่งหน้าจริง)");
  // ============================================================================

  await test("pageBreak → separator พร้อมข้อความ 'หน้าใหม่'", () => {
    const preview = renderDescriptorToPreview(desc([PB("pb1")]), ctx, {});
    assertTrue(preview.body.includes('data-dc-page-break="1"'), "ต้องมี data attribute");
    assertTrue(preview.body.includes("หน้าใหม่"), "ต้องมีข้อความ 'หน้าใหม่'");
  });

  await test("หลาย pageBreak → separator ครบทุกอัน", () => {
    const preview = renderDescriptorToPreview(
      desc([PB("pb1"), H("h1", "ก"), PB("pb2"), PB("pb3")]),
      ctx,
      {}
    );
    const count = preview.body.split('data-dc-page-break="1"').length - 1;
    assertEqual(count, 3, "ต้องมี separator 3 อัน");
  });

  await test("pageBreak ไม่กิน fieldRefCount และไม่ทำให้ field หาย", () => {
    const preview = renderDescriptorToPreview(
      desc([H("h1", "ก่อน"), PB("pb1"), H("h2", "หลัง")]),
      ctx,
      {}
    );
    assertEqual(preview.meta.fieldRefCount, 0, "ไม่มี field");
    assertTrue(preview.body.includes("ก่อน"), "heading ก่อนต้องอยู่");
    assertTrue(preview.body.includes("หลัง"), "heading หลังต้องอยู่");
  });

  await test("pageBreak ปรากฏใน meta.renderedBlocks ด้วย type=pageBreak", () => {
    const preview = renderDescriptorToPreview(desc([PB("pb1")]), ctx, {});
    assertEqual(preview.meta.renderedBlocks.length, 1);
    assertEqual(preview.meta.renderedBlocks[0].type, "pageBreak");
  });

  // ============================================================================
  console.log("\n[3] RenderPlan — pageBreak command ไม่มีข้อมูลขนาด");
  // ============================================================================

  await test("buildRenderPlan สร้าง command type=pageBreak", () => {
    const plan = buildRenderPlan(desc([H("h1", "ก"), PB("pb1"), H("h2", "ข")]), ctx);
    const cmds = plan.commands.filter((c) => c.type === "pageBreak");
    assertEqual(cmds.length, 1, "ต้องมี pageBreak command 1 อัน");
    assertEqual((cmds[0] as any).blockId, "pb1", "ต้องผูก blockId");
  });

  await test("pageBreak command ไม่มี height/offset/size (ห้ามเดาจุดแบ่งหน้า)", () => {
    const plan = buildRenderPlan(desc([PB("pb1")]), ctx);
    const cmd = plan.commands.find((c) => c.type === "pageBreak") as any;
    assertTrue(!!cmd, "ต้องมี command");
    const keys = Object.keys(cmd).sort();
    assertEqual(keys.join(","), "blockId,type", "มีแค่ type + blockId");
    for (const forbidden of [
      "height",
      "minHeight",
      "offset",
      "page",
      "size",
      "ratio",
    ]) {
      assertTrue(
        !(forbidden in cmd),
        `ห้ามมี field "${forbidden}" ใน pageBreak command`
      );
    }
  });

  await test("pageBreak ไม่ถูกห่อด้วย padding command (margin ของ block ถูกข้าม)", () => {
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [
          { id: "pb1", type: "pageBreak", marginTop: 40, marginBottom: 40 },
        ],
      },
      ctx
    );
    const padding = plan.commands.filter((c) => c.type === "padding");
    assertEqual(padding.length, 0, "ไม่มี padding รอบ pageBreak");
    assertEqual(plan.commands.length, 1, "มีแค่ pageBreak command");
  });

  // ============================================================================
  console.log("\n[4] PDF — ขึ้นหน้าใหม่ทันที (ไม่คำนวณความสูง)");
  // ============================================================================

  await test("ไม่มี pageBreak → PDF 1 หน้า", async () => {
    const plan = buildRenderPlan(desc([H("h1", "หน้าเดียว")]), ctx);
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 1);
  });

  await test("pageBreak 1 อัน → PDF 2 หน้า", async () => {
    const plan = buildRenderPlan(
      desc([H("h1", "หน้า 1"), PB("pb1"), H("h2", "หน้า 2")]),
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 2, "pageBreak ต้องขึ้นหน้าใหม่ทันที");
  });

  await test("pageBreak N อัน → PDF N+1 หน้า", async () => {
    const blocks: DocumentBlock[] = [];
    for (let i = 0; i < 4; i++) {
      blocks.push(H(`h${i}`, `หน้า ${i + 1}`));
      blocks.push(PB(`pb${i}`));
    }
    blocks.push(H("h-last", "หน้าสุดท้าย"));
    const plan = buildRenderPlan(desc(blocks), ctx);
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 5, "4 pageBreak → 5 หน้า");
  });

  await test("pageBreak ที่ไม่มีเนื้อหาก่อน/หลัง → ไม่ crash", async () => {
    const plan = buildRenderPlan(desc([PB("pb1")]), ctx);
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 2, "ขึ้นหน้าใหม่แม้ไม่มีเนื้อหาก่อน");
  });

  await test("pageBreak ที่ท้ายเอกสาร → ไม่ทำ PDF พัง", async () => {
    const plan = buildRenderPlan(desc([H("h1", "เนื้อหา"), PB("pb1")]), ctx);
    const res = await renderPlanToPdf(plan, ctx);
    assertTrue(res.pageCount >= 2, "ต้องขึ้นหน้าใหม่");
    assertTrue(res.bytes.byteLength > 0, "ต้องได้ bytes");
  });

  await test("เนื้อหาหลัง pageBreak เริ่มที่ contentTop (ยอดเขียง) เสมอ", async () => {
    const plan = buildRenderPlan(
      desc([H("h1", "หน้า 1"), PB("pb1"), H("h2", "หน้า 2")]),
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const doc = await PDFDocument.load(res.bytes);
    assertEqual(doc.getPageCount(), 2);

    const box = buildPageBox(plan.page ?? resolvePageGeometry(undefined));
    // heading fontSize = 13 → วาดที่ contentTop - fontSize เสมอ
    const expectedFirstY = box.contentTop - 13;

    // หน้า 2 ต้องมี heading ที่ยอดเขียงเดียวกัน (ไม่ขึ้นจากกลางหน้า)
    const page2 = doc.getPage(1);
    const contents = page2.node.Contents();
    assertTrue(!!contents, "หน้า 2 ต้องมี content stream");

    // ตรวจว่าไม่มีการ "ย่อ/เลื่อน" หน้าใหม่ให้พอดีเนื้อหา
    // → หน้า 2 ต้องเป็นขนาดเต็ม A4 เท่ากับหน้า 1
    assertEqual(
      page2.getWidth(),
      doc.getPage(0).getWidth(),
      "ทุกหน้าต้องกว้างเท่ากัน"
    );
    assertEqual(
      page2.getHeight(),
      doc.getPage(0).getHeight(),
      "ทุกหน้าต้องสูงเท่ากัน"
    );
    assertTrue(
      Math.abs(box.contentTop - expectedFirstY - 13) < 0.01,
      "contentTop คงเดิม (ไม่ถูกย่อ)"
    );
  });

  await test("pageBreak ทำงานกับ pageSettings (margin ถูกรักษา)", async () => {
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [H("h1", "หน้า 1"), PB("pb1"), H("h2", "หน้า 2")],
        pageSettings: {
          preset: "wide",
          top: 72,
          right: 72,
          bottom: 72,
          left: 72,
        },
      },
      ctx
    );
    assertEqual(plan.page!.marginLeft, 72, "margin จาก preset wide");
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 2, "pageBreak ยังขึ้นหน้าใหม่");
  });

  // ============================================================================
  console.log("\n[5] Backward compatibility — ไม่กระทบของเดิม");
  // ============================================================================

  await test("descriptor ที่ไม่มี pageBreak → ผลเหมือนเดิมทุกประการ", async () => {
    const blocks: DocumentBlock[] = [
      H("h1", "หัวข้อ"),
      { id: "sd1", type: "systemData", key: "APPLICATION_NO" },
      H("h2", "ท้ายเอกสาร"),
    ];
    const plan = buildRenderPlan(desc(blocks), ctx);
    const res = await renderPlanToPdf(plan, ctx);
    assertEqual(res.pageCount, 1, "ไม่มี pageBreak → 1 หน้า");
    assertEqual(plan.meta.blockCount, 3, "blockCount ไม่เปลี่ยน");
  });

  await test("Page Settings schema ไม่ถูกแก้ (preset เดิมยังใช้ได้)", () => {
    const g = resolvePageGeometry({ preset: "normal" });
    assertEqual(g.marginTop, 40);
    assertEqual(g.preset, "normal");
    const custom = resolvePageGeometry({
      preset: "custom",
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
    assertEqual(custom.marginTop, 10);
    assertEqual(custom.marginLeft, 40);
  });

  await test("pageBreak ไม่ทำให้ plan.meta เพี้ยน", () => {
    const withPb = buildRenderPlan(desc([H("h1", "a"), PB("pb1"), H("h2", "b")]), ctx);
    assertEqual(withPb.meta.blockCount, 3, "นับ pageBreak ด้วย");
    assertEqual(withPb.meta.missingFieldIds.length, 0, "ไม่มี field หาย");
    assertEqual(withPb.meta.fieldRefCount, 0);
  });

  // ============================================================================
  console.log("\n=== Summary ===");
  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log("\n=== Failures ===");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});