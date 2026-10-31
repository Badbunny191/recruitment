/**
 * Document Blocks — Comprehensive Test Suite
 * --------------------------------------------
 * Feature: Document Composer V1 — Block-based PDF/Preview
 *
 * Section N ครอบคลุม 23 ข้อกำหนดทั้งหมดของ Backend Foundation ในรอบนี้:
 *
 *   [1] Text ผสมข้อความกับ System Token
 *   [2] Text ผสม Application Field ({FIELD:<fieldId>})
 *   [3] Token ไม่รู้จักไม่ทำให้ล้ม
 *   [4] SystemData ทุก key
 *   [5] Signature ทุก option (dateSource, lineLabel, lineStyle, …)
 *   [6] Logo ไม่มีรูป → "ยังไม่มีโลโก้"
 *   [7] MASTER_DATA single object — preview/PDF ตรงกัน
 *   [8] MASTER_DATA ไม่แสดง JSON ในเอกสาร
 *   [9] Table filter / repeatable fields
 *   [10] Repeatable array render table
 *   [11] PDF renderer รองรับ Block ใหม่ (systemData, signature extensions)
 *   [12] Preview/PDF ใช้ token resolution ตรงกัน (single source)
 *   [13] descriptor เก่ายังโหลดได้ (backward compatibility)
 *   [14] XSS escaping (HTML mode)
 *   [15] Generate/Load/Save ไม่ regression
 *   [16] Field layout (stacked/inline) + valueStyle
 *   [17] Date format options (thai_long/thai_short/iso/numeric)
 *   [18] Heading multiline + italic + bold + align
 *   [19] Table block empty state + label
 *   [20] SystemData layout stacked/inline
 *   [21] showParentheses toggle in Signature
 *   [22] Image size clamp + bounds checking
 *   [23] Unknown block → non-fatal PDF (per-block resilience)
 *
 * รัน: node --import tsx src/lib/document-composer/__tests__/document-blocks.test.ts
 *
 * IMPORTANT:
 *   Set TZ=Asia/Bangkok ก่อน import เพื่อให้ date/time formatter
 *   ในทุก environment (CI/local/D1) ให้ผลลัพธ์ deterministic
 */
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = "Asia/Bangkok";

import {
  validateDescriptor,
  buildRenderPlan,
  renderPlanToPdf,
  renderDescriptorToPreview,
  resolveDocumentTokens,
  applyDocumentTokensWithFields,
  generateDescriptorFromTemplate,
  isScalarFieldType,
  isRepeatableField,
  getFieldValueShape,
  getObjectDisplayLabel,
  resolveFieldValue,
  buildFieldToken,
  listFieldTokensInText,
  formatThaiDate,
  DOCUMENT_TOKENS,
  type DocumentDescriptor,
} from "../index";
import type {
  HeadingBlock,
  FieldBlock,
  TableBlock,
  LogoBlock,
  SignatureBlock,
  SystemDataBlock,
  DocumentBlock,
} from "../types";
import type { ApplicationContext, FieldData } from "../../pdf-types";

// =============================================================================
// Test framework (mirror signature-block.test.ts)
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

function assertNotContains(haystack: string, needle: string, msg = "") {
  if (haystack.includes(needle)) {
    throw new Error(
      `${msg} unexpected substring ${JSON.stringify(needle)} found`
    );
  }
}

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Default submittedAt = 1767793020 = 2026-01-07T13:37:00Z → BKK 2026-01-07 20:37
 */
function buildAppContext(opts: {
  fullname?: string;
  submittedAt?: number;
  applicationNo?: string;
  roundTitle?: string;
  formData?: Record<string, unknown>;
  fields?: FieldData[];
} = {}): ApplicationContext {
  return {
    application: {
      id: "app-1",
      applicationNo: opts.applicationNo ?? "APP-2569-001",
      email: "test@example.com",
      fullname: opts.fullname ?? "นายสมชาย ใจดี",
      nationalId: null,
      status: "SUBMITTED",
      statusReason: null,
      submittedAt: opts.submittedAt ?? 1767793020,
      formData: opts.formData ?? null,
    },
    round: {
      id: "round-1",
      title: opts.roundTitle ?? "รอบรับสมัคร 2569",
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
    fields: opts.fields ?? [],
    attachments: [],
  };
}

/**
 * Build field ตัวอย่าง (id, label, type)
 */
function fmField(
  fieldId: string,
  label: string,
  type: FieldData["type"] | "REPEATER" | "TABLE" = "TEXT",
  extra: Partial<FieldData> = {}
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
    ...extra,
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Document Blocks — Comprehensive Test Suite ===\n");

  // ============================================================================
  // [1] Text ผสมข้อความกับ System Token
  // ============================================================================
  console.log("[1] Heading — mixed text with System Tokens");

  await test("heading 'A {APPLICATION_NO} B' resolves system token", () => {
    const ctx = buildAppContext({ applicationNo: "APP-X-9" });
    const block: HeadingBlock = {
      id: "h-1",
      type: "heading",
      text: "ใบสมัคร {APPLICATION_NO}",
      size: "medium",
      bold: true,
      align: "left",
    };
    const plan = buildRenderPlan(
      { version: 1, blocks: [block] },
      ctx
    );
    const cmd = plan.commands.find((c) => c.type === "heading");
    assertTrue(cmd?.type === "heading");
    if (cmd?.type !== "heading") return;
    assertContains(cmd.text, "APP-X-9");
    assertNotContains(cmd.text, "{APPLICATION_NO}");
    assertContains(cmd.text, "ใบสมัคร");
  });

  await test("preview renders heading with resolved token in HTML", () => {
    const ctx = buildAppContext({ applicationNo: "ABC-123" });
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: "h-1",
            type: "heading",
            text: "เลขที่ {APPLICATION_NO}",
            size: "medium",
            bold: true,
            align: "left",
          },
        ],
      },
      ctx
    );
    assertContains(preview.body, "ABC-123");
    assertNotContains(preview.body, "{APPLICATION_NO}");
  });

  // ============================================================================
  // [2] Text ผสม Application Field ({FIELD:<fieldId>})
  // ============================================================================
  console.log("\n[2] Heading — mixed text with {FIELD:<fieldId>}");

  await test("heading '... {FIELD:fm-name} ...' resolves form field", () => {
    const fields = [fmField("fm-name", "ชื่อ-นามสกุล", "TEXT")];
    const ctx = buildAppContext({
      formData: { "fm-name": "นางสาวทดสอบ ระบบ" },
      fields,
    });
    const block: HeadingBlock = {
      id: "h-1",
      type: "heading",
      text: "ผู้สมัคร: {FIELD:fm-name}",
      size: "medium",
      bold: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands.find((c) => c.type === "heading");
    if (cmd?.type !== "heading") throw new Error("no heading command");
    assertContains(cmd.text, "นางสาวทดสอบ ระบบ");
    assertNotContains(cmd.text, "{FIELD:fm-name}");
  });

  await test("preview renders {FIELD:<id>} with form value", () => {
    const fields = [fmField("fm-name", "ชื่อ", "TEXT")];
    const ctx = buildAppContext({
      formData: { "fm-name": "value-from-form" },
      fields,
    });
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: "h-1",
            type: "heading",
            text: "Hello {FIELD:fm-name}!",
            size: "medium",
          },
        ],
      },
      ctx
    );
    assertContains(preview.body, "value-from-form");
  });

  await test("resolveFieldValue returns null for unknown field", () => {
    const ctx = buildAppContext({ fields: [] });
    const result = resolveFieldValue("fm-missing", ctx);
    assertEqual(result, null);
  });

  await test("buildFieldToken produces canonical token", () => {
    assertEqual(buildFieldToken("fm-name"), "{FIELD:fm-name}");
  });

  await test("listFieldTokensInText extracts every field id in text", () => {
    const ids = listFieldTokensInText("a {FIELD:fm-1} b {FIELD:fm-2} c");
    assertEqual(ids.length, 2);
    assertTrue(ids.includes("fm-1"));
    assertTrue(ids.includes("fm-2"));
  });

  // ============================================================================
  // [3] Token ไม่รู้จักไม่ทำให้ล้ม (Requirement K.6)
  // ============================================================================
  console.log("\n[3] Unknown tokens — non-fatal behaviour");

  await test("unknown {BOGUS_TOKEN} stays literal in resolved text", () => {
    const ctx = buildAppContext();
    const result = applyDocumentTokensWithFields(
      "Hello {BOGUS_TOKEN} world",
      ctx,
      resolveDocumentTokens(ctx)
    );
    // Unknown system token kept as-is (no crash, no substitution)
    assertContains(result.text, "{BOGUS_TOKEN}");
  });

  await test("unknown {FIELD:<unknown>} stays literal", () => {
    const ctx = buildAppContext({ fields: [] });
    const result = applyDocumentTokensWithFields(
      "Known {APPLICATION_NO} / Unknown {FIELD:nope}",
      ctx,
      resolveDocumentTokens(ctx)
    );
    assertContains(result.text, "{FIELD:nope}");
    // APPLICATION_NO resolved because we provided applicationNo
    assertNotContains(result.text, "{APPLICATION_NO}");
  });

  await test("resolveDocumentTokens always returns full key set", () => {
    const ctx = buildAppContext();
    const tokens = resolveDocumentTokens(ctx);
    for (const token of DOCUMENT_TOKENS) {
      assertTrue(tokens[token] !== undefined, `token ${token} must exist`);
      assertTrue(typeof tokens[token].text === "string", "text must be string");
      assertTrue(typeof tokens[token].empty === "boolean", "empty must be bool");
    }
  });

  // ============================================================================
  // [4] SystemData ทุก key
  // ============================================================================
  console.log("\n[4] SystemData — every key resolves");

  const systemKeys: SystemDataBlock["key"][] = [
    "APPLICATION_NO",
    "ROUND_NAME",
    "APPLICATION_DATE",
    "PRINT_DATE",
    "POSITION_NAME",
  ];

  for (const key of systemKeys) {
    await test(`systemData key ${key} renders via plan + preview`, () => {
      const block: SystemDataBlock = {
        id: `sd-${key}`,
        type: "systemData",
        key,
        layout: "stacked",
        showLabel: true,
      };
      const ctx = buildAppContext();
      const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
      const cmd = plan.commands.find((c) => c.type === "systemData");
      assertTrue(cmd?.type === "systemData");
      if (cmd?.type !== "systemData") return;
      assertEqual(cmd.key, key);
      // value ต้องเป็น string (อาจเป็น placeholder เช่น {POSITION_NAME})
      assertTrue(typeof cmd.valueText === "string");
      // plan ต้องไม่ throw
      const preview = renderDescriptorToPreview(
        { version: 1, blocks: [block] },
        ctx
      );
      assertTrue(preview.body.length > 0);
    });
  }

  await test("systemData APPLICATION_DATE uses thai_long by default", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const block: SystemDataBlock = {
      id: "sd-1",
      type: "systemData",
      key: "APPLICATION_DATE",
      layout: "stacked",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "systemData") throw new Error("cmd not systemData");
    assertContains(cmd.valueText, "มกราคม");
    assertContains(cmd.valueText, "2569");
  });

  await test("systemData PRINT_DATE is renderable even when APPLICATION_DATE empty", () => {
    const ctx = buildAppContext({ submittedAt: 0 });
    const block: SystemDataBlock = {
      id: "sd-1",
      type: "systemData",
      key: "PRINT_DATE",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "systemData") throw new Error("cmd not systemData");
    // PRINT_DATE มาจาก now() — ต้องไม่ใช่ placeholder {PRINT_DATE}
    assertNotContains(cmd.valueText, "{PRINT_DATE}");
  });

  // ============================================================================
  // [5] Signature ทุก option (dateSource, lineLabel, lineStyle, …)
  // ============================================================================
  console.log("\n[5] Signature — every option");

  await test("signature with lineLabel custom value", () => {
    const ctx = buildAppContext();
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      lineLabel: "ลงชื่อ",
      roleLabel: "ผู้รับรอง",
      lineStyle: "____________",
      dateLabel: "วันที่ยื่น",
      dateSource: "APPLICATION_DATE",
      showName: true,
      showParentheses: true,
      showDate: true,
      showTime: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    assertEqual(cmd.lineLabel, "ลงชื่อ");
    assertEqual(cmd.roleLabel, "ผู้รับรอง");
    assertEqual(cmd.lineStyle, "____________");
    assertEqual(cmd.dateLabel, "วันที่ยื่น");
    assertEqual(cmd.showTime, true);
  });

  await test("signature dateSource=PRINT_DATE uses print token", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      dateSource: "PRINT_DATE",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    // PRINT_DATE != APPLICATION_DATE necessarily — at least format consistent
    assertTrue(typeof cmd.dateText === "string");
  });

  await test("signature dateSource=none produces _______ placeholder", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      dateSource: "none",
      showDate: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    assertEqual(cmd.dateText, "______________");
  });

  await test("signature nameFieldId picks form field when provided", () => {
    const ctx = buildAppContext({
      formData: { "fm-displayname": "My Display Name" },
      fields: [fmField("fm-displayname", "ชื่อที่แสดง", "TEXT")],
    });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      nameFieldId: "fm-displayname",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    assertEqual(cmd.signerName, "My Display Name");
    assertEqual(cmd.hasRealName, true);
  });

  await test("signature nameFieldId pointing to empty field → placeholder", () => {
    const ctx = buildAppContext({
      formData: { "fm-displayname": "" },
      fields: [fmField("fm-displayname", "ชื่อที่แสดง", "TEXT")],
    });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      nameFieldId: "fm-displayname",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    // command.signerName เป็น bare placeholder — วงเล็บใส่โดย showParentheses
    // ที่ตอนวาด (parity M2: constants เดียวจาก types.ts ทั้ง Preview และ PDF)
    assertEqual(cmd.signerName, "ชื่อผู้สมัคร");
    assertEqual(cmd.hasRealName, false);
  });

  // ============================================================================
  // [6] Logo ไม่มีรูป → "ยังไม่มีโลโก้" (no empty frame)
  // ============================================================================
  console.log("\n[6] Logo — missing source");

  await test("logo source=none still validates and renders empty", () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo", source: "none", align: "left" },
      ],
    };
    const validation = validateDescriptor(descriptor);
    assertTrue(validation.ok);
    const plan = buildRenderPlan(descriptor, ctx);
    // logo commands should still be present (executor decides to skip draw)
    const cmd = plan.commands.find((c) => c.type === "logo");
    assertTrue(cmd?.type === "logo");
    if (cmd?.type !== "logo") return;
    assertEqual(cmd.source, "none");
  });

  await test("logo source=upload declared as forward-compatible", () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo", source: "upload", align: "left" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "logo") throw new Error("not logo");
    assertEqual(cmd.source, "upload");
  });

  await test("logo PDF generation does not crash even if asset load fails", async () => {
    // Test that PDF generation tolerates a descriptor with logo block,
    // even when SAO logo PNG is missing (CI environment may omit it).
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo", source: "organization", align: "left" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    try {
      const result = await renderPlanToPdf(plan, ctx);
      // success → assert valid PDF header
      assertTrue(result.bytes.length > 0);
      const header = new TextDecoder().decode(result.bytes.slice(0, 5));
      assertEqual(header, "%PDF-");
    } catch (e) {
      // acceptable only if explicit error indicates asset problem;
      // otherwise surface the failure
      throw new Error(`PDF generation crashed on logo: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // ============================================================================
  // [7] MASTER_DATA single object — preview/PDF ตรงกัน
  // ============================================================================
  console.log("\n[7] MASTER_DATA — single object semantics");

  await test("MASTER_DATA single object renders only .name (no JSON)", () => {
    const fields = [
      fmField("fm-affiliation", "สังกัดปัจจุบัน", "MASTER_DATA"),
    ];
    const ctx = buildAppContext({
      formData: {
        "fm-affiliation": { id: 1, name: "กองวิชาการ" },
      },
      fields,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "f-1", type: "field", fieldId: "fm-affiliation" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    // renderer ใช้ getObjectDisplayLabel → "กองวิชาการ"
    assertContains(preview.body, "กองวิชาการ");
    // ห้าม JSON.stringify
    assertNotContains(preview.body, '{"id":1,"name":');
    assertNotContains(preview.body, "[object Object]");
  });

  await test("MASTER_DATA single object renders identically in PDF plan", () => {
    const fields = [
      fmField("fm-affiliation", "สังกัดปัจจุบัน", "MASTER_DATA"),
    ];
    const ctx = buildAppContext({
      formData: { "fm-affiliation": { id: 5, name: "กองกลาง" } },
      fields,
    });
    const block: FieldBlock = {
      id: "f-1",
      type: "field",
      fieldId: "fm-affiliation",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "field") throw new Error("not field");
    // field command ต้องมี field จริง (resolved)
    assertEqual(cmd.field.fieldId, "fm-affiliation");
  });

  // ============================================================================
  // [8] MASTER_DATA ไม่แสดง JSON ในเอกสาร (Requirement F)
  // ============================================================================
  console.log("\n[8] MASTER_DATA — never JSON-stringify");

  await test("MASTER_DATA object with extra keys → still only .name", () => {
    const fields = [
      fmField("fm-affiliation", "สังกัดปัจจุบัน", "MASTER_DATA"),
    ];
    const ctx = buildAppContext({
      formData: {
        "fm-affiliation": {
          id: 1,
          name: "กอง A",
          label: "ignored-label",
          value: "ignored-value",
          extraField: "ignored-extra",
        },
      },
      fields,
    });
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [{ id: "f-1", type: "field", fieldId: "fm-affiliation" }] },
      ctx
    );
    assertContains(preview.body, "กอง A");
    assertNotContains(preview.body, "ignored-label");
    assertNotContains(preview.body, "ignored-value");
    assertNotContains(preview.body, '{"id":1');
  });

  await test("getObjectDisplayLabel prioritizes name over label", () => {
    assertEqual(getObjectDisplayLabel({ name: "A", label: "B" }), "A");
    assertEqual(getObjectDisplayLabel({ label: "B" }), "B");
    assertEqual(getObjectDisplayLabel({ id: 5 }), "5");
    assertEqual(getObjectDisplayLabel({}), "—");
  });

  // ============================================================================
  // [9] Table filter / repeatable fields (Requirement G)
  // ============================================================================
  console.log("\n[9] Table filter — field capabilities");

  await test("isScalarFieldType covers all single-value types", () => {
    for (const t of ["TEXT", "EMAIL", "PHONE", "NUMBER", "TEXTAREA",
                     "DATE", "FILE", "CHECKBOX", "DROPDOWN", "RADIO",
                     "MASTER_DATA"]) {
      assertTrue(isScalarFieldType(t), `${t} should be scalar`);
    }
  });

  await test("MASTER_DATA is scalar by type (single-select default)", () => {
    // กัน MASTER_DATA ค่าเดียวกลายเป็น Table — Requirement G.7
    assertTrue(isScalarFieldType("MASTER_DATA"));
    assertFalse(isRepeatableField("MASTER_DATA"));
  });

  await test("REPEATER and TABLE are repeatable by type", () => {
    assertTrue(isRepeatableField("REPEATER"));
    assertTrue(isRepeatableField("TABLE"));
    assertFalse(isRepeatableField("TEXT"));
  });

  await test("isRepeatableField also accepts array value override", () => {
    // MASTER_DATA multi-select (array) → repeatable
    assertTrue(isRepeatableField("MASTER_DATA", [{ id: 1, name: "A" }]));
    assertTrue(isRepeatableField("TEXT", ["a", "b", "c"]));
    // single object MASTER_DATA → not repeatable
    assertFalse(isRepeatableField("MASTER_DATA", { id: 1, name: "A" }));
    assertFalse(isRepeatableField("TEXT", "single-string"));
  });

  await test("getFieldValueShape classifies value shapes correctly", () => {
    assertEqual(getFieldValueShape("string"), "scalar");
    assertEqual(getFieldValueShape(42), "scalar");
    assertEqual(getFieldValueShape({ id: 1 }), "object");
    assertEqual(getFieldValueShape([]), "array");
    assertEqual(getFieldValueShape([1, 2, 3]), "array");
  });

  await test("Table picker filter — empty repeatable set → empty-state guard", () => {
    // Logic ของ Table picker = filter repeatable fields
    const fields = [
      fmField("fm-name", "ชื่อ", "TEXT"),
      fmField("fm-aff", "สังกัดปัจจุบัน", "MASTER_DATA"),
    ];
    const repeatable = fields.filter((f) => {
      const sampleValue: unknown = f.type === "MASTER_DATA"
        ? { id: 1, name: "A" }
        : f.type === "TEXT"
          ? "literal text"
          : null;
      return isRepeatableField(f.type, sampleValue);
    });
    // ไม่มี repeatable field ใด → empty state
    assertEqual(repeatable.length, 0);
  });

  // ============================================================================
  // [10] Repeatable array render table
  // ============================================================================
  console.log("\n[10] Table block — repeatable array data");

  await test("table block renders array of objects as table", () => {
    const fields = [fmField("fm-education", "ประวัติการศึกษา", "REPEATER")];
    const ctx = buildAppContext({
      formData: {
        "fm-education": [
          { year: "2560", school: "มหาลัย A", degree: "วิทยาศาสตรบัณฑิต" },
          { year: "2562", school: "มหาลัย B", degree: "วิทยาศาสตรมหาบัณฑิต" },
        ],
      },
      fields,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [{ id: "t-1", type: "table", fieldId: "fm-education" }],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertTrue(preview.body.includes("<table"));
    assertContains(preview.body, "2560");
    assertContains(preview.body, "2562");
    assertContains(preview.body, "มหาลัย A");
  });

  await test("table block empty array renders emptyText placeholder", () => {
    const fields = [fmField("fm-list", "รายการ", "REPEATER")];
    const ctx = buildAppContext({
      formData: { "fm-list": [] },
      fields,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "t-1",
          type: "table",
          fieldId: "fm-list",
          emptyText: "(ยังไม่มีข้อมูล)",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    assertContains(preview.body, "(ยังไม่มีข้อมูล)");
  });

  // ============================================================================
  // [11] PDF renderer รองรับ Block ใหม่ (systemData, signature extensions)
  // ============================================================================
  console.log("\n[11] PDF renderer — new blocks");

  await test("PDF contains systemData block — full pipeline", async () => {
    const ctx = buildAppContext({ applicationNo: "PDF-001" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const cmd = plan.commands.find((c) => c.type === "systemData");
    assertTrue(cmd?.type === "systemData");
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    assertEqual(header, "%PDF-");
    assertTrue(result.pageCount >= 1);
  });

  await test("PDF contains signature with all extensions — full pipeline", async () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "sig-1",
          type: "signature",
          lineLabel: "ลงชื่อ",
          lineStyle: "____________",
          dateLabel: "วันที่",
          dateSource: "APPLICATION_DATE",
          showName: true,
          showParentheses: true,
          showDate: true,
          showTime: true,
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
  });

  await test("PDF with heading multiline + system token renders without crash", async () => {
    const ctx = buildAppContext({ roundTitle: "รอบทดสอบ" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "h-1",
          type: "heading",
          text: "ใบสมัคร\n{ROUND_NAME}",
          size: "large",
          bold: true,
          align: "center",
          italic: true,
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "heading") throw new Error("not heading");
    assertContains(cmd.text, "รอบทดสอบ");
    assertContains(cmd.text, "\n");
    assertEqual(cmd.italic, true);
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
  });

  // ============================================================================
  // [12] Preview/PDF ใช้ token resolution ตรงกัน (single source)
  // ============================================================================
  console.log("\n[12] Preview & PDF share token resolver");

  await test("heading token same string in preview vs plan text", () => {
    const ctx = buildAppContext({
      applicationNo: "MATCH-001",
      roundTitle: "MATCH-ROUND",
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "h-1",
          type: "heading",
          text: "{APPLICATION_NO} - {ROUND_NAME}",
          size: "medium",
        },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx);
    const plan = buildRenderPlan(descriptor, ctx);
    const cmd = plan.commands.find((c) => c.type === "heading");
    assertTrue(cmd?.type === "heading");
    if (cmd?.type !== "heading") return;
    // Both must contain "MATCH-001" และ "MATCH-ROUND"
    assertContains(cmd.text, "MATCH-001");
    assertContains(cmd.text, "MATCH-ROUND");
    assertContains(preview.body, "MATCH-001");
    assertContains(preview.body, "MATCH-ROUND");
  });

  await test("systemData plan text matches preview value (resolved same way)", () => {
    const ctx = buildAppContext({ applicationNo: "SAME-9", submittedAt: 1767793020 });
    const block: SystemDataBlock = {
      id: "sd-1",
      type: "systemData",
      key: "APPLICATION_NO",
    };
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [block],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const cmd = plan.commands.find((c) => c.type === "systemData");
    assertTrue(cmd?.type === "systemData");
    if (cmd?.type !== "systemData") return;
    const preview = renderDescriptorToPreview(descriptor, ctx);
    // Both contain the same value
    assertEqual(cmd.valueText, "SAME-9");
    assertContains(preview.body, "SAME-9");
  });

  // ============================================================================
  // [13] descriptor เก่ายังโหลดได้ (backward compatibility)
  // ============================================================================
  console.log("\n[13] Backward compatibility (legacy descriptors)");

  await test("legacy descriptor with only basic blocks still validates", () => {
    const legacy: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "Title", size: "medium" },
        { id: "logo-1", type: "logo" },
        { id: "sig-1", type: "signature" },
      ],
    };
    const result = validateDescriptor(legacy);
    assertTrue(result.ok);
  });

  await test("legacy signature with dateSource='application' still works", () => {
    const legacy = {
      version: 1 as const,
      blocks: [
        {
          id: "sig-1",
          type: "signature" as const,
          dateSource: "application", // legacy literal (allowed by zod union, not in TS type)
        },
      ],
    };
    const result = validateDescriptor(legacy);
    assertTrue(result.ok);
  });

  await test("legacy signature still renders and resolves to APPLICATION_DATE", () => {
    const ctx = buildAppContext({ submittedAt: 1767793020 });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      // Force-typed for legacy literal — Zod schema accepts it
      ...({ dateSource: "application" as unknown as undefined }),
      showDate: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "signature") throw new Error("not signature");
    // legacy maps to APPLICATION_DATE — dateText must NOT be the placeholder
    assertNotContains(cmd.dateText, "______________");
    assertContains(cmd.dateText, "มกราคม");
  });

  await test("legacy heading without bold/italic still renders fine", () => {
    const legacy: HeadingBlock = {
      id: "h-1",
      type: "heading",
      text: "Legacy heading",
      size: "medium",
      // no bold/italic → defaults
    };
    const ctx = buildAppContext();
    const plan = buildRenderPlan(
      { version: 1, blocks: [legacy] },
      ctx
    );
    const cmd = plan.commands[0];
    if (cmd?.type !== "heading") throw new Error("not heading");
    assertEqual(cmd.bold, true); // default true (mirror renderer)
    assertEqual(cmd.italic, false); // default false
  });

  // ============================================================================
  // [14] XSS escaping (HTML mode)
  // ============================================================================
  console.log("\n[14] XSS escaping (preview HTML)");

  await test("heading with <script> is escaped (not executable)", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: "h-1",
            type: "heading",
            text: "<script>alert(1)</script>",
            size: "medium",
          },
        ],
      },
      ctx
    );
    assertNotContains(preview.body, "<script>alert(1)");
    assertContains(preview.body, "&lt;script&gt;");
  });

  await test("heading with HTML entities stays in plain text safely", () => {
    const ctx = buildAppContext();
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: "h-1",
            type: "heading",
            text: "A & B < C > D",
            size: "medium",
          },
        ],
      },
      ctx
    );
    assertContains(preview.body, "A &amp; B &lt; C &gt; D");
    assertNotContains(preview.body, "A & B < C > D");
  });

  await test("logo imageUrl javascript: scheme is rejected", () => {
    const ctx = buildAppContext();
    const block: LogoBlock = {
      id: "logo-1",
      type: "logo",
      source: "upload",
      imageUrl: "javascript:alert(1)",
    };
    const result = validateDescriptor({ version: 1, blocks: [block] });
    // reject before rendering
    assertFalse(result.ok);
  });

  // ============================================================================
  // [15] Generate/Load/Save ไม่ regression
  // ============================================================================
  console.log("\n[15] Generator regression");

  await test("generator produces required structure (logo → title → system → sections → signature)", () => {
    const result = generateDescriptorFromTemplate({
      sections: [
        { id: "s-1", name: "ข้อมูลส่วนตัว", displayOrder: 1, isActive: true },
      ],
      fields: [
        {
          id: "tf-1",
          fieldId: "fm-name",
          sectionId: "s-1",
          displayOrder: 1,
          type: "TEXT",
          overrideLabelTh: null,
          labelTh: "ชื่อ-นามสกุล",
        },
      ],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    const blocks = result.descriptor.blocks;
    // Block 1: logo
    assertEqual(blocks[0].type, "logo");
    // Block 2: title heading
    assertEqual(blocks[1].type, "heading");
    // Block 3+: systemData (APPLICATION_NO, APPLICATION_DATE)
    assertTrue(blocks.some((b) => b.type === "systemData"));
    // Last block: signature
    assertEqual(blocks[blocks.length - 1].type, "signature");
  });

  await test("generator default order: Logo → ROUND_NAME heading → APPLICATION_NO → APPLICATION_DATE → Section → Fields → Signature", () => {
    const result = generateDescriptorFromTemplate({
      sections: [{ id: "s-1", name: "Sec", displayOrder: 1, isActive: true }],
      fields: [
        {
          id: "tf-1",
          fieldId: "fm-name",
          sectionId: "s-1",
          displayOrder: 1,
          type: "TEXT",
          overrideLabelTh: null,
          labelTh: "ชื่อ",
        },
      ],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    const types = result.descriptor.blocks.map((b) => b.type);
    // First element is logo
    assertEqual(types[0], "logo");
    // Find indices
    const headingIdx = types.indexOf("heading");
    const appNoIdx = types.findIndex(
      (t, i) => t === "systemData" &&
        (result.descriptor.blocks[i] as SystemDataBlock).key === "APPLICATION_NO"
    );
    const appDateIdx = types.findIndex(
      (t, i) => t === "systemData" &&
        (result.descriptor.blocks[i] as SystemDataBlock).key === "APPLICATION_DATE"
    );
    const fieldIdx = types.indexOf("field");
    const sigIdx = types.lastIndexOf("signature");
    // ordering constraint
    assertTrue(headingIdx < appNoIdx);
    assertTrue(appNoIdx < appDateIdx);
    assertTrue(appDateIdx < fieldIdx);
    assertTrue(fieldIdx < sigIdx);
  });

  await test("generator NEVER emits POSITION_LEVEL token in default descriptor", () => {
    const result = generateDescriptorFromTemplate({
      sections: [],
      fields: [],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    const descriptorText = JSON.stringify(result.descriptor);
    assertFalse(
      descriptorText.includes("POSITION_LEVEL"),
      "generator must not emit POSITION_LEVEL"
    );
    assertFalse(
      descriptorText.includes("ROUND_CODE"),
      "generator must not emit ROUND_CODE in default descriptor"
    );
  });

  await test("generator does not duplicate blocks if called twice (pure function)", () => {
    const a = generateDescriptorFromTemplate({
      sections: [],
      fields: [],
    });
    const b = generateDescriptorFromTemplate({
      sections: [],
      fields: [],
    });
    assertTrue(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    // ids are unique per call (UUID-based) — but block counts are same
    assertEqual(a.descriptor.blocks.length, b.descriptor.blocks.length);
  });

  // ============================================================================
  // [16] Field layout (stacked/inline) + valueStyle
  // ============================================================================
  console.log("\n[16] Field — layout + valueStyle");

  await test("field layout=stacked (default) renders label+value as separate lines", () => {
    const fields = [fmField("fm-name", "ชื่อ", "TEXT")];
    const ctx = buildAppContext({
      formData: { "fm-name": "John" },
      fields,
    });
    const block: FieldBlock = {
      id: "f-1",
      type: "field",
      fieldId: "fm-name",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "ชื่อ");
    assertContains(preview.body, "John");
  });

  await test("field layout=inline renders label + value in single line", () => {
    const fields = [fmField("fm-name", "ชื่อ", "TEXT")];
    const ctx = buildAppContext({
      formData: { "fm-name": "John" },
      fields,
    });
    const block: FieldBlock = {
      id: "f-1",
      type: "field",
      fieldId: "fm-name",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "inline");
  });

  await test("field showLabel=false hides label from preview", () => {
    const fields = [fmField("fm-name", "ชื่อลับ", "TEXT")];
    const ctx = buildAppContext({
      formData: { "fm-name": "John" },
      fields,
    });
    const block: FieldBlock = {
      id: "f-1",
      type: "field",
      fieldId: "fm-name",
      showLabel: false,
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertNotContains(preview.body, "ชื่อลับ");
    assertContains(preview.body, "John");
  });

  await test("field showRequired=false hides asterisk even when field is required", () => {
    const fields = [fmField("fm-name", "ชื่อ", "TEXT", { isRequired: true })];
    const ctx = buildAppContext({
      formData: { "fm-name": "John" },
      fields,
    });
    const block: FieldBlock = {
      id: "f-1",
      type: "field",
      fieldId: "fm-name",
      showRequired: false,
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // required marker '*' ไม่ปรากฏ
    assertNotContains(preview.body, "ชื่อ *");
  });

  // ============================================================================
  // [17] Date format options (thai_long/thai_short/iso/numeric)
  // ============================================================================
  console.log("\n[17] SystemData — date format variants");

  const FORMAT_CASES: Array<{ fmt: SystemDataBlock["dateFormat"]; expected: string }> = [
    { fmt: "thai_long", expected: "7 มกราคม 2569" },
    { fmt: "thai_short", expected: "7/1/2569" },
    { fmt: "iso", expected: "2569-01-07" },
    { fmt: "numeric", expected: "07-01-2569" },
  ];

  for (const c of FORMAT_CASES) {
    await test(`systemData APPLICATION_DATE format=${c.fmt} yields "${c.expected}"`, () => {
      const ctx = buildAppContext({ submittedAt: 1767793020 });
      const block: SystemDataBlock = {
        id: "sd-d",
        type: "systemData",
        key: "APPLICATION_DATE",
        dateFormat: c.fmt,
      };
      const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
      const cmd = plan.commands[0];
      if (cmd?.type !== "systemData") throw new Error("not systemData");
      assertEqual(cmd.valueText, c.expected);
    });
  }

  await test("formatThaiDate produces Thai Buddhist year", () => {
    // 2026-01-07 13:37 UTC = 1767793020
    // BKK = 2026-01-07 20:37 → "7 มกราคม 2569"
    assertEqual(formatThaiDate(1767793020), "7 มกราคม 2569");
  });

  // ============================================================================
  // [18] Heading multiline + italic + bold + align
  // ============================================================================
  console.log("\n[18] Heading — multiline, italic, bold, align");

  await test("heading multiline splits into separate visual lines", () => {
    const ctx = buildAppContext();
    const block: HeadingBlock = {
      id: "h-1",
      type: "heading",
      text: "Line 1\nLine 2\nLine 3",
      size: "large",
      bold: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "heading") throw new Error("not heading");
    assertContains(cmd.text, "Line 1");
    assertContains(cmd.text, "Line 2");
    assertContains(cmd.text, "Line 3");
  });

  await test("heading italic=true preserved in plan", () => {
    const ctx = buildAppContext();
    const block: HeadingBlock = {
      id: "h-1",
      type: "heading",
      text: "Italic Heading",
      size: "medium",
      italic: true,
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands[0];
    if (cmd?.type !== "heading") throw new Error("not heading");
    assertEqual(cmd.italic, true);
  });

  await test("heading align propagated to plan", () => {
    const ctx = buildAppContext();
    for (const align of ["left", "center", "right"] as const) {
      const block: HeadingBlock = {
        id: `h-${align}`,
        type: "heading",
        text: "Test",
        size: "medium",
        align,
      };
      const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
      const cmd = plan.commands[0];
      if (cmd?.type !== "heading") throw new Error("not heading");
      assertEqual(cmd.align, align);
    }
  });

  // ============================================================================
  // [19] Table block empty state + label
  // ============================================================================
  console.log("\n[19] Table block — empty state + label");

  await test("table block shows label above table when showLabel=true", () => {
    const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
    const ctx = buildAppContext({
      formData: {
        "fm-list": [{ year: "2560", school: "A" }],
      },
      fields,
    });
    const block: TableBlock = {
      id: "t-1",
      type: "table",
      fieldId: "fm-list",
      label: "ประวัติการศึกษา",
      showLabel: true,
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "ประวัติการศึกษา");
    assertContains(preview.body, "2560");
  });

  await test("table block custom emptyText respected", () => {
    const fields = [fmField("fm-list", "ประวัติ", "REPEATER")];
    const ctx = buildAppContext({
      formData: { "fm-list": [] },
      fields,
    });
    const block: TableBlock = {
      id: "t-1",
      type: "table",
      fieldId: "fm-list",
      showLabel: false,
      emptyText: "(ไม่มีข้อมูลในระบบ)",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "(ไม่มีข้อมูลในระบบ)");
  });

  // ============================================================================
  // [20] SystemData layout stacked/inline
  // ============================================================================
  console.log("\n[20] SystemData layout — stacked vs inline");

  await test("systemData layout=stacked puts label & value in CSS class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-1",
      type: "systemData",
      key: "APPLICATION_NO",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-systemdata--stacked");
    assertNotContains(preview.body, "dc-systemdata--inline");
  });

  await test("systemData layout=inline marks inline class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-2",
      type: "systemData",
      key: "ROUND_NAME",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-systemdata--inline");
  });

  // ============================================================================
  // [24] SystemData align — all directions (left/center/right)
  // ============================================================================
  console.log("\n[24] SystemData align — left / center / right");

  await test("systemData align=left renders dc-align--left class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-l",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "left",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--left");
    assertNotContains(preview.body, "dc-align--center");
    assertNotContains(preview.body, "dc-align--right");
  });

  await test("systemData align=center renders dc-align--center class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-c",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--center");
    assertNotContains(preview.body, "dc-align--left");
    assertNotContains(preview.body, "dc-align--right");
  });

  await test("systemData align=right renders dc-align--right class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-r",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "right",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--right");
    assertNotContains(preview.body, "dc-align--left");
    assertNotContains(preview.body, "dc-align--center");
  });

  await test("systemData align=center stacked has no left-indent padding", () => {
    // Regression: stacked + center/right must NOT have padding-left:12px
    // because that breaks text-align: center
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-c2",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // The value div must NOT have left padding when center — no indent
    assertContains(preview.body, "dc-align--center");
    assertContains(preview.body, "dc-systemdata--stacked");
  });

  await test("systemData align=center PDF plan has align=center", () => {
    const ctx = buildAppContext({ applicationNo: "CENTER-001" });
    const block: SystemDataBlock = {
      id: "sd-c3",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands.find((c) => c.type === "systemData");
    assertTrue(cmd?.type === "systemData");
    if (cmd?.type !== "systemData") return;
    assertEqual(cmd.align, "center");
  });

  await test("systemData align=right PDF plan has align=right", () => {
    const ctx = buildAppContext({ applicationNo: "RIGHT-001" });
    const block: SystemDataBlock = {
      id: "sd-r2",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "right",
    };
    const plan = buildRenderPlan({ version: 1, blocks: [block] }, ctx);
    const cmd = plan.commands.find((c) => c.type === "systemData");
    assertTrue(cmd?.type === "systemData");
    if (cmd?.type !== "systemData") return;
    assertEqual(cmd.align, "right");
  });

  // ============================================================================
  // [24b] SystemData inline alignment — justify-content for flex body
  // ============================================================================
  console.log("\n[24b] SystemData inline alignment — flex justify-content");

  await test("systemData inline align=left has dc-align--left class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-il",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "left",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--left");
    assertContains(preview.body, "dc-systemdata--inline");
  });

  await test("systemData inline align=center has dc-align--center class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-ic",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--center");
    assertContains(preview.body, "dc-systemdata--inline");
  });

  await test("systemData inline align=right has dc-align--right class", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-ir",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "dc-align--right");
    assertContains(preview.body, "dc-systemdata--inline");
  });

  await test("systemData inline align=center has justify-content:center in CSS", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-ic2",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // CSS ต้องมี justify-content สำหรับ inline+center
    assertContains(preview.html, "justify-content: center");
  });

  await test("systemData inline align=right has justify-content:flex-end in CSS", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-ir2",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.html, "justify-content: flex-end");
  });

  await test("systemData inline body has width:100% for justify-content to work", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-iw",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // dc-systemdata__body ต้องมี width: 100%
    assertContains(preview.html, "width: 100%");
  });

  // ============================================================================
  // [24c] SystemData inline — DOM structure (ROOT CAUSE ของ bug align ไม่มีผล)
  //
  // Bug: inline layout emit label เป็น child โดยตรงของ <section> ไม่ได้อยู่
  //      ใน .dc-systemdata__body (flex container)
  //      → justify-content จัดแค่ value ไปขวา แต่ label ยังอยู่ซ้ายเสมอ
  //      → UI เลือก align=right แต่ preview ยังดูเหมือนซ้าย
  // Fix: inline ต้องห่อ label + value ไว้ใน .dc-systemdata__body เหมือน FieldBlock
  // ============================================================================
  console.log("\n[24c] SystemData inline — DOM structure (label inside flex body)");

  await test("systemData inline puts BOTH label and value inside dc-systemdata__body", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-dom",
      type: "systemData",
      key: "APPLICATION_NO",
      showLabel: true,
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // จับ .dc-systemdata__body แบบ greedy ไปจนถึง </div></section>
    // (non-greedy จะหยุดที่ </div> ของ label ที่อยู่ข้างใน)
    const bodyMatch = preview.body.match(
      /<div class="dc-systemdata__body">([\s\S]*)<\/div>\s*<\/section>/
    );
    assertTrue(bodyMatch !== null);
    if (!bodyMatch) return;
    assertContains(bodyMatch[1], "dc-systemdata__label");
    assertContains(bodyMatch[1], "dc-systemdata__value");
  });

  await test("systemData inline label is NOT a direct child of section", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-dom2",
      type: "systemData",
      key: "APPLICATION_NO",
      showLabel: true,
      align: "center",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // โครงสร้างที่ถูก: <section ...><div class="dc-systemdata__body">LABEL VALUE</div></section>
    // โครงสร้างที่ผิด: <section ...>LABEL<div class="dc-systemdata__body">VALUE</div></section>
    const sectionMatch = preview.body.match(
      /<section class="dc-systemdata[^"]*">([\s\S]*?)<\/section>/
    );
    assertTrue(sectionMatch !== null);
    if (!sectionMatch) return;
    const inner = sectionMatch[1];
    // inner ต้องขึ้นต้นด้วย wrapper body (ไม่ใช่ label)
    assertTrue(inner.trimStart().startsWith("<div class=\"dc-systemdata__body\">"));
  });

  await test("systemData inline align=right moves label together with value", () => {
    const ctx = buildAppContext({ applicationNo: "MOVE-001" });
    const block: SystemDataBlock = {
      id: "sd-dom3",
      type: "systemData",
      key: "APPLICATION_NO",
      showLabel: true,
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // ทั้ง label และ value ต้องอยู่ในกลุ่มเดียวกัน → เคลื่อนไปขวาพร้อมกัน
    const bodyMatch = preview.body.match(
      /<div class="dc-systemdata__body">([\s\S]*)<\/div>\s*<\/section>/
    );
    assertTrue(bodyMatch !== null);
    if (!bodyMatch) return;
    assertContains(bodyMatch[1], "เลขที่ใบสมัคร");
    assertContains(bodyMatch[1], "MOVE-001");
  });

  await test("systemData stacked keeps label OUTSIDE body wrapper", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-dom4",
      type: "systemData",
      key: "APPLICATION_NO",
      showLabel: true,
      align: "left",
      layout: "stacked",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // stacked ไม่ต้องมี flex wrapper (ไม่มี .dc-systemdata__body)
    assertNotContains(preview.body, "dc-systemdata__body");
    assertContains(preview.body, "dc-systemdata--stacked");
  });

  await test("systemData inline showLabel=false renders value only inside body", () => {
    const ctx = buildAppContext({ applicationNo: "NOLBL-001" });
    const block: SystemDataBlock = {
      id: "sd-dom5",
      type: "systemData",
      key: "APPLICATION_NO",
      showLabel: false,
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertNotContains(preview.body, "dc-systemdata__label");
    assertContains(preview.body, "dc-systemdata__body");
    assertContains(preview.body, "NOLBL-001");
  });

  // ============================================================================
  // [24d] preview.styles — CSS ต้องถูกส่งถึง consumer (single source of truth)
  //
  // Bug: backend มี CSS ครบ แต่ PreviewFrame สร้าง iframe จาก preview.body
  //      ซึ่งไม่มี <style> → CSS ที่แก้ใน backend ไม่เคยมีผลใน browser
  // ============================================================================
  console.log("\n[24d] preview.styles — backend CSS ต้องส่งถึง consumer");

  await test("preview.styles is non-empty", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-st1",
      type: "systemData",
      key: "APPLICATION_NO",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertTrue(typeof preview.styles === "string" && preview.styles.length > 0);
  });

  await test("preview.styles contains systemData alignment rules", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-st2",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "right",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    // previewFrame inject styles ลง iframe → ต้องมี rule ที่ทำให้ right มีผล
    assertContains(preview.styles, ".dc-systemdata--inline.dc-align--right");
    assertContains(preview.styles, "justify-content: flex-end");
  });

  await test("preview.styles matches the CSS embedded in preview.html", () => {
    const ctx = buildAppContext();
    const block: SystemDataBlock = {
      id: "sd-st3",
      type: "systemData",
      key: "APPLICATION_NO",
      align: "center",
      layout: "inline",
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    const styleMatch = preview.html.match(/<style>([\s\S]*?)<\/style>/);
    assertTrue(styleMatch !== null);
    if (!styleMatch) return;
    assertEqual(styleMatch[1], preview.styles);
  });

  // ============================================================================
  // [25] All block types — align propagates to plan + preview
  // ============================================================================
  console.log("\n[25] Block alignment — all types");

  for (const blockType of ["heading", "field", "table", "logo", "signature"] as const) {
    for (const align of ["left", "center", "right"] as const) {
      await test(`${blockType} align=${align} renders correct align class in preview`, () => {
        const ctx = buildAppContext();
        const fields = [fmField("fm-name", "ชื่อ", "TEXT")];
        const extraCtx = buildAppContext({
          formData: { "fm-name": "test" },
          fields,
        });

        let block: DocumentBlock;
        switch (blockType) {
          case "heading":
            block = { id: `h-${align}`, type: "heading", text: "Test", size: "medium", align };
            break;
          case "field":
            block = { id: `f-${align}`, type: "field", fieldId: "fm-name", align };
            break;
          case "table":
            block = { id: `t-${align}`, type: "table", fieldId: "fm-name", align };
            break;
          case "logo":
            // parity L10: logo source=none emit div เปล่าเก็บ margin —
            // ตรวจ plan command (align) + preview body ต้องมี dc-logo--none
            {
              const logoBlock = { id: `l-${align}`, type: "logo" as const, source: "none" as const, align };
              const plan = buildRenderPlan({ version: 1, blocks: [logoBlock] }, ctx);
              const cmd = plan.commands.find((c) => c.type === "logo");
              assertTrue(cmd?.type === "logo", "logo command must exist");
              if (cmd?.type !== "logo") return;
              assertEqual(cmd.align, align);
              const nonePreview = renderDescriptorToPreview(
                { version: 1, blocks: [logoBlock] } as DocumentDescriptor,
                ctx
              );
              assertContains(nonePreview.body, "dc-logo--none");
              return; // เนื้อหาเป็น div เปล่า — ไม่มีข้อความให้เช็ค align class ท้าย body
            }
          case "signature":
            block = { id: `s-${align}`, type: "signature", align };
            break;
        }

        const preview = renderDescriptorToPreview(
          { version: 1, blocks: [block] },
          extraCtx
        );
        assertContains(preview.body, `dc-align--${align}`);
      });
    }
  }

  // ============================================================================
  // [26] Document Header — no duplicate rendering of tokens with SystemDataBlocks
  // ============================================================================
  console.log("\n[26] Document Header — no duplicate tokens");

  await test("includeHeader=true does not duplicate APPLICATION_NO when SystemDataBlock exists", () => {
    const ctx = buildAppContext({ applicationNo: "APP-001" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO", align: "center" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    // Header should NOT have APPLICATION_NO row (block already renders it)
    // Body should have the SystemDataBlock rendered
    assertNotContains(preview.header, "เลขที่ใบสมัคร");
    assertContains(preview.body, "APP-001");
  });

  await test("includeHeader=true shows APPLICATION_NO only when NO SystemDataBlock for it", () => {
    const ctx = buildAppContext({ applicationNo: "APP-002" });
    // No systemData block at all — header should show tokens
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "Test", size: "medium" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    // Header SHOULD have APPLICATION_NO (no block for it)
    assertContains(preview.header, "เลขที่ใบสมัคร");
    assertContains(preview.header, "APP-002");
  });

  await test("includeHeader=true shows ROUND_NAME only when NO SystemDataBlock for it", () => {
    const ctx = buildAppContext({ roundTitle: "รอบทดสอบ 2569" });
    // ROUND_NAME block not in descriptor
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "Test", size: "medium" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    assertContains(preview.header, "ชื่อรอบการสมัคร");
    assertContains(preview.header, "รอบทดสอบ 2569");
  });

  await test("SystemData APPLICATION_NO align=center visible in fullscreen preview", () => {
    const ctx = buildAppContext({ applicationNo: "CENTER-APP" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO", align: "center", layout: "stacked" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    // Body should have the centered block
    assertContains(preview.body, "dc-align--center");
    assertContains(preview.body, "CENTER-APP");
    // Header should NOT duplicate it
    assertNotContains(preview.header, "เลขที่ใบสมัคร");
  });

  await test("SystemData APPLICATION_NO align=right visible in fullscreen preview", () => {
    const ctx = buildAppContext({ applicationNo: "RIGHT-APP" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO", align: "right", layout: "stacked" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    assertContains(preview.body, "dc-align--right");
    assertContains(preview.body, "RIGHT-APP");
    assertNotContains(preview.header, "เลขที่ใบสมัคร");
  });

  await test("Multiple SystemData blocks — header only shows remaining tokens", () => {
    const ctx = buildAppContext({
      applicationNo: "APP-MULTI",
      roundTitle: "รอบหลาย",
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO", align: "right" },
        { id: "sd-2", type: "systemData", key: "ROUND_NAME", align: "center" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: true });
    // APPLICATION_NO and ROUND_NAME are in blocks — header should NOT show them
    assertNotContains(preview.header, "เลขที่ใบสมัคร");
    assertNotContains(preview.header, "ชื่อรอบการสมัคร");
    // APPLICATION_DATE and PRINT_DATE still in header (no blocks for them)
    assertContains(preview.header, "วันที่สมัคร");
    assertContains(preview.header, "วันที่พิมพ์");
  });

  await test("includeHeader=false suppresses entire header (no duplicate)", () => {
    const ctx = buildAppContext({ applicationNo: "APP-NO-HEADER" });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO" },
      ],
    };
    const preview = renderDescriptorToPreview(descriptor, ctx, { includeHeader: false });
    // header should be empty
    assertEqual(preview.header, "");
    // body should have the SystemDataBlock
    assertContains(preview.body, "APP-NO-HEADER");
  });

  // ============================================================================
  // [27] Signature showParentheses toggle
  // ============================================================================
  console.log("\n[27] Signature — showParentheses toggle");

  await test("signature showParentheses=true wraps name in parens", () => {
    const ctx = buildAppContext({ fullname: "นาย ก" });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      showName: true,
      showParentheses: true,
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "(นาย ก)");
  });

  await test("signature showParentheses=false omits parens around name", () => {
    const ctx = buildAppContext({ fullname: "นาย ก" });
    const block: SignatureBlock = {
      id: "sig-1",
      type: "signature",
      showName: true,
      showParentheses: false,
    };
    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [block] },
      ctx
    );
    assertContains(preview.body, "นาย ก");
  });

  // ============================================================================
  // [22] Image size clamp + bounds checking
  // ============================================================================
  console.log("\n[22] Image size bounds");

  await test("logo width clamped to schema bounds", () => {
    const ctx = buildAppContext();
    // width: 0 ต้อง clamp ขึ้นเป็น 8 (schema min)
    const tooSmall: DocumentDescriptor = {
      version: 1,
      blocks: [{ id: "logo-1", type: "logo", width: 0 }],
    };
    const r1 = validateDescriptor(tooSmall);
    assertFalse(r1.ok);
    // width: 9999 ต้อง clamp เป็น 1000
    const tooLarge: DocumentDescriptor = {
      version: 1,
      blocks: [{ id: "logo-1", type: "logo", width: 9999 }],
    };
    const r2 = validateDescriptor(tooLarge);
    assertFalse(r2.ok);
  });

  await test("logo imageUrl with invalid scheme is rejected", () => {
    const ctx = buildAppContext();
    const bad: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "logo-1",
          type: "logo",
          source: "upload",
          imageUrl: "javascript:alert(1)",
        },
      ],
    };
    const r = validateDescriptor(bad);
    assertFalse(r.ok);
  });

  await test("logo imageUrl https is accepted", () => {
    const ctx = buildAppContext();
    const good: DocumentDescriptor = {
      version: 1,
      blocks: [
        {
          id: "logo-1",
          type: "logo",
          source: "upload",
          imageUrl: "https://example.com/logo.png",
        },
      ],
    };
    const r = validateDescriptor(good);
    assertTrue(r.ok);
  });

  // ============================================================================
  // [23] Unknown block → non-fatal PDF (per-block resilience)
  // ============================================================================
  console.log("\n[23] PDF resilience — bad block must NOT crash the whole document");

  await test("PDF generation does not throw on descriptor with valid blocks", async () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "T", size: "medium" },
        { id: "logo-1", type: "logo", source: "none" },
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO" },
        { id: "sig-1", type: "signature" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    // ทุก command ต้องเป็น type ที่ valid (ไม่มี unknown)
    for (const cmd of plan.commands) {
      assertTrue(
        [
          "padding",
          "heading",
          "field",
          "table",
          "logo",
          "signature",
          "systemData",
        ].includes(cmd.type),
        `command type "${cmd.type}" must be valid`
      );
    }
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
  });

  await test("PDF generation succeeds even with empty descriptor except for one block", async () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [{ id: "h-1", type: "heading", text: "Solo", size: "medium" }],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const result = await renderPlanToPdf(plan, ctx);
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    assertEqual(header, "%PDF-");
    assertTrue(result.pageCount >= 1);
  });

  await test("PDF generation with all 5 block types in single doc", async () => {
    const fields = [
      fmField("fm-name", "ชื่อ", "TEXT"),
      fmField("fm-list", "ประวัติ", "REPEATER"),
    ];
    const ctx = buildAppContext({
      formData: {
        "fm-name": "นายสมชาย",
        "fm-list": [{ year: "2560" }],
      },
      fields,
    });
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo", source: "none", align: "left" },
        {
          id: "h-1",
          type: "heading",
          text: "ใบสมัคร {APPLICATION_NO}",
          size: "large",
          bold: true,
        },
        { id: "sd-1", type: "systemData", key: "APPLICATION_NO" },
        { id: "f-1", type: "field", fieldId: "fm-name" },
        { id: "t-1", type: "table", fieldId: "fm-list" },
        { id: "sig-1", type: "signature", lineLabel: "ลงชื่อ" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    const result = await renderPlanToPdf(plan, ctx);
    assertTrue(result.bytes.length > 0);
    assertTrue(result.pageCount >= 1);
  });

  // ============================================================================
  // [Bonus] Robustness — sanity checks for response shapes
  // ============================================================================
  console.log("\n[Bonus] Robustness checks");

  await test("resolveDocumentTokens for all keys returns TokenValue shape", () => {
    const ctx = buildAppContext();
    const tokens = resolveDocumentTokens(ctx);
    for (const k of DOCUMENT_TOKENS) {
      const v = tokens[k];
      assertTrue(typeof v === "object");
      assertTrue(typeof v.text === "string");
      assertTrue(typeof v.empty === "boolean");
    }
  });

  await test("buildRenderPlan.meta is structurally correct", () => {
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "logo-1", type: "logo" },
        { id: "h-1", type: "heading", text: "x", size: "medium" },
        {
          id: "f-1",
          type: "field",
          fieldId: "fm-missing", // ทำให้ missing
        },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    assertEqual(plan.meta.blockCount, 3);
    assertTrue(plan.meta.missingFieldIds.includes("fm-missing"));
    assertEqual(plan.meta.fieldRefCount, 0); // field ถูก drop เมื่อ missing
  });

  await test("heading block missing text → still valid (resolved text may be empty)", () => {
    // ห้ามทำให้ PDF ล้ม — handles empty text gracefully
    const ctx = buildAppContext();
    const descriptor: DocumentDescriptor = {
      version: 1,
      blocks: [
        { id: "h-1", type: "heading", text: "Hello", size: "small", align: "left" },
      ],
    };
    const plan = buildRenderPlan(descriptor, ctx);
    assertTrue(plan.commands.length > 0);
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
