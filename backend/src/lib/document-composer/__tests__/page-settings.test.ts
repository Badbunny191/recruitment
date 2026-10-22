/**
 * Page Settings — Targeted Test Suite
 * --------------------------------------------
 * Feature: Document Composer — Page Settings (ขอบกระดาษ)
 *
 * ครอบคลุม:
 *   [1] Backward compatibility — descriptor เก่าไม่มี pageSettings → 40pt ทุกด้าน
 *   [2] Presets — narrow 28 / normal 40 / wide 72
 *   [3] Custom — top/right/bottom/left
 *   [4] Clamp / fallback — NaN, Infinity, ติดลบ, เกินช่วง, ค่าแปลกปลอม
 *   [5] contentWidth / contentHeight อย่างน้อย 200pt
 *   [6] mm/pt conversion
 *   [7] Route schema ไม่ strip pageSettings
 *   [8] Preview ใช้ margin ที่เลือก (resolvePageGeometry → page geometry)
 *   [9] Automatic Header ไม่กลับมา
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/page-settings.test.ts
 */

(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { z } from "zod";
import {
  resolvePageGeometry,
  createDefaultPageSettings,
  clampMarginPt,
  normalizePreset,
  ptToMm,
  mmToPt,
  validateDescriptor,
  renderDescriptorToPreview,
  MIN_MARGIN_PT,
  MAX_MARGIN_PT,
  MIN_CONTENT_SIZE_PT,
  PRESET_MARGIN_PT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  PageSettingsSchema,
} from "../index";
import type { ApplicationContext } from "../../pdf-types";

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

function assertContains(haystack: string, needle: string, msg = "") {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${msg} expected substring ${JSON.stringify(needle)} not found`
    );
  }
}

function assertNotContains(haystack: string, needle: string, msg = "") {
  if (haystack.includes(needle)) {
    throw new Error(`${msg} unexpected substring ${JSON.stringify(needle)} found`);
  }
}

// =============================================================================
// Fixtures
// =============================================================================

function buildAppContext(): ApplicationContext {
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
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Page Settings — Targeted Test Suite ===\n");

  // ============================================================================
  // [1] Backward compatibility — 40pt ทุกด้าน
  // ============================================================================
  console.log("[1] Backward compatibility — fallback 40pt");

  await test("descriptor เก่าไม่มี pageSettings → resolve ได้ 40pt ทุกด้าน", () => {
    const geo = resolvePageGeometry(undefined);
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginRight, 40);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 40);
    assertEqual(geo.preset, "normal");
  });

  await test("descriptor เก่ายังผ่าน validateDescriptor ได้", () => {
    const result = validateDescriptor({
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
    });
    assertTrue(result.ok);
  });

  await test("descriptor เก่า validate แล้ว pageSettings = undefined (ไม่ถูก inject)", () => {
    const result = validateDescriptor({
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual((result.value as any).pageSettings, undefined);
  });

  await test("null pageSettings → fallback 40pt", () => {
    const geo = resolvePageGeometry(null);
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginLeft, 40);
  });

  await test("pageSettings = {} → fallback 40pt", () => {
    const geo = resolvePageGeometry({});
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginBottom, 40);
  });

  await test("createDefaultPageSettings → normal 40pt ทุกด้าน", () => {
    const def = createDefaultPageSettings();
    assertEqual(def.preset, "normal");
    assertEqual(def.top, 40);
    assertEqual(def.right, 40);
    assertEqual(def.bottom, 40);
    assertEqual(def.left, 40);
  });

  // ============================================================================
  // [2] Presets
  // ============================================================================
  console.log("\n[2] Presets — narrow 28 / normal 40 / wide 72");

  await test("preset narrow → 28pt ทุกด้าน", () => {
    const geo = resolvePageGeometry({
      preset: "narrow",
      top: 28,
      right: 28,
      bottom: 28,
      left: 28,
    });
    assertEqual(geo.preset, "narrow");
    assertEqual(geo.marginTop, 28);
    assertEqual(geo.marginRight, 28);
    assertEqual(geo.marginBottom, 28);
    assertEqual(geo.marginLeft, 28);
  });

  await test("preset normal → 40pt ทุกด้าน", () => {
    const geo = resolvePageGeometry({ preset: "normal" });
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginRight, 40);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 40);
  });

  await test("preset wide → 72pt ทุกด้าน", () => {
    const geo = resolvePageGeometry({ preset: "wide" });
    assertEqual(geo.marginTop, 72);
    assertEqual(geo.marginRight, 72);
    assertEqual(geo.marginBottom, 72);
    assertEqual(geo.marginLeft, 72);
  });

  await test("preset ถูกต้องตามค่าคงที่ (28/40/72)", () => {
    assertEqual(PRESET_MARGIN_PT.narrow, 28);
    assertEqual(PRESET_MARGIN_PT.normal, 40);
    assertEqual(PRESET_MARGIN_PT.wide, 72);
  });

  await test("preset ที่ไม่รู้จัก → fallback normal", () => {
    const geo = resolvePageGeometry({ preset: "gigantic" as any });
    assertEqual(geo.preset, "normal");
    assertEqual(geo.marginTop, 40);
  });

  await test("normalizePreset คืน normal สำหรับค่าเสีย", () => {
    assertEqual(normalizePreset(undefined), "normal");
    assertEqual(normalizePreset(null), "normal");
    assertEqual(normalizePreset(123), "normal");
    assertEqual(normalizePreset("custom"), "custom");
  });

  await test("preset ที่เลือก — ค่า top/right/bottom/left ใน descriptor ถูกเมิน", () => {
    const geo = resolvePageGeometry({
      preset: "wide",
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    });
    assertEqual(geo.marginTop, 72);
    assertEqual(geo.marginLeft, 72);
  });

  // ============================================================================
  // [3] Custom
  // ============================================================================
  console.log("\n[3] Custom — top/right/bottom/left");

  await test("preset custom ใช้ค่าต่อด้านที่กำหนด", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 20,
      right: 30,
      bottom: 40,
      left: 50,
    });
    assertEqual(geo.preset, "custom");
    assertEqual(geo.marginTop, 20);
    assertEqual(geo.marginRight, 30);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 50);
  });

  await test("preset custom ค่าด้านที่ไม่ได้ระบุ → fallback 40pt", () => {
    const geo = resolvePageGeometry({ preset: "custom", top: 25 });
    assertEqual(geo.marginTop, 25);
    assertEqual(geo.marginRight, 40);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 40);
  });

  // ============================================================================
  // [4] Clamp / fallback
  // ============================================================================
  console.log("\n[4] Clamp / fallback — invalid, NaN, Infinity");

  await test("ค่าต่ำกว่า 10pt → clamp เป็น 10", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 0,
      right: 5,
      bottom: -50,
      left: 1,
    });
    assertEqual(geo.marginTop, 10);
    assertEqual(geo.marginRight, 10);
    assertEqual(geo.marginBottom, 10);
    assertEqual(geo.marginLeft, 10);
  });

  await test("ค่าสูงกว่า 144pt → clamp เป็น 144", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 500,
      right: 999,
      bottom: 145,
      left: 1000,
    });
    assertEqual(geo.marginTop, 144);
    assertEqual(geo.marginRight, 144);
    assertEqual(geo.marginBottom, 144);
    assertEqual(geo.marginLeft, 144);
  });

  await test("NaN → fallback 40pt (ไม่ crash)", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: Number.NaN,
      right: Number.NaN,
      bottom: Number.NaN,
      left: Number.NaN,
    });
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginRight, 40);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 40);
  });

  await test("Infinity → clamp เป็น 144 (ไม่ crash)", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: Number.POSITIVE_INFINITY,
      right: Number.POSITIVE_INFINITY,
      bottom: Number.POSITIVE_INFINITY,
      left: Number.POSITIVE_INFINITY,
    });
    assertEqual(geo.marginTop, 144);
    assertEqual(geo.marginLeft, 144);
  });

  await test("-Infinity → clamp เป็น 10 (ไม่ crash)", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: Number.NEGATIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
      left: Number.NEGATIVE_INFINITY,
    });
    assertEqual(geo.marginTop, 10);
    assertEqual(geo.marginLeft, 10);
  });

  await test("ค่าที่ไม่ใช่ number (string / null / object) → fallback 40pt", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: "abc" as any,
      right: null as any,
      bottom: {} as any,
      left: undefined,
    });
    assertEqual(geo.marginTop, 40);
    assertEqual(geo.marginRight, 40);
    assertEqual(geo.marginBottom, 40);
    assertEqual(geo.marginLeft, 40);
  });

  await test("clampMarginPt รับค่าเสียได้โดยไม่ throw", () => {
    assertEqual(clampMarginPt(Number.NaN), 40);
    assertEqual(clampMarginPt(Number.POSITIVE_INFINITY), 144);
    assertEqual(clampMarginPt(Number.NEGATIVE_INFINITY), 10);
    assertEqual(clampMarginPt("x" as any), 40);
    assertEqual(clampMarginPt(undefined), 40);
    assertEqual(clampMarginPt(-1), 10);
    assertEqual(clampMarginPt(1000), 144);
    assertEqual(clampMarginPt(40), 40);
  });

  await test("ช่วงที่ยอมรับคือ 10–144pt", () => {
    assertEqual(MIN_MARGIN_PT, 10);
    assertEqual(MAX_MARGIN_PT, 144);
  });

  // ============================================================================
  // [5] contentWidth / contentHeight
  // ============================================================================
  console.log("\n[5] contentWidth / contentHeight");

  await test("contentWidth = pageWidth - left - right", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      left: 40,
      right: 40,
      top: 40,
      bottom: 40,
    });
    assertEqual(geo.pageWidth, PAGE_WIDTH_PT);
    assertEqual(geo.contentWidth, 515.3);
  });

  await test("contentHeight = pageHeight - top - bottom", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 40,
      bottom: 40,
      left: 40,
      right: 40,
    });
    assertEqual(geo.pageHeight, PAGE_HEIGHT_PT);
    assertEqual(geo.contentHeight, 761.9);
  });

  await test("contentWidth / contentHeight ไม่น้อยกว่า 200pt", () => {
    const geo = resolvePageGeometry({
      preset: "custom",
      top: 144,
      right: 144,
      bottom: 144,
      left: 144,
    });
    assertTrue(geo.contentWidth >= MIN_CONTENT_SIZE_PT, "contentWidth ต้อง ≥ 200");
    assertTrue(geo.contentHeight >= MIN_CONTENT_SIZE_PT, "contentHeight ต้อง ≥ 200");
    assertEqual(MIN_CONTENT_SIZE_PT, 200);
  });

  await test("preset wide → content แคบลงแต่ยัง ≥ 200pt", () => {
    const geo = resolvePageGeometry({ preset: "wide" });
    assertTrue(geo.contentWidth >= MIN_CONTENT_SIZE_PT);
    assertTrue(geo.contentHeight >= MIN_CONTENT_SIZE_PT);
    assertEqual(geo.contentWidth, 451.3);
  });

  // ============================================================================
  // [6] mm/pt conversion
  // ============================================================================
  console.log("\n[6] mm/pt conversion");

  await test("ptToMm(28) = 9.9, ptToMm(40) = 14.1, ptToMm(72) = 25.4", () => {
    assertEqual(ptToMm(28), 9.9);
    assertEqual(ptToMm(40), 14.1);
    assertEqual(ptToMm(72), 25.4);
  });

  await test("mmToPt(9.9) ≈ 28, mmToPt(14.1) ≈ 40, mmToPt(25.4) = 72", () => {
    // ⚠️ 9.9mm → 28.06pt → ปัด 1 ตำแหน่ง = 28.1pt (ไม่ใช่ 28 พอดี)
    //    แต่ UI round-trip ได้: 28.1pt → 9.9mm (ดู test ใน frontend)
    assertEqual(mmToPt(25.4), 72);
    assertEqual(mmToPt(14.1), 40);
    assertEqual(mmToPt(9.9), 28.1);
  });

  await test("UI round-trip: pt → mm → pt คงค่าเดิม (ในช่วงที่แสดงผล)", () => {
    // 28pt → 9.9mm → 28.1pt (ค่าใกล้เคียงเดิม ไม่หายไป)
    assertEqual(mmToPt(ptToMm(28)), 28.1);
    assertEqual(mmToPt(ptToMm(40)), 40);
    assertEqual(mmToPt(ptToMm(72)), 72);
  });

  await test("mmToPt ค่าเสีย → fallback 40pt", () => {
    assertEqual(mmToPt(Number.NaN), 40);
    assertEqual(mmToPt(Number.POSITIVE_INFINITY), 40);
  });

  await test("ptToMm ค่าเสีย → 0 (ไม่ crash)", () => {
    assertEqual(ptToMm(Number.NaN), 0);
    assertEqual(ptToMm(Number.POSITIVE_INFINITY), 0);
  });

  // ============================================================================
  // [7] Zod schema
  // ============================================================================
  console.log("\n[7] Zod schema — pageSettings");

  await test("PageSettingsSchema คงค่า preset + ค่าต่อด้าน", () => {
    const parsed = PageSettingsSchema.parse({
      preset: "custom",
      top: 20,
      right: 30,
      bottom: 40,
      left: 50,
    });
    assertEqual(parsed?.preset, "custom");
    assertEqual(parsed?.top, 20);
    assertEqual(parsed?.right, 30);
    assertEqual(parsed?.bottom, 40);
    assertEqual(parsed?.left, 50);
  });

  await test("PageSettingsSchema ค่าเสีย → clamp / fallback (ไม่ throw)", () => {
    const parsed = PageSettingsSchema.parse({
      preset: "custom",
      top: Number.NaN,
      right: 9999,
      bottom: -100,
      left: 40,
    });
    assertEqual(parsed?.top, 40);
    assertEqual(parsed?.right, 144);
    assertEqual(parsed?.bottom, 10);
    assertEqual(parsed?.left, 40);
  });

  await test("PageSettingsSchema ค่าที่ไม่ใช่ object → undefined (fallback)", () => {
    assertEqual(PageSettingsSchema.parse("nonsense"), undefined);
    assertEqual(PageSettingsSchema.parse(123), undefined);
    assertEqual(PageSettingsSchema.parse(null), undefined);
    assertEqual(PageSettingsSchema.parse([1, 2]), undefined);
  });

  await test("preset ที่ไม่รู้จัก → normal", () => {
    const parsed = PageSettingsSchema.parse({ preset: "huge" });
    assertEqual(parsed?.preset, "normal");
  });

  await test("descriptor ที่มี pageSettings ผ่าน validateDescriptor", () => {
    const result = validateDescriptor({
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
      pageSettings: { preset: "custom", top: 20, right: 30, bottom: 40, left: 50 },
    });
    assertTrue(result.ok);
  });

  await test("descriptor ที่มี pageSettings เสีย ก็ไม่ทำให้ validation crash", () => {
    const result = validateDescriptor({
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
      pageSettings: { preset: "custom", top: "abc" },
    });
    assertTrue(result.ok);
  });

  // ============================================================================
  // [8] Route schema — ไม่ strip pageSettings
  // ============================================================================
  console.log("\n[8] Route schema — ไม่ strip pageSettings");

  // จำลอง schema ของ route (mirror template-descriptor.routes.ts)
  const SaveDescriptorRequestSchema = z.object({
    descriptor: z.object({
      version: z.literal(1),
      blocks: z.array(z.any()).min(1),
      pageSettings: PageSettingsSchema.optional(),
    }),
    expectedSchemaVersion: z.number().int().nonnegative().optional(),
  });

  await test("Save route schema ไม่ strip pageSettings", () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
        pageSettings: { preset: "wide", top: 72, right: 72, bottom: 72, left: 72 },
      },
    });
    assertTrue(result.success);
    if (!result.success) return;
    const ps = (result.data.descriptor as any).pageSettings;
    assertTrue(ps !== undefined, "pageSettings ต้องไม่ถูก strip");
    assertEqual(ps.preset, "wide");
    assertEqual(ps.top, 72);
  });

  await test("Save route schema ยังรับ descriptor เก่าที่ไม่มี pageSettings", () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
      },
    });
    assertTrue(result.success);
  });

  await test("Save route schema ค่าเสีย → ไม่ throw (กลายเป็นค่า clamp แล้ว)", () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "T", size: "medium" }],
        pageSettings: { preset: "custom", top: Number.NaN },
      },
    });
    assertTrue(result.success);
  });

  // ============================================================================
  // [9] Preview ใช้ margin ที่เลือก
  // ============================================================================
  console.log("\n[9] Preview — ใช้ geometry ที่เลือก");

  await test("preview.page สะท้อนค่าที่เลือก (preset narrow)", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: {
          preset: "narrow",
          top: 28,
          right: 28,
          bottom: 28,
          left: 28,
        },
      },
      ctx
    );
    assertEqual(preview.page.preset, "narrow");
    assertEqual(preview.page.marginTop, 28);
    assertEqual(preview.page.marginLeft, 28);
    assertEqual(preview.page.contentWidth, 539.3);
  });

  await test("preview.page สะท้อนค่า custom ต่อด้าน", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: { preset: "custom", top: 20, right: 30, bottom: 40, left: 50 },
      },
      ctx
    );
    assertEqual(preview.page.marginTop, 20);
    assertEqual(preview.page.marginRight, 30);
    assertEqual(preview.page.marginBottom, 40);
    assertEqual(preview.page.marginLeft, 50);
  });

  await test("preview ของ descriptor เก่า → page.margin = 40pt ทุกด้าน", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
      },
      ctx
    );
    assertEqual(preview.page.marginTop, 40);
    assertEqual(preview.page.marginRight, 40);
    assertEqual(preview.page.marginBottom, 40);
    assertEqual(preview.page.marginLeft, 40);
  });

  // ============================================================================
  // [10] Automatic Header ไม่กลับมา
  // ============================================================================
  console.log("\n[10] Automatic Header — ต้องไม่กลับมา");

  await test("includeHeader=false → header ว่าง (ไม่มี Automatic Header)", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: { preset: "wide", top: 72, right: 72, bottom: 72, left: 72 },
      },
      ctx,
      { includeHeader: false }
    );
    assertEqual(preview.header, "");
  });

  await test("pageSettings ไม่ทำให้ Automatic Header กลับมา", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
        pageSettings: { preset: "narrow", top: 28, right: 28, bottom: 28, left: 28 },
      },
      ctx,
      { includeHeader: false }
    );
    assertNotContains(preview.header, "dc-doc-header");
    assertNotContains(preview.body, "dc-doc-header__logo");
  });

  await test("body มีแต่ Blocks ใน Descriptor (ไม่มี header markup ปน)", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [{ id: "h-1", type: "heading", text: "Title", size: "medium" }],
      },
      ctx,
      { includeHeader: false }
    );
    assertContains(preview.body, "Title");
    assertNotContains(preview.body, "dc-doc-header");
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
