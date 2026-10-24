/**
 * Reproduction Test — POST descriptor/pdf-preview 503 / Error 1102
 * ---------------------------------------------------------
 * Feature: Document Composer — PDF Preview resource-limit investigation
 *
 * 🔍 อาการที่ reproduce
 * =============================================================================
 * เมื่อ Admin เพิ่ม/ลบ Field ใน PDF Composer → Frontend ยิง
 * POST /admin/template-versions/:id/descriptor/pdf-preview → HTTP 503
 * (Cloudflare Error 1102: Worker exceeded resource limits)
 *
 * Test นี้วัด CPU time / wall time / output bytes ของช่วงต่าง ๆ
 * (buildRenderPlan vs renderPlanToPdf) ใน 8 สถานการณ์:
 *   A. Descriptor ปกติ
 *   B. เพิ่ม Field หนึ่งตัว
 *   C. ลบ Field ที่มี Block อ้างถึง (field หายจาก context)
 *   D. Field ไม่มี Sample Value (formData ไม่มีค่า)
 *   E. ข้อความไทยยาว (ไม่มี space — ลักษณะภาษาไทย)
 *   F. Preview หลาย request พร้อมกัน (เทียบขนาน vs ตามลำดับ)
 *   G. Descriptor มี Block จำนวนมาก
 *   H. Pagination หลายหน้า
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/pdf-preview-reproduction.test.ts
 */

(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import { buildRenderPlan, renderPlanToPdf } from "../descriptor-renderer";
import type { ApplicationContext, FieldData } from "../../pdf-types";
import type { DocumentDescriptor } from "../types";

// =============================================================================
// Mini framework
// =============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertTrue(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

interface RenderMetrics {
  buildRenderPlanMs: number;
  renderPlanToPdfMs: number;
  totalMs: number;
  cpuMs: number;
  pageCount: number;
  outputBytes: number;
}

/** วัด render 1 ครั้ง (build plan + render pdf) พร้อม CPU time จริง */
async function measureRender(
  descriptor: DocumentDescriptor,
  ctx: ApplicationContext
): Promise<RenderMetrics> {
  const t0 = performance.now();
  const cpu0 = (process as any).cpuUsage();
  const plan = buildRenderPlan(descriptor, ctx);
  const tPlan = performance.now();
  const rendered = await renderPlanToPdf(plan, ctx);
  const t1 = performance.now();
  const cpu = (process as any).cpuUsage(cpu0);
  return {
    buildRenderPlanMs: +(tPlan - t0).toFixed(1),
    renderPlanToPdfMs: +(t1 - tPlan).toFixed(1),
    totalMs: +(t1 - t0).toFixed(1),
    cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
    pageCount: rendered.pageCount,
    outputBytes: rendered.bytes.byteLength,
  };
}

// =============================================================================
// Fixtures — เลียนแบบ buildPreviewContext() จริง
// =============================================================================

const THAI_LABELS = [
  "ชื่อ-นามสกุล",
  "เลขบัตรประชาชน",
  "วันเดือนปีเกิด",
  "ที่อยู่ปัจจุบัน",
  "หมายเลขโทรศัพท์",
  "อีเมล",
  "วุฒิการศึกษา",
  "สถาบันการศึกษา",
  "สาขาวิชา",
  "เกรดเฉลี่ยสะสม",
  "ประสบการณ์ทำงาน",
  "การอบรม/สัมมนา",
  "ความสามารถพิเศษ",
  "ตำแหน่งที่สมัคร",
  "ผลงานทางวิชาการ",
];

function makeFields(n: number): FieldData[] {
  const out: FieldData[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `tf-${i + 1}`,
      fieldId: `f-${i + 1}`,
      sectionId: "sec-1",
      displayOrder: i,
      type: "TEXT",
      label: THAI_LABELS[i % THAI_LABELS.length],
      pdfMappingKey: null,
      options: null,
      overrideOptions: null,
      isRequired: false,
      rows: null,
      helpText: null,
      placeholder: null,
    } as unknown as FieldData);
  }
  return out;
}

/** formData แบบ buildPreviewContext: `ตัวอย่าง${label}` (ข้อความไทยไม่มี space) */
function makeSampleFormData(fields: FieldData[]): Record<string, unknown> {
  const fd: Record<string, unknown> = {};
  for (const f of fields) {
    fd[f.fieldId] = `ตัวอย่าง${f.label}`;
  }
  return fd;
}

function makeCtx(
  fields: FieldData[],
  formData: Record<string, unknown>
): ApplicationContext {
  return {
    application: {
      id: "app-repro",
      applicationNo: "SAO-2569-000123",
      fullname: "สมชาย ใจดี",
      email: "preview@example.com",
      status: "PREVIEW",
      statusReason: null,
      submittedAt: 1759000000,
      formData,
    },
    round: {
      id: "r1",
      title: "รอบสอบคัดเลือกบุคคลเพื่อเข้าทำงาน",
      positionLevel: "N/A",
      announcementTitle: null,
      announcementDescription: null,
      applicationPattern: null,
      roundCode: null,
    },
    templateVersion: { id: "tv-1", versionNumber: 1 },
    sections: [{ id: "sec-1", name: "ข้อมูลส่วนตัว", displayOrder: 0 }],
    fields,
    attachments: [],
  } as unknown as ApplicationContext;
}

function fieldBlock(id: string, fieldId: string) {
  return { id, type: "field", fieldId, layout: "stacked", align: "left" };
}

/** descriptor ปกติ: heading + 10 field blocks + signature */
function baseDescriptor(fieldCount = 10): DocumentDescriptor {
  const blocks: any[] = [
    {
      id: "h-1",
      type: "heading",
      text: "ใบสมัครสอบคัดเลือกบุคคล {ROUND_NAME}",
      size: "large",
      bold: true,
      align: "center",
    },
  ];
  for (let i = 0; i < fieldCount; i++) {
    blocks.push(fieldBlock(`fb-${i + 1}`, `f-${i + 1}`));
  }
  blocks.push({
    id: "sig-1",
    type: "signature",
    lineLabel: "ลงลายมือชื่อ",
    roleLabel: "ผู้สมัคร",
    lineStyle: "..............",
    dateLabel: "วันที่",
    align: "left",
  });
  return { version: 1, blocks } as unknown as DocumentDescriptor;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("=================================================================");
  console.log("PDF Preview 503/1102 — Reproduction & Resource Measurement");
  console.log("=================================================================");

  const results: Record<string, RenderMetrics> = {};

  // ── A. Descriptor ปกติ ─────────────────────────────────────────────
  {
    const fields = makeFields(10);
    const ctx = makeCtx(fields, makeSampleFormData(fields));
    const m = await measureRender(baseDescriptor(10), ctx);
    results.A = m;
    console.log(`[A] ปกติ            plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 1, "A: ต้องได้อย่างน้อย 1 หน้า");
    assertTrue(m.outputBytes > 1000, "A: PDF ต้องมีเนื้อหา");
  }

  // ── B. เพิ่ม Field หนึ่งตัว (field ใหม่มีใน context แบบ live-insert) ──
  {
    const fields = makeFields(11);
    const ctx = makeCtx(fields, makeSampleFormData(fields));
    const m = await measureRender(baseDescriptor(11), ctx);
    results.B = m;
    console.log(`[B] เพิ่ม 1 field    plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 1, "B: ต้อง render ได้");
  }

  // ── C. ลบ Field ที่มี Block อ้างถึง (ctx.fields ไม่มี f-10 แล้ว) ──
  {
    const fields = makeFields(9); // f-10 หายจาก context
    const ctx = makeCtx(fields, makeSampleFormData(fields));
    const desc = baseDescriptor(10); // แต่ block ยังอ้าง f-1..f-10
    const m = await measureRender(desc, ctx);
    results.C = m;
    console.log(`[C] ลบ field ที่อ้าง  plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 1, "C: block ที่อ้าง field ที่หายต้องถูกข้าม ไม่ crash");
  }

  // ── D. Field ไม่มี Sample Value (formData ว่าง) ────────────────────
  {
    const fields = makeFields(10);
    const ctx = makeCtx(fields, {}); // ไม่มีค่าตัวอย่างเลย
    const m = await measureRender(baseDescriptor(10), ctx);
    results.D = m;
    console.log(`[D] ไม่มี sample     plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 1, "D: ต้อง render ได้แม้ไม่มีค่า");
  }

  // ── E. ข้อความไทยยาว (TEXTAREA ยาว 6,000 ตัวอักษร ไม่มี space) ──
  {
    const fields = makeFields(10);
    const longThai = "ผู้สมัครมีความประสงค์ขอเสนอตัวเข้ารับการคัดเลือกเพื่อปฏิบัติงานในหน่วยงานของรัฐด้วยความซื่อสัตย์สุจริตต่อหน้าที่และมุ่งมั่นพัฒนางานให้เกิดประโยชน์สูงสุดต่อองค์กร".repeat(60);
    const fd = makeSampleFormData(fields);
    fd["f-10"] = longThai; // TEXTAREA ยาว ~6,000 chars ติดกันไม่มี space
    const ctx = makeCtx(fields, fd);
    const m = await measureRender(baseDescriptor(10), ctx);
    results.E = m;
    console.log(`[E] ไทยยาว ${longThai.length}ch  plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 2, "E: ข้อความยาวต้องแบ่งหลายหน้า");
    assertTrue(m.totalMs < 30_000, "E: ต้องเสร็จในเวลาที่สมเหตุสมผล (<30s)");
  }

  // ── F. หลาย request พร้อมกัน (4 ขนาน) ─────────────────────────────
  {
    const fields = makeFields(10);
    const mk = () => makeCtx(fields, makeSampleFormData(fields));
    const t0 = performance.now();
    const cpu0 = (process as any).cpuUsage();
    const runs = await Promise.all(
      [1, 2, 3, 4].map(async () => {
        const plan = buildRenderPlan(baseDescriptor(10), mk());
        return renderPlanToPdf(plan, mk());
      })
    );
    const wall = +(performance.now() - t0).toFixed(1);
    const cpu = +((process as any).cpuUsage(cpu0).user / 1000).toFixed(1);
    results.F = {
      buildRenderPlanMs: 0,
      renderPlanToPdfMs: 0,
      totalMs: wall,
      cpuMs: cpu,
      pageCount: runs[0].pageCount,
      outputBytes: runs[0].bytes.byteLength,
    };
    console.log(`[F] 4 requests ขนาน  wall=${wall}ms cpu(sum)=${cpu}ms pages=${runs[0].pageCount}`);
    assertTrue(runs.every((r) => r.pageCount >= 1), "F: ทุก request ต้องสำเร็จ");
  }

  // ── G. Block จำนวนมาก (150 field blocks + 30 headings) ─────────────
  {
    const n = 150;
    const fields = makeFields(n);
    const ctx = makeCtx(fields, makeSampleFormData(fields));
    const blocks: any[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === 0) {
        blocks.push({ id: `h-${i}`, type: "heading", text: `หัวข้อที่ ${i + 1}`, size: "medium", bold: true, align: "left" });
      }
      blocks.push(fieldBlock(`fb-${i + 1}`, `f-${i + 1}`));
    }
    const desc = { version: 1, blocks } as unknown as DocumentDescriptor;
    const m = await measureRender(desc, ctx);
    results.G = m;
    console.log(`[G] ${blocks.length} blocks   plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.totalMs < 30_000, "G: ต้องเสร็จในเวลาที่สมเหตุสมผล (<30s)");
  }

  // ── H. Pagination หลายหน้า (12 หน้าจาก long text + pageBreaks) ────
  {
    const fields = makeFields(10);
    const para = "รายละเอียดการประกอบพิธีการตรวจสอบและประเมินผลงานตามหลักเกณฑ์มาตรฐานที่กำหนดไว้โดยคณะกรรมการสอบข้อเขียนและสัมภาษณ์".repeat(40);
    const fd = makeSampleFormData(fields);
    const blocks: any[] = [];
    for (let i = 0; i < 12; i++) {
      blocks.push({ id: `h-${i}`, type: "heading", text: `ส่วนที่ ${i + 1}`, size: "medium", bold: true, align: "left" });
      blocks.push({ id: `tfb-${i}`, type: "field", fieldId: `f-1`, layout: "stacked", align: "left" });
      blocks.push({ id: `ta-${i}`, type: "field", fieldId: `f-2`, layout: "stacked", align: "left" });
      blocks.push({ id: `pb-${i}`, type: "pageBreak" });
    }
    fd["f-2"] = para;
    fd["f-1"] = para.slice(0, 300);
    const ctx = makeCtx(fields, fd);
    const desc = { version: 1, blocks } as unknown as DocumentDescriptor;
    const m = await measureRender(desc, ctx);
    results.H = m;
    console.log(`[H] pagination      plan=${m.buildRenderPlanMs}ms render=${m.renderPlanToPdfMs}ms total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
    assertTrue(m.pageCount >= 12, "H: ต้องได้อย่างน้อย 12 หน้า (pageBreak 12 อัน)");
    assertTrue(m.totalMs < 30_000, "H: ต้องเสร็จในเวลาที่สมเหตุสมผล (<30s)");
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n=================================================================");
  console.log("Summary (totalMs / cpuMs)");
  for (const [k, m] of Object.entries(results)) {
    console.log(`  ${k}: total=${m.totalMs}ms cpu=${m.cpuMs}ms pages=${m.pageCount} bytes=${m.outputBytes}`);
  }
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  console.log("=================================================================");
  if (failed > 0) process.exit(1);
}

// counter helpers (ไม่ใช้ test() wrapper — เคสนี้วัดค่าเป็นหลัก assert ใน inline)
void passed;
void failed;
void failures;

main().catch((e: any) => {
  console.error("FATAL", e);
  process.exit(1);
});
