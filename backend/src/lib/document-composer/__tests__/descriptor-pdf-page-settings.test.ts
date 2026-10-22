/**
 * Descriptor PDF — Page Settings (Geometry) Test Suite
 * ---------------------------------------------------
 * Feature: Document Composer — Apply Page Settings to Descriptor PDF Renderer
 *
 * ครอบคลุม:
 *   [1] Backward compatibility — descriptor เก่า (ไม่มี pageSettings) → 40pt ทุกด้าน
 *   [2] Presets (narrow/normal/wide) + custom → plan.page ตรงกับ resolvePageGeometry
 *   [3] Table width = contentWidth
 *   [4] Heading / field / systemData ข้อความยาว → wrap และไม่ล้น content box
 *   [5] Signature / logo ไม่ออกนอก margin
 *   [6] Pagination ไม่ทับ footer (ทุกบรรทัดอยู่เหนือ contentBottom)
 *   [7] Margin สูงสุด (144pt) ไม่ crash
 *   [8] Preview และ PDF ใช้ canonical margin ชุดเดียวกัน
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/descriptor-pdf-page-settings.test.ts
 */

(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFDocument } from "pdf-lib";
import {
  buildRenderPlan,
  renderPlanToPdf,
  renderDescriptorToPreview,
  resolvePageGeometry,
  type DocumentDescriptor,
  type PageSettings,
} from "../index";
import type { ApplicationContext, FieldData } from "../../pdf-types";

// =============================================================================
// Test framework
// =============================================================================

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

// =============================================================================
// Fixtures
// =============================================================================

function buildAppContext(opts: {
  formData?: Record<string, unknown>;
  fields?: FieldData[];
} = {}): ApplicationContext {
  return {
    application: {
      id: "app-1",
      applicationNo: "APP-2569-001",
      email: "test@example.com",
      fullname: "นายสมชาย ใจดี",
      nationalId: null,
      status: "SUBMITTED",
      statusReason: null,
      submittedAt: 1767793020,
      formData: opts.formData ?? null,
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
    fields: opts.fields ?? [],
    attachments: [],
  };
}

function fmField(
  fieldId: string,
  label: string,
  type: FieldData["type"] | "REPEATER" = "TEXT"
): FieldData {
  return {
    id: fieldId,
    fieldId,
    sectionId: null,
    displayOrder: 0,
    type: type as FieldData["type"],
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

/** ข้อความยาวมาก ๆ สำหรับทดสอบ wrapping */
const LONG_TEXT =
  "หัวเรื่องยาว ๆ ที่มีข้อความต่อเนื่องกันมาก ๆ เพื่อทดสอบการ wrap ให้อยู่ภายใน " +
  "content box และไม่ล้นขอบกระดาษแม้จะเลือก preset ที่มี margin เยอะที่สุด";

// =============================================================================
// PDF content stream helpers
// =============================================================================

interface TextPosition {
  x: number;
  y: number;
}

interface PdfProbe {
  /** ตำแหน่งของ text ทุกบรรทัด (จาก Tm operator) */
  texts: TextPosition[];
  /** จุดทั้งหมดของเส้น/สี่เหลี่ยม (m / l / re) */
  points: { x: number; y: number }[];
  /** ขอบเขต x ทั้งหมด */
  minX: number;
  maxX: number;
  /** ขอบเขต y ทั้งหมด */
  minY: number;
  maxY: number;
}

/**
 * ถอด content stream ที่ถูกบีบอัด (Flate) ออกมาเป็น string
 *
 * ใช้ `DecompressionStream` ซึ่งมีทั้งใน Node 18+ และ Cloudflare Workers
 * (ไม่ใช้ node:zlib เพราะ backend tsconfig ใช้ Workers types เท่านั้น)
 *
 * ถ้า stream ไม่ได้ถูกบีบอัด → คืน string ตรง ๆ
 */
async function inflateToString(bytes: Uint8Array): Promise<string> {
  try {
    const stream = new Blob([bytes as any])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    const decoded = await new Response(stream).text();
    return decoded;
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/**
 * อ่าน content stream ของ PDF ทุกหน้า แล้วดึงตำแหน่งของ text + เส้น
 *
 * pdf-lib compress content stream ด้วย Flate
 *
 * ⚠️ สี่เหลี่ยม (drawRectangle) ถูก pdf-lib แปลงเป็น path ที่มีพิกัดสัมพัทธ์
 *    ภายใน `1 0 0 1 tx ty cm` → ต้องบวก translation ก่อนเทียบกับ margin
 */
async function probePdf(bytes: Uint8Array): Promise<PdfProbe> {
  const doc = await PDFDocument.load(bytes);
  const texts: TextPosition[] = [];
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
    const contents = page.node.Contents();
    if (!contents) continue;

    const streams = Array.isArray(contents) ? contents : [contents as any];
    for (const s of streams) {
      const stream = (s as any).lookup ? (s as any).lookup(0) : s;
      if (!stream || typeof stream.getContents !== "function") continue;
      const raw = stream.getContents();
      const text = await inflateToString(raw);

      // ── เดิน token ไล่ไปตามลำดับ เพื่อตาม translation ปัจจุบัน ─────
      let offsetX = 0;
      let offsetY = 0;
      for (const line of text.split("\n")) {
        // "1 0 0 1 TX TY cm" → เปลี่ยน translation ปัจจุบัน
        const cm = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm$/.exec(line.trim());
        if (cm) {
          offsetX += Number(cm[1]);
          offsetY += Number(cm[2]);
          continue;
        }
        // "Q" → คืน translation เดิม (pdf-lib ใช้ q/Q ครอบ drawRectangle)
        if (line.trim() === "Q") {
          offsetX = 0;
          offsetY = 0;
          continue;
        }

        // Text positions: "1 0 0 1 X Y Tm" (พิกัด absolute)
        const tm = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
        if (tm) {
          texts.push({ x: Number(tm[1]), y: Number(tm[2]) });
          continue;
        }

        // Path points: "X Y m" | "X Y l" (สัมพัทธ์ภายใน cm)
        const pt = /^(-?[\d.]+) (-?[\d.]+) (m|l)$/.exec(line.trim());
        if (pt) {
          points.push({
            x: Number(pt[1]) + offsetX,
            y: Number(pt[2]) + offsetY,
          });
          continue;
        }

        // Rectangle: "X Y W H re"
        const re = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/.exec(
          line.trim()
        );
        if (re) {
          const x = Number(re[1]) + offsetX;
          const y = Number(re[2]) + offsetY;
          points.push({ x, y });
          points.push({ x: x + Number(re[3]), y: y + Number(re[4]) });
        }
      }
    }
  }

  const allX = [...texts.map((t) => t.x), ...points.map((p) => p.x)];
  const allY = [...texts.map((t) => t.y), ...points.map((p) => p.y)];

  return {
    texts,
    points,
    minX: allX.length > 0 ? Math.min(...allX) : 0,
    maxX: allX.length > 0 ? Math.max(...allX) : 0,
    minY: allY.length > 0 ? Math.min(...allY) : 0,
    maxY: allY.length > 0 ? Math.max(...allY) : 0,
  };
}

/** ค่าคงที่ที่ mirror renderer (HEADER_RESERVE / FOOTER_RESERVE) */
const HEADER_RESERVE = 0;
const FOOTER_RESERVE = 60;

/** คำนวณ content box เดียวกับ renderer เพื่อใช้ตรวจใน test */
function expectedBox(settings?: Partial<PageSettings> | null) {
  const geo = resolvePageGeometry(settings);
  const contentTop = geo.pageHeight - geo.marginTop - HEADER_RESERVE;
  let contentBottom = geo.marginBottom + FOOTER_RESERVE;
  if (contentBottom > contentTop - 120) contentBottom = contentTop - 120;
  if (contentBottom < 0) contentBottom = 0;
  return {
    geo,
    contentLeft: geo.marginLeft,
    contentRight: geo.pageWidth - geo.marginRight,
    contentTop,
    contentBottom,
    contentWidth: geo.contentWidth,
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Descriptor PDF — Page Settings Test Suite ===\n");

  // ============================================================================
  // [1] Backward compatibility — descriptor เก่า → 40pt ทุกด้าน
  // ============================================================================
  console.log("[1] Backward compatibility — fallback 40pt");

  await test("descriptor เก่า (ไม่มี pageSettings) → plan.page = normal 40pt", () => {
    const ctx = buildAppContext();
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
      },
      ctx
    );
    assertTrue(plan.page !== undefined, "plan.page ต้องมี");
    assertEqual(plan.page!.marginTop, 40);
    assertEqual(plan.page!.marginRight, 40);
    assertEqual(plan.page!.marginBottom, 40);
    assertEqual(plan.page!.marginLeft, 40);
    assertEqual(plan.page!.preset, "normal");
  });

  await test("descriptor เก่า → PDF วาดที่ x = 40 (ขอบซ้ายเดิม)", async () => {
    const ctx = buildAppContext();
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    assertTrue(probe.texts.length > 0, "ต้องมี text ใน PDF");
    assertEqual(probe.minX, 40);
  });

  await test("descriptor เก่า → content top/bottom เดิม (40 + footer/header reserve)", async () => {
    const ctx = buildAppContext();
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(undefined);
    // บรรทัดแรกอยู่ที่ contentTop - fontSize
    assertTrue(
      Math.abs(probe.maxY - (box.contentTop - 13)) < 0.01,
      `maxY ${probe.maxY} ต้องเท่ากับ ${box.contentTop - 13}`
    );
  });

  // ============================================================================
  // [2] Presets + custom
  // ============================================================================
  console.log("\n[2] Presets + custom → plan.page ตรงกับ resolvePageGeometry");

  const presets: { preset: "narrow" | "normal" | "wide"; margin: number }[] = [
    { preset: "narrow", margin: 28 },
    { preset: "normal", margin: 40 },
    { preset: "wide", margin: 72 },
  ];

  for (const { preset, margin } of presets) {
    await test(`preset ${preset} → margin ${margin}pt ทุกด้านใน plan.page`, () => {
      const ctx = buildAppContext();
      const plan = buildRenderPlan(
        {
          version: 1,
          blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
          pageSettings: {
            preset,
            top: margin,
            right: margin,
            bottom: margin,
            left: margin,
          },
        },
        ctx
      );
      assertEqual(plan.page!.marginTop, margin);
      assertEqual(plan.page!.marginRight, margin);
      assertEqual(plan.page!.marginBottom, margin);
      assertEqual(plan.page!.marginLeft, margin);
      assertEqual(plan.page!.preset, preset);
    });
  }

  await test("preset narrow/normal/wide เปลี่ยนพื้นที่ PDF จริง (x ต่างกัน)", async () => {
    const ctx = buildAppContext();
    const xs: number[] = [];
    for (const { preset, margin } of presets) {
      const plan = buildRenderPlan(
        {
          version: 1,
          blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
          pageSettings: {
            preset,
            top: margin,
            right: margin,
            bottom: margin,
            left: margin,
          },
        },
        ctx
      );
      const res = await renderPlanToPdf(plan, ctx);
      const probe = await probePdf(res.bytes);
      xs.push(probe.minX);
    }
    assertEqual(xs[0], 28);
    assertEqual(xs[1], 40);
    assertEqual(xs[2], 72);
  });

  await test("preset custom ใช้ค่าต่อด้าน (ไม่สมมาตร)", async () => {
    const ctx = buildAppContext();
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: {
          preset: "custom",
          top: 20,
          right: 30,
          bottom: 40,
          left: 50,
        },
      },
      ctx
    );
    assertEqual(plan.page!.marginTop, 20);
    assertEqual(plan.page!.marginRight, 30);
    assertEqual(plan.page!.marginBottom, 40);
    assertEqual(plan.page!.marginLeft, 50);

    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    // ขอบซ้าย = 50, ขอบขวา = pageWidth - 30
    assertEqual(probe.minX, 50);
  });

  await test("preset custom → margin แยก top/right/bottom/left มีผลจริง", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "custom",
      top: 100,
      right: 20,
      bottom: 30,
      left: 15,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    assertEqual(probe.minX, 15);
    // ขอบขวา: pageWidth - marginRight
    assertTrue(
      probe.maxX <= box.contentRight + 0.01,
      `maxX ${probe.maxX} ต้อง ≤ contentRight ${box.contentRight}`
    );
    // ขอบบน: contentTop = pageHeight - marginTop - headerReserve
    assertTrue(
      probe.maxY <= box.contentTop + 0.01,
      `maxY ${probe.maxY} ต้อง ≤ contentTop ${box.contentTop}`
    );
  });

  // ============================================================================
  // [3] Table width = contentWidth
  // ============================================================================
  console.log("\n[3] Table width ตาม contentWidth");

  for (const { preset, margin } of presets) {
    await test(`preset ${preset} → ความกว้างตาราง = contentWidth (${margin}pt)`, async () => {
      const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
      const ctx = buildAppContext({
        formData: {
          "fm-list": [
            { year: "2560", note: "ทำงาน" },
            { year: "2561", note: "ศึกษา" },
          ],
        },
        fields,
      });
      const settings: PageSettings = {
        preset,
        top: margin,
        right: margin,
        bottom: margin,
        left: margin,
      };
      const plan = buildRenderPlan(
        {
          version: 1,
          blocks: [{ id: "t-1", type: "table", fieldId: "fm-list" }],
          pageSettings: settings,
        },
        ctx
      );
      const res = await renderPlanToPdf(plan, ctx);
      const probe = await probePdf(res.bytes);
      const box = expectedBox(settings);
      // เส้นขอบตาราง: ขวาสุด = contentLeft + contentWidth
      assertTrue(
        Math.abs(probe.maxX - (box.contentLeft + box.contentWidth)) < 0.5,
        `ขวาสุดของตาราง ${probe.maxX} ต้อง = ${box.contentLeft + box.contentWidth}`
      );
      assertTrue(
        Math.abs(probe.minX - box.contentLeft) < 0.5,
        `ซ้ายสุดของตาราง ${probe.minX} ต้อง = ${box.contentLeft}`
      );
    });
  }

  await test("preset custom → ความกว้างตารางตาม contentWidth ที่ไม่สมมาตร", async () => {
    const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
    const ctx = buildAppContext({
      formData: { "fm-list": [{ year: "2560" }] },
      fields,
    });
    const settings: PageSettings = {
      preset: "custom",
      top: 40,
      right: 120,
      bottom: 40,
      left: 30,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "t-1", type: "table", fieldId: "fm-list" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    assertTrue(
      Math.abs(probe.maxX - (box.contentLeft + box.contentWidth)) < 0.5,
      `ขวาสุดของตาราง ${probe.maxX} ต้อง = ${box.contentLeft + box.contentWidth}`
    );
  });

  // ============================================================================
  // [4] Text wrapping — heading / field / systemData
  // ============================================================================
  console.log("\n[4] Text wrapping — heading / field / systemData ข้อความยาว");

  for (const { preset, margin } of presets) {
    await test(`preset ${preset} → heading ยาวถูก wrap และไม่ล้น content box`, async () => {
      const ctx = buildAppContext();
      const settings: PageSettings = {
        preset,
        top: margin,
        right: margin,
        bottom: margin,
        left: margin,
      };
      const plan = buildRenderPlan(
        {
          version: 1,
          blocks: [{ id: "h-1", type: "heading", text: LONG_TEXT, size: "large" }],
          pageSettings: settings,
        },
        ctx
      );
      const res = await renderPlanToPdf(plan, ctx);
      const probe = await probePdf(res.bytes);
      const box = expectedBox(settings);
      assertTrue(probe.texts.length > 1, "heading ยาวต้องถูก wrap เป็นหลายบรรทัด");
      for (const t of probe.texts) {
        assertTrue(
          t.x >= box.contentLeft - 0.01,
          `x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
        );
        assertTrue(
          t.x <= box.contentRight + 0.01,
          `x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
        );
      }
    });
  }

  await test("field value ยาวถูก wrap และไม่ล้น content box", async () => {
    const fields = [fmField("fm-desc", "รายละเอียด")];
    const ctx = buildAppContext({
      formData: { "fm-desc": LONG_TEXT },
      fields,
    });
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "f-1", type: "field", fieldId: "fm-desc" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    assertTrue(probe.texts.length > 1, "field value ยาวต้องถูก wrap");
    for (const t of probe.texts) {
      assertTrue(
        t.x >= box.contentLeft - 0.01,
        `x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
      assertTrue(
        t.x <= box.contentRight + 0.01,
        `x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
      );
    }
  });

  await test("systemData value ยาวถูก wrap และไม่ล้น content box", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [
          {
            id: "sd-1",
            type: "systemData",
            key: "ROUND_NAME",
            label: "ชื่อรอบที่มีข้อความยาวมาก ๆ ที่ต้องถูก wrap ไม่ให้ล้นขอบ",
          },
        ],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    assertTrue(probe.texts.length > 1, "systemData label ยาวต้องถูก wrap");
    for (const t of probe.texts) {
      assertTrue(
        t.x >= box.contentLeft - 0.01,
        `x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
      assertTrue(
        t.x <= box.contentRight + 0.01,
        `x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
      );
    }
  });

  await test("heading align=right ยาว → ทุกบรรทัดอยู่ใน content box และชิดขวา", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "narrow",
      top: 28,
      right: 28,
      bottom: 28,
      left: 28,
    };
    const box = expectedBox(settings);

    // ── render 2 แบบ: left vs right (ข้อความเดียวกัน) ─────────────
    const render = async (align: "left" | "right") => {
      const plan = buildRenderPlan(
        {
          version: 1,
          blocks: [
            { id: "h-1", type: "heading", text: LONG_TEXT, size: "medium", align },
          ],
          pageSettings: settings,
        },
        ctx
      );
      const res = await renderPlanToPdf(plan, ctx);
      return await probePdf(res.bytes);
    };

    const leftProbe = await render("left");
    const rightProbe = await render("right");

    assertTrue(rightProbe.texts.length > 1, "heading ยาวต้องถูก wrap");
    for (const t of rightProbe.texts) {
      assertTrue(
        t.x >= box.contentLeft - 0.01,
        `x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
      assertTrue(
        t.x <= box.contentRight + 0.01,
        `x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
      );
    }

    // align=right → จุดเริ่มของ text ต้องชิดขวากว่า align=left
    // (ถ้า align ถูกเมิน ค่าจะเท่ากัน)
    assertTrue(
      rightProbe.maxX > leftProbe.maxX,
      `align=right ต้องเริ่มชิดขวากว่า align=left (${rightProbe.maxX} > ${leftProbe.maxX})`
    );
  });

  // ============================================================================
  // [5] Signature / logo ไม่ออกนอก margin
  // ============================================================================
  console.log("\n[5] Signature / logo ไม่ออกนอก margin");

  await test("signature ไม่ออกนอก content box (preset wide)", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [
          {
            id: "sig-1",
            type: "signature",
            lineLabel: "ลงลายมือชื่อผู้สมัครที่มีชื่อยาวมาก ๆ เพื่อทดสอบ",
            showDate: true,
            showTime: true,
          },
        ],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    for (const t of probe.texts) {
      assertTrue(
        t.x >= box.contentLeft - 0.01,
        `signature x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
      assertTrue(
        t.x <= box.contentRight + 0.01,
        `signature x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
      );
    }
  });

  await test("logo ไม่ออกนอก content box (preset narrow)", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "narrow",
      top: 28,
      right: 28,
      bottom: 28,
      left: 28,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [
          { id: "logo-1", type: "logo", source: "organization", width: 70 },
        ],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    // รูปโลโก้ (ถ้ามี) หรือข้อความ placeholder ต้องอยู่ในกรอบ
    const allX = [...probe.texts.map((t) => t.x), ...probe.points.map((p) => p.x)];
    if (allX.length > 0) {
      assertTrue(
        Math.min(...allX) >= box.contentLeft - 0.5,
        `logo x ${Math.min(...allX)} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
    }
  });

  await test("logo placeholder text อยู่ใน content box (preset wide)", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "logo-1", type: "logo", source: "upload" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    for (const t of probe.texts) {
      assertTrue(
        t.x >= box.contentLeft - 0.01,
        `logo text x ${t.x} ต้อง ≥ contentLeft ${box.contentLeft}`
      );
      assertTrue(
        t.x <= box.contentRight + 0.01,
        `logo text x ${t.x} ต้อง ≤ contentRight ${box.contentRight}`
      );
    }
  });

  // ============================================================================
  // [6] Pagination ไม่ทับ footer
  // ============================================================================
  console.log("\n[6] Pagination — ไม่ทับ footer");

  await test("เอกสารยาวมาก → ทุกบรรทัดอยู่เหนือ contentBottom", async () => {
    const fields = [fmField("fm-desc", "รายละเอียด")];
    const ctx = buildAppContext({
      formData: { "fm-desc": Array.from({ length: 120 }, () => LONG_TEXT).join("\n") },
      fields,
    });
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "f-1", type: "field", fieldId: "fm-desc" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    assertTrue(res.pageCount > 1, "เอกสารยาวต้องมีหลายหน้า");
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    for (const t of probe.texts) {
      assertTrue(
        t.y >= box.contentBottom - 0.01,
        `text y ${t.y} ต้อง ≥ contentBottom ${box.contentBottom} (ห้ามทับ footer)`
      );
    }
  });

  await test("table ยาวมาก → ไม่ทับ footer และ header ตารางซ้ำทุกหน้า", async () => {
    const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
    const ctx = buildAppContext({
      formData: {
        "fm-list": Array.from({ length: 200 }, (_, i) => ({
          year: String(2560 + i),
          note: "ข้อความรายการที่ " + i,
        })),
      },
      fields,
    });
    const settings: PageSettings = {
      preset: "normal",
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "t-1", type: "table", fieldId: "fm-list" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    assertTrue(res.pageCount > 1, "ตารางยาวต้องมีหลายหน้า");
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    for (const p of probe.points) {
      assertTrue(
        p.y >= box.contentBottom - 0.5,
        `เส้นตาราง y ${p.y} ต้อง ≥ contentBottom ${box.contentBottom}`
      );
    }
  });

  await test("margin บน/ล่างต่างกัน → contentBottom เปลี่ยนตาม marginBottom", async () => {
    const ctx = buildAppContext();
    const settings: PageSettings = {
      preset: "custom",
      top: 20,
      right: 40,
      bottom: 100,
      left: 40,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probePdf(res.bytes);
    const box = expectedBox(settings);
    assertTrue(
      Math.abs(box.contentBottom - (100 + FOOTER_RESERVE)) < 0.01,
      `contentBottom ${box.contentBottom} ต้อง = marginBottom + footerReserve`
    );
    assertTrue(probe.maxY <= box.contentTop + 0.01);
  });

  // ============================================================================
  // [7] Margin สูงสุด ไม่ crash
  // ============================================================================
  console.log("\n[7] Margin สูงสุด — ไม่ crash / ไม่ infinite pagination");

  await test("custom ทุกด้าน = 144pt (สูงสุด) → ไม่ crash", async () => {
    const fields = [fmField("fm-desc", "รายละเอียด")];
    const ctx = buildAppContext({
      formData: { "fm-desc": LONG_TEXT },
      fields,
    });
    const settings: PageSettings = {
      preset: "custom",
      top: 144,
      right: 144,
      bottom: 144,
      left: 144,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [
          { id: "h-1", type: "heading", text: LONG_TEXT, size: "large" },
          { id: "f-1", type: "field", fieldId: "fm-desc" },
          { id: "sig-1", type: "signature" },
        ],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    assertTrue(res.bytes.length > 0, "PDF ต้องถูกสร้าง");
    assertTrue(res.pageCount >= 1);
    // ต้องไม่เกิด infinite pagination → จำนวนหน้าต้องมีขอบเขต
    assertTrue(res.pageCount < 200, `pageCount ${res.pageCount} แปลว่า pagination วน`);
  });

  await test("preset wide + ตารางยาว → ไม่ crash และไม่วนหน้า", async () => {
    const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
    const ctx = buildAppContext({
      formData: {
        "fm-list": Array.from({ length: 500 }, (_, i) => ({
          year: String(2560 + i),
          note: "ข้อความ " + i,
        })),
      },
      fields,
    });
    const settings: PageSettings = {
      preset: "wide",
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    };
    const plan = buildRenderPlan(
      {
        version: 1,
        blocks: [{ id: "t-1", type: "table", fieldId: "fm-list" }],
        pageSettings: settings,
      },
      ctx
    );
    const res = await renderPlanToPdf(plan, ctx);
    assertTrue(res.pageCount >= 1);
    assertTrue(res.pageCount < 200, `pageCount ${res.pageCount} แปลว่า pagination วน`);
  });

  await test("margin สูงสุด → content box ไม่ติดลบ (contentBottom < contentTop)", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 144,
      right: 144,
      bottom: 144,
      left: 144,
    });
    const box = expectedBox({
      preset: "custom",
      top: 144,
      right: 144,
      bottom: 144,
      left: 144,
    });
    assertTrue(box.contentTop > box.contentBottom, "content box ต้องไม่ติดลบ");
    assertTrue(box.contentBottom >= 0, "contentBottom ต้อง ≥ 0");
    assertTrue(geo.contentWidth >= 200);
  });

  // ============================================================================
  // [8] Preview และ PDF ใช้ canonical margin ชุดเดียวกัน
  // ============================================================================
  console.log("\n[8] Preview และ PDF ใช้ canonical margin ชุดเดียวกัน");

  for (const { preset, margin } of presets) {
    await test(`preset ${preset} → preview.page ตรงกับ PDF plan.page`, () => {
      const ctx = buildAppContext();
      const settings: PageSettings = {
        preset,
        top: margin,
        right: margin,
        bottom: margin,
        left: margin,
      };
      const descriptor: DocumentDescriptor = {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
        pageSettings: settings,
      };
      const preview = renderDescriptorToPreview(descriptor, ctx);
      const plan = buildRenderPlan(descriptor, ctx);
      assertEqual(preview.page.marginTop, plan.page!.marginTop);
      assertEqual(preview.page.marginRight, plan.page!.marginRight);
      assertEqual(preview.page.marginBottom, plan.page!.marginBottom);
      assertEqual(preview.page.marginLeft, plan.page!.marginLeft);
      assertEqual(preview.page.contentWidth, plan.page!.contentWidth);
      assertEqual(preview.page.preset, plan.page!.preset);
    });
  }

  await test("descriptor เก่า → preview และ PDF ใช้ 40pt ทุกด้านเหมือนกัน", () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    const plan = buildRenderPlan(descriptor, ctx);
    assertEqual(preview.page.marginTop, 40);
    assertEqual(preview.page.marginLeft, 40);
    assertEqual(plan.page!.marginTop, 40);
    assertEqual(plan.page!.marginLeft, 40);
  });

  // ============================================================================
  // End
  // ============================================================================
  if (failed > 0) {
    console.log(`\n✗ ${failed} failed:`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exit(1);
  }
  console.log(`\n✓ All ${passed} tests passed.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[FATAL] test runner crashed:", err);
  process.exit(1);
});
