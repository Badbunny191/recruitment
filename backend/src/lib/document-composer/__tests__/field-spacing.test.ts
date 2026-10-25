/**
 * Reproduction Tests: PDF Field Spacing Consistency
 * ---------------------------------------------------
 * Branch: fix/pdf-field-spacing
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/field-spacing.test.ts
 *
 * วัดตำแหน่งจริงจาก PDF ที่ render แล้ว (patch PDFPage.drawText) — ไม่เดาจากโค้ด
 *
 * ครอบคลุมเคส A–N:
 *   A. TEXT 5 field ติดต่อกัน          B. TEXTAREA 1 บรรทัด
 *   C. TEXTAREA 2 บรรทัด              D. TEXTAREA 10 บรรทัด
 *   E. TEXTAREA มี Enter จริง          F. TEXTAREA soft wrap
 *   G. TEXTAREA ว่าง                  H. FILE ว่าง
 *   I. FILE มีชื่อไฟล์                J. TEXTAREA ตามด้วย FILE
 *   K. TEXTAREA ตามด้วย Section ใหม่   L. TEXTAREA อยู่ท้ายหน้า
 *   M. TEXTAREA ข้ามหน้า              N. Field หลัง Page Break
 *
 * Invariants ที่ต้องผ่าน:
 *   1. ไม่มีข้อความวาดใต้ contentBottom (ไม่ซ้อน footer / ไม่ล้นหน้า)
 *   2. ไม่มี gap ซ้ำ (after-gap คงที่ ไม่ขึ้นกับจำนวนบรรทัดของคำตอบก่อนหน้า)
 *   3. แนวซ้ายของ stacked value (รวม "-") เริ่มแนวเดียวกันทุกบรรทัด
 *   4. Label → Value แบบ stacked ระยะเดียวกันทั้งคำตอบ 1 และหลายบรรทัด
 *   5. Page break: หน้าใหม่เริ่มที่ contentTop — ไม่ regression
 */
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFPage } from "pdf-lib";
import { buildRenderPlan, renderPlanToPdf } from "../index";
import type { DocumentDescriptor } from "../types";
import { resolvePageGeometry } from "../page-settings";
import type { ApplicationContext, FieldData } from "../../pdf-types";

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

function assertEqual(actual: unknown, expected: unknown, msg = "") {
  const a = typeof actual === "number" ? Number(actual.toFixed(2)) : actual;
  const e = typeof expected === "number" ? Number(expected.toFixed(2)) : expected;
  if (a !== e) {
    throw new Error(
      `${msg} expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`
    );
  }
}

function assertClose(actual: number, expected: number, eps = 0.02, msg = "") {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(
      `${msg} expected ~${expected} (±${eps}), got ${actual}`
    );
  }
}

function assertTrue(condition: boolean, msg = "") {
  if (!condition) throw new Error(msg || "Expected true");
}

// =============================================================================
// Instrumentation — บันทึกทุกจุดที่วาดข้อความจริง
// =============================================================================

interface DrawRecord {
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
}

const origDrawText = (PDFPage.prototype as any).drawText;
let records: DrawRecord[] = [];
(PDFPage.prototype as any).drawText = function (text: string, opts: any) {
  records.push({
    page: 0,
    text: String(text ?? ""),
    x: opts?.x,
    y: opts?.y,
    size: opts?.size,
  });
  return origDrawText.call(this, text, opts);
};

/** แยกหน้าจาก jump ของ y (ขึ้นหน้าใหม่ = y กระโดดกลับไป contentTop ~802) */
function assignPages(recs: DrawRecord[]): void {
  let page = 0;
  let prevY = Infinity;
  for (const r of recs) {
    if (r.y > prevY + 300) page++;
    r.page = page;
    prevY = r.y;
  }
}

// =============================================================================
// Fixtures
// =============================================================================

const geometry = resolvePageGeometry(undefined);
const box = {
  contentTop: geometry.pageHeight - geometry.marginTop,
  contentBottom: geometry.marginBottom + 60, // FOOTER_RESERVE
  /** แนวซ้ายของ stacked value = contentLeft + STACKED_VALUE_INDENT(12) */
  contentLeftX: geometry.marginLeft + 12,
};

function makeField(
  id: string,
  type: FieldData["type"],
  label: string
): FieldData {
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

function inlineFieldBlock(fieldId: string): DocumentDescriptor["blocks"][number] {
  return {
    id: `f-${fieldId}`,
    type: "field",
    fieldId,
    showLabel: true,
    labelStyle: "small",
    valueStyle: "medium",
    layout: "inline",
    marginTop: 0,
    marginBottom: 3,
  } as DocumentDescriptor["blocks"][number];
}

function stackedFieldBlock(fieldId: string): DocumentDescriptor["blocks"][number] {
  return {
    id: `f-${fieldId}`,
    type: "field",
    fieldId,
    showLabel: true,
    labelStyle: "small",
    valueStyle: "medium",
    layout: "stacked",
    marginTop: 0,
    marginBottom: 3,
  } as DocumentDescriptor["blocks"][number];
}

function sectionHeading(text: string): DocumentDescriptor["blocks"][number] {
  return {
    id: `h-${text}`,
    type: "heading",
    text,
    size: "medium",
    bold: true,
    align: "left",
    marginTop: 10,
    marginBottom: 3,
  } as DocumentDescriptor["blocks"][number];
}

async function render(
  blocks: DocumentDescriptor["blocks"],
  formData: Record<string, unknown>,
  fields: FieldData[]
): Promise<{ recs: DrawRecord[]; pageCount: number }> {
  records = [];
  const descriptor: DocumentDescriptor = { version: 1, blocks };
  const ctx: ApplicationContext = {
    application: {
      id: "app-1",
      applicationNo: "APP-001",
      email: "test@example.com",
      fullname: "นายทดสอบ ระยะระยะ",
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
      roundCode: null,
    },
    templateVersion: { id: "tv-1", versionNumber: 1 },
    sections: [],
    fields,
    attachments: [],
  };
  const plan = buildRenderPlan(descriptor, ctx);
  const rendered = await renderPlanToPdf(plan, ctx);
  assignPages(records);
  return { recs: records, pageCount: rendered.pageCount };
}

// ── record helpers ──────────────────────────────────────────────────

function findByText(recs: DrawRecord[], text: string): DrawRecord[] {
  return recs.filter((r) => r.text === text);
}

/** records ทั้งหมดต้องอยู่ใน content box (ไม่วาดใต้ contentBottom) */
function assertInsideContentBox(recs: DrawRecord[]): void {
  for (const r of recs) {
    assertTrue(
      r.y - r.size >= box.contentBottom - 0.6,
      `text ${JSON.stringify(r.text.slice(0, 30))} drawn at y=${r.y} (glyph bottom ${r.y - r.size}) below contentBottom=${box.contentBottom}`
    );
  }
}

// =============================================================================
// Shared synthetic data
// =============================================================================

const LINE_1 = "คำตอบบรรทัดเดียว";
const LINE_2 = "คำตอบบรรทัดที่สอง";
const LONG_SOFT =
  "ข้อความยาวสำหรับทดสอบการตัดบรรทัดอัตโนมัติในพื้นที่เนื้อหาของเอกสารการสมัคร " +
  "เพื่อให้เกิดการ wrap หลายบรรทัดอย่างแน่นอนในการทดสอบครั้งนี้ตามที่ต้องการ " +
  "ข้อความต่อเนื่องยาวโดยไม่มีการขึ้นบรรทัดใหม่ด้วยการกด Enter เลยแม้แต่ครั้งเดียว " +
  "จึงต้องพึ่งการตัดคำอัตโนมัติของตัว renderer เองทั้งหมดจนครบสามบรรทัดขึ้นไปแน่นอน";
const TEN_LINES = Array.from({ length: 10 }, (_, i) => `บรรทัดที่ ${i + 1}`).join("\n");
const SIXTY_LINES = Array.from({ length: 60 }, (_, i) => `บรรทัด ${i + 1}`).join("\n");

const fields: FieldData[] = [
  makeField("t1", "TEXT", "ฟิลด์ 1"),
  makeField("t2", "TEXT", "ฟิลด์ 2"),
  makeField("t3", "TEXT", "ฟิลด์ 3"),
  makeField("t4", "TEXT", "ฟิลด์ 4"),
  makeField("t5", "TEXT", "ฟิลด์ 5"),
  makeField("ta", "TEXTAREA", "คำตอบยาว"),
  makeField("file_e", "FILE", "ไฟล์แนบ (ว่าง)"),
  makeField("file_v", "FILE", "ไฟล์แนบ"),
];

const BASE_FORM: Record<string, unknown> = {
  t1: "ค่าหนึ่ง",
  t2: "ค่าสอง",
  t3: "ค่าสาม",
  t4: "ค่าสี่",
  t5: "ค่าห้า",
  ta: LINE_1,
  file_e: null,
  file_v: { url: "https://example.com/x.pdf", name: "เอกสาร.pdf" },
};

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Field Spacing Consistency — Reproduction Tests (A–N) ===\n");

  // ── A. TEXT 5 field ติดต่อกัน (inline) ─────────────────────────────
  await test("A: 5 inline TEXT fields — uniform field→field gap", async () => {
    const { recs } = await render(
      [sectionHeading("S"), ...[1, 2, 3, 4, 5].map((i) => inlineFieldBlock(`t${i}`))],
      BASE_FORM,
      fields
    );
    assertInsideContentBox(recs);
    for (let i = 1; i <= 5; i++) {
      const labels = findByText(recs, `ฟิลด์ ${i}`);
      assertEqual(labels.length, 1, `label ฟิลด์ ${i} count`);
    }
    // field→field baseline gap คงที่ทุกคู่
    for (let i = 1; i < 5; i++) {
      const a = findByText(recs, `ฟิลด์ ${i}`)[0];
      const b = findByText(recs, `ฟิลด์ ${i + 1}`)[0];
      assertClose(a.y - b.y, findByText(recs, "ฟิลด์ 1")[0].y - findByText(recs, "ฟิลด์ 2")[0].y, 0.02, `gap ${i}→${i + 1}`);
    }
  });

  // ── B/C/D. Label→Value + after-gap ต้องเท่ากันทั้ง 1/2/10 บรรทัด ────
  async function textareaTimeline(nLines: 1 | 2 | 10) {
    const value =
      nLines === 1 ? LINE_1 : nLines === 2 ? `${LINE_1}\n${LINE_2}` : TEN_LINES;
    const { recs } = await render(
      [
        sectionHeading("S"),
        stackedFieldBlock("ta"),
        inlineFieldBlock("t1"),
      ],
      { ...BASE_FORM, ta: value },
      fields
    );
    const label = findByText(recs, "คำตอบยาว")[0];
    const valueRecs = recs.filter(
      (r) => r.text.startsWith("บรรทัด") || r.text === LINE_1 || r.text === LINE_2
    );
    const next = findByText(recs, "ฟิลด์ 1")[0];
    return { label, valueRecs, next };
  }

  await test("B: TEXTAREA 1 บรรทัด — label→value gap + แนว value", async () => {
    const { label, valueRecs, next } = await textareaTimeline(1);
    assertEqual(valueRecs.length, 1, "value line count");
    assertClose(valueRecs[0].x, box.contentLeftX, 0.02, "value x (stacked indent)");
    assertClose(label.y - valueRecs[0].y, 17.75, 0.02, "label→value baseline gap");
    // next label เป็น inline (baseline แชร์กับ value ที่ -13) → gap 22
    assertClose(valueRecs[0].y - next.y, 22, 0.02, "value→next field gap");
  });

  await test("C: TEXTAREA 2 บรรทัด — policy เดียวกับ 1 บรรทัด", async () => {
    const { label, valueRecs, next } = await textareaTimeline(2);
    assertEqual(valueRecs.length, 2, "value line count");
    assertClose(label.y - valueRecs[0].y, 17.75, 0.02, "label→value gap == 1-line case");
    assertClose(valueRecs[0].y - valueRecs[1].y, 18.2, 0.02, "inter-line gap");
    assertClose(valueRecs[1].y - next.y, 22, 0.02, "after-gap == 1-line case");
  });

  await test("D: TEXTAREA 10 บรรทัด — inter-line คงที่ทุกช่วง", async () => {
    const { label, valueRecs, next } = await textareaTimeline(10);
    assertEqual(valueRecs.length, 10, "value line count");
    assertClose(label.y - valueRecs[0].y, 17.75, 0.02, "label→value gap == 1-line case");
    for (let i = 0; i < 9; i++) {
      assertClose(valueRecs[i].y - valueRecs[i + 1].y, 18.2, 0.02, `inter-line ${i + 1}→${i + 2}`);
    }
    assertClose(valueRecs[9].y - next.y, 22, 0.02, "after-gap == 1-line case");
    // ทุกบรรทัดเริ่มแนวเดียวกัน
    for (const r of valueRecs) assertClose(r.x, valueRecs[0].x, 0.001, "value left edge");
  });

  // ── E. TEXTAREA มี Enter จริง ─────────────────────────────────────
  await test("E: TEXTAREA มี Enter — แต่ละ paragraph แยกบรรทัดจริง", async () => {
    const { recs } = await render(
      [stackedFieldBlock("ta")],
      { ...BASE_FORM, ta: `${LINE_1}\n\n${LINE_2}` },
      fields
    );
    const l1 = findByText(recs, LINE_1);
    const l2 = findByText(recs, LINE_2);
    assertEqual(l1.length, 1, "LINE_1 count");
    assertEqual(l2.length, 1, "LINE_2 count");
    // มีบรรทัดว่างคั่น (paragraph ว่างวาดเป็น empty string)
    assertClose(l1[0].y - l2[0].y, 18.2 * 2, 0.02, "3 line-boxes between L1 and L2");
    assertClose(l1[0].x, l2[0].x, 0.001, "same left edge");
  });

  // ── F. Soft wrap ─────────────────────────────────────────────────
  await test("F: TEXTAREA soft wrap — ทุกบรรทัด wrapped แนวเดียวกัน", async () => {
    const { recs } = await render(
      [stackedFieldBlock("ta")],
      { ...BASE_FORM, ta: LONG_SOFT },
      fields
    );
    const valueRecs = recs.filter((r) => r.size === 13 && r.x > 50);
    assertTrue(valueRecs.length >= 3, `expected >=3 wrapped lines, got ${valueRecs.length}`);
    for (const r of valueRecs) assertClose(r.x, valueRecs[0].x, 0.001, "wrapped left edge");
    for (let i = 0; i < valueRecs.length - 1; i++) {
      assertClose(valueRecs[i].y - valueRecs[i + 1].y, 18.2, 0.02, `inter-line ${i}`);
    }
    assertInsideContentBox(recs);
  });

  // ── G/H. ค่าว่าง "-" ใช้แนวเดียวกับ value ปกติ ไม่มี gap พิเศษ ──────
  await test("G: TEXTAREA ว่าง — '-' แนวเดียวกับ value ปกติ + gap เดียวกัน", async () => {
    const emptyRun = await render(
      [stackedFieldBlock("ta"), inlineFieldBlock("t1")],
      { ...BASE_FORM, ta: "" },
      fields
    );
    const filledRun = await textareaTimeline(1);
    const dash = findByText(emptyRun.recs, "-");
    assertEqual(dash.length, 1, "'-' count");
    assertClose(dash[0].x, filledRun.valueRecs[0].x, 0.001, "'-' x == value x");
    const emptyLabel = findByText(emptyRun.recs, "คำตอบยาว")[0];
    assertClose(
      emptyLabel.y - dash[0].y,
      filledRun.label.y - filledRun.valueRecs[0].y,
      0.02,
      "label→'-' gap == label→value gap"
    );
    assertClose(dash[0].y - findByText(emptyRun.recs, "ฟิลด์ 1")[0].y, 22, 0.02, "'-'→next gap == value→next gap");
  });

  await test("H: FILE ว่าง — '-' ใช้ layout path เดียวกับ value จริง", async () => {
    const { recs } = await render(
      [inlineFieldBlock("file_e"), inlineFieldBlock("t1")],
      BASE_FORM,
      fields
    );
    const dash = findByText(recs, "-")[0];
    const real = findByText(recs, "ค่าหนึ่ง")[0];
    const dashLabel = findByText(recs, "ไฟล์แนบ (ว่าง)")[0];
    const realLabel = findByText(recs, "ฟิลด์ 1")[0];
    // gap label→value เท่ากันทั้ง "-" และค่าจริง (บรรทัดเดียวกัน = baseline เดียว)
    assertClose(dashLabel.y - dash.y, realLabel.y - real.y, 0.02, "label→value baseline");
    // ระยะไป field ถัดไปเท่ากัน
    assertClose(dash.y - real.y, 22, 0.02, "'-'→next gap == value→next gap");
  });

  await test("I: FILE มีชื่อไฟล์ — แสดงชื่อไฟล์ 1 บรรทัด ไม่มี gap พิเศษ", async () => {
    const { recs } = await render(
      [inlineFieldBlock("file_v"), inlineFieldBlock("t1")],
      BASE_FORM,
      fields
    );
    const name = findByText(recs, "เอกสาร.pdf");
    assertEqual(name.length, 1, "filename count");
    assertClose(name[0].y - findByText(recs, "ค่าหนึ่ง")[0].y, 22, 0.02, "gap == inline→inline");
  });

  // ── J. TEXTAREA ตามด้วย FILE ─────────────────────────────────────
  await test("J: TEXTAREA 2 บรรทัด → FILE — after-gap ไม่ซ้ำ ไม่พอง", async () => {
    const { recs } = await render(
      [stackedFieldBlock("ta"), inlineFieldBlock("file_v")],
      { ...BASE_FORM, ta: `${LINE_1}\n${LINE_2}` },
      fields
    );
    const last = findByText(recs, LINE_2)[0];
    const fileLabel = findByText(recs, "ไฟล์แนบ")[0];
    assertClose(last.y - fileLabel.y, 22, 0.02, "multiline value→FILE label gap (uniform)");
  });

  // ── K. TEXTAREA ตามด้วย Section ใหม่ ─────────────────────────────
  await test("K: TEXTAREA → Section heading — gap คงที่ ไม่บวกซ้ำ", async () => {
    const { recs } = await render(
      [sectionHeading("S1"), stackedFieldBlock("ta"), sectionHeading("S2")],
      { ...BASE_FORM, ta: `${LINE_1}\n${LINE_2}` },
      fields
    );
    const last = findByText(recs, LINE_2)[0];
    const h2 = findByText(recs, "S2")[0];
    const h1 = findByText(recs, "S1")[0];
    assertClose(last.y - h2.y, 37, 0.5, "value→section heading gap (tail2+POST4+margin3+marginTop10+heading18)");
    // heading → field แรก: ค่าคงที่เดียวกันทั้งสอง section
    const taLabel = findByText(recs, "คำตอบยาว")[0];
    assertClose(h1.y - taLabel.y, 26.2, 0.5, "section1 heading→field gap");
  });

  // ── L. TEXTAREA อยู่ท้ายหน้า + M. ข้ามหน้า ────────────────────────
  await test("L+M: TEXTAREA ยาว 60 บรรทัด — ข้ามหน้า ไม่ล้น content box", async () => {
    const { recs, pageCount } = await render(
      [stackedFieldBlock("ta"), inlineFieldBlock("t1")],
      { ...BASE_FORM, ta: SIXTY_LINES },
      fields
    );
    assertTrue(pageCount >= 2, `expected >=2 pages, got ${pageCount}`);
    assertInsideContentBox(recs);
    // หน้า 2 เริ่มที่ contentTop (บรรทัดแรกวาดที่ contentTop - fontSize)
    const page2 = recs.filter((r) => r.page === 1);
    assertTrue(page2.length > 0, "page 2 has content");
    assertClose(page2[0].y, box.contentTop - page2[0].size, 0.02, "page-2 first glyph at contentTop");
    // ทุกบรรทัด value แนวเดียวกันแม่ข้ามหน้า
    const valueRecs = recs.filter((r) => r.text.startsWith("บรรทัด "));
    for (const r of valueRecs) assertClose(r.x, valueRecs[0].x, 0.001, "value left edge across pages");
  });

  // ── N. Field หลัง Page Break ─────────────────────────────────────
  await test("N: Field หลัง Page Break — เริ่มที่ contentTop", async () => {
    const { recs } = await render(
      [
        inlineFieldBlock("t1"),
        { id: "pb", type: "pageBreak" } as DocumentDescriptor["blocks"][number],
        inlineFieldBlock("t2"),
      ],
      BASE_FORM,
      fields
    );
    const t2 = findByText(recs, "ฟิลด์ 2")[0];
    // inline label baseline = contentTop - max(labelFontSize, valueFontSize) = -13
    // (label แชร์ baseline กับ value ในบรรทัดเดียวกัน — typographic ที่ถูกต้อง)
    assertClose(t2.y, box.contentTop - 13, 0.02, "first label after pageBreak at contentTop");
    assertInsideContentBox(recs);
  });

  // ── Preview / Download renderer parity ────────────────────────────
  await test("Parity: Download และ pdf-preview ใช้ render path เดียวกัน", async () => {
    // Static wiring (ยืนยันด้วยโค้ดจริง — ห้ามเปลี่ยนโดยไม่แก้ test นี้):
    //   - Download:   src/lib/pdf.service.ts (getApplicationPdf)
    //                 → import { buildRenderPlan, renderPlanToPdf } from './document-composer'
    //   - PDF Preview: src/routes/template-descriptor.routes.ts (pdf-preview endpoint)
    //                 → import { buildRenderPlan, renderPlanToPdf } from '../lib/document-composer'
    // ทั้งสองฝั่งเรียก function คู่เดียวกันจาก document-composer index เดียวกัน
    // → renderer เปลี่ยนผลต้องตรงกันทั้ง Preview และ Download เสมอ
    //
    // Determinism: render ชุดข้อมูลเดียวกันสองครั้งได้ตำแหน่งเหมือนเป๊ะ
    // → หากวันหนึ่ง wiring เปลี่ยน (ฝั่งใดใช้ renderer คนละตัว) test A–N
    //   จะไม่ครอบคลุมฝั่งนั้นอีก — ตรวจ wiring ซ้ำด้วย grep ก่อน merge เสมอ
    const blocks: DocumentDescriptor["blocks"] = [
      sectionHeading("S"),
      inlineFieldBlock("t1"),
      stackedFieldBlock("ta"),
      inlineFieldBlock("file_e"),
    ];
    const run1 = await render(blocks, BASE_FORM, fields);
    const run2 = await render(blocks, BASE_FORM, fields);
    assertEqual(run1.recs.length, run2.recs.length, "draw count parity");
    for (let i = 0; i < run1.recs.length; i++) {
      const a = run1.recs[i];
      const b = run2.recs[i];
      assertEqual(a.text, b.text, `record ${i} text parity`);
      assertClose(a.x, b.x, 0.001, `record ${i} x parity`);
      assertClose(a.y, b.y, 0.001, `record ${i} y parity`);
    }
    assertEqual(run1.pageCount, run2.pageCount, "page count parity");
  });

  // ── สรุป ─────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    for (const f of failures) console.error(`  FAIL: ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
