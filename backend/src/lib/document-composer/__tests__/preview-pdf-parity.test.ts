/**
 * Preview ↔ PDF Parity Tests (fail-before-fix)
 * ---------------------------------------------------
 * ครอบ parity gaps จาก audit 2026-10-31:
 *   M7  field/systemData stacked value indent — เฉพาะ align=left เท่านั้น
 *       (PDF: valueX = contentLeft + STACKED_VALUE_INDENT เมื่อ showLabel && align=left)
 *   M1  signature dateSource="none" → ทั้งสองฝั่งต้องซ่อนบรรทัดวันที่
 *   M2  signature placeholder ชื่อ — ใช้ constants เดียวจาก types.ts
 *       (bare "ชื่อผู้สมัคร" + วงเล็บตาม showParentheses / hint เมื่อไม่มีวงเล็บ)
 *   M4  table cell object — ใช้ display label (getObjectDisplayLabel) ทั้งสองฝั่ง
 *   M6  preview route ต้อง validate descriptor ด้วย gate เดียวกับ pdf-preview
 *   L2  POST_BLOCK_SPACING 4pt ท้ายทุก block
 *   L3  heading bold=false = regular 400
 *   L4  required marker " *" สีเทาเดียวกับ label (COLOR_GRAY)
 *   L5  systemData value regular + ไม่มี gap เพิ่ม + indent เป็น pt
 *   L6  table emptyText = 12pt เทา regular
 *   L7  table label = 11pt
 *   L10 logo none = เว้น margin แต่ไม่มีเนื้อหา / upload = ข้อความ placeholder เดียวกับ PDF
 *
 * ฝั่ง PDF พิสูจน์ด้วยการ patch PDFPage.drawText บันทึกทุกจุดที่วาดจริง
 * (เทคนิคเดียวกับ field-spacing.test.ts) — ไม่เดาจากโค้ด
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/preview-pdf-parity.test.ts
 */
// @ts-nocheck — tsx run-time test runner (precedent: preview-download-parity.test.ts)
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { PDFPage } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRenderPlan,
  renderPlanToPdf,
  renderDescriptorToPreview,
} from "../index";
import type { DocumentDescriptor, DocumentBlock } from "../types";
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
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`  ✗ ${name}: ${e?.message ?? e}`);
    });
}

function assertEqual(actual: unknown, expected: unknown, msg = "") {
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
  if (typeof haystack !== "string" || !haystack.includes(needle)) {
    throw new Error(
      `${msg} expected to contain ${JSON.stringify(needle)} (got ${String(haystack).slice(0, 200)}...)`
    );
  }
}

function assertNotContains(haystack: string, needle: string, msg = "") {
  if (typeof haystack !== "string" || haystack.includes(needle)) {
    throw new Error(
      `${msg} expected NOT to contain ${JSON.stringify(needle)}`
    );
  }
}

// =============================================================================
// Draw instrumentation — บันทึกทุก drawText ของ PDF (เทคนิคจาก field-spacing.test.ts)
// =============================================================================

interface DrawRecord {
  text: string;
  x: number;
  y: number;
  size: number;
}

const origDrawText = (PDFPage.prototype as any).drawText;
let records: DrawRecord[] = [];
(PDFPage.prototype as any).drawText = function (text: string, opts: any) {
  records.push({
    text: String(text ?? ""),
    x: opts?.x,
    y: opts?.y,
    size: opts?.size,
  });
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

function buildCtx(overrides?: {
  fullname?: string;
  submittedAt?: number;
  formData?: Record<string, unknown>;
  fields?: FieldData[];
}): ApplicationContext {
  return {
    application: {
      id: "app-1",
      applicationNo: "APP-001",
      email: "test@example.com",
      fullname: overrides?.fullname ?? "นายทดสอบ พาริตี้",
      nationalId: null,
      status: "SUBMITTED",
      statusReason: null,
      submittedAt: overrides?.submittedAt ?? 1767793020,
      formData: overrides?.formData ?? {},
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
    fields: overrides?.fields ?? [],
    attachments: [],
  };
}

/** Render descriptor → PDF จริง + คืนข้อความทั้งหมดที่ถูกวาด */
async function drawPdf(
  blocks: DocumentBlock[],
  ctx: ApplicationContext
): Promise<DrawRecord[]> {
  records = [];
  const descriptor: DocumentDescriptor = { version: 1, blocks };
  const plan = buildRenderPlan(descriptor, ctx);
  await renderPlanToPdf(plan, ctx);
  return records;
}

function renderPreview(
  blocks: DocumentBlock[],
  ctx: ApplicationContext
): { body: string; styles: string } {
  const preview = renderDescriptorToPreview(
    { version: 1, blocks } as DocumentDescriptor,
    ctx
  );
  return { body: preview.body, styles: preview.styles };
}

/** ดึง CSS rule block แรกที่ selector ตรงเป๊ะ (เช่น ".dc-field__value {") */
function extractRule(styles: string, selector: string): string | null {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"
  );
  const m = re.exec(styles);
  return m ? m[1] : null;
}

// =============================================================================
// M7 — field/systemData stacked indent เฉพาะ align=left (+showLabel)
// =============================================================================

async function main() {
  console.log("\n=== Preview ↔ PDF Parity (M7/M1/M2/M4/M6 + Low) ===\n");

  const fieldBlock = (align: string, extra: Record<string, unknown> = {}) =>
    ({
      id: "f-1",
      type: "field",
      fieldId: "fm-name",
      label: "ชื่อ",
      layout: "stacked",
      showLabel: true,
      align,
      ...extra,
    }) as DocumentBlock;

  const nameField = [makeField("fm-name", "TEXT", "ชื่อ")];

  await test("M7.1 field stacked align=left + showLabel → value มี indent class", () => {
    const { body } = renderPreview(
      [fieldBlock("left")],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertContains(body, "dc-field__value--indent", "indent class");
  });

  await test("M7.2 field stacked align=center → ไม่มี indent (PDF ไม่ indent)", () => {
    const { body } = renderPreview(
      [fieldBlock("center")],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertNotContains(body, "dc-field__value--indent");
  });

  await test("M7.3 field stacked align=left + showLabel=false → ไม่มี indent", () => {
    const { body } = renderPreview(
      [fieldBlock("left", { showLabel: false })],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertNotContains(body, "dc-field__value--indent");
  });

  await test("M7.4 field inline align=left → ไม่มี indent", () => {
    const { body } = renderPreview(
      [fieldBlock("left", { layout: "inline" })],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertNotContains(body, "dc-field__value--indent");
  });

  await test("M7.5 styles: indent = 12pt แบบ scoped — base .dc-field__value ไม่มี margin-left ติดลบ", () => {
    const { styles } = renderPreview(
      [fieldBlock("left")],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertContains(styles, ".dc-field__value--indent {", "indent rule");
    const indentRule = extractRule(styles, ".dc-field__value--indent");
    assertTrue(indentRule !== null && indentRule.includes("12pt"), "indent = 12pt (parity STACKED_VALUE_INDENT)");
    const baseRule = extractRule(styles, ".dc-field__value");
    assertTrue(baseRule !== null, "base .dc-field__value rule exists");
    assertFalse(baseRule!.includes("margin-left"), "base rule ห้ามมี margin-left ติดทุก align");
  });

  await test("M7.6 systemData stacked align=left + showLabel → indent / center → ไม่มี", () => {
    const sd = (align: string, extra: Record<string, unknown> = {}) =>
      ({
        id: "sd-1",
        type: "systemData",
        key: "APPLICATION_NO",
        layout: "stacked",
        showLabel: true,
        align,
        ...extra,
      }) as DocumentBlock;
    const ctx = buildCtx();
    const left = renderPreview([sd("left")], ctx);
    assertContains(left.body, "dc-systemdata__value--indent");
    const center = renderPreview([sd("center")], ctx);
    assertNotContains(center.body, "dc-systemdata__value--indent");
    const noLabel = renderPreview([sd("left", { showLabel: false })], ctx);
    assertNotContains(noLabel.body, "dc-systemdata__value--indent");
  });

  await test("M7.7 styles: systemData indent เป็น class 12pt — ไม่มี rule เก่า 12px ติดทุก align", () => {
    const { styles } = renderPreview(
      [fieldBlock("left")],
      buildCtx({ formData: { "fm-name": "ค่า" }, fields: nameField })
    );
    assertContains(styles, ".dc-systemdata__value--indent {", "systemData indent rule");
    assertNotContains(
      styles,
      ".dc-systemdata--stacked.dc-align--left .dc-systemdata__value",
      "rule เก่า (indent ทุก align) ต้องถูกลบ"
    );
  });

  // =============================================================================
  // M1 — signature dateSource="none" → ซ่อนบรรทัดวันที่ทั้งสองฝั่ง
  // =============================================================================

  const sigBlock = (extra: Record<string, unknown> = {}) =>
    ({ id: "s-1", type: "signature", align: "left", ...extra }) as DocumentBlock;

  await test("M1.1 plan command ต้อง carry dateSource (สำหรับ executor guard)", () => {
    const ctx = buildCtx({ fullname: "" });
    const plan = buildRenderPlan(
      { version: 1, blocks: [sigBlock({ dateSource: "none" })] } as DocumentDescriptor,
      ctx
    );
    const cmd = plan.commands.find((c) => c.type === "signature") as any;
    assertTrue(cmd, "signature command exists");
    assertEqual(cmd.dateSource, "none", "command.dateSource");
  });

  await test("M1.2 PDF: dateSource=none + showDate=true → ไม่วาดบรรทัด 'วันที่'", async () => {
    const ctx = buildCtx({ fullname: "" });
    const recs = await drawPdf(
      [sigBlock({ dateSource: "none", showDate: true })],
      ctx
    );
    const dateLines = recs.filter((r) => r.text.startsWith("วันที่"));
    assertEqual(dateLines.length, 0, "ต้องไม่วาด 'วันที่ ______________'");
  });

  await test("M1.3 PDF: dateSource=APPLICATION_DATE + ไม่มี submittedAt → ยังวาด placeholder (กัน over-hide)", async () => {
    const ctx = buildCtx({ fullname: "", submittedAt: 0 });
    const recs = await drawPdf(
      [sigBlock({ dateSource: "APPLICATION_DATE", showDate: true })],
      ctx
    );
    assertTrue(
      recs.some((r) => r.text.startsWith("วันที่") && r.text.includes("______________")),
      "ต้องวาด 'วันที่ ______________'"
    );
  });

  await test("M1.4 Preview: dateSource=none → ไม่มีบรรทัดวันที่ (pin parity)", () => {
    const ctx = buildCtx({ fullname: "" });
    const { body } = renderPreview(
      [sigBlock({ dateSource: "none", showDate: true })],
      ctx
    );
    assertNotContains(body, "dc-signature__date");
  });

  await test("M1.5 Preview: APPLICATION_DATE + submittedAt → มีบรรทัดวันที่ (pin)", () => {
    const ctx = buildCtx({ fullname: "" });
    const { body } = renderPreview([sigBlock({})], ctx);
    assertContains(body, "dc-signature__date");
  });

  // =============================================================================
  // M2 — placeholder ชื่อ ใช้ constants เดียวจาก types.ts
  // =============================================================================

  await test("M2.1 plan command: placeholder ชื่อเป็น bare 'ชื่อผู้สมัคร' (ไม่ติดวงเล็บในตัว)", () => {
    const ctx = buildCtx({ fullname: "" });
    const plan = buildRenderPlan(
      { version: 1, blocks: [sigBlock({})] } as DocumentDescriptor,
      ctx
    );
    const cmd = plan.commands.find((c) => c.type === "signature") as any;
    assertEqual(cmd.signerName, "ชื่อผู้สมัคร");
    assertEqual(cmd.hasRealName, false);
  });

  await test("M2.2 PDF: showParentheses=false + ไม่มีชื่อ → วาด 'ชื่อ-นามสกุล' ไม่มีวงเล็บ", async () => {
    const ctx = buildCtx({ fullname: "" });
    const recs = await drawPdf(
      [sigBlock({ showParentheses: false })],
      ctx
    );
    assertTrue(recs.some((r) => r.text === "ชื่อ-นามสกุล"), "ต้องวาด hint");
    assertFalse(
      recs.some((r) => r.text.includes("(ชื่อผู้สมัคร)")),
      "ห้ามวาด '(ชื่อผู้สมัคร)' เมื่อปิดวงเล็บ"
    );
  });

  await test("M2.3 PDF: showParentheses=true + ไม่มีชื่อ → วาด '(ชื่อผู้สมัคร)' (parity Preview)", async () => {
    const ctx = buildCtx({ fullname: "" });
    const recs = await drawPdf([sigBlock({})], ctx);
    assertTrue(recs.some((r) => r.text === "(ชื่อผู้สมัคร)"));
  });

  await test("M2.4 PDF: ชื่อจริง + showParentheses=false → วาดชื่อเปล่าไม่มีวงเล็บ", async () => {
    const ctx = buildCtx({ fullname: "นายมีชื่อจริง" });
    const recs = await drawPdf([sigBlock({ showParentheses: false })], ctx);
    assertTrue(recs.some((r) => r.text === "นายมีชื่อจริง"));
    assertFalse(recs.some((r) => r.text.includes("(นายมีชื่อจริง)")));
  });

  await test("M2.5 Preview: showParentheses=false + ไม่มีชื่อ → 'ชื่อ-นามสกุล' (pin — PDF ต้องตรงนี้)", () => {
    const ctx = buildCtx({ fullname: "" });
    const { body } = renderPreview([sigBlock({ showParentheses: false })], ctx);
    assertContains(body, "ชื่อ-นามสกุล");
    assertNotContains(body, "(ชื่อผู้สมัคร)");
  });

  await test("M2.6 placeholder constants เป็น single source ที่ types.ts — renderers ห้ามประกาศซ้ำ", () => {
    const backendRoot = process.cwd();
    const typesSrc = readFileSync(
      join(backendRoot, "src/lib/document-composer/types.ts"),
      "utf8"
    );
    assertContains(typesSrc, "export const SIGNATURE_NAME_PLACEHOLDER", "types.ts export placeholder");
    assertContains(typesSrc, "export const SIGNATURE_NAME_HINT", "types.ts export hint");
    const previewSrc = readFileSync(
      join(backendRoot, "src/lib/document-composer/preview-renderer.ts"),
      "utf8"
    );
    assertFalse(
      /const SIGNATURE_NAME_(PLACEHOLDER|HINT)\s*=/m.test(previewSrc),
      "preview-renderer ต้อง import ไม่ประกาศเอง"
    );
    const pdfSrc = readFileSync(
      join(backendRoot, "src/lib/document-composer/descriptor-renderer.ts"),
      "utf8"
    );
    assertFalse(
      /const SIGNATURE_NAME_(PLACEHOLDER|HINT)\s*=/m.test(pdfSrc),
      "descriptor-renderer ต้อง import ไม่ประกาศเอง"
    );
  });

  // =============================================================================
  // M4 — table cell object ใช้ display label ทั้งสองฝั่ง
  // =============================================================================

  // cell ต้องเป็น object "ภายใน column" — ถ้า row เป็น {id,name} ตรง ๆ
  // headers จะแยกเป็น 2 column (id/name) และไม่เข้า object branch ของ formatter
  const OBJECT_CELL = { สังกัด: { id: null, name: "กองวิชาการ" } };
  const tableCtx = buildCtx({
    formData: { "fm-table": [OBJECT_CELL] },
    fields: [makeField("fm-table", "TABLE", "สังกัด")],
  });
  const tableBlock: DocumentBlock = {
    id: "t-1",
    type: "table",
    fieldId: "fm-table",
    label: "สังกัด",
    showLabel: true,
  };

  await test("M4.1 Preview: table cell object → display label ห้ามเป็น JSON", () => {
    const { body } = renderPreview([tableBlock], tableCtx);
    assertContains(body, "กองวิชาการ");
    assertNotContains(body, '{"id"', "ห้าม JSON.stringify ใน cell");
    assertNotContains(body, "&quot;", "ห้าม JSON.stringify (escaped)");
  });

  await test("M4.2 PDF: table cell object วาด display label เดียวกัน (parity)", async () => {
    const recs = await drawPdf([tableBlock], tableCtx);
    assertTrue(recs.some((r) => r.text === "กองวิชาการ"), "PDF วาด label");
    assertFalse(
      recs.some((r) => r.text.includes('{"id"')),
      "PDF ไม่วาด JSON"
    );
  });

  // =============================================================================
  // M6 — preview route ใช้ validateDescriptor เดียวกับ pdf-preview
  // =============================================================================

  await test("M6.1 preview route ต้องเรียก validateDescriptor ก่อน renderDescriptorToPreview (wiring)", () => {
    const routesSrc = readFileSync(
      join(process.cwd(), "src/routes/template-descriptor.routes.ts"),
      "utf8"
    );
    const previewStart = routesSrc.indexOf("'/:id/descriptor/preview'");
    const pdfStart = routesSrc.indexOf("'/:id/descriptor/pdf-preview'");
    assertTrue(previewStart > 0 && pdfStart > previewStart, "พบทั้งสอง route");
    const previewSection = routesSrc.slice(previewStart, pdfStart);
    assertContains(previewSection, "validateDescriptor(", "preview route ต้อง validate");
    assertContains(previewSection, "renderDescriptorToPreview(", "และ render ต่อ");
    // validate ต้องมาก่อน render (gate ก่อนใช้)
    assertTrue(
      previewSection.indexOf("validateDescriptor(") <
        previewSection.indexOf("renderDescriptorToPreview("),
      "validate ต้องอยู่ก่อน render"
    );
  });

  // =============================================================================
  // Low batch — CSS/markup parity pins
  // =============================================================================

  await test("L2.1 styles: .dc-block มี padding-bottom 4pt (POST_BLOCK_SPACING)", () => {
    const { styles } = renderPreview([tableBlock], tableCtx);
    const blockRule = extractRule(styles, ".dc-block");
    assertTrue(blockRule !== null, ".dc-block rule");
    assertTrue(blockRule!.includes("4pt"), "padding-bottom: 4pt");
  });

  await test("L3.1 styles: .dc-heading font-weight 400 (bold=false = regular เหมือน PDF)", () => {
    const { styles } = renderPreview([tableBlock], tableCtx);
    const rule = extractRule(styles, ".dc-heading");
    assertTrue(rule !== null, ".dc-heading rule");
    assertTrue(rule!.includes("400"), "font-weight: 400");
    assertFalse(rule!.includes("600"), "ห้ามเหลือ 600 ใน base rule");
  });

  await test("L4.1 styles: .dc-field__required สีเทา #666666 (PDF: ' *' ใช้ COLOR_GRAY)", () => {
    const { styles } = renderPreview([tableBlock], tableCtx);
    const rule = extractRule(styles, ".dc-field__required");
    assertTrue(rule !== null, ".dc-field__required rule");
    assertContains(rule!, "#666666", "สีเทาเดียวกับ PDF COLOR_GRAY");
  });

  await test("L5.1 styles: .dc-systemdata__value regular (400) และไม่มี margin-top เพิ่ม", () => {
    const { styles } = renderPreview([tableBlock], tableCtx);
    const rule = extractRule(styles, ".dc-systemdata__value");
    assertTrue(rule !== null, ".dc-systemdata__value rule");
    assertFalse(rule!.includes("600"), "PDF value = regular font");
    assertFalse(rule!.includes("margin-top"), "PDF stacked: ไม่มี gap ระหว่าง label/value");
  });

  await test("L6.1 table emptyText: ใช้ .dc-table__empty 12pt เทา (PDF FONT_SIZE_TABLE_EMPTY/COLOR_GRAY)", () => {
    const emptyCtx = buildCtx({
      formData: { "fm-table": [] },
      fields: [makeField("fm-table", "TABLE", "สังกัด")],
    });
    const { body, styles } = renderPreview([tableBlock], emptyCtx);
    assertContains(body, "dc-table__empty");
    assertContains(body, "(ไม่มีข้อมูล)");
    assertNotContains(body, 'class="dc-field__value"', "ห้าม reuse .dc-field__value ใน empty state");
    const rule = extractRule(styles, ".dc-table__empty");
    assertTrue(rule !== null, ".dc-table__empty rule");
    assertTrue(rule!.includes("12pt"), "12pt");
    assertTrue(rule!.includes("#666666"), "เทา");
  });

  await test("L7.1 table label: font-size 11pt (PDF FONT_SIZE_TABLE_LABEL)", () => {
    const { body } = renderPreview([tableBlock], tableCtx);
    assertContains(
      body,
      'style="font-weight:700;font-size:11pt;margin-bottom:4px"',
      "label style มี font-size: 11pt"
    );
  });

  await test("L10.1 Preview logo source=none → div เปล่าเก็บ margin (PDF ยังกิน marginTop/Bottom)", () => {
    const { body } = renderPreview(
      [{ id: "l-1", type: "logo", source: "none", align: "left", marginTop: 10, marginBottom: 20 } as DocumentBlock],
      buildCtx()
    );
    assertContains(body, "dc-logo--none", "none marker class");
    assertContains(body, "margin-top: 10pt", "เก็บ marginTop");
    assertContains(body, "margin-bottom: 20pt", "เก็บ marginBottom");
    assertNotContains(body, "dc-logo__placeholder", "none ต้องไม่มีข้อความ");
  });

  await test("L10.2 Preview logo source=upload → ข้อความ 'ยังไม่มีโลโก้ (upload)' เหมือน PDF", () => {
    const { body } = renderPreview(
      [{ id: "l-2", type: "logo", source: "upload", imageUrl: "https://example.com/x.png", align: "left" } as DocumentBlock],
      buildCtx()
    );
    assertContains(body, "ยังไม่มีโลโก้ (upload)");
    assertNotContains(body, "<img", "PDF ไม่ render imageUrl — preview ห้าม render");
  });

  await test("L10.3 PDF: logo none → ไม่วาดอะไร / upload → วาด 'ยังไม่มีโลโก้ (upload)' (pin)", async () => {
    const noneRecs = await drawPdf(
      [{ id: "l-1", type: "logo", source: "none", align: "left" } as DocumentBlock],
      buildCtx()
    );
    assertEqual(noneRecs.length, 0, "none: no text drawn");
    const uploadRecs = await drawPdf(
      [{ id: "l-2", type: "logo", source: "upload", align: "left" } as DocumentBlock],
      buildCtx()
    );
    assertTrue(uploadRecs.some((r) => r.text.includes("ยังไม่มีโลโก้") && r.text.includes("(upload)")));
  });

  // ── สรุป ──
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
