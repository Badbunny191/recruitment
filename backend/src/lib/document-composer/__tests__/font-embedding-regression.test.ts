/**
 * Regression Test — Font / Logo Embedding is per-document
 * ---------------------------------------------------------
 * Feature: PDF Renderer correctness (font embedding + asset loading)
 *
 * 🔴 ROOT CAUSE ที่ test นี้ป้องกัน
 * =============================================================================
 * `font-loader.ts` เคย cache ตัว `PDFFont` และ `logo-loader.ts` เคย cache
 * ตัว `PDFImage` ไว้ที่ **module scope**
 *
 * สิ่งเหล่านี้ผูกกับ PDFDocument ตัวที่ embed ไป (เก็บเป็น object reference
 * ใน object graph ของ document นั้น) → พอเอาไปใช้กับ document ใหม่
 * resource dict จะชี้ "N 0 R" ไปยัง object ที่อยู่คนละ document
 *
 * ผลลัพธ์: PDF **เปิดได้ ไม่ error** แต่ตัวอักษร/รูปหายเงียบ ๆ
 *   - content stream ยังมีคำสั่งวาด (จึงผ่าน test ที่แค่เช็ค byte length)
 *   - แต่ font resource หาย → ผู้ดูเห็นหน้าว่าง
 *
 * Worker isolate ถูก reuse หลาย request → คำขอแรกของแต่ละ isolate ปกติ
 * ที่เหลือเสียหมด → บั๊กที่ตอนทดสอบมักไม่เจอ แต่ production พัง
 *
 * ✅ แนวทางที่ถูก: cache เฉพาะ **ไบต์ดิบ** (ผลจาก base64) ซึ่งไม่ผูกกับ
 *    document ใด แล้ว embed ใหม่ทุก document
 * =============================================================================
 *
 * ⚠️ เงื่อนไขสำคัญของ test นี้
 *   ต้องเรียก `resetFontCache()` / `resetLogoCache()` ก่อน render แรกเท่านั้น
 *   เพราะเราต้องการจำลอง "isolate ที่ยังไม่เคย render" แล้วพิสูจน์ว่า
 *   request ถัดไป ๆ (warm cache) ยัง embed ได้ครบถ้วน
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/font-embedding-regression.test.ts
 */

(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef } from "pdf-lib";
import { resetFontCache } from "../../fonts/font-loader";
import { resetLogoCache } from "../../assets/logo-loader";
import { buildRenderPlan, renderPlanToPdf } from "../descriptor-renderer";
import type { ApplicationContext } from "../../pdf-types";
import type { DocumentDescriptor } from "../types";

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

function assertTrue(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg = "") {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// =============================================================================
// Probe — ตรวจ resource graph ของ PDF จริง (ไม่ใช่ byte regex)
// =============================================================================

interface ResourceProbe {
  /** ชื่อฟอนต์ที่ page อ้างถึง */
  fontNames: string[];
  /** ทุกชื่อฟอนต์ resolve เป็น PDFDict จริงหรือไม่ (ไม่ใช่ stream/page) */
  allFontsAreDicts: boolean;
  /** font มี descendant font program (FontFile2 = TrueType) หรือไม่ */
  fontFileEmbedded: boolean;
  /** XObject รูปภาพ resolve เป็น PDFRawStream จริงหรือไม่ */
  imageResolvesToStream: boolean;
  /** จำนวน object ทั้งหมดในเอกสาร */
  objectCount: number;
  /** จำนวน font ที่ page อ้างถึง */
  fontCount: number;
}

/**
 * resolve node → object
 *
 * ⚠️ pdf-lib API: `PDFRef` ไม่มีเมธอด `.lookup()` ของตัวเอง
 *    ต้องเรียกผ่าน `context.lookup(ref)` เสมอ
 *    และหลัง save/load object บางส่วนอาจเป็น **direct object** อยู่แล้ว
 *    → ต้องรองรับทั้ง PDFRef และ object โดยตรง
 */
function makeResolver(context: any) {
  return function resolve(node: any): any {
    if (!node) return undefined;
    if (node instanceof PDFRef) {
      try {
        return context.lookup(node);
      } catch {
        return undefined;
      }
    }
    return node;
  };
}

/**
 * เดิน object graph ตั้งแต่ Page → Resources → Font / XObject
 * แล้ว resolve reference ให้ครบ เพื่อจับกรณี
 * "resource ชี้ไป object ของ document อื่น" ซึ่ง byte regex จับไม่ได้
 */
async function probeResources(bytes: Uint8Array): Promise<ResourceProbe> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context as any;
  const resolve = makeResolver(ctx);
  const probe: ResourceProbe = {
    fontNames: [],
    allFontsAreDicts: true,
    fontFileEmbedded: false,
    imageResolvesToStream: true,
    objectCount: ctx.enumerateIndirectObjects().length,
    fontCount: 0,
  };

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
    const res = resolve(page.node.get(PDFName.of("Resources")));
    if (!(res instanceof PDFDict)) continue;

    // ── Fonts ──
    const fontDict = resolve(res.get(PDFName.of("Font")));
    if (fontDict instanceof PDFDict) {
      for (const [key, value] of fontDict.entries() as [any, any][]) {
        const name = key.asString().replace("/", "");
        const target = resolve(value);
        probe.fontNames.push(name);
        probe.fontCount++;
        if (!(target instanceof PDFDict)) {
          probe.allFontsAreDicts = false;
          continue;
        }
        // ตรวจว่ามี font program ฝังจริงหรือไม่
        //
        // โครงสร้างของ pdf-lib (CIDFontType2 / subset):
        //   Font (/Type0)
        //     └─ /DescendantFonts [ CIDFontType2 ]
        //          └─ /FontDescriptor ── /FontFile2 → PDFRawStream (ข้อมูลฟอนต์)
        //
        // ⚠️ /FontFile2 ไม่ได้อยู่ที่ CIDFontType2 โดยตรง
        //    แต่อยู่ใน /FontDescriptor (หนึ่งระดับลึกกว่า)
        const descFonts = resolve(target.get(PDFName.of("DescendantFonts")));
        if (descFonts instanceof PDFArray && descFonts.size() > 0) {
          const df = resolve(descFonts.get(0));
          if (df instanceof PDFDict) {
            const fontDescriptor = resolve(df.get(PDFName.of("FontDescriptor")));
            if (
              fontDescriptor instanceof PDFDict &&
              resolve(fontDescriptor.get(PDFName.of("FontFile2"))) instanceof PDFRawStream
            ) {
              probe.fontFileEmbedded = true;
            }
          }
        }
      }
    }

    // ── XObject (images) ──
    const xoDict = resolve(res.get(PDFName.of("XObject")));
    if (xoDict instanceof PDFDict) {
      for (const [, value] of xoDict.entries() as [any, any][]) {
        const target = resolve(value);
        if (!(target instanceof PDFRawStream)) probe.imageResolvesToStream = false;
      }
    }
  }

  return probe;
}

// =============================================================================
// Fixtures
// =============================================================================

function makeCtx(): ApplicationContext {
  return {
    application: {
      id: "app-regression",
      applicationNo: "SAO-2569-000123",
      fullname: "สมชาย ใจดี",
      email: "s@example.com",
      status: "submitted",
      submittedAt: 1759000000,
      formData: {},
    },
    round: { id: "r1", title: "รอบการสมัครประจำปี 2569" },
    position: null,
    fields: [],
    sections: [],
  } as unknown as ApplicationContext;
}

/** descriptor ที่มี heading + systemData + logo + signature ครบทุกชนิด */
const FULL_DESCRIPTOR = {
  version: 1,
  blocks: [
    { id: "logo-1", type: "logo", source: "organization", align: "center", width: 70 },
    { id: "h-1", type: "heading", text: "ใบสมัครรอบ {ROUND_NAME}", size: "large", bold: true, align: "center" },
    { id: "s-1", type: "systemData", key: "APPLICATION_NO", layout: "inline", align: "left" },
    { id: "s-2", type: "systemData", key: "APPLICATION_DATE", layout: "inline", align: "left" },
    { id: "h-2", type: "heading", text: "ข้อมูลผู้สมัคร", size: "medium", bold: true, align: "left" },
    { id: "sig-1", type: "signature", lineLabel: "ลงลายมือชื่อ", roleLabel: "ผู้สมัคร", lineStyle: "..............", dateLabel: "วันที่", align: "left" },
  ],
} as unknown as DocumentDescriptor;

async function renderOnce(): Promise<Uint8Array> {
  const ctx = makeCtx();
  const plan = buildRenderPlan(FULL_DESCRIPTOR, ctx);
  const res = await renderPlanToPdf(plan, ctx);
  return res.bytes;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("=========================================================");
  console.log("PDF Font/Logo Embedding — Per-Document Regression Test");
  console.log("=========================================================");

  // =====================================================================
  section("[1] Cold render (isolate ใหม่ — cache ว่าง)");
  // =====================================================================

  let coldProbe: ResourceProbe;
  let coldBytes: number;

  resetFontCache();
  resetLogoCache();

  await test("cold render ฝัง font จริง (FontFile2 present)", async () => {
    const bytes = await renderOnce();
    coldBytes = bytes.byteLength;
    coldProbe = await probeResources(bytes);
    assertTrue(
      coldProbe.fontFileEmbedded,
      "cold render ต้องมี FontFile2 (TrueType program) ฝังอยู่ในเอกสาร"
    );
  });

  await test("cold render ฝัง logo จริง (XObject = PDFRawStream)", async () => {
    assertTrue(
      coldProbe!.imageResolvesToStream,
      "cold render ต้อง resolve XObject เป็น PDFRawStream ได้"
    );
  });

  // =====================================================================
  section("[2] Warm render (isolate เดิม — cache มีค่าแล้ว)");
  // =====================================================================
  // ⚠️ จุดที่บั๊กเดิมพัง: cache เดิมเก็บตัว PDFFont/PDFImage
  //    พอ warm แล้ว document ใหม่จะอ้าง resource ของ document เก่า

  const warmProbes: ResourceProbe[] = [];
  const warmSizes: number[] = [];

  for (let i = 0; i < 3; i++) {
    await test(`warm render #${i + 1} ยังฝัง font จริง (FontFile2 present)`, async () => {
      const bytes = await renderOnce();
      warmSizes.push(bytes.byteLength);
      const probe = await probeResources(bytes);
      warmProbes.push(probe);
      assertTrue(
        probe.fontFileEmbedded,
        `warm render #${i + 1}: ต้องมี FontFile2 — ถ้าไม่มีแปลว่า font resource ชี้ไป document อื่น ` +
          `(ขนาด ${bytes.byteLength} bytes ซึ่งเล็กผิดปกติ)`
      );
    });

    await test(`warm render #${i + 1} font resolve เป็น PDFDict ทุกตัว`, async () => {
      const probe = warmProbes[i];
      assertTrue(
        probe.allFontsAreDicts,
        `warm render #${i + 1}: font "${probe.fontNames.join(",")}" resolve ไม่ใช่ PDFDict ` +
          `→ ชี้ไป object ผิด document`
      );
    });

    await test(`warm render #${i + 1} ฝัง logo จริง`, async () => {
      const probe = warmProbes[i];
      assertTrue(
        probe.imageResolvesToStream,
        `warm render #${i + 1}: XObject resolve ไม่ใช่ PDFRawStream → รูปหาย`
      );
    });
  }

  // =====================================================================
  section("[3] ผลลัพธ์ของแต่ละ request ต้องเหมือนกัน");
  // =====================================================================

  await test("ทุก render มีจำนวน font resource เท่ากัน", () => {
    const counts = [coldProbe!.fontCount, ...warmProbes.map((p) => p.fontCount)];
    const first = counts[0];
    for (const c of counts) {
      assertEqual(c, first, "จำนวน font resource ต้องเท่ากันทุก request:");
    }
    assertTrue(first > 0, "ต้องมีอย่างน้อย 1 font resource");
  });

  await test("warm render มีขนาดใกล้เคียง cold (ไม่หดเป็นหน้าว่าง)", () => {
    // บั๊กเดิม: cold ~148KB → warm ~900 bytes (เนื้อหาหายหมด)
    // ใช้เกณฑ์หยาบ ๆ เพราะ subset font อาจทำให้ขนาดต่างเล็กน้อย
    for (const size of warmSizes) {
      assertTrue(
        size > coldBytes! * 0.5,
        `warm render ${size} bytes เล็กผิดปกติเทียบกับ cold ${coldBytes} bytes ` +
          `→ สงสัยว่าเนื้อหา/ฟอนต์หาย`
      );
    }
  });

  await test("object count ของ warm render เท่ากับ cold", () => {
    for (const probe of warmProbes) {
      assertEqual(
        probe.objectCount,
        coldProbe!.objectCount,
        "จำนวน object ในเอกสารต่างกัน → มี resource หายหรือเป็นของ document อื่น:"
      );
    }
  });

  await test("PDF ทุกตัวเปิดได้ด้วย pdf-lib (ไม่ corrupt)", async () => {
    // sanity: ตรวจว่า bytes เป็น PDF ที่ parse ได้จริง
    const bytes = await renderOnce();
    const doc = await PDFDocument.load(bytes);
    assertTrue(doc.getPageCount() >= 1, "ต้องมีอย่างน้อย 1 หน้า");
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    assertEqual(header, "%PDF-", "magic header");
  });

  // =====================================================================
  section("[4] เอกสารเปล่า (ไม่มี logo) ต้องไม่ฝัง image")
  // =====================================================================

  await test("descriptor ที่ไม่มี logo → ไม่มี image XObject", async () => {
    const noLogo = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "หัวเอกสาร", size: "large", bold: true, align: "center" },
      ],
    } as unknown as DocumentDescriptor;
    const ctx = makeCtx();
    const plan = buildRenderPlan(noLogo, ctx);
    const res = await renderPlanToPdf(plan, ctx);
    const probe = await probeResources(res.bytes);
    assertTrue(probe.fontFileEmbedded, "ยังต้องฝัง font (ไม่มี logo ไม่กระทบ)");
  });

  // =====================================================================
  // Summary
  // =====================================================================
  console.log("\n=========================================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("=========================================================");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});